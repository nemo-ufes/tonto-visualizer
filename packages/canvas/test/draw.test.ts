import { describe, expect, test } from 'vitest';
import type { ViewModel } from 'tonto-view';
import { defaultDisplayOptions } from 'tonto-view';
import { placeNewNodes } from '../src/place.js';
import { render } from '../src/render.js';
import { routeEdge } from '../src/route.js';
import { sizeOf } from '../src/measure.js';

const display = { ...defaultDisplayOptions };

function model(): ViewModel {
    return {
        groups: [{ id: 'pkg:Sample', name: 'Sample', isExternal: false, nodes: ['Sample::Person', 'Sample::Employee'] }],
        nodes: [
            {
                id: 'Sample::Person', kind: 'class', name: 'Person', package: 'Sample', stereotype: 'kind',
                color: '#FF99A3', isExternal: false,
                attributes: [{ name: 'name', type: 'string', stereotypes: [], isOrdered: false, isConst: false, isAddOnly: false, isDerived: false }]
            },
            {
                id: 'Sample::Employee', kind: 'class', name: 'Employee', package: 'Sample', stereotype: 'role',
                color: '#FFDADD', isExternal: false, attributes: []
            }
        ],
        edges: [{ kind: 'generalization', id: 'gen:Sample::Employee->Sample::Person', source: 'Sample::Employee', target: 'Sample::Person' }],
        gensets: []
    };
}

describe('drawing', () => {

    test('sizes a card to what it has to hold', () => {
        const [person, employee] = model().nodes;
        expect(sizeOf(person!, display).height).toBeGreaterThan(sizeOf(employee!, display).height);
        expect(sizeOf(employee!, display).width).toBeGreaterThanOrEqual(120);
    });

    test('leaves placed elements where they are and finds room for the rest', () => {
        const view = model();
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const positions = placeNewNodes(view, sizes, { 'Sample::Person': { x: 100, y: 100 } });
        expect(positions['Sample::Person']).toMatchObject({ x: 100, y: 100 });
        const employee = positions['Sample::Employee']!;
        expect(employee).toBeDefined();
        // Placed next to what it specializes, and not on top of it.
        expect(employee.y).toBeGreaterThan(100);
        expect(employee.x).toBeGreaterThan(-200);
    });

    test('draws a line straight from border to border, by default', () => {
        const points = routeEdge(
            { x: 0, y: 0, width: 100, height: 60 },
            { x: 300, y: 200, width: 100, height: 60 }
        );
        // Two points, no corner between them: a right angle is a choice now,
        // not what every edge gets. Each sits on the border of its own box.
        expect(points).toHaveLength(2);
        expect(points[0]).toEqual({ x: 95, y: 60 });
        expect(points[1]).toEqual({ x: 305, y: 200 });
    });

    test('takes right angles when asked to', () => {
        const points = routeEdge(
            { x: 0, y: 0, width: 100, height: 60 },
            { x: 0, y: 200, width: 100, height: 60 },
            { style: 'orthogonal' }
        );
        expect(points).toEqual([{ x: 50, y: 60 }, { x: 50, y: 200 }]);
    });

    test('runs parallel edges beside one another', () => {
        const source = { x: 0, y: 0, width: 100, height: 60 };
        const target = { x: 300, y: 0, width: 100, height: 60 };
        const first = routeEdge(source, target, { spread: { index: 0, count: 2 } });
        const second = routeEdge(source, target, { spread: { index: 1, count: 2 } });
        // Two relations between the same pair are one line drawn twice unless
        // something moves them apart.
        expect(first[0]!.y).not.toEqual(second[0]!.y);
        expect(Math.abs(first[0]!.y - second[0]!.y)).toBeGreaterThan(8);
    });

    test('goes round a box that stands between the two it joins', () => {
        const source = { x: 0, y: 0, width: 100, height: 60 };
        const target = { x: 600, y: 0, width: 100, height: 60 };
        const between = { x: 280, y: 0, width: 100, height: 60 };
        const straightThrough = routeEdge(source, target);
        expect(straightThrough).toHaveLength(2);

        const around = routeEdge(source, target, { obstacles: [source, target, between] });
        expect(around.length).toBeGreaterThan(2);
        // Clear of the box it was told about, above or below it.
        expect(around.some(point => point.y < between.y || point.y > between.y + between.height)).toBe(true);
    });

    test('obeys a route that was drawn by hand', () => {
        const stored = [{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }];
        expect(routeEdge(
            { x: 0, y: 0, width: 10, height: 10 },
            { x: 90, y: 90, width: 10, height: 10 },
            { stored }
        )).toEqual(stored);
    });

    test('draws every element once, with the ids the canvas selects by', () => {
        const view = model();
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const drawn = render({ view, positions: placeNewNodes(view, sizes, {}), display });
        expect(drawn.svg.match(/data-node="/g)).toHaveLength(2);
        expect(drawn.svg).toContain('data-edge="gen:Sample::Employee-&gt;Sample::Person"');
        expect(drawn.svg).toContain('«kind»');
        expect(drawn.svg).toContain('name: string');
        expect(Object.keys(drawn.paths)).toEqual(['gen:Sample::Employee->Sample::Person']);
    });

    test('goes monochrome when colours are turned off', () => {
        const view = model();
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const drawn = render({
            view, positions: placeNewNodes(view, sizes, {}), display: { ...display, showColors: false }
        });
        expect(drawn.svg).not.toContain('#FF99A3');
    });
});
