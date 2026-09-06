/**
 * The panel, driven outside VS Code.
 *
 *     npm run build && node tools/panel.mjs vendor/tontoredesign/examples/university /tmp/panel
 *
 * The webview is where dragging, zooming, the options panel and the legend live,
 * and none of it is exercised by rendering an SVG from the command line. This
 * loads the real bundle (`packages/extension/out/webview.js`) with the real
 * stylesheet into a browser page, stubs `acquireVsCodeApi`, and posts it the
 * same `model` message the extension host would. It then drags a class, opens
 * the options panel, and prints what the panel tried to tell the host --
 * which is how a webview defect is caught without installing an extension.
 *
 * The page's markup is lifted out of `diagram-panel.ts` rather than copied, so
 * a button renamed there is not silently missing here.
 *
 * Needs Playwright; see `shot.mjs` for how to get one.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    defaultContentOptions, defaultDisplayOptions, defaultLayoutOptions, derive
} from 'tonto-view';
import { ViewSession } from 'tonto-view/session';
import { autoLayout } from 'tonto-canvas';
import { placeNewNodes, sizeOf } from 'tonto-canvas/draw';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const model = resolve(process.argv[2] ?? join(root, 'vendor/tontoredesign/examples/university'));
const out = resolve(process.argv[3] ?? '/tmp/panel');

let chromium;
try {
    ({ chromium } = await import('playwright'));
} catch {
    console.error('playwright is not installed here: npm install --no-save playwright');
    process.exit(2);
}

// The same message the host posts, built the same way it builds it.
const folder = model.endsWith('.tonto') ? dirname(model) : model;
const session = new ViewSession({ workspace: [folder] });
const view = derive({
    models: model.endsWith('.tonto') ? await session.modelsOf('file://' + model) : await session.models()
});
const display = { ...defaultDisplayOptions };
const sizes = Object.fromEntries(view.nodes.map(node => [node.id, sizeOf(node, display)]));
const laid = await autoLayout(view, sizes, placeNewNodes(view, sizes, {}), { ...defaultLayoutOptions });
const message = {
    type: 'model',
    view,
    positions: laid.positions,
    routes: {},
    display,
    content: { ...defaultContentOptions },
    layout: { ...defaultLayoutOptions },
    packages: view.groups.map(group => group.name),
    title: model.split('/').pop()
};

const extension = join(root, 'packages/extension');
const shell = readFileSync(join(extension, 'src/diagram-panel.ts'), 'utf8')
    .match(/<div id="shell">[\s\S]*?\n<\/div>/)?.[0];
if (!shell) {
    console.error('the shell markup is no longer where this expects it, in diagram-panel.ts');
    process.exit(1);
}

const page = await (await chromium.launch(
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}
)).newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });

const problems = [];
page.on('console', entry => entry.type() === 'error' && problems.push(entry.text()));
page.on('pageerror', error => problems.push(String(error)));

await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
<style>${readFileSync(join(extension, 'media/canvas.css'), 'utf8')}</style></head><body>
${shell}
<script>
  window.sent = [];
  window.acquireVsCodeApi = () => ({
      postMessage: message => window.sent.push(message),
      getState: () => undefined,
      setState: () => {}
  });
</script>
<script>${readFileSync(join(extension, 'out/webview.js'), 'utf8')}</script>
</body></html>`);

await page.evaluate(payload => window.postMessage(payload, '*'), message);
await page.waitForFunction(() => document.querySelectorAll('#canvas [data-node]').length > 0);
await page.click('#fit');
await page.screenshot({ path: join(out, 'panel.png') });

// Drag the first class somewhere else and see whether the lines follow it.
const dragged = await page.$('#canvas [data-node] rect');
const box = await dragged.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2 + 140, { steps: 12 });
await page.mouse.up();
await page.waitForTimeout(150);
await page.screenshot({ path: join(out, 'panel-dragged.png') });

await page.click('#optionsButton');
await page.waitForTimeout(80);
await page.screenshot({ path: join(out, 'panel-options.png') });

const sent = await page.evaluate(() => window.sent);
console.log('pictures in', out);
console.log('messages to the host:', sent.map(one => one.type).join(', ') || 'none');
console.log('console errors:', problems.length ? problems : 'none');
await page.context().browser().close();
if (problems.length > 0 || !sent.some(one => one.type === 'moved')) {
    process.exit(1);
}
