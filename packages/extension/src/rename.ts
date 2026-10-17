/**
 * The view files a model rename has to take along.
 *
 * A view names its model by filename -- `views/Person.tontoview` and
 * `views/Person.roles.tontoview` belong to `Person.tonto` -- so renaming the
 * model without them leaves every arrangement orphaned: the diagram reopens
 * laid out from scratch and the old files sit unclaimed in `views`. Moving a
 * whole folder needs nothing, since `views` moves with it; renaming or moving
 * one model does.
 *
 * Planned here and applied by the caller as part of the rename's own
 * workspace edit, so undoing the rename undoes this too.
 */

import * as vscode from 'vscode';
import { viewUriFor } from './view-store.js';

export interface ViewMove {
    from: vscode.Uri;
    to: vscode.Uri;
}

export interface ViewRenamePlan {
    moves: ViewMove[];
    /** Views left where they are, because their new name is already taken. */
    blocked: vscode.Uri[];
}

const MODEL = /\.tonto$/i;
const VIEW = '.tontoview';

export async function viewRenamesFor(oldUri: vscode.Uri, newUri: vscode.Uri): Promise<ViewRenamePlan> {
    const plan: ViewRenamePlan = { moves: [], blocked: [] };
    // A model renamed to something that is not a model has no views to
    // keep; they stay beside the name they were made for.
    if (!MODEL.test(oldUri.path) || !MODEL.test(newUri.path) || !await isFile(oldUri)) {
        return plan;
    }
    const slash = oldUri.path.lastIndexOf('/');
    const parent = oldUri.path.slice(0, slash + 1);
    const stem = oldUri.path.slice(slash + 1).replace(MODEL, '');
    const siblings = await namesIn(oldUri.with({ path: parent }));
    const sources = [
        ...(await namesIn(oldUri.with({ path: `${parent}views` })))
            .map(file => ({ file, uri: oldUri.with({ path: `${parent}views/${file}` }) })),
        // Views from before they had a folder of their own are moved into
        // it: that is where the first deliberate edit would have put them.
        ...siblings.map(file => ({ file, uri: oldUri.with({ path: `${parent}${file}` }) }))
    ];
    const models = new Set(siblings.filter(file => MODEL.test(file)).map(file => file.toLowerCase()));
    const claimed = new Set<string>();
    for (const { file, uri } of sources) {
        const name = viewNameIn(file, stem);
        if (name === null) {
            continue;
        }
        // `a.roles.tontoview` is a view of `a.tonto` named "roles" -- unless
        // `a.roles.tonto` exists, whose default view it then is.
        if (name !== undefined && models.has(`${stem}.${name}.tonto`.toLowerCase())) {
            continue;
        }
        const to = viewUriFor(newUri, name);
        if (to.path === uri.path) {
            continue;
        }
        // The view folder and a legacy sibling can both hold a view of one
        // name; the folder's is the one that is read, and listed first, so
        // it alone moves.
        if (claimed.has(to.path)) {
            continue;
        }
        // On a case-insensitive disk `Person` -> `person` finds its own
        // view at the new name; that is the file being moved, not a clash.
        const sameFile = to.path.toLowerCase() === uri.path.toLowerCase();
        if (!sameFile && await exists(to)) {
            plan.blocked.push(uri);
            continue;
        }
        claimed.add(to.path);
        plan.moves.push({ from: uri, to });
    }
    return plan;
}

/**
 * The view name a filename gives, `undefined` for the default view, or `null`
 * when the file is not a view of `stem` at all. A named view's name has no
 * dots -- `viewNameOf` turns them into hyphens -- so `a.x.y.tontoview` is
 * never a view of `a`.
 */
export function viewNameIn(file: string, stem: string): string | undefined | null {
    if (!file.endsWith(VIEW) || !file.startsWith(stem)) {
        return null;
    }
    const rest = file.slice(stem.length, -VIEW.length);
    if (rest === '') {
        return undefined;
    }
    return rest.startsWith('.') && rest.length > 1 && !rest.slice(1).includes('.') ? rest.slice(1) : null;
}

async function namesIn(directory: vscode.Uri): Promise<string[]> {
    try {
        return (await vscode.workspace.fs.readDirectory(directory))
            .filter(([, type]) => type === vscode.FileType.File)
            .map(([file]) => file);
    } catch {
        return [];
    }
}

async function isFile(uri: vscode.Uri): Promise<boolean> {
    try {
        return (await vscode.workspace.fs.stat(uri)).type === vscode.FileType.File;
    } catch {
        return false;
    }
}

async function exists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}
