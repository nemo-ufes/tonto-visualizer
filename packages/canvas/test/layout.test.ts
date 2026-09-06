import { describe, expect, test } from 'vitest';
import type { ViewModel } from 'tonto-view';
import { defaultDisplayOptions, defaultLayoutOptions } from 'tonto-view';
import { autoLayout } from '../src/autolayout.js';
import { sizeOf } from '../src/measure.js';

const display = { ...defaultDisplayOptions };

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
