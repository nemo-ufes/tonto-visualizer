/**
 * What the drawing needs to know about a model's meaning, in one place.
 *
 * The canvas is downstream of `packages/view`, which is where the language is
 * asked what a class classifies. What is left here is the reading of that
 * answer, and it is kept in one file because the two halves of the canvas had
 * drifted apart: the renderer aimed a mediation through anything of a relator's
 * nature while the layout seated only what carried the `relator` keyword, so on
 * gUFO -- seven relator-natured classes, none of them written `relator` -- the
 * lines were drawn as if through a relator that the arrangement did not believe
 * in.
 */

import type { ViewNode } from 'tonto-view';

/**
 * A relator is a reified relationship, whatever keyword declares it: a role
 * played by a relator, an employment under contract, is as much the
 * relationship as the relator it specializes, and gUFO's `Relator` is a
 * category. The nature is the language's own answer -- `getEffectiveNatures`,
 * resolved through declarations, supertypes and implications -- so it is what
 * decides, and the keyword is only the ordinary way of stating it.
 */
export function isRelator(node: ViewNode): boolean {
    return node.stereotype === 'relator' || (node.natures?.natures.includes('relators') ?? false);
}
