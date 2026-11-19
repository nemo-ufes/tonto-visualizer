/**
 * What a rename in the model means for an arrangement of it.
 *
 * An element's id is its qualified name (`ids.ts`), so renaming `Person` to
 * `Human` -- or renaming the package it is in -- leaves the view file holding a
 * position for an element that no longer exists and none for the one that
 * does. The class was then placed again as if new, its routes went with it,
 * and renaming a package unplaced every class at once, which the panel reads
 * as a diagram never arranged and lays out from scratch.
 *
 * The names are still the ids. What is used here is only the evidence two
 * consecutive readings of a model give that one element became another: a
 * declaration that vanished and one that appeared where it was written. That
 * evidence lives between two parses in one session and is never stored, so a
 * line number still never becomes an identity.
 */

import type { ViewEdge, ViewGenset, ViewModel, ViewNode } from './model.js';
import { renameEdgeEnds } from './ids.js';
import type { EdgeRoute, Placement, ViewFile } from './viewfile.js';

export interface Renames {
    /** Classes, datatypes, enumerations and package cards, old id to new. */
    nodes: ReadonlyMap<string, string>;
    /**
     * Relations whose own id changed beyond their ends: a relation renamed.
     * An edge whose ends alone were renamed needs no entry; its id is
     * rewritten from theirs.
     */
    edges: ReadonlyMap<string, string>;
    gensets: ReadonlyMap<string, string>;
}

/**
 * The elements of `before` that `after` holds under another name, or
 * `undefined` when there are none.
 *
 * A declaration renamed in place starts where it started: the keyword before
 * its name has not moved, and neither has anything above it. That is what
 * pairs them -- by document and start, and by the same kind of element, so a
 * class replaced by a datatype is not taken for it. When the text moved as
 * well, as it can when the diagram is only redrawn on save, one vanished
 * declaration and one new one of the same stereotype in the same document are
 * still the same thing renamed; more than one each is a guess, and not made.
 */
export function renamesBetween(before: ViewModel, after: ViewModel): Renames | undefined {
    if (before.kind !== after.kind) {
        return undefined;
    }
    const nodeKey = (node: ViewNode) => node.source && node.kind !== 'unresolved'
        ? {
            at: `${node.kind}|${startOf(node.source)}`,
            family: `${node.kind}|${node.stereotype ?? ''}|${node.source.uri}`
        }
        : undefined;
    const nodes = pair(...changedBetween(before.nodes, after.nodes), nodeKey, nodeKey);
    const rename = (id: string) => nodes.get(id) ?? id;
    const edges = renamedRelations(before.edges, after.edges, rename);
    const gensetKey = (ends: (id: string) => string) => (genset: ViewGenset) => genset.source
        ? { at: startOf(genset.source), family: `${genset.source.uri}|${signatureOf(genset, ends)}` }
        : undefined;
    const gensets = pair(...changedBetween(before.gensets, after.gensets), gensetKey(rename), gensetKey(id => id));
    return nodes.size || edges.size || gensets.size ? { nodes, edges, gensets } : undefined;
}

interface Key {
    /** Where it was written, which a rename in place does not move. */
    at: string;
    /** What it is and where, which only one vanished element may share with one new one. */
    family: string;
}

function changedBetween<T extends { id: string }>(before: readonly T[], after: readonly T[]): [T[], T[]] {
    const now = new Set(after.map(one => one.id));
    const then = new Set(before.map(one => one.id));
    return [before.filter(one => !now.has(one.id)), after.filter(one => !then.has(one.id))];
}

/**
 * Pairs what vanished with what appeared, first by where it was written and
 * then, among what is left, wherever exactly one of each shares a family.
 * The old side is keyed as it would read after the renames already found.
 */
function pair<T extends { id: string }>(
    vanished: readonly T[], appeared: readonly T[],
    keyOfOld: (one: T) => Key | undefined, keyOfNew: (one: T) => Key | undefined
): Map<string, string> {
    const renames = new Map<string, string>();
    const unique = (items: readonly T[], key: (one: T) => string | undefined) => {
        const found = new Map<string, T | null>();
        for (const one of items) {
            const value = key(one);
            if (value !== undefined) {
                found.set(value, found.has(value) ? null : one);
            }
        }
        return found;
    };
    for (const part of ['at', 'family'] as const) {
        const taken = new Set(renames.values());
        const from = unique(vanished.filter(one => !renames.has(one.id)), one => keyOfOld(one)?.[part]);
        const to = unique(appeared.filter(one => !taken.has(one.id)), one => keyOfNew(one)?.[part]);
        for (const [value, old] of from) {
            const next = to.get(value);
            if (old && next) {
                renames.set(old.id, next.id);
            }
        }
    }
    return renames;
}

/**
 * A relation renamed keeps its ends, its stereotype and where it was written;
 * only its name, and so its id, changed. One whose ends alone were renamed is
 * found under the id its renamed ends give it, and needs no entry here.
 */
function renamedRelations(
    before: readonly ViewEdge[], after: readonly ViewEdge[], rename: (id: string) => string
): Map<string, string> {
    const expected = (edge: ViewEdge) => renameEdgeEnds(edge.id, rename) ?? edge.id;
    const now = new Set(after.map(edge => edge.id));
    const then = new Set(before.map(expected));
    const keyOf = (ends: (id: string) => string) => (edge: ViewEdge): Key | undefined =>
        edge.kind === 'relation' && edge.source_
            ? {
                at: `${startOf(edge.source_)}|${edge.stereotype ?? ''}`,
                family: `${edge.source_.uri}|${edge.stereotype ?? ''}|${ends(edge.source)}|${ends(edge.target)}`
            }
            : undefined;
    return pair(
        before.filter(edge => !now.has(expected(edge))),
        after.filter(edge => !then.has(edge.id)),
        keyOf(rename), keyOf(id => id)
    );
}

/** A set's general and specifics, which a set renamed in another file still has. */
function signatureOf(genset: ViewGenset, rename: (id: string) => string): string {
    return [rename(genset.general ?? ''), ...genset.specifics.map(rename).sort()].join(',');
}

function startOf(source: NonNullable<ViewNode['source']>): string {
    return `${source.uri}:${source.line}:${source.character}`;
}

/** What an id the view file holds is called after the renames. */
export function renamedId(id: string, renames: Renames): string {
    const direct = renames.nodes.get(id) ?? renames.edges.get(id) ?? renames.gensets.get(id);
    if (direct) {
        return direct;
    }
    const ends = renameEdgeEnds(id, node => renames.nodes.get(node) ?? node);
    return ends !== undefined ? renames.edges.get(ends) ?? ends : id;
}

/**
 * The view file with every id it holds renamed: positions, routes and the
 * hidden list. The same file when nothing in it was affected, so a caller can
 * tell whether there is anything to write.
 *
 * A stale entry already sitting under a new name -- from a class of that name
 * deleted long ago -- gives way to the one renamed into it, which is the one
 * on the screen.
 */
export function renameInViewFile(file: ViewFile, renames: Renames): ViewFile {
    let changed = false;
    const keyed = <T>(record: Record<string, T>): Record<string, T> => {
        const moved: Record<string, T> = {};
        const kept: Record<string, T> = {};
        for (const [id, value] of Object.entries(record)) {
            const next = renamedId(id, renames);
            if (next === id) {
                kept[id] = value;
            } else {
                moved[next] = value;
                changed = true;
            }
        }
        return { ...kept, ...moved };
    };
    const nodes: Record<string, Placement> = keyed(file.nodes);
    const edges: Record<string, EdgeRoute> = keyed(file.edges);
    const hidden = file.content.hidden?.map(id => {
        const next = renamedId(id, renames);
        changed ||= next !== id;
        return next;
    });
    if (!changed) {
        return file;
    }
    return {
        ...file,
        content: { ...file.content, ...(hidden ? { hidden: [...new Set(hidden)] } : {}) },
        nodes,
        edges
    };
}
