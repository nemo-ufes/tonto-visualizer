/**
 * Everything this package borrows from the language, named in one place.
 *
 * Two kinds of import live here. What `tonto-language` exports by name comes
 * through the package name. What it does not -- the nature reasoning and the
 * stereotype model, which are internal to that package's `exports` map -- comes
 * through a path into the submodule, because the alternative is a second copy
 * of the reasoning that decides what colour a class is, and a picture that
 * disagrees with the validator is worse than no picture.
 *
 * If that package ever widens its exports, this file is the only one to change.
 *
 * The one exception is ontology ownership -- which package a bundle entry
 * selects, which ontology an import loads -- decided by the language's
 * publication workspace. That module reads the file system, so it is borrowed
 * in `session.ts`, which runs only in Node, and not here.
 */

import type { Relation as LanguageRelation } from 'tonto-language';

export type {
    Attribute,
    ClassDeclaration,
    Datatype,
    Enumeration,
    GeneralizationSet,
    Model,
    Package,
    Relation,
    RelationEndMetaAttributes,
    RelationEndTarget
} from 'tonto-language';

export {
    isClassDeclaration,
    isDatatype,
    isEnumeration,
    isExternalRelation,
    isGeneralizationSet,
    isModel,
    isOntologyBody,
    isRelation
} from 'tonto-language';

export { getRelationSource, isParthood, wholeEndOf } from 'tonto-language';

// eslint-disable-next-line no-restricted-imports -- see the note above.
export { getEffectiveNatures } from '../../../vendor/tontoredesign/packages/language/out/utils/natures.js';
export type { EffectiveNatures, NatureOrigin } from '../../../vendor/tontoredesign/packages/language/out/utils/natures.js';
export { isUltimateSortal } from '../../../vendor/tontoredesign/packages/language/out/validation/stereotype-model.js';

/**
 * The agreement part of the language's inverse-end rule, kept browser-safe.
 * Importing the whole validator here would pull its Node-only workspace API
 * into the webview bundle.
 */
export function inverseEndsAgree(relation: LanguageRelation, inverse: LanguageRelation): boolean {
    const facts = (side: 'source' | 'target', of: LanguageRelation) => {
        const cardinality = side === 'source' ? of.sourceCardinality : of.targetCardinality;
        const meta = side === 'source' ? of.sourceMeta : of.targetMeta;
        const lower = cardinality?.lowerBound;
        const upper = cardinality?.upperBound;
        // These are the same normalized bounds used by the validator: omitted
        // means exactly one and `[*]` means zero to unbounded.
        const bounds = lower === undefined ? { lower: 1, upper: 1 }
            : lower === '*' && upper === undefined ? { lower: 0, upper: Infinity }
                : {
                    lower: Number(lower),
                    upper: upper === '*' ? Infinity : Number(upper ?? lower)
                };
        return {
            ...bounds,
            flags: [meta?.isConst ? 'isConst' : '', meta?.isAddOnly ? 'isAddOnly' : ''].filter(Boolean).join(','),
            name: meta?.name
        };
    };
    const agree = (one: ReturnType<typeof facts>, other: ReturnType<typeof facts>) =>
        one.lower === other.lower && one.upper === other.upper && one.flags === other.flags
        && (one.name === undefined || other.name === undefined || one.name === other.name);
    return agree(facts('source', relation), facts('target', inverse))
        && agree(facts('target', relation), facts('source', inverse));
}
