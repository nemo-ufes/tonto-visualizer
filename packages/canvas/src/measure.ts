/**
 * How big a card is.
 *
 * Measured by estimate rather than by asking the browser, because the same
 * numbers have to come out in a webview, in a test and in the command line
 * renderer: a diagram whose boxes are one size in CI and another on screen has
 * two layouts, and the saved one would be wrong in both.
 *
 * The estimate is the average advance width of the UI sans stack at a given
 * size. It is a little generous on narrow text, which shows as slightly wide
 * boxes and never as a name spilling out of one.
 */

import type { ViewNode } from 'tonto-view';
import type { DisplayOptions } from 'tonto-view';
import type { Size } from './geometry.js';

export const FONT = {
    name: 13,
    stereotype: 11,
    attribute: 12,
    edge: 11
} as const;

const AVERAGE_ADVANCE = 0.58;
const BOLD_ADVANCE = 0.62;

export function textWidth(text: string, size: number, bold = false): number {
    return text.length * size * (bold ? BOLD_ADVANCE : AVERAGE_ADVANCE);
}

export const NODE = {
    minWidth: 120,
    padding: 12,
    headerGap: 4,
    lineHeight: 17,
    stereotypeHeight: 15,
    nameHeight: 19
} as const;

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
        const cardinality = attribute.cardinality ? ` [${attribute.cardinality}]` : '';
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

/** Sizes stay whole numbers, so a saved layout is not a page of decimals. */
function round(value: number): number {
    return Math.round(value);
}
