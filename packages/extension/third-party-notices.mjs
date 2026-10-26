// The bundles in out/ carry other packages' code, but --no-dependencies keeps
// those packages' LICENSE files out of the VSIX, and esbuild drops every
// comment that is not marked @license -- including the copyright headers at
// the top of the files it bundles. MIT, ISC, BSD and Apache-2.0 all ask that
// the notice travel with the code, and the EPL forbids removing it, so both
// are collected here from what esbuild actually bundled -- not from
// package-lock.json, which also lists build tools that never ship.
//
// Adapted from the tonto extension's own script, with two differences: the
// language is a package from another repository here, read from vendor/ rather
// than node_modules, and the layout engine is not permissively licensed.
import { readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Licenses that ask for nothing beyond keeping the notice. Anything else in a
// bundle stops the build: a copyleft or proprietary package is a decision to
// make on purpose, not one to find out about from a published VSIX.
const permissive = new Set([
    '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause',
    'CC0-1.0', 'ISC', 'MIT', 'Unlicense', 'Zlib'
]);

// The decisions made on purpose, one package at a time, so that the next
// copyleft dependency still stops the build instead of riding in on this one.
//
// elkjs is offered under EPL-2.0 OR GPL-3.0-or-later, and is taken under the
// EPL. That copyleft is per file: it covers elkjs, which is bundled unmodified,
// and not the MIT code beside it. Distributing it compiled asks for three
// things -- its notices kept (EPL 3.3), the license text, and a statement of
// where its source is to be had under the EPL (3.1a) -- and all three are in
// its section of the notices file.
const elected = new Map([
    ['elkjs', {
        license: 'EPL-2.0',
        source: version => `The Source Code of elkjs ${version} is available under the Eclipse Public License 2.0\n`
            + `at https://github.com/kieler/elkjs (release ${version}) and in the npm package elkjs@${version}.`
    }]
]);

const noticeFile = /^(licen[cs]e|copying|notice)([.-]|$)/i;

// This repository's own packages are covered by its LICENSE, included in the
// artifact that carries each bundle.
const extensionPackage = resolve(fileURLToPath(new URL('..', import.meta.url)));

/**
 * Writes the notices of every npm package bundled into the given builds.
 * @param {import('esbuild').Metafile[]} metafiles
 * @param {string} outfile
 */
export function writeThirdPartyNotices(metafiles, outfile, {
    ownPackageRoots = [extensionPackage],
    description = 'The tonto visualizer extension bundles the following packages into out/.'
} = {}) {
    const ownPackages = ownPackageRoots.map(root => `${resolve(root)}${sep}`);
    const inputs = new Map();
    for (const metafile of metafiles) {
        for (const input of Object.keys(metafile.inputs)) {
            const path = resolve(input.replace(/^[a-z-]+:/i, ''));
            const root = packageRoot(path, ownPackages);
            if (!root) continue;
            if (!inputs.has(root)) inputs.set(root, new Set());
            inputs.get(root).add(path);
        }
    }

    const packages = new Map();
    for (const [root, files] of inputs) {
        const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        const id = `${pkg.name}@${pkg.version}`;
        const entry = packages.get(id) ?? { root, pkg, license: licenseOf(pkg), headers: new Set() };
        // The same version bundled from two copies has one notice.
        for (const file of files) for (const header of copyrightHeaders(file)) entry.headers.add(header);
        packages.set(id, entry);
    }
    const sorted = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b));

    const problems = [];
    for (const [id, { root, pkg, license }] of sorted) {
        const files = readdirSync(root).filter(name => noticeFile.test(name));
        const choice = elected.get(pkg.name);
        if (!license) problems.push(`${id} declares no license`);
        else if (choice && !offers(license, choice.license)) {
            problems.push(`${id} is licensed ${license}, which no longer offers the ${choice.license} it was taken under`);
        } else if (!choice && !satisfies(license)) {
            problems.push(`${id} is licensed ${license}, which is not on the permissive list`);
        }
        if (files.length === 0) problems.push(`${id} has no license file to copy`);
    }
    if (problems.length > 0) {
        throw new Error(`Third-party licenses need a decision:\n  ${problems.join('\n  ')}`);
    }

    const sections = sorted.map(([id, { root, pkg, license, headers }]) => {
        const choice = elected.get(pkg.name);
        const files = readdirSync(root).filter(name => noticeFile.test(name)).sort();
        const texts = files.map(name => readFileSync(join(root, name), 'utf8').trim());
        const source = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
        const header = [
            id,
            choice ? `License: ${choice.license} (offered as ${license})` : `License: ${license}`,
            ...(source ? [`Source: ${source}`] : [])
        ];
        return [
            header.join('\n'),
            ...(choice ? [choice.source(pkg.version)] : []),
            ...[...headers].sort(),
            ...texts
        ].join('\n\n');
    });

    const rule = '-'.repeat(78);
    writeFileSync(outfile, [
        'Third-party notices',
        '',
        description,
        'Each is listed with the license it is distributed under, the copyright',
        'notices its bundled files carry, and its license text.',
        '',
        ...sections.flatMap(section => [rule, '', section, ''])
    ].join('\n'));
    return sorted.length;
}

// The directory of the npm package an esbuild input belongs to, or nothing for
// this repository's own sources. Inputs are already resolved through symlinks,
// so the language arrives under vendor/ rather than node_modules, and is found
// by its nearest package.json. Inside node_modules the nearest one is not
// enough: some packages put a stub package.json in a subdirectory.
function packageRoot(path, ownPackages) {
    const marker = `${sep}node_modules${sep}`;
    const at = path.lastIndexOf(marker);
    if (at >= 0) {
        const rest = path.slice(at + marker.length).split(sep);
        const depth = rest[0].startsWith('@') ? 2 : 1;
        return realpathSync(path.slice(0, at + marker.length) + rest.slice(0, depth).join(sep));
    }
    if (ownPackages.some(root => path.startsWith(root))) return undefined;
    for (let directory = dirname(path); directory !== dirname(directory); directory = dirname(directory)) {
        try {
            if (JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name) return directory;
        } catch {
            // No package.json here; keep walking up.
        }
    }
    return undefined;
}

// The block comments in a bundled file that say who holds its copyright --
// what esbuild leaves behind, because none of them is marked @license.
function copyrightHeaders(file) {
    let text;
    try {
        text = readFileSync(file, 'utf8');
    } catch {
        return [];
    }
    return (text.match(/\/\*[\s\S]*?\*\//g) ?? [])
        .filter(comment => /copyright/i.test(comment))
        .map(comment => comment
            .split('\n')
            .map(line => line.replace(/^\s*\/?\*+\/?/, '').replace(/\*+\/\s*$/, '').replace(/\s+/g, ' ').trim())
            .filter(line => !/^[-*=\s]*$/.test(line))
            .join('\n'));
}

function licenseOf(pkg) {
    if (typeof pkg.license === 'string') return pkg.license;
    if (pkg.license?.type) return pkg.license.type;
    // The array form predates SPDX expressions; each entry is an alternative.
    if (Array.isArray(pkg.licenses) && pkg.licenses.length > 0) {
        return pkg.licenses.map(entry => entry.type ?? entry).join(' OR ');
    }
    return undefined;
}

// Whether an expression still offers the license a package was taken under:
// it is that license, or one alternative of a plain disjunction.
function offers(expression, license) {
    return expression.replace(/[()]/g, '').split(/\s+OR\s+/).includes(license);
}

// An SPDX expression is satisfied when some choice among its ORs leaves only
// permissive licenses. AND binds tighter than OR, and a WITH exception, which
// can grant or take away, is left for a person to read.
function satisfies(expression) {
    const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
    let next = 0;
    const or = () => {
        let value = and();
        while (tokens[next] === 'OR') { next++; value = and() || value; }
        return value;
    };
    const and = () => {
        let value = term();
        while (tokens[next] === 'AND') { next++; value = term() && value; }
        return value;
    };
    const term = () => {
        const token = tokens[next++];
        if (token === '(') { const value = or(); next++; return value; }
        if (tokens[next] === 'WITH') { next += 2; return false; }
        return permissive.has(token);
    };
    const value = or();
    return value && next === tokens.length;
}
