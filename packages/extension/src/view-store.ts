/**
 * The `.tontoview` file: read when a diagram opens, written after the modeller
 * changes the automatically produced view.
 *
 * In the model's `views` directory rather than in the extension's storage,
 * because an arrangement is part of the work: it belongs in the repository
 * with the model it explains, where a co-author gets it by pulling and a
 * reviewer sees it in a diff. An untouched automatic arrangement is not work to
 * persist, so neither the directory nor the file is made until a user action
 * changes it.
 *
 * The store also keeps what the arrangement was, so a view change can be taken
 * back. The history lives here rather than in the panel for the same reason the
 * state does: a webview is disposed and rebuilt whenever the panel is hidden,
 * and an arrangement whose history went with it would let a modeller drag
 * something, switch tab, come back, and find there was nothing to undo.
 */

import * as vscode from 'vscode';
import type { EdgeRoute, Placement, ViewFile } from 'tonto-view';
import { emptyViewFile, readViewFile } from 'tonto-view';

/** How far back a view can be taken. Each entry is a whole `ViewFile`. */
const HISTORY = 100;

interface Step {
    /** What the modeller did, to say what is being undone. */
    label: string;
    /** The arrangement as it was before they did it. */
    file: ViewFile;
}

export class ViewStore {
    private file: ViewFile;
    private readonly done: Step[] = [];
    private readonly undone: Step[] = [];
    /**
     * The step being built, if one was opened.
     *
     * One action by the modeller is one step however many changes it makes:
     * arranging the diagram moves every class and drops every route, and taking
     * that back one class at a time would be no use to anybody.
     */
    private step: Step | undefined;
    private saving: NodeJS.Timeout | undefined;
    private dirty = false;
    /** Serializes snapshots so an older, slower write cannot overwrite a newer one. */
    private writes: Promise<void> = Promise.resolve();
    private disposal: Promise<void> | undefined;

    private constructor(private uri: vscode.Uri, file: ViewFile, private enabled: boolean) {
        this.file = file;
    }

    static async open(
        modelUri: vscode.Uri, focus: string | undefined, enabled: boolean,
        uri: vscode.Uri = viewUriFor(modelUri)
    ): Promise<ViewStore> {
        let bytes: Uint8Array | undefined;
        try {
            bytes = await vscode.workspace.fs.readFile(uri);
        } catch {
            // Files written before views had their own directory remain
            // readable. The store still targets the new URI, so the first
            // deliberate edit migrates the view without touching the old file.
            const name = viewNameFor(modelUri, uri);
            if (uri.path === viewUriFor(modelUri, name).path) {
                try {
                    bytes = await vscode.workspace.fs.readFile(legacyViewUriFor(modelUri, name));
                } catch {
                    // No saved view yet is the ordinary first-open case.
                }
            }
        }
        if (bytes) {
            try {
                return new ViewStore(uri, readViewFile(JSON.parse(Buffer.from(bytes).toString('utf8'))), enabled);
            } catch {
                // A broken file must not prevent the diagram from opening. It
                // remains untouched until a deliberate edit replaces it.
            }
        }
        return new ViewStore(uri, emptyViewFile(focus), enabled);
    }

    get state(): ViewFile {
        return this.file;
    }

    get location(): vscode.Uri {
        return this.uri;
    }

    /**
     * Writes from now on go to where the file was moved. Its model was
     * renamed and the file went with it; a store still writing to the old
     * name would put the arrangement back beside a model that is not there.
     */
    relocate(uri: vscode.Uri): void {
        this.uri = uri;
    }

    /** Copies the current view deliberately, even when automatic saving is off. */
    async copyTo(uri: vscode.Uri): Promise<void> {
        await this.write();
        const text = JSON.stringify(this.file, undefined, 2) + '\n';
        await writeViewFile(uri, Buffer.from(text, 'utf8'));
    }

    /**
     * Opens a step: everything changed until the next one is undone together.
     *
     * A change made without one is not recorded at all. That is deliberate --
     * the only changes made outside a step are the ones the model forced, like
     * dropping the route of a relation whose class has just been given another
     * attribute and grown. Recording those would put entries in the history
     * that undo nothing the modeller can see, and the edit that caused them is
     * taken back in the editor rather than here.
     */
    begin(label: string): void {
        this.step = { label, file: this.file };
    }

    move(positions: Record<string, Placement>): void {
        const userChanged = this.record();
        this.file = { ...this.file, nodes: { ...this.file.nodes, ...positions } };
        if (userChanged || this.dirty) {
            this.schedule();
        }
    }

    reroute(edge: string, route: EdgeRoute | undefined): void {
        const userChanged = this.record();
        if (route) {
            this.file = { ...this.file, edges: { ...this.file.edges, [edge]: route } };
        } else {
            const { [edge]: _dropped, ...rest } = this.file.edges;
            this.file = { ...this.file, edges: rest };
        }
        if (userChanged || this.dirty) {
            this.schedule();
        }
    }

    update(patch: Partial<Pick<ViewFile, 'content' | 'display' | 'layout' | 'constraints'>>): void {
        const userChanged = this.record();
        this.file = { ...this.file, ...patch };
        if (userChanged || this.dirty) {
            this.schedule();
        }
    }

    /** What the next undo would take back, and the next redo would put back. */
    get history(): { undo: string | undefined; redo: string | undefined } {
        return { undo: this.done.at(-1)?.label, redo: this.undone.at(-1)?.label };
    }

    /** Takes back the last step, and says what it was. */
    undo(): string | undefined {
        return this.swap(this.done, this.undone);
    }

    /** Puts back the last step taken back, and says what it was. */
    redo(): string | undefined {
        return this.swap(this.undone, this.done);
    }

    private swap(from: Step[], to: Step[]): string | undefined {
        const step = from.pop();
        if (!step) {
            return undefined;
        }
        // A step going the other way is the state it is leaving, under the same
        // name: undoing a move and redoing it are both "Move".
        to.push({ label: step.label, file: this.file });
        this.file = step.file;
        this.step = undefined;
        this.schedule();
        return step.label;
    }

    /** Closes the open step, if the change about to be made is the first in it. */
    private record(): boolean {
        if (!this.step) {
            return false;
        }
        this.done.push(this.step);
        this.step = undefined;
        if (this.done.length > HISTORY) {
            this.done.shift();
        }
        // Anything taken back is only on offer until something else is done;
        // a history that branches is one nobody can hold in their head.
        this.undone.length = 0;
        return true;
    }

    /**
     * Writes are debounced: a drag is a few hundred pointer events, and each one
     * would otherwise be a file write and a git-visible change.
     */
    private schedule(): void {
        if (!this.enabled) {
            return;
        }
        this.dirty = true;
        clearTimeout(this.saving);
        this.saving = setTimeout(() => {
            void this.write().catch(error => {
                const message = error instanceof Error ? error.message : String(error);
                void vscode.window.showErrorMessage(`Could not save the diagram arrangement: ${message}`);
            });
        }, 600);
    }

    async write(): Promise<void> {
        clearTimeout(this.saving);
        this.saving = undefined;
        if (!this.enabled || !this.dirty) {
            await this.writes;
            return;
        }
        const text = JSON.stringify(this.file, undefined, 2) + '\n';
        this.dirty = false;
        const write = this.writes.then(async () => {
            await writeViewFile(this.uri, Buffer.from(text, 'utf8'));
        });
        // Keep the queue usable after a reported write failure; callers still
        // receive the original rejection from `write`.
        this.writes = write.catch(() => undefined);
        try {
            await write;
        } catch (error) {
            this.dirty = true;
            throw error;
        }
    }

    dispose(): Promise<void> {
        this.disposal ??= this.flush();
        return this.disposal;
    }

    private async flush(): Promise<void> {
        clearTimeout(this.saving);
        this.saving = undefined;
        await this.write();
    }
}

export interface ViewChoice {
    label: string;
    description: string;
    uri: vscode.Uri;
}

/** `Person.tonto` has `views/Person.tontoview` and `views/Person.roles.tontoview`. */
export function viewUriFor(modelUri: vscode.Uri, name?: string): vscode.Uri {
    const suffix = name ? `.${name}.tontoview` : '.tontoview';
    const slash = modelUri.path.lastIndexOf('/');
    const directory = modelUri.path.slice(0, slash + 1);
    const stem = modelUri.path.slice(slash + 1).replace(/\.tonto$/i, '');
    return modelUri.with({ path: `${directory}views/${stem}${suffix}` });
}

/** The sibling location used before view files moved into `views`. */
function legacyViewUriFor(modelUri: vscode.Uri, name?: string): vscode.Uri {
    const suffix = name ? `.${name}.tontoview` : '.tontoview';
    return modelUri.with({ path: modelUri.path.replace(/\.tonto$/i, '') + suffix });
}

/** A filesystem-safe, stable identifier; presentation can put the spaces back. */
export function viewNameOf(value: string): string | undefined {
    const name = value.trim().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return name || undefined;
}

/**
 * The name a view file carries for one model, or nothing when it is not a
 * named view of it.
 *
 * A dot in what is left between the stem and `.tontoview` says the file belongs
 * to another model: `employment.v2.roles.tontoview` is the roles view of
 * `employment.v2.tonto`, and beside `employment.tonto` it reads as a view named
 * `v2.roles`. `viewNameOf` writes no dots, so the two are told apart outright
 * rather than guessed at. The default view has nothing between them and is not
 * a named view either.
 */
export function viewNameBetween(stem: string, file: string): string | undefined {
    const prefix = `${stem}.`;
    const suffix = '.tontoview';
    if (!file.startsWith(prefix) || !file.endsWith(suffix)) {
        return undefined;
    }
    const name = file.slice(prefix.length, -suffix.length);
    return name && !name.includes('.') ? name : undefined;
}

/** The name encoded in a current or legacy view URI, or undefined for the default view. */
export function viewNameFor(modelUri: vscode.Uri, viewUri: vscode.Uri): string | undefined {
    // Whole paths, so a file of the same name in another directory is not one
    // of this model's views. A dot in the directory is part of the stem, and
    // only what follows it is the name.
    for (const named of [viewUriFor(modelUri, ''), legacyViewUriFor(modelUri, '')]) {
        const name = viewNameBetween(named.path.replace(/\.tontoview$/, ''), viewUri.path);
        if (name) {
            return name;
        }
    }
    return undefined;
}

/**
 * The arrangement a document opens in.
 *
 * `showing` is what the panel has open, and counts only while it is the same
 * document: returning to the editor from the webview fires the active-editor
 * listener, and that must not replace a named view with the default one.
 * `seen` is where each document was last left, so following the editor to
 * another model and back keeps the named view too.
 */
export function viewToShow(
    modelUri: vscode.Uri,
    requested: vscode.Uri | undefined,
    showing: { document: vscode.Uri; view: vscode.Uri } | undefined,
    seen: ReadonlyMap<string, vscode.Uri>
): vscode.Uri {
    if (requested) {
        return requested;
    }
    if (showing && showing.document.toString() === modelUri.toString()) {
        return showing.view;
    }
    return seen.get(modelUri.toString()) ?? viewUriFor(modelUri);
}

/** Finds only views whose filename identifies this exact model. */
export async function viewChoicesFor(modelUri: vscode.Uri): Promise<ViewChoice[]> {
    const slash = modelUri.path.lastIndexOf('/');
    const parentPath = modelUri.path.slice(0, slash + 1);
    const directory = modelUri.with({ path: parentPath });
    const viewsDirectory = modelUri.with({ path: `${parentPath}views` });
    const modelFile = modelUri.path.slice(slash + 1);
    const stem = modelFile.replace(/\.tonto$/i, '');
    let entries: [string, vscode.FileType][] = [];
    let legacyEntries: [string, vscode.FileType][] = [];
    try {
        entries = await vscode.workspace.fs.readDirectory(viewsDirectory);
    } catch {
        // The default view can still be opened in an untitled or virtual
        // workspace whose directory cannot be enumerated.
    }
    try {
        legacyEntries = await vscode.workspace.fs.readDirectory(directory);
    } catch {
        // Legacy discovery is best effort and can disappear after migration.
    }
    // A model of its own claims its default view: `employment.v2.tontoview` is
    // what `employment.v2.tonto` is arranged in, and only otherwise what a view
    // of `employment.tonto` named `v2` would be called. The names collide by
    // construction, and the directory says which of the two is meant.
    const models = new Set(legacyEntries
        .filter(([, type]) => type === vscode.FileType.File)
        .map(([file]) => file.toLowerCase())
        .filter(file => file.endsWith('.tonto')));
    const names = new Set([...entries, ...legacyEntries].flatMap(([file, type]) => {
        const found = type === vscode.FileType.File ? viewNameBetween(stem, file) : undefined;
        return found && !models.has(`${stem}.${found}.tonto`.toLowerCase()) ? [found] : [];
    }));
    const named = [...names]
        .map(name => ({
            label: labelOfView(name),
            description: `views/${stem}.${name}.tontoview`,
            uri: viewUriFor(modelUri, name)
        }))
        .sort((left, right) => left.label.localeCompare(right.label));
    return [{
        label: 'Default view',
        description: `views/${stem}.tontoview`,
        uri: viewUriFor(modelUri)
    }, ...named];
}

async function writeViewFile(uri: vscode.Uri, bytes: Uint8Array): Promise<void> {
    const slash = uri.path.lastIndexOf('/');
    await vscode.workspace.fs.createDirectory(uri.with({ path: uri.path.slice(0, slash || 1) }));
    await vscode.workspace.fs.writeFile(uri, bytes);
}

export async function viewFileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        const marker = '/views/';
        const at = uri.path.lastIndexOf(marker);
        if (at < 0) {
            return false;
        }
        try {
            await vscode.workspace.fs.stat(uri.with({
                path: `${uri.path.slice(0, at)}/${uri.path.slice(at + marker.length)}`
            }));
            return true;
        } catch {
            return false;
        }
    }
}

export function labelOfView(name: string): string {
    return name.replace(/[-_]+/g, ' ');
}
