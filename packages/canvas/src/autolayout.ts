/**
 * Automatic layout, when it is asked for.
 *
 * ELK's layered algorithm, which is what a class diagram wants: ranks, few
 * crossings, orthogonal edges. Two things are done to it here.
 *
 * Generalizations are handed over reversed, because a layered algorithm puts
 * the source of an edge above its target and a supertype belongs above its
 * subtypes -- the edge in the view model runs specific → general, which is how
 * the language writes it and the opposite of how the picture reads.
 *
 * Packages become compound nodes when they are drawn as boxes, so ELK keeps a
 * package's classes together instead of scattering them and leaving the box to
 * be drawn around half the diagram.
 */

import * as elkModule from 'elkjs/lib/elk.bundled.js';
import type { ViewModel } from 'tonto-view';
import type { Point, Rect, Size } from './geometry.js';
import type { Positions } from './place.js';

export interface AutoLayoutOptions {
    direction?: 'DOWN' | 'RIGHT';
    /** Space between ranks, i.e. between a supertype and its subtypes. */
    rankSpacing?: number;
    nodeSpacing?: number;
    /** Group nodes by package. */
    grouped?: boolean;
    /** Lay out only these nodes, leaving the rest where they are. */
    only?: string[];
}

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

export interface AutoLayoutResult {
    positions: Positions;
    /**
     * The polyline ELK routed each edge along, ends included.
     *
     * Kept, because a layered layout routes around the boxes it has just placed
     * and re-deriving that from the positions alone puts lines back through
     * them. They are part of the arrangement from here on: whoever moves a box
     * drops the routes of the edges that touch it, and keeps the rest.
     */
    routes: Record<string, Point[]>;
}

export async function autoLayout(
    view: ViewModel,
    sizes: Record<string, Size>,
    current: Positions,
    options: AutoLayoutOptions = {}
): Promise<AutoLayoutResult> {
    const subject = new Set(options.only ?? view.nodes.map(node => node.id));
    const nodes = view.nodes.filter(node => subject.has(node.id));
    if (nodes.length === 0) {
        return { positions: current, routes: {} };
    }

    const sizeOf = (id: string): Size => sizes[id] ?? { width: 160, height: 60 };
    const children: ElkNode[] = options.grouped
        ? view.groups
            .map(group => ({
                id: group.id,
                layoutOptions: { 'elk.padding': '[top=28,left=16,bottom=16,right=16]' },
                children: group.nodes
                    .filter(id => subject.has(id))
                    .map(id => ({ id, ...sizeOf(id) }))
            }))
            .filter(group => (group.children?.length ?? 0) > 0)
        : nodes.map(node => ({ id: node.id, ...sizeOf(node.id) }));

    const graph: ElkNode = {
        id: 'root',
        layoutOptions: {
            'elk.algorithm': 'layered',
            'elk.direction': options.direction ?? 'DOWN',
            'elk.edgeRouting': 'ORTHOGONAL',
            'elk.spacing.nodeNode': String(options.nodeSpacing ?? 70),
            'elk.layered.spacing.nodeNodeBetweenLayers': String(options.rankSpacing ?? 110),
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
            // Every route comes back in one coordinate system. Without this ELK
            // reports an edge relative to whichever node it decided owns it,
            // which for an edge between two packages is neither of its ends --
            // and a route drawn from those numbers lands in the corner of the
            // diagram, some hundreds of pixels from the classes it joins.
            'elk.json.edgeCoords': 'ROOT'
        },
        children,
        edges: view.edges
            .filter(edge => subject.has(edge.source) && subject.has(edge.target))
            .map(edge => (edge.kind === 'generalization'
                ? { id: edge.id, sources: [edge.target], targets: [edge.source] }
                : { id: edge.id, sources: [edge.source], targets: [edge.target] }))
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
    const collectEdges = (node: ElkNode) => {
        for (const edge of node.edges ?? []) {
            const section = edge.sections?.[0];
            if (!section) {
                continue;
            }
            const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
                .map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }));
            // Generalizations were handed over reversed so the supertype would
            // rank above; the route comes back the same way round.
            const reversed = view.edges.find(candidate => candidate.id === edge.id)?.kind === 'generalization';
            routes[edge.id] = reversed ? points.reverse() : points;
        }
        for (const child of node.children ?? []) {
            collectEdges(child);
        }
    };
    collectEdges(laid);

    return { positions, routes };
}
