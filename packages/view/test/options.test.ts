import { describe, expect, test } from 'vitest';
import {
    clampAssociationDistance, contentAfter, defaultContentOptions, packagesInScope
} from '../src/options.js';

const workspace = { file: ['Employment'], workspace: ['Employment', 'Parties'] };

describe('the packages a view is drawn from', () => {

    test('is what the opened file declares, or the whole workspace', () => {
        expect(packagesInScope({ scope: 'file' }, workspace)).toEqual(['Employment']);
        expect(packagesInScope({ scope: 'workspace' }, workspace)).toEqual(['Employment', 'Parties']);
    });

    test('is what the modeller ticked, whichever scope they ticked it in', () => {
        expect(packagesInScope({ scope: 'file', includedPackages: ['Parties'] }, workspace)).toEqual(['Parties']);
        expect(packagesInScope({ scope: 'workspace', includedPackages: [] }, workspace)).toEqual([]);
    });

    /**
     * A file that declares nothing yet draws nothing, rather than everything:
     * a diagram that filled itself with the workspace while a new file was
     * being started would be a different diagram every few keystrokes.
     */
    test('is empty when the file scope has no package to name', () => {
        expect(packagesInScope({ scope: 'file' }, { file: [], workspace: ['Parties'] })).toEqual([]);
    });
});

describe('a change to the content options', () => {

    test('gives the ticked packages back to the scope when the scope changes', () => {
        const picked = { ...defaultContentOptions, includedPackages: ['Parties'] };
        expect(contentAfter(picked, { scope: 'workspace' }))
            .toEqual({ ...defaultContentOptions, scope: 'workspace' });
    });

    test('leaves them alone when the scope is not what changed', () => {
        const picked = { ...defaultContentOptions, includedPackages: ['Parties'] };
        expect(contentAfter(picked, { showDatatypes: false }))
            .toEqual({ ...picked, showDatatypes: false });
        expect(contentAfter(picked, { scope: picked.scope })).toEqual(picked);
        expect(contentAfter(picked, { includedPackages: ['Parties', 'Employment'] }).includedPackages)
            .toEqual(['Parties', 'Employment']);
    });
});

describe('association distance', () => {
    test('stays inside the toolbar range', () => {
        expect(clampAssociationDistance(20)).toBe(60);
        expect(clampAssociationDistance(120)).toBe(120);
        expect(clampAssociationDistance(400)).toBe(180);
    });
});
