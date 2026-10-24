/**
 * Locks the editor group a newly opened diagram sits in.
 *
 * VS Code opens a file clicked in the Explorer in the active editor group, and
 * after a click on the canvas that group is the diagram's: the file covered the
 * diagram it was meant to be read beside. A locked group is passed over when
 * VS Code picks where to open something, so the file lands next to it instead.
 *
 * `workbench.editor.autoLockGroups` would do this without code, but its schema
 * only admits editors VS Code knows by name, and an extension's webview panel
 * is not one of them. The lock command acts on the active group only, so the
 * panel holds focus for the moment the lock takes and then hands it back.
 */

import * as vscode from 'vscode';

const DIAGRAM_VIEW_TYPE = 'tontoDiagram';
/** How long to wait for VS Code to report the panel's tab, or its focus. */
const SETTLE_TIMEOUT = 1000;
/** VS Code names a focus command for the first eight groups only. */
const FOCUS_GROUP_COMMANDS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth']
    .map(ordinal => `workbench.action.focus${ordinal}EditorGroup`);

export async function lockDiagramGroup(panel: vscode.WebviewPanel): Promise<void> {
    try {
        const group = await settled(() => groupOfDiagram(), [
            vscode.window.tabGroups.onDidChangeTabs, vscode.window.tabGroups.onDidChangeTabGroups
        ]);
        // VS Code's own auto-lock rule: lock a group the diagram opened alone,
        // never one already holding the modeller's files, and never the only
        // group, where the lock would push every file into a new split.
        if (!group || group.tabs.length !== 1 || vscode.window.tabGroups.all.length < 2) {
            return;
        }
        const previous = vscode.window.tabGroups.activeTabGroup.viewColumn;
        // Ask the tab groups, not `panel.active`: a new panel reports itself
        // active before any focus has moved, and trusting that locked the
        // group the modeller was typing in.
        if (!group.isActive) {
            panel.reveal(group.viewColumn, false);
            const focused = await settled(() => groupOfDiagram()?.isActive || undefined, [
                vscode.window.tabGroups.onDidChangeTabGroups, vscode.window.tabGroups.onDidChangeTabs,
                panel.onDidChangeViewState
            ]);
            if (!focused || vscode.window.tabGroups.activeTabGroup.viewColumn !== group.viewColumn) {
                return;
            }
        }
        await vscode.commands.executeCommand('workbench.action.lockEditorGroup');
        const focusPrevious = FOCUS_GROUP_COMMANDS[previous - 1];
        if (previous !== group.viewColumn && focusPrevious) {
            await vscode.commands.executeCommand(focusPrevious);
        }
    } catch {
        // An unlocked diagram is the behaviour before this existed, not a
        // reason to fail opening it.
    }
}

function groupOfDiagram(): vscode.TabGroup | undefined {
    return vscode.window.tabGroups.all.find(group => group.tabs.some(tab =>
        tab.input instanceof vscode.TabInputWebview && tab.input.viewType.endsWith(DIAGRAM_VIEW_TYPE)));
}

/** `read()` once it has a value, re-read on each event, or `undefined` after the timeout. */
function settled<T>(read: () => T | undefined, events: readonly vscode.Event<unknown>[]): Promise<T | undefined> {
    const now = read();
    if (now !== undefined) {
        return Promise.resolve(now);
    }
    return new Promise(resolve => {
        let done = false;
        const subscriptions: vscode.Disposable[] = [];
        const finish = (value: T | undefined) => {
            if (done) {
                return;
            }
            done = true;
            clearTimeout(timer);
            subscriptions.forEach(subscription => subscription.dispose());
            resolve(value);
        };
        const timer = setTimeout(() => finish(undefined), SETTLE_TIMEOUT);
        for (const event of events) {
            subscriptions.push(event(() => {
                const value = read();
                if (value !== undefined) {
                    finish(value);
                }
            }));
        }
    });
}
