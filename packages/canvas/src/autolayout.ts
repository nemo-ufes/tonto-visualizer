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
    /** Group nodes by package. */
    grouped?: boolean;
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
    const grouped = (request.grouped ?? false) && supportsGroups(settings.algorithm);
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
            .map((edge): ElkEdge => (edge.kind === 'generalization'
                ? {
                    id: edge.id,
                    sources: [edge.target],
                    targets: [edge.source],
                    layoutOptions: { 'elk.layered.priority.direction': '10', 'elk.layered.priority.straightness': '10' }
                }
                : {
                    id: edge.id,
                    sources: [edge.source],
                    targets: [edge.target],
                    layoutOptions: { 'elk.layered.priority.direction': '0' }
                }))
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
}
