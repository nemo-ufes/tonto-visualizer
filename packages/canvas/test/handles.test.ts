import { describe, expect, test } from 'vitest';
import { cornerOf, dropHandle, handlesFor, moveHandle, resizeTo } from '../src/handles.js';
import type { Point, Rect } from '../src/geometry.js';

/** A line from one border to another, with one bend in the middle of it. */
function bent(): Point[] {
    return [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
}

describe('taking hold of a route', () => {

    test('offers a handle on every bend and every stretch between them', () => {
        const handles = handlesFor(bent());
        expect(handles.map(handle => handle.kind)).toEqual(['new', 'bend', 'new']);
        expect(handles.filter(handle => handle.kind === 'new').map(handle => handle.at))
            .toEqual([{ x: 50, y: 0 }, { x: 100, y: 50 }]);
    });

    test('offers none on the two ends', () => {
        // A route holds where it meets each class, and that is the ports'
        // answer: a border point moved by hand leaves the line in mid-air the
        // next time the class changes size.
        const points = bent();
        const held = handlesFor(points).filter(handle => handle.kind === 'bend').map(handle => handle.index);
        expect(held).toEqual([1]);
        expect(held).not.toContain(0);
        expect(held).not.toContain(points.length - 1);
    });

    test('leaves a stretch too short to aim at without one', () => {
        // Two handles a few pixels apart are one target the pointer cannot
        // choose between.
        const handles = handlesFor([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 200, y: 0 }]);
        expect(handles.filter(handle => handle.kind === 'new')).toHaveLength(1);
        expect(handles.filter(handle => handle.kind === 'bend')).toHaveLength(1);
    });

    test('offers nothing on a line with no room for a bend', () => {
        expect(handlesFor([{ x: 0, y: 0 }, { x: 4, y: 0 }])).toEqual([]);
        expect(handlesFor([{ x: 0, y: 0 }])).toEqual([]);
    });

    test('makes a bend where a new handle is dragged, between the two it came from', () => {
        const points = bent();
        const handle = handlesFor(points).find(one => one.kind === 'new')!;
        const moved = moveHandle(points, handle, { x: 50, y: -40 });
        // Between its neighbours, not after them: on the wrong side of the bend
        // beside it the line doubles back on itself.
        expect(moved).toEqual([{ x: 0, y: 0 }, { x: 50, y: -40 }, { x: 100, y: 0 }, { x: 100, y: 100 }]);
    });

    test('moves a bend the route already has rather than adding one', () => {
        const points = bent();
        const handle = handlesFor(points).find(one => one.kind === 'bend')!;
        const moved = moveHandle(points, handle, { x: 140, y: -20 });
        expect(moved).toEqual([{ x: 0, y: 0 }, { x: 140, y: -20 }, { x: 100, y: 100 }]);
    });

    test('leaves the route it was given alone', () => {
        const points = bent();
        moveHandle(points, handlesFor(points)[0]!, { x: 9, y: 9 });
        expect(points).toEqual(bent());
    });

    test('drops a bend and keeps the rest', () => {
        const points = [{ x: 0, y: 0 }, { x: 50, y: -40 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
        expect(dropHandle(points, 2)).toEqual([{ x: 0, y: 0 }, { x: 50, y: -40 }, { x: 100, y: 100 }]);
    });

    test('gives the line back to the router when the last bend goes', () => {
        // Not a two-point route: a stored one would keep the ends it was given
        // and lose the ports and the way round anything in between.
        expect(dropHandle(bent(), 1)).toBeUndefined();
    });

    test('will not drop an end', () => {
        expect(dropHandle(bent(), 0)).toEqual(bent());
        expect(dropHandle(bent(), 2)).toEqual(bent());
    });
});

describe('taking hold of a corner', () => {
    const card: Rect = { x: 100, y: 100, width: 120, height: 40 };
    const least = { width: 120, height: 40 };

    test('knows where each corner is', () => {
        expect(cornerOf(card, 'top-left')).toEqual({ x: 100, y: 100 });
        expect(cornerOf(card, 'bottom-right')).toEqual({ x: 220, y: 140 });
        expect(cornerOf(card, 'top-right')).toEqual({ x: 220, y: 100 });
        expect(cornerOf(card, 'bottom-left')).toEqual({ x: 100, y: 140 });
    });

    test('leaves the opposite corner where it was', () => {
        // Pulling the bottom right moves nothing but the size; pulling the top
        // left moves the card as well, and the bottom right must not shift.
        expect(resizeTo(card, 'bottom-right', { x: 300, y: 200 }, least))
            .toEqual({ x: 100, y: 100, width: 200, height: 100 });
        expect(resizeTo(card, 'top-left', { x: 60, y: 40 }, least))
            .toEqual({ x: 60, y: 40, width: 160, height: 100 });
        expect(cornerOf(resizeTo(card, 'top-left', { x: 60, y: 40 }, least), 'bottom-right'))
            .toEqual(cornerOf(card, 'bottom-right'));
        expect(cornerOf(resizeTo(card, 'bottom-left', { x: 40, y: 260 }, least), 'top-right'))
            .toEqual(cornerOf(card, 'top-right'));
    });

    test('stops at the size of what the card holds', () => {
        // A card too small for what is written in it is not a smaller card, it
        // is a broken one.
        expect(resizeTo(card, 'bottom-right', { x: 110, y: 105 }, least))
            .toEqual({ x: 100, y: 100, width: 120, height: 40 });
    });

    test('keeps the far corner still even when the pull is stopped', () => {
        // Pulled past the content from the top left, the card may not creep:
        // the corner it is anchored on has to stay exactly where it was.
        const stopped = resizeTo(card, 'top-left', { x: 400, y: 400 }, least);
        expect(stopped).toEqual({ x: 100, y: 100, width: 120, height: 40 });
        expect(cornerOf(stopped, 'bottom-right')).toEqual(cornerOf(card, 'bottom-right'));
    });
});
