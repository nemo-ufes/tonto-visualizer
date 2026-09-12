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
                fontFamily: 'comic-sans',
                fontSize: 42,
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
        expect(view.constraints).toEqual({ pinned: [], alignments: [], distributions: [] });
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
            display: {
                taxonomyOnly: true, showLegend: true, routing: 'orthogonal',
                fontFamily: 'monospace', fontSize: 'large'
            },
            layout: {
                // Legacy engine choices are ignored in favour of taxonomy layout.
                algorithm: 'stress', direction: 'RIGHT', nodeSpacing: 0,
                rankSpacing: 120, groupByPackage: false
            },
            constraints: {
                pinned: ['Sample::Person'],
                alignments: [{ axis: 'x', nodes: ['Sample::Person', 'Sample::Employee'] }],
                distributions: [{
                    axis: 'y', nodes: ['Sample::Person', 'Sample::Employee', 'Sample::Manager']
                }]
            }
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
            routing: 'orthogonal',
            fontFamily: 'monospace',
            fontSize: 'large'
        });
        expect(view.layout).toEqual({
            direction: 'RIGHT', nodeSpacing: 0,
            rankSpacing: 120, maxRankSpan: defaultLayoutOptions.maxRankSpan, groupByPackage: false
        });
        expect(view.constraints).toEqual({
            pinned: ['Sample::Person'],
            alignments: [{ axis: 'x', nodes: ['Sample::Person', 'Sample::Employee'] }],
            distributions: [{
                axis: 'y', nodes: ['Sample::Person', 'Sample::Employee', 'Sample::Manager']
            }]
        });
    });

    test('retains the expanded diagram typeface choices', () => {
        for (const fontFamily of ['condensed', 'humanist', 'geometric', 'book'] as const) {
            expect(readViewFile({ display: { fontFamily } }).display.fontFamily).toBe(fontFamily);
        }
    });
});
