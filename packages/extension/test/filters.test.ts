import { describe, expect, test } from 'vitest';
import type { ViewModel, ViewRelation } from 'tonto-view';
import { filterItemsOf, filterView } from '../src/filters.js';

function relation(id: string, source: string, target: string, name?: string): ViewRelation {
    return {
        kind: 'relation', id, source, target,
        ...(name ? { name } : {}),
        sourceEnd: { isConst: false, isAddOnly: false },
        targetEnd: { isConst: false, isAddOnly: false }
    };
}

function model(edges: ViewRelation[]): ViewModel {
    return {
        groups: [], gensets: [], edges,
        nodes: ['Person', 'Organization'].map(name => ({
            id: `Sample::${name}`,
            kind: 'class' as const,
            name,
            package: 'Sample',
            color: '#eee',
            isExternal: false,
            attributes: []
        }))
    };
}

describe('class and association filters', () => {
    test('lists classes and gives an association a readable label', () => {
        const items = filterItemsOf(model([
            relation('works-for', 'Sample::Person', 'Sample::Organization', 'worksFor')
        ]));

        expect(items.filter(item => item.kind === 'class').map(item => item.label))
            .toEqual(['Sample::Organization', 'Sample::Person']);
        expect(items.find(item => item.kind === 'association')).toEqual({
            kind: 'association',
            ids: ['works-for'],
            label: 'Sample::Person — worksFor — Sample::Organization'
        });
    });

    test('represents inverse declarations as one association filter', () => {
        const forward = relation('has-employer', 'Sample::Person', 'Sample::Organization', 'hasEmployer');
        const inverse = relation('has-employees', 'Sample::Organization', 'Sample::Person', 'hasEmployees');
        forward.inverseOf = inverse.id;
        inverse.inverseOf = forward.id;

        const associations = filterItemsOf(model([forward, inverse]))
            .filter(item => item.kind === 'association');

        expect(associations).toHaveLength(1);
        expect(associations[0]!.ids).toEqual(expect.arrayContaining(['has-employer', 'has-employees']));
        expect(associations[0]!.label).toContain('hasEmployer');
        expect(associations[0]!.label).toContain('hasEmployees');
    });

    test('distinguishes otherwise identical associations', () => {
        const associations = filterItemsOf(model([
            relation('works-for', 'Sample::Person', 'Sample::Organization', 'worksFor'),
            relation('works-for#2', 'Sample::Person', 'Sample::Organization', 'worksFor')
        ])).filter(item => item.kind === 'association');

        expect(associations.map(item => item.label)).toEqual([
            'Sample::Person — worksFor — Sample::Organization (1 of 2)',
            'Sample::Person — worksFor — Sample::Organization (2 of 2)'
        ]);
        expect(associations.map(item => item.ids)).toEqual([['works-for'], ['works-for#2']]);
    });

    test('filters a cached view without leaving dangling edges or group members', () => {
        const view = model([relation('works-for', 'Sample::Person', 'Sample::Organization', 'worksFor')]);
        view.groups = [{
            id: 'pkg:Sample', name: 'Sample', isExternal: false,
            nodes: ['Sample::Person', 'Sample::Organization']
        }];

        const filtered = filterView(view, ['Sample::Person']);

        expect(filtered.nodes.map(node => node.id)).toEqual(['Sample::Organization']);
        expect(filtered.edges).toEqual([]);
        expect(filtered.groups[0]?.nodes).toEqual(['Sample::Organization']);
    });

    test('unpairs the surviving half of a malformed single-id inverse filter', () => {
        const forward = relation('has-employer', 'Sample::Person', 'Sample::Organization', 'hasEmployer');
        const inverse = relation('has-employees', 'Sample::Organization', 'Sample::Person', 'hasEmployees');
        forward.inverseOf = inverse.id;
        inverse.inverseOf = forward.id;

        const filtered = filterView(model([forward, inverse]), [forward.id]);

        expect(filtered.edges).toHaveLength(1);
        expect(filtered.edges[0]).not.toHaveProperty('inverseOf');
        expect(filtered.edges[0]?.id).toBe(inverse.id);
    });
});
