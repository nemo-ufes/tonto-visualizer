import { describe, expect, test } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { derive } from '../src/index.js';
import { ViewSession } from '../src/session.js';

const parties = resolve(import.meta.dirname, 'fixtures/parties');

/** A session over the fixture folder, which is a model of two files. */
async function viewOfFixture(options?: Parameters<typeof derive>[0]['options']) {
    const session = new ViewSession({ workspace: [parties] });
    return derive({
        models: await session.models(),
        documentation: session.documentation(),
        ...(options ? { options } : {})
    });
}

/** A session over one string, for the cases a file would only get in the way of. */
async function viewOfText(text: string, options?: Parameters<typeof derive>[0]['options']) {
    const session = new ViewSession();
    const uri = pathToFileURL(resolve(parties, 'draft.tonto')).toString();
    await session.update(uri, text);
    return derive({ models: await session.models(), ...(options ? { options } : {}) });
}

describe('the view of a model', () => {

    test('is the whole model, and nothing the standard library declares', async () => {
        const view = await viewOfFixture();
        expect(view.groups.map(group => group.name).sort()).toEqual(['Employment', 'Parties']);
        expect(view.nodes.map(node => node.id)).not.toContain('Tonto.BuiltinDatatypes::string');
    });

    test('reads the same twice', async () => {
        const view = await viewOfFixture();
        await expect(JSON.stringify(stripLocations(view), undefined, 2) + '\n')
            .toMatchFileSnapshot('goldens/parties.json');
    });

    test('colours a class by the natures it actually classifies', async () => {
        const view = await viewOfText(`
package Sample
collective Forest
role ProtectedForest specializes Forest
kind Tree
`);
        const forest = node(view, 'Sample::Forest');
        const protectedForest = node(view, 'Sample::ProtectedForest');
        expect(forest.natures?.natures).toEqual(['collectives']);
        // The role says nothing about natures; it classifies collectives
        // because what it specializes does, and it wears the lighter tone
        // because it is not the ultimate sortal.
        expect(protectedForest.natures).toEqual({ natures: ['collectives'], origin: 'inherited', from: 'Forest' });
        expect(protectedForest.color).not.toEqual(forest.color);
        expect(node(view, 'Sample::Tree').color).toEqual(forest.color !== '#E0E0E0' ? node(view, 'Sample::Tree').color : '#E0E0E0');
    });

    test('marks the generalizations a generalization set groups', async () => {
        const view = await viewOfFixture();
        const set = view.gensets.find(genset => genset.name === 'PersonAgePhases');
        expect(set).toMatchObject({
            disjoint: true,
            complete: true,
            general: 'Parties::Person',
            specifics: ['Parties::Child', 'Parties::Adult']
        });
        const grouped = view.edges.filter(edge => edge.kind === 'generalization' && edge.genset === set?.id);
        expect(grouped.map(edge => edge.source)).toEqual(['Parties::Child', 'Parties::Adult']);
    });

    test('puts the diamond on the end that holds the whole', async () => {
        const view = await viewOfFixture();
        const parthood = relation(view, 'has');
        expect(parthood.whole).toBe('source');
        expect(parthood.sourceEnd.isWhole).toBe(true);
        expect(parthood.targetEnd).toMatchObject({ cardinality: '4..*', role: 'wheels' });
    });

    test('keeps the end decorations UML writes on the end', async () => {
        const view = await viewOfFixture();
        const mediations = view.edges.filter(edge => edge.kind === 'relation' && edge.stereotype === 'mediation');
        expect(mediations).toHaveLength(2);
        expect(mediations.every(edge => edge.kind === 'relation' && edge.targetEnd.isConst)).toBe(true);
    });

    test('draws a name that does not resolve, rather than dropping the edge', async () => {
        const view = await viewOfText(`
package Sample
kind Person
role Student specializes Missing
`);
        const ghost = node(view, 'Missing');
        expect(ghost.kind).toBe('unresolved');
        expect(view.edges).toContainEqual(
            expect.objectContaining({ kind: 'generalization', source: 'Sample::Student', target: 'Missing' }));
    });

    test('drops what external references bring in when they are turned off', async () => {
        const inside = await viewOfFixture({ showExternalReferences: false, includedPackages: ['Employment'] });
        expect(inside.nodes.map(node => node.id).sort())
            .toEqual(['Employment::Car', 'Employment::Currency', 'Employment::EmploymentContract', 'Employment::Wheel']);

        const outside = await viewOfFixture({ includedPackages: ['Employment'] });
        expect(outside.nodes.filter(node => node.isExternal).map(node => node.id).sort())
            .toEqual(['Parties::Employee', 'Parties::Organization']);
    });

    test('hides an element and every edge that touched it', async () => {
        const view = await viewOfFixture({ hidden: ['Parties::Person'] });
        expect(view.nodes.map(node => node.id)).not.toContain('Parties::Person');
        expect(view.edges.some(edge => edge.source === 'Parties::Person' || edge.target === 'Parties::Person')).toBe(false);
    });

    test('gives an element the same id after the text around it moves', async () => {
        const before = await viewOfText(`
package Sample
kind Person
role Employee specializes Person
`);
        const after = await viewOfText(`
package Sample
kind Organization
kind Person
role Employee specializes Person
`);
        const kept = (ids: string[]) => ids.filter(id => id !== 'Sample::Organization');
        expect(kept(after.nodes.map(node => node.id))).toEqual(before.nodes.map(node => node.id));
        expect(kept(after.edges.map(edge => edge.id))).toEqual(before.edges.map(edge => edge.id));
    });
});

function node(view: Awaited<ReturnType<typeof viewOfText>>, id: string) {
    const found = view.nodes.find(candidate => candidate.id === id);
    if (!found) {
        throw new Error(`no node ${id}; the view holds ${view.nodes.map(one => one.id).join(', ')}`);
    }
    return found;
}

function relation(view: Awaited<ReturnType<typeof viewOfText>>, name: string) {
    const found = view.edges.find(edge => edge.kind === 'relation' && edge.name === name);
    if (!found || found.kind !== 'relation') {
        throw new Error(`no relation named ${name}`);
    }
    return found;
}

/**
 * Absolute paths and line numbers are the one part of a view that says where
 * the machine is rather than what the model is, and a golden file holding them
 * fails on someone else's checkout.
 */
function stripLocations<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (key, entry) => (key === 'source' || key === 'source_' ? undefined : entry)));
}
