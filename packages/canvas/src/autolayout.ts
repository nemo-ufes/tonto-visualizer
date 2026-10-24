/**
 * Automatic layout, when it is asked for.
 *
 * The one automatic class layout is a PlantUML-like directed layered graph.
 * Generalizations are reversed so supertypes rank above their subtypes;
 * associations also influence ranks and neighbouring order, as they did in the
 * legacy preview. OntoUML-specific semantic repair passes are deliberately not
 * layered over that result: the measured and visual comparison favoured the
 * simpler graph arrangement.
 */

import * as elkModule from 'elkjs/lib/elk.bundled.js';
import type { LayoutOptions, ViewModel } from 'tonto-view';
import { clampAssociationDistance, defaultLayoutOptions, inversePairs } from 'tonto-view';
import type { Point, Rect, Size } from './geometry.js';
import {
    borderPoint, boundsOf, centerOf, overlaps
} from './geometry.js';
import type { Positions } from './place.js';
import type { RoutingStyle } from './route.js';
import { routeEdge } from './route.js';
import { partonomyView, wholePartOf } from './partonomy.js';

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
    /** Arrange inheritance without letting hidden associations influence it. */
    taxonomyOnly?: boolean;
    /**
     * Arrange whole-part relations and constitution as ranks, with only the
     * specializations between their classes drawn beside them.
     */
    partonomyOnly?: boolean;
    /** Keep package members inside compound package nodes, not merely nearby. */
    packageContainers?: boolean;
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

/** A supertype above its subtype. The edge runs specific -> general. */
/**
 * A whole above its part, constitution included -- and a supertype above
 * the subtypes a partonomy draws (see `partonomyView`). Left beside the ranks
 * instead, a front and a rear wheel shared the row of the wheel they
 * specialize, and their generalization set was drawn sideways, its label
 * landing among the wheel's own parts.
 */
/** The single layered configuration used for class and package diagrams. */
function optionsFor(settings: LayoutOptions, routing: RoutingStyle): Record<string, string> {
    const edgeRouting = routing === 'orthogonal' ? 'ORTHOGONAL' : 'POLYLINE';
    return {
        'elk.algorithm': 'layered',
        'elk.direction': settings.direction,
        'elk.edgeRouting': edgeRouting,
        'elk.spacing.nodeNode': String(settings.nodeSpacing),
        'elk.spacing.edgeNode': String(Math.round(settings.nodeSpacing * 0.5)),
        'elk.spacing.edgeEdge': '12',
        'elk.layered.spacing.nodeNodeBetweenLayers': String(settings.rankSpacing),
        'elk.layered.spacing.edgeNodeBetweenLayers': String(Math.round(settings.rankSpacing * 0.4)),
        'elk.layered.layering.strategy': 'NETWORK_SIMPLEX',
        'elk.layered.nodePlacement.strategy': 'LINEAR_SEGMENTS',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.layered.thoroughness': '12'
    };
}

/**
 * Keeps an arranged selection where it was, and out of everything that was not
 * selected. ELK cannot do that by itself when it is handed only the selection:
 * an unselected box does not exist in its graph, so the most natural answer is
 * often the exact coordinates that box already occupies.
 */
function placePartialLayout(
    view: ViewModel,
    positions: Positions,
    current: Positions,
    subject: ReadonlySet<string>
): void {
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

    const firstFitAround = (origin: Point, rings: number): Point | undefined => {
        for (let ring = 0; ring < rings; ring += 1) {
            const offsets = ring === 0 ? [{ x: 0, y: 0 }] : partialRing(ring);
            for (const offset of offsets) {
                const candidate = {
                    x: Math.round(origin.x + offset.x * PARTIAL_STEP),
                    y: Math.round(origin.y + offset.y * PARTIAL_STEP)
                };
                if (fits(candidate.x, candidate.y)) {
                    return candidate;
                }
            }
        }
        return undefined;
    };

    const covered = inversePairs(view.edges).covered;
    const boundary = view.edges.flatMap(edge => {
        if (covered.has(edge.id) || subject.has(edge.source) === subject.has(edge.target)) {
            return [];
        }
        const selected = subject.has(edge.source) ? edge.source : edge.target;
        const neighbour = selected === edge.source ? edge.target : edge.source;
        const selectedRect = positions[selected];
        const fixedRect = current[neighbour];
        return selectedRect && fixedRect ? [{ selectedRect, fixedRect }] : [];
    });

    let translation: Point | undefined;
    if (boundary.length > 0) {
        // The least-squares translation puts each boundary endpoint over its
        // fixed neighbour. Nearby grid candidates then find the closest legal
        // side of those obstacles. Keeping the selection rigid means this
        // preference cannot damage ranks or its internal arrangement.
        const halo = boundary.reduce((sum, pair) => ({
            x: sum.x + centerOf(pair.fixedRect).x - centerOf(pair.selectedRect).x,
            y: sum.y + centerOf(pair.fixedRect).y - centerOf(pair.selectedRect).y
        }), { x: 0, y: 0 });
        const haloAnchor = { x: halo.x / boundary.length, y: halo.y / boundary.length };
        const candidates: Point[] = [];
        const seen = new Set<string>();
        for (const origin of [haloAnchor, anchor]) {
            for (let ring = 0; ring < 24; ring += 1) {
                const offsets = ring === 0 ? [{ x: 0, y: 0 }] : partialRing(ring);
                for (const offset of offsets) {
                    const candidate = {
                        x: Math.round(origin.x + offset.x * PARTIAL_STEP),
                        y: Math.round(origin.y + offset.y * PARTIAL_STEP)
                    };
                    const key = `${candidate.x},${candidate.y}`;
                    if (!seen.has(key) && fits(candidate.x, candidate.y)) {
                        seen.add(key);
                        candidates.push(candidate);
                    }
                }
            }
        }
        const score = (candidate: Point): number => {
            const edgeLength = boundary.reduce((sum, pair) => {
                const selected = centerOf(pair.selectedRect);
                const fixedNeighbour = centerOf(pair.fixedRect);
                return sum + Math.hypot(
                    selected.x + candidate.x - fixedNeighbour.x,
                    selected.y + candidate.y - fixedNeighbour.y
                );
            }, 0);
            const displacement = Math.hypot(candidate.x - anchor.x, candidate.y - anchor.y);
            return edgeLength + displacement * boundary.length * 0.2;
        };
        translation = candidates.reduce<Point | undefined>((best, candidate) => {
            if (!best || score(candidate) < score(best)) {
                return candidate;
            }
            return best;
        }, undefined);
    } else {
        translation = firstFitAround(anchor, 80);
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
 * ELK's hierarchy pass can leave disconnected package compounds thousands of
 * pixels apart. Their members have already been arranged inside each frame,
 * so arrange the frames as plain boxes and translate each package rigidly.
 */
async function compactPackageContainers(
    view: ViewModel,
    positions: Positions,
    sizes: Record<string, Size>,
    groups: ViewModel['groups'],
    subject: ReadonlySet<string>,
    settings: LayoutOptions,
    routing: RoutingStyle,
    partonomy: boolean
): Promise<void> {
    const sizeOf = (id: string): Size => sizes[id] ?? { width: 160, height: 60 };
    const members = new Map<string, string>();
    const frames = groups.flatMap(group => {
        const rects = group.nodes.filter(id => subject.has(id))
            .map(id => positions[id]).filter((rect): rect is Rect => rect !== undefined);
        if (rects.length === 0) {
            return [];
        }
        for (const id of group.nodes) {
            if (subject.has(id)) {
                members.set(id, group.id);
            }
        }
        const bounds = boundsOf(rects);
        return [{
            id: group.id,
            bounds,
            size: {
                width: bounds.width + GROUP_PADDING * 2,
                height: bounds.height + GROUP_PADDING * 2 + GROUP_HEADER
            }
        }];
    });
    const framed = new Set(members.keys());
    const loose = view.nodes.filter(node => subject.has(node.id) && !framed.has(node.id));
    const referenceOf = (id: string) => members.get(id) ?? id;
    const uniqueEdges = new Map<string, ElkEdge>();
    for (const edge of view.edges) {
        if (!subject.has(edge.source) || !subject.has(edge.target)) {
            continue;
        }
        const wholePart = partonomy ? wholePartOf(edge) : undefined;
        const source = referenceOf(wholePart?.whole ?? (edge.kind === 'generalization' ? edge.target : edge.source));
        const target = referenceOf(wholePart?.part ?? (edge.kind === 'generalization' ? edge.source : edge.target));
        if (source === target) {
            continue;
        }
        const key = `${source}\u0000${target}`;
        if (!uniqueEdges.has(key)) {
            uniqueEdges.set(key, { id: `package-edge:${source}->${target}`, sources: [source], targets: [target] });
        }
    }
    const graph: ElkNode = {
        id: 'package-root',
        layoutOptions: optionsFor(settings, routing),
        children: [
            ...frames.map(frame => ({ id: frame.id, ...frame.size })),
            ...loose.map(node => ({ id: node.id, ...sizeOf(node.id) }))
        ],
        edges: [...uniqueEdges.values()]
    };
    const laid = await new Elk().layout(graph);
    const translatedFrames = new Map((laid.children ?? []).map(node => [node.id, node]));
    for (const frame of frames) {
        const destination = translatedFrames.get(frame.id);
        if (!destination) {
            continue;
        }
        const dx = (destination.x ?? 0) - (frame.bounds.x - GROUP_PADDING);
        const dy = (destination.y ?? 0) - (frame.bounds.y - GROUP_PADDING - GROUP_HEADER);
        for (const id of groups.find(group => group.id === frame.id)?.nodes ?? []) {
            const rect = positions[id];
            if (rect && subject.has(id)) {
                positions[id] = { ...rect, x: Math.round(rect.x + dx), y: Math.round(rect.y + dy) };
            }
        }
    }
    for (const node of loose) {
        const destination = translatedFrames.get(node.id);
        if (destination && positions[node.id]) {
            positions[node.id] = { ...positions[node.id]!, x: Math.round(destination.x ?? 0), y: Math.round(destination.y ?? 0) };
        }
    }
}

export async function autoLayout(
    view: ViewModel,
    sizes: Record<string, Size>,
    current: Positions,
    request: AutoLayoutRequest = {}
): Promise<AutoLayoutResult> {
    if (view.kind === 'packages') {
        return packageLayout(view, sizes, current, request);
    }
    // Taxonomy-only is a view of the same classifiers, not a second semantic
    // model. Removing non-taxonomy edges lets the layered pass optimize the
    // graph the user can actually see, while ids and saved positions remain
    // those of the full view.
    //
    // A partonomy-only view is the same move with whole-part relations kept
    // instead, and those relations then rank the drawing the way inheritance
    // otherwise does. Taxonomy wins if a hand-edited view file asks for both.
    const partonomy = request.partonomyOnly === true && request.taxonomyOnly !== true;
    if (partonomy) {
        view = partonomyView(view);
    } else if (request.taxonomyOnly) {
        view = { ...view, edges: view.edges.filter(edge => edge.kind === 'generalization') };
    }
    const requestedSettings: LayoutOptions = { ...defaultLayoutOptions, ...request };
    const associationDistance = clampAssociationDistance(requestedSettings.associationDistance);
    const distanceScale = associationDistance / defaultLayoutOptions.associationDistance;
    const settings: LayoutOptions = {
        ...requestedSettings,
        associationDistance,
        nodeSpacing: Math.round(requestedSettings.nodeSpacing * distanceScale),
        rankSpacing: Math.round(requestedSettings.rankSpacing * distanceScale)
    };
    return layeredPlantUmlLayout(view, sizes, current, request, settings, partonomy);

}

/**
 * A directed layered arrangement in the spirit of the legacy PlantUML preview.
 * Relationship edges help choose both ranks and the order within them.
 */
async function layeredPlantUmlLayout(
    view: ViewModel,
    sizes: Record<string, Size>,
    current: Positions,
    request: AutoLayoutRequest,
    settings: LayoutOptions,
    partonomy: boolean
): Promise<AutoLayoutResult> {
    const routing = request.routing ?? 'straight';
    const subject = new Set(request.only ?? view.nodes.map(node => node.id));
    if (subject.size === 0) {
        return { positions: current, routes: {} };
    }
    const sizeOf = (id: string): Size => sizes[id] ?? { width: 160, height: 60 };
    const groups = request.packageContainers && settings.groupByPackage
        ? view.groups.filter(group => group.nodes.some(id => subject.has(id))) : [];
    const grouped = groups.length > 1;
    const included = new Set(groups.flatMap(group => group.nodes));
    const algorithmOptions = optionsFor(settings, routing);
    const children: ElkNode[] = grouped
        ? [
            ...groups.map(group => ({
                id: group.id,
                layoutOptions: {
                    ...algorithmOptions,
                    'elk.padding': `[top=${GROUP_PADDING + GROUP_HEADER},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`
                },
                children: group.nodes.filter(id => subject.has(id)).map(id => ({ id, ...sizeOf(id) }))
            })),
            ...view.nodes.filter(node => subject.has(node.id) && !included.has(node.id))
                .map(node => ({ id: node.id, ...sizeOf(node.id) }))
        ]
        : view.nodes.filter(node => subject.has(node.id)).map(node => ({ id: node.id, ...sizeOf(node.id) }));
    const coveredInverseIds = inversePairs(view.edges).covered;
    const graph: ElkNode = {
        id: 'root',
        layoutOptions: {
            ...algorithmOptions,
            ...(grouped ? { 'elk.hierarchyHandling': 'INCLUDE_CHILDREN' } : {}),
            'elk.json.edgeCoords': 'ROOT'
        },
        children,
        edges: view.edges.filter(edge => !coveredInverseIds.has(edge.id)
            && subject.has(edge.source) && subject.has(edge.target))
            .map(edge => {
                const wholePart = partonomy ? wholePartOf(edge) : undefined;
                return {
                    id: edge.id,
                    sources: [wholePart?.whole ?? (edge.kind === 'generalization' ? edge.target : edge.source)],
                    targets: [wholePart?.part ?? (edge.kind === 'generalization' ? edge.source : edge.target)]
                };
            })
    };
    const laid = await new Elk().layout(graph);
    const positions: Positions = { ...current };
    const walk = (parent: ElkNode, offsetX: number, offsetY: number) => {
        for (const child of parent.children ?? []) {
            const x = offsetX + (child.x ?? 0);
            const y = offsetY + (child.y ?? 0);
            if (child.children?.length) {
                walk(child, x, y);
            } else if (subject.has(child.id)) {
                positions[child.id] = {
                    x: Math.round(x), y: Math.round(y),
                    width: sizeOf(child.id).width, height: sizeOf(child.id).height
                };
            }
        }
    };
    walk(laid, 0, 0);
    if (grouped && !request.only) {
        await compactPackageContainers(view, positions, sizes, groups, subject, settings, routing, partonomy);
    }
    if (request.only) {
        placePartialLayout(view, positions, current, subject);
    }
    const routes: Record<string, Point[]> = {};
    if (routing === 'orthogonal') {
        const obstacles = Object.values(positions);
        for (const edge of view.edges) {
            const source = positions[edge.source];
            const target = positions[edge.target];
            if (!source || !target || !subject.has(edge.source) || !subject.has(edge.target)) {
                continue;
            }
            routes[edge.id] = routeEdge(source, target, {
                style: 'orthogonal', obstacles,
                ...(edge.kind === 'generalization' ? {
                    ends: {
                        source: borderPoint(source, centerOf(target)),
                        target: borderPoint(target, centerOf(source))
                    }
                } : {})
            });
        }
    }
    return { positions, routes };
}

/**
 * A package diagram, laid out as one: the ontology a frame round its member
 * packages, the ontologies it imports outside, and every dependency a step
 * from the package depended on down to the one that depends on it.
 *
 * Supplier above client is the class diagram's reading carried over: a
 * package that uses `core` mostly specializes what `core` declares, and in
 * the class diagram those supertypes sit above. None of the class layout's
 * repairs apply -- there are no relators to seat or taxonomies to rank -- so
 * ELK's arrangement is the arrangement.
 */
async function packageLayout(
    view: ViewModel,
    sizes: Record<string, Size>,
    current: Positions,
    request: AutoLayoutRequest
): Promise<AutoLayoutResult> {
    const requestedSettings: LayoutOptions = { ...defaultLayoutOptions, ...request };
    const scale = clampAssociationDistance(requestedSettings.associationDistance)
        / defaultLayoutOptions.associationDistance;
    const settings: LayoutOptions = {
        ...requestedSettings,
        nodeSpacing: Math.round(requestedSettings.nodeSpacing * scale),
        rankSpacing: Math.round(requestedSettings.rankSpacing * scale)
    };
    const subject = new Set(request.only ?? view.nodes.map(node => node.id));
    if (subject.size === 0) {
        return { positions: current, routes: {} };
    }
    const sizeOf = (id: string): Size => sizes[id] ?? { width: 160, height: 60 };
    const algorithmOptions = optionsFor(settings, request.routing ?? 'straight');
    const frames = view.groups.filter(group => group.kind === 'ontology');
    const framed = new Set(frames.flatMap(group => group.nodes));
    const nodes = new Set(view.nodes.map(node => node.id));
    const ends = new Set([...nodes, ...frames.map(group => group.id)]);
    const coveredInverseIds = inversePairs(view.edges).covered;
    const graph: ElkNode = {
        id: 'root',
        layoutOptions: {
            ...algorithmOptions,
            // An import the manifest declares leaves from the frame itself,
            // which is an edge on a compound node: ELK lays those out only
            // when it lays the hierarchy out as one.
            'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
            'elk.json.edgeCoords': 'ROOT'
        },
        children: [
            ...frames.map(group => ({
                id: group.id,
                layoutOptions: {
                    ...algorithmOptions,
                    'elk.padding': `[top=${GROUP_PADDING + GROUP_HEADER},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`
                },
                children: group.nodes.filter(id => nodes.has(id)).map(id => ({ id, ...sizeOf(id) }))
            })),
            ...view.nodes.filter(node => !framed.has(node.id)).map(node => ({ id: node.id, ...sizeOf(node.id) }))
        ],
        edges: view.edges
            .filter(edge => !coveredInverseIds.has(edge.id))
            .filter(edge => ends.has(edge.source) && ends.has(edge.target) && edge.source !== edge.target)
            .map((edge): ElkEdge => ({ id: edge.id, sources: [edge.target], targets: [edge.source] }))
    };
    const laid = await new Elk().layout(graph);
    const positions: Positions = { ...current };
    const walk = (node: ElkNode, offsetX: number, offsetY: number) => {
        for (const child of node.children ?? []) {
            const x = offsetX + (child.x ?? 0);
            const y = offsetY + (child.y ?? 0);
            if (nodes.has(child.id)) {
                if (subject.has(child.id)) {
                    positions[child.id] = {
                        x: Math.round(x),
                        y: Math.round(y),
                        width: child.width ?? sizeOf(child.id).width,
                        height: child.height ?? sizeOf(child.id).height
                    };
                }
            } else {
                walk(child, x, y);
            }
        }
    };
    walk(laid, 0, 0);
    if (request.only) {
        placePartialLayout(view, positions, current, subject);
    }
    // No routes, whatever the routing: ELK's would run to the frame ELK
    // drew, and the frame drawn is the one round the packages where they
    // end up, which a partial layout or a constraint may have moved.
    return { positions, routes: {} };
}
