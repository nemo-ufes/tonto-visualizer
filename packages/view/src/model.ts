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

/**
 * `package` is a package diagram's card: a member package of an ontology, or
 * an ontology the manifest imports, drawn as the package it is to its importer.
 */
export type NodeKind = 'class' | 'datatype' | 'enumeration' | 'unresolved' | 'package';

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
    /**
     * What a historical role is derived from (`derivedFrom
     * Student.graduatedIn`): the `@participation`, `@creation` or
     * `@termination` it names, by edge id, or the event type, by node id.
     * The two never share an id, so one list says which each is. Only what is
     * already in the view, as for a relation's.
     */
    derivedFrom?: string[];
    /**
     * Where a package diagram's card is read from: the document a bundle
     * entry names, or the location an ontology is imported from. A manifest
     * is a list of these, and the picture of one should say them too.
     */
    location?: string;
    /** A bundled package or an imported ontology that did not load. */
    unavailable?: boolean;
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
    /**
     * What the relation is derived from (`derivedFrom Employment`): the
     * relator a material relation is read off, or the qualities a comparative
     * one compares, by node id. Only classes already in the view: a
     * derivation is drawn between things on the page, and does not bring a
     * relator from another package onto it.
     */
    derivedFrom?: string[];
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

/**
 * A package diagram's dependency: `use core`, which lets one package of an
 * ontology refer to another, or `import shop from <...>`, which brings in
 * another ontology. The client of an import the manifest declares for every
 * member is the ontology itself, so `source` may be the id of an ontology
 * group rather than of a card.
 */
export interface ViewDependency {
    kind: 'dependency';
    id: string;
    source: string;
    target: string;
    stereotype: 'use' | 'import';
    /** The alias an import binds, when it is not the imported ontology's own name. */
    name?: string;
    source_?: SourceLocation;
}

export type ViewEdge = ViewGeneralization | ViewRelation | ViewInstantiation | ViewDependency;

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
    /**
     * `ontology` in a package diagram: the ontology that owns the packages
     * inside, drawn as the UML package that holds them. It is what the
     * diagram is of rather than a grouping laid over it, so it is drawn
     * whether or not package boxes are.
     */
    kind?: 'ontology';
}

export interface ViewModel {
    /**
     * `packages` for an ontology manifest's diagram: its packages, the
     * ontologies it imports, and the dependencies between them. Absent for a
     * class diagram, which is every other view.
     */
    kind?: 'packages';
    /** The package the view is centred on, when it is centred on one. */
    focus?: string;
    groups: ViewGroup[];
    nodes: ViewNode[];
    edges: ViewEdge[];
    gensets: ViewGenset[];
}
