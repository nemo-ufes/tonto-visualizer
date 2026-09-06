/**
 * Where an edge runs.
 *
 * Straight by default. A UML class diagram is read as a set of things joined by
 * lines, not as a circuit board: a direct line says "these two" at a glance,
 * where a right-angled one has to be followed around two corners, and on a
 * model with many associations the corridors start to look like the diagram.
 * Orthogonal remains, for the taxonomies it does suit -- several subtypes under
 * one supertype line up better with square corners -- but it is a choice now
 * rather than the only thing on offer.
 *
 * Parallel edges are spread apart, which matters far more with straight lines:
 * two mediations between the same relator and class are one line drawn twice
 * unless something moves them apart.
 *
 * A route the modeller drew is obeyed exactly. That is the whole reason routes
 * are computed here rather than asked of a layout engine: an engine re-routes
 * everything when anything changes, and a corrected route would not survive the
 * next keystroke.
 */

import type { Point, Rect } from './geometry.js';
import { borderPoint, centerOf, segmentHitsRect, sideOf } from './geometry.js';

export type RoutingStyle = 'straight' | 'orthogonal';

export interface RouteRequest {
    /** A route already decided -- by ELK, or by the modeller -- used as it stands. */
    stored?: Point[];
    /**
     * Where this line meets each box, when the ends arriving at a box have been
     * spread along its border. Without them every line aims at the far centre,
     * and lines between neighbouring boxes arrive at the same spot.
     */
    ends?: { source: Point; target: Point };
    /** Which of the loops on this class this is, when a class relates to itself. */
    loop?: { index: number; count: number };
    /**
     * Bends other lines have already taken. Two lines going round the same box
     * pick the same corner unless told otherwise, and then they run together
     * between it and their ends -- which is the superimposition the ports were
     * meant to prevent, moved to the middle of the diagram.
     */
    avoid?: Point[];
    style?: RoutingStyle;
    /** Which of the edges between this pair this is, and how many there are. */
    spread?: { index: number; count: number };
    /**
     * Boxes the line should not cross -- every other element in the drawing.
     * A straight line between two distant classes will otherwise pass through
     * whatever stands between them, and a reader following it arrives at the
     * wrong class.
     */
    obstacles?: Rect[];
}

/** How far apart parallel edges run. */
const SPREAD = 16;

/** How wide a berth a detour gives the box it is going round. */
const CLEARANCE = 22;

/** How far a right-angled line steps out of a border before it turns. */
const STUB = 18;

/** How much of two boxes has to line up before they are joined straight across. */
const FACING = 24;
const LOOP = 28;

export function routeEdge(source: Rect, target: Rect, request: RouteRequest = {}): Point[] {
    if (request.stored && request.stored.length >= 2) {
        return request.stored;
    }
    if (source === target || (source.x === target.x && source.y === target.y && source.width === target.width)) {
        return selfLoop(source, request.loop?.index ?? 0);
    }
    const offset = spreadOf(request.spread);
    if (request.ends) {
        return request.style === 'orthogonal'
            ? orthogonalBetween(source, target, request.ends)
            : straightBetween(request.ends, source, target, request.obstacles, request.avoid);
    }
    return request.style === 'orthogonal'
        ? orthogonal(source, target, offset)
        : straight(source, target, offset, request.obstacles, request.avoid);
}

/** The perpendicular distance this edge runs from the line its group shares. */
function spreadOf(spread: { index: number; count: number } | undefined): number {
    if (!spread || spread.count < 2) {
        return 0;
    }
    return (spread.index - (spread.count - 1) / 2) * SPREAD;
}

/**
 * Border to border, on the line between the two centres.
 *
 * A spread edge is the same line moved sideways. The endpoints are the
 * unspread border points pushed along the perpendicular, rather than the
 * intersections of the moved line with the boxes -- a difference of a pixel or
 * two at these offsets, and it keeps a bundle of parallel edges exactly
 * parallel, which is what the eye is reading them by.
 */
/** Port to port, with the same detour round anything in the way. */
function straightBetween(
    ends: { source: Point; target: Point }, source: Rect, target: Rect, obstacles?: Rect[], avoid?: Point[]
): Point[] {
    const start = round(ends.source);
    const end = round(ends.target);
    const blocked = obstacles?.filter(rect => rect !== source && rect !== target
        && segmentHitsRect(start, end, rect, 4));
    if (!blocked || blocked.length === 0) {
        return [start, end];
    }
    // The ports are kept: a detour that re-aimed at the box centres put every
    // blocked line back on the same two border points, which is how two
    // relations between one pair of classes came to be drawn as one line.
    return detour(source, target, start, end, blocked, obstacles ?? [], true, avoid);
}

/**
 * Out of each port at right angles, then one turn -- or two, when both ends
 * leave the same way and the line has to cross between them.
 */
function orthogonalBetween(source: Rect, target: Rect, ends: { source: Point; target: Point }): Point[] {
    const from = stub(source, ends.source);
    const to = stub(target, ends.target);
    const points = [round(ends.source), round(from.at)];
    if (from.vertical === to.vertical) {
        const middle = from.vertical
            ? { first: { x: from.at.x, y: (from.at.y + to.at.y) / 2 }, second: { x: to.at.x, y: (from.at.y + to.at.y) / 2 } }
            : { first: { x: (from.at.x + to.at.x) / 2, y: from.at.y }, second: { x: (from.at.x + to.at.x) / 2, y: to.at.y } };
        points.push(round(middle.first), round(middle.second));
    } else {
        points.push(round(from.vertical ? { x: from.at.x, y: to.at.y } : { x: to.at.x, y: from.at.y }));
    }
    points.push(round(to.at), round(ends.target));
    return points;
}

/** A short step straight out of the border, so the line leaves the box squarely. */
function stub(rect: Rect, at: Point): { at: Point; vertical: boolean } {
    const side = sideOf(rect, at);
    switch (side) {
        case 'top':
            return { at: { x: at.x, y: at.y - STUB }, vertical: true };
        case 'bottom':
            return { at: { x: at.x, y: at.y + STUB }, vertical: true };
        case 'left':
            return { at: { x: at.x - STUB, y: at.y }, vertical: false };
        case 'right':
        default:
            return { at: { x: at.x + STUB, y: at.y }, vertical: false };
    }
}

function straight(source: Rect, target: Rect, offset: number, obstacles?: Rect[], request_avoid?: Point[]): Point[] {
    const from = centerOf(source);
    const to = centerOf(target);
    let start = borderPoint(source, to);
    let end = borderPoint(target, from);
    if (offset !== 0) {
        const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        const shift = { x: -((to.y - from.y) / length) * offset, y: ((to.x - from.x) / length) * offset };
        start = { x: start.x + shift.x, y: start.y + shift.y };
        end = { x: end.x + shift.x, y: end.y + shift.y };
    }

    const blocked = obstacles?.filter(rect => rect !== source && rect !== target
        && segmentHitsRect(start, end, rect, 4));
    if (!blocked || blocked.length === 0) {
        return [round(start), round(end)];
    }
    return detour(source, target, start, end, blocked, obstacles ?? [], false, request_avoid);
}

/**
 * One bend, round the box that is in the way.
 *
 * Straight lines are what a class diagram is read by, and a straight line
 * through an unrelated class is worse than no line: the reader follows it into
 * the wrong box. So an edge that is blocked is offered a corner past each side
 * of every box blocking it, and takes the shortest path that is clear of
 * everything. If nothing is clear -- a corridor with no way through -- it stays
 * straight, because a two-bend detour that still crosses something has bought
 * nothing and costs the reader a corner.
 */
function detour(
    source: Rect, target: Rect, start: Point, end: Point, blocked: Rect[], obstacles: Rect[], keepEnds: boolean,
    avoid: Point[] = []
): Point[] {
    const candidates = cornersOf(blocked);
    const others = obstacles.filter(rect => rect !== source && rect !== target);
    // The straight line is in the running: a detour is worth a corner only if it
    // crosses fewer boxes than going straight through did.
    let best = {
        points: [round(start), round(end)],
        hits: others.filter(rect => segmentHitsRect(start, end, rect, 4)).length,
        length: Math.hypot(end.x - start.x, end.y - start.y),
        bends: 0
    };
    for (const via of candidates) {
        const first = keepEnds ? start : borderPoint(source, via);
        const last = keepEnds ? end : borderPoint(target, via);
        const hits = others.filter(rect => segmentHitsRect(first, via, rect, 4)
            || segmentHitsRect(via, last, rect, 4)).length
            + (avoid.some(point => Math.hypot(point.x - via.x, point.y - via.y) < CLEARANCE) ? 1 : 0);
        const length = Math.hypot(via.x - first.x, via.y - first.y) + Math.hypot(last.x - via.x, last.y - via.y);
        if (hits < best.hits || (hits === best.hits && best.bends > 0 && length < best.length)) {
            best = { points: [round(first), round(via), round(last)], hits, length, bends: 1 };
        }
    }
    if (best.hits === 0) {
        return best.points;
    }

    // One bend was not enough. Two are worth trying before giving up and
    // crossing something: a line that disappears behind a class it has nothing
    // to do with is read as ending there. The corners of whatever blocked the
    // one-bend attempts join the search, since those are the boxes to get round.
    const alsoBlocking = new Set<Rect>();
    for (const via of candidates) {
        const first = keepEnds ? start : borderPoint(source, via);
        const last = keepEnds ? end : borderPoint(target, via);
        for (const rect of others) {
            if (segmentHitsRect(first, via, rect, 4) || segmentHitsRect(via, last, rect, 4)) {
                alsoBlocking.add(rect);
            }
        }
    }
    const wider = [...candidates, ...cornersOf([...alsoBlocking])];
    for (const first of wider) {
        for (const second of wider) {
            if (first === second) {
                continue;
            }
            const from = keepEnds ? start : borderPoint(source, first);
            const to = keepEnds ? end : borderPoint(target, second);
            const hits = others.filter(rect => segmentHitsRect(from, first, rect, 4)
                || segmentHitsRect(first, second, rect, 4)
                || segmentHitsRect(second, to, rect, 4)).length;
            if (hits > 0) {
                continue;
            }
            const length = Math.hypot(first.x - from.x, first.y - from.y)
                + Math.hypot(second.x - first.x, second.y - first.y)
                + Math.hypot(to.x - second.x, to.y - second.y);
            if (best.hits > 0 || length < best.length) {
                best = { points: [round(from), round(first), round(second), round(to)], hits: 0, length, bends: 2 };
            }
        }
    }
    return best.points;
}

/** Corners and side-middles of the boxes to get round, with clearance. */
function cornersOf(rects: Rect[]): Point[] {
    const candidates: Point[] = [];
    for (const rect of rects) {
        const left = rect.x - CLEARANCE;
        const right = rect.x + rect.width + CLEARANCE;
        const top = rect.y - CLEARANCE;
        const bottom = rect.y + rect.height + CLEARANCE;
        const middleX = rect.x + rect.width / 2;
        const middleY = rect.y + rect.height / 2;
        // Corners, and the middle of each side: a box is passed either round its
        // end or over its face, and which is shorter depends on where the two
        // classes sit.
        candidates.push(
            { x: left, y: top }, { x: right, y: top }, { x: left, y: bottom }, { x: right, y: bottom },
            { x: middleX, y: top }, { x: middleX, y: bottom }, { x: left, y: middleY }, { x: right, y: middleY }
        );
    }
    return candidates;
}

function round(point: Point): Point {
    return { x: Math.round(point.x), y: Math.round(point.y) };
}

function orthogonal(source: Rect, target: Rect, offset: number): Point[] {
    const verticalOverlap = overlapRange(source.y, source.y + source.height, target.y, target.y + target.height);
    const horizontalOverlap = overlapRange(source.x, source.x + source.width, target.x, target.x + target.width);

    if (verticalOverlap && verticalOverlap.length >= FACING && !horizontallyTouching(source, target)) {
        const y = Math.round(verticalOverlap.middle + offset);
        const goingRight = target.x > source.x;
        return [
            { x: goingRight ? source.x + source.width : source.x, y },
            { x: goingRight ? target.x : target.x + target.width, y }
        ];
    }

    if (horizontalOverlap && horizontalOverlap.length >= FACING) {
        const x = Math.round(horizontalOverlap.middle + offset);
        const goingDown = target.y > source.y;
        return [
            { x, y: goingDown ? source.y + source.height : source.y },
            { x, y: goingDown ? target.y : target.y + target.height }
        ];
    }

    const from = centerOf(source);
    const to = centerOf(target);
    if (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)) {
        const goingRight = to.x > from.x;
        const startX = goingRight ? source.x + source.width : source.x;
        const endX = goingRight ? target.x : target.x + target.width;
        const middle = Math.round((startX + endX) / 2 + offset);
        return [
            { x: startX, y: Math.round(from.y + offset) },
            { x: middle, y: Math.round(from.y + offset) },
            { x: middle, y: Math.round(to.y + offset) },
            { x: endX, y: Math.round(to.y + offset) }
        ];
    }
    const goingDown = to.y > from.y;
    const startY = goingDown ? source.y + source.height : source.y;
    const endY = goingDown ? target.y : target.y + target.height;
    const middle = Math.round((startY + endY) / 2 + offset);
    return [
        { x: Math.round(from.x + offset), y: startY },
        { x: Math.round(from.x + offset), y: middle },
        { x: Math.round(to.x + offset), y: middle },
        { x: Math.round(to.x + offset), y: endY }
    ];
}

/**
 * A relation from a class to itself: out of the right side and back into the
 * top, each loop wider than the last.
 *
 * A class with two of them -- gUFO's `ConcreteIndividual` has constitution and
 * historical dependence, both to itself -- drew the same rectangle twice, which
 * reads as one relation with two labels stacked on it.
 */
function selfLoop(rect: Rect, index: number): Point[] {
    const reach = LOOP + index * 16;
    const right = rect.x + rect.width;
    const y = Math.round(rect.y + rect.height / 3 + index * 6);
    const x = Math.round(rect.x + rect.width / 2 + index * 10);
    return [
        { x: right, y },
        { x: right + reach, y },
        { x: right + reach, y: rect.y - reach },
        { x, y: rect.y - reach },
        { x, y: rect.y }
    ];
}

function horizontallyTouching(source: Rect, target: Rect): boolean {
    return source.x < target.x + target.width && target.x < source.x + source.width;
}

function overlapRange(
    fromA: number, toA: number, fromB: number, toB: number
): { middle: number; length: number } | undefined {
    const from = Math.max(fromA, fromB);
    const to = Math.min(toA, toB);
    return to > from ? { middle: (from + to) / 2, length: to - from } : undefined;
}
