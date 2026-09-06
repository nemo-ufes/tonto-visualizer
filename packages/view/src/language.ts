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
 */

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
    isRelation
} from 'tonto-language';

export { getRelationSource, isParthood, wholeEndOf } from 'tonto-language';

// eslint-disable-next-line no-restricted-imports -- see the note above.
export { getEffectiveNatures } from '../../../vendor/tontoredesign/packages/language/out/utils/natures.js';
export type { EffectiveNatures, NatureOrigin } from '../../../vendor/tontoredesign/packages/language/out/utils/natures.js';
export { isUltimateSortal } from '../../../vendor/tontoredesign/packages/language/out/validation/stereotype-model.js';
