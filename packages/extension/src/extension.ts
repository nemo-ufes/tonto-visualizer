import * as vscode from 'vscode';
import { DiagramPanel } from './diagram-panel.js';

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
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
            await DiagramPanel.current?.exportSvg();
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
