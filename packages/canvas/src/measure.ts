/**
 * How big a card is, and what it is set in.
 *
 * Measured by estimate rather than by asking the browser, because the same
 * numbers have to come out in a webview, in a test and in the command line
 * renderer: a diagram whose boxes are one size in CI and another on screen has
 * two layouts, and the saved one would be wrong in both.
 *
 * Which is also why the font is chosen the way it is. Helvetica, Arial and
 * Liberation Sans are metrically compatible -- the same string occupies the same
 * width in all three -- and between them they cover macOS, Windows and Linux, so
 * one set of estimates is right everywhere and an exported SVG opens the same
 * width it was drawn. A `system-ui` stack resolves to a different face on every
 * platform: measured here, the widest of them ran 18% wider than the narrowest,
 * which is a name over the border of its box on one machine and a lot of empty
 * card on another.
 *
 * The ratios below are the widest measured over a page of real class names,
 * attribute lines and edge labels, plus a few per cent. Erring wide shows as a
 * slightly roomy card and never as text spilling out of one.
 */

import type { ViewNode, ViewRelation, ViewRelationEnd } from 'tonto-view';
import type { DisplayOptions } from 'tonto-view';
import type { Size } from './geometry.js';

export const FONT = {
    family: '"Helvetica Neue", Helvetica, Arial, "Liberation Sans", sans-serif',
    name: 13,
    stereotype: 11,
    attribute: 12,
    edge: 11,
    /** A relation's stereotype, which sits over its name rather than beside it. */
    edgeStereotype: 9.5
} as const;

/** Average advance per character, as a fraction of the size. */
const ADVANCE = 0.53;
const BOLD_ADVANCE = 0.59;

/**
 * Characters are not all one width, and a diagram is full of the two extremes:
 * `[1..*]` is nearly all narrow glyphs, `«characterization»` nearly all wide
 * ones. Counting every character as average made the first far too wide and the
 * second too narrow -- which is a roomy cardinality label and a reading triangle
 * printed on the last letter of a stereotype.
 */
const NARROW = new Set([...'iljtfrI.,;:\'"!|()[]{}/\\-1 ']);
const WIDE = new Set([...'mwMW@%«»&']);
const NARROW_FACTOR = 0.62;
const WIDE_FACTOR = 1.42;

export function textWidth(text: string, size: number, bold = false): number {
    let units = 0;
    for (const character of text) {
        units += NARROW.has(character) ? NARROW_FACTOR : WIDE.has(character) ? WIDE_FACTOR : 1;
    }
    return units * size * (bold ? BOLD_ADVANCE : ADVANCE);
}

export const NODE = {
    minWidth: 120,
    padding: 12,
    headerGap: 4,
    lineHeight: 17,
    stereotypeHeight: 15,
    nameHeight: 19
} as const;

/**
 * A multiplicity as a diagram writes it, or nothing at all.
 *
 * Brackets are Tonto's textual syntax, where a multiplicity has to be told apart
 * from what surrounds it; on a diagram it stands alone at the end of a line and
 * the brackets are two more marks to read. And `1` is what an end means when it
 * says nothing, so writing it says nothing twice -- on a model of any size that
 * is a `1` beside almost every line, which is noise the reader has to look past
 * to find the multiplicities that do say something.
 */
export function multiplicityLabel(cardinality: string | undefined): string | undefined {
    if (!cardinality) {
        return undefined;
    }
    const [lower, upper] = cardinality.split('..');
    if (upper === undefined) {
        return lower === '1' ? undefined : lower;
    }
    if (lower === upper) {
        // `3..3` is three, and `1..1` is the default said twice.
        return lower === '1' ? undefined : lower;
    }
    // `0..*` and `*` are the same range; the shorter is what a diagram uses.
    return lower === '0' && upper === '*' ? '*' : `${lower}..${upper}`;
}

/** The lines of the attribute compartment, as they are drawn. */
export function attributeLines(node: ViewNode, options: DisplayOptions): string[] {
    if (!options.showAttributes) {
        return [];
    }
    if (node.kind === 'enumeration') {
        return node.literals ?? [];
    }
    return node.attributes.map(attribute => {
        const flags = [
            attribute.isOrdered ? 'ordered' : undefined,
            attribute.isConst ? 'const' : undefined,
            attribute.isAddOnly ? 'addOnly' : undefined,
            attribute.isDerived ? 'derived' : undefined
        ].filter(Boolean).join(' ');
        const stereotypes = attribute.stereotypes.map(one => `@${one}`).join(' ');
        // Brackets stay here, where UML puts them and where the multiplicity
        // has a type to be told apart from -- but an explicit `1` is the default
        // written down, and says no more on an attribute than on an end.
        const multiplicity = multiplicityLabel(attribute.cardinality);
        const cardinality = multiplicity ? ` [${multiplicity}]` : '';
        return `${stereotypes ? `${stereotypes} ` : ''}${attribute.name}: ${flags ? `${flags} ` : ''}${attribute.type}${cardinality}`;
    });
}

/** The `«kind»` line, when there is one to draw. */
export function stereotypeLabel(node: ViewNode): string | undefined {
    if (node.kind === 'unresolved') {
        return undefined;
    }
    const powerType = node.isPowerType ? ', powertype' : '';
    return node.stereotype ? `«${node.stereotype}${powerType}»` : undefined;
}

export function nodeLabel(node: ViewNode, options: DisplayOptions): string {
    return options.qualifyNames && node.package ? `${node.package}::${node.name}` : node.name;
}

export function sizeOf(node: ViewNode, options: DisplayOptions): Size {
    const label = nodeLabel(node, options);
    const stereotype = stereotypeLabel(node);
    const lines = attributeLines(node, options);
    const width = Math.max(
        NODE.minWidth,
        textWidth(label, FONT.name, true) + NODE.padding * 2,
        stereotype ? textWidth(stereotype, FONT.stereotype) + NODE.padding * 2 : 0,
        ...lines.map(line => textWidth(line, FONT.attribute) + NODE.padding * 2)
    );
    const header = (stereotype ? NODE.stereotypeHeight : 0) + NODE.nameHeight + NODE.headerGap * 2;
    const body = lines.length > 0 ? lines.length * NODE.lineHeight + NODE.headerGap * 2 : 0;
    return { width: round(width), height: round(header + body) };
}

/** Where ELK should reserve the space the renderer uses for an edge label. */
export interface EdgeLabelFootprint extends Size {
    placement: 'CENTER' | 'HEAD' | 'TAIL';
}

const EDGE_LABEL = {
    stereotypeHeight: 12,
    nameHeight: 14,
    readingMarker: 9,
    lockWidth: 11,
    lockGap: 4,
    endHeight: FONT.edge + 4,
    /** Air for the line that runs between the two sides of an end label. */
    endGap: 12,
    /** UML whole-part diamond, tip to back corner. */
    diamond: 16
} as const;

function endText(end: ViewRelationEnd, options: DisplayOptions): {
    multiplicity?: string;
    role: string;
    lock: boolean;
} {
    const multiplicity = options.showCardinalities ? multiplicityLabel(end.cardinality) : undefined;
    const role: string[] = [];
    if (options.showRoleNames && end.role) {
        role.push(end.role);
    }
    if (options.showEndDecorations) {
        if (end.isAddOnly) {
            role.push('{addOnly}');
        }
        if (end.subsets) {
            role.push(`{subsets ${end.subsets}}`);
        }
        if (end.redefines) {
            role.push(`{redefines ${end.redefines}}`);
        }
    }
    return {
        ...(multiplicity ? { multiplicity } : {}),
        role: role.join(' '),
        lock: options.showEndDecorations && !end.isConst
    };
}

function endFootprint(
    end: ViewRelationEnd,
    whole: boolean,
    placement: 'HEAD' | 'TAIL',
    options: DisplayOptions
): EdgeLabelFootprint | undefined {
    const { multiplicity, role, lock } = endText(end, options);
    const multiplicityWidth = multiplicity ? textWidth(multiplicity, FONT.edge) : 0;
    const roleWidth = textWidth(role, FONT.edge) + (lock ? EDGE_LABEL.lockWidth + EDGE_LABEL.lockGap : 0);
    const contentWidth = multiplicityWidth + roleWidth
        + (multiplicityWidth > 0 && roleWidth > 0 ? EDGE_LABEL.endGap : 0);
    const width = Math.max(contentWidth, whole ? EDGE_LABEL.diamond : 0);
    if (width === 0) {
        return undefined;
    }
    return {
        placement,
        width: round(width),
        height: Math.max(EDGE_LABEL.endHeight, whole ? EDGE_LABEL.diamond : 0)
    };
}

/**
 * The label boxes an association adds after its line is routed.
 *
 * ELK does not draw these labels, but feeding it the same measurements stops it
 * from placing neighbouring cards in the space the renderer will immediately
 * need. An inverse pair is measured as the one line the renderer uses for both
 * declarations, including ends filled in by the declaration not drawn.
 */
export function relationLabelFootprints(
    edge: ViewRelation,
    options: DisplayOptions,
    partner?: ViewRelation
): EdgeLabelFootprint[] {
    // The derived view always supplies ends. Keeping measurement tolerant makes
    // it useful for small hand-built graphs in callers and tests as well.
    const emptyEnd: ViewRelationEnd = { isConst: true, isAddOnly: false };
    const merge = (one: ViewRelationEnd, other: ViewRelationEnd): ViewRelationEnd => ({ ...other, ...one });
    const sourceEnd = partner
        ? merge(edge.sourceEnd ?? emptyEnd, partner.targetEnd ?? emptyEnd)
        : edge.sourceEnd ?? emptyEnd;
    const targetEnd = partner
        ? merge(edge.targetEnd ?? emptyEnd, partner.sourceEnd ?? emptyEnd)
        : edge.targetEnd ?? emptyEnd;
    const whole = edge.whole ?? (partner?.whole === 'source' ? 'target' : partner?.whole === 'target' ? 'source' : undefined);

    const readings = [edge, ...(partner ? [partner] : [])].map((one, index) => ({
        stereotype: options.showRelationStereotypes && one.stereotype
            && !(index === 1 && edge.stereotype === one.stereotype)
            ? `«${one.stereotype}»`
            : undefined,
        name: options.showRelationNames ? one.name : undefined
    }));
    const visibleReadings = readings.filter(one => one.stereotype || one.name);
    const centre = visibleReadings.length > 0
        ? {
            placement: 'CENTER' as const,
            width: round(Math.max(...visibleReadings.map(one => Math.max(
                one.name ? textWidth(one.name, FONT.edge) * 1.02 + EDGE_LABEL.readingMarker : 0,
                one.stereotype ? textWidth(one.stereotype, FONT.edgeStereotype) : 0
            )))),
            height: visibleReadings.reduce((height, one) => height
                + (one.stereotype ? EDGE_LABEL.stereotypeHeight : 0)
                + (one.name ? EDGE_LABEL.nameHeight : 0), 0)
        }
        : undefined;

    return [
        centre,
        endFootprint(sourceEnd, whole === 'source', 'TAIL', options),
        endFootprint(targetEnd, whole === 'target', 'HEAD', options)
    ].filter((one): one is EdgeLabelFootprint => one !== undefined);
}

/** Sizes stay whole numbers, so a saved layout is not a page of decimals. */
function round(value: number): number {
    return Math.round(value);
}
