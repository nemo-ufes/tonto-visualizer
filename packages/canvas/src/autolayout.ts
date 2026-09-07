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
import type { LayoutOptions, ViewModel } from 'tonto-view';
import { defaultLayoutOptions, inversePairs } from 'tonto-view';
import type { Point, Rect, Size } from './geometry.js';
import { borderPoint, boundsOf, centerOf, overlaps } from './geometry.js';
import type { Positions } from './place.js';
import type { RoutingStyle } from './route.js';
import { routeEdge } from './route.js';

const GROUP_PADDING = 18;
const GROUP_HEADER = 20;
const PARTIAL_GAP = 24;
const PARTIAL_STEP = 40;

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
    const relators = view.nodes.filter(node => node.stereotype === 'relator' && only.has(node.id));
    if (relators.length === 0) {
        return;
    }

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
        for (const share of [1, 0.8, 0.6, 0.4, 0.2]) {
            const locked = ranked?.has(relator.id) ?? false;
            const candidate = {
                x: locked && rankDirection === 'RIGHT' ? rect.x : Math.round(rect.x + (middle.x - rect.x) * share),
                y: locked && rankDirection === 'DOWN' ? rect.y : Math.round(rect.y + (middle.y - rect.y) * share),
                width: rect.width,
                height: rect.height
            };
            if (!others.some(one => overlaps(candidate, one, 24))) {
                positions[relator.id] = candidate;
                break;
            }
        }
    }
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
        .filter(node => node.stereotype === 'relator' && only.has(node.id))
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
    const hasTaxonomy = view.edges.some(edge => edge.kind === 'generalization'
        && subject.has(edge.source) && subject.has(edge.target));
    const nodes = view.nodes.filter(node => subject.has(node.id));
    if (nodes.length === 0) {
        return { positions: current, routes: {} };
    }

    const sizeOf = (id: string): Size => sizes[id] ?? { width: 160, height: 60 };

    const grouped = settings.groupByPackage && supportsGroups(settings.algorithm);
    const algorithmOptions = optionsFor(settings, routing);
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
                    .map(id => ({ id, ...sizeOf(id) }))
            }))
            .filter(group => (group.children?.length ?? 0) > 0)
        : nodes.map(node => ({ id: node.id, ...sizeOf(node.id) }));

    const attempt = async (turnedMediations: Set<string>): Promise<{ positions: Positions; routes: Record<string, Point[]> }> => {
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
                if (edge.kind === 'generalization') {
                    return {
                        id: edge.id,
                        sources: [edge.target],
                        targets: [edge.source],
                        layoutOptions: {
                            'elk.layered.priority.direction': '10',
                            'elk.layered.priority.straightness': '10'
                        }
                    };
                }
                const turned = turnedMediations.has(edge.id);
                return {
                    id: edge.id,
                    sources: [turned ? edge.target : edge.source],
                    targets: [turned ? edge.source : edge.target],
                    layoutOptions: edge.kind === 'relation' && edge.stereotype === 'mediation'
                        // A mediation should come out straight where it can: it
                        // is the line that says what the relator is between.
                        ? { 'elk.layered.priority.direction': '4', 'elk.layered.priority.straightness': '8' }
                        : { 'elk.layered.priority.direction': '0' }
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
                // Selected mediations may be handed to ELK backwards for
                // ranking. Stored routes always follow the view model's
                // source -> target direction.
                const reversed = turnedMediations.has(edge.id);
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
    // dozen labels their place. So the plain layout comes first, and only the
    // relators it strands are worth turning -- and the turn is kept only if it
    // seats more of them.
    const plain = await attempt(new Set());
    if (settings.algorithm === 'layered' && hasTaxonomy && !request.only) {
        return plain;
    }
    const stranded = strandedRelators(view, plain.positions, subject);
    if (stranded.size === 0) {
        return plain;
    }
    const turnedMediations = mediationsToTurn(view, grouped, stranded);
    if (turnedMediations.size === 0) {
        return plain;
    }
    const turned = await attempt(turnedMediations);
    return strandedRelators(view, turned.positions, subject).size < stranded.size ? turned : plain;
}

/** The relators that did not land between the classes they mediate. */
function strandedRelators(view: ViewModel, positions: Positions, only: ReadonlySet<string>): Set<string> {
    const centre = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    const stranded = new Set<string>();
    for (const relator of view.nodes.filter(node => node.stereotype === 'relator' && only.has(node.id))) {
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
