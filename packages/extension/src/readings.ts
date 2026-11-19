/**
 * The last reading of each model, kept between sessions.
 *
 * A rename made while no diagram is open -- in the editor with the panel
 * closed, in another editor, in a pull -- reaches the views with nothing to
 * compare against: the panel's previous reading went with it. So the reading
 * is kept, and the next time a view of the model opens, the model as it now
 * reads is compared with it exactly as two consecutive readings are.
 *
 * In the extension's storage for this workspace, not in the repository: it
 * holds where each declaration starts, which changes with every edit, and is
 * evidence for this machine's next session rather than part of anyone's work.
 * One file per model root, since a root is what one session reads.
 */

import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import type { Reading } from 'tonto-view';
import { keptReading, readKeptReading } from 'tonto-view';

export class Readings {
    /** Serializes writes, so an older reading cannot land after a newer one. */
    private writes: Promise<void> = Promise.resolve();

    constructor(private readonly directory: vscode.Uri) {}

    async read(root: string): Promise<Reading | undefined> {
        await this.writes;
        try {
            const raw = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(this.uriOf(root))).toString('utf8'));
            // The hash names the file; the root inside says it is the right one.
            return raw?.root === root ? readKeptReading(raw.reading) : undefined;
        } catch {
            // None kept yet, which is every model's first time.
            return undefined;
        }
    }

    write(root: string, reading: Reading): Promise<void> {
        const text = JSON.stringify({ root, reading: keptReading(reading) }) + '\n';
        const write = this.writes.then(async () => {
            await vscode.workspace.fs.createDirectory(this.directory);
            await vscode.workspace.fs.writeFile(this.uriOf(root), Buffer.from(text, 'utf8'));
        });
        // A reading that could not be kept costs the next session a rename it
        // would have found; it is not worth an error in the modeller's face.
        this.writes = write.catch(() => undefined);
        return this.writes;
    }

    private uriOf(root: string): vscode.Uri {
        const name = createHash('sha256').update(root).digest('hex').slice(0, 24);
        return vscode.Uri.joinPath(this.directory, `${name}.json`);
    }
}
