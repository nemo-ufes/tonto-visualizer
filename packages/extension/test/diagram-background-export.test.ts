import { beforeEach, describe, expect, test, vi } from 'vitest';
import { defaultDisplayOptions, defaultLayoutOptions } from 'tonto-view';
import type { FromPanel } from '../src/protocol.js';

const api = vi.hoisted(() => ({
    writeFile: vi.fn(),
    showSaveDialog: vi.fn(),
    showQuickPick: vi.fn(),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    activeColorTheme: { kind: 2 }
}));
vi.mock('vscode', () => ({
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3 },
    workspace: { fs: { writeFile: api.writeFile } },
    window: api
}));
import { DiagramPanel } from '../src/diagram-panel.js';

interface PanelHarness {
    receive(message: FromPanel): Promise<void>;
    exportDiagram(format?: 'svg' | 'png'): Promise<void>;
    rasterise(svg: string): Promise<Uint8Array>;
}

function panel(): PanelHarness {
    // Exercise the real message and export paths without opening an editor.
    return Object.assign(Object.create(DiagramPanel.prototype), {
        background: 'editor',
        panel: { webview: { postMessage: vi.fn() } },
        store: { state: { edges: {}, display: defaultDisplayOptions, layout: defaultLayoutOptions } },
        positions: { Person: { x: 0, y: 0, width: 160, height: 60 } },
        view: {
            groups: [], gensets: [], edges: [],
            nodes: [{ id: 'Person', name: 'Person', kind: 'class', package: 'Sample', color: '#eeeeee', attributes: [], isExternal: false }]
        }
    });
}

describe('the background used by export commands', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        api.activeColorTheme.kind = 2;
        api.showSaveDialog.mockResolvedValue({ path: '/diagram.svg', fsPath: '/diagram.svg' });
        api.showQuickPick.mockResolvedValue({ background: 'diagram' });
        api.writeFile.mockResolvedValue(undefined);
    });

    test.each([['white', '#ffffff'], ['black', '#000000']] as const)('exports %s after a chooser message', async (background, paper) => {
        const subject = panel();
        await subject.receive({ type: 'background', background });
        await subject.exportDiagram('svg');
        expect(api.showErrorMessage).not.toHaveBeenCalled();
        const svg = Buffer.from(api.writeFile.mock.calls[0]![1]).toString();
        expect(svg).toContain(`fill="${paper}"`);
        expect(svg).toContain('fill="#eeeeee"');
    });

    test('restores a white background from ready before exporting PNG', async () => {
        const subject = panel();
        const rasterise = vi.fn(async (_svg: string) => Buffer.from('raster result'));
        subject.rasterise = rasterise;
        await subject.receive({ type: 'ready', background: 'white' });
        await subject.exportDiagram('png');
        expect(rasterise.mock.calls[0]![0]).toContain('fill="#ffffff"');
        expect(api.writeFile.mock.calls[0]![1]).toEqual(Buffer.from('raster result'));
    });

    test('older hosts with no background choice keep following the editor', async () => {
        const subject = panel();
        await subject.receive({ type: 'ready' });
        await subject.exportDiagram('svg');
        expect(Buffer.from(api.writeFile.mock.calls[0]![1]).toString()).toContain('fill="#1e1e1e"');
    });

    test.each([
        ['svg', 'white', '#ffffff', '#4a453c'], ['svg', 'black', '#000000', '#c9c4bb'],
        ['png', 'white', '#ffffff', '#4a453c'], ['png', 'black', '#000000', '#c9c4bb']
    ] as const)('exports %s on %s independently of the working view', async (format, background, paper, ink) => {
        const subject = panel();
        await subject.receive({ type: 'background', background: background === 'white' ? 'black' : 'white' });
        api.showQuickPick.mockResolvedValue({ background });
        const rasterise = vi.fn(async (_svg: string) => Buffer.from('PNG bytes'));
        subject.rasterise = rasterise;
        await subject.exportDiagram(format);
        const svg = format === 'png' ? rasterise.mock.calls[0]![0]
            : Buffer.from(api.writeFile.mock.calls[0]![1]).toString();
        expect(svg).toContain(`fill="${paper}"`);
        expect(svg).toContain(`stroke: ${ink}`);
        expect(svg).toContain('fill="#eeeeee"');
        expect(api.showQuickPick.mock.calls[0]![0].map((item: { background: string }) => item.background))
            .toEqual(['diagram', 'white', 'black']);
    });

    test('cancelling the background chooser does not open Save As or write a file', async () => {
        api.showQuickPick.mockResolvedValue(undefined);
        await panel().exportDiagram('svg');
        expect(api.showSaveDialog).not.toHaveBeenCalled();
        expect(api.writeFile).not.toHaveBeenCalled();
    });

    test('cancelling Save As does not write a file', async () => {
        api.showSaveDialog.mockResolvedValue(undefined);
        await panel().exportDiagram('png');
        expect(api.writeFile).not.toHaveBeenCalled();
    });

    test('an export choice leaves the working background unchanged', async () => {
        const subject = panel();
        await subject.receive({ type: 'background', background: 'black' });
        api.showQuickPick.mockResolvedValueOnce({ background: 'white' }).mockResolvedValueOnce({ background: 'diagram' });
        await subject.exportDiagram('svg');
        await subject.exportDiagram('svg');
        expect(Buffer.from(api.writeFile.mock.calls[0]![1]).toString()).toContain('fill="#ffffff"');
        expect(Buffer.from(api.writeFile.mock.calls[1]![1]).toString()).toContain('fill="#000000"');
    });
});
