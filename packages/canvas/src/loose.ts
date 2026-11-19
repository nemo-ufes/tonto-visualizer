/**
 * Where the boxes the layered layout has no reason to place go.
 *
 * A datatype or an enumeration is used by attributes, which are not lines, so
 * to ELK it is a graph of one node. ELK packs such pieces beside the graph
 * they are not part of: a row of value types across the top, a last row
 * holding one enumeration, or -- with one in a package of its own -- a frame
 * at the top left with the whole diagram pushed right of it and an empty
 * column the height of the model beneath it.
 *
 * So they are left out of the layered pass and placed afterwards, each into
 * the free space nearest the classes whose attributes use it, inside the
 * picture the layered pass already made; what does not fit there is packed
 * in balanced rows or columns along whichever side keeps the picture
 * smallest. Nothing here decides what a value type is: the view model says
 * which kind a node is and which attributes are typed by it.
 */

import type { Point, Rect, Size } from './geometry.js';
import { boundsOf, overlaps, segmentHitsRect } from './geometry.js';

export interface LooseBlock {
    id: string;
    size: Size;
    /** What it belongs beside, by id: the classes whose attributes it types. */
    users: readonly string[];
}

export interface LoosePlacement {
    /** Clearance from every box already placed. */
    gap: number;
    /** Clearance from every line already drawn. */
    edgeClearance: number;
    /** Distance of what is packed outside from the picture it is packed beside. */
    separation: number;
}

/** The aspect ratio a picture is packed towards, as the layout has always aimed for. */
const ASPECT = 1.6;
/** How finely the free space is searched. */
const STEP = 10;

/**
 * Top-left corners for each block, given what is already placed: the boxes
 * by id, the lines between them, and the region a block may be put into
 * without making the picture larger.
 */
export function placeLoose(
    blocks: readonly LooseBlock[],
    placed: Readonly<Record<string, Rect>>,
    segments: ReadonlyArray<readonly [Point, Point]>,
    options: LoosePlacement
): Record<string, Point> {
    const result: Record<string, Point> = {};
    const obstacles = Object.values(placed);
    const region = obstacles.length > 0 ? boundsOf(obstacles) : undefined;
    const where = (id: string): Rect | undefined => {
        const at = result[id];
        const block = at && blocks.find(one => one.id === id);
        return placed[id] ?? (at && block ? { ...at, ...block.size } : undefined);
    };
    const remaining = [...blocks].sort((one, other) =>
        other.size.width * other.size.height - one.size.width * one.size.height || one.id.localeCompare(other.id));

    // A value type used by another -- `Money` by its `currency` -- is placed
    // once its user is, so it can go beside it; one whose users are all
    // still waiting goes to the packed rows with them.
    if (region) {
        let progress = true;
        while (progress) {
            progress = false;
            for (const block of remaining) {
                if (result[block.id]) {
                    continue;
                }
                const near = block.users.map(where).filter((rect): rect is Rect => rect !== undefined);
                if (near.length === 0) {
                    continue;
                }
                const at = freeSpotNear(block.size, near, region, obstacles, segments, options);
                if (at) {
                    result[block.id] = at;
                    obstacles.push({ ...at, ...block.size });
                    progress = true;
                }
            }
        }
    }

    const rest = remaining.filter(block => !result[block.id])
        // Packed in the order their users read left to right, so a value
        // type sits under the side of the picture that uses it.
        .map(block => {
            const near = block.users.map(where).filter((rect): rect is Rect => rect !== undefined);
            const x = near.length ? near.reduce((sum, rect) => sum + rect.x + rect.width / 2, 0) / near.length : Infinity;
            return { block, x };
        })
        .sort((one, other) => one.x - other.x || one.block.id.localeCompare(other.block.id))
        .map(({ block }) => block);
    Object.assign(result, packBeside(rest, region, options));
    return result;
}

/**
 * The free spot closest to the classes a block belongs beside, inside the
 * region, clear of every box and line; `undefined` when there is none.
 */
function freeSpotNear(
    size: Size, near: readonly Rect[], region: Rect,
    obstacles: readonly Rect[], segments: ReadonlyArray<readonly [Point, Point]>, options: LoosePlacement
): Point | undefined {
    if (size.width > region.width || size.height > region.height) {
        return undefined;
    }
    const target = {
        x: near.reduce((sum, rect) => sum + rect.x + rect.width / 2, 0) / near.length,
        y: near.reduce((sum, rect) => sum + rect.y + rect.height / 2, 0) / near.length
    };
    const candidates: Array<Point & { cost: number }> = [];
    for (let x = region.x; x + size.width <= region.x + region.width; x += STEP) {
        for (let y = region.y; y + size.height <= region.y + region.height; y += STEP) {
            const dx = x + size.width / 2 - target.x;
            const dy = y + size.height / 2 - target.y;
            candidates.push({ x, y, cost: dx * dx + dy * dy });
        }
    }
    candidates.sort((one, other) => one.cost - other.cost || one.y - other.y || one.x - other.x);
    for (const candidate of candidates) {
        const rect = { x: candidate.x, y: candidate.y, ...size };
        if (obstacles.some(obstacle => overlaps(rect, obstacle, options.gap))) {
            continue;
        }
        if (segments.some(([from, to]) => segmentHitsRect(from, to, rect, options.edgeClearance))) {
            continue;
        }
        return { x: Math.round(candidate.x), y: Math.round(candidate.y) };
    }
    return undefined;
}

/**
 * Packs blocks below or to the right of the region, whichever leaves the
 * smaller picture, in rows (or columns) of balanced length: seven value
 * types are two rows of four and three, not a row of six and a row of one.
 * With nothing placed yet they are a block of their own, near the aspect
 * the layout aims for.
 */
function packBeside(
    blocks: readonly LooseBlock[], region: Rect | undefined, options: LoosePlacement
): Record<string, Point> {
    if (blocks.length === 0) {
        return {};
    }
    const gap = options.gap;
    if (!region) {
        const area = blocks.reduce((sum, block) => sum + (block.size.width + gap) * (block.size.height + gap), 0);
        const widest = Math.max(...blocks.map(block => block.size.width));
        return shelves(blocks, Math.max(widest, Math.sqrt(area * ASPECT)), gap, 'rows', { x: 0, y: 0 }).at;
    }
    const below = shelves(blocks, Math.max(region.width, ...blocks.map(block => block.size.width)), gap, 'rows',
        { x: region.x, y: region.y + region.height + options.separation });
    const right = shelves(blocks, Math.max(region.height, ...blocks.map(block => block.size.height)), gap, 'columns',
        { x: region.x + region.width + options.separation, y: region.y });
    // What matters is how large the picture can be shown in a panel of the
    // usual shape, not its area: packed to the right of a wide model, value
    // types made the smaller picture and the one shown smallest.
    const fit = (packed: Packed) => {
        const total = boundsOf([region, packed.bounds]);
        return { span: Math.max(total.width, total.height * ASPECT), area: total.width * total.height };
    };
    const one = fit(below);
    const other = fit(right);
    const choice = one.span < other.span || (one.span === other.span && one.area <= other.area) ? below : right;
    return choice.at;
}

interface Packed {
    at: Record<string, Point>;
    bounds: Rect;
}

/**
 * Greedy shelves no longer than `limit`, then evened out: the fewest shelves
 * the greedy pass needed, with the length shared between them as equally as
 * the boxes allow.
 */
function shelves(
    blocks: readonly LooseBlock[], limit: number, gap: number, direction: 'rows' | 'columns', origin: Point
): Packed {
    const along = (size: Size) => direction === 'rows' ? size.width : size.height;
    const greedy = split(blocks, limit, gap, along);
    let balanced = greedy;
    const total = blocks.reduce((sum, block) => sum + along(block.size), 0) + gap * (blocks.length - greedy.length);
    for (let length = Math.max(...blocks.map(block => along(block.size)), total / greedy.length); length <= limit; length += STEP) {
        const attempt = split(blocks, length, gap, along);
        if (attempt.length <= greedy.length) {
            balanced = attempt;
            break;
        }
    }
    const at: Record<string, Point> = {};
    const rects: Rect[] = [];
    let across = 0;
    for (const shelf of balanced) {
        let offset = 0;
        let depth = 0;
        for (const block of shelf) {
            const point = direction === 'rows'
                ? { x: origin.x + offset, y: origin.y + across }
                : { x: origin.x + across, y: origin.y + offset };
            at[block.id] = { x: Math.round(point.x), y: Math.round(point.y) };
            rects.push({ ...point, ...block.size });
            offset += along(block.size) + gap;
            depth = Math.max(depth, direction === 'rows' ? block.size.height : block.size.width);
        }
        across += depth + gap;
    }
    return { at, bounds: boundsOf(rects) };
}

function split(
    blocks: readonly LooseBlock[], limit: number, gap: number, along: (size: Size) => number
): LooseBlock[][] {
    const result: LooseBlock[][] = [];
    let shelf: LooseBlock[] = [];
    let length = 0;
    for (const block of blocks) {
        const next = shelf.length === 0 ? along(block.size) : length + gap + along(block.size);
        if (shelf.length > 0 && next > limit) {
            result.push(shelf);
            shelf = [block];
            length = along(block.size);
        } else {
            shelf.push(block);
            length = next;
        }
    }
    if (shelf.length > 0) {
        result.push(shelf);
    }
    return result;
}
