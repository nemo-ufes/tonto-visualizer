import type { Theme } from 'tonto-canvas/draw';
import { darkTheme, lightTheme } from 'tonto-canvas/draw';

export type DiagramBackground = 'editor' | 'white' | 'black';

export function isDiagramBackground(value: unknown): value is DiagramBackground {
    return value === 'editor' || value === 'white' || value === 'black';
}

/** The paper and ink change together; nature fills keep their ontology colours. */
export function diagramTheme(background: DiagramBackground, editorIsDark: boolean): Theme {
    if (background === 'white') {
        return { ...lightTheme, background: '#ffffff' };
    }
    if (background === 'black') {
        return { ...darkTheme, background: '#000000' };
    }
    return editorIsDark ? darkTheme : lightTheme;
}
