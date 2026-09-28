import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { derive, expandInverseIds, idsAtSource, packagesInScope } from '../src/index.js';
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

    test('derives specializations declared by a generalization set', async () => {
        const view = await viewOfText(`
package Sample
kind Animal
subkind Cat
subkind Dog
disjoint complete genset Species where Cat, Dog specializes Animal
`, { showGensets: false });

        // Hiding the shared-set notation does not erase the taxonomy it
        // declares. The individual generalizations remain available to the
        // renderer and layout just as class-level `specializes` clauses do.
        expect(view.gensets).toEqual([]);
        expect(view.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'generalization', source: 'Sample::Cat', target: 'Sample::Animal'
            }),
            expect.objectContaining({
                kind: 'generalization', source: 'Sample::Dog', target: 'Sample::Animal'
            })
        ]));
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
        expect(ghost.name).toBe('Missing');
        expect(view.edges).toContainEqual(
            expect.objectContaining({ kind: 'generalization', source: 'Sample::Student', target: 'Missing' }));
    });

    test('keeps the first letter of an unresolved unqualified class name', async () => {
        const view = await viewOfText(`
package Sample
kind Animal {
    -- hunts -- Lion
}
`);
        expect(node(view, 'Lion')).toMatchObject({ kind: 'unresolved', name: 'Lion' });
    });

    test('drops what external references bring in when they are turned off', async () => {
        const inside = await viewOfFixture({ showExternalReferences: false, includedPackages: ['Employment'] });
        expect(inside.nodes.map(node => node.id).sort())
            .toEqual(['Employment::Car', 'Employment::Currency', 'Employment::EmploymentContract', 'Employment::Wheel']);

        const outside = await viewOfFixture({ includedPackages: ['Employment'] });
        expect(outside.nodes.filter(node => node.isExternal).map(node => node.id).sort())
            .toEqual(['Parties::Employee', 'Parties::Organization']);
    });

    test('parses what the language in the editor parses', async () => {
        // The pin had fallen behind `derivedFrom`: the editor accepted the
        // clause and the panel said the model did not parse, holding the last
        // good picture however much was typed after it.
        const session = new ViewSession();
        const uri = pathToFileURL(resolve(parties, 'draft.tonto')).toString();
        await session.update(uri, [
            'package Draft',
            'kind Person',
            'kind Organization',
            'relator Employment {',
            '    @mediation [1..*] -- [1] Person',
            '    @mediation [1..*] -- [1] Organization',
            '}',
            '@material relation Person [1..*] -- worksFor -- [1..*] Organization derivedFrom Employment'
        ].join('\n'));
        expect(await session.parseErrors(uri)).toEqual([]);
    });

    test('records what a relation is derived from', async () => {
        const view = await viewOfText([
            'package Draft',
            'kind Person',
            'kind Organization',
            '@material relation Person [1..*] -- worksFor -- [1..*] Organization derivedFrom Employment',
            'relator Employment {',
            '    @mediation [1..*] -- [1] Person',
            '    @mediation [1..*] -- [1] Organization',
            '}'
        ].join('\n'));
        const material = view.edges.find(edge => edge.kind === 'relation' && edge.stereotype === 'material');

        // Declared after the relation that names it, and still found.
        expect(material?.kind === 'relation' ? material.derivedFrom : undefined).toEqual(['Draft::Employment']);
        const mediation = view.edges.find(edge => edge.kind === 'relation' && edge.stereotype === 'mediation');
        expect(mediation?.kind === 'relation' ? mediation.derivedFrom : 'unexpected').toBeUndefined();
    });

    test('says on which line a model stops parsing', async () => {
        const session = new ViewSession();
        const uri = pathToFileURL(resolve(parties, 'draft.tonto')).toString();
        await session.update(uri, 'package Draft\nkind Person\nkind kind\n');
        const errors = await session.parseErrors(uri);
        expect(errors[0]).toMatch(/^line 3: /);
    });

    test('centres a file view on its packages and keeps imports external', async () => {
        const session = new ViewSession({ workspace: [parties] });
        const uri = pathToFileURL(resolve(parties, 'employment.tonto')).toString();
        const models = await session.models();
        const focused = await session.modelsOf(uri, models);
        const includedPackages = focused.flatMap(model => model.packages.map(one => one.name));
        const view = derive({ models, options: { includedPackages } });
        expect(view.groups.filter(group => !group.isExternal).map(group => group.name)).toEqual(['Employment']);
        expect(view.groups.filter(group => group.isExternal).map(group => group.name)).toEqual(['Parties']);
    });

    test('draws the opened file or the whole workspace, as the scope says', async () => {
        const session = new ViewSession({ workspace: [parties] });
        const uri = pathToFileURL(resolve(parties, 'employment.tonto')).toString();
        const models = await session.models();
        const available = {
            file: packageNames(await session.modelsOf(uri, models)),
            workspace: packageNames(models)
        };
        // What the extension does with a scope: the stored choice becomes the
        // list of names the derivation is given.
        const viewOf = (content: Parameters<typeof packagesInScope>[0]) => derive({
            models,
            options: { ...content, includedPackages: packagesInScope(content, available) }
        });

        const file = viewOf({ scope: 'file' });
        expect(file.groups.filter(group => !group.isExternal).map(group => group.name)).toEqual(['Employment']);
        expect(file.groups.filter(group => group.isExternal).map(group => group.name)).toEqual(['Parties']);

        const whole = viewOf({ scope: 'workspace' });
        expect(whole.groups.map(group => group.name).sort()).toEqual(['Employment', 'Parties']);
        expect(whole.groups.filter(group => group.isExternal)).toEqual([]);
        expect(whole.nodes.filter(node => node.isExternal)).toEqual([]);
        expect(whole.nodes.length).toBeGreaterThan(file.nodes.length);

        // Ticking packages by hand outranks either scope.
        const picked = viewOf({ scope: 'workspace', includedPackages: ['Parties'] });
        expect(picked.groups.filter(group => !group.isExternal).map(group => group.name)).toEqual(['Parties']);
    });

    test('drops datatype nodes and the attributes typed by them together', async () => {
        const view = await viewOfFixture({ showDatatypes: false });
        expect(view.nodes.some(node => node.kind === 'datatype' || node.kind === 'enumeration')).toBe(false);
        expect(view.nodes.flatMap(node => node.attributes)).toEqual([]);
    });

    test('hides an element and every edge that touched it', async () => {
        const view = await viewOfFixture({ hidden: ['Parties::Person'] });
        expect(view.nodes.map(node => node.id)).not.toContain('Parties::Person');
        expect(view.edges.some(edge => edge.source === 'Parties::Person' || edge.target === 'Parties::Person')).toBe(false);
    });

    test('hides an edge without renaming the other edges', async () => {
        const before = await viewOfFixture();
        const hidden = before.edges.find(edge => edge.kind === 'relation');
        expect(hidden).toBeDefined();
        const after = await viewOfFixture({ hidden: [hidden!.id] });
        expect(after.edges.map(edge => edge.id)).toEqual(
            before.edges.filter(edge => edge.id !== hidden!.id).map(edge => edge.id));
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

    test('reloads the file from disk when an editor buffer is reverted', async () => {
        const session = new ViewSession({ workspace: [parties] });
        const uri = pathToFileURL(resolve(parties, 'employment.tonto')).toString();
        const packages = async () => (await session.models())
            .flatMap(model => model.packages.map(one => one.name)).sort();
        expect(await packages()).toEqual(['Employment', 'Parties']);
        await session.update(uri, 'package Temporary\nkind Draft\n');
        expect(await packages()).toEqual(['Parties', 'Temporary']);
        await session.revert(uri);
        expect(await packages()).toEqual(['Employment', 'Parties']);
    });

    test('keeps view order stable after replacing an editor buffer', async () => {
        const session = new ViewSession({ workspace: [parties] });
        const uri = pathToFileURL(resolve(parties, 'employment.tonto')).toString();
        const before = stripLocations(derive({ models: await session.models() }));
        await session.update(uri, readFileSync(resolve(parties, 'employment.tonto'), 'utf8'));
        const after = stripLocations(derive({ models: await session.models() }));
        expect(after).toEqual(before);
    });

    test('resolves inverseOf to the id of the relation it names, on both halves', async () => {
        const view = await viewOfText(`
package Sample
kind Person {
    @historicalDependence (addOnly children) [*] -- hasFather -- [1] (const father) Man
}
subkind Man specializes Person {
    (const father) [1] -- hasChild -- [*] (addOnly children) Person inverseOf Person.hasFather
}
`);
        // Written on one side of the pair and recorded on both, because a
        // drawing that shows the two as one line has to reach the other half
        // from whichever of them it is holding. As an id, not as the name it
        // was written as: resolving the name is the language's job, and the
        // canvas has no way to do it.
        const child = relation(view, 'hasChild');
        const father = relation(view, 'hasFather');
        expect(child.inverseOf).toBe(father.id);
        expect(father.inverseOf).toBe(child.id);
        expect(expandInverseIds(view.edges, [child.id])).toEqual([child.id, father.id]);
    });

    test('leaves inverse declarations separate when their ends disagree', async () => {
        const view = await viewOfText(`
package Sample
kind Person {
    @historicalDependence (addOnly children) [*] -- hasFather -- [1] (const father) Man
}
subkind Man specializes Person {
    -- hasChildren -- Person inverseOf Person.hasFather
}
`);
        expect(relation(view, 'hasChildren').inverseOf).toBeUndefined();
        expect(relation(view, 'hasFather').inverseOf).toBeUndefined();
    });

    test('leaves inverseOf off a pair that does not run between the same two classes', async () => {
        const view = await viewOfText(`
package Sample
kind Person {
    @historicalDependence (addOnly children) [*] -- hasFather -- [1] (const father) Man
}
kind Company
subkind Man specializes Person {
    [1] -- worksAt -- [*] Company inverseOf Person.hasFather
}
`);
        // The two are not one association stated twice, whatever the model
        // says. Drawing them as one line would be the picture disagreeing with
        // the validator, which is worse than drawing both.
        expect(relation(view, 'worksAt').inverseOf).toBeUndefined();
        expect(relation(view, 'hasFather').inverseOf).toBeUndefined();
    });

    test('finds relation declarations as well as classes at an editor line', async () => {
        const view = await viewOfText(`
package Sample
kind Person {
    -- knows -- Person
}
`);
        const person = node(view, 'Sample::Person');
        const knows = relation(view, 'knows');
        expect(person.source).toBeDefined();
        expect(knows.source_).toBeDefined();
        expect(idsAtSource(view, knows.source_!.uri, knows.source_!.line)).toContain(knows.id);
    });
});

/** The packages a set of models declares, which is what a scope resolves to. */
function packageNames(models: Awaited<ReturnType<ViewSession['models']>>): string[] {
    return [...new Set(models
        .flatMap(model => model.packages.map(one => one.name))
        .filter((name): name is string => name !== undefined))];
}

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
