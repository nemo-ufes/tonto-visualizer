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
import { borderPoint, centerOf, segmentHitsRect } from './geometry.js';

export type RoutingStyle = 'straight' | 'orthogonal';

export interface RouteRequest {
    /** A route already decided -- by ELK, or by the modeller -- used as it stands. */
    stored?: Point[];
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

/** How much of two boxes has to line up before they are joined straight across. */
const FACING = 24;
const LOOP = 28;

export function routeEdge(source: Rect, target: Rect, request: RouteRequest = {}): Point[] {
    if (request.stored && request.stored.length >= 2) {
        return request.stored;
    }
    if (source === target || (source.x === target.x && source.y === target.y && source.width === target.width)) {
        return selfLoop(source);
    }
    const offset = spreadOf(request.spread);
    return request.style === 'orthogonal'
        ? orthogonal(source, target, offset)
        : straight(source, target, offset, request.obstacles);
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
function straight(source: Rect, target: Rect, offset: number, obstacles?: Rect[]): Point[] {
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
    return detour(source, target, start, end, blocked, obstacles ?? []);
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
function detour(source: Rect, target: Rect, start: Point, end: Point, blocked: Rect[], obstacles: Rect[]): Point[] {
    const candidates: Point[] = [];
    for (const rect of blocked) {
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
        const first = borderPoint(source, via);
        const last = borderPoint(target, via);
        const hits = others.filter(rect => segmentHitsRect(first, via, rect, 4)
            || segmentHitsRect(via, last, rect, 4)).length;
        const length = Math.hypot(via.x - first.x, via.y - first.y) + Math.hypot(last.x - via.x, last.y - via.y);
        // Fewer boxes crossed first, then the shorter way round; a bend is only
        // ever taken to buy a box back.
        if (hits < best.hits || (hits === best.hits && best.bends > 0 && length < best.length)) {
            best = { points: [round(first), round(via), round(last)], hits, length, bends: 1 };
        }
    }
    return best.points;
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

/** A relation from a class to itself: out of the right side and back into the top. */
function selfLoop(rect: Rect): Point[] {
    const right = rect.x + rect.width;
    const y = Math.round(rect.y + rect.height / 3);
    const x = Math.round(rect.x + rect.width / 2);
    return [
        { x: right, y },
        { x: right + LOOP, y },
        { x: right + LOOP, y: rect.y - LOOP },
        { x, y: rect.y - LOOP },
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
