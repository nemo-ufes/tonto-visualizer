/**
 * The AST, read as a diagram.
 *
 * One walk over the packages in scope produces every node, edge, group and
 * generalization set, with ids that survive the text being edited around them.
 * Nothing here knows about layout, SVG or VS Code: this is the half that can be
 * tested with a string of Tonto and a golden file.
 */

import type { AstNode } from 'langium';
import { AstUtils } from 'langium';
import type {
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
} from './language.js';
import {
    getEffectiveNatures,
    getRelationSource,
    isClassDeclaration,
    isDatatype,
    isEnumeration,
    isExternalRelation,
    isGeneralizationSet,
    isParthood,
    wholeEndOf
} from './language.js';
import { colorOf, DATATYPE_COLOR, UNRESOLVED_COLOR } from './natures.js';
import { generalizationId, gensetId, instantiationId, qualify, RelationIds } from './ids.js';
import type { ContentOptions } from './options.js';
import { defaultContentOptions } from './options.js';
import type {
    SourceLocation,
    ViewAttribute,
    ViewEdge,
    ViewGenset,
    ViewGroup,
    ViewModel,
    ViewNode,
    ViewRelationEnd
} from './model.js';

export interface DeriveInput {
    /** Every parsed model in the workspace. What is drawn is decided by the options. */
    models: Model[];
    options?: Partial<ContentOptions>;
    /** The package the view is centred on, when the view follows one file. */
    focus?: string;
    /** `///` documentation, which the language reads from hidden tokens. */
    documentation?: (node: AstNode) => string | undefined;
}

export function derive(input: DeriveInput): ViewModel {
    return new Derivation(input).run();
}

class Derivation {
    private readonly options: ContentOptions;
    private readonly hidden: Set<string>;
    private readonly nodes = new Map<string, ViewNode>();
    private readonly edges: ViewEdge[] = [];
    private readonly gensets: ViewGenset[] = [];
    private readonly groups = new Map<string, ViewGroup>();
    /** Ids handed out during the walk, so a generalization set can name what it groups. */
    private readonly idOf = new Map<AstNode, string>();
    private readonly relationIds = new RelationIds();
    /** Packages inside the view, as AST nodes, so containment is an identity test. */
    private readonly included = new Set<Package>();

    constructor(private readonly input: DeriveInput) {
        this.options = { ...defaultContentOptions, ...input.options };
        this.hidden = new Set(this.options.hidden ?? []);
    }

    run(): ViewModel {
        const packages = this.input.models.flatMap(model => model.packages);
        const included = this.options.includedPackages ? new Set(this.options.includedPackages) : undefined;
        for (const one of packages) {
            if (one.name !== undefined && (!included || included.has(one.name))) {
                this.included.add(one);
            }
        }

        for (const one of this.included) {
            this.walkPackage(one);
        }
        // Second pass: a generalization set names classes and relations, and the
        // ids it names are only known once the walk that hands them out is done.
        for (const one of this.included) {
            for (const declaration of one.declarations) {
                if (isGeneralizationSet(declaration)) {
                    this.addGenset(declaration, one);
                }
            }
        }

        return {
            ...(this.input.focus ? { focus: this.input.focus } : {}),
            groups: [...this.groups.values()].filter(group => group.nodes.length > 0),
            nodes: [...this.nodes.values()],
            edges: this.edges.filter(edge => this.nodes.has(edge.source) && this.nodes.has(edge.target)),
            gensets: this.options.showGensets ? this.gensets : []
        };
    }

    private walkPackage(one: Package): void {
        for (const declaration of one.declarations) {
            if (isClassDeclaration(declaration)) {
                this.addClass(declaration, false);
            } else if (isDatatype(declaration) || isEnumeration(declaration)) {
                if (this.options.showDatatypes) {
                    this.addValueType(declaration, false);
                }
            } else if (isExternalRelation(declaration)) {
                this.addRelation(declaration);
            }
        }
        // Relations declared inside a class body are walked after the
        // declarations of the package, so both ends usually exist as nodes by
        // the time an edge mentions them. Whichever end is still missing is
        // added on demand, as external or unresolved.
        for (const declaration of one.declarations) {
            if (isClassDeclaration(declaration)) {
                for (const relation of declaration.relations) {
                    this.addRelation(relation);
                }
            }
        }
    }

    private addClass(declaration: ClassDeclaration, isExternal: boolean): string | undefined {
        const id = this.declarationId(declaration);
        if (this.hidden.has(id)) {
            return undefined;
        }
        const existing = this.nodes.get(id);
        if (existing) {
            // A class first met as the far end of a relation is a placeholder
            // until its own package is walked; walking it fills the card in.
            if (existing.isExternal && !isExternal) {
                this.nodes.delete(id);
            } else {
                return id;
            }
        }

        this.idOf.set(declaration, id);
        const natures = this.naturesOf(declaration);
        this.put({
            id,
            kind: 'class',
            name: declaration.name,
            package: declaration.$container.name ?? undefined,
            stereotype: declaration.stereotype,
            ...(natures ? { natures } : {}),
            color: colorOf(declaration),
            isExternal,
            ...(declaration.isPowerType ? { isPowerType: true } : {}),
            attributes: this.attributesOf(declaration.attributes),
            ...this.documentedAt(declaration)
        });

        // An element from outside the view is drawn because something inside
        // points at it, and it is drawn as a card and nothing more. Following
        // its own supertypes and relations would walk out of the view one
        // generalization at a time and quietly bring a whole other package back.
        if (isExternal) {
            return id;
        }

        for (const parent of declaration.specializes) {
            const target = parent.ref
                ? this.reference(parent.ref)
                : this.unresolved(parent.$refText);
            if (target) {
                this.edges.push({ kind: 'generalization', id: generalizationId(id, target), source: id, target });
            }
        }

        const instantiated = declaration.instanceOf;
        if (instantiated) {
            const target = instantiated.ref
                ? this.reference(instantiated.ref)
                : this.unresolved(instantiated.$refText);
            if (target) {
                this.edges.push({ kind: 'instantiation', id: instantiationId(id, target), source: id, target });
            }
        }

        return id;
    }

    private addValueType(declaration: Datatype | Enumeration, isExternal: boolean): string | undefined {
        const id = this.declarationId(declaration);
        if (this.hidden.has(id)) {
            return undefined;
        }
        if (this.nodes.has(id)) {
            return id;
        }
        this.idOf.set(declaration, id);
        const isEnum = isEnumeration(declaration);
        this.put({
            id,
            kind: isEnum ? 'enumeration' : 'datatype',
            name: declaration.name,
            package: declaration.$container.name ?? undefined,
            stereotype: isEnum ? 'enum' : 'datatype',
            color: DATATYPE_COLOR,
            isExternal,
            attributes: this.attributesOf(declaration.attributes),
            ...(isEnum ? { literals: declaration.literals.map(literal => literal.name) } : {}),
            ...this.documentedAt(declaration)
        });

        if (isExternal) {
            return id;
        }

        for (const parent of declaration.specializes) {
            const target = parent.ref ? this.reference(parent.ref) : this.unresolved(parent.$refText);
            if (target) {
                this.edges.push({ kind: 'generalization', id: generalizationId(id, target), source: id, target });
            }
        }
        return id;
    }

    private addRelation(relation: Relation): void {
        const sourceNode = getRelationSource(relation);
        const source = sourceNode
            ? this.reference(sourceNode)
            : this.unresolved(isExternalRelation(relation) ? relation.source?.$refText : undefined);
        const target = relation.target?.ref
            ? this.reference(relation.target.ref)
            : this.unresolved(relation.target?.$refText);
        if (!source || !target) {
            return;
        }

        const id = this.relationIds.next(source, target, relation.stereotype, relation.name);
        this.idOf.set(relation, id);
        const whole = isParthood(relation) ? wholeEndOf(relation) : undefined;
        this.edges.push({
            kind: 'relation',
            id,
            source,
            target,
            ...(relation.stereotype ? { stereotype: relation.stereotype } : {}),
            ...(relation.name ? { name: relation.name } : {}),
            sourceEnd: this.endOf(relation.sourceMeta, cardinality(relation.sourceCardinality), whole === 'source'),
            targetEnd: this.endOf(relation.targetMeta, cardinality(relation.targetCardinality), whole === 'target'),
            ...(whole ? { whole } : {}),
            ...(relation.inverseOf?.$refText ? { inverseOf: relation.inverseOf.$refText } : {}),
            ...(relation.specializes?.$refText ? { specializes: relation.specializes.$refText } : {}),
            ...this.documentedRelation(relation)
        });
    }

    private addGenset(declaration: GeneralizationSet, owner: Package): void {
        const id = gensetId(owner.name, declaration.name);
        const general = declaration.general?.ref ? this.idOf.get(declaration.general.ref) : undefined;
        const specifics = declaration.specifics
            .map(specific => (specific.ref ? this.idOf.get(specific.ref) : undefined))
            .filter((value): value is string => value !== undefined);
        const categorizers = declaration.categorizers
            .map(categorizer => (categorizer.ref ? this.idOf.get(categorizer.ref) : undefined))
            .filter((value): value is string => value !== undefined);

        this.gensets.push({
            id,
            name: declaration.name,
            disjoint: declaration.disjoint,
            complete: declaration.complete,
            ...(general ? { general } : {}),
            specifics,
            categorizers,
            ...this.locatedAt(declaration)
        });

        // The generalizations the set groups are already edges; marking them is
        // what lets the canvas draw one shared triangle instead of several.
        if (general) {
            for (const specific of specifics) {
                const edge = this.edges.find(
                    candidate => candidate.kind === 'generalization'
                        && candidate.source === specific
                        && candidate.target === general
                );
                if (edge && edge.kind === 'generalization') {
                    edge.genset = id;
                }
            }
        }
    }

    /**
     * The id of something an edge points at, adding it to the view when it is
     * outside the packages in scope.
     */
    private reference(node: RelationEndTarget): string | undefined {
        const known = this.idOf.get(node);
        if (known) {
            return known;
        }
        const inScope = this.included.has(node.$container);
        if (!inScope && !this.options.showExternalReferences) {
            return undefined;
        }
        if (isClassDeclaration(node)) {
            return this.addClass(node, !inScope);
        }
        if (!this.options.showDatatypes) {
            return undefined;
        }
        return this.addValueType(node, !inScope);
    }

    /**
     * A name the linker could not resolve still says something, so it is drawn
     * -- as a ghost card rather than as a silently missing edge, which is the
     * difference between a diagram that keeps up with typing and one that
     * blinks out halfway through a word.
     */
    private unresolved(refText: string | undefined): string | undefined {
        if (!refText || !this.options.showExternalReferences) {
            return undefined;
        }
        const id = refText.replaceAll('.', '::');
        if (this.hidden.has(id)) {
            return undefined;
        }
        if (!this.nodes.has(id)) {
            this.put({
                id,
                kind: 'unresolved',
                name: id.slice(id.lastIndexOf('::') + 2),
                ...(id.includes('::') ? { package: id.slice(0, id.lastIndexOf('::')) } : {}),
                color: UNRESOLVED_COLOR,
                isExternal: true,
                attributes: []
            });
        }
        return id;
    }

    private put(node: ViewNode): void {
        this.nodes.set(node.id, node);
        const groupName = node.package ?? '';
        const group = this.groups.get(groupName) ?? {
            id: `pkg:${groupName}`,
            name: groupName,
            isExternal: node.isExternal,
            nodes: []
        };
        group.isExternal = group.isExternal && node.isExternal;
        group.nodes.push(node.id);
        this.groups.set(groupName, group);
    }

    private declarationId(declaration: ClassDeclaration | Datatype | Enumeration): string {
        return qualify(declaration.$container.name, declaration.name);
    }

    private naturesOf(declaration: ClassDeclaration): ViewNode['natures'] {
        const effective = getEffectiveNaturesSafely(declaration);
        if (!effective) {
            return undefined;
        }
        return {
            natures: [...effective.natures],
            origin: effective.origin,
            ...(effective.from ? { from: effective.from.name } : {})
        };
    }

    private attributesOf(attributes: Attribute[]): ViewAttribute[] {
        return attributes.map(attribute => ({
            name: attribute.name,
            type: attribute.type?.ref?.name ?? attribute.type?.$refText ?? '?',
            ...(attribute.cardinality ? { cardinality: cardinality(attribute.cardinality) } : {}),
            stereotypes: [...attribute.stereotypes],
            isOrdered: attribute.isOrdered,
            isConst: attribute.isConst,
            isAddOnly: attribute.isAddOnly,
            isDerived: attribute.isDerived
        }));
    }

    private endOf(
        meta: RelationEndMetaAttributes | undefined,
        card: string | undefined,
        isWhole: boolean
    ): ViewRelationEnd {
        return {
            ...(card ? { cardinality: card } : {}),
            ...(meta?.name ? { role: meta.name } : {}),
            isConst: meta?.isConst ?? false,
            isAddOnly: meta?.isAddOnly ?? false,
            ...(meta?.subsets?.$refText ? { subsets: meta.subsets.$refText } : {}),
            ...(meta?.redefines?.$refText ? { redefines: meta.redefines.$refText } : {}),
            ...(isWhole ? { isWhole: true } : {})
        };
    }

    private documentedAt(node: AstNode): { documentation?: string; source?: SourceLocation } {
        const documentation = this.input.documentation?.(node);
        return {
            ...(documentation ? { documentation } : {}),
            ...this.locatedAt(node)
        };
    }

    private documentedRelation(node: AstNode): { documentation?: string; source_?: SourceLocation } {
        const documentation = this.input.documentation?.(node);
        const location = this.locatedAt(node);
        return {
            ...(documentation ? { documentation } : {}),
            ...(location.source ? { source_: location.source } : {})
        };
    }

    private locatedAt(node: AstNode): { source?: SourceLocation } {
        const range = node.$cstNode?.range;
        if (!range) {
            return {};
        }
        return {
            source: {
                uri: AstUtils.getDocument(node).uri.toString(),
                line: range.start.line,
                character: range.start.character,
                endLine: range.end.line,
                endCharacter: range.end.character
            }
        };
    }
}

/**
 * `getEffectiveNatures` walks ancestors, and a model being typed can hold a
 * cycle for a keystroke or two. A diagram is not the place that reports it.
 */
function getEffectiveNaturesSafely(declaration: ClassDeclaration) {
    try {
        return getEffectiveNatures(declaration);
    } catch {
        return undefined;
    }
}

function cardinality(value: { lowerBound: number | string; upperBound?: number | string } | undefined): string | undefined {
    if (!value) {
        return undefined;
    }
    return value.upperBound === undefined ? `${value.lowerBound}` : `${value.lowerBound}..${value.upperBound}`;
}
