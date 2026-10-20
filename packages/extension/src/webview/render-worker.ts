/**
 * The panel's drawing, done off the panel's thread.
 *
 * A webview shares its thread with the editor window: a drawing that takes
 * seconds -- a whole workspace of a few thousand classes -- froze VS Code
 * itself, until it offered to reopen the window. Here it takes the same seconds
 * and the editor goes on answering.
 *
 * `render` is the same function the panel calls for a small diagram, and needs
 * nothing from a page: it measures text from tables and returns markup as a
 * string.
 */

import type { RenderInput } from 'tonto-canvas/draw';
import { render } from 'tonto-canvas/draw';

addEventListener('message', (event: MessageEvent<{ id: number; input: RenderInput }>) => {
    const { id, input } = event.data;
    const started = performance.now();
    try {
        const drawn = render(input);
        postMessage({ id, drawn, took: performance.now() - started });
    } catch (error) {
        postMessage({ id, error: error instanceof Error ? error.message : String(error) });
    }
});
