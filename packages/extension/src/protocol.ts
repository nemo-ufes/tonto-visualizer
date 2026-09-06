/**
 * What the panel and the extension say to each other.
 *
 * The state lives in the host: it has the model, the arrangement and the file to
 * write it to. The panel draws what it is given and reports what the pointer
 * did. Keeping it that way means the arrangement is never lost to a webview
 * being disposed, and that the same state renders an export without asking the
 * panel for its markup.
 */

import type { ContentOptions, DisplayOptions, EdgeRoute, Placement, ViewModel } from 'tonto-view';

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** Host → panel. */
export type ToPanel =
    | {
        type: 'model';
        view: ViewModel;
        positions: Record<string, Rect>;
        routes: Record<string, EdgeRoute>;
        display: DisplayOptions;
        content: ContentOptions;
        packages: string[];
        title: string;
        /** Set when the model does not parse and the picture is the last good one. */
        stale?: string;
    }
    | { type: 'select'; ids: string[] }
    | { type: 'theme'; dark: boolean };

/** Panel → host. */
export type FromPanel =
    | { type: 'ready' }
    | { type: 'moved'; positions: Record<string, Placement>; rerouted: string[] }
    | { type: 'rerouted'; edge: string; route: EdgeRoute }
    | { type: 'selected'; ids: string[] }
    | { type: 'reveal'; id: string }
    | { type: 'display'; display: Partial<DisplayOptions> }
    | { type: 'content'; content: Partial<ContentOptions> }
    | { type: 'autoLayout'; only?: string[] }
    | { type: 'hide'; ids: string[] }
    | { type: 'show'; ids: string[] }
    | { type: 'export'; format: 'svg' };
