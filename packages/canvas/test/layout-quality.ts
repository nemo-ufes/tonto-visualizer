import type { ViewModel } from 'tonto-view';
import type { Point, Rect } from '../src/geometry.js';
import { boundsOf, segmentHitsRect, segmentsProperlyCross } from '../src/geometry.js';
import { FONT, textWidth } from '../src/measure.js';
import type { Rendered } from '../src/render.js';

export interface LayoutQuality {
    bounds: { width: number; height: number };
    nodeOverlaps: number;
    edgeCrossings: number;
    edgeNodeIntersections: number;
    edgeLength: { total: number; maximum: number };
    taxonomyViolations: number;
    labelOcclusions: number;
}

function pathLength(points: Point[]): number {
    return points.slice(1).reduce((sum, point, index) =>
        sum + Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y), 0);
}

function overlapArea(one: Rect, other: Rect): number {
    return Math.max(0, Math.min(one.x + one.width, other.x + other.width) - Math.max(one.x, other.x))
        * Math.max(0, Math.min(one.y + one.height, other.y + other.height) - Math.max(one.y, other.y));
}

/** Label boxes reconstructed with the renderer's own text metrics. */
function labelBoxes(svg: string): Rect[] {
    const layer = /<g class="tv-labels">([\s\S]*?)<\/svg>/.exec(svg)?.[1] ?? '';
    return [...layer.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].flatMap(match => {
        const attributes = match[1]!;
        const text = match[2]!;
        const x = Number(/ x="([-\d.]+)"/.exec(attributes)?.[1]);
        const y = Number(/ y="([-\d.]+)"/.exec(attributes)?.[1]);
        if (!text.trim() || !isFinite(x) || !isFinite(y)) {
            return [];
        }
        const size = /tv-edge-stereotype/.test(attributes) ? FONT.edgeStereotype : FONT.edge;
        const width = textWidth(text, size) + 6;
        const anchor = /text-anchor="(\w+)"/.exec(attributes)?.[1] ?? 'start';
        const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
        return [{ x: left, y: y - size, width, height: size + 4 }];
    });
}

/** Measures the final drawing, after semantic movement, routing and labels. */
export function measureLayout(
    view: ViewModel,
    positions: Record<string, Rect>,
    rendered: Rendered,
    direction: 'DOWN' | 'RIGHT'
): LayoutQuality {
    const edgeById = new Map(view.edges.map(edge => [edge.id, edge]));
    const paths = Object.entries(rendered.paths);
    const lengths = paths.map(([, points]) => pathLength(points));
    let edgeNodeIntersections = 0;
    for (const [id, points] of paths) {
        const edge = edgeById.get(id);
        for (const node of view.nodes) {
            const rect = positions[node.id];
            if (!rect || node.id === edge?.source || node.id === edge?.target) {
                continue;
            }
            if (points.slice(1).some((point, index) => segmentHitsRect(points[index]!, point, rect, 2))) {
                edgeNodeIntersections += 1;
            }
        }
    }

    let edgeCrossings = 0;
    for (let one = 0; one < paths.length; one += 1) {
        for (let two = one + 1; two < paths.length; two += 1) {
            const first = paths[one]![1];
            const second = paths[two]![1];
            if (first.slice(1).some((to, index) => second.slice(1).some((otherTo, otherIndex) =>
                segmentsProperlyCross(first[index]!, to, second[otherIndex]!, otherTo)))) {
                edgeCrossings += 1;
            }
        }
    }

    const taxonomyViolations = view.edges.filter(edge => {
        if (edge.kind !== 'generalization') {
            return false;
        }
        const specific = positions[edge.source];
        const general = positions[edge.target];
        if (!specific || !general) {
            return false;
        }
        return direction === 'DOWN'
            ? specific.y < general.y + general.height
            : specific.x < general.x + general.width;
    }).length;

    const labels = labelBoxes(rendered.svg);
    const nodes = Object.values(positions);
    let nodeOverlaps = 0;
    for (let one = 0; one < nodes.length; one += 1) {
        nodeOverlaps += nodes.slice(one + 1).filter(other => overlapArea(nodes[one]!, other) > 0).length;
    }
    let labelOcclusions = labels.filter(label => nodes.some(node => overlapArea(label, node) > 0)).length;
    for (let one = 0; one < labels.length; one += 1) {
        labelOcclusions += labels.slice(one + 1).filter(other => overlapArea(labels[one]!, other) > 0).length;
    }

    const bounds = boundsOf(Object.values(positions));
    return {
        bounds: { width: bounds.width, height: bounds.height },
        nodeOverlaps,
        edgeCrossings,
        edgeNodeIntersections,
        edgeLength: {
            total: Math.round(lengths.reduce((sum, length) => sum + length, 0)),
            maximum: Math.round(Math.max(0, ...lengths))
        },
        taxonomyViolations,
        labelOcclusions
    };
}
