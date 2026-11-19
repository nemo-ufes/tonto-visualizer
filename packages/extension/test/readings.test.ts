import { beforeEach, describe, expect, test, vi } from 'vitest';

const filesystem = vi.hoisted(() => ({
    files: new Map<string, Uint8Array>(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    createDirectory: vi.fn()
}));

vi.mock('vscode', () => {
    const uri = (path: string) => ({ path, toString: () => `file://${path}` });
    return {
        Uri: { joinPath: (base: { path: string }, ...parts: string[]) => uri([base.path, ...parts].join('/')) },
        workspace: { fs: filesystem }
    };
});

import { Readings } from '../src/readings.js';

const reading = (id: string) => ({
    nodes: [{ id, kind: 'class' as const, stereotype: 'kind', source: { uri: 'file:///m/a.tonto', line: 2, character: 0 } }],
    edges: [],
    gensets: []
});

describe('the readings kept between sessions', () => {
    beforeEach(() => {
        filesystem.files.clear();
        filesystem.readFile.mockReset().mockImplementation(async (target: { path: string }) => {
            const bytes = filesystem.files.get(target.path);
            if (!bytes) {
                throw new Error('not found');
            }
            return bytes;
        });
        filesystem.writeFile.mockReset().mockImplementation(async (target: { path: string }, bytes: Uint8Array) => {
            filesystem.files.set(target.path, bytes);
        });
        filesystem.createDirectory.mockReset().mockResolvedValue(undefined);
    });

    test('gives back the last reading kept for a root, and none for another', async () => {
        const readings = new Readings({ path: '/storage/readings' } as never);
        await readings.write('/m', reading('S::Person'));
        await readings.write('/m', reading('S::Human'));
        await readings.write('/other', reading('T::Goods'));

        expect((await readings.read('/m'))?.nodes.map(node => node.id)).toEqual(['S::Human']);
        expect(await readings.read('/elsewhere')).toBeUndefined();
        expect([...filesystem.files.keys()].every(path => path.startsWith('/storage/readings/'))).toBe(true);
    });

    test('has none to give before one is kept, or when it cannot be read', async () => {
        const readings = new Readings({ path: '/storage/readings' } as never);
        expect(await readings.read('/m')).toBeUndefined();
        await readings.write('/m', reading('S::Person'));
        const [path] = [...filesystem.files.keys()];
        filesystem.files.set(path!, Buffer.from('{ broken'));
        expect(await readings.read('/m')).toBeUndefined();
    });
});
