import { describe, expect, test } from 'vitest';
import { defaultDisplayOptions } from 'tonto-view';
import type { ViewModel } from 'tonto-view';
import type { Rect } from '../src/geometry.js';
import { assignPorts } from '../src/ports.js';
import { render } from '../src/render.js';

describe('edge anchors', () => {
    test('anchors a lone diagonal association on its line of sight', () => {
        const positions: Record<string, Rect> = {
            source: { x: 0, y: 0, width: 120, height: 60 },
            target: { x: 300, y: 200, width: 120, height: 60 }
        };
        const ends = assignPorts([
            { id: 'relation', source: 'source', target: 'target', kind: 'relation' }
        ], positions).ends.get('relation');

        // Both points lie on the ray through the two card centres. Dividing a
        // one-line fan evenly instead put them at x=60 and x=360, introducing
        // a needless kink into the apparent direction of a straight relation.
        expect(ends?.source).toEqual({ x: 105, y: 60 });
        expect(ends?.target).toEqual({ x: 315, y: 200 });
    });

    test('separates a close association fan without using the whole side', () => {
        const positions: Record<string, Rect> = {
            source: { x: 0, y: 0, width: 200, height: 60 },
            left: { x: 0, y: 200, width: 120, height: 60 },
            right: { x: 20, y: 200, width: 120, height: 60 }
        };
        const assigned = assignPorts([
            { id: 'left', source: 'source', target: 'left', kind: 'relation' },
            { id: 'right', source: 'source', target: 'right', kind: 'relation' }
        ], positions).ends;
        const left = assigned.get('left')!.source.x;
        const right = assigned.get('right')!.source.x;

        expect(right - left).toBeGreaterThanOrEqual(12);
        expect(left).toBeGreaterThan(75);
        expect(right).toBeLessThan(115);
    });

    test('anchors a generalization on the sides facing its taxonomy rank', () => {
        const positions: Record<string, Rect> = {
            general: { x: 0, y: 0, width: 120, height: 60 },
            specific: { x: 360, y: 200, width: 120, height: 60 }
        };
        const down = assignPorts([
            { id: 'generalization', source: 'specific', target: 'general', kind: 'generalization' }
        ], positions, new Set(), [], 'ray', 'DOWN').ends.get('generalization');

        // The diagonal centre ray meets the inner vertical sides of these far
        // offset cards. In a top-down taxonomy that makes the inheritance line
        // appear to arrive from an unrelated rank; it belongs on the specific's
        // top and the general's bottom even when the cross-axis span is large.
        expect(down?.source.y).toBe(positions.specific!.y);
        expect(down?.target.y).toBe(positions.general!.y + positions.general!.height);

        const right = assignPorts([
            { id: 'generalization', source: 'specific', target: 'general', kind: 'generalization' }
        ], positions, new Set(), [], 'ray', 'RIGHT').ends.get('generalization');
        expect(right?.source.x).toBe(positions.specific!.x);
        expect(right?.target.x).toBe(positions.general!.x + positions.general!.width);
    });

    test('reserves the full triangle width where generalization heads share a border', () => {
        const positions: Record<string, Rect> = {
            general: { x: 0, y: 0, width: 120, height: 42 },
            farLeft: { x: -420, y: 142, width: 120, height: 42 },
            left: { x: -180, y: 142, width: 120, height: 42 },
            right: { x: 180, y: 142, width: 120, height: 42 },
            farRight: { x: 420, y: 142, width: 120, height: 42 }
        };
        const assigned = assignPorts([
            { id: 'far-left', source: 'farLeft', target: 'general', kind: 'generalization' },
            { id: 'left', source: 'left', target: 'general', kind: 'generalization' },
            { id: 'right', source: 'right', target: 'general', kind: 'generalization' },
            { id: 'far-right', source: 'farRight', target: 'general', kind: 'generalization' }
        ], positions, new Set(), [{
            id: 'tree', node: 'general', towards: { x: 120, y: 142 }
        }], 'ray', 'DOWN');
        const heads = [
            assigned.ends.get('far-left')!.target.x,
            assigned.ends.get('left')!.target.x,
            assigned.stems.get('tree')!.x,
            assigned.ends.get('right')!.target.x,
            assigned.ends.get('far-right')!.target.x
        ].sort((one, other) => one - other);

        // A triangle is 16-18px wide; the ordinary 12px line gap let a
        // neighbouring inheritance line enter it even though the centre lines
        // themselves did not cross. The extra stroke clearance makes the
        // rendered heads, not only their zero-width tips, the reserved objects.
        for (let index = 1; index < heads.length; index += 1) {
            expect(heads[index]! - heads[index - 1]!).toBeGreaterThanOrEqual(20);
        }
    });

    test('approaches a generalization head square to its taxonomy rank', () => {
        const positions: Record<string, Rect> = {
            general: { x: 300, y: 0, width: 120, height: 42 },
            one: { x: 0, y: 142, width: 120, height: 42 },
            two: { x: 20, y: 142, width: 120, height: 42 },
            three: { x: 40, y: 142, width: 120, height: 42 },
            four: { x: 60, y: 142, width: 120, height: 42 },
            five: { x: 80, y: 142, width: 120, height: 42 }
        };
        const node = (id: string) => ({
            id, kind: 'class' as const, name: id, package: '', stereotype: 'kind',
            color: '#FFFFFF', isExternal: false, attributes: []
        });
        const view: ViewModel = {
            groups: [],
            nodes: ['general', 'one', 'two', 'three', 'four', 'five'].map(node),
            edges: ['one', 'two', 'three', 'four', 'five'].map(source => ({
                id: `${source}-gen`, kind: 'generalization' as const, source, target: 'general'
            })),
            gensets: []
        };
        const path = render({ view, positions, display: defaultDisplayOptions, direction: 'DOWN' }).paths['one-gen']!;

        expect(path.at(-2)).toEqual({ x: path.at(-1)!.x, y: positions.general!.y + positions.general!.height + 18 });
        expect(path.at(-1)!.y).toBe(positions.general!.y + positions.general!.height);
    });

    test('counts a line entering a neighboring generalization triangle', () => {
        const positions: Record<string, Rect> = {
            general: { x: 672, y: 12, width: 120, height: 42 },
            pet: { x: 222, y: 154, width: 120, height: 42 },
            dog: { x: 402, y: 154, width: 120, height: 42 }
        };
        const node = (id: string) => ({
            id, kind: 'class' as const, name: id, package: '', stereotype: 'kind',
            color: '#FFFFFF', isExternal: false, attributes: []
        });
        const view: ViewModel = {
            groups: [],
            nodes: ['general', 'pet', 'dog'].map(node),
            edges: [
                { id: 'pet-gen', kind: 'generalization', source: 'pet', target: 'general' },
                { id: 'dog-gen', kind: 'generalization', source: 'dog', target: 'general' }
            ],
            gensets: []
        };
        const rendered = render({
            view, positions, display: defaultDisplayOptions, direction: 'DOWN',
            routes: {
                'pet-gen': { points: [{ x: 328, y: 154 }, { x: 686, y: 54 }] },
                'dog-gen': { points: [{ x: 503, y: 154 }, { x: 698, y: 54 }] }
            }
        });

        // The two centre lines do not cross. Dog's line does cross the body of
        // Pet's triangle, which is the visible defect the former metric missed.
        expect(rendered.headCollisions).toBe(1);
    });

    test('falls back from ray anchors when the final routes are less safe', () => {
        const positions: Record<string, Rect> = {
            a: { x: 193, y: 462, width: 120, height: 60 },
            b: { x: 550, y: 235, width: 120, height: 60 },
            c: { x: 298, y: 401, width: 120, height: 60 },
            d: { x: 112, y: 293, width: 120, height: 60 }
        };
        const node = (id: string) => ({
            id, kind: 'class' as const, name: id, package: '', stereotype: 'kind',
            color: '#FFFFFF', isExternal: false, attributes: []
        });
        const relation = (id: string, source: string, target: string) => ({
            id, kind: 'relation' as const, source, target,
            sourceEnd: { isConst: true, isAddOnly: false },
            targetEnd: { isConst: true, isAddOnly: false }
        });
        const view: ViewModel = {
            groups: [],
            nodes: ['a', 'b', 'c', 'd'].map(node),
            edges: [relation('one', 'a', 'b'), relation('two', 'c', 'd'), relation('three', 'a', 'd')],
            gensets: []
        };
        const paths = render({ view, positions, display: defaultDisplayOptions }).paths;

        // Natural rays are preferred, but here their final detours introduce a
        // fault the old even fan avoids. The safety comparison therefore keeps
        // the established anchor at a rather than accepting the local change.
        expect(paths.one?.[0]).toEqual({ x: 268, y: 462 });
        expect(paths.one?.at(-1)).toEqual({ x: 610, y: 295 });
    });
});
