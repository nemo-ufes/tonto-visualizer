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
 * Generalizations also outrank associations. Every edge pulls its ends into
 * different layers, and an ontology has as many associations as taxonomy: left
 * alone, a mediation between a relator and a role drags the role a rank away
 * from the kind it specializes, and the taxonomy stops lining up. So
 * generalizations are given the layering priority and associations almost none,
 * which is the closest ELK comes to "rank by this edge, then place for that
 * one".
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
import { defaultLayoutOptions } from 'tonto-view';
import type { Point, Rect, Size } from './geometry.js';
import { overlaps } from './geometry.js';
import type { Positions } from './place.js';
import type { RoutingStyle } from './route.js';

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
                'elk.layered.thoroughness': '20',
                // Ontologies are wide -- dozens of kinds under a handful of
                // categories -- and a drawing that is four screens across and one
                // deep is no easier to read than one that is neither.
                'elk.aspectRatio': '1.6'
            };
    }
}

/** Algorithms that understand a node containing other nodes. */
function supportsGroups(algorithm: LayoutOptions['algorithm']): boolean {
    return algorithm === 'layered' || algorithm === 'mrtree';
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
function settleRelators(view: ViewModel, positions: Positions): void {
    const relators = view.nodes.filter(node => node.stereotype === 'relator');
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
            const candidate = {
                x: Math.round(rect.x + (middle.x - rect.x) * share),
                y: Math.round(rect.y + (middle.y - rect.y) * share),
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
                layoutOptions: { ...algorithmOptions, 'elk.padding': '[top=30,left=18,bottom=18,right=18]' },
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
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
            // Every route comes back in one coordinate system. Without this ELK
            // reports an edge relative to whichever node it decides owns it,
            // which for an edge between two packages is neither of its ends --
            // and a route drawn from those numbers lands in the corner of the
            // diagram, some hundreds of pixels from the classes it joins.
            'elk.json.edgeCoords': 'ROOT'
        },
        children,
        edges: view.edges
            .filter(edge => subject.has(edge.source) && subject.has(edge.target))
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
    settleRelators(view, positions);

    const routes: Record<string, Point[]> = {};
    if (routing === 'orthogonal') {
        const collectEdges = (node: ElkNode) => {
            for (const edge of node.edges ?? []) {
                const section = edge.sections?.[0];
                if (!section) {
                    continue;
                }
                const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
                    .map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }));
                // Generalizations were handed over reversed so the supertype
                // would rank above; the route comes back the same way round.
                const reversed = view.edges.find(candidate => candidate.id === edge.id)?.kind === 'generalization';
                routes[edge.id] = reversed ? points.reverse() : points;
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
    const stranded = strandedRelators(view, plain.positions);
    if (stranded.size === 0) {
        return plain;
    }
    const turnedMediations = mediationsToTurn(view, grouped, stranded);
    if (turnedMediations.size === 0) {
        return plain;
    }
    const turned = await attempt(turnedMediations);
    return strandedRelators(view, turned.positions).size < stranded.size ? turned : plain;
}

/** The relators that did not land between the classes they mediate. */
function strandedRelators(view: ViewModel, positions: Positions): Set<string> {
    const centre = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
    const stranded = new Set<string>();
    for (const relator of view.nodes.filter(node => node.stereotype === 'relator')) {
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
