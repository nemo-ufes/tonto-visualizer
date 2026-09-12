/**
 * The diagram, beside the text.
 *
 * One panel, following the editor. It holds the session that reads the model,
 * the arrangement that says where things are, and the webview that draws them;
 * everything else here is keeping those three in step as the model is typed.
 */

import * as vscode from 'vscode';
import type { ContentOptions, DisplayOptions, ViewModel } from 'tonto-view';
import { contentAfter, derive, expandInverseIds, idsAtSource, packagesInScope, reconcile } from 'tonto-view';
import { ViewSession } from 'tonto-view/session';
import { autoLayout } from 'tonto-canvas';
import { darkTheme, drawnSizes, lightTheme, movedTo, placeNewNodes, render, sizeOf } from 'tonto-canvas/draw';
import { filterItemsOf, filterView } from './filters.js';
import type { FilterItem, FromPanel, Rect, ToPanel } from './protocol.js';
import { routesAffectedBy, safeRestoredPlacements } from './restoration.js';
import {
    labelOfView, ViewStore, viewChoicesFor, viewFileExists, viewNameFor, viewNameOf, viewUriFor
} from './view-store.js';

const DEBOUNCE = 300;

/**
 * Busts the webview's cache of its own script and stylesheet.
 *
 * `webview.js` and `canvas.css` are asked for by the same URL every time --
 * the version in `package.json` does not move between builds -- and Chromium
 * is entitled to keep answering from cache across a `Reload Window`, which
 * restarts the extension host but not necessarily the webview's cache
 * partition. One value per activation of this extension, so every panel this
 * process ever opens agrees on it, and a stale one cannot survive past the
 * reload that would have fixed it anyway.
 */
const ASSET_VERSION = Date.now();

export class DiagramPanel {
    static current: DiagramPanel | undefined;

    private readonly disposables: vscode.Disposable[] = [];
    private session: ViewSession | undefined;
    private store: ViewStore | undefined;
    private document: vscode.TextDocument | undefined;
    private view: ViewModel = { groups: [], nodes: [], edges: [], gensets: [] };
    /** The last successfully derived model, before modeller-owned filters. */
    private catalog: ViewModel = { groups: [], nodes: [], edges: [], gensets: [] };
    private positions: Record<string, Rect> = {};
    private pending: NodeJS.Timeout | undefined;
    private ready = false;
    /** Invalidates asynchronous work started for an editor that is no longer current. */
    private generation = 0;
    /** Only the newest arrangement request may replace positions or routes. */
    private layoutRequest = 0;
    private refreshes: Promise<void> = Promise.resolve();
    private availablePackages: string[] = [];
    private focusPackages: string[] = [];
    private filters: FilterItem[] = [];
    private visibleNodeIds = new Set<string>();
    private hasPresentedView = false;
    /** The first drawing of an opened view should fill its viewport, exactly once. */
    private fitNextView = true;
    private selected = new Set<string>();
    private disposal: Promise<void> | undefined;
    /** The last message built, so a panel that becomes ready late still gets it. */
    private last: ToPanel | undefined;
    /** Rasterising is a round trip to the panel, so each one is answered by id. */
    private rasterRequest = 0;
    private readonly rasters = new Map<number, {
        resolve: (bytes: Uint8Array) => void;
        reject: (error: Error) => void;
        timer: NodeJS.Timeout;
    }>();

    private constructor(private readonly panel: vscode.WebviewPanel, private readonly extensionUri: vscode.Uri) {
        panel.webview.html = this.html();
        panel.onDidDispose(() => void this.dispose(), undefined, this.disposables);
        panel.webview.onDidReceiveMessage(
            (message: FromPanel) => void this.receive(message), undefined, this.disposables);

        this.disposables.push(vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document === this.document && updateMode() === 'onType') {
                this.schedule();
            }
        }));
        this.disposables.push(vscode.workspace.onDidSaveTextDocument(document => {
            if (document === this.document && updateMode() === 'onSave') {
                this.schedule();
            }
        }));
        this.disposables.push(vscode.window.onDidChangeActiveTextEditor(editor => {
            if (editor?.document.languageId === 'tonto' && followsEditor()) {
                void this.show(editor.document);
            }
        }));
        // The cursor sitting in a declaration selects it in the diagram, which is
        // the cheap half of side-by-side: the reader never has to hunt for the box
        // that goes with the line they are on.
        this.disposables.push(vscode.window.onDidChangeTextEditorSelection(event => {
            if (event.textEditor.document === this.document) {
                this.selectAt(event.selections[0]?.active);
            }
        }));
        this.disposables.push(vscode.window.onDidChangeActiveColorTheme(theme => {
            this.post({ type: 'theme', dark: isDark(theme) });
        }));
    }

    static async open(
        extensionUri: vscode.Uri, document: vscode.TextDocument, viewUri?: vscode.Uri
    ): Promise<void> {
        if (DiagramPanel.current) {
            DiagramPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
            await DiagramPanel.current.show(document, viewUri);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'tontoDiagram',
            'Tonto diagram',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out'), vscode.Uri.joinPath(extensionUri, 'media')]
            }
        );
        DiagramPanel.current = new DiagramPanel(panel, extensionUri);
        vscode.commands.executeCommand('setContext', 'tontoVizOpen', true);
        await DiagramPanel.current.show(document, viewUri);
    }

    /** Points the diagram at a document, loading its arrangement. */
    async show(document: vscode.TextDocument, requestedView?: vscode.Uri): Promise<void> {
        // Returning from the webview to the editor fires the active-editor
        // listener. That must keep a named view open rather than silently
        // replacing it with the default arrangement for the same document.
        const viewUri = requestedView
            ?? (this.document === document ? this.store?.location : undefined)
            ?? viewUriFor(document.uri);
        const generation = ++this.generation;
        this.layoutRequest += 1;
        clearTimeout(this.pending);
        this.pending = undefined;
        if (this.document === document && this.store?.location.toString() === viewUri.toString()) {
            this.schedule();
            return;
        }
        this.fitNextView = true;
        const folder = modelRootOf(document.uri);
        const session = new ViewSession({ workspace: [folder] });
        const store = await ViewStore.open(document.uri, undefined, saveArrangement(), viewUri);
        if (generation !== this.generation) {
            await store.dispose();
            return;
        }
        await this.store?.dispose();
        if (generation !== this.generation) {
            await store.dispose();
            return;
        }
        this.document = document;
        this.panel.title = this.diagramTitle(document.uri, viewUri);
        this.session = session;
        this.store = store;
        this.view = { groups: [], nodes: [], edges: [], gensets: [] };
        this.catalog = { groups: [], nodes: [], edges: [], gensets: [] };
        this.positions = {};
        this.filters = [];
        this.visibleNodeIds = new Set();
        this.selected = new Set();
        this.hasPresentedView = false;
        await this.refresh();
    }

    /** Chooses another arrangement over the current model. */
    async chooseView(): Promise<void> {
        const document = this.document;
        if (!document) {
            return;
        }
        const picked = await vscode.window.showQuickPick(await viewChoicesFor(document.uri), {
            title: 'Open Diagram View',
            placeHolder: 'Choose an arrangement of this model'
        });
        if (picked) {
            await this.show(document, picked.uri);
        }
    }

    /** Makes the current content and arrangement a separately named document. */
    async saveAsNamedView(): Promise<void> {
        const document = this.document;
        const store = this.store;
        if (!document || !store) {
            return;
        }
        const entered = await vscode.window.showInputBox({
            title: 'Save Diagram as Named View',
            prompt: "The view is stored under the model's views folder and can be committed with it.",
            placeHolder: 'Core taxonomy',
            validateInput: value => viewNameOf(value) ? undefined : 'Enter a name containing a letter or number.'
        });
        if (entered === undefined) {
            return;
        }
        const name = viewNameOf(entered);
        if (!name) {
            return;
        }
        const target = viewUriFor(document.uri, name);
        if (store.location.toString() === target.toString()) {
            vscode.window.showInformationMessage(`This is already the ${labelOfView(name)} view.`);
            return;
        }
        if (await viewFileExists(target)) {
            const replace = await vscode.window.showWarningMessage(
                `${nameOf(target)} already exists. Replace it with the current diagram?`,
                { modal: true }, 'Replace');
            if (replace !== 'Replace') {
                return;
            }
        }
        try {
            await store.copyTo(target);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Could not save the named view: ${message}`);
            return;
        }
        if (store === this.store && document === this.document) {
            await this.show(document, target);
            vscode.window.showInformationMessage(`Saved ${nameOf(target)}.`);
        }
    }

    /** Arranges the diagram, and leaves the previous picture intact if ELK cannot. */
    async autoLayoutNow(only?: string[]): Promise<boolean> {
        const store = this.store;
        if (!store) {
            return false;
        }
        const request = ++this.layoutRequest;
        const view = this.view;
        const previous = this.positions;
        // The size each card is drawn at, not the size its content needs: a card
        // the modeller widened is arranged around at the width they gave it,
        // and its neighbours are placed clear of that rather than under it.
        const sizes = drawnSizes(view, this.sizes(store.state.display), store.state.nodes);
        let laid;
        try {
            laid = await autoLayout(view, sizes, this.positions, {
                ...store.state.layout,
                routing: store.state.display.routing,
                ...(only ? { only } : {})
            });
        } catch (error) {
            if (request !== this.layoutRequest || store !== this.store || view !== this.view) {
                return false;
            }
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Could not arrange this model: ${message}`);
            // Everything stays where it was, and is drawn: the arrangement that
            // failed is the one nobody sees.
            this.send();
            return false;
        }
        if (request !== this.layoutRequest || store !== this.store || view !== this.view) {
            return false;
        }
        this.positions = laid.positions;
        store.move(movedTo(laid.positions, store.state.nodes));
        // Only an orthogonal drawing has routes to keep; a straight one is
        // recomputed from the boxes, so what is on screen after an arrange is
        // the same kind of line as after a drag.
        const subject = only ? new Set(only) : undefined;
        const replaced = new Set<string>();
        for (const edge of view.edges) {
            if (!subject || subject.has(edge.source) || subject.has(edge.target)) {
                const route = subject && (!subject.has(edge.source) || !subject.has(edge.target))
                    ? undefined
                    : laid.routes[edge.id] ? { points: laid.routes[edge.id]! } : undefined;
                store.reroute(edge.id, route);
                if (route) {
                    replaced.add(edge.id);
                }
            }
        }
        if (subject) {
            const moved = new Set([...subject].filter(id => {
                const before = previous[id];
                const after = laid.positions[id];
                return before !== undefined && after !== undefined
                    && (before.x !== after.x || before.y !== after.y
                        || before.width !== after.width || before.height !== after.height);
            }));
            this.dropRoutesAffectedBy(moved, store, replaced);
        }
        this.send();
        return true;
    }

    async autoLayoutSelectedOrAll(): Promise<void> {
        const only = [...this.selected].filter(id => this.positions[id] !== undefined);
        await this.autoLayoutNow(only.length > 0 ? only : undefined);
    }

    /**
     * Writes the diagram out, as the drawing or as a picture of it.
     *
     * Without a format the file decides: the dialog offers both, and a name
     * ending in `.png` is a request for one. Which is how a Save As has always
     * worked, and one button fewer on a toolbar that is already full.
     */
    async exportDiagram(format?: 'svg' | 'png'): Promise<void> {
        const store = this.store;
        if (!store || !this.document) {
            return;
        }
        const suggested = format ?? 'svg';
        const target = await vscode.window.showSaveDialog({
            defaultUri: this.document.uri.with({
                path: this.document.uri.path.replace(/\.tonto$/, `.${suggested}`)
            }),
            filters: format === 'png' ? { PNG: ['png'] }
                : format === 'svg' ? { SVG: ['svg'] }
                    : { SVG: ['svg'], PNG: ['png'] }
        });
        if (!target) {
            return;
        }
        const drawn = render({
            view: this.view,
            positions: this.positions,
            routes: store.state.edges,
            display: store.state.display,
            theme: isDark(vscode.window.activeColorTheme) ? darkTheme : lightTheme
        });
        const wanted = format ?? (target.path.toLowerCase().endsWith('.png') ? 'png' : 'svg');
        try {
            const bytes = wanted === 'png'
                ? await this.rasterise(drawn.svg)
                : Buffer.from(drawn.svg, 'utf8');
            await vscode.workspace.fs.writeFile(target, bytes);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Could not write the diagram: ${message}`);
            return;
        }
        vscode.window.showInformationMessage(`Diagram written to ${target.fsPath}`);
    }

    /** Kept for the command id the extension has always contributed. */
    async exportSvg(): Promise<void> {
        await this.exportDiagram('svg');
    }

    /**
     * Asks the panel to draw the SVG as pixels, since only a browser can.
     *
     * Twice the size, because a diagram exported to be looked at is read on a
     * screen that is usually denser than the one it was drawn on, and a class
     * name at one pixel per point is soft on every one of them.
     */
    private rasterise(svg: string): Promise<Uint8Array> {
        if (!this.ready) {
            return Promise.reject(new Error('the diagram panel is not open'));
        }
        const id = ++this.rasterRequest;
        return new Promise<Uint8Array>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.rasters.delete(id);
                reject(new Error('the panel did not answer in time'));
            }, 20000);
            this.rasters.set(id, { resolve, reject, timer });
            this.post({ type: 'rasterise', id, svg, scale: 2 });
        });
    }

    private schedule(): void {
        clearTimeout(this.pending);
        this.pending = setTimeout(() => void this.refresh(), DEBOUNCE);
    }

    /**
     * Re-reads the model and redraws.
     *
     * A model that does not parse leaves the previous picture on screen with a
     * note saying so. Someone typing a class name spends most of their keystrokes
     * in that state, and blanking the diagram for each of them would make the
     * panel useless exactly when it is being watched.
     */
    private refresh(): Promise<void> {
        this.layoutRequest += 1;
        const generation = this.generation;
        const refresh = this.refreshes.then(async () => this.refreshNow(generation));
        this.refreshes = refresh.catch(() => undefined);
        return refresh;
    }

    private async refreshNow(generation: number): Promise<void> {
        if (generation !== this.generation) {
            return;
        }
        const session = this.session;
        const store = this.store;
        const document = this.document;
        if (!session || !store || !document) {
            return;
        }

        await session.update(document.uri.toString(), document.getText());
        if (generation !== this.generation
            || session !== this.session || store !== this.store || document !== this.document) {
            return;
        }
        const errors = await session.parseErrors(document.uri.toString());
        if (errors.length > 0 && this.catalog.nodes.length > 0) {
            this.installView(filterView(this.catalog, store.state.content.hidden ?? []), store);
            this.send(errors[0]);
            return;
        }

        const models = await session.models();
        if (generation !== this.generation
            || session !== this.session || store !== this.store || document !== this.document) {
            return;
        }
        const focused = await session.modelsOf(document.uri.toString(), models);
        this.availablePackages = [...new Set(models
            .flatMap(model => model.packages.map(one => one.name))
            .filter((name): name is string => name !== undefined))].sort();
        this.focusPackages = [...new Set(focused
            .flatMap(model => model.packages.map(one => one.name))
            .filter((name): name is string => name !== undefined))];
        // `focusPackages` and `availablePackages` are only good from here on --
        // read before this point (as the scope this file or the whole workspace
        // resolves to) they are last refresh's, which on the very first refresh
        // of a newly opened document is nothing at all: the diagram drew empty
        // until some unrelated change asked for a second one.
        const content = this.effectiveContent(store.state.content);
        const deriveWith = (options: ContentOptions) => derive({
            models,
            ...(this.focusPackages[0] ? { focus: this.focusPackages[0] } : {}),
            documentation: session.documentation(),
            options
        });
        const { hidden, ...unfiltered } = content;
        const catalog = deriveWith(unfiltered);
        this.catalog = catalog;
        this.filters = filterItemsOf(catalog);
        const isFirstDraw = this.installView(filterView(catalog, hidden ?? []), store);
        if (isFirstDraw) {
            // Nothing has been arranged yet, so this is the one time the diagram
            // may lay itself out completely.
            await this.autoLayoutNow();
            return;
        }
        this.send(errors[0]);
    }

    /**
     * Reconciles a visible model with its saved arrangement.
     *
     * A restored card is new to the current canvas even though it has an old
     * saved position. If that place has since been occupied, hand it back to
     * the local placer and invalidate every route that the returning rectangle
     * can affect.
     */
    private installView(next: ViewModel, store: ViewStore): boolean {
        const previous = this.positions;
        const returning = new Set(this.hasPresentedView
            ? next.nodes.filter(node => !this.visibleNodeIds.has(node.id)).map(node => node.id)
            : []);
        this.view = next;
        const reconciled = reconcile(store.state, next);
        const sizes = this.sizes(store.state.display);
        // A class newly introduced by an edit has a position on screen before
        // it has one in the file. Preserve that local arrangement through the
        // next refresh; saved positions still win, which is what undo, redo and
        // reopening the view require.
        const current = this.hasPresentedView
            ? Object.fromEntries(next.nodes
                .filter(node => this.visibleNodeIds.has(node.id) && previous[node.id])
                .map(node => [node.id, previous[node.id]!]))
            : {};
        const { placed: safePlaced, repositioned } = safeRestoredPlacements(
            next.nodes.map(node => node.id), returning, sizes, { ...current, ...reconciled.placed });

        const placed = placeNewNodes(next, sizes, safePlaced);
        const changed = new Set(returning);
        for (const node of next.nodes) {
            const before = previous[node.id];
            const after = placed[node.id];
            if (before && after && (before.width !== after.width || before.height !== after.height)) {
                changed.add(node.id);
            }
        }
        this.positions = placed;
        for (const id of repositioned) {
            const position = placed[id];
            const saved = store.state.nodes[id];
            if (position && saved) {
                store.move({ [id]: { ...saved, x: position.x, y: position.y } });
            }
        }
        this.dropRoutesAffectedBy(changed, store);
        this.visibleNodeIds = new Set(next.nodes.map(node => node.id));
        this.hasPresentedView = true;
        return Object.keys(reconciled.placed).length === 0 && next.nodes.length > 0;
    }

    private sizes(display: DisplayOptions): Record<string, { width: number; height: number }> {
        return Object.fromEntries(this.view.nodes.map(node => [node.id, sizeOf(node, display)]));
    }

    /**
     * The content options with the packages named, since the view is derived
     * from names and the stored options hold a scope.
     *
     * Which packages a scope comes to is not known until the model has been
     * read, and changes as the panel follows the editor: that is why the file
     * says `file` or `workspace` rather than listing them.
     */
    private effectiveContent(content: ContentOptions): ContentOptions {
        return {
            ...content,
            includedPackages: packagesInScope(content, {
                file: this.focusPackages,
                workspace: this.availablePackages
            })
        };
    }

    /**
     * Drops every route whose endpoint moved, plus routes now crossed by one of
     * the changed boxes. A stored route depends on its whole corridor, not only
     * on the two boxes it joins.
     */
    private dropRoutesAffectedBy(
        nodes: ReadonlySet<string>, store: ViewStore, preserve: ReadonlySet<string> = new Set()
    ): void {
        // Hidden associations still have saved routes. Moving one of their
        // endpoints must invalidate those routes now, or restoring the line
        // later resurrects a polyline whose ends describe the old card places.
        for (const edge of routesAffectedBy(this.catalog, this.positions, store.state.edges, nodes, preserve)) {
            store.reroute(edge, undefined);
        }
    }

    private send(stale?: string): void {
        const store = this.store;
        if (!store) {
            return;
        }
        const message: ToPanel = {
            type: 'model',
            view: this.view,
            positions: this.positions,
            routes: store.state.edges,
            display: store.state.display,
            content: this.effectiveContent(store.state.content),
            layout: store.state.layout,
            packages: this.availablePackages,
            filters: this.filters,
            title: this.document && this.store
                ? this.diagramTitle(this.document.uri, this.store.location).replace(/^Diagram: /, '')
                : 'Tonto',
            ...(this.fitNextView ? { fit: true } : {}),
            ...(stale ? { stale } : {})
        };
        this.last = message;
        this.post(message);
        if (this.ready) {
            this.fitNextView = false;
        }
    }

    private post(message: ToPanel): void {
        if (this.ready) {
            void this.panel.webview.postMessage(message);
        }
    }

    private diagramTitle(modelUri: vscode.Uri, viewUri: vscode.Uri): string {
        const view = viewNameFor(modelUri, viewUri);
        return `Diagram: ${nameOf(modelUri)}${view ? ` — ${labelOfView(view)}` : ''}`;
    }

    private async receive(message: FromPanel): Promise<void> {
        const store = this.store;
        switch (message.type) {
            case 'ready':
                this.ready = true;
                this.post({ type: 'theme', dark: isDark(vscode.window.activeColorTheme) });
                if (this.last) {
                    void this.panel.webview.postMessage(this.last);
                    this.fitNextView = false;
                }
                return;
            case 'moved':
                if (!store) {
                    return;
                }
                store.begin(message.resized ? 'Resize' : 'Move');
                this.layoutRequest += 1;
                store.move(message.positions);
                {
                    // The size a card is drawn at is what it holds, grown to
                    // whatever the file asks for -- so a drag keeps the width
                    // the modeller chose, and fitting a card back to its
                    // content, which clears that width, shrinks it here too.
                    const drawn = drawnSizes(this.view, this.sizes(store.state.display), store.state.nodes);
                    for (const [id, placement] of Object.entries(message.positions)) {
                        this.positions[id] = {
                            x: placement.x,
                            y: placement.y,
                            ...(drawn[id] ?? { width: 160, height: 60 })
                        };
                    }
                }
                this.dropRoutesAffectedBy(new Set(Object.keys(message.positions)), store);
                return;
            case 'rerouted':
                if (store) {
                    store.begin(message.route ? 'Route' : 'Straighten');
                    this.layoutRequest += 1;
                    store.reroute(message.edge, message.route);
                }
                return;
            case 'reveal':
                await this.reveal(message.id);
                return;
            case 'moveToNewWindow':
                // The command acts on the active editor. A message normally
                // arrives from this webview while it is active; reveal makes
                // that invariant explicit if focus moved during dispatch.
                this.panel.reveal(this.panel.viewColumn, false);
                await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
                return;
            case 'display':
                if (store) {
                    store.begin('Display option');
                    const before = store.state.display.routing;
                    store.update({ display: { ...store.state.display, ...message.display } });
                    if (message.display.routing && message.display.routing !== before) {
                        // The routes belong to the style that made them: an
                        // orthogonal drawing's bends are nonsense as straight
                        // lines, and a straight drawing has none to keep.
                        for (const edge of this.view.edges) {
                            store.reroute(edge.id, undefined);
                        }
                        this.layoutRequest += 1;
                        this.send();
                        return;
                    }
                    const previous = this.positions;
                    this.positions = placeNewNodes(this.view, this.sizes(store.state.display), previous);
                    const resized = new Set(this.view.nodes
                        .filter(node => previous[node.id]?.width !== this.positions[node.id]?.width
                            || previous[node.id]?.height !== this.positions[node.id]?.height)
                        .map(node => node.id));
                    this.layoutRequest += 1;
                    this.dropRoutesAffectedBy(resized, store);
                    this.send();
                }
                return;
            case 'layout':
                if (store) {
                    store.begin('Layout option');
                    store.update({ layout: { ...store.state.layout, ...message.layout } });
                    if (!await this.autoLayoutNow()) {
                        // Taken back exactly as the modeller would have taken it
                        // back, so the options panel goes on saying what is
                        // actually drawing the diagram.
                        store.undo();
                        this.send();
                    }
                }
                return;
            case 'content':
                if (store) {
                    store.begin('Content option');
                    store.update({ content: contentAfter(store.state.content, message.content) });
                    await this.refresh();
                }
                return;
            case 'hide':
                if (store) {
                    store.begin('Hide');
                    const hidden = new Set([
                        ...(store.state.content.hidden ?? []),
                        ...expandInverseIds(this.view.edges, message.ids)
                    ]);
                    store.update({ content: { ...store.state.content, hidden: [...hidden] } });
                    await this.refresh();
                }
                return;
            case 'show':
                if (store) {
                    store.begin('Show');
                    const shown = new Set(message.ids);
                    const hidden = (store.state.content.hidden ?? []).filter(id => !shown.has(id));
                    store.update({ content: { ...store.state.content, hidden } });
                    await this.refresh();
                }
                return;
            case 'autoLayout':
                store?.begin(message.only ? 'Arrange selection' : 'Arrange');
                await this.autoLayoutNow(message.only);
                return;
            case 'undo':
                await this.stepBack(true);
                return;
            case 'redo':
                await this.stepBack(false);
                return;
            case 'export':
                await this.exportDiagram(message.format);
                return;
            case 'raster': {
                const waiting = this.rasters.get(message.id);
                if (waiting) {
                    this.rasters.delete(message.id);
                    clearTimeout(waiting.timer);
                    if (message.data) {
                        waiting.resolve(Buffer.from(message.data, 'base64'));
                    } else {
                        waiting.reject(new Error(message.error ?? 'the panel could not draw it'));
                    }
                }
                return;
            }
            case 'selected':
                this.selected = new Set(message.ids);
                return;
        }
    }

    /**
     * Takes a view change back, or puts it back.
     *
     * Only the view: what the modeller typed is taken back in the editor, which
     * is the one place it can be. Dragging a class, bending a line, hiding
     * something, arranging the diagram and every option in the panel are view
     * changes; each of them is one step, however much of the file it rewrote.
     */
    async stepBack(backwards: boolean): Promise<void> {
        const store = this.store;
        if (!store) {
            return;
        }
        const content = store.state.content;
        const label = backwards ? store.undo() : store.redo();
        if (!label) {
            void vscode.window.setStatusBarMessage(`Nothing to ${backwards ? 'undo' : 'redo'}`, 2000);
            return;
        }
        // An arrangement still being computed belongs to the state just replaced.
        this.layoutRequest += 1;
        void vscode.window.setStatusBarMessage(`${backwards ? 'Undo' : 'Redo'}: ${label}`, 2000);
        if (store.state.content !== content) {
            // What is drawn changed, not only where it is: an element that was
            // hidden is not in the view model at all, so it has to be derived
            // again before it can be put back on the canvas.
            await this.refresh();
            return;
        }
        const reconciled = reconcile(store.state, this.view);
        this.positions = placeNewNodes(this.view, this.sizes(store.state.display), reconciled.placed);
        this.send();
    }

    /** Opens the declaration an element was written in, and puts the cursor on it. */
    private async reveal(id: string): Promise<void> {
        const node = this.view.nodes.find(candidate => candidate.id === id);
        const edge = this.view.edges.find(candidate => candidate.id === id);
        const location = node?.source ?? (edge && 'source_' in edge ? edge.source_ : undefined);
        if (!location) {
            return;
        }
        const document = await vscode.workspace.openTextDocument(vscode.Uri.parse(location.uri));
        const editor = await vscode.window.showTextDocument(document, {
            viewColumn: vscode.ViewColumn.One,
            preserveFocus: false
        });
        const range = new vscode.Range(location.line, location.character, location.endLine, location.endCharacter);
        editor.selection = new vscode.Selection(range.start, range.start);
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    }

    private selectAt(position: vscode.Position | undefined): void {
        if (!position || !this.document) {
            return;
        }
        const uri = this.document.uri.toString();
        const ids = idsAtSource(this.view, uri, position.line);
        this.selected = new Set(ids);
        this.post({ type: 'select', ids });
    }

    private html(): string {
        const webview = this.panel.webview;
        const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.js'))
            .with({ query: `v=${ASSET_VERSION}` });
        const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'canvas.css'))
            .with({ query: `v=${ASSET_VERSION}` });
        const nonce = nonceOf();
        return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link href="${style}" rel="stylesheet">
<title>Tonto diagram</title>
</head>
<body>
<div id="shell">
    <div id="toolbar">
        <span id="title" class="title"></span>
        <span id="stale" class="stale" hidden></span>
        <span class="spacer"></span>
        <button id="zoomOut" title="Zoom out">−</button>
        <span id="scale" class="scale">100%</span>
        <button id="zoomIn" title="Zoom in">+</button>
        <button id="fit" title="Fit to view">Fit</button>
        <button id="newWindow" class="icon-button" title="Move into a New Window" aria-label="Move into a New Window">
            <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M 9.5 2.5 H 13.5 V 6.5 M 13.5 2.5 L 7 9 M 11.5 8.5 V 13.5 H 2.5 V 4.5 H 7.5"></path>
            </svg>
        </button>
        <button id="arrange" title="Arrange the whole diagram automatically">Arrange</button>
        <button id="hide" title="Hide the selected classes or associations" disabled>Hide</button>
        <button id="optionsButton" title="What is drawn">⚙</button>
        <button id="exportButton" title="Export as SVG or PNG">Export</button>
    </div>
    <div id="options" class="panel" hidden></div>
    <div id="viewport">
        <div id="canvas"></div>
    </div>
    <div id="legend" class="legend" hidden></div>
</div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
    }

    dispose(): Promise<void> {
        this.disposal ??= this.disposeNow();
        return this.disposal;
    }

    private async disposeNow(): Promise<void> {
        DiagramPanel.current = undefined;
        this.generation += 1;
        vscode.commands.executeCommand('setContext', 'tontoVizOpen', false);
        clearTimeout(this.pending);
        const store = this.store;
        this.store = undefined;
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        await store?.dispose();
    }
}

function updateMode(): string {
    return vscode.workspace.getConfiguration('tonto.viz').get<string>('update') ?? 'onType';
}

function followsEditor(): boolean {
    return vscode.workspace.getConfiguration('tonto.viz').get<boolean>('followActiveEditor') ?? true;
}

function saveArrangement(): boolean {
    return vscode.workspace.getConfiguration('tonto.viz').get<boolean>('saveArrangement') ?? true;
}

function isDark(theme: vscode.ColorTheme): boolean {
    return theme.kind === vscode.ColorThemeKind.Dark || theme.kind === vscode.ColorThemeKind.HighContrast;
}

function nameOf(uri: vscode.Uri): string {
    return uri.path.slice(uri.path.lastIndexOf('/') + 1);
}

/**
 * The model is every `.tonto` file under its root, so the session is opened on
 * the folder rather than on the file: a relator two directories up is part of
 * what the diagram draws.
 */
function modelRootOf(uri: vscode.Uri): string {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (folder) {
        return folder.uri.fsPath;
    }
    const path = uri.fsPath;
    return path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')));
}

function nonceOf(): string {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 32 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}
