import { beforeEach, describe, expect, test, vi } from 'vitest';

const filesystem = vi.hoisted(() => ({
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readDirectory: vi.fn(),
    stat: vi.fn()
}));

vi.mock('vscode', () => ({
    FileType: { File: 1, Directory: 2 },
    workspace: { fs: filesystem }
}));

import {
    ViewStore, viewChoicesFor, viewFileExists, viewNameFor, viewNameOf, viewToShow, viewUriFor
} from '../src/view-store.js';

function modelUri(path = '/workspace/model.tonto') {
    return {
        path,
        with(change: { path: string }) {
            return modelUri(change.path);
        },
        // A URI is what one document is told apart from another by, here as in
        // VS Code: without it two of these fakes are the same string.
        toString() {
            return `file://${path}`;
        }
    };
}

describe('the view store', () => {
    beforeEach(() => {
        filesystem.readFile.mockReset();
        filesystem.writeFile.mockReset();
        filesystem.readFile.mockRejectedValue(new Error('not found'));
        filesystem.writeFile.mockResolvedValue(undefined);
        filesystem.readDirectory.mockResolvedValue([]);
        filesystem.stat.mockRejectedValue(new Error('not found'));
    });

    test('flushes a pending arrangement when it is disposed', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', true);
        store.move({ 'Sample::Person': { x: 24, y: 48 } });

        await store.dispose();

        expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
        const bytes = filesystem.writeFile.mock.calls[0]![1] as Uint8Array;
        expect(JSON.parse(Buffer.from(bytes).toString('utf8')).nodes).toEqual({
            'Sample::Person': { x: 24, y: 48 }
        });
    });

    test('takes back one step per thing the modeller did, not per change it made', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', true);
        // Arranging the diagram moves every class and drops every route. Taking
        // that back one class at a time would be no use to anybody.
        store.begin('Arrange');
        store.move({ 'Sample::Person': { x: 10, y: 10 } });
        store.move({ 'Sample::Employee': { x: 20, y: 20 } });
        store.reroute('rel:a', { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] });

        expect(store.history.undo).toBe('Arrange');
        expect(store.undo()).toBe('Arrange');
        expect(store.state.nodes).toEqual({});
        expect(store.state.edges).toEqual({});
        expect(store.history.undo).toBeUndefined();
        await store.dispose();
    });

    test('puts back what it took back, and stops when there is nothing left', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', true);
        store.begin('Move');
        store.move({ 'Sample::Person': { x: 10, y: 10 } });
        store.begin('Move');
        store.move({ 'Sample::Person': { x: 30, y: 30 } });

        expect(store.undo()).toBe('Move');
        expect(store.state.nodes['Sample::Person']).toEqual({ x: 10, y: 10 });
        expect(store.undo()).toBe('Move');
        expect(store.state.nodes).toEqual({});
        expect(store.undo()).toBeUndefined();

        expect(store.redo()).toBe('Move');
        expect(store.state.nodes['Sample::Person']).toEqual({ x: 10, y: 10 });
        expect(store.redo()).toBe('Move');
        expect(store.state.nodes['Sample::Person']).toEqual({ x: 30, y: 30 });
        expect(store.redo()).toBeUndefined();
        await store.dispose();
    });

    test('drops what was taken back once something else is done', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', true);
        store.begin('Move');
        store.move({ 'Sample::Person': { x: 10, y: 10 } });
        store.undo();

        store.begin('Hide');
        store.update({ content: { ...store.state.content, hidden: ['Sample::Person'] } });

        // A history that branches is one nobody can hold in their head.
        expect(store.history.redo).toBeUndefined();
        expect(store.undo()).toBe('Hide');
        expect(store.state.content.hidden).toBeUndefined();
        await store.dispose();
    });

    test('does not record a change the model forced', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', true);
        store.begin('Move');
        store.move({ 'Sample::Person': { x: 10, y: 10 } });

        // A class that grew an attribute drops the routes that met it. Nobody
        // asked for that, and an undo that appears to do nothing is worse than
        // no entry at all.
        store.reroute('rel:a', undefined);

        expect(store.history.undo).toBe('Move');
        store.undo();
        expect(store.state.nodes).toEqual({});
        expect(store.history.undo).toBeUndefined();
        await store.dispose();
    });

    test('writes the arrangement it was taken back to', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', true);
        store.begin('Move');
        store.move({ 'Sample::Person': { x: 24, y: 48 } });
        store.undo();

        await store.dispose();

        const bytes = filesystem.writeFile.mock.calls.at(-1)![1] as Uint8Array;
        expect(JSON.parse(Buffer.from(bytes).toString('utf8')).nodes).toEqual({});
    });

    test('starts with the nature-colour legend hidden', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', true);

        expect(store.state.display.showLegend).toBe(false);
        await store.dispose();
    });

    test('restores filters and placements after the panel is reopened', async () => {
        const first = await ViewStore.open(modelUri() as never, 'Sample', true);
        first.begin('Hide');
        first.update({ content: { ...first.state.content, hidden: ['Sample::Person', 'works-for'] } });
        first.move({ 'Sample::Person': { x: 80, y: 120 } });
        await first.dispose();
        const bytes = filesystem.writeFile.mock.calls.at(-1)![1] as Uint8Array;
        filesystem.readFile.mockResolvedValue(bytes);

        const reopened = await ViewStore.open(modelUri() as never, 'Sample', true);

        expect(reopened.state.content.hidden).toEqual(['Sample::Person', 'works-for']);
        expect(reopened.state.nodes['Sample::Person']).toEqual({ x: 80, y: 120 });
        await reopened.dispose();
    });

    test('normalizes a human name into a stable sibling filename', () => {
        expect(viewNameOf('  Core Taxonomy  ')).toBe('core-taxonomy');
        expect(viewNameOf('Relações & Papéis')).toBe('relacoes-papeis');
        expect(viewNameOf('---')).toBeUndefined();
        const uri = viewUriFor(modelUri('/workspace/employment.tonto') as never, 'core-taxonomy');
        expect(uri.path).toBe('/workspace/employment.core-taxonomy.tontoview');
        expect(viewNameFor(modelUri('/workspace/employment.tonto') as never, uri as never))
            .toBe('core-taxonomy');
    });

    test('discovers only the named views belonging to the exact model', async () => {
        filesystem.readDirectory.mockResolvedValue([
            ['employment.roles.tontoview', 1],
            ['employment.tontoview', 1],
            ['employment.core-taxonomy.tontoview', 1],
            ['employment-relations.tontoview', 1],
            ['employment.notes.txt', 1],
            ['employment.draft.tontoview', 2]
        ]);

        const views = await viewChoicesFor(modelUri('/workspace/employment.tonto') as never);

        expect(views.map(view => [view.label, view.description])).toEqual([
            ['Default view', 'employment.tontoview'],
            ['core taxonomy', 'employment.core-taxonomy.tontoview'],
            ['roles', 'employment.roles.tontoview']
        ]);
    });

    test('copies the complete current diagram into a named view even when autosave is off', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', false);
        store.move({ 'Sample::Person': { x: 24, y: 48 } });
        store.update({ content: { ...store.state.content, hidden: ['Sample::Employee'] } });

        await store.copyTo(viewUriFor(modelUri() as never, 'people'));

        expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
        const [uri, bytes] = filesystem.writeFile.mock.calls[0]!;
        expect(uri.path).toBe('/workspace/model.people.tontoview');
        expect(JSON.parse(Buffer.from(bytes as Uint8Array).toString('utf8'))).toMatchObject({
            focus: 'Sample',
            nodes: { 'Sample::Person': { x: 24, y: 48 } },
            content: { hidden: ['Sample::Employee'] }
        });
    });

    /**
     * A view of `employment.v2.tonto` sits beside `employment.tonto` under a
     * name that begins the same way. Offered as a view of the shorter model it
     * would open somebody else's arrangement over this one's classes.
     */
    test('leaves alone the views of a model whose name begins the same way', async () => {
        filesystem.readDirectory.mockResolvedValue([
            ['employment.tontoview', 1],
            ['employment.core-taxonomy.tontoview', 1],
            ['employment.v2.tonto', 1],
            ['employment.v2.tontoview', 1],
            ['employment.v2.roles.tontoview', 1]
        ]);
        const model = modelUri('/workspace/employment.tonto');

        const views = await viewChoicesFor(model as never);

        expect(views.map(view => view.description)).toEqual([
            'employment.tontoview',
            'employment.core-taxonomy.tontoview'
        ]);
        // Nor is one read as a name of this model's, wherever it comes from.
        expect(viewNameFor(model as never, modelUri('/workspace/employment.v2.roles.tontoview') as never))
            .toBeUndefined();
        expect(viewNameFor(model as never, modelUri('/elsewhere/employment.roles.tontoview') as never))
            .toBeUndefined();
    });

    test('opens a document in the view it was last seen in', () => {
        const model = modelUri('/workspace/employment.tonto');
        const other = modelUri('/workspace/parties.tonto');
        const named = viewUriFor(model as never, 'core-taxonomy');
        const asked = viewUriFor(model as never, 'roles');
        const seen = new Map([[model.toString(), named as unknown as never]]);
        const showing = { document: model as never, view: named };

        // What was asked for outranks everything.
        expect(viewToShow(model as never, asked, showing, seen).path)
            .toBe('/workspace/employment.roles.tontoview');
        // Coming back to the editor from the webview keeps what is open.
        expect(viewToShow(model as never, undefined, showing, new Map()).path)
            .toBe('/workspace/employment.core-taxonomy.tontoview');
        // So does following the editor to another model and back.
        expect(viewToShow(model as never, undefined,
            { document: other as never, view: viewUriFor(other as never) }, seen).path)
            .toBe('/workspace/employment.core-taxonomy.tontoview');
        // A document nothing is known about opens in its default view.
        expect(viewToShow(other as never, undefined, showing, seen).path)
            .toBe('/workspace/parties.tontoview');
    });

    test('checks whether a proposed named view already exists', async () => {
        expect(await viewFileExists(modelUri('/workspace/missing.tontoview') as never)).toBe(false);
        filesystem.stat.mockResolvedValue({ type: 1 });
        expect(await viewFileExists(modelUri('/workspace/present.tontoview') as never)).toBe(true);
    });
});
