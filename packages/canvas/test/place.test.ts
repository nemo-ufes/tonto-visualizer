import { describe, expect, test } from 'vitest';
import type { ViewModel } from 'tonto-view';
import { drawnSizes, movedTo, placeNewNodes } from '../src/place.js';

const view = {
    groups: [], edges: [], gensets: [],
    nodes: [
        { id: 'a', name: 'A', kind: 'class', stereotype: undefined, attributes: [] },
        { id: 'b', name: 'B', kind: 'class', stereotype: undefined, attributes: [] }
    ]
} as unknown as ViewModel;

const natural = { a: { width: 120, height: 42 }, b: { width: 100, height: 40 } };

describe('the size a card is drawn at', () => {

    test('is what it holds when the file asks for nothing', () => {
        expect(drawnSizes(view, natural, {})).toEqual(natural);
    });

    test('is the size the modeller chose when that is roomier', () => {
        expect(drawnSizes(view, natural, { a: { x: 0, y: 0, width: 320, height: 102 } }).a)
            .toEqual({ width: 320, height: 102 });
    });

    test('still grows past a chosen size for content that needs the room', () => {
        // A card too small for what is written in it is not a smaller card, it
        // is a broken one: an attribute added after the resize still widens it.
        expect(drawnSizes(view, { ...natural, a: { width: 400, height: 200 } },
            { a: { x: 0, y: 0, width: 320, height: 102 } }).a)
            .toEqual({ width: 400, height: 200 });
    });

    test('is the size the card is placed at', () => {
        // placeNewNodes and an arrangement have to agree, or the diagram is
        // packed around one size and drawn at another.
        const saved = { a: { x: 10, y: 20, width: 320, height: 102 } };
        const placed = placeNewNodes(view, natural, saved);
        expect({ width: placed.a!.width, height: placed.a!.height })
            .toEqual(drawnSizes(view, natural, saved).a);
    });
});

describe('an arrangement on its way back into the file', () => {

    test('records where a card went', () => {
        expect(movedTo({ a: { x: 5, y: 7, width: 120, height: 42 } }, {}))
            .toEqual({ a: { x: 5, y: 7 } });
    });

    test('does not write the size a card happens to be right now', () => {
        // Every card laid out carries a size, and a size in the file is a size
        // the card may never go below: written back, a class that later loses
        // an attribute would keep the room the attribute used to take.
        expect(movedTo({ b: { x: 0, y: 0, width: 100, height: 40 } }, {}).b!.width).toBeUndefined();
    });

    test('keeps the size the modeller chose', () => {
        // Arranging the diagram reset every card the modeller had widened.
        expect(movedTo(
            { a: { x: 300, y: 400, width: 320, height: 102 } },
            { a: { x: 0, y: 0, width: 320, height: 102 } }
        )).toEqual({ a: { x: 300, y: 400, width: 320, height: 102 } });
    });
});
