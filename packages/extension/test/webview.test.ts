// @vitest-environment happy-dom

import { beforeAll, describe, expect, test, vi } from 'vitest';
import type { ViewModel } from 'tonto-view';
import { defaultContentOptions, defaultDisplayOptions, defaultLayoutOptions } from 'tonto-view';

const messages: unknown[] = [];

const view: ViewModel = {
    groups: [],
    gensets: [],
    nodes: [
        {
            id: 'Sample::Person', kind: 'class', name: 'Person', package: 'Sample',
            color: '#eee', isExternal: false, attributes: []
        },
        {
            id: 'Sample::Organization', kind: 'class', name: 'Organization', package: 'Sample',
            color: '#eee', isExternal: false, attributes: []
        }
    ],
    edges: [
        {
            kind: 'relation', id: 'works-for', source: 'Sample::Person', target: 'Sample::Organization',
            name: 'worksFor',
            sourceEnd: { isConst: false, isAddOnly: false },
            targetEnd: { isConst: false, isAddOnly: false }
        },
        {
            kind: 'relation', id: 'employs', source: 'Sample::Organization', target: 'Sample::Person',
            name: 'employs',
            sourceEnd: { isConst: false, isAddOnly: false },
            targetEnd: { isConst: false, isAddOnly: false }
        }
    ]
};

function panelHtml(): string {
    return `<div id="shell">
        <div id="toolbar">
            <button id="fit"></button><button id="arrange"></button><button id="newWindow"></button>
            <button id="distanceDown"></button><span id="distance"></span><button id="distanceUp"></button><button id="views"></button>
            <button id="zoomOut"></button><span id="scale"></span><button id="zoomIn"></button>
            <button id="hide" disabled></button><button id="optionsButton"></button><button id="exportButton"></button>
            <span id="stale" hidden></span>
        </div>
        <div id="options" hidden></div>
        <div id="viewport"><div id="canvas"></div></div>
        <div id="legend" hidden></div>
    </div>`;
}

function sendModel(hidden: string[] = [], stale?: string, fit = false): void {
    const visibleNodes = view.nodes.filter(node => !hidden.includes(node.id));
    const visible = new Set(visibleNodes.map(node => node.id));
    window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'model',
        view: {
            ...view,
            nodes: visibleNodes,
            edges: view.edges.filter(edge =>
                !hidden.includes(edge.id) && visible.has(edge.source) && visible.has(edge.target))
        },
        positions: Object.fromEntries(visibleNodes.map((node, index) => [node.id, {
            x: index * 240, y: 0, width: 160, height: 60
        }])),
        routes: {},
        display: defaultDisplayOptions,
        content: { ...defaultContentOptions, hidden },
        layout: defaultLayoutOptions,
        packages: ['Sample'],
        filters: [
            { kind: 'class', ids: ['Sample::Person'], label: 'Sample::Person' },
            { kind: 'class', ids: ['Sample::Organization'], label: 'Sample::Organization' },
            { kind: 'association', ids: ['works-for'], label: 'Sample::Person — worksFor — Sample::Organization' },
            { kind: 'association', ids: ['employs'], label: 'Sample::Organization — employs — Sample::Person' }
        ],
        ...(fit ? { fit: true } : {}),
        ...(stale ? { stale } : {})
    } }));
}

/** `Person` with a declared age phase set: two phases under one shared triangle. */
const treeSet = 'set:Sample::PersonAgePhases';

function sendTree(positions?: Record<string, { x: number; y: number; width: number; height: number }>): void {
    const clazz = (name: string, stereotype: string) => ({
        id: `Sample::${name}`, kind: 'class' as const, name, package: 'Sample',
        stereotype, color: '#eee', isExternal: false, attributes: []
    });
    const specialization = (name: string) => ({
        kind: 'generalization' as const,
        id: `gen:Sample::${name}->Sample::Person`,
        source: `Sample::${name}`, target: 'Sample::Person', genset: treeSet
    });
    window.dispatchEvent(new MessageEvent('message', { data: {
        type: 'model',
        view: {
            groups: [], gensets: [{
                id: treeSet, name: 'PersonAgePhases', disjoint: true, complete: true,
                general: 'Sample::Person', specifics: ['Sample::Child', 'Sample::Adult'], categorizers: []
            }],
            nodes: [clazz('Person', 'kind'), clazz('Child', 'phase'), clazz('Adult', 'phase')],
            edges: [specialization('Child'), specialization('Adult')]
        },
        positions: positions ?? {
            'Sample::Person': { x: 120, y: 0, width: 160, height: 42 },
            'Sample::Adult': { x: 0, y: 200, width: 120, height: 42 },
            'Sample::Child': { x: 240, y: 200, width: 120, height: 42 }
        },
        routes: {}, display: defaultDisplayOptions, content: defaultContentOptions,
        layout: defaultLayoutOptions, packages: ['Sample'], filters: [], title: 'sample.tonto'
    } }));
}

function posted(type: string): Array<Record<string, unknown>> {
    return messages.filter((message): message is Record<string, unknown> =>
        typeof message === 'object' && message !== null && (message as { type?: string }).type === type);
}

/** The options panel is a toggle, and every test after the first wants it open. */
function openOptions(): void {
    if ((document.getElementById('options') as HTMLElement).hidden) {
        document.getElementById('optionsButton')!.click();
    }
}

function chooser(label: string): HTMLSelectElement {
    const row = [...document.querySelectorAll('label.choice')].find(candidate =>
        candidate.querySelector('span')?.textContent === label);
    const select = row?.querySelector('select');
    if (!(select instanceof HTMLSelectElement)) {
        throw new Error(`no chooser named ${label}`);
    }
    return select;
}

function checkbox(label: string): HTMLInputElement {
    const row = [...document.querySelectorAll('label')].find(candidate =>
        candidate.textContent?.trim() === label);
    const input = row?.querySelector('input');
    if (!(input instanceof HTMLInputElement)) {
        throw new Error(`no checkbox named ${label}`);
    }
    return input;
}

describe('the webview and its host protocol', () => {
    beforeAll(async () => {
        document.body.innerHTML = panelHtml();
        const viewport = document.getElementById('viewport')!;
        Object.defineProperty(viewport, 'clientWidth', { value: 900, configurable: true });
        Object.defineProperty(viewport, 'clientHeight', { value: 700, configurable: true });
        Object.assign(viewport, { setPointerCapture: () => undefined });
        vi.stubGlobal('acquireVsCodeApi', () => ({
            postMessage: (message: unknown) => messages.push(message),
            getState: () => undefined,
            setState: () => undefined
        }));
        await import('../src/webview/main.js');
    });

    test('offers layout controls without a strategy choice', () => {
        sendModel();
        openOptions();

        expect(chooser('Direction').value).toBe('DOWN');
        expect(chooser('Typeface').value).toBe('sans');
        expect(chooser('Text size').value).toBe('medium');
        expect(checkbox('Cluster packages').checked).toBe(true);
        expect([...document.querySelectorAll('label.choice')]
            .some(candidate => candidate.querySelector('span')?.textContent === 'Arrangement')).toBe(false);
    });

    test('turns one hierarchy-only view off when the other is turned on', () => {
        sendModel();
        openOptions();

        const partonomy = checkbox('Partonomy only');
        partonomy.click();
        expect(posted('display').at(-1)).toEqual({
            type: 'display', display: { partonomyOnly: true, taxonomyOnly: false }
        });
        checkbox('Taxonomy only').click();
        expect(posted('display').at(-1)).toEqual({
            type: 'display', display: { taxonomyOnly: true, partonomyOnly: false }
        });
    });

    test('offers persisted typeface and text-size choices', () => {
        sendModel();
        openOptions();

        const typeface = chooser('Typeface');
        expect([...typeface.options].map(option => option.value)).toEqual([
            'sans', 'condensed', 'humanist', 'geometric', 'serif', 'book', 'monospace'
        ]);
        typeface.value = 'condensed';
        typeface.dispatchEvent(new Event('change', { bubbles: true }));
        expect(posted('display').at(-1)).toEqual({
            type: 'display', display: { fontFamily: 'condensed' }
        });

        const size = chooser('Text size');
        size.value = 'large';
        size.dispatchEvent(new Event('change', { bubbles: true }));
        expect(posted('display').at(-1)).toEqual({ type: 'display', display: { fontSize: 'large' } });
    });

    test('adjusts association distance from the toolbar and arranges again', () => {
        sendModel();
        expect(document.getElementById('distance')!.textContent).toBe('Distance 100%');

        document.getElementById('distanceUp')!.click();
        expect(document.getElementById('distance')!.textContent).toBe('Distance 120%');
        expect(posted('layout').at(-1)).toEqual({
            type: 'layout', layout: { associationDistance: 120 }
        });

        document.getElementById('distanceDown')!.click();
        expect(document.getElementById('distance')!.textContent).toBe('Distance 100%');
        expect(posted('layout').at(-1)).toEqual({
            type: 'layout', layout: { associationDistance: 100 }
        });
    });

    test('does not show layout constraints in settings', () => {
        sendModel();
        openOptions();
        expect(document.getElementById('options')?.textContent).not.toContain('Constraints');
        expect(document.getElementById('options')?.textContent).not.toContain('Pin selected');
    });

    test('offers all three derived material display modes', () => {
        sendModel();
        openOptions();
        const row = [...document.querySelectorAll('label.row.choice')]
            .find(candidate => candidate.textContent?.includes('Derived material'));
        const select = row?.querySelector('select');

        expect([...select!.options].map(option => option.textContent)).toEqual([
            'Relator and derived relations', 'Relators only', 'Derived relations only'
        ]);
        select!.value = 'relators';
        select!.dispatchEvent(new Event('change'));
        expect(posted('content').at(-1)).toEqual({
            type: 'content', content: { derivedMaterialMode: 'relators' }
        });
    });

    test('fits a newly opened view once and preserves later viewport changes', () => {
        sendModel([], undefined, true);
        expect(document.getElementById('scale')!.textContent).toBe('200%');
        expect(document.getElementById('fit')!.getAttribute('aria-pressed')).toBe('true');

        document.getElementById('zoomOut')!.click();
        const changed = document.getElementById('scale')!.textContent;
        expect(document.getElementById('fit')!.getAttribute('aria-pressed')).toBe('false');
        sendModel();

        expect(changed).not.toBe('200%');
        expect(document.getElementById('scale')!.textContent).toBe(changed);
    });

    test('keeps fitting while the viewport changes size', () => {
        sendModel([], undefined, true);
        const before = document.getElementById('scale')!.textContent;
        const viewport = document.getElementById('viewport')!;
        Object.defineProperty(viewport, 'clientWidth', { value: 300, configurable: true });
        Object.defineProperty(viewport, 'clientHeight', { value: 180, configurable: true });

        window.dispatchEvent(new Event('resize'));

        expect(document.getElementById('fit')!.getAttribute('aria-pressed')).toBe('true');
        expect(document.getElementById('scale')!.textContent).not.toBe(before);
        Object.defineProperty(viewport, 'clientWidth', { value: 900, configurable: true });
        Object.defineProperty(viewport, 'clientHeight', { value: 700, configurable: true });
        window.dispatchEvent(new Event('resize'));
    });

    test('asks the host to move the diagram into a new window', () => {
        if (document.getElementById('fit')!.getAttribute('aria-pressed') === 'true') {
            document.getElementById('fit')!.click();
        }
        document.getElementById('newWindow')!.click();
        expect(posted('moveToNewWindow').at(-1)).toEqual({ type: 'moveToNewWindow' });
        expect(document.getElementById('fit')!.getAttribute('aria-pressed')).toBe('true');
    });

    test('sends class and association filter changes to the host', () => {
        sendModel();
        document.getElementById('optionsButton')!.click();

        const person = checkbox('Sample::Person');
        person.checked = false;
        person.dispatchEvent(new Event('change', { bubbles: true }));
        expect(posted('hide').at(-1)).toEqual({ type: 'hide', ids: ['Sample::Person'] });

        const association = checkbox('Sample::Person — worksFor — Sample::Organization');
        association.checked = false;
        association.dispatchEvent(new Event('change', { bubbles: true }));
        expect(posted('hide').at(-1)).toEqual({ type: 'hide', ids: ['works-for'] });
    });

    test('selects associations through their labels and hides the selection', () => {
        sendModel();
        const first = document.querySelector('[data-for="works-for"]');
        const second = document.querySelector('[data-for="employs"]');
        expect(first).not.toBeNull();
        expect(second).not.toBeNull();

        first!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
        second!.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, pointerId: 1, shiftKey: true
        }));

        expect(posted('selected').at(-1)).toEqual({ type: 'selected', ids: ['works-for', 'employs'] });
        expect((document.getElementById('hide') as HTMLButtonElement).disabled).toBe(false);
        document.getElementById('hide')!.click();
        expect(posted('hide').at(-1)).toEqual({ type: 'hide', ids: ['works-for', 'employs'] });
        expect(posted('selected').at(-1)).toEqual({ type: 'selected', ids: [] });
    });

    test('prunes selection and reflects filters while showing a stale model', () => {
        openOptions();
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'select', ids: ['Sample::Person', 'works-for'] }
        }));

        sendModel(['Sample::Person'], 'line 3: expected declaration');

        expect(posted('selected').at(-1)).toEqual({ type: 'selected', ids: [] });
        expect((document.getElementById('hide') as HTMLButtonElement).disabled).toBe(true);
        expect(document.getElementById('stale')!.hidden).toBe(false);
        expect(document.getElementById('stale')!.title).toBe('line 3: expected declaration');
        expect(checkbox('Sample::Person').checked).toBe(false);
    });

    test('asks the host for the whole workspace, and shows which packages that is', () => {
        window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'model', view, positions: {}, routes: {},
            display: defaultDisplayOptions,
            content: { ...defaultContentOptions, includedPackages: ['Sample'] },
            layout: defaultLayoutOptions,
            packages: ['Other', 'Sample'],
            filters: []
        } }));
        openOptions();

        // The file declares `Sample`, so that is what the scope came to.
        expect(checkbox('Sample').checked).toBe(true);
        expect(checkbox('Other').checked).toBe(false);

        const scope = chooser('Scope');
        expect(scope.value).toBe('file');
        scope.value = 'workspace';
        scope.dispatchEvent(new Event('change', { bubbles: true }));

        // Only the scope is sent: which packages it comes to is the host's to
        // answer, and it answers it again on every keystroke.
        expect(posted('content').at(-1)).toEqual({ type: 'content', content: { scope: 'workspace' } });
    });

    /**
     * A branch of a shared tree is a generalization: it can be chosen and it
     * can be opened. What it cannot be is routed -- the tree decides where its
     * branches run -- so it is offered no handle to bend, which every other
     * chosen line has.
     */
    test('chooses the branch of a shared tree that was clicked, and offers no bend on it', () => {
        sendTree();

        const leg = document.querySelector('[data-edge="gen:Sample::Child->Sample::Person"]');
        expect(leg).not.toBeNull();
        expect(leg!.tagName.toLowerCase()).toBe('path');

        leg!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));

        expect(posted('selected').at(-1))
            .toEqual({ type: 'selected', ids: ['gen:Sample::Child->Sample::Person'] });
        expect(leg!.classList.contains('tv-selected')).toBe(true);
        // The handles layer is there, and empty: nothing on a leg to take hold of.
        expect(document.querySelector('.tv-handles')?.children.length).toBe(0);
        // Nor is it something the panel offers to hide, as no generalization is.
        expect((document.getElementById('hide') as HTMLButtonElement).disabled).toBe(true);
    });

    /**
     * The set is declared in the model and drawn as one shared triangle, so it
     * is chosen as itself -- and what an arrange then acts on is the classes it
     * holds, since a set has no place on the canvas of its own.
     */
    test('chooses the generalization set from the bar its branches hang from', () => {
        sendTree();
        const tree = document.querySelector(`[data-genset="${treeSet}"]`)!;
        const bar = [...tree.querySelectorAll('path')].find(path =>
            /^M [\d.]+ ([\d.]+) L [\d.]+ \1$/.test(path.getAttribute('d') ?? ''));
        expect(bar).toBeDefined();

        bar!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));

        expect(posted('selected').at(-1)).toEqual({ type: 'selected', ids: [treeSet] });
        expect(tree.classList.contains('tv-selected')).toBe(true);
        // Nothing to take hold of: a set is not a line anybody routed.
        expect(document.querySelector('.tv-handles')?.children.length).toBe(0);
        // The toolbar action always arranges the whole diagram, even with a
        // generalization set selected.
        document.getElementById('arrange')!.click();
        expect(posted('autoLayout').at(-1)).toEqual({ type: 'autoLayout' });
        expect(document.getElementById('arrange')!.title).toBe('Arrange the whole diagram automatically');
    });

    /**
     * A tree is derived from where its classes are, so it has to follow one
     * being dragged. Nothing about a leg can be nudged the way an association's
     * endpoint can: the whole figure is drawn again.
     */
    test('moves a shared tree with the class being dragged', () => {
        sendTree();
        const legOf = () => document.querySelector('[data-edge="gen:Sample::Child->Sample::Person"]')
            ?.getAttribute('d');
        const before = legOf();

        const child = document.querySelector('[data-node="Sample::Child"]')!;
        child.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, pointerId: 2, clientX: 300, clientY: 220
        }));
        document.getElementById('viewport')!.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, pointerId: 2, clientX: 300, clientY: 320
        }));

        expect(legOf()).not.toBe(before);
        // Drawn from where the card now is: the leg ends on its top edge,
        // however far the zoom made the pointer's hundred pixels go.
        const top = document.querySelector('[data-node="Sample::Child"] rect')!.getAttribute('y');
        expect(Number(top)).toBeGreaterThan(200);
        expect(legOf()).toMatch(new RegExp(` ${top}$`));
        document.getElementById('viewport')!.dispatchEvent(
            new PointerEvent('pointerup', { bubbles: true, pointerId: 2 }));
    });

    /**
     * The commands are in the palette, which is not where somebody looking at
     * a diagram looks for another arrangement of it.
     */
    test('asks the host for another view from the toolbar', () => {
        sendModel();

        document.getElementById('views')!.click();

        expect(posted('chooseView').at(-1)).toEqual({ type: 'chooseView' });
    });

    test('does not offer to hide lines outside the association filter', () => {
        const specialization = {
            ...view,
            edges: [{
                kind: 'generalization' as const,
                id: 'generalization:person-organization',
                source: 'Sample::Person',
                target: 'Sample::Organization'
            }]
        };
        window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'model', view: specialization,
            positions: {
                'Sample::Person': { x: 0, y: 100, width: 160, height: 60 },
                'Sample::Organization': { x: 0, y: 0, width: 160, height: 60 }
            },
            routes: {}, display: defaultDisplayOptions, content: defaultContentOptions,
            layout: defaultLayoutOptions, packages: ['Sample'], filters: []
        } }));
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'select', ids: ['generalization:person-organization'] }
        }));
        const before = posted('hide').length;

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));

        expect((document.getElementById('hide') as HTMLButtonElement).disabled).toBe(true);
        expect(posted('hide')).toHaveLength(before);
    });

    test('moves a derivation live while its relator is dragged', () => {
        const relation = 'works-for-derived';
        const derived = {
            ...view,
            nodes: [...view.nodes, {
                id: 'Sample::Employment', kind: 'class' as const, name: 'Employment', package: 'Sample',
                stereotype: 'relator', color: '#99FF99', isExternal: false, attributes: []
            }],
            edges: [{
                kind: 'relation' as const, id: relation, stereotype: 'material', name: 'worksFor',
                source: 'Sample::Person', target: 'Sample::Organization',
                sourceEnd: { isConst: false, isAddOnly: false }, targetEnd: { isConst: false, isAddOnly: false },
                derivedFrom: ['Sample::Employment']
            }]
        };
        window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'model', view: derived,
            positions: {
                'Sample::Person': { x: 0, y: 0, width: 160, height: 60 },
                'Sample::Organization': { x: 400, y: 0, width: 160, height: 60 },
                'Sample::Employment': { x: 200, y: 200, width: 160, height: 60 }
            },
            routes: {}, display: defaultDisplayOptions,
            content: defaultContentOptions, layout: defaultLayoutOptions,
            packages: ['Sample'], filters: []
        } }));

        const line = () => document.querySelector(`[data-derivation="${relation}"] path`)!.getAttribute('d');
        const before = line();
        document.querySelector('[data-node="Sample::Employment"]')!.dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 200, clientY: 200 }));
        document.getElementById('viewport')!.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, pointerId: 1, clientX: 320, clientY: 260
        }));

        expect(before).toBeTruthy();
        expect(line()).not.toBe(before);
        document.getElementById('viewport')!.dispatchEvent(
            new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    });

    test('moves a historical role\'s derivation live while the role is dragged', () => {
        const relation = 'graduated-in';
        const derived = {
            ...view,
            nodes: [...view.nodes, {
                id: 'Sample::Graduate', kind: 'class' as const, name: 'Graduate', package: 'Sample',
                stereotype: 'historicalRole', color: '#FFDDDD', isExternal: false, attributes: [],
                derivedFrom: [relation]
            }],
            edges: [{
                kind: 'relation' as const, id: relation, stereotype: 'participation', name: 'graduatedIn',
                source: 'Sample::Person', target: 'Sample::Organization',
                sourceEnd: { isConst: false, isAddOnly: false }, targetEnd: { isConst: false, isAddOnly: false }
            }]
        };
        window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'model', view: derived,
            positions: {
                'Sample::Person': { x: 0, y: 0, width: 160, height: 60 },
                'Sample::Organization': { x: 400, y: 0, width: 160, height: 60 },
                'Sample::Graduate': { x: 200, y: 200, width: 160, height: 60 }
            },
            routes: {}, display: defaultDisplayOptions,
            content: defaultContentOptions, layout: defaultLayoutOptions,
            packages: ['Sample'], filters: []
        } }));

        const line = () => document.querySelector('[data-derivation="Sample::Graduate"] path')!.getAttribute('d');
        const before = line();
        document.querySelector('[data-node="Sample::Graduate"]')!.dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 200, clientY: 200 }));
        document.getElementById('viewport')!.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, pointerId: 1, clientX: 320, clientY: 260
        }));

        expect(before).toBeTruthy();
        expect(line()).not.toBe(before);
        document.getElementById('viewport')!.dispatchEvent(
            new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    });

    test('moves a sole generalization head live while its target class is dragged', () => {
        const edge = 'generalization:person-organization';
        const specialization = {
            ...view,
            edges: [{
                kind: 'generalization' as const,
                id: edge,
                source: 'Sample::Person',
                target: 'Sample::Organization'
            }]
        };
        window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'model', view: specialization,
            positions: {
                'Sample::Person': { x: 0, y: 180, width: 160, height: 60 },
                'Sample::Organization': { x: 260, y: 0, width: 160, height: 60 }
            },
            routes: {}, display: { ...defaultDisplayOptions, routing: 'curved' },
            content: defaultContentOptions, layout: defaultLayoutOptions,
            packages: ['Sample'], filters: []
        } }));
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'select', ids: [edge] } }));

        const marker = document.querySelector(`[data-edge="${edge}"] .tv-marker`)!;
        const before = marker.getAttribute('points');
        document.querySelector('[data-node="Sample::Organization"]')!.dispatchEvent(
            new PointerEvent('pointerdown', {
                bubbles: true, pointerId: 1, clientX: 260, clientY: 0
            }));
        document.getElementById('viewport')!.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, pointerId: 1, clientX: 300, clientY: 40
        }));

        expect(marker.getAttribute('points')).not.toBe(before);
        document.getElementById('viewport')!.dispatchEvent(
            new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    });

    test('selects and deletes a bend as soon as it is created', () => {
        const edge = 'generalization:person-organization';
        const specialization = {
            ...view,
            edges: [{
                kind: 'generalization' as const,
                id: edge,
                source: 'Sample::Person',
                target: 'Sample::Organization'
            }]
        };
        window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'model', view: specialization,
            positions: {
                'Sample::Person': { x: 0, y: 180, width: 160, height: 60 },
                'Sample::Organization': { x: 260, y: 0, width: 160, height: 60 }
            },
            routes: {}, display: { ...defaultDisplayOptions, routing: 'curved' },
            content: defaultContentOptions, layout: defaultLayoutOptions,
            packages: ['Sample'], filters: []
        } }));
        window.dispatchEvent(new MessageEvent('message', { data: { type: 'select', ids: [edge] } }));

        const offered = document.querySelector('.tv-handle-new')!;
        offered.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles: true, pointerId: 1, clientX: 100, clientY: 100
        }));
        document.getElementById('viewport')!.dispatchEvent(new PointerEvent('pointermove', {
            bubbles: true, pointerId: 1, clientX: 140, clientY: 140
        }));

        document.getElementById('viewport')!.dispatchEvent(
            new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
        const bend = document.querySelector('.tv-handle-selected');
        expect(bend?.getAttribute('aria-label')).toContain('Delete or Backspace');

        const hiddenBefore = posted('hide').length;
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));

        expect(posted('rerouted').at(-1)).toEqual({ type: 'rerouted', edge });
        expect(posted('hide')).toHaveLength(hiddenBefore);
        expect(document.querySelector('.tv-handle-selected')).toBeNull();
    });

    test('redraws a generalization set live while one of its classes is dragged', () => {
        // A tree has no path of its own for `redrawIncidentEdges` to nudge --
        // it is drawn once from every child's position together -- so dragging
        // a class in one used to leave the shared triangle exactly where it
        // was until the drag ended, while every ordinary association followed
        // the pointer.
        const genset = 'set:Sample::Sex';
        const treeView: ViewModel = {
            groups: [],
            gensets: [{
                id: genset, name: 'Sex', disjoint: true, complete: true,
                general: 'Sample::Person', specifics: ['Sample::Man', 'Sample::Woman'], categorizers: []
            }],
            nodes: ['Person', 'Man', 'Woman'].map(name => ({
                id: `Sample::${name}`, kind: 'class' as const, name, package: 'Sample',
                color: '#eee', isExternal: false, attributes: []
            })),
            edges: [
                { kind: 'generalization', id: 'gen:Man', source: 'Sample::Man', target: 'Sample::Person', genset },
                { kind: 'generalization', id: 'gen:Woman', source: 'Sample::Woman', target: 'Sample::Person', genset }
            ]
        };
        window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'model', view: treeView,
            positions: {
                'Sample::Person': { x: 100, y: 0, width: 120, height: 60 },
                'Sample::Man': { x: 0, y: 200, width: 120, height: 42 },
                'Sample::Woman': { x: 200, y: 200, width: 120, height: 42 }
            },
            routes: {}, display: defaultDisplayOptions, content: defaultContentOptions,
            layout: defaultLayoutOptions, packages: ['Sample'], filters: []
        } }));

        const before = document.querySelector('.tv-tree')!.outerHTML;
        document.querySelector('[data-node="Sample::Man"]')!.dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 0, clientY: 200 }));
        document.getElementById('viewport')!.dispatchEvent(
            new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 300, clientY: 200 }));

        expect(document.querySelector('.tv-tree')!.outerHTML).not.toBe(before);
    });

    test('closes the options panel on a pointerdown outside it, not on one inside', () => {
        openOptions();
        const options = document.getElementById('options') as HTMLElement;

        document.getElementById('toolbar')!.dispatchEvent(
            new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
        expect(options.hidden).toBe(true);

        openOptions();
        options.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
        expect(options.hidden).toBe(false);
    });
});
