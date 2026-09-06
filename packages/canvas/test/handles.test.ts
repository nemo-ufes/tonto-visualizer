import { describe, expect, test } from 'vitest';
import { dropHandle, handlesFor, moveHandle } from '../src/handles.js';
import type { Point } from '../src/geometry.js';

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
