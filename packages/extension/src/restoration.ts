import type { Placement } from 'tonto-view';
import type { Rect, Size } from 'tonto-canvas/draw';
import { overlaps } from 'tonto-canvas/draw';

/**
 * Removes obsolete saved positions from cards returning to a visible canvas.
 *
 * Visible cards own their current space. A restored card may reuse its old
 * place only when that rectangle is still free; otherwise `placeNewNodes` will
 * treat it like a newly introduced obstacle and find a nearby open position.
 */
export function safeRestoredPlacements(
    nodeIds: readonly string[],
    restored: ReadonlySet<string>,
    sizes: Record<string, Size>,
    saved: Record<string, Placement>
): { placed: Record<string, Placement>; repositioned: Set<string> } {
    const placed = { ...saved };
    const occupied: Rect[] = nodeIds
        .filter(id => !restored.has(id))
        .map(id => rectOf(placed[id], sizes[id]))
        .filter((rect): rect is Rect => rect !== undefined);
    const repositioned = new Set<string>();
    for (const id of nodeIds) {
        if (!restored.has(id)) {
            continue;
        }
        const candidate = rectOf(placed[id], sizes[id]);
        if (candidate && occupied.some(rect => overlaps(candidate, rect))) {
            delete placed[id];
            repositioned.add(id);
        } else if (candidate) {
            occupied.push(candidate);
        }
    }
    return { placed, repositioned };
}

function rectOf(placement: Placement | undefined, size: Size | undefined): Rect | undefined {
    if (!placement) {
        return undefined;
    }
    return {
        x: placement.x,
        y: placement.y,
        width: Math.max(size?.width ?? 160, placement.width ?? 0),
        height: Math.max(size?.height ?? 60, placement.height ?? 0)
    };
}
