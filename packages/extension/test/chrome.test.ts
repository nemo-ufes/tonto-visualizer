import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stylesheet = readFileSync(resolve(import.meta.dirname, '../media/canvas.css'), 'utf8');
const panel = readFileSync(resolve(import.meta.dirname, '../src/diagram-panel.ts'), 'utf8');

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

    /**
     * SVG hit-tests a shape against what it is painted with, so a handle drawn
     * as an outline is only its outline as far as the pointer is concerned --
     * a dashed ring 1.4px wide, which the line underneath took every click
     * aimed at. Nothing about the picture says so; it looks exactly right and
     * cannot be grabbed.
     */
    test('lets the whole of a route handle be grabbed, not just what it is painted with', () => {
        const handle = /#canvas \.tv-handle \{([^}]*)\}/.exec(stylesheet);
        expect(handle).not.toBeNull();
        expect(handle![1]).toContain('pointer-events: all');
    });

    /**
     * A `<text>` hit-tests against its glyphs, so the gaps inside and between
     * letters fall through to whatever is behind -- and the labels sit in their
     * own group over the drawing, so a click aimed at a role name usually
     * landed on the background and cleared the selection instead of choosing
     * the line the name belongs to.
     */
    test('lets a label be aimed at as a whole word, not glyph by glyph', () => {
        const labels = /#canvas \.tv-labels text \{([^}]*)\}/.exec(stylesheet);
        expect(labels).not.toBeNull();
        expect(labels![1]).toContain('pointer-events: all');
    });

    /**
     * Exporting a PNG means drawing the diagram into a canvas, and the only way
     * to hand an SVG to an `Image` inside the panel is a `data:` URI -- a blob
     * is not one of the things the policy admits. Take `data:` out of `img-src`
     * and the export stops working with nothing on screen to say why.
     */
    test('lets the panel load the drawing it is asked to photograph', () => {
        const policy = /Content-Security-Policy" content="([^"]*)"/.exec(panel);
        expect(policy).not.toBeNull();
        expect(/img-src[^;]*\bdata:/.test(policy![1]!)).toBe(true);
    });

    /**
     * `element` throws when an id is missing, and it is called as the script
     * loads, so one id in the panel's HTML that the webview does not know about
     * -- a button renamed on one side of the pair -- is not a broken button, it
     * is a blank diagram with the failure only in a console nobody has open.
     */
    test('gives the webview every element it asks the page for', () => {
        const webview = readFileSync(resolve(import.meta.dirname, '../src/webview/main.ts'), 'utf8');
        const asked = [...webview.matchAll(/\belement\('([^']+)'/g)].map(match => match[1]!);
        const offered = new Set([...panel.matchAll(/id="([^"]+)"/g)].map(match => match[1]!));
        expect(asked.length).toBeGreaterThan(0);
        expect(asked.filter(id => !offered.has(id))).toEqual([]);
    });

    test('shows the move-to-window action as a labelled icon', () => {
        const button = /<button id="newWindow"([^>]*)>([\s\S]*?)<\/button>/.exec(panel);
        expect(button).not.toBeNull();
        expect(button![1]).toContain('aria-label="Move into a New Window"');
        expect(button![2]).toContain('<svg');
        expect(button![2]!.replace(/<[^>]+>/g, '').trim()).toBe('');
    });

    test('starts with fit, arrange and new window without repeating the file name', () => {
        const toolbar = /<div id="toolbar">([\s\S]*?)<\/div>/.exec(panel);
        expect(toolbar).not.toBeNull();
        const controls = [...toolbar![1]!.matchAll(/<(?:button|span)\b[^>]*id="([^"]+)"/g)]
            .map(match => match[1]);
        expect(controls.slice(0, 3)).toEqual(['fit', 'arrange', 'newWindow']);
        expect(controls).not.toContain('title');
        expect(toolbar![1]).toContain('id="fit" title="Fit to view" aria-pressed="false"');
    });

    test('falls back to the font the diagram is drawn in', () => {
        // Chrome and drawing should agree when neither is being told what to
        // use; the stack is the one in packages/canvas/src/measure.ts.
        expect(stylesheet).toContain('--chrome-font: "Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif');
        expect(stylesheet).toContain('font-family: var(--vscode-font-family, var(--chrome-font))');
    });
});
