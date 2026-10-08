/**
 * What a partonomy-only view holds: the same answer for the layout that ranks
 * it and the renderer that draws it, so the two cannot disagree about a line.
 */

import type { ViewEdge, ViewModel } from 'tonto-view';

/**
 * The whole and the part an edge joins, if it joins one to the other.
 *
 * A parthood's whole is the language's answer, carried on the edge as the end
 * with the diamond. Constitution has no diamond, but the language fixes its
 * direction -- from what is constituted to what constitutes it, `Statue
 * @constitution -- isConstitutedOf -- PortionOfClay` -- and a statue drawn
 * above its clay reads the way a motorcycle drawn above its engine does.
 */
export function wholePartOf(edge: ViewEdge): { whole: string; part: string } | undefined {
    // A self-relation is kept -- a sub-organization is part of an
    // organization -- and the ranks skip it, having nothing to put above what.
    if (edge.kind !== 'relation') {
        return undefined;
    }
    if (edge.whole) {
        return edge.whole === 'source'
            ? { whole: edge.source, part: edge.target }
            : { whole: edge.target, part: edge.source };
    }
    return edge.stereotype === 'constitution' ? { whole: edge.source, part: edge.target } : undefined;
}

/**
 * The view with only the partonomy's edges: every whole-part relation, and the
 * generalizations a reader needs to make sense of them.
 *
 * Parts are usually roles -- `MotorcycleWheel` is a `WheelAssembly` playing a
 * component in a motorcycle -- and a role is often specialized further.
 * `FrontMotorcycleWheel` has a rim because a `MotorcycleWheel` does; drawn
 * without the specialization it is a part with no parts beside a wheel with
 * three. And a motorcycle with `[2]` wheels, a front wheel and a rear wheel
 * reads as four wheels unless the two are drawn as the two of them. So a
 * generalization is kept when its supertype is a whole, whose parts the
 * subtype inherits, or when both ends are parts of one same whole.
 *
 * Anything wider was tried and buries the partonomy. Kept whenever both ends
 * were in some whole-part relation, a model built on a generic pattern -- a
 * `Component` that every part role specializes, itself a part of a generic
 * `System` -- drew one more line from every part to that hub. And a
 * generalization to the kind playing a role says what a part is, not how the
 * whole is made up: drawn, it brings every kind in as a second hierarchy.
 *
 * A generalization set is kept only when its general and all its specifics
 * keep their generalizations, since it draws its tree from those classes, not
 * from the edges.
 */
export function partonomyView(view: ViewModel): ViewModel {
    const members = new Set<string>();
    const wholes = new Set<string>();
    const wholesOf = new Map<string, Set<string>>();
    for (const edge of view.edges) {
        const pair = wholePartOf(edge);
        if (pair) {
            members.add(pair.whole);
            members.add(pair.part);
            wholes.add(pair.whole);
            wholesOf.set(pair.part, new Set([...(wholesOf.get(pair.part) ?? []), pair.whole]));
        }
    }
    const kept = (edge: ViewEdge): boolean => edge.kind === 'generalization'
        && members.has(edge.source) && members.has(edge.target)
        && (wholes.has(edge.target)
            || [...(wholesOf.get(edge.source) ?? [])].some(whole => wholesOf.get(edge.target)?.has(whole)));
    const edges = view.edges.filter(edge => wholePartOf(edge) !== undefined || kept(edge));
    const specialized = new Set(edges.filter(edge => edge.kind === 'generalization')
        .map(edge => `${edge.source}\0${edge.target}`));
    return {
        ...view,
        edges,
        gensets: view.gensets.filter(genset => genset.general !== undefined
            && genset.specifics.every(id => specialized.has(`${id}\0${genset.general}`)))
    };
}
