import { describe, expect, test } from 'vitest';
import { safeRestoredPlacements } from '../src/restoration.js';

describe('restoring hidden cards', () => {
    test('unplaces a restored card when a visible card now occupies its old rectangle', () => {
        const result = safeRestoredPlacements(
            ['visible', 'restored'],
            new Set(['restored']),
            {
                visible: { width: 120, height: 60 },
                restored: { width: 120, height: 60 }
            },
            {
                visible: { x: 40, y: 80 },
                restored: { x: 40, y: 80 }
            }
        );

        expect(result.placed.visible).toEqual({ x: 40, y: 80 });
        expect(result.placed.restored).toBeUndefined();
        expect(result.repositioned).toEqual(new Set(['restored']));
    });

    test('keeps an unobstructed restored placement', () => {
        const result = safeRestoredPlacements(
            ['visible', 'restored'],
            new Set(['restored']),
            {
                visible: { width: 120, height: 60 },
                restored: { width: 120, height: 60 }
            },
            {
                visible: { x: 0, y: 0 },
                restored: { x: 200, y: 0 }
            }
        );

        expect(result.placed.restored).toEqual({ x: 200, y: 0 });
        expect(result.repositioned.size).toBe(0);
    });
});
