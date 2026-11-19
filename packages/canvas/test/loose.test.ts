import { describe, expect, test } from 'vitest';
import type { Rect } from '../src/geometry.js';
import { boundsOf, overlaps, segmentHitsRect } from '../src/geometry.js';
import { placeLoose } from '../src/loose.js';

const options = { gap: 30, edgeClearance: 16, separation: 60 };
const box = (x: number, y: number, width = 160, height = 60): Rect => ({ x, y, width, height });
const block = (id: string, users: string[] = [], width = 120, height = 70) =>
    ({ id, size: { width, height }, users });

describe('placing what the layered layout leaves loose', () => {

    test('puts a value type in the free space next to the class that uses it', () => {
        const placed = {
            Person: box(0, 0), Organization: box(600, 0),
            Child: box(0, 300), Adult: box(600, 300)
        };
        const at = placeLoose([block('Address', ['Person'])], placed, [], options);
        const address = { ...at.Address!, width: 120, height: 70 };

        // Inside the picture, so it grows no larger, and clear of every box.
        expect(boundsOf([...Object.values(placed), address])).toEqual(boundsOf(Object.values(placed)));
        expect(Object.values(placed).some(rect => overlaps(rect, address, options.gap))).toBe(false);
        // Beside Person, not beside the class across the picture.
        expect(address.x).toBeLessThan(300);
        expect(address.y).toBeLessThan(150);
    });

    test('keeps off the lines already drawn', () => {
        const placed = { Person: box(0, 0), Adult: box(0, 300), Organization: box(600, 0), Child: box(600, 300) };
        const lines = [
            [{ x: 80, y: 30 }, { x: 80, y: 330 }],
            [{ x: 80, y: 30 }, { x: 680, y: 330 }],
            [{ x: 680, y: 30 }, { x: 80, y: 330 }]
        ] as const;
        const at = placeLoose([block('Address', ['Person'])], placed, lines, options);
        const address = { ...at.Address!, width: 120, height: 70 };
        expect(lines.some(([from, to]) => segmentHitsRect(from, to, address, options.edgeClearance))).toBe(false);
    });

    test('packs what does not fit under a wide model, in rows of balanced length', () => {
        const placed = { Left: box(0, 0), Middle: box(320, 0), Right: box(640, 0) };
        const blocks = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map(id => block(id, ['Middle']));
        const at = placeLoose(blocks, placed, [], options);
        const rows = new Map<number, number>();
        for (const point of Object.values(at)) {
            expect(point.y).toBeGreaterThanOrEqual(60 + options.separation);
            rows.set(point.y, (rows.get(point.y) ?? 0) + 1);
        }
        // Seven of them within the model's width: four and three, not six and one.
        expect([...rows.values()].sort()).toEqual([3, 4]);
        const all = boundsOf([...Object.values(placed),
            ...Object.values(at).map(point => ({ ...point, width: 120, height: 70 }))]);
        expect(all.width).toBe(800);
    });

    test('packs beside a tall model rather than under it', () => {
        const placed = { Top: box(0, 0), Middle: box(0, 400), Bottom: box(0, 800) };
        const at = placeLoose([block('A', ['Middle'], 120, 300)], placed, [], options);
        expect(at.A!.x).toBe(160 + options.separation);
    });

    test('makes a block of its own when nothing else is placed', () => {
        const at = placeLoose(['A', 'B', 'C', 'D'].map(id => block(id)), {}, [], options);
        const rects = Object.values(at).map(point => ({ ...point, width: 120, height: 70 }));
        expect(rects.every((rect, index) => rects.every((other, at) => at === index || !overlaps(rect, other)))).toBe(true);
        const bounds = boundsOf(rects);
        expect(bounds.width / bounds.height).toBeGreaterThan(1);
        expect(bounds.width / bounds.height).toBeLessThan(4);
    });
});
