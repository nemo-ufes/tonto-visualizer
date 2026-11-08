// @vitest-environment happy-dom

import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { defaultContentOptions, defaultDisplayOptions, defaultLayoutOptions } from 'tonto-view';
import { PANEL_BODY } from '../src/webview/skeleton.js';

const messages: Array<{ type: string; background?: string }> = [];
let saved: { x: number; y: number; scale: number; pan: boolean; background: string };
let restored: typeof saved;
let viewport: HTMLElement;
const model = {
    type: 'model',
    view: {
        groups: [], gensets: [],
        nodes: ['Person', 'Organization'].map(name => ({
            id: name, name, kind: 'class', package: 'Sample', color: '#eeeeee', isExternal: false, attributes: []
        })),
        edges: [{
            id: 'worksFor', kind: 'relation', source: 'Person', target: 'Organization', name: 'worksFor',
            sourceEnd: { isConst: false, isAddOnly: false }, targetEnd: { isConst: false, isAddOnly: false }
        }]
    },
    positions: {
        Person: { x: 0, y: 0, width: 160, height: 60 },
        Organization: { x: 300, y: 0, width: 160, height: 60 }
    },
    routes: {}, display: defaultDisplayOptions, content: defaultContentOptions,
    layout: defaultLayoutOptions, packages: ['Sample'], filters: []
};

function send(data: unknown): void {
    window.dispatchEvent(new MessageEvent('message', { data }));
}

function background(value: string): void {
    const chooser = document.getElementById('diagramBackground') as HTMLSelectElement;
    chooser.value = value;
    chooser.dispatchEvent(new Event('change', { bubbles: true }));
}

function pointer(target: Element, type: string, options: PointerEventInit = {}): void {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, clientX: 100, clientY: 100, ...options }));
}

function drag(target: Element, options: PointerEventInit = {}): void {
    pointer(target, 'pointerdown', options);
    pointer(viewport, 'pointermove', { clientX: 180, clientY: 150, ...options });
    pointer(viewport, 'pointerup', { clientX: 180, clientY: 150, ...options });
}

function node(): Element {
    return document.querySelector('[data-node="Person"]')!;
}

describe('diagram navigation and its own background', () => {
    beforeAll(async () => {
        document.body.innerHTML = PANEL_BODY;
        viewport = document.getElementById('viewport')!;
        Object.defineProperty(viewport, 'clientWidth', { value: 900 });
        Object.defineProperty(viewport, 'clientHeight', { value: 700 });
        const captured = new Set<number>();
        Object.assign(viewport, {
            setPointerCapture: (id: number) => captured.add(id),
            hasPointerCapture: (id: number) => captured.has(id),
            releasePointerCapture: (id: number) => captured.delete(id)
        });
        vi.stubGlobal('acquireVsCodeApi', () => ({
            getState: () => ({ x: 30, y: 40, scale: 1, pan: true, background: 'black' }),
            setState: (state: typeof saved) => { saved = state; },
            postMessage: (message: typeof messages[number]) => messages.push(message)
        }));
        await import('../src/webview/main.js');
        send(structuredClone(model));
        restored = { ...saved };
        expect(messages[0]).toEqual({ type: 'ready', background: 'black' });
        expect(document.getElementById('pan')!.getAttribute('aria-pressed')).toBe('true');
    });

    beforeEach(() => {
        window.dispatchEvent(new Event('blur'));
        viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        background('editor');
        send({ type: 'theme', dark: false });
        send({ type: 'select', ids: [] });
        send(structuredClone(model));
        messages.length = 0;
    });

    test('restores background and pan with the viewport', () => {
        expect(restored).toMatchObject({ x: 30, y: 40, scale: 1, pan: true, background: 'black' });
    });

    test('pans over selected cards without moving or deselecting them', () => {
        send({ type: 'select', ids: ['Person'] });
        const before = { ...saved };
        const markup = node().innerHTML;
        document.getElementById('pan')!.click();
        drag(node());
        expect(saved).toMatchObject({ x: before.x + 80, y: before.y + 50, scale: before.scale, pan: true });
        expect(node().classList.contains('tv-selected')).toBe(true);
        expect(node().innerHTML).toBe(markup);
        expect(messages).toEqual([]);
    });

    test.each([{ button: 1 }, { altKey: true }])('pans over a card with %o', modifier => {
        const before = { ...saved };
        drag(node(), modifier);
        expect(saved.x - before.x).toBe(80);
        expect(saved.y - before.y).toBe(50);
        expect(messages).toEqual([]);
    });

    test('Space pans over a relation; releasing it returns to selection', () => {
        viewport.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space', bubbles: true }));
        const before = { ...saved };
        drag(document.querySelector('[data-edge]')!);
        viewport.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space', bubbles: true }));
        expect(saved.x - before.x).toBe(80);
        expect(messages).toEqual([]);
        expect(viewport.classList.contains('pan-enabled')).toBe(false);
    });

    test('Pan takes precedence over resize grips', () => {
        send({ type: 'select', ids: ['Person'] });
        document.getElementById('pan')!.click();
        drag(document.querySelector('.tv-grip')!);
        expect(messages).toEqual([]);
    });

    test.each(['pointercancel', 'lostpointercapture', 'blur', 'Escape'])('%s releases a pan', ending => {
        document.getElementById('pan')!.click();
        pointer(node(), 'pointerdown');
        pointer(viewport, 'pointermove', { clientX: 140 });
        if (ending === 'blur') window.dispatchEvent(new Event('blur'));
        else if (ending === 'Escape') viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        else pointer(viewport, ending);
        const ended = { ...saved };
        pointer(viewport, 'pointermove', { clientX: 200 });
        pointer(viewport, 'pointerup');
        expect(saved).toEqual(ended);
        expect(viewport.classList.contains('pan-dragging')).toBe(false);
    });

    test('does not consume Space in a control', () => {
        const chooser = document.getElementById('diagramBackground')!;
        const event = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
        chooser.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(viewport.classList.contains('pan-enabled')).toBe(false);
    });

    test('ordinary card dragging still edits the arrangement', () => {
        const before = { ...saved };
        drag(node());
        expect(messages.some(message => message.type === 'moved')).toBe(true);
        expect(saved.x).toBe(before.x);
        expect(saved.y).toBe(before.y);
    });

    test.each([
        ['white', '#ffffff', '#4a453c', true],
        ['black', '#000000', '#c9c4bb', false]
    ] as const)('%s overrides the editor while keeping contrasting lines', (choice, paper, ink, editorDark) => {
        background(choice);
        const before = { ...saved };
        send({ type: 'theme', dark: editorDark });
        const svg = document.querySelector('#canvas > svg')!;
        expect(document.querySelector('#canvas > svg > rect')!.getAttribute('fill')).toBe(paper);
        expect(svg.querySelector('style')!.textContent).toContain(`stroke: ${ink}`);
        expect(document.body.classList.contains('dark')).toBe(editorDark);
        expect(saved).toEqual(before);
        expect(saved.background).toBe(choice);
        expect(messages).toContainEqual({ type: 'background', background: choice });
        expect(messages.some(message => ['moved', 'display', 'content'].includes(message.type))).toBe(false);
    });

    test('Editor resumes following editor theme changes', () => {
        background('white');
        background('editor');
        send({ type: 'theme', dark: true });
        expect(document.querySelector('#canvas > svg > rect')!.getAttribute('fill')).toBe('#1e1e1e');
        send({ type: 'theme', dark: false });
        expect(document.querySelector('#canvas > svg > rect')!.getAttribute('fill')).toBe('#f7f6f2');
    });
});
