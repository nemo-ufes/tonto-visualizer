import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * The `exports` map is what a page hosting the panel outside VS Code loads
 * (AGENTS.md, "What other projects load from here"). That page has no
 * `vscode` module, so one import of it anywhere an exported module reaches
 * breaks the page and nothing in the extension: the extension host provides
 * `vscode`, and the panel's own bundle never sees these modules.
 */

const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { exports: Record<string, string> };
const targets = Object.values(manifest.exports).map(target => resolve(root, target));

/** Relative imports and package names this module loads, type-only ones included. */
function importsOf(file: string): string[] {
    const source = readFileSync(file, 'utf8');
    return [...source.matchAll(/(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/g)].map(match => match[1]!);
}

function reached(entry: string): Map<string, string[]> {
    const found = new Map<string, string[]>();
    const pending = [entry];
    while (pending.length > 0) {
        const file = pending.pop()!;
        if (found.has(file)) continue;
        const specifiers = importsOf(file);
        found.set(file, specifiers);
        for (const specifier of specifiers) {
            if (specifier.startsWith('.')) pending.push(resolve(dirname(file), specifier.replace(/\.js$/, '.ts')));
        }
    }
    return found;
}

describe('what the extension exports to other hosts', () => {
    test('names files that exist', () => {
        expect(targets.filter(target => !existsSync(target)).map(target => relative(root, target))).toEqual([]);
    });

    test('never reaches vscode', () => {
        const offending: string[] = [];
        for (const target of targets.filter(target => target.endsWith('.ts'))) {
            for (const [file, specifiers] of reached(target)) {
                if (specifiers.includes('vscode')) offending.push(relative(root, file));
            }
        }
        expect(offending).toEqual([]);
    });
});
