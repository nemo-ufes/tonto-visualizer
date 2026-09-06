/**
 * The diagram, beside the text.
 *
 * One panel, following the editor. It holds the session that reads the model,
 * the arrangement that says where things are, and the webview that draws them;
 * everything else here is keeping those three in step as the model is typed.
 */

import * as vscode from 'vscode';
import type { DisplayOptions, ViewModel } from 'tonto-view';
import { derive, reconcile } from 'tonto-view';
import { ViewSession } from 'tonto-view/session';
import { autoLayout } from 'tonto-canvas';
import { darkTheme, lightTheme, placeNewNodes, render, sizeOf } from 'tonto-canvas/draw';
import type { FromPanel, Rect, ToPanel } from './protocol.js';
import { ViewStore } from './view-store.js';

const DEBOUNCE = 300;

export class DiagramPanel {
    static current: DiagramPanel | undefined;

    private readonly disposables: vscode.Disposable[] = [];
    private session: ViewSession | undefined;
    private store: ViewStore | undefined;
    private document: vscode.TextDocument | undefined;
    private view: ViewModel = { groups: [], nodes: [], edges: [], gensets: [] };
    private positions: Record<string, Rect> = {};
    private pending: NodeJS.Timeout | undefined;
    private ready = false;
    /** The last message built, so a panel that becomes ready late still gets it. */
    private last: ToPanel | undefined;

    private constructor(private readonly panel: vscode.WebviewPanel, private readonly extensionUri: vscode.Uri) {
        panel.webview.html = this.html();
        panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
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

    static async open(extensionUri: vscode.Uri, document: vscode.TextDocument): Promise<void> {
        if (DiagramPanel.current) {
            DiagramPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
            await DiagramPanel.current.show(document);
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
        await DiagramPanel.current.show(document);
    }

    /** Points the diagram at a document, loading its arrangement. */
    async show(document: vscode.TextDocument): Promise<void> {
        if (this.document === document) {
            this.schedule();
            return;
        }
        this.document = document;
        this.panel.title = `Diagram: ${nameOf(document.uri)}`;
        const folder = modelRootOf(document.uri);
        this.session = new ViewSession({ workspace: [folder] });
        this.store?.dispose();
        this.store = await ViewStore.open(document.uri, undefined, saveArrangement());
        await this.refresh();
    }

    async autoLayoutNow(only?: string[]): Promise<void> {
        const store = this.store;
        if (!store) {
            return;
        }
        const sizes = this.sizes(store.state.display);
        const laid = await autoLayout(this.view, sizes, this.positions, {
            grouped: store.state.display.showPackageGroups,
            ...(only ? { only } : {})
        });
        this.positions = laid.positions;
        store.move(Object.fromEntries(Object.entries(laid.positions).map(([id, rect]) => [id, rect])));
        for (const [id, points] of Object.entries(laid.routes)) {
            store.reroute(id, { points });
        }
        this.send();
    }

    async exportSvg(): Promise<void> {
        const store = this.store;
        if (!store || !this.document) {
            return;
        }
        const target = await vscode.window.showSaveDialog({
            defaultUri: this.document.uri.with({ path: this.document.uri.path.replace(/\.tonto$/, '.svg') }),
            filters: { SVG: ['svg'] }
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
        await vscode.workspace.fs.writeFile(target, Buffer.from(drawn.svg, 'utf8'));
        vscode.window.showInformationMessage(`Diagram written to ${target.fsPath}`);
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
    private async refresh(): Promise<void> {
        const session = this.session;
        const store = this.store;
        const document = this.document;
        if (!session || !store || !document) {
            return;
        }

        await session.update(document.uri.toString(), document.getText());
        const errors = await session.parseErrors(document.uri.toString());
        if (errors.length > 0 && this.view.nodes.length > 0) {
            this.send(errors[0]);
            return;
        }

        const models = await session.models();
        this.view = derive({
            models,
            documentation: session.documentation(),
            options: store.state.content
        });

        const reconciled = reconcile(store.state, this.view);
        const sizes = this.sizes(store.state.display);
        const placed = placeNewNodes(this.view, sizes, reconciled.placed);
        const isFirstDraw = Object.keys(reconciled.placed).length === 0 && this.view.nodes.length > 0;
        this.positions = placed;
        if (isFirstDraw) {
            // Nothing has been arranged yet, so this is the one time the diagram
            // may lay itself out completely.
            await this.autoLayoutNow();
            return;
        }
        this.send(errors[0]);
    }

    private sizes(display: DisplayOptions): Record<string, { width: number; height: number }> {
        return Object.fromEntries(this.view.nodes.map(node => [node.id, sizeOf(node, display)]));
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
            content: store.state.content,
            packages: [...new Set(this.view.nodes.map(node => node.package ?? ''))].filter(Boolean).sort(),
            title: this.document ? nameOf(this.document.uri) : 'Tonto',
            ...(stale ? { stale } : {})
        };
        this.last = message;
        this.post(message);
    }

    private post(message: ToPanel): void {
        if (this.ready) {
            void this.panel.webview.postMessage(message);
        }
    }

    private async receive(message: FromPanel): Promise<void> {
        const store = this.store;
        switch (message.type) {
            case 'ready':
                this.ready = true;
                this.post({ type: 'theme', dark: isDark(vscode.window.activeColorTheme) });
                if (this.last) {
                    void this.panel.webview.postMessage(this.last);
                }
                return;
            case 'moved':
                if (!store) {
                    return;
                }
                store.move(message.positions);
                for (const [id, placement] of Object.entries(message.positions)) {
                    const current = this.positions[id];
                    this.positions[id] = {
                        x: placement.x,
                        y: placement.y,
                        width: placement.width ?? current?.width ?? 160,
                        height: placement.height ?? current?.height ?? 60
                    };
                }
                // A route belongs to the two boxes it joins. Once one of them has
                // moved, the line someone drew no longer goes where they drew it,
                // so it is dropped and the edge routes itself again.
                for (const edge of message.rerouted) {
                    store.reroute(edge, undefined);
                }
                return;
            case 'rerouted':
                store?.reroute(message.edge, message.route);
                return;
            case 'reveal':
                await this.reveal(message.id);
                return;
            case 'display':
                if (store) {
                    store.update({ display: { ...store.state.display, ...message.display } });
                    this.send();
                }
                return;
            case 'content':
                if (store) {
                    store.update({ content: { ...store.state.content, ...message.content } });
                    await this.refresh();
                }
                return;
            case 'hide':
                if (store) {
                    const hidden = new Set([...(store.state.content.hidden ?? []), ...message.ids]);
                    store.update({ content: { ...store.state.content, hidden: [...hidden] } });
                    await this.refresh();
                }
                return;
            case 'show':
                if (store) {
                    const shown = new Set(message.ids);
                    const hidden = (store.state.content.hidden ?? []).filter(id => !shown.has(id));
                    store.update({ content: { ...store.state.content, hidden } });
                    await this.refresh();
                }
                return;
            case 'autoLayout':
                await this.autoLayoutNow(message.only);
                return;
            case 'export':
                await this.exportSvg();
                return;
            case 'selected':
                return;
        }
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
        const ids = this.view.nodes
            .filter(node => node.source
                && node.source.uri === uri
                && position.line >= node.source.line
                && position.line <= node.source.endLine)
            .map(node => node.id);
        this.post({ type: 'select', ids });
    }

    private html(): string {
        const webview = this.panel.webview;
        const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'out', 'webview.js'));
        const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'canvas.css'));
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
        <button id="arrange" title="Arrange the whole diagram automatically">Arrange</button>
        <button id="optionsButton" title="What is drawn">⚙</button>
        <button id="exportButton" title="Export as SVG">Export</button>
    </div>
    <div id="options" class="panel" hidden></div>
    <div id="viewport">
        <div id="canvas"></div>
    </div>
    <div id="legend" class="legend" hidden></div>
    <div id="hint" class="hint">Drag to move · double-click to open the declaration · scroll to zoom</div>
</div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
    }

    dispose(): void {
        DiagramPanel.current = undefined;
        vscode.commands.executeCommand('setContext', 'tontoVizOpen', false);
        clearTimeout(this.pending);
        this.store?.dispose();
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
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
