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

import type { NodeKind, SourceLocation, ViewEdge, ViewModel } from './model.js';
import { renameEdgeEnds } from './ids.js';
import type { ViewFile } from './viewfile.js';

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

/** Where a declaration starts: all a rename needs of where it was written. */
type Start = Pick<SourceLocation, 'uri' | 'line' | 'character'>;

interface ReadingNode {
    id: string;
    kind: NodeKind;
    stereotype?: string;
    source?: Start;
}

interface ReadingEdge {
    id: string;
    kind: ViewEdge['kind'];
    source: string;
    target: string;
    stereotype?: string;
    source_?: Start;
}

interface ReadingGenset {
    id: string;
    general?: string;
    specifics: readonly string[];
    source?: Start;
}

/**
 * What a rename is told from: the ids of a reading of the model and where
 * each was written. A `ViewModel` is one; so is what is kept of one between
 * sessions, which is only this.
 */
export interface Reading {
    kind?: ViewModel['kind'];
    nodes: readonly ReadingNode[];
    edges: readonly ReadingEdge[];
    gensets: readonly ReadingGenset[];
}

export const READING_VERSION = 1;

/**
 * A reading cut down to what `renamesBetween` uses, to be kept until the
 * model is next opened: no names, attributes or documentation, so a large
 * model's is small and none of its text is copied out of the repository.
 */
export function keptReading(view: Reading): Reading & { version: number } {
    const start = (source: Start | undefined) => source
        ? { source: { uri: source.uri, line: source.line, character: source.character } }
        : {};
    return {
        version: READING_VERSION,
        ...(view.kind ? { kind: view.kind } : {}),
        nodes: view.nodes.map(node => ({
            id: node.id, kind: node.kind,
            ...(node.stereotype ? { stereotype: node.stereotype } : {}),
            ...start(node.source)
        })),
        edges: view.edges.map(edge => ({
            id: edge.id, kind: edge.kind, source: edge.source, target: edge.target,
            ...(edge.stereotype ? { stereotype: edge.stereotype } : {}),
            ...(edge.source_ ? { source_: start(edge.source_).source! } : {})
        })),
        gensets: view.gensets.map(genset => ({
            id: genset.id,
            ...(genset.general ? { general: genset.general } : {}),
            specifics: [...genset.specifics],
            ...start(genset.source)
        }))
    };
}

/**
 * A kept reading read back, or `undefined` when it is not one this version
 * wrote. Nothing is lost by refusing it: without a reading a rename is not
 * found, which is where things stood before readings were kept.
 */
export function readKeptReading(raw: unknown): Reading | undefined {
    if (!isRecord(raw) || raw.version !== READING_VERSION
        || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges) || !Array.isArray(raw.gensets)) {
        return undefined;
    }
    const isStart = (value: unknown): value is Start => isRecord(value) && typeof value.uri === 'string'
        && typeof value.line === 'number' && typeof value.character === 'number';
    const ok = raw.nodes.every(node => isRecord(node) && typeof node.id === 'string' && typeof node.kind === 'string'
            && (node.source === undefined || isStart(node.source)))
        && raw.edges.every(edge => isRecord(edge) && typeof edge.id === 'string' && typeof edge.kind === 'string'
            && typeof edge.source === 'string' && typeof edge.target === 'string'
            && (edge.source_ === undefined || isStart(edge.source_)))
        && raw.gensets.every(genset => isRecord(genset) && typeof genset.id === 'string'
            && Array.isArray(genset.specifics) && genset.specifics.every(one => typeof one === 'string')
            && (genset.source === undefined || isStart(genset.source)));
    return ok ? raw as unknown as Reading : undefined;
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
export function renamesBetween(before: Reading, after: Reading): Renames | undefined {
    if (before.kind !== after.kind) {
        return undefined;
    }
    const nodeKey = (node: ReadingNode) => node.source && node.kind !== 'unresolved'
        ? {
            at: `${node.kind}|${startOf(node.source)}`,
            family: `${node.kind}|${node.stereotype ?? ''}|${node.source.uri}`
        }
        : undefined;
    const nodes = pair(...changedBetween(before.nodes, after.nodes), nodeKey, nodeKey);
    const rename = (id: string) => nodes.get(id) ?? id;
    const edges = renamedRelations(before.edges, after.edges, rename);
    const gensetKey = (ends: (id: string) => string) => (genset: ReadingGenset) => genset.source
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
    before: readonly ReadingEdge[], after: readonly ReadingEdge[], rename: (id: string) => string
): Map<string, string> {
    const expected = (edge: ReadingEdge) => renameEdgeEnds(edge.id, rename) ?? edge.id;
    const now = new Set(after.map(edge => edge.id));
    const then = new Set(before.map(expected));
    const keyOf = (ends: (id: string) => string) => (edge: ReadingEdge): Key | undefined =>
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
function signatureOf(genset: ReadingGenset, rename: (id: string) => string): string {
    return [rename(genset.general ?? ''), ...genset.specifics.map(rename).sort()].join(',');
}

function startOf(source: Start): string {
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
 */
export function renameInViewFile(file: ViewFile, renames: Renames): ViewFile {
    return renameInRawViewFile(file, renames) as ViewFile | undefined ?? file;
}

/**
 * A view file as JSON on disk, with its ids renamed, or `undefined` when the
 * renames touch nothing in it.
 *
 * Raw rather than read: a view that is not open is rewritten only because a
 * class it names was renamed, and passing it through `readViewFile` would also
 * fill in every option it leaves to the default and drop whatever it holds
 * that this version does not know -- a diff of the whole file for a change of
 * one name. Only the ids move, each keeping its place among its neighbours.
 *
 * A stale entry already sitting under a new name -- from a class of that name
 * deleted long ago -- gives way to the one renamed into it, which is the one
 * the modeller arranged last.
 */
export function renameInRawViewFile(raw: unknown, renames: Renames): Record<string, unknown> | undefined {
    if (!isRecord(raw)) {
        return undefined;
    }
    let changed = false;
    const keyed = (record: Record<string, unknown>): Record<string, unknown> => {
        const result: Record<string, unknown> = {};
        for (const [id, value] of Object.entries(record)) {
            const next = renamedId(id, renames);
            if (next !== id) {
                changed = true;
                result[next] = value;
            } else if (!(id in result)) {
                result[id] = value;
            }
        }
        return result;
    };
    const patch: Record<string, unknown> = {};
    for (const field of ['nodes', 'edges'] as const) {
        const record = raw[field];
        if (isRecord(record)) {
            patch[field] = keyed(record);
        }
    }
    const content = raw.content;
    if (isRecord(content) && Array.isArray(content.hidden)) {
        const hidden = content.hidden.map((id: unknown) => {
            const next = typeof id === 'string' ? renamedId(id, renames) : id;
            changed ||= next !== id;
            return next;
        });
        patch.content = { ...content, hidden: [...new Set(hidden)] };
    }
    return changed ? { ...raw, ...patch } : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
