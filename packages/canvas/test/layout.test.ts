import { describe, expect, test } from 'vitest';
import type { ViewModel } from 'tonto-view';
import { defaultDisplayOptions, defaultLayoutOptions } from 'tonto-view';
import { autoLayout } from '../src/autolayout.js';
import type { Point, Rect } from '../src/geometry.js';
import { overlaps } from '../src/geometry.js';
import { sizeOf } from '../src/measure.js';

const display = { ...defaultDisplayOptions };

function onBorder(point: Point | undefined, rect: Rect): boolean {
    if (!point) {
        return false;
    }
    const tolerance = 1;
    const inside = point.x >= rect.x - tolerance && point.x <= rect.x + rect.width + tolerance
        && point.y >= rect.y - tolerance && point.y <= rect.y + rect.height + tolerance;
    const atEdge = Math.abs(point.x - rect.x) <= tolerance
        || Math.abs(point.x - (rect.x + rect.width)) <= tolerance
        || Math.abs(point.y - rect.y) <= tolerance
        || Math.abs(point.y - (rect.y + rect.height)) <= tolerance;
    return inside && atEdge;
}

/** A supertype with `count` subtypes, in one package. */
function taxonomy(count: number): ViewModel {
    const names = ['Root', ...Array.from({ length: count }, (_, index) => `Sub${index}`)];
    return {
        groups: [{ id: 'pkg:Sample', name: 'Sample', isExternal: false, nodes: names.map(name => `Sample::${name}`) }],
        nodes: names.map(name => ({
            id: `Sample::${name}`, kind: 'class' as const, name, package: 'Sample',
            stereotype: name === 'Root' ? 'kind' : 'subkind', color: '#FF99A3', isExternal: false, attributes: []
        })),
        edges: names.slice(1).map(name => ({
            kind: 'generalization' as const,
            id: `gen:Sample::${name}->Sample::Root`,
            source: `Sample::${name}`,
            target: 'Sample::Root'
        })),
        gensets: []
    };
}

async function arrange(view: ViewModel, grouped: boolean) {
    const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
    const laid = await autoLayout(view, sizes, {}, { ...defaultLayoutOptions, grouped });
    return laid.positions;
}

describe('arranging a model', () => {

    test('puts a supertype above its subtypes', async () => {
        const view = taxonomy(3);
        const positions = await arrange(view, false);
        const root = positions['Sample::Root']!;
        for (const node of view.nodes.filter(candidate => candidate.id !== 'Sample::Root')) {
            expect(positions[node.id]!.y).toBeGreaterThan(root.y);
        }
    });

    test('lays out an inverse pair as the one association that is drawn', async () => {
        const one = taxonomy(1);
        const extra = {
            id: 'Sample::Extra', kind: 'class' as const, name: 'Extra', package: 'Sample',
            stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
        };
        one.nodes.push(extra);
        one.groups[0]!.nodes.push(extra.id);
        one.edges.push({
            kind: 'relation', id: 'relation-a', source: 'Sample::Sub0', target: extra.id,
            sourceEnd: { isConst: false, isAddOnly: false },
            targetEnd: { isConst: false, isAddOnly: false },
            inverseOf: 'relation-b'
        });
        const two = structuredClone(one);
        two.edges.push({
            kind: 'relation', id: 'relation-b', source: extra.id, target: 'Sample::Sub0',
            sourceEnd: { isConst: false, isAddOnly: false },
            targetEnd: { isConst: false, isAddOnly: false },
            inverseOf: 'relation-a'
        });

        expect(await arrange(two, false)).toEqual(await arrange(one, false));
    });

    /**
     * ELK lays a compound node out on its own and does not inherit what the
     * graph around it was told, so the spacings have to be repeated on every
     * package. Set only at the root, a grouped diagram ran at ELK's 20px
     * default: ranks close enough to touch, with no room between them for the
     * labels that belong there.
     */
    test('leaves the same room between ranks whether or not packages are boxed', async () => {
        const view = taxonomy(3);
        const flat = await arrange(view, false);
        const grouped = await arrange(view, true);
        const gapOf = (positions: Record<string, { y: number; height: number }>) => {
            const root = positions['Sample::Root']!;
            return Math.min(...view.nodes
                .filter(node => node.id !== 'Sample::Root')
                .map(node => positions[node.id]!.y - (root.y + root.height)));
        };
        expect(gapOf(grouped)).toBeGreaterThanOrEqual(defaultLayoutOptions.rankSpacing - 1);
        expect(Math.abs(gapOf(grouped) - gapOf(flat))).toBeLessThan(20);
    });

    test('keeps routes only for the drawing that has any', async () => {
        const view = taxonomy(2);
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const straight = await autoLayout(view, sizes, {}, { ...defaultLayoutOptions, routing: 'straight' });
        const square = await autoLayout(view, sizes, {}, { ...defaultLayoutOptions, routing: 'orthogonal' });
        // A straight line is recomputed from the two boxes every time one moves,
        // so a stored route would only go stale; an orthogonal one is worth keeping.
        expect(Object.keys(straight.routes)).toHaveLength(0);
        expect(Object.keys(square.routes).length).toBeGreaterThan(0);
    });

    test('places nothing on top of anything else', async () => {
        const positions = Object.values(await arrange(taxonomy(6), true));
        for (let i = 0; i < positions.length; i += 1) {
            for (let j = i + 1; j < positions.length; j += 1) {
                const a = positions[i]!;
                const b = positions[j]!;
                const overlapping = a.x < b.x + b.width && b.x < a.x + a.width
                    && a.y < b.y + b.height && b.y < a.y + a.height;
                expect(overlapping).toBe(false);
            }
        }
    });
});

describe('packages and the layout', () => {

    /** Two packages, each a chain, with one class of A specializing one of B. */
    function twoPackages(): ViewModel {
        const names = [['A', 'One'], ['A', 'Two'], ['B', 'Three'], ['B', 'Four']] as const;
        return {
            groups: [
                { id: 'pkg:A', name: 'A', isExternal: false, nodes: ['A::One', 'A::Two'] },
                { id: 'pkg:B', name: 'B', isExternal: false, nodes: ['B::Three', 'B::Four'] }
            ],
            nodes: names.map(([pkg, name]) => ({
                id: `${pkg}::${name}`, kind: 'class' as const, name, package: pkg,
                stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
            })),
            edges: [
                { kind: 'generalization', id: 'g1', source: 'A::Two', target: 'B::Three' },
                { kind: 'generalization', id: 'g2', source: 'B::Four', target: 'A::One' }
            ],
            gensets: []
        };
    }

    test('lays a model out as one graph when the packages are ignored', async () => {
        const view = twoPackages();
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const together = await autoLayout(view, sizes, {}, { ...defaultLayoutOptions, groupByPackage: true });
        const loose = await autoLayout(view, sizes, {}, { ...defaultLayoutOptions, groupByPackage: false });

        for (const laid of [together, loose]) {
            expect(Object.keys(laid.positions)).toHaveLength(4);
        }
        // Kept together, a package's classes occupy one band; ignored, they
        // interleave -- which is the whole point of the option, and why the
        // package boxes stop being drawn when they would enclose a stranger.
        const bandOf = (positions: Record<string, { y: number }>, pkg: string) =>
            view.nodes.filter(node => node.package === pkg).map(node => positions[node.id]!.y);
        const overlapping = (one: number[], other: number[]) =>
            Math.min(...one) < Math.max(...other) && Math.min(...other) < Math.max(...one);
        expect(overlapping(bandOf(together.positions, 'A'), bandOf(together.positions, 'B'))).toBe(false);
        expect(overlapping(bandOf(loose.positions, 'A'), bandOf(loose.positions, 'B'))).toBe(true);
    });

    /**
     * A relator is a reified relationship, and a reader looks for it between the
     * classes it relates. Both mediations are written inside the relator, so a
     * layered algorithm would rank it above the pair like a supertype; the
     * layout turns one of them round for the ranking and then settles the
     * relator towards the middle.
     */
    test('seats a relator between the classes it mediates', async () => {
        const clazz = (name: string, stereotype: string) => ({
            id: `Sample::${name}`, kind: 'class' as const, name, package: 'Sample',
            stereotype, color: '#FF99A3', isExternal: false, attributes: []
        });
        const view: ViewModel = {
            groups: [{
                id: 'pkg:Sample', name: 'Sample', isExternal: false,
                nodes: ['Sample::Person', 'Sample::Organization', 'Sample::Employment']
            }],
            nodes: [clazz('Person', 'kind'), clazz('Organization', 'kind'), clazz('Employment', 'relator')],
            edges: [
                {
                    kind: 'relation', id: 'r1', stereotype: 'mediation',
                    source: 'Sample::Employment', target: 'Sample::Person'
                },
                {
                    kind: 'relation', id: 'r2', stereotype: 'mediation',
                    source: 'Sample::Employment', target: 'Sample::Organization'
                }
            ],
            gensets: []
        };

        const positions = await arrange(view, true);
        const middle = (id: string) => {
            const rect = positions[id]!;
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        };
        const relator = middle('Sample::Employment');
        const relata = [middle('Sample::Person'), middle('Sample::Organization')];
        const within = (value: number, one: number, other: number) =>
            value >= Math.min(one, other) - 24 && value <= Math.max(one, other) + 24;
        expect(within(relator.x, relata[0]!.x, relata[1]!.x)).toBe(true);
        expect(within(relator.y, relata[0]!.y, relata[1]!.y)).toBe(true);
    });

    test('does not settle an unselected relator during a partial layout', async () => {
        const clazz = (name: string, stereotype: string) => ({
            id: `Sample::${name}`, kind: 'class' as const, name, package: 'Sample',
            stereotype, color: '#FF99A3', isExternal: false, attributes: []
        });
        const view: ViewModel = {
            groups: [],
            nodes: [clazz('Left', 'kind'), clazz('Right', 'kind'), clazz('Relation', 'relator')],
            edges: [
                { kind: 'relation', id: 'left', stereotype: 'mediation', source: 'Sample::Relation', target: 'Sample::Left' },
                { kind: 'relation', id: 'right', stereotype: 'mediation', source: 'Sample::Relation', target: 'Sample::Right' }
            ],
            gensets: []
        };
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const positions = {
            'Sample::Left': { x: 0, y: 0, ...sizes['Sample::Left']! },
            'Sample::Right': { x: 0, y: 500, ...sizes['Sample::Right']! },
            'Sample::Relation': { x: 1000, y: 250, ...sizes['Sample::Relation']! }
        };
        const laid = await autoLayout(view, sizes, positions, {
            ...defaultLayoutOptions,
            only: ['Sample::Left']
        });
        expect(laid.positions['Sample::Relation']).toEqual(positions['Sample::Relation']);
    });

    test('keeps a partial layout beside, rather than over, unselected nodes', async () => {
        const clazz = (id: string) => ({
            id, kind: 'class' as const, name: id, package: 'Sample', stereotype: 'kind',
            color: '#FF99A3', isExternal: false, attributes: []
        });
        const view: ViewModel = { groups: [], nodes: [clazz('A'), clazz('B')], edges: [], gensets: [] };
        const sizes = { A: { width: 100, height: 60 }, B: { width: 100, height: 60 } };
        const learned = await autoLayout(view, sizes, {}, {
            ...defaultLayoutOptions, groupByPackage: false, only: ['A']
        });
        const current = {
            A: { x: 500, y: 500, ...sizes.A },
            B: { ...learned.positions.A! }
        };
        const laid = await autoLayout(view, sizes, current, {
            ...defaultLayoutOptions, groupByPackage: false, only: ['A']
        });

        expect(laid.positions.B).toEqual(current.B);
        expect(overlaps(laid.positions.A!, laid.positions.B!)).toBe(false);
    });

    test('returns orthogonal routes attached source to target after settling relators', async () => {
        const clazz = (id: string, stereotype = 'kind') => ({
            id, kind: 'class' as const, name: id, package: 'Sample', stereotype,
            color: '#FF99A3', isExternal: false, attributes: []
        });
        const relata = Array.from({ length: 3 }, (_, index) => `A${index}`);
        const extras = Array.from({ length: 3 }, (_, index) => `X${index}`);
        const nodes = [clazz('R', 'relator'), ...relata.map(id => clazz(id)), ...extras.map(id => clazz(id))];
        const edges: ViewModel['edges'] = [];
        for (let index = 0; index < 3; index += 1) {
            edges.push({
                kind: 'relation', id: `m${index}`, stereotype: 'mediation', source: 'R', target: `A${index}`
            });
            edges.push({
                kind: 'relation', id: `x${index}`, stereotype: 'association', source: `A${index}`, target: `X${index}`
            });
            if (index > 0) {
                edges.push({ kind: 'generalization', id: `g${index}`, source: `X${index}`, target: 'X0' });
            }
        }
        const view: ViewModel = { groups: [], nodes, edges, gensets: [] };
        const sizes = Object.fromEntries(nodes.map(node => [node.id, {
            width: 100 + (node.id.charCodeAt(0) % 3) * 20,
            height: 60
        }]));
        const laid = await autoLayout(view, sizes, {}, {
            ...defaultLayoutOptions, groupByPackage: false, routing: 'orthogonal'
        });

        for (const edge of edges) {
            const route = laid.routes[edge.id];
            if (!route) {
                continue;
            }
            expect(onBorder(route[0], laid.positions[edge.source]!)).toBe(true);
            expect(onBorder(route.at(-1), laid.positions[edge.target]!)).toBe(true);
        }
    });
});
