import type { EdgeRoute, Placement, ViewModel } from 'tonto-view';
import { edgeTouches } from 'tonto-view/outline';
import type { Rect, Size } from 'tonto-canvas/draw';
import { overlaps, segmentHitsRect } from 'tonto-canvas/draw';

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

/** Stored routes invalidated by moved, resized, or newly restored cards. */
export function routesAffectedBy(
    view: ViewModel,
    positions: Record<string, Rect>,
    routes: Record<string, EdgeRoute>,
    changedNodes: ReadonlySet<string>,
    preserve: ReadonlySet<string> = new Set()
): string[] {
    if (changedNodes.size === 0) {
        return [];
    }
    const changed = [...changedNodes];
    return view.edges.filter(edge => {
        if (preserve.has(edge.id)) {
            return false;
        }
        // Through an ontology frame as well: the frame is drawn round its
        // packages, so moving one of them moves where the frame's lines start.
        if (edgeTouches(view, edge, changedNodes)) {
            return true;
        }
        const points = routes[edge.id]?.points;
        return points !== undefined && changed.some(id => {
            const rect = positions[id];
            return rect !== undefined && points.slice(1).some((point, index) =>
                segmentHitsRect(points[index]!, point, rect, 4));
        });
    }).map(edge => edge.id);
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
