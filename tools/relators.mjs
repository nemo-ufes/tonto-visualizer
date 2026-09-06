/**
 * Where the relators sit, against where they belong: between what they mediate.
 *
 *     npm run build && node tools/relators.mjs
 *
 * This one runs the layout rather than reading an SVG, because what it measures
 * is the arrangement and not the drawing. A relator is a reified relationship,
 * so the reader looks for it between the classes it relates; `autoLayout` turns
 * half of a stranded relator's mediations round for the ranking and then settles
 * it towards the middle of its relata. See `packages/canvas/src/autolayout.ts`.
 *
 * `between` counts relators whose centre falls inside the box its relata span.
 * A relator with fewer than two relata drawn is not counted: there is no
 * "between" for it to be in.
 */

import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { derive, defaultDisplayOptions, defaultLayoutOptions } from 'tonto-view';
import { ViewSession } from 'tonto-view/session';
import { autoLayout } from 'tonto-canvas';
import { placeNewNodes, sizeOf } from 'tonto-canvas/draw';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const examples = join(root, 'vendor/tontoredesign/examples');
const models = [
    join(root, 'tools/models/relators.tonto'),
    join(examples, 'university'),
    ...readdirSync(examples)
        .filter(name => name.endsWith('.tonto') && name !== 'error.tonto')
        .map(name => join(examples, name))
];

const centre = rect => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

for (const path of models) {
    const folder = path.endsWith('.tonto') ? dirname(path) : path;
    const session = new ViewSession({ workspace: [folder] });
    const all = await session.models();
    const view = derive({
        models: path.endsWith('.tonto') ? await session.modelsOf('file://' + path) : all
    });
    const display = { ...defaultDisplayOptions };
    const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
    const laid = await autoLayout(view, sizes, placeNewNodes(view, sizes, {}), { ...defaultLayoutOptions });

    let between = 0;
    let counted = 0;
    const distances = [];
    for (const relator of view.nodes.filter(node => node.stereotype === 'relator')) {
        const relata = [...new Set(view.edges
            .filter(edge => edge.kind === 'relation' && edge.stereotype === 'mediation'
                && (edge.source === relator.id || edge.target === relator.id))
            .map(edge => (edge.source === relator.id ? edge.target : edge.source)))]
            .filter(id => id !== relator.id && laid.positions[id]);
        if (relata.length < 2 || !laid.positions[relator.id]) {
            continue;
        }
        counted += 1;
        const points = relata.map(id => centre(laid.positions[id]));
        const at = centre(laid.positions[relator.id]);
        const left = Math.min(...points.map(one => one.x));
        const right = Math.max(...points.map(one => one.x));
        const top = Math.min(...points.map(one => one.y));
        const bottom = Math.max(...points.map(one => one.y));
        if (at.x >= left - 20 && at.x <= right + 20 && at.y >= top - 20 && at.y <= bottom + 20) {
            between += 1;
        }
        const middle = {
            x: points.reduce((sum, one) => sum + one.x, 0) / points.length,
            y: points.reduce((sum, one) => sum + one.y, 0) / points.length
        };
        const span = Math.max(Math.hypot(right - left, bottom - top), 1);
        distances.push(Math.hypot(at.x - middle.x, at.y - middle.y) / span);
    }
    const name = path.split('/').pop().replace('.tonto', '');
    if (counted === 0) {
        console.log(`${name.padEnd(12)} no relator with two relata`);
        continue;
    }
    const away = distances.reduce((sum, one) => sum + one, 0) / distances.length;
    console.log(`${name.padEnd(12)} relators ${String(counted).padStart(2)}`
        + `  between what they mediate ${String(between).padStart(2)}`
        + `  ${(away * 100).toFixed(0)}% of the span from the middle`);
}
