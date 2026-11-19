/**
 * Renames carried into the view files that are not open.
 *
 * The open view follows a rename through its store. Every other view of the
 * model -- a named view of the same file, the view of another file in which
 * the class is drawn as an external reference, the workspace's class diagram
 * -- names the class by the same qualified id, and kept the old one: the next
 * time it was opened the class was placed again as if new.
 *
 * Queued and written a moment after the last rename rather than at each,
 * since typing a new name over an old one is a rename per keystroke, and a
 * write per keystroke to every view in the workspace is a lot of churn for a
 * name that is not finished yet. Applied in order, so `Person` -> `Perso` ->
 * `Human` arrives as `Human`.
 */

import * as vscode from 'vscode';
import type { Renames } from 'tonto-view';
import { renameInRawViewFile } from 'tonto-view';

/** How long after the last rename the views are written. */
const SETTLE = 1000;

interface Pending {
    renames: Renames;
    /**
     * The directories views of the model can be in: each model file's own,
     * where views were kept before they had a folder, its `views`, and the
     * workspace diagram's. Listed rather than searched, so a model outside
     * any workspace folder is covered too.
     */
    directories: vscode.Uri[];
    /** The view that was open, which its store has already renamed. */
    open: vscode.Uri;
}

export class ViewRenames {
    private pending: Pending[] = [];
    private timer: NodeJS.Timeout | undefined;
    private writes: Promise<void> = Promise.resolve();

    add(renames: Renames, directories: vscode.Uri[], open: vscode.Uri): void {
        this.pending.push({ renames, directories, open });
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.flush(), SETTLE);
    }

    /**
     * Writes what is queued, and waits for it.
     *
     * Called before another view is opened as well as on the timer: a store
     * that read its file before a queued rename reached it would hold the old
     * names, and write them back over the renamed file on its first save.
     */
    flush(): Promise<void> {
        clearTimeout(this.timer);
        this.timer = undefined;
        const pending = this.pending;
        this.pending = [];
        if (pending.length === 0) {
            return this.writes;
        }
        const write = this.writes.then(() => apply(pending));
        this.writes = write.catch(error => {
            const message = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(`Could not carry a rename into the other diagram views: ${message}`);
        });
        return this.writes;
    }
}

async function apply(pending: readonly Pending[]): Promise<void> {
    const listed = new Map<string, vscode.Uri[]>();
    const viewsIn = async (directory: vscode.Uri) => {
        const key = directory.toString();
        if (!listed.has(key)) {
            listed.set(key, await viewFilesIn(directory));
        }
        return listed.get(key)!;
    };
    // Each file is read once and written once, whatever number of renames
    // reached it, so the steps of one name being typed are one write.
    const files = new Map<string, { uri: vscode.Uri; raw: unknown; changed: boolean }>();
    for (const { renames, directories, open } of pending) {
        // A directory named twice -- two models side by side -- is still one
        // rename for each file in it.
        const reached = new Map<string, vscode.Uri>();
        for (const directory of directories) {
            for (const uri of await viewsIn(directory)) {
                reached.set(uri.toString(), uri);
            }
        }
        reached.delete(open.toString());
        for (const [key, uri] of reached) {
            let file = files.get(key);
            if (!file) {
                file = { uri, raw: await readJson(uri), changed: false };
                files.set(key, file);
            }
            const renamed = renameInRawViewFile(file.raw, renames);
            if (renamed) {
                file.raw = renamed;
                file.changed = true;
            }
        }
    }
    for (const { uri, raw, changed } of files.values()) {
        if (changed) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(raw, undefined, 2) + '\n', 'utf8'));
        }
    }
}

async function viewFilesIn(directory: vscode.Uri): Promise<vscode.Uri[]> {
    try {
        return (await vscode.workspace.fs.readDirectory(directory))
            .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.tontoview'))
            .map(([name]) => vscode.Uri.joinPath(directory, name));
    } catch {
        // No `views` folder yet is the ordinary case.
        return [];
    }
}

/** A file that cannot be read as JSON is left alone, as the store leaves it. */
async function readJson(uri: vscode.Uri): Promise<unknown> {
    try {
        return JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf8'));
    } catch {
        return undefined;
    }
}
