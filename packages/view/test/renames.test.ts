import { describe, expect, test } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ViewFile } from '../src/index.js';
import {
    derive, emptyViewFile, keptReading, readKeptReading, renameEdgeEnds, renameInRawViewFile, renameInViewFile,
    renamesBetween
} from '../src/index.js';
import { ViewSession } from '../src/session.js';

const uri = pathToFileURL(resolve(import.meta.dirname, 'fixtures/parties/draft.tonto')).toString();

/** The model read once as written and once as edited, in one session, as the panel reads it. */
async function before_and_after(before: string, after: string) {
    const session = new ViewSession();
    await session.update(uri, before);
    const first = derive({ models: await session.models() });
    await session.update(uri, after);
    const second = derive({ models: await session.models() });
    return [first, second] as const;
}

const marriage = (person: string, pkg = 'Society') => `
package ${pkg}

kind ${person}
role Husband specializes ${person}
role Wife specializes ${person}
relator Marriage {
    @mediation [0..*] -- [1] Husband
    @mediation [0..*] -- [1] Wife
}
@material relation Husband [0..1] -- marriedTo -- [0..1] Wife
`;

describe('a rename between two readings of a model', () => {

    test('is found where the declaration was written', async () => {
        const [first, second] = await before_and_after(marriage('Person'), marriage('Human'));
        const renames = renamesBetween(first, second);
        expect(Object.fromEntries(renames!.nodes)).toEqual({ 'Society::Person': 'Society::Human' });
    });

    test('of a package renames everything in it', async () => {
        const [first, second] = await before_and_after(marriage('Person'), marriage('Person', 'Kinship'));
        const renames = renamesBetween(first, second);
        expect(Object.fromEntries(renames!.nodes)).toEqual({
            'Society::Person': 'Kinship::Person',
            'Society::Husband': 'Kinship::Husband',
            'Society::Wife': 'Kinship::Wife',
            'Society::Marriage': 'Kinship::Marriage'
        });
    });

    test('is not invented for a model that only changed', async () => {
        const [first, second] = await before_and_after(marriage('Person'), marriage('Person') + 'kind Ceremony\n');
        expect(renamesBetween(first, second)).toBeUndefined();
    });

    test('of a relation is found where the relation was written', async () => {
        const [first, second] = await before_and_after(
            marriage('Person'), marriage('Person').replace('marriedTo', 'spouseOf'));
        const renames = renamesBetween(first, second);
        expect(renames!.nodes.size).toBe(0);
        expect(Object.fromEntries(renames!.edges)).toEqual({
            'rel:Society::Husband->Society::Wife:material:marriedTo':
                'rel:Society::Husband->Society::Wife:material:spouseOf'
        });
    });

    test('is still found when the text around it moved, if only one thing could be it', async () => {
        const [first, second] = await before_and_after(
            marriage('Person'), '\n\n' + marriage('Human').replace('kind Human', 'kind Human // was Person'));
        expect(Object.fromEntries(renamesBetween(first, second)!.nodes))
            .toEqual({ 'Society::Person': 'Society::Human' });
    });
});

describe('a reading kept between sessions', () => {

    test('finds the rename once read back, as the reading it was cut from would', async () => {
        const [first, second] = await before_and_after(marriage('Person'), marriage('Human', 'Kinship'));
        const kept = readKeptReading(JSON.parse(JSON.stringify(keptReading(first))));
        expect(renamesBetween(kept!, second)).toEqual(renamesBetween(first, second));
        expect(renamesBetween(kept!, second)!.nodes.get('Society::Person')).toBe('Kinship::Human');
    });

    test('holds no names, attributes or documentation, only ids and where each starts', async () => {
        const [first] = await before_and_after(marriage('Person'), marriage('Person'));
        const kept = keptReading(first);
        expect(Object.keys(kept.nodes[0]!).sort()).toEqual(['id', 'kind', 'source', 'stereotype']);
        expect(Object.keys(kept.nodes[0]!.source!).sort()).toEqual(['character', 'line', 'uri']);
    });

    test('is refused when another version wrote it, or it is not one', () => {
        expect(readKeptReading({ version: 99, nodes: [], edges: [], gensets: [] })).toBeUndefined();
        expect(readKeptReading({ version: 1, nodes: [{ id: 3 }], edges: [], gensets: [] })).toBeUndefined();
        expect(readKeptReading('nodes')).toBeUndefined();
    });
});

describe('a view file carried over a rename', () => {

    test('keeps the position, the routes and the hidden list', async () => {
        const [first, second] = await before_and_after(marriage('Person'), marriage('Human'));
        const file: ViewFile = {
            ...emptyViewFile(),
            content: { ...emptyViewFile().content, hidden: ['gen:Society::Wife->Society::Person'] },
            nodes: {
                'Society::Person': { x: 10, y: 20 },
                'Society::Husband': { x: 0, y: 100 }
            },
            edges: {
                'gen:Society::Husband->Society::Person': { points: [{ x: 0, y: 100 }, { x: 10, y: 20 }] }
            }
        };
        const renamed = renameInViewFile(file, renamesBetween(first, second)!);
        expect(renamed.nodes).toEqual({
            'Society::Human': { x: 10, y: 20 },
            'Society::Husband': { x: 0, y: 100 }
        });
        expect(Object.keys(renamed.edges)).toEqual(['gen:Society::Husband->Society::Human']);
        expect(renamed.content.hidden).toEqual(['gen:Society::Wife->Society::Human']);
        // Every id the carried file names is one the model now has.
        const ids = new Set([...second.nodes, ...second.edges].map(element => element.id));
        expect([...Object.keys(renamed.nodes), ...Object.keys(renamed.edges)].every(id => ids.has(id))).toBe(true);
    });

    test('is the same file when the rename touched nothing in it', async () => {
        const [first, second] = await before_and_after(marriage('Person'), marriage('Human'));
        const file = { ...emptyViewFile(), nodes: { 'Society::Wife': { x: 1, y: 2 } } };
        expect(renameInViewFile(file, renamesBetween(first, second)!)).toBe(file);
    });
});

describe('a view file on disk carried over a rename', () => {

    test('moves only the ids, each where it was, and leaves the rest as written', async () => {
        const [first, second] = await before_and_after(marriage('Person'), marriage('Human'));
        const raw = {
            version: 1,
            display: { routing: 'curved' },
            somethingNewer: true,
            nodes: { 'Society::Husband': { x: 0, y: 100 }, 'Society::Person': { x: 10, y: 20 } },
            edges: { 'gen:Society::Husband->Society::Person': { labelOffset: { x: 1, y: 1 } } }
        };
        expect(renameInRawViewFile(raw, renamesBetween(first, second)!)).toEqual({
            version: 1,
            display: { routing: 'curved' },
            somethingNewer: true,
            nodes: { 'Society::Husband': { x: 0, y: 100 }, 'Society::Human': { x: 10, y: 20 } },
            edges: { 'gen:Society::Husband->Society::Human': { labelOffset: { x: 1, y: 1 } } }
        });
        expect(Object.keys(renameInRawViewFile(raw, renamesBetween(first, second)!)!.nodes as object))
            .toEqual(['Society::Husband', 'Society::Human']);
    });

    test('is nothing to write when it names nothing renamed, or is not a view at all', async () => {
        const [first, second] = await before_and_after(marriage('Person'), marriage('Human'));
        const renames = renamesBetween(first, second)!;
        expect(renameInRawViewFile({ nodes: { 'Society::Wife': { x: 1, y: 2 } } }, renames)).toBeUndefined();
        expect(renameInRawViewFile([1, 2], renames)).toBeUndefined();
    });
});

describe('an edge id with its ends renamed', () => {
    const rename = (id: string) => id === 'a::B' ? 'a::C' : id;

    test('keeps a relation\'s stereotype, name and occurrence', () => {
        expect(renameEdgeEnds('rel:a::B->x::Y:mediation:holds#2', rename)).toBe('rel:a::C->x::Y:mediation:holds#2');
        expect(renameEdgeEnds('rel:x::Y->a::B::', rename)).toBe('rel:x::Y->a::C::');
        expect(renameEdgeEnds('rel:x::Y->a::B::named', rename)).toBe('rel:x::Y->a::C::named');
    });

    test('renames both ends of a generalization or an instantiation', () => {
        expect(renameEdgeEnds('gen:a::B->a::B', rename)).toBe('gen:a::C->a::C');
        expect(renameEdgeEnds('inst:x::Y->a::B', rename)).toBe('inst:x::Y->a::C');
    });

    test('is nothing for an id that is not an edge\'s', () => {
        expect(renameEdgeEnds('a::B', rename)).toBeUndefined();
        expect(renameEdgeEnds('set:a::Phases', rename)).toBeUndefined();
    });
});
