import { describe, expect, test } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { derive, derivePackages, edgeTouches } from '../src/index.js';
import type { ViewModel } from '../src/index.js';
import { modelRoot, ViewSession } from '../src/session.js';

const fixtures = resolve(import.meta.dirname, 'fixtures');
const library = resolve(fixtures, 'library');

/** The package diagram of a manifest, read the way the panel reads it. */
async function packagesOf(folder: string, file: string): Promise<ViewModel | undefined> {
    const session = new ViewSession({ workspace: [folder] });
    await session.models();
    const outline = await session.outline(pathToFileURL(resolve(folder, file)).toString());
    return outline ? derivePackages(outline) : undefined;
}

/** A manifest typed into an editor buffer beside the fixtures. */
async function outlineOfText(text: string) {
    const session = new ViewSession();
    const uri = pathToFileURL(resolve(fixtures, 'parties', 'draft.tonto')).toString();
    await session.update(uri, text);
    await session.models();
    return session.outline(uri);
}

describe('the package diagram of an ontology manifest', () => {

    test('reads the same twice', async () => {
        const view = await packagesOf(library, 'library.tonto');
        await expect(JSON.stringify(withoutLocations(view), undefined, 2) + '\n')
            .toMatchFileSnapshot('goldens/library.json');
    });

    test('frames the member packages and leaves the imported ontologies outside', async () => {
        const view = (await packagesOf(library, 'library.tonto'))!;
        expect(view.kind).toBe('packages');
        expect(view.groups).toEqual([expect.objectContaining({
            id: 'ontology:library', kind: 'ontology', nodes: ['package:catalogue', 'package:lending']
        })]);
        const external = view.nodes.filter(node => node.isExternal);
        expect(external.map(node => [node.id, node.stereotype])).toEqual([
            ['import:places', 'ontology'],
            ['import:hr', 'ontology']
        ]);
    });

    test('draws use between packages, and each import from where it is declared', async () => {
        const view = (await packagesOf(library, 'library.tonto'))!;
        const dependencies = view.edges.map(edge => edge.kind === 'dependency'
            ? [edge.stereotype, edge.source, edge.target, edge.name] : []);
        expect(dependencies).toEqual([
            // The manifest's import is the ontology's, for every member.
            ['import', 'ontology:library', 'import:places', undefined],
            ['use', 'package:lending', 'package:catalogue', undefined],
            // A package's own import, under the alias it binds: `people`
            // names the ontology that calls itself `hr`.
            ['import', 'package:lending', 'import:hr', 'people']
        ]);
    });

    test('says where each member and each import is read from', async () => {
        const view = (await packagesOf(library, 'library.tonto'))!;
        expect(Object.fromEntries(view.nodes.map(node => [node.id, node.location]))).toEqual({
            'package:catalogue': 'catalogue.tonto',
            'package:lending': 'lending/lending.tonto',
            'import:places': '../places/places.tonto',
            'import:hr': '../../parties/hr.tonto'
        });
    });

    test('opens a member package where it is declared, and an import at its header', async () => {
        const view = (await packagesOf(library, 'library.tonto'))!;
        const opened = (id: string) => view.nodes.find(node => node.id === id)?.source?.uri;
        expect(opened('package:lending')).toBe(pathToFileURL(resolve(library, 'lending', 'lending.tonto')).toString());
        expect(opened('import:hr')).toBe(pathToFileURL(resolve(fixtures, 'parties', 'hr.tonto')).toString());
    });

    test('is the manifest of a two-package ontology', async () => {
        const view = (await packagesOf(resolve(fixtures, 'parties'), 'hr.tonto'))!;
        expect(view.nodes.map(node => node.id)).toEqual(['package:parties', 'package:employment']);
        expect(view.edges.map(edge => edge.id)).toEqual(['use:package:employment->package:parties']);
    });

    test('holds inline packages, and a bundle that selects nothing as unavailable', async () => {
        const outline = await outlineOfText([
            'ontology shop bundles',
            '    returns from <returns.tonto>',
            'package core',
            'kind Person',
            'package sales',
            'use core',
            'role Customer specializes core.Person'
        ].join('\n'));
        const view = derivePackages(outline!);
        expect(view.nodes.map(node => [node.id, node.location, node.unavailable])).toEqual([
            ['package:core', undefined, undefined],
            ['package:sales', undefined, undefined],
            ['package:returns', 'returns.tonto', true]
        ]);
        expect(view.edges.map(edge => edge.id)).toEqual(['use:package:sales->package:core']);
    });

    test('is not drawn for an entry that holds its declarations', async () => {
        expect(await outlineOfText('ontology shop\nkind Product\n')).toBeUndefined();
        expect(await outlineOfText('ontology shop\npackage core\nkind Product\n')).toBeUndefined();
        expect(await outlineOfText('package core\nkind Product\n')).toBeUndefined();
    });

    test('moves an import that leaves the frame with any package inside it', async () => {
        const view = (await packagesOf(library, 'library.tonto'))!;
        const fromFrame = view.edges.find(edge => edge.source === 'ontology:library')!;
        expect(edgeTouches(view, fromFrame, new Set(['package:catalogue']))).toBe(true);
        expect(edgeTouches(view, fromFrame, new Set(['import:hr']))).toBe(false);
    });
});

describe('a monolithic ontology', () => {

    test('is a class diagram named after the ontology', async () => {
        const session = new ViewSession();
        const uri = pathToFileURL(resolve(fixtures, 'parties', 'draft.tonto')).toString();
        await session.update(uri, 'ontology shop\n\nkind Product\nsubkind Book specializes Product\n');
        const view = derive({ models: await session.modelsOf(uri) });
        expect(view.groups.map(group => group.name)).toEqual(['shop']);
        expect(view.nodes.map(node => node.id)).toEqual(['shop::Product', 'shop::Book']);
        expect(view.edges.map(edge => edge.id)).toEqual(['gen:shop::Book->shop::Product']);
    });
});

describe('the workspace a session reads', () => {

    test('leaves out the ontologies it imports from elsewhere', async () => {
        const session = new ViewSession({ workspace: [library] });
        const names = (await session.models()).flatMap(model => model.packages.map(one => one.name));
        expect(names.sort()).toEqual(['catalogue', 'lending']);
    });

    test('draws an imported class as external, where something points at it', async () => {
        const session = new ViewSession({ workspace: [library] });
        const uri = pathToFileURL(resolve(library, 'lending', 'lending.tonto')).toString();
        const view = derive({ models: await session.modelsOf(uri) });
        const person = view.nodes.find(node => node.name === 'Person');
        expect(person).toMatchObject({ id: 'parties::Person', isExternal: true, stereotype: 'kind' });
    });

    test('starts at the manifest for a package bundled from a folder below it', () => {
        expect(modelRoot(resolve(library, 'lending', 'lending.tonto'))).toBe(library);
    });
});

/** Source locations hold absolute paths, which a golden file must not. */
function withoutLocations<T>(value: T): T {
    return JSON.parse(JSON.stringify(value, (key, entry) =>
        (key === 'source' && typeof entry === 'object') || key === 'source_' ? undefined : entry));
}
