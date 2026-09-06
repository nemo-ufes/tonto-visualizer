/**
 * The panel.
 *
 * It draws what the host sends and reports what the pointer did. The one piece
 * of state it owns is the viewport -- where the diagram is scrolled and how far
 * it is zoomed -- because that is about looking rather than about the model, and
 * because losing it on every keystroke would make the panel unusable while
 * anything is being typed.
 */

import type { ContentOptions, DisplayOptions, EdgeRoute, LayoutOptions, ViewModel } from 'tonto-view';
import { natureLegend } from 'tonto-view/palette';
import type { Handle, Point, Rect } from 'tonto-canvas/draw';
import {
    darkTheme, distanceToPath, dropHandle, handlesFor, lightTheme, moveHandle, render, routeEdge,
    segmentHitsRect
} from 'tonto-canvas/draw';

interface HostApi {
    postMessage(message: unknown): void;
    getState(): { scale?: number; x?: number; y?: number } | undefined;
    setState(state: unknown): void;
}

declare function acquireVsCodeApi(): HostApi;

const host = acquireVsCodeApi();
const viewport = element('viewport');
const canvas = element('canvas');
const scaleLabel = element('scale');
const optionsPanel = element('options');
const legendPanel = element('legend');
const staleLabel = element('stale');
const titleLabel = element('title');

let view: ViewModel = { groups: [], nodes: [], edges: [], gensets: [] };
let positions: Record<string, Rect> = {};
let routes: Record<string, EdgeRoute> = {};
let display: DisplayOptions | undefined;
let content: ContentOptions | undefined;
let layout: LayoutOptions | undefined;
let packages: string[] = [];
let dark = false;
let selection = new Set<string>();

const stored = host.getState() ?? {};
let scale = stored.scale ?? 1;
let panX = stored.x ?? 0;
let panY = stored.y ?? 0;
let bounds: Rect = { x: 0, y: 0, width: 1, height: 1 };
/** Set while a drag is in flight, so a redraw does not yank the boxes back. */
let dragging: DragState | undefined;
/** The polyline each edge was last drawn along, which is what a handle holds. */
let paths: Record<string, Point[]> = {};

interface DragState {
    ids: string[];
    startX: number;
    startY: number;
    moved: boolean;
    origin: Record<string, Rect>;
    /** Set instead of `ids` when what is being dragged is a bend in a line. */
    route?: { edge: string; handle: Handle; from: Point[] };
}

window.addEventListener('message', event => {
    const message = event.data;
    if (message.type === 'model') {
        view = message.view;
        positions = message.positions;
        routes = message.routes;
        display = message.display;
        content = message.content;
        layout = message.layout;
        packages = message.packages;
        titleLabel.textContent = message.title;
        staleLabel.hidden = !message.stale;
        staleLabel.textContent = message.stale ? `does not parse — showing the last good diagram` : '';
        draw();
        updateArrangeTitle();
        if (optionsPanel.hidden === false) {
            fillOptions();
        }
        fillLegend();
    } else if (message.type === 'select') {
        selection = new Set(message.ids);
        applySelection();
        updateArrangeTitle();
    } else if (message.type === 'theme') {
        dark = message.dark;
        document.body.classList.toggle('dark', dark);
        draw();
    }
});

function draw(): void {
    if (!display) {
        return;
    }
    const drawn = render({
        view,
        positions,
        routes,
        display,
        theme: dark ? darkTheme : lightTheme,
        selection: [...selection]
    });
    bounds = drawn.bounds;
    paths = drawn.paths;
    canvas.innerHTML = drawn.svg;
    drawHandles();
    applyViewport();
}

/**
 * The handles on the selected line, over the drawing rather than in it.
 *
 * They are an offer to change the arrangement, not part of the picture, so they
 * are added here and never by `render` -- which also draws the export, and an
 * exported SVG with grab handles in it would be nobody's idea of a diagram.
 *
 * Only one line at a time. Every line at once is a field of dots, and the
 * question a handle asks -- do you want this line to go round there? -- is
 * about the line the modeller has in front of them.
 */
function drawHandles(): void {
    const svg = canvas.querySelector('svg');
    svg?.querySelector('.tv-handles')?.remove();
    const selected = [...selection];
    const edge = selected.length === 1 ? selected[0]! : undefined;
    const points = edge ? paths[edge] : undefined;
    if (!svg || !edge || !points || dragging?.ids.length) {
        return;
    }
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'tv-handles');
    group.setAttribute('data-handles', edge);
    // Sized against the zoom, so a handle is the same target on screen whether
    // the diagram is being read whole or a corner of it is filling the panel.
    const radius = 4.5 / scale;
    for (const [index, handle] of handlesFor(points).entries()) {
        const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        dot.setAttribute('class', `tv-handle${handle.kind === 'new' ? ' tv-handle-new' : ''}`);
        dot.setAttribute('data-handle', String(index));
        dot.setAttribute('cx', String(handle.at.x));
        dot.setAttribute('cy', String(handle.at.y));
        dot.setAttribute('r', String(handle.kind === 'new' ? radius * 0.8 : radius));
        dot.setAttribute('stroke-width', String(1.4 / scale));
        group.append(dot);
    }
    svg.append(group);
}

/**
 * Where the pointer is, in the coordinates the diagram is drawn in.
 *
 * Asked of the SVG rather than worked out from the pan and the zoom: the same
 * two numbers derived twice drift apart, and this one is used to decide what was
 * clicked on.
 */
function diagramPoint(event: { clientX: number; clientY: number }): Point | undefined {
    const svg = canvas.querySelector('svg');
    const matrix = svg?.getScreenCTM()?.inverse();
    if (!svg || !matrix) {
        return undefined;
    }
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const at = point.matrixTransform(matrix);
    return { x: at.x, y: at.y };
}

/**
 * The line near enough the pointer to have been aimed at.
 *
 * A line is a stroke a pixel and a bit wide, which is a hard thing to hit and an
 * impossible one where its own label sits over it -- and a line has to be
 * selected before its route can be taken hold of. So what is under the pointer
 * decides only when it is a box or a handle; for lines, the pointer is measured
 * against the polylines themselves, and the nearest within reach wins.
 */
function nearestLine(event: { clientX: number; clientY: number }): string | undefined {
    const at = diagramPoint(event);
    if (!at) {
        return undefined;
    }
    const reach = 6 / scale;
    let best: { edge: string; distance: number } | undefined;
    for (const [edge, points] of Object.entries(paths)) {
        const distance = distanceToPath(at, points);
        if (distance <= reach && (!best || distance < best.distance)) {
            best = { edge, distance };
        }
    }
    return best?.edge;
}

/** The handle a pointer is on, and the line it belongs to. */
function handleAt(target: Element): { edge: string; handle: Handle } | undefined {
    const dot = target.closest('[data-handle]');
    const edge = dot?.parentElement?.getAttribute('data-handles') ?? undefined;
    const points = edge ? paths[edge] : undefined;
    const handle = points ? handlesFor(points)[Number(dot!.getAttribute('data-handle'))] : undefined;
    return edge && handle ? { edge, handle } : undefined;
}

/** Draws one line along a polyline, without redrawing anything else. */
function repaint(edge: string, points: Point[]): void {
    const path = canvas.querySelector(`[data-edge="${cssEscape(edge)}"] path`) as SVGPathElement | null;
    path?.setAttribute('d', points.map((point, index) =>
        `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '));
}

function applyViewport(): void {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    scaleLabel.textContent = `${Math.round(scale * 100)}%`;
    host.setState({ scale, x: panX, y: panY });
    drawHandles();
}

function fit(): void {
    const padding = 24;
    scale = clamp(Math.min(
        (viewport.clientWidth - padding) / bounds.width,
        (viewport.clientHeight - padding) / bounds.height
    ), 0.08, 2);
    panX = (viewport.clientWidth - bounds.width * scale) / 2;
    panY = (viewport.clientHeight - bounds.height * scale) / 2;
    applyViewport();
}

function zoomAt(next: number, clientX: number, clientY: number): void {
    const rect = viewport.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const diagramX = (x - panX) / scale;
    const diagramY = (y - panY) / scale;
    scale = clamp(next, 0.08, 6);
    panX = x - diagramX * scale;
    panY = y - diagramY * scale;
    applyViewport();
}

viewport.addEventListener('pointerdown', event => {
    const target = event.target as Element;
    viewport.setPointerCapture(event.pointerId);

    // Before anything else: a handle sits over the line it belongs to, and the
    // line is already selected, so neither the selection nor a pan is wanted.
    const held = handleAt(target);
    if (held) {
        dragging = {
            ids: [], startX: event.clientX, startY: event.clientY, moved: false, origin: {},
            route: { edge: held.edge, handle: held.handle, from: paths[held.edge]! }
        };
        return;
    }

    const nodeGroup = target.closest('[data-node]');
    const id = nodeGroup?.getAttribute('data-node') ?? undefined;

    if (!id) {
        const edgeGroup = target.closest('[data-edge]');
        const edgeId = edgeGroup?.getAttribute('data-edge') ?? nearestLine(event);
        selection = edgeId ? new Set([edgeId]) : new Set();
        applySelection();
        reportSelection();
        if (!edgeId) {
            dragging = { ids: [], startX: event.clientX, startY: event.clientY, moved: false, origin: {} };
        }
        return;
    }

    if (!selection.has(id)) {
        selection = event.shiftKey ? new Set([...selection, id]) : new Set([id]);
        applySelection();
        reportSelection();
    }
    const ids = [...selection].filter(candidate => positions[candidate]);
    dragging = {
        ids,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        origin: Object.fromEntries(ids.map(candidate => [candidate, { ...positions[candidate]! }]))
    };
});

viewport.addEventListener('pointermove', event => {
    if (!dragging) {
        return;
    }
    const dx = (event.clientX - dragging.startX) / scale;
    const dy = (event.clientY - dragging.startY) / scale;
    if (!dragging.moved && Math.hypot(dx, dy) < 3) {
        return;
    }
    dragging.moved = true;

    const route = dragging.route;
    if (route) {
        // Snapped like a box is, so a bend put level with a border stays level.
        const at = { x: snap(route.handle.at.x + dx), y: snap(route.handle.at.y + dy) };
        const points = moveHandle(route.from, route.handle, at);
        paths[route.edge] = points;
        repaint(route.edge, points);
        drawHandles();
        return;
    }

    if (dragging.ids.length === 0) {
        panX += event.clientX - dragging.startX;
        panY += event.clientY - dragging.startY;
        dragging.startX = event.clientX;
        dragging.startY = event.clientY;
        applyViewport();
        return;
    }

    for (const id of dragging.ids) {
        const origin = dragging.origin[id]!;
        // Snapped to an 8px grid, so two boxes dragged to the same height line
        // up rather than nearly lining up.
        positions[id] = { ...origin, x: snap(origin.x + dx), y: snap(origin.y + dy) };
        const group = canvas.querySelector(`[data-node="${cssEscape(id)}"]`) as SVGGElement | null;
        group?.setAttribute('transform', `translate(${positions[id]!.x - origin.x}, ${positions[id]!.y - origin.y})`);
    }
    redrawIncidentEdges(new Set(dragging.ids));
});

viewport.addEventListener('pointerup', () => {
    const drag = dragging;
    dragging = undefined;
    if (drag?.route && drag.moved) {
        // The whole polyline, ends included: a route and the boxes it runs
        // between are one arrangement, and half of one is a line to a corner.
        keepRoute(drag.route.edge, paths[drag.route.edge]);
        return;
    }
    if (!drag || !drag.moved || drag.ids.length === 0) {
        return;
    }
    const moved = new Set(drag.ids);
    const rerouted = view.edges
        .filter(edge => {
            if (moved.has(edge.source) || moved.has(edge.target)) {
                return true;
            }
            const points = routes[edge.id]?.points;
            return points !== undefined && drag.ids.some(id => {
                const rect = positions[id];
                return rect !== undefined && points.slice(1).some((point, index) =>
                    segmentHitsRect(points[index]!, point, rect, 4));
            });
        })
        .map(edge => edge.id);
    host.postMessage({
        type: 'moved',
        positions: Object.fromEntries(drag.ids.map(id => [id, {
            x: positions[id]!.x,
            y: positions[id]!.y,
            width: positions[id]!.width,
            height: positions[id]!.height
        }])),
        rerouted
    });
    for (const edge of rerouted) {
        delete routes[edge];
    }
    draw();
});

/**
 * Hands a route to the host, or hands the line back to the router.
 *
 * The host writes the view file and is the only thing that knows where it is, so
 * the panel says what happened and redraws from what it has. It does not wait to
 * be told again: the host answers a reroute by writing, not by re-sending, which
 * is what keeps a drag from flickering.
 */
function keepRoute(edge: string, points: Point[] | undefined): void {
    if (points) {
        routes[edge] = { points };
    } else {
        delete routes[edge];
    }
    host.postMessage({ type: 'rerouted', edge, ...(points ? { route: { points } } : {}) });
    draw();
}

/** While a node is being dragged its edges follow it, without a full redraw. */
function redrawIncidentEdges(moved: Set<string>): void {
    for (const edge of view.edges) {
        if (!moved.has(edge.source) && !moved.has(edge.target)) {
            continue;
        }
        const source = positions[edge.source];
        const target = positions[edge.target];
        const path = canvas.querySelector(`[data-edge="${cssEscape(edge.id)}"] path`) as SVGPathElement | null;
        if (!source || !target || !path) {
            continue;
        }
        const points = routeEdge(source, target, { style: display?.routing ?? 'straight' });
        path.setAttribute('d', points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '));
    }
}

viewport.addEventListener('dblclick', event => {
    // What is under the pointer, rather than what the event says it hit. Every
    // pointerdown takes pointer capture -- a box being dragged has to keep
    // receiving moves once the pointer has left it -- and a captured pointer
    // retargets the click that follows to the element holding the capture. So
    // `event.target` on a double-click is the viewport whatever was clicked,
    // and asking it for a class found none: double-clicking a class fitted the
    // diagram to the window instead of opening its declaration.
    const under = document.elementFromPoint(event.clientX, event.clientY);
    if (!under) {
        fit();
        return;
    }
    const held = handleAt(under);
    if (held) {
        // Only a bend can be dropped. A handle on a stretch is not one yet.
        if (held.handle.kind === 'bend') {
            keepRoute(held.edge, dropHandle(paths[held.edge]!, held.handle.index));
        }
        return;
    }
    const target = under.closest('[data-node]') ?? under.closest('[data-edge]');
    const id = target?.getAttribute('data-node') ?? target?.getAttribute('data-edge') ?? nearestLine(event);
    if (id) {
        host.postMessage({ type: 'reveal', id });
    } else {
        fit();
    }
});

viewport.addEventListener('wheel', event => {
    event.preventDefault();
    zoomAt(scale * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX, event.clientY);
}, { passive: false });

window.addEventListener('keydown', event => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
        if (selection.size > 0) {
            host.postMessage({ type: 'hide', ids: [...selection] });
            selection = new Set();
            reportSelection();
        }
    }
});

function applySelection(): void {
    for (const group of Array.from(canvas.querySelectorAll('[data-node], [data-edge]'))) {
        const id = group.getAttribute('data-node') ?? group.getAttribute('data-edge');
        group.classList.toggle('tv-selected', id !== null && selection.has(id));
    }
    drawHandles();
}

function reportSelection(): void {
    host.postMessage({ type: 'selected', ids: [...selection] });
    updateArrangeTitle();
}

function updateArrangeTitle(): void {
    const selectedNodes = [...selection].filter(id => positions[id] !== undefined).length;
    element('arrange').title = selectedNodes > 0
        ? `Arrange ${selectedNodes} selected node${selectedNodes === 1 ? '' : 's'} automatically`
        : 'Arrange the whole diagram automatically';
}

element('zoomIn').addEventListener('click', () => zoomAt(scale * 1.2, centreX(), centreY()));
element('zoomOut').addEventListener('click', () => zoomAt(scale / 1.2, centreX(), centreY()));
element('fit').addEventListener('click', fit);
element('arrange').addEventListener('click', () => {
    const selectedNodes = [...selection].filter(id => positions[id] !== undefined);
    host.postMessage(selectedNodes.length > 0
        ? { type: 'autoLayout', only: selectedNodes }
        : { type: 'autoLayout' });
});
element('exportButton').addEventListener('click', () => host.postMessage({ type: 'export', format: 'svg' }));
element('optionsButton').addEventListener('click', () => {
    optionsPanel.hidden = !optionsPanel.hidden;
    if (!optionsPanel.hidden) {
        fillOptions();
    }
});

/** The options panel is rebuilt from the state the host holds, never from itself. */
function fillOptions(): void {
    if (!display || !content) {
        return;
    }
    const displayRows: Array<[keyof DisplayOptions, string]> = [
        ['showAttributes', 'Attributes'],
        ['showCardinalities', 'Cardinalities'],
        ['showRelationNames', 'Relation names'],
        ['showRelationStereotypes', 'Relation stereotypes'],
        ['showRoleNames', 'Role names'],
        ['showEndDecorations', 'End decorations'],
        ['showColors', 'Nature colours'],
        ['showLegend', 'Nature colour legend'],
        ['showPackageGroups', 'Package boxes'],
        ['qualifyNames', 'Qualified names'],
        ['showDocumentation', 'Documentation on hover']
    ];
    const contentRows: Array<[keyof ContentOptions, string]> = [
        ['showExternalReferences', 'External references'],
        ['showDatatypes', 'Datatypes and enumerations'],
        ['showGensets', 'Generalization sets']
    ];

    optionsPanel.replaceChildren();
    const algorithm = layout?.algorithm ?? 'layered';
    const arrangement = [
        choice('Lines', [['straight', 'Straight'], ['orthogonal', 'Right-angled']], display.routing,
            value => host.postMessage({ type: 'display', display: { routing: value as DisplayOptions['routing'] } })),
        choice('Arrangement', [
            ['layered', 'Layered (taxonomy)'],
            ['stress', 'Spread'],
            ['mrtree', 'Tree'],
            ['radial', 'Radial'],
            ['force', 'Force-directed']
        ], algorithm,
            value => host.postMessage({ type: 'layout', layout: { algorithm: value as LayoutOptions['algorithm'] } }))
    ];
    if (algorithm === 'layered' || algorithm === 'mrtree') {
        arrangement.push(
            choice('Direction', [['DOWN', 'Top to bottom'], ['RIGHT', 'Left to right']], layout?.direction ?? 'DOWN',
                value => host.postMessage({ type: 'layout', layout: { direction: value as LayoutOptions['direction'] } })),
            // A package is a neighbourhood preference. Keeping it enabled may
            // leave a hierarchy across package boundaries staggered.
            toggle('Cluster packages', layout?.groupByPackage ?? true,
                value => host.postMessage({ type: 'layout', layout: { groupByPackage: value } }))
        );
    }
    optionsPanel.append(section('Shape', arrangement));
    optionsPanel.append(section('Drawn', displayRows.map(([key, label]) =>
        toggle(label, Boolean(display?.[key]), value => host.postMessage({ type: 'display', display: { [key]: value } })))));
    optionsPanel.append(section('Included', contentRows.map(([key, label]) =>
        toggle(label, Boolean(content?.[key]), value => host.postMessage({ type: 'content', content: { [key]: value } })))));

    if (packages.length > 1) {
        const included = new Set(content.includedPackages ?? packages);
        optionsPanel.append(section('Packages', packages.map(name =>
            toggle(name, included.has(name), value => {
                const next = new Set(included);
                if (value) {
                    next.add(name);
                } else {
                    next.delete(name);
                }
                host.postMessage({ type: 'content', content: { includedPackages: [...next] } });
            }))));
    }

    const hidden = content.hidden ?? [];
    if (hidden.length > 0) {
        const button = document.createElement('button');
        button.textContent = `Show ${hidden.length} hidden element${hidden.length === 1 ? '' : 's'}`;
        button.addEventListener('click', () => host.postMessage({ type: 'show', ids: hidden }));
        optionsPanel.append(section('Hidden', [button]));
    }
}

function fillLegend(): void {
    legendPanel.hidden = !display?.showColors || !display.showLegend;
    legendPanel.replaceChildren(...natureLegend.map(entry => {
        const row = document.createElement('div');
        row.className = 'legend-row';
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = entry.color;
        const text = document.createElement('span');
        text.textContent = entry.label;
        row.append(swatch, text);
        return row;
    }));
}

function section(title: string, rows: HTMLElement[]): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.className = 'section';
    const heading = document.createElement('div');
    heading.className = 'section-title';
    heading.textContent = title;
    wrapper.append(heading, ...rows);
    return wrapper;
}

/** A named choice, for the options that are not on-or-off. */
function choice(
    label: string, values: Array<[string, string]>, current: string, onChange: (value: string) => void
): HTMLElement {
    const row = document.createElement('label');
    row.className = 'row choice';
    const text = document.createElement('span');
    text.textContent = label;
    const select = document.createElement('select');
    for (const [value, name] of values) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = name;
        option.selected = value === current;
        select.append(option);
    }
    select.addEventListener('change', () => onChange(select.value));
    row.append(text, select);
    return row;
}

function toggle(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
    const row = document.createElement('label');
    row.className = 'row';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = value;
    input.addEventListener('change', () => onChange(input.checked));
    const text = document.createElement('span');
    text.textContent = label;
    row.append(input, text);
    return row;
}

function element(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) {
        throw new Error(`the panel has no #${id}`);
    }
    return found;
}

function centreX(): number {
    return viewport.getBoundingClientRect().left + viewport.clientWidth / 2;
}

function centreY(): number {
    return viewport.getBoundingClientRect().top + viewport.clientHeight / 2;
}

function clamp(value: number, low: number, high: number): number {
    return Math.min(high, Math.max(low, value));
}

function snap(value: number): number {
    return Math.round(value / 8) * 8;
}

/** Ids hold `::` and `->`, neither of which a selector may carry unescaped. */
function cssEscape(value: string): string {
    return value.replaceAll(/["\\]/g, '\\$&');
}

host.postMessage({ type: 'ready' });
