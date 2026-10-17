import { beforeEach, describe, expect, test, vi } from 'vitest';

/** A disk of files, by path; a directory is whatever a file's path passes through. */
const disk = vi.hoisted(() => new Set<string>());

vi.mock('vscode', () => {
    const File = 1;
    const Directory = 2;
    return {
        FileType: { File, Directory },
        workspace: {
            fs: {
                async stat(uri: { path: string }) {
                    if (disk.has(uri.path)) {
                        return { type: File };
                    }
                    if ([...disk].some(path => path.startsWith(`${uri.path}/`))) {
                        return { type: Directory };
                    }
                    throw new Error('not found');
                },
                async readDirectory(uri: { path: string }) {
                    const prefix = uri.path.endsWith('/') ? uri.path : `${uri.path}/`;
                    const entries = new Map<string, number>();
                    for (const path of disk) {
                        if (path.startsWith(prefix)) {
                            const rest = path.slice(prefix.length);
                            entries.set(rest.split('/')[0]!, rest.includes('/') ? Directory : File);
                        }
                    }
                    if (entries.size === 0) {
                        throw new Error('not found');
                    }
                    return [...entries];
                }
            }
        }
    };
});

import { viewNameIn, viewRenamesFor } from '../src/rename.js';

function uri(path: string) {
    return {
        path,
        with(change: { path: string }) {
            return uri(change.path);
        },
        toString() {
            return `file://${path}`;
        }
    };
}

async function plan(from: string, to: string) {
    const result = await viewRenamesFor(uri(from) as never, uri(to) as never);
    return {
        moves: result.moves.map(move => [move.from.path, move.to.path]),
        blocked: result.blocked.map(one => one.path)
    };
}

describe('renaming a model', () => {
    beforeEach(() => {
        disk.clear();
    });

    test('takes its default and named views to the new name', async () => {
        disk.add('/m/person.tonto');
        disk.add('/m/views/person.tontoview');
        disk.add('/m/views/person.roles.tontoview');
        disk.add('/m/views/other.tontoview');
        expect(await plan('/m/person.tonto', '/m/people.tonto')).toEqual({
            moves: [
                ['/m/views/person.tontoview', '/m/views/people.tontoview'],
                ['/m/views/person.roles.tontoview', '/m/views/people.roles.tontoview']
            ],
            blocked: []
        });
    });

    test('takes them into the views folder beside a model moved to another folder', async () => {
        disk.add('/m/person.tonto');
        disk.add('/m/views/person.tontoview');
        expect((await plan('/m/person.tonto', '/m/parties/person.tonto')).moves).toEqual([
            ['/m/views/person.tontoview', '/m/parties/views/person.tontoview']
        ]);
    });

    test('leaves the views of a model whose name only starts the same way', async () => {
        disk.add('/m/a.tonto');
        disk.add('/m/a.roles.tonto');
        disk.add('/m/ab.tonto');
        disk.add('/m/views/a.tontoview');
        // The default view of `a.roles.tonto`, not a view of `a` named "roles".
        disk.add('/m/views/a.roles.tontoview');
        disk.add('/m/views/a.roles.core.tontoview');
        disk.add('/m/views/ab.tontoview');
        expect((await plan('/m/a.tonto', '/m/b.tonto')).moves).toEqual([
            ['/m/views/a.tontoview', '/m/views/b.tontoview']
        ]);
    });

    test('moves a view from before the views folder into it', async () => {
        disk.add('/m/person.tonto');
        disk.add('/m/person.tontoview');
        disk.add('/m/person.roles.tontoview');
        disk.add('/m/views/person.roles.tontoview');
        expect((await plan('/m/person.tonto', '/m/people.tonto')).moves).toEqual([
            // The folder's copy is the one read, so it is the one that moves.
            ['/m/views/person.roles.tontoview', '/m/views/people.roles.tontoview'],
            ['/m/person.tontoview', '/m/views/people.tontoview']
        ]);
    });

    test('does not overwrite a view the new name already has', async () => {
        disk.add('/m/person.tonto');
        disk.add('/m/views/person.tontoview');
        disk.add('/m/views/people.tontoview');
        expect(await plan('/m/person.tonto', '/m/people.tonto')).toEqual({
            moves: [],
            blocked: ['/m/views/person.tontoview']
        });
    });

    test('moves the view of a rename that changes only the case', async () => {
        disk.add('/m/Person.tonto');
        disk.add('/m/views/Person.tontoview');
        // On a case-insensitive disk the new name already "exists": it is this file.
        disk.add('/m/views/person.tontoview');
        expect((await plan('/m/Person.tonto', '/m/person.tonto')).moves).toEqual([
            ['/m/views/Person.tontoview', '/m/views/person.tontoview']
        ]);
    });

    test('takes nothing along for a folder, or a file that is not a model on both sides', async () => {
        disk.add('/m/models/person.tonto');
        disk.add('/m/models/views/person.tontoview');
        disk.add('/m/notes.tonto');
        disk.add('/m/views/notes.tontoview');
        expect((await plan('/m/models', '/m/ontology')).moves).toEqual([]);
        expect((await plan('/m/notes.tonto', '/m/notes.txt')).moves).toEqual([]);
    });
});

describe('the view name in a filename', () => {
    test('is the default, a dotless name, or not a view of the model', () => {
        expect(viewNameIn('person.tontoview', 'person')).toBeUndefined();
        expect(viewNameIn('person.roles.tontoview', 'person')).toBe('roles');
        expect(viewNameIn('person.roles.core.tontoview', 'person')).toBeNull();
        expect(viewNameIn('personal.tontoview', 'person')).toBeNull();
        expect(viewNameIn('person.tonto', 'person')).toBeNull();
    });
});
