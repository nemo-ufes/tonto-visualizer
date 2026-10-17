import { beforeEach, describe, expect, test, vi } from 'vitest';

const filesystem = vi.hoisted(() => ({
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createDirectory: vi.fn(),
    readDirectory: vi.fn(),
    stat: vi.fn()
}));

vi.mock('vscode', () => ({
    FileType: { File: 1, Directory: 2 },
    workspace: { fs: filesystem }
}));

import {
    ViewStore, viewChoicesFor, viewFileExists, viewNameFor, viewNameOf, viewUriFor
} from '../src/view-store.js';

function modelUri(path = '/workspace/model.tonto') {
    return {
        path,
        with(change: { path: string }) {
            return modelUri(change.path);
        }
    };
}

describe('the view store', () => {
    beforeEach(() => {
        filesystem.readFile.mockReset();
        filesystem.writeFile.mockReset();
        filesystem.createDirectory.mockReset();
        filesystem.readFile.mockRejectedValue(new Error('not found'));
        filesystem.writeFile.mockResolvedValue(undefined);
        filesystem.createDirectory.mockResolvedValue(undefined);
        filesystem.readDirectory.mockResolvedValue([]);
        filesystem.stat.mockRejectedValue(new Error('not found'));
    });

    test('flushes a pending arrangement when it is disposed', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', true);
        store.begin('Move');
        store.move({ 'Sample::Person': { x: 24, y: 48 } });

        await store.dispose();

        expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
        expect(filesystem.createDirectory.mock.calls[0]![0].path).toBe('/workspace/views');
        expect(filesystem.writeFile.mock.calls[0]![0].path).toBe('/workspace/views/model.tontoview');
        const bytes = filesystem.writeFile.mock.calls[0]![1] as Uint8Array;
        expect(JSON.parse(Buffer.from(bytes).toString('utf8')).nodes).toEqual({
            'Sample::Person': { x: 24, y: 48 }
        });
    });

    test('writes to where its file was moved once it is relocated', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', true);
        store.relocate(modelUri('/workspace/views/renamed.tontoview') as never);
        store.begin('Move');
        store.move({ 'Sample::Person': { x: 24, y: 48 } });

        await store.dispose();

        expect(filesystem.writeFile.mock.calls.map(call => call[0].path)).toEqual(['/workspace/views/renamed.tontoview']);
    });

    test('does not create a view file for an untouched automatic layout', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', true);

        // Automatic layout and reconciliation deliberately happen outside a
        // user step. They populate the state a later edit will save, but are
        // not themselves a reason to create a document.
        store.move({ 'Sample::Person': { x: 24, y: 48 } });
        store.reroute('works-for', { points: [{ x: 0, y: 0 }, { x: 24, y: 48 }] });
        await store.dispose();

        expect(filesystem.createDirectory).not.toHaveBeenCalled();
        expect(filesystem.writeFile).not.toHaveBeenCalled();
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

    test('normalizes a human name into a stable filename under views', () => {
        expect(viewNameOf('  Core Taxonomy  ')).toBe('core-taxonomy');
        expect(viewNameOf('Relações & Papéis')).toBe('relacoes-papeis');
        expect(viewNameOf('---')).toBeUndefined();
        const uri = viewUriFor(modelUri('/workspace/employment.tonto') as never, 'core-taxonomy');
        expect(uri.path).toBe('/workspace/views/employment.core-taxonomy.tontoview');
        expect(viewNameFor(modelUri('/workspace/employment.tonto') as never, uri as never))
            .toBe('core-taxonomy');
        expect(viewNameFor(
            modelUri('/workspace/employment.tonto') as never,
            modelUri('/workspace/employment.roles.tontoview') as never
        )).toBe('roles');
    });

    test('discovers only the named views belonging to the exact model', async () => {
        filesystem.readDirectory.mockImplementation(async (uri: { path: string }) => uri.path.endsWith('/views')
            ? [
                ['employment.roles.tontoview', 1],
                ['employment.tontoview', 1],
                ['employment.core-taxonomy.tontoview', 1],
                ['employment-relations.tontoview', 1],
                ['employment.notes.txt', 1],
                ['employment.draft.tontoview', 2]
            ]
            // A legacy name is still discovered, but points at its migration target.
            : [['employment.people.tontoview', 1]]);

        const views = await viewChoicesFor(modelUri('/workspace/employment.tonto') as never);

        expect(views.map(view => [view.label, view.description])).toEqual([
            ['Default view', 'views/employment.tontoview'],
            ['core taxonomy', 'views/employment.core-taxonomy.tontoview'],
            ['people', 'views/employment.people.tontoview'],
            ['roles', 'views/employment.roles.tontoview']
        ]);
    });

    test('reads a legacy sibling and migrates it only after a user change', async () => {
        const legacy = {
            version: 1,
            focus: 'Sample',
            nodes: { 'Sample::Person': { x: 12, y: 34 } }
        };
        filesystem.readFile.mockImplementation(async (uri: { path: string }) => {
            if (uri.path === '/workspace/model.tontoview') {
                return Buffer.from(JSON.stringify(legacy));
            }
            throw new Error('not found');
        });
        const store = await ViewStore.open(modelUri() as never, 'Sample', true);

        expect(store.state.nodes['Sample::Person']).toEqual({ x: 12, y: 34 });
        await store.write();
        expect(filesystem.writeFile).not.toHaveBeenCalled();

        store.begin('Move');
        store.move({ 'Sample::Person': { x: 56, y: 78 } });
        await store.dispose();

        expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
        expect(filesystem.writeFile.mock.calls[0]![0].path).toBe('/workspace/views/model.tontoview');
    });

    test('copies the complete current diagram into a named view even when autosave is off', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', false);
        store.move({ 'Sample::Person': { x: 24, y: 48 } });
        store.update({ content: { ...store.state.content, hidden: ['Sample::Employee'] } });

        await store.copyTo(viewUriFor(modelUri() as never, 'people'));

        expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
        const [uri, bytes] = filesystem.writeFile.mock.calls[0]!;
        expect(uri.path).toBe('/workspace/views/model.people.tontoview');
        expect(JSON.parse(Buffer.from(bytes as Uint8Array).toString('utf8'))).toMatchObject({
            focus: 'Sample',
            nodes: { 'Sample::Person': { x: 24, y: 48 } },
            content: { hidden: ['Sample::Employee'] }
        });
    });

    test('checks whether a proposed named view already exists', async () => {
        expect(await viewFileExists(modelUri('/workspace/missing.tontoview') as never)).toBe(false);
        filesystem.stat.mockResolvedValue({ type: 1 });
        expect(await viewFileExists(modelUri('/workspace/present.tontoview') as never)).toBe(true);
    });

    test('recognizes a legacy sibling before replacing a named view', async () => {
        filesystem.stat.mockImplementation(async (uri: { path: string }) => {
            if (uri.path === '/workspace/model.people.tontoview') {
                return { type: 1 };
            }
            throw new Error('not found');
        });

        expect(await viewFileExists(viewUriFor(modelUri() as never, 'people'))).toBe(true);
    });
});
