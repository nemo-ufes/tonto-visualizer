import { describe, expect, test } from 'vitest';
import type { ViewModel } from 'tonto-view';
import { routesAffectedBy, safeRestoredPlacements } from '../src/restoration.js';

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

    test('recognizes an unsaved visible placement as occupied', () => {
        const result = safeRestoredPlacements(
            ['new-class', 'restored'],
            new Set(['restored']),
            {
                'new-class': { width: 120, height: 60 },
                restored: { width: 120, height: 60 }
            },
            {
                // The caller merges current on-screen positions with saved
                // ones, so a class just added to the text already owns space.
                'new-class': { x: 40, y: 80, width: 120, height: 60 },
                restored: { x: 40, y: 80 }
            }
        );

        expect(result.placed.restored).toBeUndefined();
        expect(result.repositioned).toEqual(new Set(['restored']));
    });

    test('invalidates a stored route crossed by a restored card', () => {
        const routed: ViewModel = {
            groups: [], gensets: [],
            nodes: ['left', 'right', 'restored'].map(id => ({
                id, kind: 'class', name: id, color: '#eee', isExternal: false, attributes: []
            })),
            edges: [{
                kind: 'relation', id: 'across', source: 'left', target: 'right',
                sourceEnd: { isConst: false, isAddOnly: false },
                targetEnd: { isConst: false, isAddOnly: false }
            }]
        };

        const affected = routesAffectedBy(
            routed,
            {
                left: { x: 0, y: 0, width: 40, height: 40 },
                right: { x: 300, y: 0, width: 40, height: 40 },
                restored: { x: 140, y: 0, width: 60, height: 60 }
            },
            { across: { points: [{ x: 40, y: 20 }, { x: 300, y: 20 }] } },
            new Set(['restored'])
        );

        expect(affected).toEqual(['across']);
    });

    test('invalidates the route of a hidden association when its endpoint moves', () => {
        const catalog: ViewModel = {
            groups: [], gensets: [],
            nodes: ['person', 'organization'].map(id => ({
                id, kind: 'class', name: id, color: '#eee', isExternal: false, attributes: []
            })),
            // This is deliberately the unfiltered catalog: the visible view
            // has no edge while the association is hidden.
            edges: [{
                kind: 'relation', id: 'works-for', source: 'person', target: 'organization',
                sourceEnd: { isConst: false, isAddOnly: false },
                targetEnd: { isConst: false, isAddOnly: false }
            }]
        };

        const affected = routesAffectedBy(
            catalog,
            {
                person: { x: 80, y: 0, width: 80, height: 40 },
                organization: { x: 300, y: 0, width: 80, height: 40 }
            },
            { 'works-for': { points: [{ x: 40, y: 20 }, { x: 300, y: 20 }] } },
            new Set(['person'])
        );

        expect(affected).toEqual(['works-for']);
    });
});
