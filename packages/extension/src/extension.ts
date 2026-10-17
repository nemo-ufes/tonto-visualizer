import * as vscode from 'vscode';
import { DiagramPanel } from './diagram-panel.js';
import type { ViewMove } from './rename.js';
import { viewRenamesFor } from './rename.js';

export function activate(context: vscode.ExtensionContext): void {
    // What the last rename moved, from the edit that moved it to the panel
    // that has to follow; the two events of one rename arrive in order.
    let moved: ViewMove[] = [];
    context.subscriptions.push(
        // Part of the rename's own edit, not a second operation after it: the
        // views move with the model in one step, and one undo puts both back.
        vscode.workspace.onWillRenameFiles(event => {
            event.waitUntil((async () => {
                await DiagramPanel.current?.flushView();
                const edit = new vscode.WorkspaceEdit();
                const plans = await Promise.all(event.files.map(file => viewRenamesFor(file.oldUri, file.newUri)));
                moved = plans.flatMap(plan => plan.moves);
                for (const move of moved) {
                    edit.renameFile(move.from, move.to, { overwrite: false, ignoreIfExists: true });
                }
                const blocked = plans.flatMap(plan => plan.blocked);
                if (blocked.length > 0) {
                    void vscode.window.showWarningMessage(
                        `Left ${blocked.map(uri => uri.path.slice(uri.path.lastIndexOf('/') + 1)).join(', ')} `
                        + 'where it is: a view of that name already exists for the new model name.');
                }
                return edit;
            })());
        }),
        vscode.workspace.onDidRenameFiles(event => {
            const followed = moved;
            moved = [];
            void DiagramPanel.current?.followRename(event.files, followed);
        }),
        vscode.commands.registerCommand('tonto.viz.open', async (resource?: vscode.Uri) => {
            const document = resource
                ? await vscode.workspace.openTextDocument(resource)
                : vscode.window.activeTextEditor?.document;
            if (!document || document.languageId !== 'tonto') {
                vscode.window.showErrorMessage('Open a .tonto file to draw it.');
                return;
            }
            await DiagramPanel.open(context.extensionUri, document);
        }),
        vscode.commands.registerCommand('tonto.viz.autoLayout', async () => {
            await DiagramPanel.current?.autoLayoutSelectedOrAll();
        }),
        vscode.commands.registerCommand('tonto.viz.exportSvg', async () => {
            await DiagramPanel.current?.exportDiagram('svg');
        }),
        vscode.commands.registerCommand('tonto.viz.exportPng', async () => {
            await DiagramPanel.current?.exportDiagram('png');
        }),
        vscode.commands.registerCommand('tonto.viz.openView', async () => {
            if (!DiagramPanel.current) {
                vscode.window.showErrorMessage('Open a Tonto diagram before choosing a view.');
                return;
            }
            await DiagramPanel.current.chooseView();
        }),
        vscode.commands.registerCommand('tonto.viz.saveNamedView', async () => {
            if (!DiagramPanel.current) {
                vscode.window.showErrorMessage('Open a Tonto diagram before saving a named view.');
                return;
            }
            await DiagramPanel.current.saveAsNamedView();
        }),
        // The panel binds these to its own keys as well: a webview only sees a
        // keystroke while it has focus, and the palette is where a modeller
        // looks when it does not.
        vscode.commands.registerCommand('tonto.viz.undo', async () => {
            await DiagramPanel.current?.stepBack(true);
        }),
        vscode.commands.registerCommand('tonto.viz.redo', async () => {
            await DiagramPanel.current?.stepBack(false);
        })
    );
}

export async function deactivate(): Promise<void> {
    await DiagramPanel.current?.dispose();
}
