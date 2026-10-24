/**
 * The panel's page: the toolbar, the options sheet and the viewport that
 * `main.ts` draws into, without the document around it.
 *
 * The script looks every one of these up by id as it loads and stops at the
 * first that is missing, so the page and the script are one thing in two
 * files. The extension wraps this body in a document with its own security
 * policy and asset URIs, the tests load it as it is, and so does any page that
 * hosts the panel outside VS Code. A copy kept anywhere else drifts: the
 * tests' copy once lacked two of these elements and carried one that no
 * longer existed.
 */
export const PANEL_BODY = `<div id="shell">
    <div id="toolbar">
        <button id="fit" title="Fit to view" aria-pressed="false">Fit</button>
        <button id="arrange" title="Arrange the whole diagram automatically">Arrange</button>
        <button id="newWindow" class="icon-button" title="Move into a New Window" aria-label="Move into a New Window">
            <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M 9.5 2.5 H 13.5 V 6.5 M 13.5 2.5 L 7 9 M 11.5 8.5 V 13.5 H 2.5 V 4.5 H 7.5"></path>
            </svg>
        </button>
        <span class="distance-control" role="group" aria-label="Association distance">
            <button id="distanceDown" title="Reduce association distance">−</button>
            <span id="distance" class="distance" title="Association distance used by Arrange">Distance 100%</span>
            <button id="distanceUp" title="Increase association distance">+</button>
        </span>
        <button id="zoomOut" title="Zoom out">−</button>
        <span id="scale" class="scale">100%</span>
        <button id="zoomIn" title="Zoom in">+</button>
        <button id="hide" title="Hide the selected classes or associations" disabled>Hide</button>
        <button id="optionsButton" title="What is drawn">⚙</button>
        <button id="exportButton" title="Export as SVG or PNG">Export</button>
        <button id="views" title="Choose a view of this model">Views</button>
        <button id="ontologyDiagram" title="Switch ontology diagram" hidden>Classes</button>
        <span class="spacer"></span>
        <span id="busy" class="busy" hidden></span>
        <span id="stale" class="stale" hidden></span>
    </div>
    <div id="options" class="panel" hidden></div>
    <div id="viewport">
        <div id="canvas"></div>
    </div>
</div>`;
