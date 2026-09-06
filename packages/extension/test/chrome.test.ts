import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stylesheet = readFileSync(resolve(import.meta.dirname, '../media/canvas.css'), 'utf8');

describe('the panel chrome', () => {

    /**
     * The `--vscode-*` variables exist inside a VS Code webview and nowhere
     * else. A `var()` with nothing behind it falls back to the property's
     * initial value -- which for `font-family` is a serif -- so a variable
     * without a fallback comes out as Times in every other context this page is
     * opened in: the harness that drives the panel in a browser, a screenshot
     * taken from it, any preview.
     */
    test('never reads a VS Code variable without saying what to do if it is missing', () => {
        const bare = [...stylesheet.matchAll(/var\(\s*(--vscode-[\w-]+)\s*\)/g)].map(match => match[1]);
        expect(bare).toEqual([]);
    });

    test('falls back to the font the diagram is drawn in', () => {
        // Chrome and drawing should agree when neither is being told what to
        // use; the stack is the one in packages/canvas/src/measure.ts.
        expect(stylesheet).toContain('--chrome-font: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif');
        expect(stylesheet).toContain('font-family: var(--vscode-font-family, var(--chrome-font))');
    });
});
