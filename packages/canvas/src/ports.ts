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
 * of the angle each line leaves at -- which keeps them from crossing each other
 * on the way in, and gives every line a corridor of its own to be labelled in.
 *
 * A relator is the exception. It is a reified relationship, and its mediations
 * are the relationship: the drawing should read as one line from one relatum to
 * the other, passing through the relator on its way. Spreading those ends evenly
 * along the border breaks that -- the line arrives at the middle of the top edge
 * from the left and leaves the middle of the bottom edge to the right, which
 * reads as two lines meeting at a box rather than as one line through it. So an
 * end named in `through` is anchored where the ray from the centre of the box
 * out to the far end crosses the border. Each such line then points at the
 * relator's centre, and a pair of them lines up across it.
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
    /** Anchored on the ray out of the centre rather than spread along the side. */
    through: boolean;
    /** What that ray points at: the far end, once it is known, else its centre. */
    aim: Point;
}

/** How close to a corner a line may attach. */
const MARGIN = 14;

/** How close two ends may sit on one side before they read as one. */
const GAP = 12;

/** Names one end of one edge: the end of `edge` that touches `node`. */
export function endKey(edge: string, node: string): string {
    return `${edge}@${node}`;
}

export function assignPorts(
    edges: Array<{ id: string; source: string; target: string }>,
    positions: Record<string, Rect>,
    /** The ends to aim through the centre of the box, by `endKey`. */
    through: ReadonlySet<string> = new Set()
): Map<string, EdgeEnds> {
    const arrivals = new Map<string, Arrival[]>();
    for (const edge of edges) {
        const source = positions[edge.source];
        const target = positions[edge.target];
        if (!source || !target || edge.source === edge.target) {
            continue;
        }
        push(arrivals, edge.source, {
            edge: edge.id, isSource: true, from: centerOf(target), aim: centerOf(target),
            through: through.has(endKey(edge.id, edge.source))
        });
        push(arrivals, edge.target, {
            edge: edge.id, isSource: false, from: centerOf(source), aim: centerOf(source),
            through: through.has(endKey(edge.id, edge.target))
        });
    }

    // Twice over. The first pass aims a line to be read through a box at the
    // centre of the box at its far end, because that is all there is to aim at;
    // the second aims it at the point the first pass gave that far end, which is
    // where the line will actually be drawn to. Without it a mediation to a tall
    // class was anchored for a line steeper than the one drawn, and missed the
    // relator's centre by half its height.
    let ends = place(arrivals, positions);
    if (through.size > 0) {
        for (const incoming of arrivals.values()) {
            for (const arrival of incoming) {
                const pair = ends.get(arrival.edge);
                const far = arrival.isSource ? pair?.target : pair?.source;
                if (far) {
                    arrival.aim = far;
                }
            }
        }
        ends = place(arrivals, positions);
    }

    const complete = new Map<string, EdgeEnds>();
    for (const [edge, pair] of ends) {
        if (pair.source && pair.target) {
            complete.set(edge, { source: pair.source, target: pair.target });
        }
    }
    return complete;
}

/** One pass: every arrival given its point on the border of the box it meets. */
function place(
    arrivals: Map<string, Arrival[]>,
    positions: Record<string, Rect>
): Map<string, Partial<EdgeEnds>> {
    const ends = new Map<string, Partial<EdgeEnds>>();
    for (const [nodeId, incoming] of arrivals) {
        const rect = positions[nodeId]!;
        const bySide = new Map<Side, Arrival[]>();
        for (const arrival of incoming) {
            const side = sideOf(rect, arrival.from);
            bySide.set(side, [...(bySide.get(side) ?? []), arrival]);
        }
        for (const [side, group] of bySide) {
            // Ordered by the angle each line leaves at, so they fan out without
            // crossing one another between the border and open space.
            const ordered = [...group].sort((one, other) =>
                fanAngle(rect, side, one.from) - fanAngle(rect, side, other.from)
                || one.edge.localeCompare(other.edge));
            // A line to be read through the box asks for the point its own ray
            // crosses; the rest take their share of the side, as they always
            // have. Both are then held apart, so that aiming a line through the
            // centre cannot drop it onto the line beside it.
            const even = ordered.map((_, index) => alongAt(rect, side, (index + 1) / (ordered.length + 1)));
            const wanted = ordered.map((arrival, index) => (arrival.through
                ? alongThrough(rect, side, arrival.aim)
                : even[index]!));
            // Nothing moves on a side that has no line to read through it: the
            // even share is what every other box has always been given.
            const spaced = ordered.some(arrival => arrival.through)
                ? separate(wanted, even, lengthOf(rect, side))
                : even;
            ordered.forEach((arrival, index) => {
                const at = pointOn(rect, side, spaced[index]!);
                const current = ends.get(arrival.edge) ?? {};
                ends.set(arrival.edge, arrival.isSource ? { ...current, source: at } : { ...current, target: at });
            });
        }
    }
    return ends;
}

/**
 * Where an arrival belongs in the fan of lines leaving one side of a box.
 *
 * The ends have to be placed along a side in the order the lines leave in, or
 * two of them cross each other on the way out -- a crossing the reader has to
 * untangle to see which class each line reaches, and one the arrangement never
 * asked for.
 *
 * That order was taken from the far box's x on a top or bottom side and its y on
 * a left or right one, which is the same order only while the far boxes differ
 * on that axis. A layered layout puts a whole rank at one y: three lines leaving
 * the right side of a class for three classes on the rank below had the same y,
 * the comparison tied, and the tiebreak ordered them by edge id -- alphabetically,
 * which on `boats` came out exactly reversed and crossed two of the three.
 *
 * The angle is the order in every case, and ties only for two lines that really
 * do leave in the same direction. Measured against the outward normal of the
 * side so that it grows the way ends are placed along it: rightwards on a top or
 * bottom side, downwards on a left or right one.
 */
function fanAngle(rect: Rect, side: Side, towards: Point): number {
    const centre = centerOf(rect);
    const dx = towards.x - centre.x;
    const dy = towards.y - centre.y;
    switch (side) {
        case 'top':
            return Math.atan2(dx, -dy);
        case 'bottom':
            return Math.atan2(dx, dy);
        case 'left':
            return Math.atan2(dy, -dx);
        case 'right':
        default:
            return Math.atan2(dy, dx);
    }
}

function lengthOf(rect: Rect, side: Side): number {
    return side === 'top' || side === 'bottom' ? rect.width : rect.height;
}

/** How far along a side a fraction of it falls, kept clear of the corners. */
function alongAt(rect: Rect, side: Side, fraction: number): number {
    const length = lengthOf(rect, side);
    const usable = Math.max(length - MARGIN * 2, 0);
    return (length - usable) / 2 + usable * fraction;
}

/** Where the ray from the centre of the box out to `towards` crosses `side`. */
function alongThrough(rect: Rect, side: Side, towards: Point): number {
    const centre = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const dx = towards.x - centre.x;
    const dy = towards.y - centre.y;
    const length = lengthOf(rect, side);
    const half = length / 2;
    if (side === 'top' || side === 'bottom') {
        const reach = dy === 0 ? 0 : (rect.height / 2) * (dx / Math.abs(dy));
        return clamp(half + reach, rect.width);
    }
    const reach = dx === 0 ? 0 : (rect.width / 2) * (dy / Math.abs(dx));
    return clamp(half + reach, rect.height);
}

function clamp(along: number, length: number): number {
    const low = Math.min(MARGIN, length / 2);
    return Math.max(low, Math.min(length - low, along));
}

/**
 * The same ends, no two of them within `GAP` of each other.
 *
 * Pushed apart from the front and then held back from the far corner. A side
 * with more ends than it has room for falls back on the even share, which at
 * least crowds them in order instead of pushing the last of them off the corner.
 */
function separate(wanted: number[], even: number[], length: number): number[] {
    const low = Math.min(MARGIN, length / 2);
    const high = Math.max(length - low, low);
    if ((wanted.length - 1) * GAP > high - low) {
        return even;
    }
    const spaced = [...wanted];
    for (let index = 0; index < spaced.length; index += 1) {
        const floor = index === 0 ? low : spaced[index - 1]! + GAP;
        spaced[index] = Math.max(spaced[index]!, floor);
    }
    for (let index = spaced.length - 1; index >= 0; index -= 1) {
        const ceiling = index === spaced.length - 1 ? high : spaced[index + 1]! - GAP;
        spaced[index] = Math.min(spaced[index]!, ceiling);
    }
    return spaced;
}

/** The point that far along one side of the box. */
function pointOn(rect: Rect, side: Side, along: number): Point {
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
