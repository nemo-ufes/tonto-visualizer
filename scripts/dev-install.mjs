// Builds, packages and installs the extension under a development version,
// without changing the version the next release will choose: the stamp lives
// in packages/extension/package.json only for as long as packaging takes, and
// the tracked file is put back even when a step fails or is interrupted.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { developmentVersion } from './dev-version.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const extensionManifest = resolve(root, 'packages/extension/package.json');
const originalManifest = readFileSync(extensionManifest);
const devVersion = developmentVersion(JSON.parse(originalManifest.toString('utf8')).version);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
let restored = false;

function restoreManifest() {
    if (restored) return;
    writeFileSync(extensionManifest, originalManifest);
    restored = true;
}

function run(command, args, cwd = root) {
    const result = spawnSync(command, args, {
        cwd,
        stdio: 'inherit',
        shell: process.platform === 'win32'
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
        const error = new Error(`${command} ${args.join(' ')} failed with exit code ${result.status ?? 1}`);
        error.exitCode = result.status ?? 1;
        throw error;
    }
}

process.once('SIGINT', () => {
    restoreManifest();
    process.exit(130);
});
process.once('SIGTERM', () => {
    restoreManifest();
    process.exit(143);
});

try {
    // The root build does not build the language: it is a submodule, built
    // once by `npm run language` and again only after its pin moves.
    if (!existsSync(resolve(root, 'vendor/tonto/packages/language/out/index.js'))) {
        throw new Error('tonto-language is not built; run "npm run language" first.');
    }
    run(npm, ['run', 'versions:check']);

    const extension = JSON.parse(originalManifest.toString('utf8'));
    extension.version = devVersion;
    writeFileSync(extensionManifest, `${JSON.stringify(extension, null, 4)}\n`);

    console.log(`Building local tonto visualizer ${devVersion}...`);
    run(npm, ['run', 'build']);
    run(npm, ['run', 'package', '--workspace=tonto-visualizer']);
    run(process.execPath, ['install-vsix.mjs'], resolve(root, 'packages/extension'));
} catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
} finally {
    restoreManifest();
}
