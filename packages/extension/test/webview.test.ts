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
        constraints: { pinned: [], alignments: [], distributions: [] },
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

    test('offers taxonomy controls without an arrangement-engine choice', () => {
        sendModel();
        openOptions();

        expect(chooser('Direction').value).toBe('DOWN');
        expect(chooser('Maximum rank span').value).toBe('2000');
        expect(chooser('Typeface').value).toBe('sans');
        expect(chooser('Text size').value).toBe('medium');
        expect(checkbox('Cluster packages').checked).toBe(true);
        expect([...document.querySelectorAll('label.choice')]
            .some(candidate => candidate.querySelector('span')?.textContent === 'Arrangement')).toBe(false);
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

    test('offers to pin the selected classifiers', () => {
        sendModel();
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'select', ids: ['Sample::Person'] }
        }));
        openOptions();
        const button = [...document.querySelectorAll('button')]
            .find(candidate => candidate.textContent === 'Pin selected') as HTMLButtonElement | undefined;

        expect(button?.disabled).toBe(false);
        button?.click();
        expect(posted('pin').at(-1)).toEqual({
            type: 'pin', ids: ['Sample::Person'], pinned: true
        });
    });

    test('offers alignment constraints for a classifier selection', () => {
        sendModel();
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'select', ids: ['Sample::Person', 'Sample::Organization'] }
        }));
        openOptions();
        const button = [...document.querySelectorAll('button')]
            .find(candidate => candidate.textContent === 'Align vertical centres') as HTMLButtonElement | undefined;

        expect(button?.disabled).toBe(false);
        button?.click();
        expect(posted('constraint').at(-1)).toEqual({
            type: 'constraint', action: 'align-x',
            ids: ['Sample::Person', 'Sample::Organization']
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

        sendModel(['Sample::Person'], 'expected declaration');

        expect(posted('selected').at(-1)).toEqual({ type: 'selected', ids: [] });
        expect((document.getElementById('hide') as HTMLButtonElement).disabled).toBe(true);
        expect(document.getElementById('stale')!.hidden).toBe(false);
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
