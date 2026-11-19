import { beforeEach, describe, expect, test, vi } from 'vitest';

const filesystem = vi.hoisted(() => ({
    files: new Map<string, string>(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readDirectory: vi.fn()
}));

vi.mock('vscode', () => {
    const uri = (path: string) => ({ path, toString: () => `file://${path}` });
    return {
        FileType: { File: 1, Directory: 2 },
        Uri: { joinPath: (base: { path: string }, ...parts: string[]) => uri([base.path, ...parts].join('/')) },
        window: { showErrorMessage: vi.fn() },
        workspace: { fs: filesystem }
    };
});

import { ViewRenames } from '../src/view-renames.js';

const uri = (path: string) => ({ path, toString: () => `file://${path}` }) as never;

const renames = (from: string, to: string) => ({
    nodes: new Map([[from, to]]),
    edges: new Map<string, string>(),
    gensets: new Map<string, string>()
});

function written(path: string): unknown {
    const call = filesystem.writeFile.mock.calls.find(([target]) => target.path === path);
    return call ? JSON.parse(Buffer.from(call[1] as Uint8Array).toString('utf8')) : undefined;
}

describe('renames carried into the views that are not open', () => {
    beforeEach(() => {
        filesystem.files = new Map([
            ['/model/views/society.tontoview', JSON.stringify({ nodes: { 'Society::Person': { x: 1, y: 1 } } })],
            ['/model/views/society.roles.tontoview', JSON.stringify({
                display: { routing: 'curved' },
                nodes: { 'Society::Person': { x: 2, y: 2 } },
                edges: { 'gen:Society::Wife->Society::Person': { labelOffset: { x: 3, y: 3 } } },
                content: { hidden: ['Society::Person'] }
            })],
            ['/model/views/trade.tontoview', JSON.stringify({ nodes: { 'Trade::Goods': { x: 4, y: 4 } } })],
            ['/model/views/broken.tontoview', '{ not json']
        ]);
        filesystem.readFile.mockReset().mockImplementation(async (target: { path: string }) => {
            const text = filesystem.files.get(target.path);
            if (text === undefined) {
                throw new Error('not found');
            }
            return Buffer.from(text, 'utf8');
        });
        filesystem.writeFile.mockReset().mockResolvedValue(undefined);
        filesystem.readDirectory.mockReset().mockImplementation(async (directory: { path: string }) => {
            const names = [...filesystem.files.keys()]
                .filter(path => path.startsWith(`${directory.path}/`) && !path.slice(directory.path.length + 1).includes('/'))
                .map(path => [path.slice(directory.path.length + 1), 1]);
            if (names.length === 0) {
                throw new Error('not found');
            }
            return names;
        });
    });

    test('renames every other view of the model, and leaves the open one to its store', async () => {
        const queue = new ViewRenames();
        queue.add(renames('Society::Person', 'Society::Human'), [uri('/model'), uri('/model/views')],
            uri('/model/views/society.tontoview'));
        await queue.flush();

        expect(written('/model/views/society.tontoview')).toBeUndefined();
        expect(written('/model/views/society.roles.tontoview')).toEqual({
            display: { routing: 'curved' },
            nodes: { 'Society::Human': { x: 2, y: 2 } },
            edges: { 'gen:Society::Wife->Society::Human': { labelOffset: { x: 3, y: 3 } } },
            content: { hidden: ['Society::Human'] }
        });
        // Nothing renamed in it, or not a view that can be read: not touched.
        expect(written('/model/views/trade.tontoview')).toBeUndefined();
        expect(written('/model/views/broken.tontoview')).toBeUndefined();
    });

    test('writes a name typed a letter at a time once, as it ended up', async () => {
        const queue = new ViewRenames();
        const open = uri('/model/views/society.roles.tontoview');
        queue.add(renames('Society::Person', 'Society::Perso'), [uri('/model/views')], open);
        queue.add(renames('Society::Perso', 'Society::Human'), [uri('/model/views'), uri('/model/views')], open);
        await queue.flush();

        expect(filesystem.writeFile).toHaveBeenCalledTimes(1);
        expect(written('/model/views/society.tontoview')).toEqual({ nodes: { 'Society::Human': { x: 1, y: 1 } } });
    });

    test('has nothing to write when nothing was renamed', async () => {
        await new ViewRenames().flush();
        expect(filesystem.readDirectory).not.toHaveBeenCalled();
    });
});
