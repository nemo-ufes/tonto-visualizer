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

export interface DisplayOptions {
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

export const defaultContentOptions: ContentOptions = {
    showExternalReferences: true,
    showDatatypes: true,
    showGensets: true
};

export const defaultDisplayOptions: DisplayOptions = {
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
