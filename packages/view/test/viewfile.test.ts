import { describe, expect, test } from 'vitest';
import { defaultContentOptions, defaultDisplayOptions, defaultLayoutOptions } from '../src/options.js';
import { readViewFile } from '../src/viewfile.js';

describe('view file options', () => {
    test('replaces malformed persisted option fields with defaults', () => {
        const view = readViewFile({
            content: {
                scope: 'everything',
                showExternalReferences: 'yes',
                showDatatypes: 0,
                showGensets: null,
                includedPackages: ['Package', 1],
                hidden: 'Sample::Person'
            },
            display: {
                routing: 'curved',
                showAttributes: 'false',
                showLegend: 1
            },
            layout: {
                // Written by older versions; no longer part of the options.
                algorithm: 'unknown',
                direction: 'UP',
                nodeSpacing: -1,
                rankSpacing: '100',
                groupByPackage: 'true'
            }
        });

        expect(view.content).toEqual(defaultContentOptions);
        expect(view.display).toEqual(defaultDisplayOptions);
        expect(view.layout).toEqual(defaultLayoutOptions);
        expect(view.constraints).toEqual({ pinned: [] });
    });

    test('retains valid optional arrays and explicit false values', () => {
        const view = readViewFile({
            content: {
                scope: 'workspace',
                showExternalReferences: false,
                showDatatypes: false,
                showGensets: false,
                includedPackages: [],
                hidden: ['Sample::Person', 'works-for']
            },
            display: { taxonomyOnly: true, showLegend: true, routing: 'orthogonal' },
            layout: {
                // Legacy engine choices are ignored in favour of taxonomy layout.
                algorithm: 'stress', direction: 'RIGHT', nodeSpacing: 0,
                rankSpacing: 120, groupByPackage: false
            },
            constraints: { pinned: ['Sample::Person'] }
        });

        expect(view.content).toEqual({
            scope: 'workspace',
            showExternalReferences: false,
            showDatatypes: false,
            showGensets: false,
            includedPackages: [],
            hidden: ['Sample::Person', 'works-for']
        });
        expect(view.display).toEqual({
            ...defaultDisplayOptions,
            taxonomyOnly: true,
            showLegend: true,
            routing: 'orthogonal'
        });
        expect(view.layout).toEqual({
            direction: 'RIGHT', nodeSpacing: 0,
            rankSpacing: 120, groupByPackage: false
        });
        expect(view.constraints).toEqual({ pinned: ['Sample::Person'] });
    });
});
