// Every package gets its own version, not just the ones meant to ship.
//
// The marketplace version stayed at 0.1.0 through every build this repository
// has ever made, because it was never a build number -- it was a milestone
// nobody had reason to move. That made an installed copy indistinguishable
// from the one before it: `code --list-extensions --show-versions` read
// 0.1.0 whether or not `code --install-extension` had actually replaced the
// files underneath it, and a stale webview cache surviving a `Reload Window`
// looked identical to a fresh one until someone went looking at file hashes.
//
// The patch number now moves on every package, and a build metadata suffix
// -- a UTC timestamp, which SemVer allows after a `+` and does not compare
// on -- says when. Nothing here decides a minor or major bump; those stay a
// person's call, made by editing the version this script reads rather than
// by running it.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('package.json', import.meta.url));
const pkg = JSON.parse(readFileSync(path, 'utf8'));

const [base] = pkg.version.split('+');
const [major, minor, patch] = base.split('.').map(Number);

const now = new Date();
const pad = (part) => String(part).padStart(2, '0');
const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}`
    + `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;

pkg.version = `${major}.${minor}.${patch + 1}+${stamp}`;
writeFileSync(path, `${JSON.stringify(pkg, null, 4)}\n`);
console.log(`tonto-visualizer -> ${pkg.version}`);
