import { describe, expect, test } from 'vitest';
import type { ViewEdge, ViewModel } from 'tonto-view';
import { partonomyView, wholePartOf } from '../src/partonomy.js';

const end = (isWhole = false) => ({ isConst: false, isAddOnly: false, ...(isWhole ? { isWhole } : {}) });

function relation(id: string, source: string, target: string, stereotype: string, whole?: 'source' | 'target'): ViewEdge {
    return {
        kind: 'relation', id, source, target, stereotype, ...(whole ? { whole } : {}),
        sourceEnd: end(whole === 'source'), targetEnd: end(whole === 'target')
    };
}

function specializes(source: string, target: string): ViewEdge {
    return { kind: 'generalization', id: `gen:${source}->${target}`, source, target };
}

/**
 * The motorcycle's wheels as the role pattern writes them: each part a role
 * of some kind and of a generic `Component`, a part of a generic `System`.
 */
function wheels(): ViewModel {
    const names = [
        'System', 'Component', 'Motorcycle', 'WheelAssembly', 'MotorcycleWheel',
        'FrontMotorcycleWheel', 'RearMotorcycleWheel', 'WheelRim', 'Frame', 'PortionOfSteel'
    ];
    return {
        groups: [],
        nodes: names.map(name => ({
            id: name, kind: 'class' as const, name, package: 'motorcycle', stereotype: 'role',
            color: '#FFDADD', isExternal: false, attributes: []
        })),
        edges: [
            relation('hasProperPart', 'System', 'Component', 'componenthood', 'source'),
            relation('hasWheel', 'Motorcycle', 'MotorcycleWheel', 'componenthood', 'source'),
            relation('hasFrontWheel', 'Motorcycle', 'FrontMotorcycleWheel', 'componenthood', 'source'),
            // Written part-first, as the language allows.
            relation('hasRearWheel', 'RearMotorcycleWheel', 'Motorcycle', 'componenthood', 'target'),
            relation('hasRim', 'MotorcycleWheel', 'WheelRim', 'componenthood', 'source'),
            relation('isConstitutedOf', 'Frame', 'PortionOfSteel', 'constitution'),
            specializes('Motorcycle', 'System'),
            specializes('MotorcycleWheel', 'WheelAssembly'),
            specializes('MotorcycleWheel', 'Component'),
            specializes('WheelRim', 'Component'),
            specializes('FrontMotorcycleWheel', 'MotorcycleWheel'),
            specializes('RearMotorcycleWheel', 'MotorcycleWheel')
        ],
        gensets: [{
            id: 'positions', name: 'motorcycleWheelPositions', disjoint: true, complete: true,
            general: 'MotorcycleWheel', specifics: ['FrontMotorcycleWheel', 'RearMotorcycleWheel'], categorizers: []
        }]
    };
}

describe('a partonomy-only view', () => {
    test('reads the whole of a parthood from the language, and of a constitution from its direction', () => {
        const edges = wheels().edges;
        const of = (id: string) => wholePartOf(edges.find(edge => edge.id === id)!);
        expect(of('hasRearWheel')).toEqual({ whole: 'Motorcycle', part: 'RearMotorcycleWheel' });
        expect(of('isConstitutedOf')).toEqual({ whole: 'Frame', part: 'PortionOfSteel' });
        expect(of('gen:WheelRim->Component')).toBeUndefined();
    });

    test('keeps the specializations through which parts inherit their place, and no others', () => {
        const kept = partonomyView(wheels()).edges.map(edge => edge.id);

        expect(kept).toEqual(expect.arrayContaining([
            'hasProperPart', 'hasWheel', 'hasFrontWheel', 'hasRearWheel', 'hasRim', 'isConstitutedOf',
            // A front wheel has a rim because a motorcycle wheel does.
            'gen:FrontMotorcycleWheel->MotorcycleWheel',
            'gen:RearMotorcycleWheel->MotorcycleWheel',
            // And a motorcycle has proper parts because a system does.
            'gen:Motorcycle->System'
        ]));
        // The kind a role is played by says what a part is, not what the
        // whole is made of; and a generic `Component` that every part
        // specializes would draw one more line from each part to it.
        expect(kept).not.toContain('gen:MotorcycleWheel->WheelAssembly');
        expect(kept).not.toContain('gen:MotorcycleWheel->Component');
        expect(kept).not.toContain('gen:WheelRim->Component');
    });

    test('keeps two parts of one whole joined when one specializes the other', () => {
        const view = wheels();
        // Without its rim, the wheel is a part and not a whole: the
        // specialization still says the front wheel is one of the two
        // wheels, not a third.
        view.edges = view.edges.filter(edge => edge.id !== 'hasRim');
        expect(partonomyView(view).edges.map(edge => edge.id))
            .toContain('gen:FrontMotorcycleWheel->MotorcycleWheel');
    });

    test('keeps a generalization set only while all its specializations are drawn', () => {
        expect(partonomyView(wheels()).gensets.map(genset => genset.id)).toEqual(['positions']);

        const view = wheels();
        view.edges = view.edges.filter(edge => edge.id !== 'hasRearWheel');
        expect(partonomyView(view).gensets).toEqual([]);
    });
});
