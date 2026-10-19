// One version for the release set. The extension is what users install, and
// it carries the derivation, the renderer and the command line's code inside
// it, so the workspaces it is built from are released with it under the same
// SemVer version -- as tonto releases its CLI, extension and MCP server
// together. The extension's manifest is the reference the others must match.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const reference = 'packages/extension';
const workspaces = ['packages/view', 'packages/canvas', 'packages/cli', reference];
const lockfile = 'package-lock.json';

function readJson(file) {
    return JSON.parse(readFileSync(resolve(root, file), 'utf8'));
}

function writeJson(file, value) {
    writeFileSync(resolve(root, file), `${JSON.stringify(value, null, 4)}\n`);
}

function isStableSemver(version) {
    return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version);
}

function compareVersions(left, right) {
    const a = left.split('.').map(Number);
    const b = right.split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) return a[index] - b[index];
    }
    return 0;
}

function verify(tag) {
    const expected = readJson(`${reference}/package.json`).version;
    const lock = readJson(lockfile);
    const errors = [];

    // A development stamp left in a tracked manifest would make every local
    // install after it a prerelease of the wrong patch.
    if (!isStableSemver(expected)) {
        errors.push(`extension version ${expected} is not stable SemVer (MAJOR.MINOR.PATCH)`);
    }
    for (const workspace of workspaces) {
        const manifest = readJson(`${workspace}/package.json`);
        if (manifest.version !== expected) {
            errors.push(`${manifest.name} version ${manifest.version} does not match the extension's ${expected}`);
        }
        if (lock.packages?.[workspace]?.version !== expected) {
            errors.push(`${lockfile} has a different ${manifest.name} workspace version`);
        }
    }
    if (tag && tag !== `v${expected}`) {
        errors.push(`release tag ${tag} does not match expected tag v${expected}`);
    }

    if (errors.length) {
        console.error(`Version consistency failed:\n- ${errors.join('\n- ')}`);
        process.exitCode = 1;
    } else {
        console.log(`View, canvas, CLI, extension and lockfile agree on ${expected}${tag ? ` (${tag})` : ''}.`);
    }
}

const [action, argument] = process.argv.slice(2);
if (action === 'check') {
    verify(argument);
} else if (action === 'prepare') {
    const version = argument;
    const current = readJson(`${reference}/package.json`).version;
    if (!version || !isStableSemver(version)) {
        console.error('Usage: npm run release:prepare -- <stable-semver, for example 0.2.0>');
        process.exitCode = 1;
    } else if (!isStableSemver(current) || compareVersions(version, current) < 0) {
        console.error(`Release version ${version} must be stable SemVer and no lower than the current version ${current}.`);
        process.exitCode = 1;
    } else {
        const lock = readJson(lockfile);
        for (const workspace of workspaces) {
            const manifest = readJson(`${workspace}/package.json`);
            manifest.version = version;
            writeJson(`${workspace}/package.json`, manifest);
            lock.packages[workspace].version = version;
        }
        writeJson(lockfile, lock);
        verify();
    }
} else {
    console.error('Usage: node scripts/versioning.mjs <check [tag]|prepare <version>>');
    process.exitCode = 1;
}
