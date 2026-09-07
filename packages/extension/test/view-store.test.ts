import { beforeEach, describe, expect, test, vi } from 'vitest';

const filesystem = vi.hoisted(() => ({
    readFile: vi.fn(),
    writeFile: vi.fn()
}));

vi.mock('vscode', () => ({ workspace: { fs: filesystem } }));

import { ViewStore } from '../src/view-store.js';

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
        filesystem.readFile.mockRejectedValue(new Error('not found'));
        filesystem.writeFile.mockResolvedValue(undefined);
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
});
