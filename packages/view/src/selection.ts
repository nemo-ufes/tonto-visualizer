/**
 * What a selection means to whatever acts on it.
 *
 * A generalization set is chosen as itself -- it is declared in the model and
 * drawn as one shared triangle, so the reader can point at it -- but it has no
 * place on the canvas of its own: the triangle, its bar and its legs are drawn
 * from where its classes are. So everything that moves things about reads a
 * chosen set as the classes it holds, which is also what "arrange this" over a
 * taxonomy is asking for.
 */

import type { ViewModel } from './model.js';

/** The classes a selection stands for, in the order they were chosen. */
export function nodesInSelection(view: ViewModel, ids: Iterable<string>): string[] {
    const nodes = new Set(view.nodes.map(node => node.id));
    const chosen = new Set<string>();
    for (const id of ids) {
        const genset = view.gensets.find(candidate => candidate.id === id);
        for (const member of genset ? [genset.general, ...genset.specifics] : [id]) {
            if (member !== undefined && nodes.has(member)) {
                chosen.add(member);
            }
        }
    }
    return [...chosen];
}
