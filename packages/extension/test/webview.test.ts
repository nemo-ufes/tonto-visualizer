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
            <span id="title"></span><span id="stale" hidden></span>
            <button id="zoomOut"></button><span id="scale"></span><button id="zoomIn"></button>
            <button id="fit"></button><button id="arrange"></button>
            <button id="hide" disabled></button><button id="optionsButton"></button><button id="exportButton"></button>
        </div>
        <div id="options" hidden></div>
        <div id="viewport"><div id="canvas"></div></div>
        <div id="legend" hidden></div>
    </div>`;
}

function sendModel(hidden: string[] = [], stale?: string): void {
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
        title: 'sample.tonto',
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
        Object.defineProperty(viewport, 'clientWidth', { value: 900 });
        Object.defineProperty(viewport, 'clientHeight', { value: 700 });
        Object.assign(viewport, { setPointerCapture: () => undefined });
        vi.stubGlobal('acquireVsCodeApi', () => ({
            postMessage: (message: unknown) => messages.push(message),
            getState: () => undefined,
            setState: () => undefined
        }));
        await import('../src/webview/main.js');
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
            filters: [], title: 'sample.tonto'
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
        const set = 'set:Sample::PersonAgePhases';
        const clazz = (name: string, stereotype: string) => ({
            id: `Sample::${name}`, kind: 'class' as const, name, package: 'Sample',
            stereotype, color: '#eee', isExternal: false, attributes: []
        });
        const specialization = (name: string) => ({
            kind: 'generalization' as const,
            id: `gen:Sample::${name}->Sample::Person`,
            source: `Sample::${name}`, target: 'Sample::Person', genset: set
        });
        window.dispatchEvent(new MessageEvent('message', { data: {
            type: 'model',
            view: {
                groups: [], gensets: [{
                    id: set, name: 'PersonAgePhases', disjoint: true, complete: true,
                    general: 'Sample::Person', specifics: ['Sample::Child', 'Sample::Adult'], categorizers: []
                }],
                nodes: [clazz('Person', 'kind'), clazz('Child', 'phase'), clazz('Adult', 'phase')],
                edges: [specialization('Child'), specialization('Adult')]
            },
            positions: {
                'Sample::Person': { x: 120, y: 0, width: 160, height: 42 },
                'Sample::Adult': { x: 0, y: 200, width: 120, height: 42 },
                'Sample::Child': { x: 240, y: 200, width: 120, height: 42 }
            },
            routes: {}, display: defaultDisplayOptions, content: defaultContentOptions,
            layout: defaultLayoutOptions, packages: ['Sample'], filters: [], title: 'sample.tonto'
        } }));

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
            layout: defaultLayoutOptions, packages: ['Sample'], filters: [], title: 'sample.tonto'
        } }));
        window.dispatchEvent(new MessageEvent('message', {
            data: { type: 'select', ids: ['generalization:person-organization'] }
        }));
        const before = posted('hide').length;

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));

        expect((document.getElementById('hide') as HTMLButtonElement).disabled).toBe(true);
        expect(posted('hide')).toHaveLength(before);
    });
});
