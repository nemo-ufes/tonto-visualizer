/** Rectangles, points, and the small amount of geometry an edge needs. */

export interface Point {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface Rect extends Point, Size {}

export type Side = 'top' | 'right' | 'bottom' | 'left';

export function centerOf(rect: Rect): Point {
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

export function overlaps(one: Rect, other: Rect, margin = 0): boolean {
    return one.x - margin < other.x + other.width
        && one.x + one.width + margin > other.x
        && one.y - margin < other.y + other.height
        && one.y + one.height + margin > other.y;
}

export function boundsOf(rects: Rect[]): Rect {
    if (rects.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }
    const left = Math.min(...rects.map(rect => rect.x));
    const top = Math.min(...rects.map(rect => rect.y));
    const right = Math.max(...rects.map(rect => rect.x + rect.width));
    const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Where a line towards `towards` leaves the rectangle.
 *
 * Anchoring on the border rather than on the centre is what keeps an arrowhead
 * off the middle of a class name, and doing it by intersection rather than by
 * picking a fixed port is what lets a box be dragged anywhere and still be met
 * squarely.
 */
export function borderPoint(rect: Rect, towards: Point): Point {
    const center = centerOf(rect);
    const dx = towards.x - center.x;
    const dy = towards.y - center.y;
    if (dx === 0 && dy === 0) {
        return center;
    }
    const halfWidth = rect.width / 2;
    const halfHeight = rect.height / 2;
    // The scale at which the ray first meets one of the four edges.
    const scale = Math.min(
        dx === 0 ? Infinity : halfWidth / Math.abs(dx),
        dy === 0 ? Infinity : halfHeight / Math.abs(dy)
    );
    return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/** Which side of the rectangle a point sits against. */
export function sideOf(rect: Rect, point: Point): Side {
    const center = centerOf(rect);
    const dx = (point.x - center.x) / (rect.width / 2 || 1);
    const dy = (point.y - center.y) / (rect.height / 2 || 1);
    if (Math.abs(dx) >= Math.abs(dy)) {
        return dx >= 0 ? 'right' : 'left';
    }
    return dy >= 0 ? 'bottom' : 'top';
}

export function distance(one: Point, other: Point): number {
    return Math.hypot(one.x - other.x, one.y - other.y);
}

/** A point `offset` along the segment that starts the path, for an end label. */
export function alongPath(points: Point[], fromStart: boolean, offset: number): Point {
    const ordered = fromStart ? points : [...points].reverse();
    let remaining = offset;
    for (let index = 0; index + 1 < ordered.length; index += 1) {
        const from = ordered[index]!;
        const to = ordered[index + 1]!;
        const length = distance(from, to);
        if (length >= remaining) {
            const ratio = length === 0 ? 0 : remaining / length;
            return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
        }
        remaining -= length;
    }
    return ordered[ordered.length - 1] ?? { x: 0, y: 0 };
}

/** The middle of a path, by length rather than by index. */
export function midpointOf(points: Point[]): Point {
    const total = points.slice(1).reduce((sum, point, index) => sum + distance(points[index]!, point), 0);
    return alongPath(points, true, total / 2);
}
