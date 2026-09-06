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

function generalization(child: string, parent: string): ViewEdge {
    return {
        kind: 'generalization',
        id: `gen:Sample::${child}->Sample::${parent}`,
        source: `Sample::${child}`,
        target: `Sample::${parent}`
    };
}

function drawnWith(names: string[], edges: ViewEdge[], positions: Record<string, { x: number; y: number }>) {
    const view: ViewModel = { groups: [], gensets: [], nodes: names.map(classNode), edges };
    const placed = Object.fromEntries(Object.entries(positions)
        .map(([name, at]) => [`Sample::${name}`, { ...at, width: 120, height: 42 }]));
    return render({ view, positions: placed, display }).svg;
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

    test('gathers specializations of one class into a single tree', () => {
        const svg = drawnWith(['Person', 'Child', 'Adult', 'Elder'],
            [generalization('Child', 'Person'), generalization('Adult', 'Person'), generalization('Elder', 'Person')],
            { Person: { x: 200, y: 0 }, Child: { x: 0, y: 200 }, Adult: { x: 200, y: 200 }, Elder: { x: 400, y: 200 } });
        // One triangle, one bus, a leg each: three separate lines to one class
        // converge, and two of them will run within a few pixels of each other.
        expect(svg.match(/class="tv-edge tv-tree"/g)).toHaveLength(1);
        expect(Object.keys(paths(svg))).toHaveLength(0);
        expect(svg.match(/class="tv-marker"/g)).toHaveLength(1);
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
