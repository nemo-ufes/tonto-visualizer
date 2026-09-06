/**
 * What colour a class is.
 *
 * `getEffectiveNatures` resolves declared, inherited and implied restrictions,
 * so a `role` under a `collective` is coloured as a collective rather than as
 * "no nature stated" -- which the ad-hoc lookup in the old generator could not
 * see, since it read the stereotype and the first supertype and stopped.
 */

import { getEffectiveNatures, isUltimateSortal } from './language.js';
import type { ClassDeclaration } from './language.js';
import { COLORS, fullTone, lightTone } from './palette.js';

/**
 * The colour of a class.
 *
 * A class restricted to several natures is only coloured when they agree --
 * `of collectives, quantities` is pink either way, while a mixin over relators
 * and events has no one colour and is left grey rather than told a story about
 * which of the two it is.
 */
export function colorOf(classDeclaration: ClassDeclaration): string {
    const effective = getEffectiveNatures(classDeclaration);
    if (!effective || effective.natures.length === 0) {
        return COLORS.GREY;
    }
    const tone = isUltimateSortal(classDeclaration.stereotype) ? fullTone : lightTone;
    const colors = new Set(effective.natures.map(nature => tone[nature] ?? COLORS.GREY));
    return colors.size === 1 ? [...colors][0]! : COLORS.GREY;
}
