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

describe('layout quality benchmarks', () => {
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
        const target = resolve(repository, 'vendor/tontoredesign/examples/classonly.tonto');
        for (const fontFamily of ['sans', 'condensed'] as const) {
            const { rendered, quality } = await benchmark(target, { ...defaultDisplayOptions, fontFamily });

            expect(rendered.headCollisions).toBe(0);
            expect(quality.generalizationHeadCollisions).toBe(0);
            expect(quality.edgeCrossings).toBe(0);
            expect(quality.edgeNodeIntersections).toBe(0);
        }
    });

    test('keeps families declared by generalization sets coupled in pets', async () => {
        const target = resolve(repository, 'vendor/tontoredesign/examples/pets.tonto');
        const { view, laid } = await benchmark(target);

        const family = (name: string) => {
            const set = view.gensets.find(candidate => candidate.name === name);
            expect(set?.general).toBeDefined();
            return [set!.general!, ...set!.specifics].map(id => laid.positions[id]!);
        };
        const centres = (rects: ReturnType<typeof family>) => rects.map(rect => ({
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2
        }));

        for (const name of ['__', 'Name']) {
            const members = family(name);
            const points = centres(members);
            expect(Math.max(...points.map(point => point.x)) - Math.min(...points.map(point => point.x)))
                .toBeLessThan(500);
            expect(Math.max(...points.map(point => point.y)) - Math.min(...points.map(point => point.y)))
                .toBeLessThan(350);
            expect(members.slice(1).every(rect => rect.y > members[0]!.y)).toBe(true);
        }
    });

    test('keeps association pressure out of taxonomy corridors', async () => {
        const { laid, rendered, quality } = await benchmark();
        expect(Object.keys(laid.positions)).toHaveLength(12);
        expect(quality.nodeOverlaps).toBe(0);
        expect(quality.taxonomyViolations).toBe(0);
        expect(quality.edgeNodeIntersections).toBe(0);
        expect(quality.edgeCrossings).toBe(0);
        expect(quality.labelOcclusions).toBeLessThanOrEqual(7);
        expect(quality.bounds.width).toBeLessThan(750);
        expect(quality.bounds.height).toBeLessThan(600);
        expect(quality.edgeLength.total).toBeLessThan(1300);
        expect(quality.edgeLength.maximum).toBeLessThan(180);

        const rightOf = (aspect: string, bearer: string) =>
            laid.positions[aspect]!.x >= laid.positions[bearer]!.x
                + laid.positions[bearer]!.width + defaultLayoutOptions.nodeSpacing;
        expect(rightOf('Error::Intensity', 'Error::Headache')).toBe(true);

        const centre = (id: string) => {
            const rect = laid.positions[id]!;
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        };
        const person = laid.positions['Error::Person']!;
        const duty = laid.positions['Error::Duty']!;
        expect(duty.y).toBeGreaterThan(person.y + person.height);
        expect(Math.abs(centre('Error::Duty').x - centre('Error::Person').x))
            .toBeLessThan(defaultLayoutOptions.nodeSpacing);

        const wedding = laid.positions['Error::Wedding']!;
        const vow = laid.positions['Error::VowReading']!;
        const celebration = laid.positions['Error::Celebration']!;
        expect(wedding.y).toBeLessThan(vow.y);
        expect(vow.y).toBe(celebration.y);
        expect(centre('Error::Wedding').x).toBeGreaterThan(centre('Error::VowReading').x);
        expect(centre('Error::Wedding').x).toBeLessThan(centre('Error::Celebration').x);

        // Person is attracted to Headache by their characterization, but it
        // must not occupy the inheritance lane from Headache to ActiveHeadache.
        expect(rendered.paths['gen:Error::ActiveHeadache->Error::Headache']).toHaveLength(2);
    });

    test('keeps the higher-order types left in ab without crossing unrelated cards', async () => {
        const target = resolve(repository, 'packages/canvas/test/fixtures/ab.tonto');
        const { view, laid, quality } = await benchmark(target);
        const id = (name: string) => view.nodes.find(node => node.name === name)!.id;
        const leftOf = (type: string, ...bases: string[]) => {
            const typeRect = laid.positions[id(type)]!;
            return bases.every(base => typeRect.x + typeRect.width + defaultLayoutOptions.nodeSpacing
                <= laid.positions[id(base)]!.x);
        };
        expect(leftOf('ProcessType', 'Processing')).toBe(true);
        expect(leftOf('PlantSpecies', 'Plant', 'ArabicaPlant')).toBe(true);
        expect(quality.nodeOverlaps).toBe(0);
        expect(quality.edgeNodeIntersections).toBe(0);
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
        ['boats', resolve(repository, 'vendor/tontoredesign/examples/boats.tonto'),
            // Genset-declared specializations are now present as real edges;
            // the former ceiling counted a diagram that omitted those lines.
            { width: 2200, height: 1750, crossings: 17, labels: 37, total: 13500, longest: 1000 }],
        ['pets', resolve(repository, 'vendor/tontoredesign/examples/pets.tonto'),
            { width: 1600, height: 1050, crossings: 2, labels: 3, total: 3000, longest: 450 }],
        ['gufo', resolve(repository, 'vendor/tontoredesign/examples/gufo.tonto'),
            { width: 1850, height: 1000, crossings: 17, labels: 46, total: 10500, longest: 600 }],
        ['genealogy', resolve(repository, 'packages/canvas/test/fixtures/genealogy.tonto'),
            // Crowded generalization heads now use short square approaches;
            // the extra 118px is deliberate decorator clearance, not sprawl.
            { width: 1850, height: 1125, crossings: 6, labels: 1, total: 7350, longest: 560 }],
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
