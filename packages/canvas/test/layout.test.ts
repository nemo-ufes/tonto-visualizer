import { describe, expect, test } from 'vitest';
import type { ViewModel } from 'tonto-view';
import { defaultDisplayOptions, defaultLayoutOptions } from 'tonto-view';
import { applyLayoutConstraints, autoLayout } from '../src/autolayout.js';
import type { Point, Rect } from '../src/geometry.js';
import { boundsOf, overlaps } from '../src/geometry.js';
import { sizeOf } from '../src/measure.js';
import { render } from '../src/render.js';

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
    // `groupByPackage` is the name the option has. It was passed as `grouped`,
    // which `LayoutOptions` has no such field for, so every test that asked for
    // one arrangement or the other had been getting the default both times.
    const laid = await autoLayout(view, sizes, {}, { ...defaultLayoutOptions, groupByPackage: grouped });
    return laid.positions;
}

describe('arranging a model', () => {
    test('packs disconnected components towards a canvas-shaped drawing', async () => {
        // Asked to handle a hierarchy that is not there, ELK stops packing the
        // components that are not joined to each other. A package only needs to
        // be a compound node when another package must be kept apart from it;
        // its box can be drawn around the resulting flat arrangement either way.
        const view = taxonomy(0);
        for (let index = 0; index < 12; index += 1) {
            view.nodes.push({
                id: `Sample::Alone${index}`, kind: 'class', name: `Alone${index}`, package: 'Sample',
                stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
            });
        }
        const placed = await arrange(view, true);
        expect(placed).toEqual(await arrange(view, false));
        const rects = Object.values(placed);
        const width = Math.max(...rects.map(one => one.x + one.width)) - Math.min(...rects.map(one => one.x));
        const height = Math.max(...rects.map(one => one.y + one.height)) - Math.min(...rects.map(one => one.y));
        expect(width / height).toBeGreaterThan(1);
        expect(width / height).toBeLessThan(2);
        for (const [index, rect] of rects.entries()) {
            expect(rects.slice(index + 1).some(other => overlaps(rect, other))).toBe(false);
        }
    });

    test('searches component order when differently shaped components leave a shelf hole', async () => {
        const view = taxonomy(0);
        view.nodes.push(
            {
                id: 'Sample::Wide', kind: 'class', name: 'Wide', package: 'Sample',
                stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
            },
            {
                id: 'Sample::Short', kind: 'class', name: 'Short', package: 'Sample',
                stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
            }
        );
        view.groups[0]!.nodes.push('Sample::Wide', 'Sample::Short');
        const sizes = {
            'Sample::Root': { width: 400, height: 260 },
            'Sample::Wide': { width: 550, height: 190 },
            'Sample::Short': { width: 300, height: 180 }
        };

        const { positions } = await autoLayout(view, sizes, {}, {
            ...defaultLayoutOptions, groupByPackage: false
        });
        const rects = Object.values(positions);
        const width = Math.max(...rects.map(one => one.x + one.width)) - Math.min(...rects.map(one => one.x));
        const height = Math.max(...rects.map(one => one.y + one.height)) - Math.min(...rects.map(one => one.y));

        // The short component belongs beside the tall one. A fixed tall-first
        // order puts the wide component between them and scores over 550.
        expect(Math.max(width / 1.6, height)).toBeLessThan(525);
        for (const [index, rect] of rects.entries()) {
            expect(rects.slice(index + 1).some(other => overlaps(rect, other))).toBe(false);
        }
    });

    test('stacks small components in the gap beside a tall component', async () => {
        const view = taxonomy(0);
        for (const name of ['SmallA', 'SmallB', 'SmallC']) {
            view.nodes.push({
                id: `Sample::${name}`, kind: 'class', name, package: 'Sample',
                stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
            });
            view.groups[0]!.nodes.push(`Sample::${name}`);
        }
        const sizes = {
            'Sample::Root': { width: 500, height: 600 },
            'Sample::SmallA': { width: 220, height: 150 },
            'Sample::SmallB': { width: 220, height: 150 },
            'Sample::SmallC': { width: 220, height: 150 }
        };

        const { positions } = await autoLayout(view, sizes, {}, {
            ...defaultLayoutOptions, groupByPackage: false
        });
        const bounds = boundsOf(Object.values(positions));

        // Shelf packing reserves the tall card's full 600px for its row and
        // pushes the third small card below it. Gap packing makes one compact
        // column of the three beside the tall component.
        expect(bounds.width).toBeLessThanOrEqual(780);
        expect(bounds.height).toBeLessThanOrEqual(600);
        for (const [index, rect] of Object.values(positions).entries()) {
            expect(Object.values(positions).slice(index + 1).some(other => overlaps(rect, other))).toBe(false);
        }
    });

    test('puts a supertype above its subtypes', async () => {
        const view = taxonomy(3);
        const positions = await arrange(view, false);
        const root = positions['Sample::Root']!;
        for (const node of view.nodes.filter(candidate => candidate.id !== 'Sample::Root')) {
            expect(positions[node.id]!.y).toBeGreaterThan(root.y);
        }
    });

    test('does not let an association change the taxonomy rank spacing', async () => {
        const baseline = await arrange(taxonomy(1), false);
        const view = taxonomy(1);
        view.nodes.push({
            id: 'Sample::Neighbour', kind: 'class', name: 'Neighbour', package: 'Sample',
            stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
        });
        view.groups[0]!.nodes.push('Sample::Neighbour');
        view.edges.push({
            kind: 'relation', id: 'associated', source: 'Sample::Sub0', target: 'Sample::Neighbour',
            sourceEnd: { isConst: false, isAddOnly: false },
            targetEnd: { isConst: false, isAddOnly: false }
        });

        const positions = await arrange(view, false);
        const distance = (placed: typeof positions) => placed['Sample::Sub0']!.y - placed['Sample::Root']!.y;
        expect(distance(positions)).toBe(distance(baseline));
        expect(distance(positions)).toBeGreaterThan(0);
    });

    test('does not let hidden associations influence taxonomy-only layout', async () => {
        const view = taxonomy(2);
        view.nodes.push({
            id: 'Sample::Neighbour', kind: 'class', name: 'Neighbour', package: 'Sample',
            stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
        });
        view.groups[0]!.nodes.push('Sample::Neighbour');
        view.edges.push({
            kind: 'relation', id: 'associated', source: 'Sample::Sub0', target: 'Sample::Neighbour',
            sourceEnd: { isConst: true, isAddOnly: false },
            targetEnd: { isConst: true, isAddOnly: false }
        });
        const display = { ...defaultDisplayOptions, taxonomyOnly: true };
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const request = { ...defaultLayoutOptions, groupByPackage: false, taxonomyOnly: true };
        const laid = await autoLayout(view, sizes, {}, request);
        const taxonomyView = { ...view, edges: view.edges.filter(edge => edge.kind === 'generalization') };
        const expected = await autoLayout(taxonomyView, sizes, {}, request);

        expect(laid.positions).toEqual(expected.positions);
        expect(laid.routes).toEqual(expected.routes);
        const taxonomyBottom = Math.max(
            laid.positions['Sample::Root']!.y + laid.positions['Sample::Root']!.height,
            laid.positions['Sample::Sub0']!.y + laid.positions['Sample::Sub0']!.height,
            laid.positions['Sample::Sub1']!.y + laid.positions['Sample::Sub1']!.height
        );
        // A classifier connected only by a hidden association belongs in the
        // compact appendix, not above the hierarchy as if it were another root.
        expect(laid.positions['Sample::Neighbour']!.y)
            .toBeGreaterThanOrEqual(taxonomyBottom + defaultLayoutOptions.rankSpacing);
    });

    test('wraps a broad taxonomy rank deterministically by stable id', async () => {
        const view = taxonomy(8);
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const request = { ...defaultLayoutOptions, groupByPackage: false, maxRankSpan: 360 };
        const first = await autoLayout(view, sizes, {}, request);
        const second = await autoLayout(view, sizes, {}, request);
        const children = view.nodes.slice(1).map(node => first.positions[node.id]!);
        const rows = new Map<number, Rect[]>();
        for (const rect of children) {
            rows.set(rect.y, [...(rows.get(rect.y) ?? []), rect]);
        }

        expect(first.positions).toEqual(second.positions);
        expect(rows.size).toBeGreaterThan(1);
        for (const row of rows.values()) {
            expect(boundsOf(row).width).toBeLessThanOrEqual(360);
        }
        const root = first.positions['Sample::Root']!;
        expect(Math.min(...children.map(rect => rect.y)))
            .toBeGreaterThanOrEqual(root.y + root.height + defaultLayoutOptions.rankSpacing);
    });

    test('centres a generalization when an association joins the same classes', async () => {
        const clazz = (id: string, stereotype: string) => ({
            id, kind: 'class' as const, name: id.replace('Sample::', ''), package: 'Sample',
            stereotype, color: '#FF99A3', isExternal: false, attributes: []
        });
        const plainEnd = { isConst: false, isAddOnly: false };
        const view: ViewModel = {
            groups: [{
                id: 'pkg:Sample', name: 'Sample', isExternal: false,
                nodes: ['Sample::Object', 'Sample::PhysicalObject', 'Sample::ComplexPhysicalObject']
            }],
            nodes: [
                clazz('Sample::Object', 'class'),
                clazz('Sample::PhysicalObject', 'category'),
                clazz('Sample::ComplexPhysicalObject', 'mixin')
            ],
            edges: [
                {
                    kind: 'generalization', id: 'physical-object',
                    source: 'Sample::PhysicalObject', target: 'Sample::Object'
                },
                {
                    kind: 'generalization', id: 'complex-physical',
                    source: 'Sample::ComplexPhysicalObject', target: 'Sample::PhysicalObject'
                },
                {
                    kind: 'relation', id: 'has-part', stereotype: 'componenthood',
                    source: 'Sample::ComplexPhysicalObject', target: 'Sample::PhysicalObject',
                    sourceEnd: { ...plainEnd }, targetEnd: { ...plainEnd }
                }
            ],
            gensets: []
        };
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const laid = await autoLayout(view, sizes, {}, {
            ...defaultLayoutOptions, groupByPackage: false, routing: 'orthogonal'
        });
        const output = render({
            view,
            positions: laid.positions,
            routes: Object.fromEntries(Object.entries(laid.routes).map(([id, points]) => [id, { points }])),
            display: { ...display, routing: 'orthogonal' }
        });
        const centres = view.nodes.map(node => {
            const rect = laid.positions[node.id]!;
            return rect.x + rect.width / 2;
        });
        expect([...new Set(centres)]).toHaveLength(1);
        expect([...new Set(output.paths['complex-physical']!.map(point => point.x))]).toHaveLength(1);
    });

    /**
     * A datatype nothing points at has no rank of its own to take, so ELK is
     * free to seat it wherever a rank has room -- which in `parties` was the
     * corridor between a relator and the class it mediates. The mediation was
     * then drawn round it, changing direction for a class it has nothing to do
     * with. Attributes are written inside the card, so this is the ordinary
     * case for a datatype rather than a corner of one.
     */
    test('puts a datatype nothing points at after the model rather than into it', async () => {
        const view = taxonomy(2);
        view.nodes.push({
            id: 'Sample::Address', kind: 'datatype', name: 'Address', package: 'Sample',
            stereotype: 'datatype', color: '#FFFFFF', isExternal: false,
            attributes: [{
                name: 'street', type: 'string', stereotypes: [],
                isOrdered: false, isConst: false, isAddOnly: false, isDerived: false
            }]
        });
        view.groups[0]!.nodes.push('Sample::Address');

        const positions = await arrange(view, true);
        const classes = view.nodes.filter(node => node.kind === 'class');
        const lowest = Math.max(...classes.map(node => positions[node.id]!.y));
        expect(positions['Sample::Address']!.y).toBeGreaterThanOrEqual(lowest);
    });

    /** A datatype something does point at is drawn where it is pointed at from. */
    test('leaves a datatype that is joined to something in its rank', async () => {
        const view = taxonomy(1);
        view.nodes.push({
            id: 'Sample::Sub0Sub', kind: 'class', name: 'Sub0Sub', package: 'Sample',
            stereotype: 'subkind', color: '#FF99A3', isExternal: false, attributes: []
        }, {
            id: 'Sample::Address', kind: 'datatype', name: 'Address', package: 'Sample',
            stereotype: 'datatype', color: '#FFFFFF', isExternal: false, attributes: []
        });
        view.groups[0]!.nodes.push('Sample::Sub0Sub', 'Sample::Address');
        view.edges.push({
            kind: 'generalization', id: 'gen:Sample::Sub0Sub->Sample::Sub0',
            source: 'Sample::Sub0Sub', target: 'Sample::Sub0'
        }, {
            kind: 'relation', id: 'rel:Sample::Root->Sample::Address::',
            source: 'Sample::Root', target: 'Sample::Address',
            sourceEnd: { isConst: false, isAddOnly: false },
            targetEnd: { isConst: false, isAddOnly: false }
        });

        const positions = await arrange(view, true);
        expect(positions['Sample::Address']!.y).toBeLessThan(positions['Sample::Sub0Sub']!.y);
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

    test('uses hard package bands only when package containers are requested', async () => {
        const view = twoPackages();
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const contained = await autoLayout(view, sizes, {}, {
            ...defaultLayoutOptions, groupByPackage: true, packageContainers: true
        });
        const together = await autoLayout(view, sizes, {}, { ...defaultLayoutOptions, groupByPackage: true });
        const loose = await autoLayout(view, sizes, {}, { ...defaultLayoutOptions, groupByPackage: false });

        for (const laid of [contained, together, loose]) {
            expect(Object.keys(laid.positions)).toHaveLength(4);
        }
        // A box requires one exclusive band. Soft clustering can interleave
        // packages where the taxonomy needs it, just as disabling the
        // preference can; its penalty is considered only after crossings.
        const bandOf = (positions: Record<string, { x: number }>, pkg: string) =>
            view.nodes.filter(node => node.package === pkg).map(node => positions[node.id]!.x);
        const overlapping = (one: number[], other: number[]) =>
            Math.min(...one) < Math.max(...other) && Math.min(...other) < Math.max(...one);
        expect(overlapping(bandOf(contained.positions, 'A'), bandOf(contained.positions, 'B'))).toBe(false);
        expect(overlapping(bandOf(together.positions, 'A'), bandOf(together.positions, 'B'))).toBe(true);
        expect(overlapping(bandOf(loose.positions, 'A'), bandOf(loose.positions, 'B'))).toBe(true);
    });

    test('keeps taxonomy ranks across hard package containers', async () => {
        const clazz = (id: string) => ({
            id, kind: 'class' as const, name: id.split('::')[1]!, package: id.split('::')[0]!,
            stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
        });
        const view: ViewModel = {
            groups: [
                { id: 'pkg:A', name: 'A', isExternal: false, nodes: ['A::Root', 'A::Child'] },
                { id: 'pkg:B', name: 'B', isExternal: false, nodes: ['B::Middle'] }
            ],
            nodes: [clazz('A::Root'), clazz('B::Middle'), clazz('A::Child')],
            edges: [
                { kind: 'generalization', id: 'upper', source: 'B::Middle', target: 'A::Root' },
                { kind: 'generalization', id: 'lower', source: 'A::Child', target: 'B::Middle' }
            ],
            gensets: []
        };
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const laid = await autoLayout(view, sizes, {}, {
            ...defaultLayoutOptions, groupByPackage: true, packageContainers: true
        });

        const root = laid.positions['A::Root']!;
        const middle = laid.positions['B::Middle']!;
        const child = laid.positions['A::Child']!;
        expect(middle.y - (root.y + root.height)).toBeGreaterThanOrEqual(defaultLayoutOptions.rankSpacing - 1);
        expect(child.y - (middle.y + middle.height)).toBeGreaterThanOrEqual(defaultLayoutOptions.rankSpacing - 1);
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

    /**
     * `enforceTaxonomyRanks` only repositions classes with a supertype or a
     * subtype. A class with neither -- `Journal` alongside `Article` in
     * `Publications`, here `Loose` alongside `Sub0` -- keeps the coordinates
     * ELK's whole-graph pass gave it even once the taxonomy around it has
     * been translated onto its own rank, unless something settles it too.
     */
    test('settles a class with no taxonomy of its own towards what it associates with', async () => {
        const view = taxonomy(3);
        view.nodes.push({
            id: 'Sample::Loose', kind: 'class', name: 'Loose', package: 'Sample',
            stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
        });
        view.groups[0]!.nodes.push('Sample::Loose');
        view.edges.push({
            kind: 'relation', id: 'assoc', source: 'Sample::Loose', target: 'Sample::Sub0',
            sourceEnd: { isConst: false, isAddOnly: false },
            targetEnd: { isConst: false, isAddOnly: false }
        });

        const positions = await arrange(view, false);
        const centre = (id: string) => {
            const rect = positions[id]!;
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        };
        const gap = Math.hypot(
            centre('Sample::Loose').x - centre('Sample::Sub0').x,
            centre('Sample::Loose').y - centre('Sample::Sub0').y
        );
        expect(gap).toBeLessThan(defaultLayoutOptions.rankSpacing + defaultLayoutOptions.nodeSpacing);
    });

    /**
     * Two such classes that associate only with each other -- `Journal` and
     * `JournalVolume`, neither with a taxonomy of its own -- read as one
     * thing and must move as one: settling `JournalVolume` alone towards the
     * taxonomy it also associates with, and leaving `Journal` at the
     * coordinates the two of them used to share, splits a pair apart instead
     * of bringing it along.
     */
    test('keeps two classes that only associate with each other together while settling them towards a taxonomy', async () => {
        const view = taxonomy(3);
        const clazz = (id: string) => ({
            id, kind: 'class' as const, name: id.replace('Sample::', ''), package: 'Sample',
            stereotype: 'kind', color: '#FF99A3', isExternal: false, attributes: []
        });
        view.nodes.push(clazz('Sample::PairA'), clazz('Sample::PairB'));
        view.groups[0]!.nodes.push('Sample::PairA', 'Sample::PairB');
        const plainEnd = { isConst: false, isAddOnly: false };
        view.edges.push(
            {
                kind: 'relation', id: 'pair', source: 'Sample::PairA', target: 'Sample::PairB',
                sourceEnd: { ...plainEnd }, targetEnd: { ...plainEnd }
            },
            {
                kind: 'relation', id: 'anchor', source: 'Sample::PairB', target: 'Sample::Sub0',
                sourceEnd: { ...plainEnd }, targetEnd: { ...plainEnd }
            }
        );

        const positions = await arrange(view, false);
        const centre = (id: string) => {
            const rect = positions[id]!;
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        };
        const gap = Math.hypot(
            centre('Sample::PairA').x - centre('Sample::PairB').x,
            centre('Sample::PairA').y - centre('Sample::PairB').y
        );
        expect(gap).toBeLessThan(defaultLayoutOptions.rankSpacing * 2);
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

    test('places a partial layout in the halo of its fixed neighbours', async () => {
        const clazz = (id: string) => ({
            id, kind: 'class' as const, name: id, package: 'Sample', stereotype: 'kind',
            color: '#FF99A3', isExternal: false, attributes: []
        });
        const view: ViewModel = {
            groups: [],
            nodes: [clazz('Selected'), clazz('Fixed')],
            edges: [{ kind: 'relation', id: 'connection', source: 'Selected', target: 'Fixed' }],
            gensets: []
        };
        const sizes = { Selected: { width: 100, height: 60 }, Fixed: { width: 100, height: 60 } };
        const current = {
            Selected: { x: 0, y: 0, ...sizes.Selected },
            Fixed: { x: 1000, y: 0, ...sizes.Fixed }
        };
        const laid = await autoLayout(view, sizes, current, {
            ...defaultLayoutOptions, groupByPackage: false, only: ['Selected']
        });

        expect(laid.positions.Fixed).toEqual(current.Fixed);
        expect(laid.positions.Selected!.x).toBeGreaterThan(500);
        expect(overlaps(laid.positions.Selected!, laid.positions.Fixed!, 24)).toBe(false);
    });

    test('keeps pinned nodes fixed during a full arrangement', async () => {
        const view = taxonomy(2);
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const current = {
            'Sample::Root': { x: 900, y: 40, ...sizes['Sample::Root']! }
        };
        const laid = await autoLayout(view, sizes, current, {
            ...defaultLayoutOptions,
            groupByPackage: false,
            constraints: { pinned: ['Sample::Root'], alignments: [], distributions: [] }
        });

        expect(laid.positions['Sample::Root']).toEqual(current['Sample::Root']);
        expect(laid.positions['Sample::Sub0']).toBeDefined();
        expect(laid.positions['Sample::Sub1']).toBeDefined();
    });

    test('applies persistent alignment and distribution without moving a pin', () => {
        const positions = {
            A: { x: 0, y: 0, width: 100, height: 60 },
            B: { x: 300, y: 100, width: 100, height: 60 },
            C: { x: 700, y: 200, width: 100, height: 60 }
        };
        applyLayoutConstraints(positions, {
            pinned: ['A'],
            alignments: [{ axis: 'y', nodes: ['A', 'B', 'C'] }],
            distributions: [{ axis: 'x', nodes: ['A', 'B', 'C'] }]
        });

        const centre = (id: keyof typeof positions) => ({
            x: positions[id].x + positions[id].width / 2,
            y: positions[id].y + positions[id].height / 2
        });
        expect(positions.A).toEqual({ x: 0, y: 0, width: 100, height: 60 });
        expect(centre('B').y).toBe(centre('A').y);
        expect(centre('C').y).toBe(centre('A').y);
        expect(centre('B').x - centre('A').x).toBe(centre('C').x - centre('B').x);
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
