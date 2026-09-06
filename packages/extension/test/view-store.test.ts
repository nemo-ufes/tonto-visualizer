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

    test('starts with the nature-colour legend hidden', async () => {
        const store = await ViewStore.open(modelUri() as never, 'Sample', true);

        expect(store.state.display.showLegend).toBe(false);
        await store.dispose();
    });
});
