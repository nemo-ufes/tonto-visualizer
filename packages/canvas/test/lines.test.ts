import { describe, expect, test } from 'vitest';
import type { ViewEdge, ViewModel } from 'tonto-view';
import { defaultDisplayOptions } from 'tonto-view';
import { render } from '../src/render.js';

const display = { ...defaultDisplayOptions };

function classNode(name: string) {
    return {
        id: `Sample::${name}`, kind: 'class' as const, name, package: 'Sample',
        stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
    };
}

function relation(id: string, source: string, target: string): ViewEdge {
    return {
        kind: 'relation', id, source: `Sample::${source}`, target: `Sample::${target}`,
        sourceEnd: { isConst: true, isAddOnly: false },
        targetEnd: { isConst: true, isAddOnly: false }
    };
}

function generalization(child: string, parent: string, genset?: string): ViewEdge {
    return {
        kind: 'generalization',
        id: `gen:Sample::${child}->Sample::${parent}`,
        source: `Sample::${child}`,
        target: `Sample::${parent}`,
        ...(genset ? { genset } : {})
    };
}

function drawnWith(names: string[], edges: ViewEdge[], positions: Record<string, { x: number; y: number }>) {
    const view: ViewModel = { groups: [], gensets: [], nodes: names.map(classNode), edges };
    const placed = Object.fromEntries(Object.entries(positions)
        .map(([name, at]) => [`Sample::${name}`, { ...at, width: 120, height: 42 }]));
    return render({ view, positions: placed, display }).svg;
}

/** The points of a drawn edge, in order. */
function points(d: string): Array<{ x: number; y: number }> {
    return [...d.matchAll(/[ML] ([-\d.]+) ([-\d.]+)/g)]
        .map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
}

/** The `d` of every drawn edge, by edge id. */
function paths(svg: string): Record<string, string> {
    return Object.fromEntries([...svg.matchAll(/data-edge="([^"]+)"><path d="([^"]+)"/g)]
        .map(match => [match[1]!.replaceAll('&gt;', '>'), match[2]!]));
}

describe('telling one line from another', () => {

    test('gives two relations between the same pair their own place on the border', () => {
        const svg = drawnWith(['Contract', 'Person'],
            [relation('first', 'Contract', 'Person'), relation('second', 'Contract', 'Person')],
            { Contract: { x: 0, y: 0 }, Person: { x: 0, y: 300 } });
        const drawn = paths(svg);
        // Two associations drawn as one line is the worst thing a class diagram
        // can do: the reader counts one relationship where the model has two.
        expect(drawn.first).toBeDefined();
        expect(drawn.second).toBeDefined();
        expect(drawn.first).not.toEqual(drawn.second);
        const first = points(drawn.first!);
        const second = points(drawn.second!);
        expect(first).toHaveLength(3);
        expect(second).toHaveLength(3);
        expect(Math.abs(first[1]!.x - second[1]!.x))
            .toBeGreaterThan(Math.abs(first[0]!.x - second[0]!.x));
    });

    test('keeps those places when a line has to bend round something', () => {
        // A box squarely between the two, so both relations must detour.
        const svg = drawnWith(['Contract', 'Person', 'Between'],
            [relation('first', 'Contract', 'Person'), relation('second', 'Contract', 'Person')],
            { Contract: { x: 0, y: 0 }, Between: { x: 0, y: 150 }, Person: { x: 0, y: 320 } });
        const drawn = paths(svg);
        // A detour that re-aimed at the box centres put both lines back on the
        // same two border points, whatever the ports had said.
        expect(drawn.first).not.toEqual(drawn.second);
    });

    test('draws a class with two relations to itself as two loops', () => {
        const svg = drawnWith(['Thing'],
            [relation('one', 'Thing', 'Thing'), relation('two', 'Thing', 'Thing')],
            { Thing: { x: 100, y: 100 } });
        const drawn = paths(svg);
        expect(drawn.one).not.toEqual(drawn.two);
    });

    test('turns a loop at the corner with the most room around it', () => {
        // `Other` is up and to the right, which is where a loop used to be drawn
        // whatever else was there -- out of the right side and back over the top,
        // straight across the line to `Other`.
        const svg = drawnWith(['Thing', 'Other'],
            [relation('loop', 'Thing', 'Thing'), relation('away', 'Thing', 'Other')],
            { Thing: { x: 200, y: 200 }, Other: { x: 600, y: 0 } });
        const loop = points(paths(svg).loop!);
        expect(loop[0]!.x).toBe(200);
        expect(loop[loop.length - 1]!.y).toBe(242);
    });

    test('leaves a loop where it has always been when nothing else is there', () => {
        const svg = drawnWith(['Thing'], [relation('loop', 'Thing', 'Thing')], { Thing: { x: 200, y: 200 } });
        const loop = points(paths(svg).loop!);
        // Out of the right side and back in over the top: a class on its own is
        // drawn as it was before a loop had a corner to choose.
        expect(loop[0]!.x).toBe(320);
        expect(loop[loop.length - 1]!.y).toBe(200);
    });

    test('nests two loops on one class rather than crossing them', () => {
        const svg = drawnWith(['Thing'],
            [relation('one', 'Thing', 'Thing'), relation('two', 'Thing', 'Thing')],
            { Thing: { x: 200, y: 200 } });
        const [inner, outer] = [points(paths(svg).one!), points(paths(svg).two!)]
            .sort((a, b) => Math.abs(a[1]!.x - a[0]!.x) - Math.abs(b[1]!.x - b[0]!.x));
        // Both ends of each have to sit in the same order out from the corner
        // they turn, or the wider one's return leg crosses the narrower one's.
        expect(Math.abs(outer![2]!.y - 242)).toBeGreaterThan(Math.abs(inner![2]!.y - 242));
        expect(outer![4]!.x).toBeLessThan(inner![4]!.x);
    });

    test('keeps ordinary sibling specializations as independent lines', () => {
        const svg = drawnWith(['Person', 'Child', 'Adult', 'Elder'],
            [generalization('Child', 'Person'), generalization('Adult', 'Person'), generalization('Elder', 'Person')],
            { Person: { x: 200, y: 0 }, Child: { x: 0, y: 200 }, Adult: { x: 200, y: 200 }, Elder: { x: 400, y: 200 } });
        // A shared triangle asserts a generalization set. A common parent alone
        // does not make one, so every declaration remains visible as its own
        // specialization line and marker.
        expect(svg).not.toContain('tv-tree');
        expect(Object.keys(paths(svg))).toHaveLength(3);
        expect(svg.match(/class="tv-marker"/g)).toHaveLength(3);
    });

    test('shares a tree only for an explicit generalization set', () => {
        const genset = 'set:Sample::PersonAges';
        const view: ViewModel = {
            groups: [],
            nodes: ['Person', 'Child', 'Adult'].map(classNode),
            edges: [generalization('Child', 'Person', genset), generalization('Adult', 'Person', genset)],
            gensets: [{
                id: genset,
                name: 'PersonAges',
                disjoint: true,
                complete: true,
                general: 'Sample::Person',
                specifics: ['Sample::Child', 'Sample::Adult'],
                categorizers: []
            }]
        };
        const positions = {
            'Sample::Person': { x: 100, y: 0, width: 120, height: 42 },
            'Sample::Child': { x: 0, y: 200, width: 120, height: 42 },
            'Sample::Adult': { x: 200, y: 200, width: 120, height: 42 }
        };
        const svg = render({ view, positions, display }).svg;

        expect(svg.match(/class="tv-edge tv-tree"/g)).toHaveLength(1);
        expect(svg).toContain(`data-genset="${genset}"`);
        expect(Object.keys(paths(svg))).toHaveLength(0);
        expect(svg.match(/class="tv-marker"/g)).toHaveLength(1);
    });

    test('keeps the tree through a drag that falls a little short of clearing the general', () => {
        // A drag that meant to slide Child sideways and landed 15px shy of
        // clearing Person's own edge should not cost the set its shared
        // triangle -- that is still "below" to whoever dropped it there.
        const genset = 'set:Sample::PersonAges';
        const view: ViewModel = {
            groups: [],
            nodes: ['Person', 'Child', 'Adult'].map(classNode),
            edges: [generalization('Child', 'Person', genset), generalization('Adult', 'Person', genset)],
            gensets: [{
                id: genset, name: 'PersonAges', disjoint: true, complete: true,
                general: 'Sample::Person', specifics: ['Sample::Child', 'Sample::Adult'], categorizers: []
            }]
        };
        const positions = {
            'Sample::Person': { x: 100, y: 0, width: 120, height: 60 },
            'Sample::Child': { x: 0, y: 45, width: 120, height: 42 },
            'Sample::Adult': { x: 200, y: 200, width: 120, height: 42 }
        };
        const svg = render({ view, positions, display }).svg;

        expect(svg.match(/class="tv-edge tv-tree"/g)).toHaveLength(1);
    });

    test('keeps the tree when a drag puts one subtype level with the general', () => {
        // Not a near miss this time -- Child dragged to Person's own row, well
        // past any slack. The set still has a majority on one side (Adult,
        // still below), so the bus still runs there; Child's leg just meets it
        // from whichever edge actually faces the bus instead of the one every
        // other leg happens to use.
        const genset = 'set:Sample::PersonAges';
        const view: ViewModel = {
            groups: [],
            nodes: ['Person', 'Child', 'Adult'].map(classNode),
            edges: [generalization('Child', 'Person', genset), generalization('Adult', 'Person', genset)],
            gensets: [{
                id: genset, name: 'PersonAges', disjoint: true, complete: true,
                general: 'Sample::Person', specifics: ['Sample::Child', 'Sample::Adult'], categorizers: []
            }]
        };
        const positions = {
            'Sample::Person': { x: 100, y: 0, width: 120, height: 60 },
            'Sample::Child': { x: 400, y: 0, width: 120, height: 42 },
            'Sample::Adult': { x: 100, y: 200, width: 120, height: 42 }
        };
        const svg = render({ view, positions, display }).svg;

        expect(svg.match(/class="tv-edge tv-tree"/g)).toHaveLength(1);
        expect(svg).toContain(`data-genset="${genset}"`);
    });

    test('anchors a tree to the side of the general when its subtypes are beside it', () => {
        // Both subtypes to the right this time, one above the general's row and
        // one below it -- a horizontal arrangement, not a vertical one with a
        // sideways outlier. The triangle should point right, off the general's
        // own edge, with a vertical bus between the two rather than a
        // horizontal one squeezed above or below a box neither subtype is near.
        const genset = 'set:Sample::PersonAges';
        const view: ViewModel = {
            groups: [],
            nodes: ['Person', 'Child', 'Adult'].map(classNode),
            edges: [generalization('Child', 'Person', genset), generalization('Adult', 'Person', genset)],
            gensets: [{
                id: genset, name: 'PersonAges', disjoint: true, complete: true,
                general: 'Sample::Person', specifics: ['Sample::Child', 'Sample::Adult'], categorizers: []
            }]
        };
        const positions = {
            'Sample::Person': { x: 0, y: 100, width: 120, height: 60 },
            'Sample::Child': { x: 300, y: 40, width: 120, height: 42 },
            'Sample::Adult': { x: 300, y: 180, width: 120, height: 42 }
        };
        const svg = render({ view, positions, display }).svg;

        expect(svg.match(/class="tv-edge tv-tree"/g)).toHaveLength(1);
        const apex = /class="tv-marker" points="([-\d.]+),([-\d.]+)/.exec(svg);
        expect(apex).not.toBeNull();
        // The apex sits on Person's right edge (x = 120), not above or below it.
        expect(Number(apex![1])).toBeCloseTo(120, 0);
        expect(Number(apex![2])).toBeGreaterThan(100);
        expect(Number(apex![2])).toBeLessThan(160);
    });

    test('keeps every set bus between its triangle and its subtype row', () => {
        // Lane offsets separate several sets owned by the same general. With a
        // shallow rank gap, the outer offsets used to push the first bus back
        // through the triangle and the last beyond the subtype boxes: long
        // stems protruded from both ends of the usual tree shape.
        const sets = Array.from({ length: 4 }, (_, index) => `set:Sample::Set${index}`);
        const view: ViewModel = {
            groups: [],
            nodes: ['Person', 'Child', 'Adult'].map(classNode),
            edges: sets.flatMap((set, index) => [
                {
                    kind: 'generalization' as const, id: `gen:Child:${index}`,
                    source: 'Sample::Child', target: 'Sample::Person', genset: set
                },
                {
                    kind: 'generalization' as const, id: `gen:Adult:${index}`,
                    source: 'Sample::Adult', target: 'Sample::Person', genset: set
                }
            ]),
            gensets: sets.map((id, index) => ({
                id, name: `Set${index}`, disjoint: true, complete: true,
                general: 'Sample::Person', specifics: ['Sample::Child', 'Sample::Adult'], categorizers: []
            }))
        };
        const svg = render({
            view,
            positions: {
                'Sample::Person': { x: 100, y: 0, width: 120, height: 60 },
                'Sample::Child': { x: 40, y: 100, width: 120, height: 42 },
                'Sample::Adult': { x: 160, y: 100, width: 120, height: 42 }
            },
            display
        }).svg;
        const trees = [...svg.matchAll(/<g class="tv-edge tv-tree"[^>]*>([\s\S]*?)<\/g>/g)];
        const buses = trees.map(tree => [...tree[1]!.matchAll(
            /<path d="M ([-\d.]+) ([-\d.]+) L ([-\d.]+) ([-\d.]+)"\/>/g
        )].map(match => match.slice(1).map(Number))
            .find(([, from, , to]) => from === to));

        expect(buses).toHaveLength(4);
        expect(buses.every(bus => bus !== undefined && bus[1]! > 74 && bus[1]! < 100)).toBe(true);
    });

    test('anchors lines to one class in the order they leave in', () => {
        // Three classes on one rank, as a layered layout leaves them, reached
        // from the right side of one class. Every far centre has the same y, so
        // ordering the ends by that y decided nothing and they were ordered by
        // edge id instead -- which here is the wrong way round.
        const svg = drawnWith(['Person', 'Near', 'Middle', 'Far'],
            [relation('a-near', 'Person', 'Near'),
                relation('b-middle', 'Person', 'Middle'),
                relation('c-far', 'Person', 'Far')],
            { Person: { x: 0, y: 0 }, Near: { x: 400, y: 30 }, Middle: { x: 700, y: 30 }, Far: { x: 1000, y: 30 } });
        const at = Object.fromEntries(Object.entries(paths(svg))
            .map(([id, d]) => [id, Number(/^M ?([-\d.]+) ([-\d.]+)/.exec(d)![2])]));
        // The steeper the line, the lower down the side it leaves: a fan, which
        // is the one order in which none of the three crosses another.
        expect(at['a-near']).toBeGreaterThan(at['b-middle']!);
        expect(at['b-middle']).toBeGreaterThan(at['c-far']!);
    });

    test('leaves them as separate arrows when they are not all on one side', () => {
        const svg = drawnWith(['Person', 'Child', 'Adult'],
            [generalization('Child', 'Person'), generalization('Adult', 'Person')],
            { Person: { x: 200, y: 200 }, Child: { x: 0, y: 400 }, Adult: { x: 200, y: 0 } });
        // A tree with legs going two ways says less than two arrows do.
        expect(svg).not.toContain('tv-tree');
        expect(Object.keys(paths(svg))).toHaveLength(2);
    });
});

describe('what a line must not do', () => {

    /** Whether any part of a drawn path runs through a box. */
    function crosses(path: string, box: { x: number; y: number }): boolean {
        const points = [...path.matchAll(/[ML] ([-\d.]+) ([-\d.]+)/g)]
            .map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
        return points.slice(1).some((point, index) => {
            const previous = points[index]!;
            for (let step = 0; step <= 60; step += 1) {
                const x = previous.x + (point.x - previous.x) * step / 60;
                const y = previous.y + (point.y - previous.y) * step / 60;
                if (x > box.x + 2 && x < box.x + 118 && y > box.y + 2 && y < box.y + 40) {
                    return true;
                }
            }
            return false;
        });
    }

    test('goes round a class in the way rather than behind it', () => {
        const svg = drawnWith(['Left', 'Right', 'Wall'],
            [relation('across', 'Left', 'Right')],
            { Left: { x: 0, y: 200 }, Right: { x: 600, y: 200 }, Wall: { x: 300, y: 200 } });
        // A line that disappears behind a class it has nothing to do with is
        // read as ending there.
        expect(crosses(paths(svg).across!, { x: 300, y: 200 })).toBe(false);
    });

    test('takes two bends when one will not clear the way', () => {
        // A wall two classes deep: no single bend gets round both.
        const svg = drawnWith(['Left', 'Right', 'Near', 'Far'],
            [relation('across', 'Left', 'Right')],
            {
                Left: { x: 0, y: 200 }, Right: { x: 700, y: 200 },
                Near: { x: 250, y: 200 }, Far: { x: 250, y: 150 }
            });
        const path = paths(svg).across!;
        expect(crosses(path, { x: 250, y: 200 })).toBe(false);
        expect(crosses(path, { x: 250, y: 150 })).toBe(false);
    });

    test('draws a package box only where it holds nothing but its own', () => {
        const view: ViewModel = {
            groups: [
                { id: 'pkg:A', name: 'A', isExternal: false, nodes: ['Sample::One', 'Sample::Three'] },
                { id: 'pkg:B', name: 'B', isExternal: false, nodes: ['Sample::Two'] }
            ],
            gensets: [],
            nodes: ['One', 'Two', 'Three'].map(classNode),
            edges: []
        };
        // Two lies either side of the box A would be drawn as.
        const positions = {
            'Sample::One': { x: 0, y: 0, width: 120, height: 42 },
            'Sample::Two': { x: 0, y: 100, width: 120, height: 42 },
            'Sample::Three': { x: 0, y: 200, width: 120, height: 42 }
        };
        const svg = render({ view, positions, display }).svg;
        // A box that says a class is in a package it is not in is worse than no
        // box: the reader believes it.
        expect(svg).toContain('>B</text>');
        expect(svg).not.toContain('>A</text>');
    });

    /**
     * A relator is a reified relationship, and the reader follows the two
     * mediations through it as one line. Anchored on their share of the border,
     * both met the middle of a side -- one arriving from the left, the other
     * leaving to the right, which reads as two lines meeting at a box.
     */
    test('anchors a relator\'s mediations so that the line reads through it', () => {
        const mediation = (id: string, source: string, target: string): ViewEdge =>
            ({ ...relation(id, source, target), stereotype: 'mediation' });
        const view: ViewModel = {
            groups: [], gensets: [],
            nodes: [
                classNode('Employee'), classNode('Employer'),
                { ...classNode('Employment'), stereotype: 'relator', color: '#99FF99' }
            ],
            edges: [
                mediation('toEmployee', 'Employment', 'Employee'),
                mediation('toEmployer', 'Employment', 'Employer')
            ]
        };
        // The three on one diagonal, the relator squarely between the other two.
        const positions = {
            'Sample::Employee': { x: 0, y: 0, width: 120, height: 42 },
            'Sample::Employment': { x: 300, y: 200, width: 120, height: 42 },
            'Sample::Employer': { x: 600, y: 400, width: 120, height: 42 }
        };
        const drawn = paths(render({ view, positions, display }).svg);
        const at = (path: string, end: 'first' | 'last') => {
            const points = [...path.matchAll(/[ML] ([-\d.]+) ([-\d.]+)/g)]
                .map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
            return (end === 'first' ? points[0] : points[points.length - 1])!;
        };
        // Each mediation is written from the relator, so its path starts there.
        const into = at(drawn.toEmployee!, 'first');
        const outOf = at(drawn.toEmployer!, 'first');
        expect(into.y).toBe(200);
        expect(outOf.y).toBe(242);
        // Aimed through the box: the end towards the class up and to the left
        // sits left of the end towards the class down and to the right, and the
        // two are far enough apart to be seen as one line crossing the box.
        expect(outOf.x - into.x).toBeGreaterThan(30);
    });
});
