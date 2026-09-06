/**
 * Where each line meets each box.
 *
 * Every edge used to aim at the centre of the box at its far end and stop where
 * that ray crossed the border, so two edges between neighbouring classes met the
 * border within a pixel or two of each other and ran together for most of their
 * length. Two associations that look like one line is the worst thing a class
 * diagram can do: the reader counts one relationship where the model has two,
 * and the multiplicities of both sit in the same place with nothing to say which
 * belongs to which.
 *
 * So the ends that arrive at one side of a box are spread along it, in the order
 * of where they come from -- which keeps them from crossing each other on the
 * way in, and gives every line a corridor of its own to be labelled in.
 */

import type { Point, Rect, Side } from './geometry.js';
import { centerOf, sideOf } from './geometry.js';

export interface EdgeEnds {
    source: Point;
    target: Point;
}

interface Arrival {
    edge: string;
    isSource: boolean;
    /** Where the line is coming from, which decides the side and the order. */
    from: Point;
}

/** How close to a corner a line may attach. */
const MARGIN = 14;

export function assignPorts(
    edges: Array<{ id: string; source: string; target: string }>,
    positions: Record<string, Rect>
): Map<string, EdgeEnds> {
    const arrivals = new Map<string, Arrival[]>();
    for (const edge of edges) {
        const source = positions[edge.source];
        const target = positions[edge.target];
        if (!source || !target || edge.source === edge.target) {
            continue;
        }
        push(arrivals, edge.source, { edge: edge.id, isSource: true, from: centerOf(target) });
        push(arrivals, edge.target, { edge: edge.id, isSource: false, from: centerOf(source) });
    }

    const ends = new Map<string, Partial<EdgeEnds>>();
    for (const [nodeId, incoming] of arrivals) {
        const rect = positions[nodeId]!;
        const bySide = new Map<Side, Arrival[]>();
        for (const arrival of incoming) {
            const side = sideOf(rect, arrival.from);
            bySide.set(side, [...(bySide.get(side) ?? []), arrival]);
        }
        for (const [side, group] of bySide) {
            // Ordered by where each line comes from, so lines fan out without
            // crossing one another between the border and their first bend.
            const ordered = [...group].sort((one, other) =>
                (side === 'top' || side === 'bottom'
                    ? one.from.x - other.from.x
                    : one.from.y - other.from.y)
                || one.edge.localeCompare(other.edge));
            ordered.forEach((arrival, index) => {
                const at = portOn(rect, side, (index + 1) / (ordered.length + 1));
                const current = ends.get(arrival.edge) ?? {};
                ends.set(arrival.edge, arrival.isSource ? { ...current, source: at } : { ...current, target: at });
            });
        }
    }

    const complete = new Map<string, EdgeEnds>();
    for (const [edge, pair] of ends) {
        if (pair.source && pair.target) {
            complete.set(edge, { source: pair.source, target: pair.target });
        }
    }
    return complete;
}

/** A point a fraction of the way along one side, kept clear of the corners. */
function portOn(rect: Rect, side: Side, fraction: number): Point {
    const horizontal = side === 'top' || side === 'bottom';
    const length = horizontal ? rect.width : rect.height;
    const usable = Math.max(length - MARGIN * 2, 0);
    const along = (length - usable) / 2 + usable * fraction;
    switch (side) {
        case 'top':
            return { x: rect.x + along, y: rect.y };
        case 'bottom':
            return { x: rect.x + along, y: rect.y + rect.height };
        case 'left':
            return { x: rect.x, y: rect.y + along };
        case 'right':
        default:
            return { x: rect.x + rect.width, y: rect.y + along };
    }
}

function push(index: Map<string, Arrival[]>, key: string, arrival: Arrival): void {
    index.set(key, [...(index.get(key) ?? []), arrival]);
}
