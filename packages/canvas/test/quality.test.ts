import { describe, expect, test } from 'vitest';
import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultDisplayOptions, defaultLayoutOptions, derive } from 'tonto-view';
import { ViewSession } from 'tonto-view/session';
import { autoLayout } from '../src/autolayout.js';
import { sizeOf } from '../src/measure.js';
import { render } from '../src/render.js';
import { measureLayout } from './layout-quality.js';

const fixture = resolve(import.meta.dirname, 'fixtures/layout-pressure.tonto');
const repository = resolve(import.meta.dirname, '../../..');

async function benchmark(target = fixture) {
    const folder = statSync(target).isDirectory() ? target : dirname(target);
    const session = new ViewSession({ workspace: [folder] });
    const models = statSync(target).isDirectory()
        ? await session.models()
        : await session.modelsOf(pathToFileURL(target).toString());
    const view = derive({ models, documentation: session.documentation() });
    const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, defaultDisplayOptions)]));
    const laid = await autoLayout(view, sizes, {}, {
        ...defaultLayoutOptions,
        routing: 'straight'
    });
    const rendered = render({ view, positions: laid.positions, display: defaultDisplayOptions });
    return { view, laid, rendered, quality: measureLayout(view, laid.positions, rendered, 'DOWN') };
}

describe('layout quality benchmarks', () => {
    test('keeps association pressure out of taxonomy corridors', async () => {
        const { laid, rendered, quality } = await benchmark();
        expect(Object.keys(laid.positions)).toHaveLength(12);
        expect(quality.nodeOverlaps).toBe(0);
        expect(quality.taxonomyViolations).toBe(0);
        expect(quality.edgeNodeIntersections).toBe(0);
        expect(quality.edgeCrossings).toBeLessThanOrEqual(3);
        expect(quality.labelOcclusions).toBeLessThanOrEqual(12);
        expect(quality.bounds.width).toBeLessThan(1000);
        expect(quality.bounds.height).toBeLessThan(650);
        expect(quality.edgeLength.total).toBeLessThan(2400);
        expect(quality.edgeLength.maximum).toBeLessThan(500);

        // Person is attracted to Headache by their characterization, but it
        // must not occupy the inheritance lane from Headache to ActiveHeadache.
        expect(rendered.paths['gen:Error::ActiveHeadache->Error::Headache']).toHaveLength(2);
    });

    test.each([
        ['boats', resolve(repository, 'vendor/tontoredesign/examples/boats.tonto'),
            { width: 2200, height: 1750, crossings: 6, labels: 37, total: 12000, longest: 700 }],
        ['pets', resolve(repository, 'vendor/tontoredesign/examples/pets.tonto'),
            { width: 1600, height: 1050, crossings: 2, labels: 3, total: 3000, longest: 450 }],
        ['gufo', resolve(repository, 'vendor/tontoredesign/examples/gufo.tonto'),
            { width: 1850, height: 1000, crossings: 17, labels: 46, total: 10500, longest: 600 }],
        ['university', resolve(repository, 'vendor/tontoredesign/examples/university'),
            { width: 1400, height: 1250, crossings: 4, labels: 6, total: 6000, longest: 900 }],
        ['parties', resolve(repository, 'packages/view/test/fixtures/parties'),
            { width: 800, height: 750, crossings: 0, labels: 3, total: 900, longest: 400 }]
    ])('keeps the %s benchmark within its quality ceiling', async (_name, target, ceiling) => {
        const { quality } = await benchmark(target);
        expect(quality.nodeOverlaps).toBe(0);
        expect(quality.taxonomyViolations).toBe(0);
        expect(quality.edgeNodeIntersections).toBe(0);
        expect(quality.bounds.width).toBeLessThanOrEqual(ceiling.width);
        expect(quality.bounds.height).toBeLessThanOrEqual(ceiling.height);
        expect(quality.edgeCrossings).toBeLessThanOrEqual(ceiling.crossings);
        expect(quality.labelOcclusions).toBeLessThanOrEqual(ceiling.labels);
        expect(quality.edgeLength.total).toBeLessThanOrEqual(ceiling.total);
        expect(quality.edgeLength.maximum).toBeLessThanOrEqual(ceiling.longest);
    });
});
