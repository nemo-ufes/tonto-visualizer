/**
 * Where an edge runs.
 *
 * Orthogonal, because a class diagram reads as a grid and a diagonal through
 * three boxes reads as nothing. Two boxes that face each other are joined
 * straight across; anything else gets a single jog, on the axis they are
 * furthest apart along.
 *
 * Waypoints the modeller dragged are obeyed exactly. They are the whole reason
 * routes are computed here rather than asked of a layout engine: an engine
 * re-routes everything when anything changes, and a route someone corrected by
 * hand would not survive the next keystroke.
 */

import type { Point, Rect } from './geometry.js';
import { centerOf } from './geometry.js';

/** How much of two boxes has to line up before they are joined straight across. */
const FACING = 24;
const LOOP = 28;

export function routeEdge(source: Rect, target: Rect, stored?: Point[]): Point[] {
    if (stored && stored.length >= 2) {
        return stored;
    }
    if (source === target || (source.x === target.x && source.y === target.y && source.width === target.width)) {
        return selfLoop(source);
    }
    return orthogonal(source, target);
}

function orthogonal(source: Rect, target: Rect): Point[] {
    const verticalOverlap = overlapRange(source.y, source.y + source.height, target.y, target.y + target.height);
    const horizontalOverlap = overlapRange(source.x, source.x + source.width, target.x, target.x + target.width);

    if (verticalOverlap && verticalOverlap.length >= FACING && !horizontallyTouching(source, target)) {
        const y = Math.round(verticalOverlap.middle);
        const goingRight = target.x > source.x;
        return [
            { x: goingRight ? source.x + source.width : source.x, y },
            { x: goingRight ? target.x : target.x + target.width, y }
        ];
    }

    if (horizontalOverlap && horizontalOverlap.length >= FACING) {
        const x = Math.round(horizontalOverlap.middle);
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
        const middle = Math.round((startX + endX) / 2);
        return [
            { x: startX, y: Math.round(from.y) },
            { x: middle, y: Math.round(from.y) },
            { x: middle, y: Math.round(to.y) },
            { x: endX, y: Math.round(to.y) }
        ];
    }
    const goingDown = to.y > from.y;
    const startY = goingDown ? source.y + source.height : source.y;
    const endY = goingDown ? target.y : target.y + target.height;
    const middle = Math.round((startY + endY) / 2);
    return [
        { x: Math.round(from.x), y: startY },
        { x: Math.round(from.x), y: middle },
        { x: Math.round(to.x), y: middle },
        { x: Math.round(to.x), y: endY }
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
