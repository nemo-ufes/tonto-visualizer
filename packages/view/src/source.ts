import type { SourceLocation, ViewModel } from './model.js';

/** Diagram elements whose declarations cover an editor line. */
export function idsAtSource(view: ViewModel, uri: string, line: number): string[] {
    const located: Array<{ id: string; source?: SourceLocation }> = [
        ...view.nodes.map(node => ({ id: node.id, source: node.source })),
        ...view.edges
            .filter(edge => edge.kind === 'relation' || edge.kind === 'dependency')
            .map(edge => ({ id: edge.id, source: edge.source_ }))
    ];
    return located
        .filter(element => element.source
            && element.source.uri === uri
            && line >= element.source.line
            && line <= element.source.endLine)
        .map(element => element.id);
}
