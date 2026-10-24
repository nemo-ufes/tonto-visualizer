import { describe, expect, test } from 'vitest';
import { isWithinFolder } from '../src/paths.js';

describe('which files a workspace diagram follows', () => {
    test('finds a file below the folder with the separator Windows uses', () => {
        expect(isWithinFolder('c:\\work\\shop\\core\\product.tonto', 'c:\\work\\shop', '\\')).toBe(true);
    });

    test('finds a file below the folder with the separator other systems use', () => {
        expect(isWithinFolder('/work/shop/core/product.tonto', '/work/shop', '/')).toBe(true);
    });

    test('does not take a sibling folder sharing a prefix for the folder', () => {
        expect(isWithinFolder('/work/shopping/cart.tonto', '/work/shop', '/')).toBe(false);
        expect(isWithinFolder('c:\\work\\shopping\\cart.tonto', 'c:\\work\\shop', '\\')).toBe(false);
    });

    test('accepts a folder given with its trailing separator, as a drive root is', () => {
        expect(isWithinFolder('c:\\model.tonto', 'c:\\', '\\')).toBe(true);
        expect(isWithinFolder('/model.tonto', '/', '/')).toBe(true);
    });
});
