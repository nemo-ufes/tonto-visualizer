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
import type { Rect } from 'tonto-canvas/draw';
import { darkTheme, lightTheme, render, routeEdge } from 'tonto-canvas/draw';

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

interface DragState {
    ids: string[];
    startX: number;
    startY: number;
    moved: boolean;
    origin: Record<string, Rect>;
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
        if (optionsPanel.hidden === false) {
            fillOptions();
        }
        fillLegend();
    } else if (message.type === 'select') {
        selection = new Set(message.ids);
        applySelection();
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
    canvas.innerHTML = drawn.svg;
    applyViewport();
}

function applyViewport(): void {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
    scaleLabel.textContent = `${Math.round(scale * 100)}%`;
    host.setState({ scale, x: panX, y: panY });
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
    const nodeGroup = target.closest('[data-node]');
    const id = nodeGroup?.getAttribute('data-node') ?? undefined;
    viewport.setPointerCapture(event.pointerId);

    if (!id) {
        const edgeGroup = target.closest('[data-edge]');
        const edgeId = edgeGroup?.getAttribute('data-edge');
        selection = edgeId ? new Set([edgeId]) : new Set();
        applySelection();
        if (!edgeId) {
            dragging = { ids: [], startX: event.clientX, startY: event.clientY, moved: false, origin: {} };
        }
        return;
    }

    if (!selection.has(id)) {
        selection = event.shiftKey ? new Set([...selection, id]) : new Set([id]);
        applySelection();
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
    if (!drag || !drag.moved || drag.ids.length === 0) {
        return;
    }
    const moved = new Set(drag.ids);
    host.postMessage({
        type: 'moved',
        positions: Object.fromEntries(drag.ids.map(id => [id, {
            x: positions[id]!.x,
            y: positions[id]!.y,
            width: positions[id]!.width,
            height: positions[id]!.height
        }])),
        rerouted: view.edges
            .filter(edge => moved.has(edge.source) || moved.has(edge.target))
            .map(edge => edge.id)
    });
    for (const edge of view.edges) {
        if (moved.has(edge.source) || moved.has(edge.target)) {
            delete routes[edge.id];
        }
    }
    draw();
});

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
    const target = (event.target as Element).closest('[data-node]') ?? (event.target as Element).closest('[data-edge]');
    const id = target?.getAttribute('data-node') ?? target?.getAttribute('data-edge');
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
        }
    }
});

function applySelection(): void {
    for (const group of Array.from(canvas.querySelectorAll('[data-node], [data-edge]'))) {
        const id = group.getAttribute('data-node') ?? group.getAttribute('data-edge');
        group.classList.toggle('tv-selected', id !== null && selection.has(id));
    }
}

element('zoomIn').addEventListener('click', () => zoomAt(scale * 1.2, centreX(), centreY()));
element('zoomOut').addEventListener('click', () => zoomAt(scale / 1.2, centreX(), centreY()));
element('fit').addEventListener('click', fit);
element('arrange').addEventListener('click', () => host.postMessage({ type: 'autoLayout' }));
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
    optionsPanel.append(section('Shape', [
        choice('Lines', [['straight', 'Straight'], ['orthogonal', 'Right-angled']], display.routing,
            value => host.postMessage({ type: 'display', display: { routing: value as DisplayOptions['routing'] } })),
        choice('Arrangement', [
            ['layered', 'Layered (taxonomy)'],
            ['stress', 'Spread'],
            ['mrtree', 'Tree'],
            ['radial', 'Radial']
        ], layout?.algorithm ?? 'layered',
            value => host.postMessage({ type: 'layout', layout: { algorithm: value as LayoutOptions['algorithm'] } })),
        choice('Direction', [['DOWN', 'Top to bottom'], ['RIGHT', 'Left to right']], layout?.direction ?? 'DOWN',
            value => host.postMessage({ type: 'layout', layout: { direction: value as LayoutOptions['direction'] } })),
        // Not free: a class that would sit beside the one it specializes has to
        // stay inside its own package instead. Worth offering both ways round,
        // since which reads better depends on the model.
        toggle('Keep packages together', layout?.groupByPackage ?? true,
            value => host.postMessage({ type: 'layout', layout: { groupByPackage: value } }))
    ]));
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
    legendPanel.hidden = !display?.showColors;
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
