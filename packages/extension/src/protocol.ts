/**
 * What the panel and the extension say to each other.
 *
 * The state lives in the host: it has the model, the arrangement and the file to
 * write it to. The panel draws what it is given and reports what the pointer
 * did. Keeping it that way means the arrangement is never lost to a webview
 * being disposed, and that the same state renders an export without asking the
 * panel for its markup.
 */

import type { ContentOptions, DisplayOptions, EdgeRoute, LayoutOptions, Placement, ViewModel } from 'tonto-view';

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
        layout: LayoutOptions;
        packages: string[];
        title: string;
        /** Set when the model does not parse and the picture is the last good one. */
        stale?: string;
    }
    | { type: 'select'; ids: string[] }
    | { type: 'theme'; dark: boolean }
    /**
     * Draw this SVG as pixels and send them back.
     *
     * The one thing the host cannot do for itself: rasterising needs a browser,
     * and the extension host is Node. So the picture is still rendered here,
     * from the state here -- the panel is asked to photograph it, not to
     * produce it, and what is exported is what an SVG export would have been.
     */
    | { type: 'rasterise'; id: number; svg: string; scale: number };

/** Panel → host. */
export type FromPanel =
    | { type: 'ready' }
    | { type: 'moved'; positions: Record<string, Placement>; rerouted: string[] }
    /** A route the modeller drew, or nothing to give the line back to the router. */
    | { type: 'rerouted'; edge: string; route?: EdgeRoute }
    | { type: 'selected'; ids: string[] }
    | { type: 'reveal'; id: string }
    | { type: 'display'; display: Partial<DisplayOptions> }
    | { type: 'layout'; layout: Partial<LayoutOptions> }
    | { type: 'content'; content: Partial<ContentOptions> }
    | { type: 'autoLayout'; only?: string[] }
    | { type: 'hide'; ids: string[] }
    | { type: 'show'; ids: string[] }
    /** Without a format, the file the modeller names in the dialog decides. */
    | { type: 'export'; format?: 'svg' | 'png' }
    | { type: 'raster'; id: number; data?: string; error?: string }
    /** Take back the last view change, or put it back. */
    | { type: 'undo' }
    | { type: 'redo' };
