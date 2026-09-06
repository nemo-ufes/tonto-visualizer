/**
 * The picture, as SVG text.
 *
 * A string rather than a live DOM, for three reasons: the same function draws
 * the export and the screen, a test can read what it produced, and the webview
 * can set it once and then move single elements by touching their transforms
 * rather than by re-rendering the diagram on every pointer move.
 */

import type { EdgeRoute, ViewEdge, ViewModel, ViewNode, ViewRelation, ViewRelationEnd } from 'tonto-view';
import type { DisplayOptions } from 'tonto-view';
import { inversePairs } from 'tonto-view/inverses';
import type { Point, Rect } from './geometry.js';
import { alongPath, boundsOf, centerOf, distanceToPath, segmentHitsRect } from './geometry.js';
import { attributeLines, FONT, multiplicityLabel, NODE, nodeLabel, stereotypeLabel, textWidth } from './measure.js';
import type { Positions } from './place.js';
import { assignPorts, endKey } from './ports.js';
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

/** Whether the straight line between two boxes has anything else in the way. */
function isClear(positions: Record<string, Rect>, one: string, other: string, view: ViewModel): boolean {
    const from = positions[one];
    const to = positions[other];
    if (!from || !to) {
        return false;
    }
    const start = centerOf(from);
    const end = centerOf(to);
    return !view.nodes.some(node => {
        const rect = node.id === one || node.id === other ? undefined : positions[node.id];
        return rect !== undefined && segmentHitsRect(start, end, rect, 6);
    });
}

/**
 * The mediation ends that meet a relator.
 *
 * A relator is a reified relationship: the mediations are what it relates by,
 * and the reader follows them through it, from one relatum to the other. It is
 * the nature that decides, not the stereotype -- a role played by a relator, an
 * employment under contract, is as much the relationship as the relator it
 * specializes.
 */
function mediationsThrough(
    view: ViewModel, positions: Record<string, Rect>, covered: ReadonlySet<string> = new Set()
): Set<string> {
    const relators = new Set(view.nodes
        .filter(node => node.stereotype === 'relator' || node.natures?.natures.includes('relators'))
        .map(node => node.id));
    const mediations = view.edges.filter(edge =>
        edge.kind === 'relation' && edge.stereotype === 'mediation' && edge.source !== edge.target
        && !covered.has(edge.id));

    // A relator that mediates one class twice -- a marriage and its two spouses
    // -- cannot be read through: both lines leave for the same place, and aiming
    // them both at the centre points them along each other. Those keep their
    // share of the border, which is what tells them apart.
    const twice = new Set<string>();
    const seen = new Set<string>();
    for (const edge of mediations) {
        for (const end of [edge.source, edge.target]) {
            if (!relators.has(end)) {
                continue;
            }
            const pair = endKey(end === edge.source ? edge.target : edge.source, end);
            if (seen.has(pair)) {
                twice.add(pair);
            }
            seen.add(pair);
        }
    }

    const through = new Set<string>();
    for (const edge of mediations) {
        for (const end of [edge.source, edge.target]) {
            const far = end === edge.source ? edge.target : edge.source;
            const pair = endKey(far, end);
            // A line that has to go round something is not read through the
            // relator whatever it is anchored on: it leaves for its detour long
            // before the reader can follow it across. Those keep their share of
            // the border, which is at least where the labels expect them.
            if (relators.has(end) && !twice.has(pair) && isClear(positions, end, far, view)) {
                through.add(endKey(edge.id, end));
            }
        }
    }
    return through;
}

/**
 * Which half of each inverse pair is drawn, and which half it speaks for.
 *
 * `Man.hasChild inverseOf Person.hasFather` is one association stated twice, and
 * drawing it twice puts two lines between the same pair of classes saying the
 * same thing in opposite directions -- the reader counts two relationships where
 * the model has one. So the pair is drawn as one line with both readings written
 * on it, and the other half is covered: not routed, not drawn, and not counted
 * as a line by the label placer.
 *
 * Which of the two keeps the line is decided by their ids, not by which was
 * written first. A saved route belongs to an id, and the line has to stay the
 * same line when the modeller moves a declaration from one file to another.
 *
 * The pair has to agree. `derive` marks both halves, so a relation whose
 * `inverseOf` is not returned is one of several claiming the same partner --
 * a model the validator rejects, and one where drawing fewer lines than there
 * are relations would hide the mistake.
 */
/**
 * The two halves of an inverse pair as the one relation they state.
 *
 * The ends are the same two ends written twice, so the line carries each of them
 * once -- but the two declarations need not spell the same one out equally.
 * `Person.hasEmployment` names the role `employments` where its inverse leaves
 * that end unnamed, and dropping the half that happens not to be drawn would
 * lose the role name off the picture.
 *
 * Merging is a spread because `endOf` leaves an unstated field out of the object
 * rather than setting it undefined: the drawn half wins wherever it says
 * anything, and the other fills the gaps.
 */
function mergedWith(edge: ViewRelation, partner: ViewRelation): ViewRelation {
    const merge = (one: ViewRelationEnd, other: ViewRelationEnd): ViewRelationEnd => ({ ...other, ...one });
    return {
        ...edge,
        sourceEnd: merge(edge.sourceEnd, partner.targetEnd),
        targetEnd: merge(edge.targetEnd, partner.sourceEnd),
        // The diamond is on an end, so it crosses over with the end it is on.
        ...(edge.whole || !partner.whole
            ? {}
            : { whole: partner.whole === 'source' ? 'target' as const : 'source' as const })
    };
}

export function render(input: RenderInput): Rendered {
    const { view, positions, display } = input;
    const theme = input.theme ?? lightTheme;
    const padding = input.padding ?? 40;
    const selected = new Set(input.selection ?? []);
    const rects = view.nodes
        .map(node => positions[node.id])
        .filter((rect): rect is Rect => rect !== undefined);
    const groups = display.showPackageGroups ? groupBoxes(view, positions) : [];

    // Where each line meets each box, spread along the border so that two
    // associations between the same neighbours do not arrive as one line --
    // except at a relator, where a mediation is anchored on the ray out of the
    // centre so that the pair of them reads as one line passing through it.
    // An inverse pair is one line, decided before the ends are spread along the
    // borders: the half that is not drawn must not be given a share of a border
    // either, or the line that is drawn arrives beside the space kept for it.
    const inverses = inversePairs(view.edges);
    const drawn = view.edges.filter(edge => !inverses.covered.has(edge.id));
    const ports = assignPorts(drawn, positions, mediationsThrough(view, positions, inverses.covered));
    const loops = loopIndex(view);

    // Every route is computed before any label is placed. A label belongs to one
    // line and has to be read against it, so the placer has to know where all of
    // them run -- including the ones drawn after it.
    // Decided before anything is routed: the edges a tree takes over are not
    // lines of their own.
    const trees = planTrees(view, positions);
    const paths: Record<string, Point[]> = {};
    const bends: Point[] = [];
    for (const edge of drawn) {
        if (trees.covered.has(edge.id)) {
            continue;
        }
        const source = positions[edge.source];
        const target = positions[edge.target];
        if (!source || !target) {
            continue;
        }
        paths[edge.id] = routeEdge(source, target, {
            avoid: bends,
            ...(input.routes?.[edge.id]?.points ? { stored: input.routes[edge.id]!.points! } : {}),
            ...(ports.get(edge.id) ? { ends: ports.get(edge.id)! } : {}),
            ...(loops.get(edge.id) ? { loop: loops.get(edge.id)! } : {}),
            style: display.routing,
            obstacles: rects
        });
        // Whatever this line bent around, the next one goes round elsewhere.
        bends.push(...paths[edge.id]!.slice(1, -1));
    }
    const placer = new LabelPlacer(rects, groups.map(group => group.rect), paths);
    const buses: BusLine[] = [];
    const treeMarkup = trees.plans
        .map(plan => drawTree(plan, positions, theme, placer, rects, buses))
        .join('');

    // Labels are drawn last, over the boxes. A line may pass behind a class --
    // that reads as a line -- but a cardinality hidden behind one has simply
    // gone missing, and the reader has no way to know it was there.
    let labelMarkup = '';
    const edgeMarkup = drawn
        .map(edge => {
            if (trees.covered.has(edge.id)) {
                return '';
            }
            const source = positions[edge.source];
            const target = positions[edge.target];
            if (!source || !target) {
                return '';
            }
            const points = paths[edge.id]!;
            // An inverse pair is drawn from what both halves say, so the
            // half that keeps the line carries the other's ends and its name.
            const partner = edge.kind === 'relation' ? inverses.partnerOf.get(edge.id) : undefined;
            const both = edge.kind === 'relation' && partner ? mergedWith(edge, partner) : edge;
            labelMarkup += drawEdgeLabels(both, points, display, theme, placer, partner);
            return drawEdge(
                both, points, theme,
                selected.has(edge.id) || (partner !== undefined && selected.has(partner.id))
            );
        })
        .join('');

    // Sized after everything is placed, and around what was placed. A label
    // that could not find room near its line ends up some way from it, and a
    // drawing sized to the boxes alone cropped it -- a relation's name half off
    // the left edge, in an export nobody could correct.
    const pathPoints = Object.values(paths).flat()
        .map(point => ({ ...point, width: 0, height: 0 }));
    const bounds = boundsOf([...rects, ...groups.map(group => group.rect), ...placer.boxes(), ...pathPoints]);
    const origin = { x: bounds.x - padding, y: bounds.y - padding };
    const width = Math.max(bounds.width + padding * 2, 1);
    const height = Math.max(bounds.height + padding * 2, 1);

    const nodeMarkup = view.nodes
        .map(node => {
            const rect = positions[node.id];
            return rect ? drawNode(node, rect, display, theme, selected.has(node.id)) : '';
        })
        .join('');

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${origin.x} ${origin.y} ${width} ${height}" width="${width}" height="${height}">
<style>
/* Everything that is text, before anything specialises it. The label layer sits
   above the boxes and outside every other group, so a rule that reached labels
   through their edge stopped reaching them the day they were lifted out of it --
   and an SVG with no font-family on a text element falls back to a 16px serif.
   Stated once at the top, no layer can lose it again. */
text {
    font-family: ${FONT.family};
    font-size: ${FONT.edge}px;
    fill: ${theme.text};
    font-variant-numeric: tabular-nums;
}
.tv-node rect { stroke: ${theme.line}; stroke-width: 1; }
.tv-node text { fill: ${theme.onFill}; }
.tv-name { font-weight: 600; font-size: ${FONT.name}px; letter-spacing: 0.005em; }
.tv-stereotype { font-size: ${FONT.stereotype}px; fill-opacity: 0.72; letter-spacing: 0.01em; }
.tv-attribute { font-size: ${FONT.attribute}px; }
.tv-edge path { fill: none; stroke: ${theme.line}; stroke-width: 1.2; }
.tv-end { fill: ${theme.muted}; }
.tv-edge-stereotype { font-size: ${FONT.edgeStereotype}px; fill-opacity: 0.78; letter-spacing: 0.01em; }
.tv-marker { fill: ${theme.surface}; stroke: ${theme.line}; stroke-width: 1.2; }
.tv-arrow { fill: none; stroke: ${theme.line}; stroke-width: 1.2; }
.tv-reading { fill: ${theme.text}; stroke: none; }
.tv-lock { fill: none; stroke: ${theme.muted}; stroke-width: 1.1; stroke-linecap: round; }
.tv-lock rect { fill: ${theme.background}; }
.tv-group rect { fill: none; stroke: ${theme.muted}; stroke-dasharray: 4 3; }
.tv-group text { font-size: ${FONT.stereotype}px; fill: ${theme.muted}; }
.tv-selected rect { stroke: ${theme.accent}; stroke-width: 2.5; }
.tv-selected path { stroke: ${theme.accent}; stroke-width: 2.2; }
.tv-unresolved rect { stroke-dasharray: 5 3; }
.tv-external rect { stroke-dasharray: 2 2; }
</style>
<rect x="${origin.x}" y="${origin.y}" width="${width}" height="${height}" fill="${theme.background}"/>
${groups.map(group => drawGroup(group)).join('')}${edgeMarkup}${treeMarkup}${nodeMarkup}<g class="tv-labels">${labelMarkup}</g></svg>`;

    return { svg, bounds: { x: origin.x, y: origin.y, width, height }, paths };
}

/** Which of a class's loops each self-relation is, so no two are drawn alike. */
function loopIndex(view: ViewModel): Map<string, { index: number; count: number }> {
    const byNode = new Map<string, string[]>();
    for (const edge of view.edges) {
        if (edge.source === edge.target) {
            byNode.set(edge.source, [...(byNode.get(edge.source) ?? []), edge.id]);
        }
    }
    const loops = new Map<string, { index: number; count: number }>();
    for (const ids of byNode.values()) {
        // By id, which is the order the ports were given out in. The index sets
        // how far out a loop runs, so if the two disagree the loop with the
        // wider berth can start from the inner port and cross the other.
        [...ids].sort((one, other) => one.localeCompare(other))
            .forEach((id, index) => loops.set(id, { index, count: ids.length }));
    }
    return loops;
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
    edge: ViewEdge, points: Point[], display: DisplayOptions, theme: Theme, placer: LabelPlacer,
    partner?: ViewRelation
): string {
    if (edge.kind === 'relation') {
        return relationLabels(edge, points, display, theme, placer, partner);
    }
    if (edge.kind === 'instantiation') {
        return centreLabel(points, [{ stereotype: '«instanceOf»' }], theme, placer, edge.id);
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
/**
 * What being far from home costs, per pixel, in the same units as an overlap.
 *
 * Charged by distance rather than by position in the candidate list. The list is
 * ordered by preference, but its steps are not equal: with the candidates
 * ordered so that a label slides along its line before stepping off it, the
 * seventh entry was a few pixels away and cost seven times the first. A label
 * could not afford to move aside and stayed where it was misread instead.
 */
const DISPLACEMENT = 5;

class LabelPlacer {
    private readonly taken: Rect[] = [];

    /**
     * @param nodes the class boxes, which a label must not cover
     * @param groups the package boxes, which it should rather not cross -- a
     *   dashed border under a multiplicity is untidy where a class name under
     *   one is unreadable, so they weigh less than a class and more than nothing
     * @param lines every routed edge, so a label can be kept nearer the line it
     *   belongs to than to any other. A multiplicity that sits closer to the
     *   neighbouring association than to its own is read against the wrong one,
     *   and nothing about the drawing says otherwise
     */
    constructor(
        private readonly nodes: Rect[],
        private readonly groups: Rect[] = [],
        private readonly lines: Record<string, Point[]> = {}
    ) {}

    /**
     * The best of the candidates: what it would cover, plus what it costs to be
     * that far from where the label belongs.
     *
     * Both halves are needed. Taking the first candidate when all of them
     * collide is what left "«componenthood» has" printed across a class -- the
     * label had nowhere good to go, and nowhere good was read as "anywhere".
     * Taking the first *clear* one is what sent "«membership» includes" a
     * hundred and fifty pixels out into open space, still clear of everything
     * and no longer beside any line: emptiness was free, so the placer bought
     * as much of it as it liked. Candidates arrive in order of preference, so
     * position in the list is what being far from home costs.
     */
    place(candidates: Point[], text: string, owner?: string): Point {
        const home = candidates[0];
        let best: { at: Point; box: Rect; score: number } | undefined;
        for (const candidate of candidates) {
            const box = boxOf(candidate, text);
            const score = this.penaltyOf(box, owner) + displacementFrom(home, candidate);
            if (!best || score < best.score) {
                best = { at: candidate, box, score };
            }
            if (score === 0) {
                break;
            }
        }
        const fallback = best ?? { at: candidates[0] ?? { x: 0, y: 0 }, box: boxOf(candidates[0] ?? { x: 0, y: 0 }, text), score: 0 };
        this.taken.push(fallback.box);
        return fallback.at;
    }

    /**
     * The best of the candidates for a block whose size is known outright -- a
     * label of more than one line, where the text alone does not say how tall it
     * is. Scored like `place`, and it claims what it takes.
     */
    placeBox(candidates: Point[], width: number, height: number, owner?: string): Point {
        const home = candidates[0];
        let best: { at: Point; box: Rect; score: number } | undefined;
        for (const candidate of candidates) {
            const box = { x: candidate.x - width / 2, y: candidate.y - height / 2, width, height };
            const score = this.penaltyOf(box, owner) + displacementFrom(home, candidate);
            if (!best || score < best.score) {
                best = { at: candidate, box, score };
            }
            if (score === 0) {
                break;
            }
        }
        const fallback = best ?? {
            at: candidates[0] ?? { x: 0, y: 0 },
            box: { x: 0, y: 0, width, height },
            score: 0
        };
        this.taken.push(fallback.box);
        return fallback.at;
    }

    /** What this box would cover, without claiming it. */
    cost(box: Rect, owner?: string): number {
        return this.penaltyOf(box, owner);
    }

    /** Claims a box, so whatever is placed next avoids it. */
    take(box: Rect): void {
        this.taken.push(box);
    }

    /** Everything placed so far, so the drawing can be sized to include it. */
    boxes(): Rect[] {
        return this.taken;
    }

    /**
     * How much of what is already drawn this label would cover.
     *
     * A class weighs most: a multiplicity over a class name costs the reader
     * both, where the same multiplicity a little further from its line costs
     * only a glance. Another label weighs less than a class and more than a
     * dashed package border. The numbers only have to be right against
     * DISPLACEMENT, which is what moving away costs -- set too low, a label
     * would rather sit on a box than take four steps, which is how they came to
     * be printed across SeniorStaff and EmploymentContract.
     */
    private penaltyOf(box: Rect, owner?: string): number {
        let penalty = 0;
        for (const rect of this.nodes) {
            penalty += overlapArea(box, rect) * 6;
        }
        for (const rect of this.taken) {
            penalty += overlapArea(box, rect) * 2;
        }
        for (const rect of this.groups) {
            // Only the border matters: a package box is mostly empty, and a
            // label inside one is where labels belong.
            penalty += borderOverlap(box, rect) * 0.6;
        }
        if (owner) {
            penalty += this.misreading(box, owner);
        }
        return penalty;
    }

    /**
     * What it costs to sit nearer somebody else's line than one's own.
     *
     * The reader has nothing but distance to go on: a multiplicity is read
     * against whichever line it is closest to, and on a busy diagram that is
     * regularly not the line it belongs to. Charged by how much closer the wrong
     * line is, so a label that is merely near two lines pays little and one that
     * has plainly settled on the wrong line pays a great deal.
     */
    private misreading(box: Rect, owner: string): number {
        const own = this.lines[owner];
        if (!own) {
            return 0;
        }
        const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        const mine = distanceToPath(centre, own);
        let nearest = Infinity;
        for (const [id, path] of Object.entries(this.lines)) {
            if (id !== owner) {
                nearest = Math.min(nearest, distanceToPath(centre, path));
            }
        }
        return nearest < mine ? 260 + (mine - nearest) * 14 : 0;
    }
}

/** How much of a box lies across another's outline rather than inside it. */
function borderOverlap(box: Rect, frame: Rect): number {
    const inside = overlapArea(box, {
        x: frame.x + 2, y: frame.y + 2, width: Math.max(frame.width - 4, 0), height: Math.max(frame.height - 4, 0)
    });
    return overlapArea(box, frame) - inside;
}

function displacementFrom(home: Point | undefined, candidate: Point): number {
    return home ? Math.hypot(candidate.x - home.x, candidate.y - home.y) * DISPLACEMENT : 0;
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

/**
 * What is written along an association, and for an inverse pair what is written
 * along the one line that stands for both.
 *
 * The line runs the way the drawn half is written, so that half reads forwards
 * and its inverse reads back along the same line. Each keeps its own reading
 * triangle, which is what makes one line carry two sentences without ambiguity:
 * `Man hasChild ▶ Person` and `◀ hasFather`.
 *
 * A stereotype stays over the name it belongs to, as UML sets it, and is written
 * once when both halves declare the same one. They often do not -- a material
 * relation is regularly the inverse of a mediation -- and saying `«material»`
 * over a line that is half a mediation would be the picture disagreeing with the
 * model.
 */
function relationLabels(
    edge: ViewRelation, points: Point[], display: DisplayOptions, theme: Theme, placer: LabelPlacer,
    partner?: ViewRelation
): string {
    const stereotypeOf = (one: ViewRelation): string | undefined =>
        (display.showRelationStereotypes && one.stereotype ? `«${one.stereotype}»` : undefined);
    const nameOf = (one: ViewRelation): string | undefined =>
        (display.showRelationNames && one.name ? one.name : undefined);

    const shared = partner !== undefined && edge.stereotype === partner.stereotype;
    const readings: Reading[] = [reading(stereotypeOf(edge), nameOf(edge), 'forward')];
    if (partner) {
        readings.push(reading(shared ? undefined : stereotypeOf(partner), nameOf(partner), 'backward'));
    }

    let markup = centreLabel(points, readings, theme, placer, edge.id);
    markup += endLabel(edge, points, true, display, theme, placer);
    markup += endLabel(edge, points, false, display, theme, placer);
    return markup;
}

/** A reading, with its triangle only where there is a name to point away from. */
function reading(stereotype: string | undefined, name: string | undefined, along: Reading['direction']): Reading {
    return {
        ...(stereotype ? { stereotype } : {}),
        ...(name ? { name, direction: along } : {})
    };
}

/**
 * What is written at one end of an association: the multiplicity, the role name
 * with whatever the end redefines, and the padlock if the end is not const.
 *
 * Placed as one group rather than as three labels that happen to be near each
 * other. Each found its own spot before, and where all three occurred together
 * they scattered -- a multiplicity tight against the box, a role name forty
 * pixels further along, a padlock across the line from both. None of them read
 * as belonging to the same end, and on a class with several associations
 * leaving it some of them read as belonging to the wrong one.
 *
 * So one distance from the end is chosen for the whole group, and the two sides
 * of the line are used as UML uses them: the multiplicity on one, the role name
 * on the other, level with each other. The padlock travels with the role name,
 * after it, where a property string like `{addOnly}` goes -- and alone on that
 * side when there is no role name to travel with, opposite the multiplicity
 * rather than adrift.
 *
 * `const` itself is never written. An end that cannot change is the ordinary
 * case here, and a decoration on the ordinary case is noise on every line; the
 * exception gets the mark instead.
 */
function endLabel(
    edge: ViewRelation, points: Point[], atSource: boolean, display: DisplayOptions, theme: Theme,
    placer: LabelPlacer
): string {
    const end = atSource ? edge.sourceEnd : edge.targetEnd;
    const multiplicity = display.showCardinalities ? multiplicityLabel(end.cardinality) : undefined;

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
    const roleText = role.join(' ');
    const lock = display.showEndDecorations && !end.isConst;
    if (!multiplicity && !roleText && !lock) {
        return '';
    }

    const forwards = atSource ? points : [...points].reverse();
    const total = pathLength(points);
    const reach = Math.min(total * 0.45, 64);
    const multiplicityWidth = multiplicity ? textWidth(multiplicity, FONT.edge) : 0;
    const textOnly = textWidth(roleText, FONT.edge);
    const roleWidth = textOnly + (lock ? LOCK.width + LOCK.gap : 0);

    let best: { multiplicity?: Placed; role?: Placed; cost: number } | undefined;
    for (const distance of [13, 18, 24, 32, 42, 54]) {
        const at = Math.min(distance, reach);
        for (const side of [1, -1]) {
            const placedMultiplicity = multiplicity
                ? placedAt(besideLine(forwards, at, multiplicityWidth, [side])[0]!, multiplicityWidth)
                : undefined;
            const placedRole = roleWidth > 0
                ? placedAt(besideLine(forwards, at, roleWidth, [-side])[0]!, roleWidth)
                : undefined;
            // Turning the group over has a price, since which side the
            // multiplicity is on says something and says less if it changes from
            // line to line -- but less of a price than being read against the
            // wrong line, which is what the other side is often the way out of.
            const cost = (placedMultiplicity ? placer.cost(placedMultiplicity.box, edge.id) : 0)
                + (placedRole ? placer.cost(placedRole.box, edge.id) : 0)
                + (at - 13) * DISPLACEMENT
                + (side === 1 ? 0 : 120);
            if (!best || cost < best.cost) {
                best = {
                    ...(placedMultiplicity ? { multiplicity: placedMultiplicity } : {}),
                    ...(placedRole ? { role: placedRole } : {}),
                    cost
                };
            }
        }
        if (best?.cost === 0) {
            break;
        }
    }
    if (!best) {
        return '';
    }

    let markup = '';
    if (best.multiplicity && multiplicity) {
        placer.take(best.multiplicity.box);
        markup += label(best.multiplicity.at.x, best.multiplicity.at.y, multiplicity, theme, 'middle', 'tv-end', edge.id);
    }
    if (best.role) {
        placer.take(best.role.box);
        const { at } = best.role;
        // The group is centred on `at`: the text takes the left of it and the
        // padlock follows, so a role name and its mark read in that order
        // however wide the name is.
        const left = at.x - roleWidth / 2;
        if (roleText) {
            markup += label(left + textOnly / 2, at.y, roleText, theme, 'middle', 'tv-end', edge.id);
        }
        if (lock) {
            markup += padlock({ x: left + textOnly + (roleText ? LOCK.gap : 0), y: at.y - LOCK.height + 3 }, theme, edge.id);
        }
    }
    return markup;
}

/** A label and the box it will occupy. */
interface Placed {
    at: Point;
    box: Rect;
}

function placedAt(at: Point, width: number): Placed {
    return { at, box: { x: at.x - width / 2, y: at.y - FONT.edge, width, height: FONT.edge + 4 } };
}

const LOCK = { width: 11, height: 11, gap: 4 } as const;

/**
 * An open padlock: this end may change.
 *
 * Drawn rather than written, and drawn open, because it marks the exception. A
 * word would be read as part of the role name beside it; a small glyph after it
 * is read as a property of the end, which is where UML puts `{addOnly}` and the
 * rest.
 */
function padlock(at: Point, theme: Theme, owner: string): string {
    return `<g class="tv-lock" data-for="${escape(owner)}" `
        + `transform="translate(${round(at.x)}, ${round(at.y)})" aria-label="not const">`
        + `<title>this end may change (not const)</title>`
        + `<path d="M 1.4 4.6 V 2.9 a 2.5 2.5 0 0 1 5 0"/>`
        + `<rect x="2.8" y="4.6" width="6.8" height="5.4" rx="1.3" stroke="${theme.muted}"/>`
        + `</g>`;
}
/**
 * One sentence written along a line: a name, and over it the stereotype.
 *
 * Two lines rather than one, because they are not the same kind of thing: the
 * stereotype says what sort of relation this is and the name says what it is
 * called, and `«mediation» binds` run together reads as a four-word phrase. UML
 * sets the stereotype over the name for the same reason it sets it over a class
 * name. It is set smaller here too, so a line of a model does not begin with the
 * word «characterization» in the same size as everything else.
 */
interface Reading {
    stereotype?: string;
    name?: string;
    /** Which way along the line the name reads; `forward` is source to target. */
    direction?: 'forward' | 'backward';
}

/**
 * Everything written at the middle of one line, as one block.
 *
 * A line usually carries one reading. An inverse pair carries two, and they are
 * placed together rather than found a spot each: they belong to the same line,
 * and two blocks bidding separately for room near it end up on opposite sides
 * of it, reading as the labels of two different lines -- which is the thing
 * drawing the pair as one line was for.
 */
function centreLabel(
    points: Point[],
    readings: Reading[],
    theme: Theme,
    placer: LabelPlacer,
    owner?: string
): string {
    // A margin over the estimate, since the triangle is placed off the end of
    // the text and a mark on the last letter is worse than a small gap. The
    // estimate is weighted per character, so the margin can be small -- and the
    // name is now on its own, without the guillemets the estimate overshoots on.
    const nameWidth = (one: Reading) => (one.name ? textWidth(one.name, FONT.edge) * 1.02 : 0);
    const markerOf = (one: Reading) => (one.direction && one.name ? MARKER : 0);
    const lines = readings.filter(one => one.stereotype !== undefined || one.name !== undefined);
    if (lines.length === 0) {
        return '';
    }

    const width = Math.max(...lines.map(one => Math.max(
        nameWidth(one) + markerOf(one),
        one.stereotype ? textWidth(one.stereotype, FONT.edgeStereotype) : 0
    )));
    const height = lines.reduce((total, one) =>
        total + (one.stereotype ? LINE.stereotype : 0) + (one.name ? LINE.name : 0), 0);

    // Outwards from the middle, and step-major: a label that cannot sit at the
    // middle of its line belongs a little further along it, not a label's width
    // out to the side.
    const length = pathLength(points);
    const fractions = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74];
    const candidates = [0, 1, -1, 2, -2].flatMap(step =>
        fractions.map(fraction => besideLine(points, length * fraction, { width, height }, [step])[0]!));
    const at = placer.placeBox(candidates, width, height, owner);

    let markup = '';
    let top = at.y - height / 2;
    for (const one of lines) {
        if (one.stereotype) {
            markup += label(at.x, top + LINE.stereotype - 2, one.stereotype, theme, 'middle', 'tv-edge-stereotype', owner);
            top += LINE.stereotype;
        }
        if (one.name) {
            // The name keeps the middle and the triangle sits just off the end
            // it points at, which is where a reader expects the arrow of
            // "A has B ▶" to be -- and of "◀ B is had by A" on the way back.
            const baseline = top + LINE.name - 3;
            const marker = markerOf(one);
            const back = one.direction === 'backward' ? -1 : 1;
            const centre = at.x - back * marker / 2;
            markup += label(centre, baseline, one.name, theme, 'middle', undefined, owner);
            if (marker > 0) {
                const along = directionNear(points, at);
                const tip = { x: centre + back * (nameWidth(one) / 2 + marker), y: baseline - 3.5 };
                markup += readingTriangle(tip, { x: along.x * back, y: along.y * back });
            }
            top += LINE.name;
        }
    }
    return markup;
}

/** Height of each line of a centre label, and how far the triangle stands off. */
const LINE = { stereotype: 12, name: 14 } as const;
const MARKER = 9;

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
function besideLine(points: Point[], at: number, size: number | { width: number; height: number }, steps: number[]): Point[] {
    const here = alongPath(points, true, at);
    const ahead = alongPath(points, true, at + 12);
    const dx = ahead.x - here.x;
    const dy = ahead.y - here.y;
    const length = Math.hypot(dx, dy) || 1;
    const vertical = Math.abs(dy) > Math.abs(dx);
    const width = typeof size === 'number' ? size : size.width;
    const height = typeof size === 'number' ? FONT.edge + 2 : size.height;
    // Off a vertical line by half the label's width plus a margin, off a
    // horizontal one by half its height: what it takes to clear it either way.
    const reach = vertical ? width / 2 + 9 : height / 2 + 7;
    let normal = { x: -(dy / length), y: dx / length };
    // Turned so that side 1 is always up or to the right, whichever way the
    // line runs. Without this the multiplicity sits above one line and below
    // the next, and which side a label is on stops meaning anything.
    if (normal.y > 0 || (normal.y === 0 && normal.x < 0)) {
        normal = { x: -normal.x, y: -normal.y };
    }
    return steps.map(step => ({
        x: here.x + normal.x * reach * step,
        y: here.y + normal.y * reach * step + (vertical ? 4 : 0)
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
    x: number, y: number, text: string, theme: Theme, anchor: 'middle' | 'start',
    className?: string, owner?: string
): string {
    return `<text${className ? ` class="${className}"` : ''}${owner ? ` data-for="${escape(owner)}"` : ''} `
        + `x="${round(x)}" y="${round(y)}" `
        + `text-anchor="${anchor}" paint-order="stroke" stroke="${theme.background}" stroke-width="3" `
        + `stroke-linejoin="round">${escape(text)}</text>`;
}

/**
 * Several specializations of one class, drawn as one tree.
 *
 * A generalization set has always been drawn this way -- one triangle, a bus,
 * a leg to each subtype -- because that is what the notation means. Plain
 * generalizations get it too, which UML allows and a taxonomy badly needs: four
 * subtypes each drawing its own line to a supertype across the diagram produce
 * four lines that converge, and two of them will run within a few pixels of each
 * other for hundreds of them. The reader cannot tell such a pair apart, and
 * nothing in the picture says there are two.
 *
 * Only when every subtype is on the same side of the supertype. A tree with legs
 * going three ways says less than three arrows do, so in that case the edges are
 * left to draw themselves.
 */
interface BusLine {
    y: number;
    left: number;
    right: number;
}

function drawTree(
    plan: TreePlan, positions: Positions, theme: Theme, placer: LabelPlacer, obstacles: Rect[] = [],
    buses: BusLine[] = []
): string {
    const general = positions[plan.general];
    const children = plan.children
        .map(id => ({ id, rect: positions[id] }))
        .filter((entry): entry is { id: string; rect: Rect } => entry.rect !== undefined);
    if (!general || children.length < 2) {
        return '';
    }

    const below = children.every(entry => entry.rect.y >= general.y + general.height);

    const direction = below ? 1 : -1;
    // Each of a parent's trees gets its own place along the border, as an
    // association would.
    const span = Math.max(general.width - 28, 0);
    const apex = {
        x: Math.round(general.x + (general.width - span) / 2
            + span * (plan.lane.index + 1) / (plan.lane.count + 1)),
        y: below ? general.y + general.height : general.y
    };
    const base = { x: apex.x, y: apex.y + 14 * direction };
    const nearest = below
        ? Math.min(...children.map(entry => entry.rect.y))
        : Math.max(...children.map(entry => entry.rect.y + entry.rect.height));
    const bus = busDepth(plan, base, nearest, direction, children, obstacles, buses);

    buses.push({
        y: bus,
        left: Math.min(...children.map(entry => centerOf(entry.rect).x), base.x),
        right: Math.max(...children.map(entry => centerOf(entry.rect).x), base.x)
    });

    let markup = `<g class="tv-edge tv-tree"${plan.marker ? ` data-genset="${escape(plan.marker)}"` : ''}>`;
    markup += `<polygon class="tv-marker" points="${apex.x},${apex.y} ${base.x - 9},${base.y} ${base.x + 9},${base.y}"/>`;
    markup += `<path d="M ${base.x} ${base.y} L ${base.x} ${bus}"/>`;
    const left = Math.min(...children.map(entry => centerOf(entry.rect).x), base.x);
    const right = Math.max(...children.map(entry => centerOf(entry.rect).x), base.x);
    markup += `<path d="M ${round(left)} ${bus} L ${round(right)} ${bus}"/>`;
    for (const entry of children) {
        markup += `<path d="${legPath(entry.rect, bus, direction, obstacles)}"/>`;
    }

    if (plan.label) {
        const label = plan.label;
        const width = textWidth(label, FONT.edge);
        const at = placer.place([
            { x: base.x + width / 2 + 14, y: bus - 6 },
            { x: base.x - width / 2 - 14, y: bus - 6 },
            { x: base.x + width / 2 + 14, y: bus + 16 },
            { x: base.x, y: bus - 20 }
        ], label);
        markup += `<text x="${round(at.x)}" y="${round(at.y)}" fill="${theme.muted}" text-anchor="middle" `
            + `paint-order="stroke" stroke="${theme.background}" stroke-width="3" stroke-linejoin="round">`
            + `${escape(label)}</text>`;
    }
    return markup + '</g>';
}

interface TreePlan {
    general: string;
    children: string[];
    edges: string[];
    label?: string;
    marker?: string;
    /** Which of this parent's trees this is, and how many it has. */
    lane: { index: number; count: number };
}

/**
 * Which specializations are drawn as trees, decided before anything is routed.
 *
 * The edges a tree takes over are not routed at all, and must not be: a line
 * nobody draws still counts as one to the label placer, which would then keep
 * multiplicities away from lines that are not there.
 */
function planTrees(view: ViewModel, positions: Positions): { plans: TreePlan[]; covered: Set<string> } {
    const plans: TreePlan[] = [];
    const covered = new Set<string>();

    for (const genset of view.gensets) {
        if (!genset.general || !canDrawTree(genset.general, genset.specifics, positions)) {
            continue;
        }
        const constraints = [genset.disjoint ? 'disjoint' : '', genset.complete ? 'complete' : ''].filter(Boolean);
        plans.push({
            general: genset.general,
            children: genset.specifics,
            edges: view.edges
                .filter(edge => edge.kind === 'generalization' && edge.genset === genset.id)
                .map(edge => edge.id),
            label: constraints.length > 0 ? `${genset.name} {${constraints.join(', ')}}` : genset.name,
            marker: genset.id,
            lane: { index: 0, count: 1 }
        });
    }
    for (const plan of plans) {
        for (const id of plan.edges) {
            covered.add(id);
        }
    }

    const byParent = new Map<string, string[]>();
    for (const edge of view.edges) {
        if (edge.kind === 'generalization' && !covered.has(edge.id)) {
            byParent.set(edge.target, [...(byParent.get(edge.target) ?? []), edge.id]);
        }
    }
    for (const [parent, edgeIds] of byParent) {
        const children = edgeIds
            .map(id => view.edges.find(edge => edge.id === id)?.source)
            .filter((id): id is string => id !== undefined);
        if (children.length < 2 || !canDrawTree(parent, children, positions)) {
            continue;
        }
        plans.push({ general: parent, children, edges: edgeIds, lane: { index: 0, count: 1 } });
        for (const id of edgeIds) {
            covered.add(id);
        }
    }

    // A class with a generalization set and other subtypes besides has two
    // trees, and both drew their triangle at the middle of its border and their
    // bus at the same depth: one tree on top of another, which says there is one.
    const byGeneral = new Map<string, TreePlan[]>();
    for (const plan of plans) {
        byGeneral.set(plan.general, [...(byGeneral.get(plan.general) ?? []), plan]);
    }
    for (const family of byGeneral.values()) {
        family.forEach((plan, index) => {
            plan.lane = { index, count: family.length };
        });
    }

    return { plans, covered };
}

/**
 * A leg from the bus down to one subtype, round anything in the way.
 *
 * A subtype further from the parent than its siblings has a long leg, and on a
 * dense diagram there is often a class standing in it. Straight through is the
 * one thing it must not do -- a line that disappears behind a class it has
 * nothing to do with is read as ending there -- so it steps aside, comes down
 * beside the obstacle and turns back in just above the subtype.
 */
function legPath(child: Rect, bus: number, direction: number, obstacles: Rect[]): string {
    const centre = centerOf(child).x;
    const edge = direction > 0 ? child.y : child.y + child.height;
    const blocking = obstacles.filter(rect => rect !== child
        && segmentHitsRect({ x: centre, y: bus }, { x: centre, y: edge }, rect, 2));
    if (blocking.length === 0) {
        return `M ${round(centre)} ${bus} L ${round(centre)} ${round(edge)}`;
    }

    const turn = edge - direction * 22;
    for (const rect of blocking) {
        for (const aside of [rect.x - 20, rect.x + rect.width + 20]) {
            const clear = !obstacles.some(other => other !== child
                && (segmentHitsRect({ x: centre, y: bus }, { x: aside, y: bus }, other, 2)
                    || segmentHitsRect({ x: aside, y: bus }, { x: aside, y: turn }, other, 2)
                    || segmentHitsRect({ x: aside, y: turn }, { x: centre, y: turn }, other, 2)));
            if (clear) {
                return `M ${round(centre)} ${bus} L ${round(aside)} ${bus} L ${round(aside)} ${round(turn)} `
                    + `L ${round(centre)} ${round(turn)} L ${round(centre)} ${round(edge)}`;
            }
        }
    }
    return `M ${round(centre)} ${bus} L ${round(centre)} ${round(edge)}`;
}

/**
 * How deep to run the bus.
 *
 * Halfway between the parent and its nearest subtype is the usual place, but a
 * bus is a long horizontal line and there is often a class sitting on it, or on
 * the leg of a subtype further away. So a few depths in the gap are tried and
 * the one that crosses fewest boxes wins, the middle breaking ties -- and where
 * a parent has more than one tree they start from different depths, so two
 * buses do not lie on top of each other.
 */
function busDepth(
    plan: TreePlan,
    base: Point,
    nearest: number,
    direction: number,
    children: Array<{ rect: Rect }>,
    obstacles: Rect[],
    buses: BusLine[]
): number {
    const gap = Math.abs(nearest - base.y);
    const lane = plan.lane.count > 1 ? (plan.lane.index - (plan.lane.count - 1) / 2) * 20 : 0;
    const candidates = [0.5, 0.35, 0.65, 0.25, 0.75, 0.85]
        .map(fraction => Math.round(base.y + direction * (gap * fraction + lane)))
        .filter(depth => Math.abs(depth - base.y) > 6 && Math.abs(depth - nearest) > 6);
    if (candidates.length === 0) {
        return Math.round((base.y + nearest) / 2);
    }

    const left = Math.min(...children.map(entry => centerOf(entry.rect).x), base.x);
    const right = Math.max(...children.map(entry => centerOf(entry.rect).x), base.x);
    let best = { depth: candidates[0]!, crossings: Infinity };
    for (const depth of candidates) {
        // Another tree's bus at the same depth is worth as much as a class in
        // the way: several parents at one rank all put their bus halfway to the
        // next, and four of them lay on top of one another for hundreds of
        // pixels, reading as one long line with legs going everywhere.
        let crossings = buses.filter(other => Math.abs(other.y - depth) < 12
            && other.left < right && left < other.right).length * 2;
        for (const rect of obstacles) {
            if (segmentHitsRect({ x: left, y: depth }, { x: right, y: depth }, rect, 2)) {
                crossings += 1;
            }
            for (const entry of children) {
                const centre = centerOf(entry.rect).x;
                const edge = direction > 0 ? entry.rect.y : entry.rect.y + entry.rect.height;
                if (rect !== entry.rect
                    && segmentHitsRect({ x: centre, y: depth }, { x: centre, y: edge }, rect, 2)) {
                    crossings += 1;
                }
            }
        }
        if (crossings < best.crossings) {
            best = { depth, crossings };
        }
        if (crossings === 0) {
            break;
        }
    }
    return best.depth;
}

/** A tree reads as one only where every subtype is on the same side. */
function canDrawTree(generalId: string, childIds: string[], positions: Positions): boolean {
    const general = positions[generalId];
    const children = childIds.map(id => positions[id]).filter((rect): rect is Rect => rect !== undefined);
    if (!general || children.length < 2) {
        return false;
    }
    return children.every(rect => rect.y >= general.y + general.height)
        || children.every(rect => rect.y + rect.height <= general.y);
}

/**
 * A box round each package, where one can honestly be drawn.
 *
 * The box is the bounding rectangle of the package's classes, which is only the
 * package if nothing else has landed inside it. Laid out as one graph -- which
 * is what ignoring the packages means -- classes interleave, and a box drawn
 * round the ones belonging to `Person` enclosed `University`, `Department` and
 * `Staff` as well. A box that says a class is in a package it is not in is
 * worse than no box: the reader believes it.
 */
function groupBoxes(view: ViewModel, positions: Positions): Array<{ id: string; name: string; rect: Rect }> {
    return view.groups
        .map(group => {
            const members = new Set(group.nodes);
            const rects = group.nodes
                .map(id => positions[id])
                .filter((rect): rect is Rect => rect !== undefined);
            if (rects.length === 0) {
                return undefined;
            }
            const bounds = boundsOf(rects);
            const rect = {
                x: bounds.x - GROUP_PADDING,
                y: bounds.y - GROUP_PADDING - GROUP_HEADER,
                width: bounds.width + GROUP_PADDING * 2,
                height: bounds.height + GROUP_PADDING * 2 + GROUP_HEADER
            };
            const encloses = view.nodes.some(node => {
                const other = positions[node.id];
                return !members.has(node.id) && other !== undefined && overlapArea(other, rect) > 0;
            });
            return encloses ? undefined : { id: group.id, name: group.name, rect };
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
