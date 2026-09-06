import { describe, expect, test } from 'vitest';
import type { ViewModel } from 'tonto-view';
import { defaultDisplayOptions } from 'tonto-view';
import { placeNewNodes } from '../src/place.js';
import { segmentHitsRect } from '../src/geometry.js';
import { render } from '../src/render.js';
import { routeEdge } from '../src/route.js';
import { multiplicityLabel, sizeOf } from '../src/measure.js';

const display = { ...defaultDisplayOptions };

/** A relator mediating a role, with one end const and one not. */
function related(): ViewModel {
    return {
        groups: [],
        nodes: ['Contract', 'Employee'].map(name => ({
            id: `Sample::${name}`, kind: 'class' as const, name, package: 'Sample',
            stereotype: name === 'Contract' ? 'relator' : 'role', color: '#99FF99',
            isExternal: false, attributes: []
        })),
        edges: [{
            kind: 'relation' as const,
            id: 'rel:Sample::Contract->Sample::Employee:mediation:binds',
            source: 'Sample::Contract',
            target: 'Sample::Employee',
            stereotype: 'mediation',
            name: 'binds',
            sourceEnd: { cardinality: '1..*', role: 'contracts', isConst: false, isAddOnly: false },
            targetEnd: { cardinality: '1', role: 'employee', isConst: true, isAddOnly: false }
        }],
        gensets: []
    };
}

function drawn(view: ViewModel, options = display) {
    const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, options)]));
    return render({ view, positions: placeNewNodes(view, sizes, {}), display: options });
}

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

    test('remeasures a saved card when what it displays changes', () => {
        const view = model();
        const person = view.nodes[0]!;
        const compact = sizeOf(person, { ...display, showAttributes: false });
        const expanded = sizeOf(person, display);
        const positions = placeNewNodes(view, { [person.id]: expanded }, {
            [person.id]: { x: 100, y: 100, ...compact }
        });
        expect(positions[person.id]).toEqual({ x: 100, y: 100, ...expanded });
    });

    test('uses a guaranteed free fallback when the local placement search is full', () => {
        const clazz = (id: string) => ({
            id, kind: 'class' as const, name: id, package: 'Sample', stereotype: 'kind',
            color: '#FF99A3', isExternal: false, attributes: []
        });
        const view: ViewModel = {
            groups: [],
            nodes: [clazz('Blocker'), clazz('Anchor'), clazz('New')],
            edges: [{ kind: 'relation', id: 'new-anchor', source: 'New', target: 'Anchor' }],
            gensets: []
        };
        const positions = placeNewNodes(view, {
            Blocker: { width: 5000, height: 5000 },
            Anchor: { width: 100, height: 60 },
            New: { width: 100, height: 60 }
        }, {
            Blocker: { x: -2000, y: -2000 },
            Anchor: { x: 0, y: 0 }
        });

        expect(positions.New!.y).toBeGreaterThanOrEqual(3040);
        expect(positions.New!.y).toBeGreaterThan(positions.Blocker!.y + positions.Blocker!.height);
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

    test('takes an orthogonal route around an intervening card', () => {
        const source = { x: 0, y: 0, width: 100, height: 60 };
        const between = { x: 250, y: 0, width: 100, height: 60 };
        const target = { x: 500, y: 0, width: 100, height: 60 };
        const points = routeEdge(source, target, {
            style: 'orthogonal',
            ends: { source: { x: 100, y: 30 }, target: { x: 500, y: 30 } },
            obstacles: [source, between, target]
        });
        expect(points.some(point => point.y < between.y || point.y > between.y + between.height)).toBe(true);
        for (let index = 0; index + 1 < points.length; index += 1) {
            expect(points[index]!.x === points[index + 1]!.x || points[index]!.y === points[index + 1]!.y).toBe(true);
            expect(segmentHitsRect(points[index]!, points[index + 1]!, between, 4)).toBe(false);
        }
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

    test('says which way a named association reads', () => {
        const svg = drawn(related()).svg;
        // UML's solid triangle beside the name: "Contract binds Employee", not
        // the other way round.
        expect(svg).toContain('class="tv-reading"');
        expect(svg).toContain('binds');
    });

    test('sets a relation stereotype over its name, and smaller', () => {
        const view = related();
        const positions = {
            'Sample::Contract': { x: 0, y: 0, width: 120, height: 42 },
            'Sample::Employee': { x: 400, y: 0, width: 120, height: 42 }
        };
        const svg = render({ view, positions, display }).svg;
        const stereotype = svg.match(/<text class="tv-edge-stereotype"[^>]*? x="([-\d.]+)" y="([-\d.]+)"[^>]*>«mediation»/);
        const name = svg.match(/<text[^>]*? x="([-\d.]+)" y="([-\d.]+)"[^>]*>binds</);
        expect(stereotype).not.toBeNull();
        expect(name).not.toBeNull();
        // Two lines, the stereotype above: they are not the same kind of thing,
        // and "«mediation» binds" run together reads as one four-word phrase.
        expect(Number(stereotype![2])).toBeLessThan(Number(name![2]));
        expect(Math.abs(Number(stereotype![1]) - Number(name![1]))).toBeLessThan(30);
        // And smaller, so a line of the model does not begin with
        // «characterization» set as large as everything else.
        const style = svg.match(/<style>([\s\S]*?)<\/style>/)![1]!;
        expect(style).toContain('.tv-edge-stereotype { font-size: 9.5px');
    });

    test('puts the reading triangle just after the name it belongs to', () => {
        const view = related();
        const positions = {
            'Sample::Contract': { x: 0, y: 0, width: 120, height: 42 },
            'Sample::Employee': { x: 400, y: 0, width: 120, height: 42 }
        };
        const svg = render({ view, positions, display }).svg;
        const name = svg.match(/<text[^>]*? x="([-\d.]+)" y="([-\d.]+)"[^>]*>binds</)!;
        const triangle = svg.match(/<polygon class="tv-reading" points="([-\d.]+),([-\d.]+)/)!;
        const gap = Number(triangle[1]) - Number(name[1]);
        // Beyond the name's own half-width, and not out in the middle of nowhere.
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThan(40);
    });

    test('leaves the reading triangle off a relation with no name', () => {
        const view = related();
        const edge = view.edges[0]!;
        if (edge.kind === 'relation') {
            delete edge.name;
        }
        expect(drawn(view).svg).not.toContain('class="tv-reading"');
    });

    test('writes no const, and marks the end that is not const instead', () => {
        const svg = drawn(related()).svg;
        // An end that cannot change is the ordinary case, so it carries no
        // decoration; the exception gets an open padlock. One end here is const
        // and one is not, so there is exactly one padlock.
        expect(svg).not.toContain('{const}');
        expect(svg.match(/class="tv-lock"/g)).toHaveLength(1);
        expect(svg).toContain('not const');
    });

    test('keeps the multiplicity and the role name apart', () => {
        const svg = drawn(related()).svg;
        const labels = [...svg.matchAll(/<text class="tv-end"[^>]*? x="([-\d.]+)" y="([-\d.]+)"/g)]
            .map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
        // Multiplicity on one side of the line, role name on the other: run
        // together they read as one phrase, and on a busy diagram there is no
        // telling which half belongs to which end. Three here -- both ends of
        // this relation are named, and one of them has a multiplicity to show.
        expect(labels).toHaveLength(3);
        expect(new Set(labels.map(one => `${one.x},${one.y}`)).size).toEqual(3);
    });

    test('writes a multiplicity the way a diagram does', () => {
        // Brackets are the textual syntax, where a multiplicity has to be told
        // apart from what surrounds it. On a line it stands alone.
        expect(multiplicityLabel('2..*')).toBe('2..*');
        expect(multiplicityLabel('*')).toBe('*');
        expect(multiplicityLabel('0..1')).toBe('0..1');
        // `1` is what an end means when it says nothing.
        expect(multiplicityLabel('1')).toBeUndefined();
        expect(multiplicityLabel('1..1')).toBeUndefined();
        // A range with one value in it is that value; `0..*` is `*`.
        expect(multiplicityLabel('3..3')).toBe('3');
        expect(multiplicityLabel('0..*')).toBe('*');
        expect(multiplicityLabel(undefined)).toBeUndefined();
    });

    test('leaves the default multiplicity off the line entirely', () => {
        const svg = drawn(related()).svg;
        expect(svg).toContain('>1..*<');
        expect(svg).not.toContain('[1..*]');
        // The target end is exactly one, which is what the line already says.
        expect(svg).not.toMatch(/>\[?1\]?</);
    });

    test('drops the decorations, the padlock included, when they are turned off', () => {
        const svg = drawn(related(), { ...display, showEndDecorations: false }).svg;
        expect(svg).not.toContain('class="tv-lock"');
    });

    /**
     * The label layer sits above the boxes and outside every other group, so a
     * rule that reached labels through their edge stopped reaching them the day
     * they were lifted out of it -- and a text element with no font-family falls
     * back to a 16px serif. Every association label was set in Times for two
     * commits, in an SVG whose stated font was Helvetica.
     */
    test('sets the font on every text there is, not on the groups that hold them', () => {
        const style = drawn(related()).svg.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? '';
        expect(style).toMatch(/(^|\n)text \{[^}]*font-family: "Helvetica Neue"/);
        expect(style).toMatch(/(^|\n)text \{[^}]*font-size: 11px/);
        // Nothing may scope the font to a group a label is not inside.
        expect(style).not.toContain('.tv-edge text {');
        expect(style).not.toContain('.tv-labels text {');
    });

    test('keeps a multiplicity, a role name and a padlock together at one end', () => {
        const view = related();
        // Placed by hand so the geometry is not the layout's opinion: two boxes
        // side by side, joined by a horizontal line at y = 21.
        const positions = {
            'Sample::Contract': { x: 0, y: 0, width: 120, height: 42 },
            'Sample::Employee': { x: 400, y: 0, width: 120, height: 42 }
        };
        const svg = render({ view, positions, display }).svg;
        const texts = [...svg.matchAll(/<text class="tv-end"[^>]*? x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)</g)]
            .map(match => ({ x: Number(match[1]), y: Number(match[2]), text: match[3] }));
        const multiplicity = texts.find(one => one.text === '1..*');
        const role = texts.find(one => one.text === 'contracts');
        const lock = svg.match(/tv-lock"[^>]*?transform="translate\(([-\d.]+), ([-\d.]+)\)/);
        expect(multiplicity).toBeDefined();
        expect(role).toBeDefined();
        expect(lock).not.toBeNull();

        // Opposite sides of the line, which is what the sides are for.
        expect(Math.sign(multiplicity!.y - 21)).not.toEqual(Math.sign(role!.y - 21));
        // The same distance along it, so they read as one group at one end.
        expect(Math.abs(multiplicity!.x - role!.x)).toBeLessThan(60);
        // And the padlock follows the name, where a property string goes.
        expect(Number(lock![1])).toBeGreaterThan(role!.x);
    });

    test('sizes the drawing around its labels, not only around its boxes', () => {
        const view = related();
        const edge = view.edges[0]!;
        if (edge.kind === 'relation') {
            edge.name = 'is the contract of employment that binds';
        }
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const svg = render({ view, positions: placeNewNodes(view, sizes, {}), display }).svg;
        const box = svg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)!.map(Number);
        // A label that could not find room near its line ends up some way from
        // it, and a drawing sized to the boxes alone cropped it -- a relation's
        // name half off the left edge, in an export nobody could correct.
        for (const [, x, y] of svg.matchAll(/<text[^>]*? x="([-\d.]+)" y="([-\d.]+)"/g)) {
            expect(Number(x)).toBeGreaterThan(box[1]!);
            expect(Number(x)).toBeLessThan(box[1]! + box[3]!);
            expect(Number(y)).toBeGreaterThan(box[2]!);
            expect(Number(y)).toBeLessThan(box[2]! + box[4]!);
        }
    });

    test('sizes the drawing around self-relation loops', () => {
        const node = model().nodes[0]!;
        const view: ViewModel = {
            groups: [],
            nodes: [node],
            edges: Array.from({ length: 4 }, (_, index) => ({
                kind: 'relation' as const,
                id: `loop-${index}`,
                source: node.id,
                target: node.id,
                sourceEnd: { isConst: true, isAddOnly: false },
                targetEnd: { isConst: true, isAddOnly: false }
            })),
            gensets: []
        };
        const rendered = render({
            view,
            positions: { [node.id]: { x: 0, y: 0, width: 120, height: 42 } },
            display,
            padding: 40
        });
        const points = Object.values(rendered.paths).flat();
        expect(Math.min(...points.map(point => point.y))).toBeGreaterThanOrEqual(rendered.bounds.y);
        expect(Math.max(...points.map(point => point.x)))
            .toBeLessThanOrEqual(rendered.bounds.x + rendered.bounds.width);
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
