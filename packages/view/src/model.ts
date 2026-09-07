/**
 * The diagram, as data.
 *
 * This is what the canvas draws, what the layout places and what a `.tontoview`
 * file has positions for. It is deliberately not the AST: an AST node is a
 * place in a text, and a diagram element is a thing with an identity that must
 * survive the text being edited around it -- see `ids.ts`.
 */

/** Where a diagram element was written, so clicking it can open the text. */
export interface SourceLocation {
    uri: string;
    line: number;
    character: number;
    endLine: number;
    endCharacter: number;
}

export type NodeKind = 'class' | 'datatype' | 'enumeration' | 'unresolved';

/** One attribute line inside a node's compartment. */
export interface ViewAttribute {
    name: string;
    type: string;
    cardinality?: string;
    /** `@begin`, `@end`. */
    stereotypes: string[];
    isOrdered: boolean;
    isConst: boolean;
    isAddOnly: boolean;
    isDerived: boolean;
}

export interface ViewNode {
    id: string;
    kind: NodeKind;
    name: string;
    /** The package the declaration is written in, or `undefined` when unresolved. */
    package?: string;
    /** `kind`, `role`, `relator`, ... For a datatype or enumeration, the keyword. */
    stereotype?: string;
    /** The natures the instances can have, and where that restriction came from. */
    natures?: { natures: string[]; origin: string; from?: string };
    /** Fill colour, from the natures. Kinds take the full tone, their subtypes a lighter one. */
    color: string;
    /** True when the element is drawn only because something in scope points at it. */
    isExternal: boolean;
    /** Cardelli's reading: the instances are every specialization of the base. */
    isPowerType?: boolean;
    attributes: ViewAttribute[];
    /** Enumeration literals, in declaration order. */
    literals?: string[];
    documentation?: string;
    source?: SourceLocation;
}

/** One end of a relation, as the notation writes it. */
export interface ViewRelationEnd {
    cardinality?: string;
    /** The role name, i.e. the property this end is of the opposite classifier. */
    role?: string;
    isConst: boolean;
    isAddOnly: boolean;
    subsets?: string;
    redefines?: string;
    /** Set on the end carrying the whole-part diamond. */
    isWhole?: boolean;
}

export interface ViewGeneralization {
    kind: 'generalization';
    id: string;
    source: string;
    target: string;
    /** The generalization set this specialization belongs to, when it belongs to one. */
    genset?: string;
    /**
     * Where the specialization is written: the parent's name inside the child's
     * declaration, since Tonto states the two together and a generalization has
     * no line of its own to open. Named as a relation names it, because
     * `source` is taken by the end the line runs from.
     */
    source_?: SourceLocation;
}

export interface ViewRelation {
    kind: 'relation';
    id: string;
    source: string;
    target: string;
    /** `mediation`, `material`, `componenthood`, ... */
    stereotype?: string;
    name?: string;
    sourceEnd: ViewRelationEnd;
    targetEnd: ViewRelationEnd;
    /** A parthood is drawn with a diamond; this says which end holds it. */
    whole?: 'source' | 'target';
    /**
     * The id of the relation this one is the inverse of, on both halves of the
     * pair however the model wrote it. The two state one association twice, so
     * a drawing may show them as one line.
     */
    inverseOf?: string;
    specializes?: string;
    documentation?: string;
    source_?: SourceLocation;
}

/** `type PersonType (instanceOf Person)` -- the MLT layer. */
export interface ViewInstantiation {
    kind: 'instantiation';
    id: string;
    source: string;
    target: string;
}

export type ViewEdge = ViewGeneralization | ViewRelation | ViewInstantiation;

/**
 * A generalization set: one triangle shared by several specializations, which
 * is the notation OntoUML uses most and the reason this repository draws its
 * own diagrams instead of asking PlantUML for one.
 */
export interface ViewGenset {
    id: string;
    name: string;
    disjoint: boolean;
    complete: boolean;
    general?: string;
    specifics: string[];
    categorizers: string[];
    source?: SourceLocation;
}

/** A package box. Groups nest only one level: a package holds declarations. */
export interface ViewGroup {
    id: string;
    name: string;
    isExternal: boolean;
    nodes: string[];
}

export interface ViewModel {
    /** The package the view is centred on, when it is centred on one. */
    focus?: string;
    groups: ViewGroup[];
    nodes: ViewNode[];
    edges: ViewEdge[];
    gensets: ViewGenset[];
}
