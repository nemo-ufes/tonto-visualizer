/**
 * Automatic layout, when it is asked for.
 *
 * The default is ELK's layered algorithm, because a class diagram is read by its
 * taxonomy: supertypes above subtypes, one rank per level. Three things are done
 * to it here, all of them because a UFO model is not the graph a layered
 * algorithm expects.
 *
 * Generalizations are handed over reversed. A layered algorithm puts the source
 * of an edge above its target, and the edge in the view model runs specific →
 * general, which is how the language writes it and the opposite of how the
 * picture reads.
 *
 * A relator is then seated between the classes it mediates, because that is
 * where a reader looks for a reified relationship. What counts as a relator is
 * the nature the language resolves rather than the keyword the model happens to
 * use -- see `ontology.ts`.
 *
 * ELK first sees the whole graph, because associations carry useful information
 * about which classes belong near one another and in which order. Its direction
 * priority only affects cycle breaking, though; it cannot stop associations
 * from inventing hierarchy levels. After that pass, each independent taxonomy
 * is therefore put back into ranks computed only from generalizations, around
 * the location and cross-rank order ELK chose for it.
 *
 * Packages become compound nodes when they are drawn as boxes, so a package's
 * classes stay together instead of scattering and leaving the box drawn around
 * half the diagram.
 *
 * The other algorithms are there because no single one suits every model:
 * `stress` for a densely associated model with little taxonomy, `mrtree` for one
 * that really is a tree, `radial` for a model with one thing at its centre.
 */

import * as elkModule from 'elkjs/lib/elk.bundled.js';
import type { LayoutOptions, ViewEdge, ViewModel } from 'tonto-view';
import { defaultLayoutOptions, inversePairs } from 'tonto-view';
import type { Point, Rect, Size } from './geometry.js';
import { borderPoint, boundsOf, centerOf, overlaps, segmentHitsRect } from './geometry.js';
import { isRelator } from './ontology.js';
import type { Positions } from './place.js';
import type { RoutingStyle } from './route.js';
import { routeEdge } from './route.js';

const GROUP_PADDING = 18;
const GROUP_HEADER = 20;
const PARTIAL_GAP = 24;
const PARTIAL_STEP = 40;
/** How far a relator looks around the middle of its relata for a clear place. */
const SETTLE_STEP = 24;
const SETTLE_RINGS = [1, 2, 3, 4, 5, 6];

/**
 * ELK ships one bundle for CommonJS and for the browser, so the constructor
 * arrives as a module namespace in one environment and as the function itself in
 * the other. Read once, here, rather than at every call site.
 */
interface ElkLayouter {
    layout(graph: ElkNode): Promise<ElkNode>;
}

const Elk = ((elkModule as unknown as { default?: new () => ElkLayouter }).default
    ?? (elkModule as unknown as new () => ElkLayouter));

interface ElkPoint {
    x: number;
    y: number;
}

interface ElkEdge {
    id: string;
    sources: string[];
    targets: string[];
    layoutOptions?: Record<string, string>;
    sections?: Array<{ startPoint: ElkPoint; endPoint: ElkPoint; bendPoints?: ElkPoint[] }>;
}

interface ElkNode {
    id: string;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    children?: ElkNode[];
    edges?: ElkEdge[];
    layoutOptions?: Record<string, string>;
}

export interface AutoLayoutRequest extends Partial<LayoutOptions> {
    /** Lay out only these nodes, leaving the rest where they are. */
    only?: string[];
    /**
     * How edges will be drawn. Only an orthogonal drawing keeps ELK's routes:
     * a straight line is recomputed from the two boxes every time one moves,
     * which is what keeps it looking right after a drag.
     */
    routing?: RoutingStyle;
}

export interface AutoLayoutResult {
    positions: Positions;
    /**
     * The polyline ELK routed each edge along, ends included.
     *
     * Kept for an orthogonal drawing, because a layered layout routes around the
     * boxes it has just placed and re-deriving that from the positions alone
     * puts lines back through them. They are part of the arrangement from here
     * on: whoever moves a box drops the routes of the edges that touch it.
     */
    routes: Record<string, Point[]>;
}

/** What each algorithm is told, beyond the spacings every one of them takes. */
function optionsFor(settings: LayoutOptions, routing: RoutingStyle): Record<string, string> {
    const edgeRouting = routing === 'orthogonal' ? 'ORTHOGONAL' : 'POLYLINE';
    switch (settings.algorithm) {
        case 'stress':
            return {
                'elk.algorithm': 'stress',
                // Long enough that a label between two boxes has somewhere to sit.
                'elk.stress.desiredEdgeLength': String(settings.rankSpacing * 2.6)
            };
        case 'force':
            return {
                'elk.algorithm': 'force',
                'elk.force.repulsivePower': '1',
                'elk.spacing.nodeNode': String(settings.nodeSpacing * 1.6)
            };
        case 'mrtree':
            return {
                'elk.algorithm': 'mrtree',
                'elk.direction': settings.direction,
                'elk.mrtree.searchOrder': 'DFS',
                'elk.spacing.nodeNode': String(settings.nodeSpacing),
                'elk.layered.spacing.nodeNodeBetweenLayers': String(settings.rankSpacing)
            };
        case 'radial':
            return { 'elk.algorithm': 'radial', 'elk.spacing.nodeNode': String(settings.nodeSpacing) };
        case 'layered':
        default:
            return {
                'elk.algorithm': 'layered',
                'elk.direction': settings.direction,
                'elk.edgeRouting': edgeRouting,
                'elk.spacing.nodeNode': String(settings.nodeSpacing),
                'elk.spacing.edgeNode': String(Math.round(settings.nodeSpacing * 0.5)),
                'elk.spacing.edgeEdge': '12',
                'elk.layered.spacing.nodeNodeBetweenLayers': String(settings.rankSpacing),
                'elk.layered.spacing.edgeNodeBetweenLayers': String(Math.round(settings.rankSpacing * 0.4)),
                // Straight taxonomy legs, at the cost of a wider drawing: a
                // supertype sitting over the middle of its subtypes is the thing
                // the reader is looking for.
                'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
                'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
                'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
                'elk.layered.thoroughness': '20'
                // Nothing here bounds the width, and it is worth saying so
                // rather than appearing to. `elk.aspectRatio` was set to 1.6 for
                // years and did nothing at all: layered reads it only through
                // its wrapping phase, and wrapping applies to path-like graphs
                // -- 0.3, 1.6 and 8 produce the same drawing to the pixel on
                // every model here, and `elk.layered.wrapping.strategy` changes
                // none of them either. So a rank as wide as a category has
                // kinds is as wide as the drawing gets: eight kinds of twelve
                // subkinds each come out 17220 across and 664 deep. Bounding it
                // means folding a rank into several rows here, which is a
                // decision about how a taxonomy should read and not a setting.
            };
    }
}

/**
 * Which way an edge is handed to the layering, and how hard it is asked for.
 *
 * A layered algorithm ranks the source of an edge above its target, so an edge
 * whose picture reads the other way round is handed over reversed. Four do:
 *
 * - a generalization, written specific -> general and read general above it;
 * - an instantiation, whose target is the type -- the language's end-nature
 *   table says so, `instantiation: [EVERYTHING, ['type']]` -- and a type is
 *   read above what instantiates it, as the abstract is read above the
 *   concrete everywhere else in the drawing;
 * - a parthood, where the whole is read above the part and the diamond says
 *   which end holds it;
 * - a constitution, where the constituted is read above what constitutes it,
 *   the statue above its marble and the process above the events in it.
 *
 * Which way round the edge goes is what decides the drawing; the priority
 * beside it only matters where ELK has to break a cycle, and 0, 1, 3 and 6 draw
 * these six models to the pixel. A generalization still asks for 10, because a
 * rank is what it is, and the rest ask for a little more than an association's
 * nothing: a parthood chain that runs back into a taxonomy is a cycle, and the
 * edge to give up on there is the association.
 */
function handedOver(edge: ViewEdge, turned: boolean): { reversed: boolean; layoutOptions: Record<string, string> } {
    const asks = (direction: number, straightness?: number) => ({
        'elk.layered.priority.direction': String(direction),
        ...(straightness === undefined ? {} : { 'elk.layered.priority.straightness': String(straightness) })
    });
    if (edge.kind === 'generalization') {
        return { reversed: true, layoutOptions: asks(10, 10) };
    }
    if (edge.kind === 'instantiation' || edge.stereotype === 'instantiation') {
        return { reversed: true, layoutOptions: asks(3) };
    }
    if (edge.whole) {
        return { reversed: edge.whole === 'target', layoutOptions: asks(3) };
    }
    if (edge.constituted) {
        return { reversed: edge.constituted === 'target', layoutOptions: asks(3) };
    }
    if (edge.stereotype === 'mediation') {
        // A mediation should come out straight where it can: it is the line
        // that says what the relator is between. Turned, it is what seats the
        // relator in a rank between its relata rather than above both.
        return { reversed: turned, layoutOptions: asks(4, 8) };
    }
    return { reversed: turned, layoutOptions: asks(0) };
}

/** Algorithms that understand a node containing other nodes. */
function supportsGroups(algorithm: LayoutOptions['algorithm']): boolean {
    return algorithm === 'layered' || algorithm === 'mrtree';
}

/**
 * Keeps an arranged selection where it was, and out of everything that was not
 * selected. ELK cannot do that by itself when it is handed only the selection:
 * an unselected box does not exist in its graph, so the most natural answer is
 * often the exact coordinates that box already occupies.
 */
function placePartialLayout(positions: Positions, current: Positions, subject: ReadonlySet<string>): void {
    const ids = [...subject].filter(id => positions[id] !== undefined);
    const laid = ids.map(id => positions[id]!);
    const fixed = Object.entries(current).filter(([id]) => !subject.has(id)).map(([, rect]) => rect);
    if (laid.length === 0 || fixed.length === 0) {
        return;
    }

    const laidBounds = boundsOf(laid);
    const previous = ids.map(id => current[id]).filter((rect): rect is Rect => rect !== undefined);
    const previousBounds = previous.length > 0 ? boundsOf(previous) : laidBounds;
    const anchor = { x: previousBounds.x - laidBounds.x, y: previousBounds.y - laidBounds.y };
    const fits = (dx: number, dy: number) => laid.every(rect => {
        const moved = { ...rect, x: rect.x + dx, y: rect.y + dy };
        return !fixed.some(obstacle => overlaps(moved, obstacle, PARTIAL_GAP));
    });

    let translation: Point | undefined;
    for (let ring = 0; ring < 80 && !translation; ring += 1) {
        const offsets = ring === 0 ? [{ x: 0, y: 0 }] : partialRing(ring);
        for (const offset of offsets) {
            const candidate = {
                x: anchor.x + offset.x * PARTIAL_STEP,
                y: anchor.y + offset.y * PARTIAL_STEP
            };
            if (fits(candidate.x, candidate.y)) {
                translation = candidate;
                break;
            }
        }
    }
    if (!translation) {
        const fixedBounds = boundsOf(fixed);
        translation = {
            x: anchor.x,
            y: fixedBounds.y + fixedBounds.height + PARTIAL_GAP - laidBounds.y
        };
    }
    for (const id of ids) {
        const rect = positions[id]!;
        positions[id] = {
            ...rect,
            x: Math.round(rect.x + translation.x),
            y: Math.round(rect.y + translation.y)
        };
    }
}

function partialRing(ring: number): Point[] {
    const offsets: Point[] = [];
    for (let step = -ring; step <= ring; step += 1) {
        offsets.push(
            { x: step, y: ring }, { x: ring, y: step },
            { x: step, y: -ring }, { x: -ring, y: step }
        );
    }
    return offsets;
}

/**
 * Moves each relator towards the middle of what it mediates, where there is room.
 *
 * The layering can only put it in a rank between its relata; how far along that
 * rank it sits is decided by everything else in the drawing, and a relator that
 * is between its relata vertically and a screen away horizontally is not between
 * them in any sense a reader cares about. So each one is offered the middle, and
 * takes as much of the way there as is free -- never overlapping anything, and
 * never moving unless the move is an improvement.
 */
function settleRelators(
    view: ViewModel,
    positions: Positions,
    only: ReadonlySet<string>,
    rankDirection?: LayoutOptions['direction'],
    ranked?: ReadonlySet<string>
): void {
    const relators = view.nodes.filter(node => isRelator(node) && only.has(node.id));
    if (relators.length === 0) {
        return;
    }
    const covered = inversePairs(view.edges).covered;

    for (const relator of relators) {
        const rect = positions[relator.id];
        if (!rect) {
            continue;
        }
        const relata = [...new Set(view.edges
            .filter(edge => edge.kind === 'relation' && edge.stereotype === 'mediation'
                && (edge.source === relator.id || edge.target === relator.id))
            .map(edge => (edge.source === relator.id ? edge.target : edge.source))
            .filter(id => id !== relator.id))]
            .map(id => positions[id])
            .filter((one): one is Rect => one !== undefined);
        if (relata.length < 2) {
            continue;
        }

        const middle = {
            x: relata.reduce((sum, one) => sum + one.x + one.width / 2, 0) / relata.length - rect.width / 2,
            y: relata.reduce((sum, one) => sum + one.y + one.height / 2, 0) / relata.length - rect.height / 2
        };
        const others = Object.entries(positions)
            .filter(([id]) => id !== relator.id)
            .map(([, one]) => one);
        const locked = ranked?.has(relator.id) ?? false;
        // A relator that is itself in a taxonomy keeps the rank the hierarchy
        // gave it: between its relata is worth less than under its supertype.
        const held = (candidate: Rect): Rect => ({
            ...candidate,
            ...(locked && rankDirection === 'RIGHT' ? { x: rect.x } : {}),
            ...(locked && rankDirection === 'DOWN' ? { y: rect.y } : {})
        });
        const away = (candidate: Rect) => Math.hypot(candidate.x - middle.x, candidate.y - middle.y);
        // The middle first, then the nearest clear place to it. Walking only
        // the line back towards where the relator already is finds nothing when
        // a relatum stands on that line, which is the ordinary case for a
        // relator of three: `ClinicVisit` was left over its `Pet`, `PetClinic`
        // and `Veterinarian` rather than among them, because every share of the
        // way to the middle put it through the class it mediates.
        const rings = SETTLE_RINGS.flatMap(ring => partialRing(ring).map(offset => ({
            x: middle.x + offset.x * SETTLE_STEP,
            y: middle.y + offset.y * SETTLE_STEP
        })));
        // Part of the way there is still an improvement, and on a crowded
        // drawing it is often all there is: a relator that cannot reach the
        // middle of three classes can still stop being drawn above all three.
        const along = [0.8, 0.6, 0.4, 0.2].map(share => ({
            x: rect.x + (middle.x - rect.x) * share,
            y: rect.y + (middle.y - rect.y) * share
        }));
        const candidates = [middle, ...rings, ...along]
            .map(at => held({ x: Math.round(at.x), y: Math.round(at.y), width: rect.width, height: rect.height }))
            .filter(candidate => away(candidate) < away(rect))
            .sort((one, other) => away(one) - away(other));
        // Free is not the same as better. A relator seated between its relata
        // is drawn where the lines between everything else already run, and a
        // move that takes it off its rank can put two of them behind a class
        // that has nothing to do with either -- which is read as the line
        // ending there. So a place is taken only if it costs no such line.
        const before = linesThrough(view, positions, covered, { id: relator.id, rect });
        for (const candidate of candidates) {
            if (!others.some(one => overlaps(candidate, one, 24))
                && linesThrough(view, positions, covered, { id: relator.id, rect: candidate }) <= before) {
                positions[relator.id] = candidate;
                break;
            }
        }
    }
}

/**
 * The lines an arrangement hides behind a class that has nothing to do with
 * them -- the defect this drawing fights hardest, since a line that disappears
 * behind a class is read as ending there.
 *
 * Centre to centre, because the router and the ports are not available here and
 * because it is the same edges over the same boxes on either side of every
 * comparison it is used for. Given a `focus`, only the lines that box decides
 * are counted: the ones that touch it, and the ones that would pass behind it.
 */
function linesThrough(
    view: ViewModel,
    positions: Positions,
    covered: ReadonlySet<string>,
    focus?: { id: string; rect: Rect }
): number {
    const at = (node: string) => (focus && node === focus.id ? focus.rect : positions[node]);
    let count = 0;
    for (const edge of view.edges) {
        const source = at(edge.source);
        const target = at(edge.target);
        if (covered.has(edge.id) || !source || !target || edge.source === edge.target) {
            continue;
        }
        const from = centerOf(source);
        const to = centerOf(target);
        const touches = focus !== undefined && (edge.source === focus.id || edge.target === focus.id);
        for (const [other, box] of Object.entries(positions)) {
            if (other === edge.source || other === edge.target) {
                continue;
            }
            if (focus && !touches && other !== focus.id) {
                continue;
            }
            if (segmentHitsRect(from, to, focus && other === focus.id ? focus.rect : box, 0)) {
                count += 1;
            }
        }
    }
    return count;
}

/**
 * Restores the ontology's hierarchy after ELK has optimized the whole graph.
 *
 * The first layout remains useful: associations and packages decide where each
 * independent taxonomy belongs and the order across a rank. They must not
 * decide the ranks inside a taxonomy, however. Each hierarchy component is
 * regularized around the place ELK chose for it; unrelated hierarchies are not
 * forced into one diagram-wide row.
 */
function enforceTaxonomyRanks(
    view: ViewModel,
    positions: Positions,
    subject: ReadonlySet<string>,
    settings: LayoutOptions
): Set<string> | undefined {
    const generalizations = view.edges.filter(edge => edge.kind === 'generalization'
        && subject.has(edge.source) && subject.has(edge.target));
    if (generalizations.length === 0) {
        return undefined;
    }

    const parents = new Map<string, Set<string>>();
    const children = new Map<string, Set<string>>();
    for (const edge of generalizations) {
        parents.set(edge.source, new Set([...(parents.get(edge.source) ?? []), edge.target]));
        children.set(edge.target, new Set([...(children.get(edge.target) ?? []), edge.source]));
        parents.set(edge.target, parents.get(edge.target) ?? new Set());
        children.set(edge.source, children.get(edge.source) ?? new Set());
    }

    // Parent -> child topological walk. A temporarily cyclic model is left in
    // rank zero rather than making arrangement fail while it is being edited.
    const pending = new Map([...parents].map(([id, values]) => [id, values.size]));
    const ranks = new Map<string, number>();
    const queue = [...pending].filter(([, count]) => count === 0).map(([id]) => id).sort();
    while (queue.length > 0) {
        const parent = queue.shift()!;
        const parentRank = ranks.get(parent) ?? 0;
        ranks.set(parent, parentRank);
        for (const child of children.get(parent) ?? []) {
            ranks.set(child, Math.max(ranks.get(child) ?? 0, parentRank + 1));
            const left = (pending.get(child) ?? 1) - 1;
            pending.set(child, left);
            if (left === 0) {
                queue.push(child);
                queue.sort();
            }
        }
    }
    for (const id of parents.keys()) {
        if (!ranks.has(id)) {
            ranks.set(id, 0);
        }
    }

    const primary = settings.direction === 'DOWN' ? 'y' as const : 'x' as const;
    const primarySize = settings.direction === 'DOWN' ? 'height' as const : 'width' as const;
    const cross = settings.direction === 'DOWN' ? 'x' as const : 'y' as const;
    const crossSize = settings.direction === 'DOWN' ? 'width' as const : 'height' as const;
    const rankedRects = [...ranks.keys()].map(id => positions[id]).filter((rect): rect is Rect => rect !== undefined);
    if (rankedRects.length === 0) {
        return undefined;
    }

    const unseen = new Set(ranks.keys());
    const components: string[][] = [];
    const packageOf = new Map(view.nodes.map(node => [node.id, node.package]));
    while (unseen.size > 0) {
        const first = unseen.values().next().value as string;
        const component: string[] = [];
        const visit = [first];
        unseen.delete(first);
        while (visit.length > 0) {
            const id = visit.pop()!;
            component.push(id);
            for (const neighbour of [...(parents.get(id) ?? []), ...(children.get(id) ?? [])]) {
                if (settings.groupByPackage && packageOf.get(neighbour) !== packageOf.get(id)) {
                    continue;
                }
                if (unseen.delete(neighbour)) {
                    visit.push(neighbour);
                }
            }
        }
        components.push(component);
    }

    const proposed = components.map(ids => {
        const originals = ids.map(id => positions[id]!).filter((rect): rect is Rect => rect !== undefined);
        const crossLow = Math.min(...originals.map(rect => rect[cross]));
        const crossHigh = Math.max(...originals.map(rect => rect[cross] + rect[crossSize]));
        const crossMiddle = (crossLow + crossHigh) / 2;
        const rows = new Map<number, string[]>();
        for (const id of ids) {
            if (positions[id]) {
                const rank = ranks.get(id)!;
                rows.set(rank, [...(rows.get(rank) ?? []), id]);
            }
        }
        const rects = new Map<string, Rect>();
        let at = Math.min(...originals.map(rect => rect[primary]));
        for (const rank of [...rows.keys()].sort((one, other) => one - other)) {
            const rowIds = rows.get(rank)!.sort((one, other) => {
                const oneRect = positions[one]!;
                const otherRect = positions[other]!;
                return oneRect[cross] + oneRect[crossSize] / 2 - (otherRect[cross] + otherRect[crossSize] / 2)
                    || one.localeCompare(other);
            });
            const rowRects = rowIds.map(id => positions[id]!);
            const length = rowRects.reduce((sum, rect) => sum + rect[crossSize], 0)
                + settings.nodeSpacing * Math.max(rowIds.length - 1, 0);
            let along = crossMiddle - length / 2;
            const thickness = Math.max(...rowRects.map(rect => rect[primarySize]));
            for (const id of rowIds) {
                const rect = positions[id]!;
                rects.set(id, {
                    ...rect,
                    [primary]: Math.round(at),
                    [cross]: Math.round(along)
                });
                along += rect[crossSize] + settings.nodeSpacing;
            }
            at += thickness + settings.rankSpacing;
        }
        return { ids, rects, original: boundsOf(originals) };
    }).sort((one, other) => one.original.y - other.original.y || one.original.x - other.original.x);

    // Re-ranking can make a hierarchy wider than the space ELK gave it. Move
    // each hierarchy as one rigid piece to the nearest clear position, leaving
    // association-only nodes where the whole-graph layout put them.
    const taxonomy = new Set(ranks.keys());
    const occupied = [...subject]
        .filter(id => !taxonomy.has(id) && positions[id] !== undefined)
        .map(id => positions[id]!);
    for (const component of proposed) {
        const rects = [...component.rects.values()];
        const fits = (dx: number, dy: number) => rects.every(rect => {
            const moved = { ...rect, x: rect.x + dx, y: rect.y + dy };
            return !occupied.some(obstacle => overlaps(moved, obstacle, Math.min(settings.nodeSpacing / 3, 20)));
        });
        let translation: Point | undefined;
        for (let ring = 0; ring < 80 && !translation; ring += 1) {
            for (const offset of ring === 0 ? [{ x: 0, y: 0 }] : partialRing(ring)) {
                const candidate = { x: offset.x * PARTIAL_STEP, y: offset.y * PARTIAL_STEP };
                if (fits(candidate.x, candidate.y)) {
                    translation = candidate;
                    break;
                }
            }
        }
        translation ??= { x: 0, y: boundsOf(occupied).y + boundsOf(occupied).height + settings.rankSpacing };
        for (const [id, rect] of component.rects) {
            const moved = { ...rect, x: rect.x + translation.x, y: rect.y + translation.y };
            positions[id] = moved;
            occupied.push(moved);
        }
    }
    return taxonomy;
}

/**
 * Mediations to hand ELK the other way round, so a relator ranks between the
 * classes it mediates.
 *
 * A relator is a reified relationship: an employment is between an employee and
 * an employer, and that is where a reader looks for it. But a mediation is
 * written inside the relator, so the relator is the source of every one of them,
 * and a layered algorithm puts a source above all its targets -- the relator
 * ends up over the pair, with both relata below it side by side, which draws it
 * as their supertype would be drawn.
 *
 * Turning half of its mediations round for the layering puts a relatum above and
 * a relatum below, and the relator lands in the rank between them. Only the
 * layering sees this; the relation is drawn as it is written.
 */
function mediationsToTurn(view: ViewModel, grouped: boolean, only: Set<string>): Set<string> {
    const relators = new Set(view.nodes
        .filter(node => isRelator(node) && only.has(node.id))
        .map(node => node.id));
    const packageOf = new Map(view.nodes.map(node => [node.id, node.package]));
    // Kept by relatum rather than by edge: a relator that mediates one class
    // twice -- a marriage and its two spouses -- would otherwise have one of the
    // pair turned and the other not, which is a two-cycle, and the layering
    // answers a cycle by pushing its ends apart.
    const byRelator = new Map<string, Map<string, Array<{ id: string; above: boolean }>>>();
    for (const edge of view.edges) {
        if (edge.kind !== 'relation' || edge.stereotype !== 'mediation') {
            continue;
        }
        const relator = relators.has(edge.source) ? edge.source
            : relators.has(edge.target) ? edge.target
                : undefined;
        if (!relator || edge.source === edge.target) {
            continue;
        }
        // With the packages laid out as units, a relator can only be ranked
        // between relata that are in its own package: the others are held in a
        // box of their own, and turning the mediation only drags the relator to
        // the far side of its own package without getting it any closer.
        const relatum = edge.source === relator ? edge.target : edge.source;
        if (grouped && packageOf.get(relatum) !== packageOf.get(relator)) {
            continue;
        }
        // `above` says where the relatum would land as the edge is written.
        const relata = byRelator.get(relator) ?? new Map<string, Array<{ id: string; above: boolean }>>();
        relata.set(relatum, [...(relata.get(relatum) ?? []), { id: edge.id, above: edge.target === relator }]);
        byRelator.set(relator, relata);
    }

    const turn = new Set<string>();
    for (const relata of byRelator.values()) {
        if (relata.size < 2) {
            continue;
        }
        const entries = [...relata.entries()].sort((one, other) => one[0].localeCompare(other[0]));
        const above = entries.filter(([, mediations]) => mediations.every(one => one.above));
        const below = entries.filter(([, mediations]) => mediations.every(one => !one.above));
        if (above.length > 0 && below.length > 0) {
            // Already has a relatum on each side of it.
            continue;
        }
        const crowd = above.length > 0 ? above : below;
        // Half of them, and at least one: the relator wants company on both
        // sides, not to be moved from the top of the pile to the bottom of it.
        for (const [, mediations] of crowd.slice(0, Math.max(Math.floor(crowd.length / 2), 1))) {
            for (const mediation of mediations) {
                turn.add(mediation.id);
            }
        }
    }
    return turn;
}

export async function autoLayout(
    view: ViewModel,
    sizes: Record<string, Size>,
    current: Positions,
    request: AutoLayoutRequest = {}
): Promise<AutoLayoutResult> {
    const settings: LayoutOptions = { ...defaultLayoutOptions, ...request };
    const routing = request.routing ?? 'straight';
    const subject = new Set(request.only ?? view.nodes.map(node => node.id));
    const inverses = inversePairs(view.edges);
    const nodes = view.nodes.filter(node => subject.has(node.id));
    if (nodes.length === 0) {
        return { positions: current, routes: {} };
    }

    const sizeOf = (id: string): Size => sizes[id] ?? { width: 160, height: 60 };

    const grouped = settings.groupByPackage && supportsGroups(settings.algorithm);
    const algorithmOptions = optionsFor(settings, routing);
    /**
     * A datatype nothing is joined to is put after the model, not into it.
     *
     * Attributes are written inside the card, so a datatype or an enumeration
     * usually has no line at all -- and a node with no line is free to be
     * seated wherever a rank has room. In `parties` that was the corridor
     * between a relator and the class it mediates: `Address` landed between
     * `EmploymentContract` and `Employee`, and the mediation was drawn round
     * it, changing direction for a class it has nothing to do with. Which is
     * the picture saying something the model does not.
     *
     * Only the ones with no edge, and only datatypes and enumerations: a class
     * that happens to be undrawn today is still part of the taxonomy and keeps
     * its rank, and a datatype something does point at is drawn where it is
     * pointed at from.
     */
    const joined = new Set(view.edges.flatMap(edge => [edge.source, edge.target]));
    const kindOf = new Map(view.nodes.map(node => [node.id, node.kind]));
    const appendix = (id: string): Pick<ElkNode, 'layoutOptions'> | Record<string, never> =>
        settings.algorithm === 'layered' && !joined.has(id)
            && (kindOf.get(id) === 'datatype' || kindOf.get(id) === 'enumeration')
            ? { layoutOptions: { 'elk.layered.layering.layerConstraint': 'LAST' } }
            : {};
    const children: ElkNode[] = grouped
        ? view.groups
            .map(group => ({
                id: group.id,
                // The options are repeated on every package, not only on the
                // root: ELK lays a compound node out on its own, and it does not
                // inherit what the graph around it was told. Set only at the
                // root, a grouped diagram silently ran at ELK's 20px default --
                // ranks close enough to touch, and no room between them for the
                // labels that belong there.
                layoutOptions: {
                    ...algorithmOptions,
                    'elk.padding': `[top=${GROUP_PADDING + GROUP_HEADER},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`
                },
                children: group.nodes
                    .filter(id => subject.has(id))
                    .map(id => ({ id, ...sizeOf(id), ...appendix(id) }))
            }))
            .filter(group => (group.children?.length ?? 0) > 0)
        : nodes.map(node => ({ id: node.id, ...sizeOf(node.id), ...appendix(node.id) }));

    const attempt = async (turnedMediations: Set<string>): Promise<{ positions: Positions; routes: Record<string, Point[]> }> => {
    /** The edges handed to ELK the other way round, which their routes come back. */
    const upside = new Set<string>();
    const graph: ElkNode = {
        id: 'root',
        layoutOptions: {
            ...algorithmOptions,
            // Only where there is a hierarchy to handle. Asked for it on a flat
            // graph, ELK stops packing the pieces that are not joined to each
            // other and lays them out in one row instead: thirty unconnected
            // classes went from a block 804 by 644 to a strip 7164 by 84, and
            // `boats` ignoring its packages from 4503 by 952 to 2697 by 1785.
            ...(grouped ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' } : {}),
            // Every route comes back in one coordinate system. Without this ELK
            // reports an edge relative to whichever node it decides owns it,
            // which for an edge between two packages is neither of its ends --
            // and a route drawn from those numbers lands in the corner of the
            // diagram, some hundreds of pixels from the classes it joins.
            'elk.json.edgeCoords': 'ROOT'
        },
        children,
        edges: view.edges
            .filter(edge => !inverses.covered.has(edge.id)
                && subject.has(edge.source) && subject.has(edge.target))
            .map((edge): ElkEdge => {
                const over = handedOver(edge, turnedMediations.has(edge.id));
                if (over.reversed) {
                    upside.add(edge.id);
                }
                return {
                    id: edge.id,
                    sources: [over.reversed ? edge.target : edge.source],
                    targets: [over.reversed ? edge.source : edge.target],
                    layoutOptions: over.layoutOptions
                };
            })
    };

    const laid = await new Elk().layout(graph);
    const positions: Positions = { ...current };
    // A laid-out node's coordinates are relative to its parent, so a package's
    // own position has to be carried into its children.
    const walk = (node: ElkNode, offsetX: number, offsetY: number) => {
        for (const child of node.children ?? []) {
            const x = offsetX + (child.x ?? 0);
            const y = offsetY + (child.y ?? 0);
            if (child.children?.length) {
                walk(child, x, y);
            } else if (subject.has(child.id)) {
                positions[child.id] = {
                    x: Math.round(x),
                    y: Math.round(y),
                    width: child.width ?? sizeOf(child.id).width,
                    height: child.height ?? sizeOf(child.id).height
                } satisfies Rect;
            }
        }
    };
    walk(laid, 0, 0);
    const elkPositions = Object.fromEntries([...subject]
        .filter(id => positions[id] !== undefined)
        .map(id => [id, { ...positions[id]! }]));
    if (settings.algorithm === 'layered' && !request.only) {
        const ranked = enforceTaxonomyRanks(view, positions, subject, settings);
        settleRelators(view, positions, subject, ranked ? settings.direction : undefined, ranked);
    } else {
        settleRelators(view, positions, subject);
    }
    if (request.only) {
        placePartialLayout(positions, current, subject);
    }

    const routes: Record<string, Point[]> = {};
    if (routing === 'orthogonal') {
        const edgeById = new Map(view.edges.map(edge => [edge.id, edge]));
        const obstacles = Object.values(positions);
        const collectEdges = (node: ElkNode) => {
            for (const edge of node.edges ?? []) {
                const section = edge.sections?.[0];
                if (!section) {
                    continue;
                }
                const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
                    .map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }));
                const definition = edgeById.get(edge.id);
                if (!definition) {
                    continue;
                }
                // Generalization ports belong at the centre ray of their
                // classes. Keeping ELK's route would retain the displaced port
                // it chose when an association joins the same pair.
                if (definition.kind === 'generalization') {
                    const source = positions[definition.source];
                    const target = positions[definition.target];
                    if (source && target) {
                        routes[edge.id] = routeEdge(source, target, {
                            style: 'orthogonal',
                            obstacles,
                            ends: {
                                source: borderPoint(source, centerOf(target)),
                                target: borderPoint(target, centerOf(source))
                            }
                        });
                    }
                    continue;
                }
                // Several kinds of edge are handed to ELK backwards, so that
                // the end the picture reads as higher is the one it ranks
                // first. Stored routes always follow the view model's
                // source -> target direction.
                const reversed = upside.has(edge.id);
                const ordered = reversed ? points.reverse() : points;
                const oldSource = elkPositions[definition.source];
                const oldTarget = elkPositions[definition.target];
                const source = positions[definition.source];
                const target = positions[definition.target];
                if (!oldSource || !oldTarget || !source || !target) {
                    continue;
                }
                const sourceShift = { x: source.x - oldSource.x, y: source.y - oldSource.y };
                const targetShift = { x: target.x - oldTarget.x, y: target.y - oldTarget.y };
                routes[edge.id] = sourceShift.x === targetShift.x && sourceShift.y === targetShift.y
                    ? ordered.map(point => ({
                        x: Math.round(point.x + sourceShift.x),
                        y: Math.round(point.y + sourceShift.y)
                    }))
                    // A post-layout adjustment moved one end independently. The
                    // old bends no longer belong to the final boxes, so route
                    // again from the final geometry rather than saving a
                    // detached polyline.
                    : routeEdge(source, target, { style: 'orthogonal', obstacles });
            }
            for (const child of node.children ?? []) {
                collectEdges(child);
            }
        };
        collectEdges(laid);
    }

    return { positions, routes };
    };

    // Turning a relator's mediations round is not free: it changes the ranking
    // for everything, and on one model it lengthened enough lines to cost a
    // dozen labels their place. So the plain layout comes first, only the
    // relators it strands are worth turning, and the turn is kept only if it
    // seats more of them while hiding no more lines behind classes they have
    // nothing to do with.
    //
    // That cost used to be answered by refusing to try: the second attempt was
    // skipped whenever the model held a generalization, which is every ontology
    // anyone draws, so the turn was reachable only on a model with no taxonomy
    // at all -- the shape of the test that covers it, and of nothing else.
    // Judging the attempt is what the refusal stood in for, so it is judged.
    const plain = await attempt(new Set());
    const stranded = strandedRelators(view, plain.positions, subject);
    if (stranded.size === 0) {
        return plain;
    }
    const turnedMediations = mediationsToTurn(view, grouped, stranded);
    if (turnedMediations.size === 0) {
        return plain;
    }
    const turned = await attempt(turnedMediations);
    const seatsMore = strandedRelators(view, turned.positions, subject).size < stranded.size;
    const hidden = (positions: Positions) => linesThrough(view, positions, inverses.covered);
    return seatsMore && hidden(turned.positions) <= hidden(plain.positions) ? turned : plain;
}

/** The relators that did not land between the classes they mediate. */
function strandedRelators(view: ViewModel, positions: Positions, only: ReadonlySet<string>): Set<string> {
    const centre = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    const stranded = new Set<string>();
    for (const relator of view.nodes.filter(node => isRelator(node) && only.has(node.id))) {
        const rect = positions[relator.id];
        const relata = [...new Set(view.edges
            .filter(edge => edge.kind === 'relation' && edge.stereotype === 'mediation'
                && (edge.source === relator.id || edge.target === relator.id))
            .map(edge => (edge.source === relator.id ? edge.target : edge.source))
            .filter(id => id !== relator.id))]
            .map(id => positions[id])
            .filter((one): one is Rect => one !== undefined);
        if (!rect || relata.length < 2) {
            continue;
        }
        const points = relata.map(centre);
        const at = centre(rect);
        const inside = at.x >= Math.min(...points.map(one => one.x)) - 24
            && at.x <= Math.max(...points.map(one => one.x)) + 24
            && at.y >= Math.min(...points.map(one => one.y)) - 24
            && at.y <= Math.max(...points.map(one => one.y)) + 24;
        if (!inside) {
            stranded.add(relator.id);
        }
    }
    return stranded;
}
