/**
 * The picture, as SVG text.
 *
 * A string rather than a live DOM, for three reasons: the same function draws
 * the export and the screen, a test can read what it produced, and the webview
 * can set it once and then move single elements by touching their transforms
 * rather than by re-rendering the diagram on every pointer move.
 */

import type { EdgeRoute, ViewEdge, ViewGenset, ViewModel, ViewNode, ViewRelation } from 'tonto-view';
import type { DisplayOptions } from 'tonto-view';
import type { Point, Rect } from './geometry.js';
import { alongPath, boundsOf, centerOf } from './geometry.js';
import { attributeLines, FONT, NODE, nodeLabel, stereotypeLabel, textWidth } from './measure.js';
import type { Positions } from './place.js';
import { routeEdge } from './route.js';
import type { Theme } from './theme.js';
import { lightTheme } from './theme.js';

export interface RenderInput {
    view: ViewModel;
    positions: Positions;
    display: DisplayOptions;
    /** Waypoints the modeller dragged, by edge id. */
    routes?: Record<string, EdgeRoute>;
    theme?: Theme;
    selection?: string[];
    padding?: number;
}

export interface Rendered {
    svg: string;
    bounds: Rect;
    /** The path each edge was drawn along, so the canvas can hit-test it. */
    paths: Record<string, Point[]>;
}

const GROUP_HEADER = 20;
const GROUP_PADDING = 18;

export function render(input: RenderInput): Rendered {
    const { view, positions, display } = input;
    const theme = input.theme ?? lightTheme;
    const padding = input.padding ?? 40;
    const selected = new Set(input.selection ?? []);
    const rects = view.nodes
        .map(node => positions[node.id])
        .filter((rect): rect is Rect => rect !== undefined);
    const groups = display.showPackageGroups ? groupBoxes(view, positions) : [];
    const bounds = boundsOf([...rects, ...groups.map(group => group.rect)]);
    const origin = { x: bounds.x - padding, y: bounds.y - padding };
    const width = Math.max(bounds.width + padding * 2, 1);
    const height = Math.max(bounds.height + padding * 2, 1);

    const paths: Record<string, Point[]> = {};
    const drawnByGenset = new Set<string>();
    const placer = new LabelPlacer(rects);
    const spreads = spreadIndex(view);
    const gensetMarkup = view.gensets
        .map(genset => drawGenset(genset, view, positions, theme, drawnByGenset, placer))
        .join('');

    // Labels are drawn last, over the boxes. A line may pass behind a class --
    // that reads as a line -- but a cardinality hidden behind one has simply
    // gone missing, and the reader has no way to know it was there.
    let labelMarkup = '';
    const edgeMarkup = view.edges
        .map(edge => {
            if (edge.kind === 'generalization' && drawnByGenset.has(edge.id)) {
                return '';
            }
            const source = positions[edge.source];
            const target = positions[edge.target];
            if (!source || !target) {
                return '';
            }
            const points = routeEdge(source, target, {
                ...(input.routes?.[edge.id]?.points ? { stored: input.routes[edge.id]!.points! } : {}),
                style: display.routing,
                spread: spreads.get(edge.id) ?? { index: 0, count: 1 },
                obstacles: rects
            });
            paths[edge.id] = points;
            labelMarkup += drawEdgeLabels(edge, points, display, theme, placer);
            return drawEdge(edge, points, theme, selected.has(edge.id));
        })
        .join('');

    const nodeMarkup = view.nodes
        .map(node => {
            const rect = positions[node.id];
            return rect ? drawNode(node, rect, display, theme, selected.has(node.id)) : '';
        })
        .join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${origin.x} ${origin.y} ${width} ${height}" width="${width}" height="${height}">
<style>
.tv-node rect { stroke: ${theme.line}; stroke-width: 1; }
.tv-node text { font-family: ${FONT.family}; fill: ${theme.onFill}; }
.tv-name { font-weight: 600; font-size: ${FONT.name}px; letter-spacing: 0.005em; }
.tv-stereotype { font-size: ${FONT.stereotype}px; fill-opacity: 0.72; letter-spacing: 0.01em; }
.tv-attribute { font-size: ${FONT.attribute}px; }
.tv-edge path { fill: none; stroke: ${theme.line}; stroke-width: 1.2; }
.tv-edge text { font-family: ${FONT.family}; font-size: ${FONT.edge}px; fill: ${theme.text}; font-variant-numeric: tabular-nums; }
.tv-edge .tv-end { fill: ${theme.muted}; }
.tv-reading { fill: ${theme.text}; stroke: none; }
.tv-lock { fill: none; stroke: ${theme.muted}; stroke-width: 1.1; stroke-linecap: round; }
.tv-lock rect { fill: ${theme.background}; }
.tv-marker { fill: ${theme.surface}; stroke: ${theme.line}; stroke-width: 1.2; }
.tv-arrow { fill: none; stroke: ${theme.line}; stroke-width: 1.2; }
.tv-group rect { fill: none; stroke: ${theme.muted}; stroke-dasharray: 4 3; }
.tv-group text { font-family: ${FONT.family}; font-size: ${FONT.stereotype}px; fill: ${theme.muted}; }
.tv-selected rect { stroke: ${theme.accent}; stroke-width: 2.5; }
.tv-selected path { stroke: ${theme.accent}; stroke-width: 2.2; }
.tv-unresolved rect { stroke-dasharray: 5 3; }
.tv-external rect { stroke-dasharray: 2 2; }
</style>
<rect x="${origin.x}" y="${origin.y}" width="${width}" height="${height}" fill="${theme.background}"/>
${groups.map(group => drawGroup(group)).join('')}${edgeMarkup}${gensetMarkup}${nodeMarkup}<g class="tv-labels">${labelMarkup}</g></svg>`;

    return { svg, bounds: { x: origin.x, y: origin.y, width, height }, paths };
}

/**
 * Which of the edges between a pair of boxes each edge is.
 *
 * Two relations between the same relator and class are one line drawn twice
 * unless they are told to run apart -- invisible with orthogonal corridors,
 * where the jog happens to differ, and unmissable with straight lines. The pair
 * is unordered: an edge drawn back the other way is still beside the first, not
 * on top of it.
 */
function spreadIndex(view: ViewModel): Map<string, { index: number; count: number }> {
    const groups = new Map<string, string[]>();
    for (const edge of view.edges) {
        const key = [edge.source, edge.target].sort().join('\u0000');
        groups.set(key, [...(groups.get(key) ?? []), edge.id]);
    }
    const spreads = new Map<string, { index: number; count: number }>();
    for (const ids of groups.values()) {
        ids.forEach((id, index) => spreads.set(id, { index, count: ids.length }));
    }
    return spreads;
}

function drawNode(node: ViewNode, rect: Rect, display: DisplayOptions, theme: Theme, isSelected: boolean): string {
    const stereotype = stereotypeLabel(node);
    const lines = attributeLines(node, display);
    const fill = display.showColors && node.kind !== 'unresolved' ? node.color : theme.surface;
    const classes = ['tv-node',
        node.kind === 'unresolved' ? 'tv-unresolved' : '',
        node.isExternal ? 'tv-external' : '',
        isSelected ? 'tv-selected' : ''
    ].filter(Boolean).join(' ');

    let y = rect.y + NODE.headerGap;
    let text = '';
    if (stereotype) {
        y += FONT.stereotype;
        text += `<text class="tv-stereotype" x="${rect.x + rect.width / 2}" y="${y}" text-anchor="middle">${escape(stereotype)}</text>`;
        y += NODE.stereotypeHeight - FONT.stereotype;
    }
    y += FONT.name;
    text += `<text class="tv-name" x="${rect.x + rect.width / 2}" y="${y}" text-anchor="middle">${escape(nodeLabel(node, display))}</text>`;
    y = rect.y + (stereotype ? NODE.stereotypeHeight : 0) + NODE.nameHeight + NODE.headerGap * 2;

    let compartment = '';
    if (lines.length > 0) {
        compartment += `<line x1="${rect.x}" y1="${y}" x2="${rect.x + rect.width}" y2="${y}" stroke="${theme.line}" stroke-width="1"/>`;
        let lineY = y + NODE.headerGap;
        for (const line of lines) {
            lineY += FONT.attribute;
            compartment += `<text class="tv-attribute" x="${rect.x + NODE.padding}" y="${lineY}">${escape(line)}</text>`;
            lineY += NODE.lineHeight - FONT.attribute;
        }
    }

    const title = node.documentation && display.showDocumentation
        ? `<title>${escape(node.documentation)}</title>`
        : '';
    return `<g class="${classes}" data-node="${escape(node.id)}">`
        + `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="3" fill="${fill}"/>`
        + title + text + compartment + '</g>';
}

function drawEdge(edge: ViewEdge, points: Point[], theme: Theme, isSelected: boolean): string {
    const path = `<path d="${pathData(points)}"${edge.kind === 'instantiation' ? ' stroke-dasharray="6 4"' : ''}/>`;
    const classes = `tv-edge${isSelected ? ' tv-selected' : ''}`;
    const decoration = edge.kind === 'generalization'
        ? triangleAt(points[points.length - 1]!, points[points.length - 2] ?? points[0]!)
        : edge.kind === 'instantiation'
            ? arrowAt(points[points.length - 1]!, points[points.length - 2] ?? points[0]!)
            : relationDecoration(edge, points, theme);
    return `<g class="${classes}" data-edge="${escape(edge.id)}">${path}${decoration}</g>`;
}

function drawEdgeLabels(
    edge: ViewEdge, points: Point[], display: DisplayOptions, theme: Theme, placer: LabelPlacer
): string {
    if (edge.kind === 'relation') {
        return relationLabels(edge, points, display, theme, placer);
    }
    if (edge.kind === 'instantiation') {
        return centreLabel(points, '«instanceOf»', theme, placer);
    }
    return '';
}

/**
 * Where a label can go.
 *
 * A label on the midpoint of its edge is right until the midpoint is inside a
 * class, or under the label of the edge running beside it -- and on a dense
 * model both happen constantly. So each label is offered a few positions along
 * its own line, in order of preference, and takes the first that is clear of the
 * boxes and of the labels already placed. Everything it has placed is remembered,
 * which is why one of these is made per drawing and not per edge.
 */
class LabelPlacer {
    private readonly taken: Rect[] = [];

    constructor(private readonly nodes: Rect[]) {}

    /**
     * The first clear candidate, or -- in a corner of the diagram where nothing
     * is clear -- the one that covers least.
     *
     * Taking the first candidate when all of them collide is what left
     * "«componenthood» has" printed across a class: the label had nowhere good
     * to go, and nowhere good was read as "anywhere". Least-bad still lands on
     * something, but on the smallest something, and usually on a line rather
     * than on a name.
     */
    place(candidates: Point[], text: string): Point {
        let best: { at: Point; box: Rect; penalty: number } | undefined;
        for (const candidate of candidates) {
            const box = boxOf(candidate, text);
            const penalty = this.penaltyOf(box);
            if (penalty === 0) {
                this.taken.push(box);
                return candidate;
            }
            if (!best || penalty < best.penalty) {
                best = { at: candidate, box, penalty };
            }
        }
        const fallback = best ?? { at: candidates[0] ?? { x: 0, y: 0 }, box: boxOf(candidates[0] ?? { x: 0, y: 0 }, text), penalty: 0 };
        this.taken.push(fallback.box);
        return fallback.at;
    }

    /**
     * Somewhere to put a mark that is not text -- the padlock, whose size is
     * known outright rather than estimated from a string.
     */
    reserve(candidates: Point[], width: number, height: number): Point {
        let best: { at: Point; box: Rect; penalty: number } | undefined;
        for (const candidate of candidates) {
            const box = { x: candidate.x - width / 2, y: candidate.y - height / 2, width, height };
            const penalty = this.penaltyOf(box);
            if (penalty === 0) {
                this.taken.push(box);
                return candidate;
            }
            if (!best || penalty < best.penalty) {
                best = { at: candidate, box, penalty };
            }
        }
        if (best) {
            this.taken.push(best.box);
            return best.at;
        }
        return candidates[0] ?? { x: 0, y: 0 };
    }

    /** How much of what is already drawn this label would cover. A class counts double. */
    private penaltyOf(box: Rect): number {
        let penalty = 0;
        for (const rect of this.nodes) {
            penalty += overlapArea(box, rect) * 2;
        }
        for (const rect of this.taken) {
            penalty += overlapArea(box, rect);
        }
        return penalty;
    }
}

function overlapArea(one: Rect, other: Rect): number {
    const width = Math.min(one.x + one.width, other.x + other.width) - Math.max(one.x, other.x);
    const height = Math.min(one.y + one.height, other.y + other.height) - Math.max(one.y, other.y);
    return width > 0 && height > 0 ? width * height : 0;
}

function boxOf(anchor: Point, text: string): Rect {
    const width = textWidth(text, FONT.edge) + 6;
    return { x: anchor.x - width / 2, y: anchor.y - FONT.edge, width, height: FONT.edge + 4 };
}

/** The whole-part diamond, on the end the language says holds the whole. */
function relationDecoration(edge: ViewRelation, points: Point[], _theme: Theme): string {
    if (!edge.whole) {
        return '';
    }
    const atSource = edge.whole === 'source';
    const tip = atSource ? points[0]! : points[points.length - 1]!;
    const towards = atSource ? points[1] ?? points[0]! : points[points.length - 2] ?? points[0]!;
    return diamondAt(tip, towards);
}

function relationLabels(
    edge: ViewRelation, points: Point[], display: DisplayOptions, theme: Theme, placer: LabelPlacer
): string {
    const middle: string[] = [];
    if (display.showRelationStereotypes && edge.stereotype) {
        middle.push(`«${edge.stereotype}»`);
    }
    const named = display.showRelationNames && Boolean(edge.name);
    if (named && edge.name) {
        middle.push(edge.name);
    }
    // UML's reading direction: the solid triangle beside the name says which way
    // round the sentence goes -- "University has Department", not the reverse.
    // It belongs to the name, so it is only drawn where there is one.
    let markup = middle.length > 0
        ? centreLabel(points, middle.join(' '), theme, placer, named ? 'forwards' : undefined)
        : '';
    markup += endLabel(edge, points, true, display, theme, placer);
    markup += endLabel(edge, points, false, display, theme, placer);
    return markup;
}

/**
 * What is written at one end of an association.
 *
 * Two labels, not one, on opposite sides of the line: the multiplicity where UML
 * puts it, and the role name with whatever the end redefines on the other. Run
 * together as one string they read as a single phrase -- "[2..*] members" -- and
 * on a busy diagram there is no telling which half belongs to which end.
 *
 * `const` is not written at all. An end that cannot change is the ordinary case
 * here, and a decoration on the ordinary case is noise on every line; the
 * exception gets the mark instead, as an open padlock.
 */
function endLabel(
    edge: ViewRelation, points: Point[], atSource: boolean, display: DisplayOptions, theme: Theme,
    placer: LabelPlacer
): string {
    const end = atSource ? edge.sourceEnd : edge.targetEnd;
    const total = pathLength(points);
    const forwards = atSource ? points : [...points].reverse();

    const role: string[] = [];
    if (display.showRoleNames && end.role) {
        role.push(end.role);
    }
    if (display.showEndDecorations) {
        if (end.isAddOnly) {
            role.push('{addOnly}');
        }
        if (end.subsets) {
            role.push(`{subsets ${end.subsets}}`);
        }
        if (end.redefines) {
            role.push(`{redefines ${end.redefines}}`);
        }
    }

    let markup = '';
    if (display.showCardinalities && end.cardinality) {
        markup += placeAtEnd(`[${end.cardinality}]`, forwards, total, [1, 2, -1], theme, placer);
    }
    if (role.length > 0) {
        markup += placeAtEnd(role.join(' '), forwards, total, [-1, -2, 1], theme, placer);
    }
    if (display.showEndDecorations && !end.isConst) {
        markup += padlock(forwards, total, theme, placer);
    }
    return markup;
}

/** A label a short way in from an end, on one side of the line by preference. */
function placeAtEnd(
    text: string, forwards: Point[], total: number, sides: number[], theme: Theme, placer: LabelPlacer
): string {
    const width = textWidth(text, FONT.edge);
    const candidates: Point[] = [];
    for (const distance of [17, 30, 46, 64]) {
        candidates.push(...besideLine(forwards, Math.min(distance, total * 0.45), width, sides));
    }
    const at = placer.place(candidates, text);
    return label(at.x, at.y, text, theme, 'middle', 'tv-end');
}

/**
 * An open padlock: this end may change.
 *
 * Drawn rather than written, and drawn open, because it marks the exception. A
 * word would be read as part of the role name beside it; a small glyph on the
 * line is read as a property of the line.
 */
function padlock(forwards: Point[], total: number, theme: Theme, placer: LabelPlacer): string {
    // On the role-name side and close in, where UML puts a property's
    // decoration, and then wherever it fits: a mark that lands on the
    // multiplicity beside it says less than no mark at all.
    const candidates: Point[] = [];
    for (const distance of [13, 24, 36]) {
        candidates.push(...besideLine(forwards, Math.min(distance, total * 0.4), 12, [-1, 1, -2, 2]));
    }
    const at = placer.reserve(candidates, 13, 13);
    const x = round(at.x - 5.3);
    const y = round(at.y - 7);
    return `<g class="tv-lock" transform="translate(${x}, ${y})" aria-label="not const">`
        + `<title>this end may change (not const)</title>`
        // The shackle stands off to one side and does not meet the body: a
        // closed one would say the opposite of what this marks.
        + `<path d="M 2 5 V 3.1 a 2.7 2.7 0 0 1 5.4 0"/>`
        + `<rect x="3.5" y="5" width="7.2" height="5.8" rx="1.4" stroke="${theme.muted}"/>`
        + `</g>`;
}

function centreLabel(
    points: Point[], text: string, theme: Theme, placer: LabelPlacer, reading?: 'forwards'
): string {
    const length = pathLength(points);
    // Outwards from the middle: the middle reads as "this whole line", and the
    // further a label sits from it the more it looks like it belongs to one end.
    const fractions = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74];
    // The estimate is calibrated for Helvetica and its metric twins; a machine
    // that has none of them sets the same string wider. The triangle is placed
    // off the end of the text, so it is the one thing that must allow for that
    // -- a mark on top of the last letter is worse than a slightly wide gap.
    const measured = textWidth(text, FONT.edge) * 1.06;
    const marker = reading ? 11 : 0;
    const width = measured + marker;
    const candidates = fractions.flatMap(fraction => {
        const at = length * fraction;
        return besideLine(points, at, width, [0, 1, -1, 2, -2]);
    });
    const at = placer.place(candidates, text);
    // The text keeps its place; the triangle sits after it, which is where a
    // reader expects the arrow of "A has B ▶" to be.
    const shifted = { x: at.x - marker / 2, y: at.y };
    let markup = label(shifted.x, shifted.y, text, theme, 'middle');
    if (reading) {
        const tip = { x: shifted.x + measured / 2 + marker, y: shifted.y - 3.5 };
        markup += readingTriangle(tip, directionNear(points, at));
    }
    return markup;
}

/** The direction the line runs at the point nearest `at`, source to target. */
function directionNear(points: Point[], at: Point): Point {
    let best: { direction: Point; distance: number } | undefined;
    for (let index = 0; index + 1 < points.length; index += 1) {
        const from = points[index]!;
        const to = points[index + 1]!;
        const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        const distance = Math.hypot(middle.x - at.x, middle.y - at.y);
        if (!best || distance < best.distance) {
            const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
            best = { direction: { x: (to.x - from.x) / length, y: (to.y - from.y) / length }, distance };
        }
    }
    return best?.direction ?? { x: 1, y: 0 };
}

/** UML's filled reading-direction triangle, pointing the way the name is read. */
function readingTriangle(tip: Point, direction: Point): string {
    const back = { x: tip.x - direction.x * 7, y: tip.y - direction.y * 7 };
    const normal = { x: -direction.y, y: direction.x };
    return `<polygon class="tv-reading" points="${round(tip.x)},${round(tip.y)} `
        + `${round(back.x + normal.x * 3.4)},${round(back.y + normal.y * 3.4)} `
        + `${round(back.x - normal.x * 3.4)},${round(back.y - normal.y * 3.4)}"/>`;
}

/**
 * Places beside the line at a point along it, stepped off along the line's own
 * perpendicular.
 *
 * Offsetting downwards is right for a horizontal edge and useless for a vertical
 * one, where it slides the label along the line it is trying to get off. On a
 * taxonomy -- where nearly every edge is vertical -- that was every label
 * landing on its own line or on the box below.
 */
function besideLine(points: Point[], at: number, width: number, steps: number[]): Point[] {
    const here = alongPath(points, true, at);
    const ahead = alongPath(points, true, at + 12);
    const dx = ahead.x - here.x;
    const dy = ahead.y - here.y;
    const length = Math.hypot(dx, dy) || 1;
    const vertical = Math.abs(dy) > Math.abs(dx);
    // Off a vertical line by half the label's width plus a margin, off a
    // horizontal one by a line's height: what it takes to clear it either way.
    const reach = vertical ? width / 2 + 8 : 13;
    const normal = { x: -(dy / length), y: dx / length };
    return steps.map(step => ({
        x: here.x + normal.x * reach * step,
        y: here.y + normal.y * reach * step + (vertical ? 4 : step === 0 ? -6 : 0)
    }));
}

function pathLength(points: Point[]): number {
    return points.slice(1).reduce((sum, point, index) => {
        const previous = points[index]!;
        return sum + Math.hypot(point.x - previous.x, point.y - previous.y);
    }, 0);
}

/**
 * Text with a halo of the paper colour, so a label that lands on a line is still
 * readable. `paint-order` draws the stroke first and the fill over it, which is
 * the one way to outline text without doubling the markup.
 */
function label(
    x: number, y: number, text: string, theme: Theme, anchor: 'middle' | 'start', className?: string
): string {
    return `<text${className ? ` class="${className}"` : ''} x="${round(x)}" y="${round(y)}" `
        + `text-anchor="${anchor}" paint-order="stroke" stroke="${theme.background}" stroke-width="3" `
        + `stroke-linejoin="round">${escape(text)}</text>`;
}

/**
 * A generalization set: one triangle, shared.
 *
 * Drawn only when the specialization all runs the same way -- every subtype
 * below the supertype, or every one above it -- because a shared triangle says
 * *these together partition that*, and a triangle with legs going three
 * directions says it less clearly than three separate arrows do. When the
 * arrangement does not allow it, the edges are left to draw themselves and the
 * set is named on each of them instead.
 */
function drawGenset(
    genset: ViewGenset,
    view: ViewModel,
    positions: Positions,
    theme: Theme,
    drawn: Set<string>,
    placer: LabelPlacer
): string {
    const general = genset.general ? positions[genset.general] : undefined;
    const specifics = genset.specifics
        .map(id => ({ id, rect: positions[id] }))
        .filter((entry): entry is { id: string; rect: Rect } => entry.rect !== undefined);
    if (!general || specifics.length < 2) {
        return '';
    }

    const generalCentre = centerOf(general);
    const below = specifics.every(entry => entry.rect.y >= general.y + general.height);
    const above = specifics.every(entry => entry.rect.y + entry.rect.height <= general.y);
    if (!below && !above) {
        return '';
    }

    const direction = below ? 1 : -1;
    const apex = { x: generalCentre.x, y: below ? general.y + general.height : general.y };
    const base = { x: apex.x, y: apex.y + 14 * direction };
    const nearest = below
        ? Math.min(...specifics.map(entry => entry.rect.y))
        : Math.max(...specifics.map(entry => entry.rect.y + entry.rect.height));
    const bus = Math.round((base.y + nearest) / 2);

    let markup = `<g class="tv-edge tv-genset" data-genset="${escape(genset.id)}">`;
    markup += `<polygon class="tv-marker" points="${apex.x},${apex.y} ${base.x - 9},${base.y} ${base.x + 9},${base.y}"/>`;
    markup += `<path d="M ${base.x} ${base.y} L ${base.x} ${bus}"/>`;
    const left = Math.min(...specifics.map(entry => centerOf(entry.rect).x), base.x);
    const right = Math.max(...specifics.map(entry => centerOf(entry.rect).x), base.x);
    markup += `<path d="M ${round(left)} ${bus} L ${round(right)} ${bus}"/>`;
    for (const entry of specifics) {
        const centre = centerOf(entry.rect);
        const top = below ? entry.rect.y : entry.rect.y + entry.rect.height;
        markup += `<path d="M ${round(centre.x)} ${bus} L ${round(centre.x)} ${round(top)}"/>`;
    }

    const constraints = [genset.disjoint ? 'disjoint' : '', genset.complete ? 'complete' : ''].filter(Boolean);
    const setLabel = constraints.length > 0 ? `${genset.name} {${constraints.join(', ')}}` : genset.name;
    const width = textWidth(setLabel, FONT.edge);
    const at = placer.place([
        { x: base.x + width / 2 + 14, y: bus - 6 },
        { x: base.x - width / 2 - 14, y: bus - 6 },
        { x: base.x + width / 2 + 14, y: bus + 16 },
        { x: base.x, y: bus - 20 }
    ], setLabel);
    markup += `<text x="${round(at.x)}" y="${round(at.y)}" fill="${theme.muted}" text-anchor="middle" `
        + `paint-order="stroke" stroke="${theme.background}" stroke-width="3" stroke-linejoin="round">${escape(setLabel)}</text>`;
    markup += '</g>';

    for (const edge of view.edges) {
        if (edge.kind === 'generalization' && edge.genset === genset.id) {
            drawn.add(edge.id);
        }
    }
    return markup;
}

function groupBoxes(view: ViewModel, positions: Positions): Array<{ id: string; name: string; rect: Rect }> {
    return view.groups
        .map(group => {
            const rects = group.nodes
                .map(id => positions[id])
                .filter((rect): rect is Rect => rect !== undefined);
            if (rects.length === 0) {
                return undefined;
            }
            const bounds = boundsOf(rects);
            return {
                id: group.id,
                name: group.name,
                rect: {
                    x: bounds.x - GROUP_PADDING,
                    y: bounds.y - GROUP_PADDING - GROUP_HEADER,
                    width: bounds.width + GROUP_PADDING * 2,
                    height: bounds.height + GROUP_PADDING * 2 + GROUP_HEADER
                }
            };
        })
        .filter((group): group is { id: string; name: string; rect: Rect } => group !== undefined);
}

function drawGroup(group: { id: string; name: string; rect: Rect }): string {
    const { rect } = group;
    return `<g class="tv-group" data-group="${escape(group.id)}">`
        + `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="4"/>`
        + `<text x="${rect.x + 8}" y="${rect.y + 14}">${escape(group.name)}</text></g>`;
}

/** A hollow triangle at `tip`, pointing away from `from`: UML's generalization. */
function triangleAt(tip: Point, from: Point): string {
    const { unit, normal } = direction(tip, from);
    const base = { x: tip.x + unit.x * 14, y: tip.y + unit.y * 14 };
    return `<polygon class="tv-marker" points="${round(tip.x)},${round(tip.y)} `
        + `${round(base.x + normal.x * 8)},${round(base.y + normal.y * 8)} `
        + `${round(base.x - normal.x * 8)},${round(base.y - normal.y * 8)}"/>`;
}

/** A hollow diamond at `tip`: the whole end of a parthood. */
function diamondAt(tip: Point, from: Point): string {
    const { unit, normal } = direction(tip, from);
    const middle = { x: tip.x + unit.x * 8, y: tip.y + unit.y * 8 };
    const back = { x: tip.x + unit.x * 16, y: tip.y + unit.y * 16 };
    return `<polygon class="tv-marker" points="${round(tip.x)},${round(tip.y)} `
        + `${round(middle.x + normal.x * 6)},${round(middle.y + normal.y * 6)} `
        + `${round(back.x)},${round(back.y)} `
        + `${round(middle.x - normal.x * 6)},${round(middle.y - normal.y * 6)}"/>`;
}

/** An open arrowhead: instantiation, which is a dependency and not a taxonomy. */
function arrowAt(tip: Point, from: Point): string {
    const { unit, normal } = direction(tip, from);
    const base = { x: tip.x + unit.x * 11, y: tip.y + unit.y * 11 };
    return `<path class="tv-arrow" d="M ${round(base.x + normal.x * 6)} ${round(base.y + normal.y * 6)} `
        + `L ${round(tip.x)} ${round(tip.y)} `
        + `L ${round(base.x - normal.x * 6)} ${round(base.y - normal.y * 6)}"/>`;
}

function direction(tip: Point, from: Point): { unit: Point; normal: Point } {
    const dx = from.x - tip.x;
    const dy = from.y - tip.y;
    const length = Math.hypot(dx, dy) || 1;
    const unit = { x: dx / length, y: dy / length };
    return { unit, normal: { x: -unit.y, y: unit.x } };
}

function pathData(points: Point[]): string {
    return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${round(point.x)} ${round(point.y)}`).join(' ');
}

function round(value: number): number {
    return Math.round(value * 10) / 10;
}

function escape(text: string): string {
    return text
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}
