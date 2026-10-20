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

async function benchmark(target = fixture, display = defaultDisplayOptions) {
    const folder = statSync(target).isDirectory() ? target : dirname(target);
    const session = new ViewSession({ workspace: [folder] });
    const models = statSync(target).isDirectory()
        ? await session.models()
        : await session.modelsOf(pathToFileURL(target).toString());
    const view = derive({ models, documentation: session.documentation() });
    const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
    const laid = await autoLayout(view, sizes, {}, {
        ...defaultLayoutOptions,
        routing: 'straight'
    });
    const rendered = render({ view, positions: laid.positions, display, direction: 'DOWN' });
    return { view, laid, rendered, quality: measureLayout(view, laid.positions, rendered, 'DOWN') };
}

describe('representative layout fixtures', () => {
    test('draws the motorcycle partonomy whole above part, with its role specializations', async () => {
        const target = resolve(import.meta.dirname, 'fixtures/motorcycle.tonto');
        const session = new ViewSession({ workspace: [dirname(target)] });
        const view = derive({
            models: await session.modelsOf(pathToFileURL(target).toString()),
            documentation: session.documentation()
        });
        const display = { ...defaultDisplayOptions, partonomyOnly: true };
        const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
        const laid = await autoLayout(view, sizes, {}, { ...defaultLayoutOptions, partonomyOnly: true });
        const at = (name: string) => laid.positions[`motorcycle::${name}`]!;
        const above = (upper: string, lower: string) =>
            expect(at(upper).y + at(upper).height, `${upper} above ${lower}`).toBeLessThan(at(lower).y);

        above('Motorcycle', 'MotorcycleEngine');
        above('MotorcycleEngine', 'EnginePiston');
        above('MotorcycleWheel', 'WheelRim');
        above('MotorcycleWheel', 'FrontMotorcycleWheel');
        above('MotorcycleWheel', 'RearMotorcycleWheel');
        // One bus is drawn under both wheel positions; nothing may sit on it.
        const front = at('FrontMotorcycleWheel');
        const rear = at('RearMotorcycleWheel');
        expect(front.y).toBe(rear.y);
        const [left, right] = [front, rear].sort((one, other) => one.x - other.x);
        const between = Object.entries(laid.positions).filter(([, rect]) =>
            rect.y === front.y && rect.x > left!.x && rect.x < right!.x);
        expect(between.map(([id]) => id)).toEqual([]);

        const drawn = render({ view, positions: laid.positions, display, direction: 'DOWN' });
        // A motorcycle has proper parts because a system does.
        expect(drawn.svg).toContain('data-edge="gen:motorcycle::Motorcycle-&gt;motorcycle::System"');
        expect(drawn.svg).not.toContain('data-edge="gen:motorcycle::MotorcycleEngine-&gt;motorcycle::Component"');
        expect(drawn.svg).toContain('motorcycleWheelPositions');
    });

    test('keeps the class-only taxonomy clear at a crowded generalization head', async () => {
        const target = resolve(repository, 'packages/canvas/test/fixtures/classonly.tonto');
        for (const fontFamily of ['sans', 'condensed'] as const) {
            const { rendered, quality } = await benchmark(target, { ...defaultDisplayOptions, fontFamily });

            expect(rendered.headCollisions).toBe(0);
            expect(quality.generalizationHeadCollisions).toBe(0);
            expect(quality.edgeCrossings).toBe(0);
            expect(quality.edgeNodeIntersections).toBe(0);
        }
    });

    test('places every class in the pets layout', async () => {
        const target = resolve(repository, 'packages/canvas/test/fixtures/pets.tonto');
        const { view, laid } = await benchmark(target);

        expect(Object.keys(laid.positions)).toHaveLength(view.nodes.length);
        for (const rect of Object.values(laid.positions)) {
            expect(Number.isFinite(rect.x) && Number.isFinite(rect.y)).toBe(true);
        }
    });

    test('renders the association pressure fixture after layout', async () => {
        const { laid, rendered, quality } = await benchmark();
        expect(Object.keys(laid.positions)).toHaveLength(12);
        expect(rendered.svg).toContain('<svg');
        for (const value of Object.values(quality.edgeLength)) {
            expect(Number.isFinite(value)).toBe(true);
        }
    });

    test('places the higher-order types in ab', async () => {
        const target = resolve(repository, 'packages/canvas/test/fixtures/ab.tonto');
        const { view, laid, quality } = await benchmark(target);
        expect(Object.keys(laid.positions)).toHaveLength(view.nodes.length);
        expect(Number.isFinite(quality.bounds.width) && Number.isFinite(quality.bounds.height)).toBe(true);
    });

    test.each([
        ['ab', resolve(repository, 'packages/canvas/test/fixtures/ab.tonto')],
        ['mixed relations', fixture]
    ])('keeps curved %s associations safe and close to their direct guides', async (_name, target) => {
        const straight = await benchmark(target);
        const curved = await benchmark(target, { ...defaultDisplayOptions, routing: 'curved' });
        const allowance = straight.view.edges.length * 4;

        expect(curved.quality.edgeNodeIntersections).toBeLessThanOrEqual(straight.quality.edgeNodeIntersections);
        expect(curved.quality.edgeCrossings).toBeLessThanOrEqual(straight.quality.edgeCrossings);
        expect(curved.quality.edgeLength.total)
            .toBeLessThanOrEqual(straight.quality.edgeLength.total * 1.15 + allowance);
        expect(curved.quality.edgeLength.maximum)
            .toBeLessThanOrEqual(straight.quality.edgeLength.maximum * 1.15 + 4);
    });

    test.each([
        ['boats', resolve(repository, 'packages/canvas/test/fixtures/boats.tonto')],
        ['pets', resolve(repository, 'packages/canvas/test/fixtures/pets.tonto')],
        ['gufo', resolve(repository, 'packages/canvas/test/fixtures/gufo.tonto')],
        ['genealogy', resolve(repository, 'packages/canvas/test/fixtures/genealogy.tonto')],
        ['university', resolve(repository, 'packages/canvas/test/fixtures/university')],
        ['parties', resolve(repository, 'packages/view/test/fixtures/parties')]
    ])('lays out and draws the %s benchmark', async (_name, target) => {
        const { view, laid, rendered, quality } = await benchmark(target);
        expect(Object.keys(laid.positions)).toHaveLength(view.nodes.length);
        expect(quality.nodeOverlaps).toBe(0);
        expect(quality.edgeNodeIntersections).toBe(0);
        expect(rendered.svg).toContain('<svg');
        expect(Number.isFinite(quality.bounds.width) && Number.isFinite(quality.bounds.height)).toBe(true);
        expect(Number.isFinite(quality.edgeLength.total)).toBe(true);
    });
});
