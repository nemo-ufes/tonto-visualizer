/**
 * The `.tontoview` file: read when a diagram opens, written when it moves.
 *
 * Beside the model rather than in the extension's storage, because an
 * arrangement is part of the work: it belongs in the repository with the model
 * it explains, where a co-author gets it by pulling and a reviewer sees it in a
 * diff.
 */

import * as vscode from 'vscode';
import type { EdgeRoute, Placement, ViewFile } from 'tonto-view';
import { emptyViewFile, readViewFile } from 'tonto-view';

export class ViewStore {
    private file: ViewFile;
    private saving: NodeJS.Timeout | undefined;

    private constructor(private readonly uri: vscode.Uri, file: ViewFile, private enabled: boolean) {
        this.file = file;
    }

    static async open(modelUri: vscode.Uri, focus: string | undefined, enabled: boolean): Promise<ViewStore> {
        const uri = viewUriFor(modelUri);
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            return new ViewStore(uri, readViewFile(JSON.parse(Buffer.from(bytes).toString('utf8'))), enabled);
        } catch {
            // No file, or one that is not JSON any more. Either way the diagram
            // opens; what it cannot do is overwrite something it failed to read,
            // so a broken file is left alone until the first deliberate move.
            return new ViewStore(uri, emptyViewFile(focus), enabled);
        }
    }

    get state(): ViewFile {
        return this.file;
    }

    move(positions: Record<string, Placement>): void {
        this.file.nodes = { ...this.file.nodes, ...positions };
        this.schedule();
    }

    reroute(edge: string, route: EdgeRoute | undefined): void {
        if (route) {
            this.file.edges = { ...this.file.edges, [edge]: route };
        } else {
            const { [edge]: _dropped, ...rest } = this.file.edges;
            this.file.edges = rest;
        }
        this.schedule();
    }

    update(patch: Partial<Pick<ViewFile, 'content' | 'display'>>): void {
        this.file = { ...this.file, ...patch };
        this.schedule();
    }

    /**
     * Writes are debounced: a drag is a few hundred pointer events, and each one
     * would otherwise be a file write and a git-visible change.
     */
    private schedule(): void {
        if (!this.enabled) {
            return;
        }
        clearTimeout(this.saving);
        this.saving = setTimeout(() => void this.write(), 600);
    }

    async write(): Promise<void> {
        const text = JSON.stringify(this.file, undefined, 2) + '\n';
        await vscode.workspace.fs.writeFile(this.uri, Buffer.from(text, 'utf8'));
    }

    dispose(): void {
        clearTimeout(this.saving);
    }
}

/** `Person.tonto` is arranged in `Person.tontoview`, beside it. */
export function viewUriFor(modelUri: vscode.Uri): vscode.Uri {
    return modelUri.with({ path: modelUri.path.replace(/\.tonto$/, '') + '.tontoview' });
}
