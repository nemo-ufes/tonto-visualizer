/**
 * The options, in two groups, because they cost different things.
 *
 * `ContentOptions` decide what is *in* the view -- which packages, whether
 * external elements are drawn at all -- so changing one re-derives the model
 * from the AST. `DisplayOptions` decide how what is there is drawn, and the
 * canvas applies them to a model it already has, which is why toggling
 * cardinalities is instant and does not disturb a hand-made arrangement.
 *
 * Both are written to the `.tontoview` file: a view is its content and its
 * appearance together, and reopening one should not need either restating.
 */

export interface ContentOptions {
    /** Draw elements from packages outside the view that something in it points at. */
    showExternalReferences: boolean;
    /** Draw datatypes and enumerations, and the attributes typed by them. */
    showDatatypes: boolean;
    /** Draw generalization sets as a shared triangle. */
    showGensets: boolean;
    /** Restrict the view to these packages. All of them when absent. */
    includedPackages?: string[];
    /** Element ids the modeller has hidden by hand. */
    hidden?: string[];
}

/** How an edge gets from one box to the other. */
export type RoutingStyle = 'straight' | 'orthogonal';

export interface DisplayOptions {
    /**
     * Straight by default: a direct line says "these two" at a glance, and a
     * model with many associations drawn with right angles turns into a set of
     * corridors that read as the diagram. Orthogonal suits a taxonomy and is a
     * choice rather than the default.
     */
    routing: RoutingStyle;
    showAttributes: boolean;
    showCardinalities: boolean;
    showRelationNames: boolean;
    showRelationStereotypes: boolean;
    /** `subsets`, `redefines`, `const`, `addOnly` on the ends that carry them. */
    showEndDecorations: boolean;
    showRoleNames: boolean;
    /** Fill elements with their nature colour; off is monochrome. */
    showColors: boolean;
    /** Box each package. */
    showPackageGroups: boolean;
    /** Write `University::Room` rather than `Room` on the card. */
    qualifyNames: boolean;
    /** Show `///` documentation on hover. */
    showDocumentation: boolean;
}

/**
 * How the automatic arrangement is made, when it is asked for.
 *
 * Separate from the display options because it is not applied to a diagram that
 * exists: it decides where things go the first time, and again whenever the
 * modeller asks for the whole thing to be arranged.
 */
export interface LayoutOptions {
    /**
     * `layered` ranks the taxonomy, which is what most models are read by.
     * `stress` spreads a densely associated model without ranking it, `mrtree`
     * is for a model that really is a tree, and `radial` puts one thing in the
     * middle.
     */
    algorithm: 'layered' | 'stress' | 'mrtree' | 'radial' | 'force';
    /** Which way generalizations point. Down is what a class diagram is read as. */
    direction: 'DOWN' | 'RIGHT';
    /** Between neighbours in a rank. */
    nodeSpacing: number;
    /** Between one rank and the next -- a supertype and its subtypes. */
    rankSpacing: number;
    /**
     * Lay each package out as a unit, so its classes stay together.
     *
     * What a package box is for, and not free: a class that would sit beside the
     * one it specializes has to stay inside its own package instead, and the
     * line between them crosses whatever is in the way. Turning it off lays the
     * model out as one graph; the boxes, if drawn, are then drawn around
     * wherever the classes ended up.
     */
    groupByPackage: boolean;
}

export const defaultLayoutOptions: LayoutOptions = {
    algorithm: 'layered',
    direction: 'DOWN',
    nodeSpacing: 60,
    rankSpacing: 100,
    groupByPackage: true
};

export const defaultContentOptions: ContentOptions = {
    showExternalReferences: true,
    showDatatypes: true,
    showGensets: true
};

export const defaultDisplayOptions: DisplayOptions = {
    routing: 'straight',
    showAttributes: true,
    showCardinalities: true,
    showRelationNames: true,
    showRelationStereotypes: true,
    showEndDecorations: true,
    showRoleNames: true,
    showColors: true,
    showPackageGroups: true,
    qualifyNames: false,
    showDocumentation: true
};
