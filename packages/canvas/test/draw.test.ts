import { describe, expect, test } from 'vitest';
import type { ViewModel, ViewRelationEnd } from 'tonto-view';
import { defaultDisplayOptions } from 'tonto-view';
import { placeNewNodes } from '../src/place.js';
import { distanceToPath, segmentHitsRect } from '../src/geometry.js';
import { handlesFor } from '../src/handles.js';
import { labelWidth, render } from '../src/render.js';
import { curvedRoute, pathData, roundedRoute, routeEdge } from '../src/route.js';
import { FONT, multiplicityLabel, sizeOf, textWidth, wrappedAttributeLines } from '../src/measure.js';

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

/**
 * `Man.hasChild inverseOf Person.hasFather`: one association stated twice, as
 * `boats.tonto` states it. The half with the smaller id keeps the line.
 */
function inversePair(): ViewModel {
    const ends = {
        man: { cardinality: '1', role: 'father', isConst: true, isAddOnly: false },
        person: { cardinality: '*', role: 'children', isConst: false, isAddOnly: true }
    };
    return {
        groups: [],
        nodes: ['Man', 'Person'].map(name => ({
            id: `Sample::${name}`, kind: 'class' as const, name, package: 'Sample',
            stereotype: name === 'Man' ? 'subkind' : 'kind', color: '#FF99A3',
            isExternal: false, attributes: []
        })),
        edges: [
            {
                kind: 'relation' as const,
                id: 'rel:Sample::Man->Sample::Person::hasChild',
                source: 'Sample::Man',
                target: 'Sample::Person',
                name: 'hasChild',
                sourceEnd: { ...ends.man },
                // Only this half names the role, so only this half can lose it.
                targetEnd: { ...ends.person },
                inverseOf: 'rel:Sample::Person->Sample::Man:historicalDependence:hasFather'
            },
            {
                kind: 'relation' as const,
                id: 'rel:Sample::Person->Sample::Man:historicalDependence:hasFather',
                source: 'Sample::Person',
                target: 'Sample::Man',
                stereotype: 'historicalDependence',
                name: 'hasFather',
                sourceEnd: { cardinality: '*', isConst: false, isAddOnly: true },
                targetEnd: { cardinality: '1', isConst: true, isAddOnly: false },
                inverseOf: 'rel:Sample::Man->Sample::Person::hasChild'
            }
        ],
        gensets: []
    };
}

/** The pair drawn between two boxes a fixed distance apart. */
function drawnPair(view = inversePair()) {
    return render({
        view,
        positions: {
            'Sample::Man': { x: 0, y: 0, width: 140, height: 42 },
            'Sample::Person': { x: 460, y: 0, width: 140, height: 42 }
        },
        display
    });
}

/**
 * Every label in a drawing, with the box the renderer's own metrics give it.
 *
 * Enough to answer the one question that matters about a label: is it on the
 * drawing, or behind a class where nobody will ever see it?
 */
function labelBoxes(svg: string): Array<{ text: string; box: Rect }> {
    const layer = /<g class="tv-labels">([\s\S]*?)<\/svg>/.exec(svg)?.[1] ?? '';
    return [...layer.matchAll(/<text([^>]*)>([^<]*)<\/text>/g)].flatMap(match => {
        const attributes = match[1]!;
        const text = match[2]!;
        const x = Number(/ x="([-\d.]+)"/.exec(attributes)?.[1]);
        const y = Number(/ y="([-\d.]+)"/.exec(attributes)?.[1]);
        if (!text.trim() || !isFinite(x) || !isFinite(y)) {
            return [];
        }
        const size = /tv-edge-stereotype/.test(attributes) ? FONT.edgeStereotype : FONT.edge;
        const width = textWidth(text, size) + 6;
        const anchor = /text-anchor="(\w+)"/.exec(attributes)?.[1] ?? 'start';
        const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width : x;
        return [{ text, box: { x: left, y: y - size, width, height: size + 4 } }];
    });
}

/** The largest share of a label that any one of the given classes covers. */
function hiddenShare(box: Rect, cards: Rect[]): number {
    const area = Math.max(1, box.width * box.height);
    return Math.max(0, ...cards.map(card => {
        const wide = Math.max(0, Math.min(box.x + box.width, card.x + card.width) - Math.max(box.x, card.x));
        const tall = Math.max(0, Math.min(box.y + box.height, card.y + card.height) - Math.max(box.y, card.y));
        return (wide * tall) / area;
    }));
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

    test('keeps direct associations and generalizations straight in curved mode', () => {
        const relation = related();
        const relationId = relation.edges[0]!.id;
        const curved = render({
            view: relation,
            positions: {
                'Sample::Contract': { x: 0, y: 0, width: 120, height: 42 },
                'Sample::Employee': { x: 320, y: 180, width: 120, height: 42 }
            },
            display: { ...display, routing: 'curved' }
        });
        const generalization = render({
            view: model(),
            positions: {
                'Sample::Person': { x: 0, y: 0, width: 120, height: 60 },
                'Sample::Employee': { x: 260, y: 180, width: 120, height: 42 }
            },
            display: { ...display, routing: 'curved' },
            direction: 'DOWN'
        });

        expect(curved.svg.match(/<g class="tv-edge[^"]*" data-edge="[^"]+"><path d="([^"]+)"/)?.[1])
            .not.toContain(' C ');
        expect(curved.paths[relationId]).toEqual(curved.guides[relationId]);
        expect(generalization.svg.match(/data-edge="[^"]+"><path d="([^"]+)"/)?.[1]).not.toContain(' C ');
    });

    test('curves a manually guided association without turning samples into handles', () => {
        const view = related();
        const edge = view.edges[0]!;
        const guide = [{ x: 120, y: 21 }, { x: 220, y: 80 }, { x: 320, y: 201 }];
        const output = render({
            view,
            positions: {
                'Sample::Contract': { x: 0, y: 0, width: 120, height: 42 },
                'Sample::Employee': { x: 320, y: 180, width: 120, height: 42 }
            },
            routes: { [edge.id]: { points: guide } },
            display: { ...display, routing: 'curved' }
        });

        expect(output.guides[edge.id]).toEqual(guide);
        expect(output.paths[edge.id]!.length).toBeGreaterThan(guide.length);
        expect(handlesFor(output.guides[edge.id]!)).toHaveLength(3);
        const data = output.svg.match(/<g class="tv-edge[^"]*" data-edge="[^"]+"><path d="([^"]+)"/)?.[1];
        expect(data).toContain(' C ');
        // The Graphviz fitter spans an ordinary bend with one relaxed cubic;
        // interpolation used to force two cubics through the guide midpoint.
        expect(data?.match(/ C /g)).toHaveLength(1);
    });

    test('curves a one-corner ordinary generalization', () => {
        const view = model();
        const edge = view.edges[0]!;
        const guide = [{ x: 60, y: 180 }, { x: 180, y: 100 }, { x: 300, y: 30 }];
        const output = render({
            view,
            positions: {
                'Sample::Person': { x: 300, y: 0, width: 120, height: 60 },
                'Sample::Employee': { x: 0, y: 180, width: 120, height: 42 }
            },
            routes: { [edge.id]: { points: guide } },
            display: { ...display, routing: 'curved' },
            direction: 'DOWN'
        });

        const data = output.svg.match(/data-edge="[^"]+"><path d="([^"]+)"/)?.[1];
        expect(data).toContain(' C ');
        expect(output.paths[edge.id]!.length).toBeGreaterThan(guide.length);
    });

    test('keeps a card the modeller made roomier, and still grows it for content', () => {
        const view = model();
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const natural = sizes['Sample::Employee']!;
        const placed = placeNewNodes(view, sizes, {
            'Sample::Employee': { x: 0, y: 0, width: natural.width + 200, height: natural.height + 100 }
        });
        // A size in the file is the least the card may be, not the size it is.
        expect(placed['Sample::Employee']!.width).toBe(natural.width + 200);
        expect(placed['Sample::Employee']!.height).toBe(natural.height + 100);

        // ... so an attribute added afterwards still grows it rather than
        // spilling out of a box that was pinned to what it used to contain.
        const narrow = placeNewNodes(view, sizes, { 'Sample::Employee': { x: 0, y: 0, width: 10, height: 10 } });
        expect(narrow['Sample::Employee']!.width).toBe(natural.width);
        expect(narrow['Sample::Employee']!.height).toBe(natural.height);
    });

    test('sizes a card to what it has to hold', () => {
        const [person, employee] = model().nodes;
        expect(sizeOf(person!, display).height).toBeGreaterThan(sizeOf(employee!, display).height);
        expect(sizeOf(employee!, display).width).toBe(108);
    });

    test('measures and renders the selected portable font preset', () => {
        const person = model().nodes[0]!;
        const small = { ...display, fontFamily: 'sans' as const, fontSize: 'small' as const };
        const largeMono = { ...display, fontFamily: 'monospace' as const, fontSize: 'large' as const };
        const smallSize = sizeOf(person, small);
        const largeSize = sizeOf(person, largeMono);
        const svg = render({
            view: model(),
            positions: placeNewNodes(model(), Object.fromEntries(
                model().nodes.map(node => [node.id, sizeOf(node, largeMono)])
            ), {}),
            display: largeMono
        }).svg;

        expect(largeSize.width).toBeGreaterThan(smallSize.width);
        expect(largeSize.height).toBeGreaterThan(smallSize.height);
        expect(svg).toContain('font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace');
        expect(svg).toContain('font-size: 12.65px');
    });

    test('offers a condensed font that reduces every measured text role', () => {
        const person = { ...model().nodes[0]!, name: 'CharacterizationRelationship' };
        const regular = { ...display, fontFamily: 'sans' as const };
        const condensed = { ...display, fontFamily: 'condensed' as const };
        const regularSize = sizeOf(person, regular);
        const condensedSize = sizeOf(person, condensed);
        const svg = render({
            view: model(),
            positions: placeNewNodes(model(), Object.fromEntries(
                model().nodes.map(node => [node.id, sizeOf(node, condensed)])
            ), {}),
            display: condensed
        }).svg;

        expect(condensedSize.width).toBeLessThan(regularSize.width);
        expect(sizeOf(model().nodes[1]!, condensed).width).toBe(72);
        expect(textWidth('«characterization»', FONT.edge, false, 'condensed'))
            .toBeLessThan(textWidth('«characterization»', FONT.edge, false, 'sans'));
        expect(svg).toContain('font-stretch: condensed');
        expect(svg).toContain('"Avenir Next Condensed", "Arial Narrow"');
    });

    test('wraps a long attribute instead of making a short-named class wide', () => {
        const condensed = { ...display, fontFamily: 'condensed' as const };
        const pet = {
            ...model().nodes[0]!,
            name: 'Pet',
            attributes: [{
                name: 'birthDate', type: 'date', stereotypes: ['begin'], cardinality: '0..1',
                isOrdered: false, isConst: true, isAddOnly: false, isDerived: false
            }]
        };
        const rows = wrappedAttributeLines(pet, condensed);
        const size = sizeOf(pet, condensed);

        expect(rows).toEqual(['@begin birthDate: const', 'date [0..1]']);
        expect(size.width).toBeLessThan(170);
        expect(size.height).toBe(84);
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

    test('does not curve a direct guide', () => {
        const source = { x: 0, y: 0, width: 100, height: 60 };
        const target = { x: 300, y: 200, width: 100, height: 60 };
        const guide = routeEdge(source, target);
        const curve = curvedRoute(guide, source, target, [source, target]);

        expect(guide).toHaveLength(2);
        expect(curve.data).toBe(pathData(guide));
        expect(curve.points).toEqual(guide);
    });

    test('can round a necessary corner locally', () => {
        const source = { x: -100, y: -100, width: 10, height: 10 };
        const target = { x: 100, y: 100, width: 10, height: 10 };
        const guide = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }];
        const curve = roundedRoute(guide, source, target);

        expect(curve.data).toContain(' C ');
        expect(curve.points.length).toBeGreaterThan(guide.length);
        expect(curve.points[0]).toEqual(guide[0]);
        expect(curve.points.at(-1)).toEqual(guide.at(-1));
    });

    test('retreats a curve towards its guide rather than cutting through a card', () => {
        const source = { x: 0, y: 0, width: 100, height: 60 };
        const between = { x: 250, y: 0, width: 100, height: 60 };
        const target = { x: 500, y: 0, width: 100, height: 60 };
        const guide = routeEdge(source, target, { obstacles: [source, between, target] });
        const curve = curvedRoute(guide, source, target, [source, between, target]);

        expect(guide.length).toBeGreaterThan(2);
        expect(curve.data).toContain(' C ');
        expect(curve.points.slice(1).every((point, index) =>
            !segmentHitsRect(curve.points[index]!, point, between, 4))).toBe(true);
    });

    test('serializes an editable guide as a polyline', () => {
        expect(pathData([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('M 1 2 L 3 4');
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

    test('routes a self-loop around an unrelated card at its preferred corner', () => {
        const source = { x: 200, y: 200, width: 120, height: 42 };
        const obstacle = { x: 300, y: 150, width: 120, height: 42 };
        const points = routeEdge(source, source, {
            ends: { source: { x: 320, y: 221 }, target: { x: 260, y: 200 } },
            obstacles: [source, obstacle]
        });
        for (let index = 0; index + 1 < points.length; index += 1) {
            expect(segmentHitsRect(points[index]!, points[index + 1]!, obstacle, 4)).toBe(false);
        }
    });

    test('does not infer a self-loop from two overlapping rectangles', () => {
        const source = { x: 20, y: 30, width: 120, height: 42 };
        const target = { x: 20, y: 30, width: 120, height: 80 };
        const points = routeEdge(source, target);
        expect(points).toHaveLength(2);
        expect(points.every(point => point.x >= source.x && point.x <= source.x + source.width)).toBe(true);
    });

    test('fans repeated associations apart with a real bend', () => {
        const source = { x: 0, y: 0, width: 100, height: 60 };
        const target = { x: 300, y: 0, width: 100, height: 60 };
        const first = routeEdge(source, target, { spread: { index: 0, count: 2 } });
        const second = routeEdge(source, target, { spread: { index: 1, count: 2 } });
        // Distinct border points alone leave parallel rails through the middle,
        // where the reader has to associate each line with its labels.
        expect(first).toHaveLength(3);
        expect(second).toHaveLength(3);
        expect(first[0]!.y).not.toEqual(second[0]!.y);
        expect(Math.abs(first[0]!.y - second[0]!.y)).toBeGreaterThan(8);
        expect(Math.abs(first[1]!.y - second[1]!.y))
            .toBeGreaterThan(Math.abs(first[0]!.y - second[0]!.y));
        expect(curvedRoute(first, source, target).data).toContain(' C ');
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

    test('draws names and inheritance only in a taxonomy-only view', () => {
        const view = model();
        view.edges.push({
            kind: 'relation', id: 'employment', source: 'Sample::Employee', target: 'Sample::Person',
            name: 'worksFor', stereotype: 'material',
            sourceEnd: { role: 'employee', isConst: true, isAddOnly: false },
            targetEnd: { role: 'employer', isConst: true, isAddOnly: false }
        });
        const output = drawn(view, { ...display, taxonomyOnly: true });

        expect(Object.keys(output.paths)).toEqual(['gen:Sample::Employee->Sample::Person']);
        expect(output.svg).not.toContain('data-edge="employment"');
        expect(output.svg).not.toContain('name: string');
        expect(output.svg).toContain('>Person<');
        expect(output.svg).toContain('>Employee<');
    });

    test('measures how much room an edge wants by its longest label', () => {
        // Labels are placed widest first, since each takes the best place left
        // and the one with the least choice of where to go should not be the
        // one left over. What decides the order is the longest thing the edge
        // has to write anywhere on itself.
        const between = (id: string, name?: string, end?: ViewRelationEnd) => ({
            kind: 'relation' as const, id, source: 'Sample::Person', target: 'Sample::Employee',
            ...(name ? { name } : {}),
            sourceEnd: end ?? { isConst: true, isAddOnly: false },
            targetEnd: { isConst: true, isAddOnly: false }
        });
        const bare = between('a');
        const named = between('b', 'employs');
        const decorated = between('c', undefined,
            { role: 'coordinators', isConst: true, isAddOnly: true, redefines: 'Organization.staff' });

        expect(labelWidth(bare, display)).toBe(0);
        expect(labelWidth(named, display)).toBeGreaterThan(0);
        // A role name with two property strings after it needs a stretch of
        // clear space; a name on its own needs far less.
        expect(labelWidth(decorated, display)).toBeGreaterThan(labelWidth(named, display));
        // And what is not drawn asks for nothing.
        expect(labelWidth(decorated, { ...display, showRoleNames: false, showEndDecorations: false }))
            .toBe(0);
        expect(labelWidth(named, { ...display, showRelationNames: false })).toBe(0);
        // A generalization writes nothing along itself at all.
        expect(labelWidth({
            kind: 'generalization', id: 'gen:Sample::Employee->Sample::Person',
            source: 'Sample::Employee', target: 'Sample::Person'
        }, display)).toBe(0);
    });

    test('never leaves a label where a class hides it', () => {
        // A relation whose line runs the length of another class: the whole
        // neighbourhood of each end is inside something, which is where the
        // group of multiplicity and role name used to give up and print itself
        // over a class name.
        const view = related();
        const edge = view.edges[0]!;
        if (edge.kind === 'relation') {
            edge.sourceEnd = { cardinality: '*', role: 'contracts', isConst: false, isAddOnly: false };
            edge.targetEnd = { cardinality: '1..*', role: 'employee', isConst: false, isAddOnly: false };
        }
        view.nodes.push({
            id: 'Sample::Between', kind: 'class', name: 'Between', package: 'Sample',
            stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
        });
        const positions = {
            'Sample::Contract': { x: 0, y: 0, width: 150, height: 42 },
            'Sample::Employee': { x: 640, y: 0, width: 150, height: 42 },
            // Straddling the line between them, so both ends are hemmed in.
            'Sample::Between': { x: 170, y: 24, width: 440, height: 90 }
        };
        const output = render({ view, positions, display });
        const cards = Object.values(positions);
        for (const { text, box } of labelBoxes(output.svg)) {
            // Wholly behind a class is not a worse place for a label, it is no
            // place at all: the reader has no way to know it was ever there.
            expect({ text, hidden: hiddenShare(box, cards) > 0.6 }).toEqual({ text, hidden: false });
        }
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

    test('draws an inverse pair as one line', () => {
        const output = drawnPair();
        // Two relations, one association: two lines between the same pair of
        // classes saying the same thing in opposite directions is a reader
        // counting two relationships where the model has one.
        expect(Object.keys(output.paths)).toEqual(['rel:Sample::Man->Sample::Person::hasChild']);
        expect(output.svg.match(/data-edge=/g)).toHaveLength(1);
        expect(output.svg).not.toContain('data-edge="rel:Sample::Person-&gt;Sample::Man');
    });

    test('selects the combined line through either inverse id', () => {
        const view = inversePair();
        const covered = view.edges[1]!.id;
        const rendered = render({
            view,
            positions: {
                'Sample::Man': { x: 0, y: 0, width: 140, height: 42 },
                'Sample::Person': { x: 460, y: 0, width: 140, height: 42 }
            },
            display,
            selection: [covered]
        });
        expect(rendered.svg).toMatch(/<g class="tv-edge tv-selected"/);
    });

    test('writes both readings of an inverse pair on that line', () => {
        const svg = drawnPair().svg;
        expect(svg).toContain('>hasChild<');
        expect(svg).toContain('>hasFather<');
        // One triangle each: the line carries two sentences, and neither is
        // readable without knowing which way round it goes.
        expect(svg.match(/class="tv-reading"/g)).toHaveLength(2);
    });

    test('points the two readings of an inverse pair opposite ways', () => {
        const svg = drawnPair().svg;
        const triangles = [...svg.matchAll(/<polygon class="tv-reading" points="([-\d.]+),([-\d.]+) ([-\d.]+),/g)]
            .map(match => Number(match[3]) - Number(match[1]));
        // The line runs left to right, so the half written that way points
        // right and its inverse points back along it.
        expect(triangles).toHaveLength(2);
        expect(Math.min(...triangles)).toBeLessThan(0);
        expect(Math.max(...triangles)).toBeGreaterThan(0);
    });

    test('keeps a stereotype over the name it belongs to, on both readings', () => {
        const svg = drawnPair().svg;
        const stereotype = svg.match(/<text class="tv-edge-stereotype"[^>]*? y="([-\d.]+)"[^>]*>«historicalDependence»/);
        const name = svg.match(/<text[^>]*? y="([-\d.]+)"[^>]*>hasFather</);
        expect(stereotype).not.toBeNull();
        // Its own name, not the other half's: a material relation is regularly
        // the inverse of a mediation, and one stereotype over both would say
        // the line is something the model does not say it is.
        expect(Number(stereotype![1])).toBeLessThan(Number(name![1]));
        expect(svg.match(/«historicalDependence»/g)).toHaveLength(1);
    });

    test('writes a shared stereotype once', () => {
        const view = inversePair();
        for (const edge of view.edges) {
            if (edge.kind === 'relation') {
                edge.stereotype = 'material';
            }
        }
        expect(drawnPair(view).svg.match(/«material»/g)).toHaveLength(1);
    });

    test('keeps what only the covered half of an inverse pair says', () => {
        // `hasChild` names the ends; `hasFather` leaves them unnamed. Whichever
        // of the two keeps the line, the role names are on the picture.
        expect(drawnPair().svg).toContain('children');
        expect(drawnPair().svg).toContain('father');
    });

    test('draws both lines when only one half claims the other', () => {
        const view = inversePair();
        const [child] = view.edges;
        if (child?.kind === 'relation') {
            delete child.inverseOf;
        }
        // A pair that does not agree is a model the validator rejects, and
        // drawing fewer lines than there are relations would hide it.
        expect(Object.keys(drawnPair(view).paths)).toHaveLength(2);
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

    /**
     * A generalization set names the bar it is drawn as, so that is where it
     * has to be written. It used to be put beside the stem, which on a parent
     * that has a subtype of its own outside the set is on top of that subtype's
     * line: `PersonAgePhases {disjoint, complete}` printed itself across the
     * generalization to `Employee`, a class the set does not hold, and a reader
     * has nothing but position to tell them otherwise.
     */
    test('writes a generalization set on its own bar, not across a neighbour\'s line', () => {
        const set = 'set:Sample::PersonAgePhases';
        const clazz = (name: string, stereotype: string) => ({
            id: `Sample::${name}`, kind: 'class' as const, name, package: 'Sample',
            stereotype, color: '#FF99A3', isExternal: false, attributes: []
        });
        const specialization = (name: string, genset?: string) => ({
            kind: 'generalization' as const,
            id: `gen:Sample::${name}->Sample::Person`,
            source: `Sample::${name}`,
            target: 'Sample::Person',
            ...(genset ? { genset } : {})
        });
        const view: ViewModel = {
            groups: [],
            nodes: [
                clazz('Person', 'kind'), clazz('Child', 'phase'),
                clazz('Adult', 'phase'), clazz('Employee', 'role')
            ],
            edges: [
                specialization('Child', set), specialization('Adult', set), specialization('Employee')
            ],
            gensets: [{
                id: set, name: 'PersonAgePhases', disjoint: true, complete: true,
                general: 'Sample::Person', specifics: ['Sample::Child', 'Sample::Adult'], categorizers: []
            }]
        };
        // As `parties` is arranged: the set's two phases to the left, and the
        // role that is not in the set to the right of them.
        const positions = {
            'Sample::Person': { x: 253, y: 525, width: 208, height: 84 },
            'Sample::Adult': { x: 117, y: 709, width: 120, height: 42 },
            'Sample::Child': { x: 297, y: 709, width: 120, height: 42 },
            'Sample::Employee': { x: 477, y: 709, width: 120, height: 42 }
        };
        const output = render({ view, positions, display });

        const tree = /<g class="tv-edge tv-tree"[^>]*>([\s\S]*?)<\/g>/.exec(output.svg)?.[1] ?? '';
        const segments = [...tree.matchAll(/<path d="M ([-\d.]+) ([-\d.]+) L ([-\d.]+) ([-\d.]+)"\/>/g)]
            .map(match => match.slice(1).map(Number) as [number, number, number, number]);
        const horizontal = segments.find(([, y1, , y2]) => y1 === y2);
        expect(horizontal).toBeDefined();
        const bar = [
            { x: horizontal![0], y: horizontal![1] },
            { x: horizontal![2], y: horizontal![3] }
        ];
        const written = /<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>PersonAgePhases[^<]*<\/text>/.exec(tree);
        expect(written).not.toBeNull();
        const at = { x: Number(written![1]), y: Number(written![2]) };

        // Over the bar, and nearer it than the line to the class the set does
        // not hold -- which is what the reader takes a label from.
        expect(at.x).toBeGreaterThanOrEqual(Math.min(bar[0]!.x, bar[1]!.x));
        expect(at.x).toBeLessThanOrEqual(Math.max(bar[0]!.x, bar[1]!.x));
        expect(distanceToPath(at, bar))
            .toBeLessThan(distanceToPath(at, output.paths['gen:Sample::Employee->Sample::Person']!));
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
