import { describe, expect, test } from 'vitest';
import type { OntologyOutline, ViewModel, WorkspaceOntology } from 'tonto-view';
import { defaultDisplayOptions, defaultLayoutOptions, derivePackages, deriveWorkspacePackages } from 'tonto-view';
import { autoLayout } from '../src/autolayout.js';
import type { Rect } from '../src/geometry.js';
import { overlaps } from '../src/geometry.js';
import { PACKAGE_TAB, sizeOf } from '../src/measure.js';
import { edgeEnds, groupBoxes, render } from '../src/render.js';

const display = { ...defaultDisplayOptions };

/**
 * A library's manifest: two bundled packages, one using the other, an import
 * the manifest declares for both and one the lending package declares itself.
 */
const outline: OntologyOutline = {
    name: 'library',
    packages: [
        { name: 'catalogue', location: 'catalogue.tonto', available: true, uses: [], imports: [] },
        {
            name: 'lending', location: 'lending.tonto', available: true,
            uses: [{ name: 'catalogue' }],
            imports: [{ alias: 'people', location: '../hr/hr.tonto', ontology: { id: 'hr', name: 'hr' } }]
        }
    ],
    imports: [{ alias: 'places', location: '../places/places.tonto', ontology: { id: 'places', name: 'places' } }]
};

async function laidOut(view: ViewModel) {
    const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
    return (await autoLayout(view, sizes, {}, { ...defaultLayoutOptions })).positions;
}

function inside(inner: Rect, outer: Rect): boolean {
    return inner.x >= outer.x && inner.y >= outer.y
        && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

describe('a package diagram', () => {

    test('expands a workspace ontology into packages inside its own frame', async () => {
        const ontology: WorkspaceOntology = {
            name: 'library', identity: 'file:///library.tonto', imports: [], hasPackages: true,
            packages: outline.packages
        };
        const collapsed = deriveWorkspacePackages([ontology]);
        expect(collapsed.nodes.find(node => node.id === 'workspace-ontology:library')?.hasPackages).toBe(true);

        const view = deriveWorkspacePackages([ontology], new Set(['workspace-ontology:library']));
        const positions = await laidOut(view);
        const frame = groupBoxes(view, positions)[0]!;
        expect(frame).toMatchObject({ id: 'workspace-ontology:library', name: 'library', expandable: true });
        for (const id of [
            'workspace-package:library::catalogue', 'workspace-package:library::lending'
        ]) {
            expect(inside(positions[id]!, frame.rect)).toBe(true);
        }
        expect(view.edges).toContainEqual(expect.objectContaining({
            id: 'use:workspace-package:library::lending->workspace-package:library::catalogue'
        }));
        const { svg } = render({ view, positions, display });
        expect(svg).toContain('data-toggle-ontology="workspace-ontology:library"');
    });

    test('lays the members out inside the frame and the imports outside it', async () => {
        const view = derivePackages(outline);
        const positions = await laidOut(view);
        const frame = groupBoxes(view, positions)[0]!;
        expect(frame.kind).toBe('ontology');
        for (const id of ['package:catalogue', 'package:lending']) {
            expect(inside(positions[id]!, frame.rect)).toBe(true);
        }
        for (const id of ['import:places', 'import:hr']) {
            expect(overlaps(positions[id]!, frame.rect)).toBe(false);
        }
    });

    test('puts what is depended on above what depends on it', async () => {
        const view = derivePackages(outline);
        const positions = await laidOut(view);
        const bottom = (id: string) => positions[id]!.y + positions[id]!.height;
        expect(bottom('package:catalogue')).toBeLessThanOrEqual(positions['package:lending']!.y);
        expect(bottom('import:places')).toBeLessThanOrEqual(groupBoxes(view, positions)[0]!.rect.y);
    });

    test('draws packages as folders and dependencies as dashed arrows', async () => {
        const view = derivePackages(outline);
        const { svg } = render({ view, positions: await laidOut(view), display });
        const card = /<g class="tv-node" data-node="package:catalogue">(.*?)<\/g>/.exec(svg)?.[1] ?? '';
        // A tab and a body, the name, and where the manifest reads it from.
        expect(card.match(/<rect /g)).toHaveLength(2);
        expect(card).toContain('>catalogue<');
        expect(card).toContain('>&lt;catalogue.tonto&gt;<');
        const use = /<g class="tv-edge" data-edge="use:package:lending-&gt;package:catalogue">(.*?)<\/g>/.exec(svg)?.[1] ?? '';
        expect(use).toContain('stroke-dasharray="6 4"');
        expect(use).toContain('class="tv-arrow"');
        expect(svg).toContain('«use»');
        expect(svg).toContain('as people');
    });

    test('draws the ontology as a frame even with package boxes off', async () => {
        const view = derivePackages(outline);
        const { svg } = render({ view, positions: await laidOut(view), display: { ...display, showPackageGroups: false } });
        expect(svg).toContain('class="tv-group tv-ontology" data-group="ontology:library"');
        expect(svg).toContain('>library</text>');
    });

    test('starts an import the manifest declares on the border of the frame', async () => {
        const view = derivePackages(outline);
        const positions = await laidOut(view);
        const { paths } = render({ view, positions, display });
        const frame = edgeEnds(view, positions)['ontology:library']!;
        const start = paths['import:ontology:library->import:places']?.[0];
        expect(start).toBeDefined();
        const onEdge = Math.abs(start!.y - frame.y) <= 1 || Math.abs(start!.y - (frame.y + frame.height)) <= 1
            || Math.abs(start!.x - frame.x) <= 1 || Math.abs(start!.x - (frame.x + frame.width)) <= 1;
        expect(onEdge).toBe(true);
    });

    test('keeps its dependencies under a hierarchy-only display setting', async () => {
        const view = derivePackages(outline);
        const positions = await laidOut(view);
        for (const setting of [{ taxonomyOnly: true }, { partonomyOnly: true }]) {
            const { paths } = render({ view, positions, display: { ...display, ...setting } });
            expect(Object.keys(paths).sort()).toEqual(view.edges.map(edge => edge.id).sort());
        }
    });

    test('sizes a package card for its tab, name and location', () => {
        const [catalogue] = derivePackages(outline).nodes;
        const card = sizeOf(catalogue!, display);
        const bare = sizeOf({ ...catalogue!, location: undefined }, display);
        expect(card.height).toBeGreaterThan(bare.height);
        expect(bare.height).toBeGreaterThan(PACKAGE_TAB.height);
    });
});
