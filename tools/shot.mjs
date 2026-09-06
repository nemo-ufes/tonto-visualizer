/**
 * An SVG as a picture, so it can actually be looked at.
 *
 *     node tools/shot.mjs diagram.svg diagram.png            # the whole thing
 *     node tools/shot.mjs diagram.svg part.png 400 200 600 500   # x y w h, in SVG units
 *
 * Layout and drawing defects are invisible in the markup and obvious in a
 * render: labels on top of boxes, two lines drawn as one, a decorator against
 * the wrong line. Every one of those fixed here so far passed review as code and
 * was caught by looking at the picture.
 *
 * Playwright is not a dependency of this repository -- it is a browser, and the
 * build does not need one. Install it where you need it:
 *
 *     npm install --no-save playwright
 *
 * and, if the browser lives somewhere Playwright will not find it, say so:
 *
 *     CHROMIUM=/path/to/chromium node tools/shot.mjs ...
 */

import { readFileSync } from 'node:fs';

const [input, output, x, y, width, height] = process.argv.slice(2);
if (!input || !output) {
    console.error('usage: node tools/shot.mjs <in.svg> <out.png> [x y width height]');
    process.exit(2);
}

let chromium;
try {
    ({ chromium } = await import('playwright'));
} catch {
    console.error('playwright is not installed here: npm install --no-save playwright');
    process.exit(2);
}

const svg = readFileSync(input, 'utf8');
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
// Wide enough for the largest example at its natural size: a page narrower than
// the drawing clips it, and the clip is silent.
const page = await browser.newPage({ viewport: { width: 3000, height: 2000 }, deviceScaleFactor: 2 });
await page.setContent(`<body style="margin:0">${svg}</body>`);

if (x === undefined) {
    await (await page.$('svg')).screenshot({ path: output });
} else {
    // The crop is given in the SVG's own coordinates, which is what the paths in
    // the file are written in and what every metric here reports.
    const clip = await page.evaluate(([left, top, w, h]) => {
        const element = document.querySelector('svg');
        const view = element.viewBox.baseVal;
        const box = element.getBoundingClientRect();
        return { x: box.x + (left - view.x), y: box.y + (top - view.y), width: w, height: h };
    }, [Number(x), Number(y), Number(width), Number(height)]);
    await page.screenshot({ path: output, clip });
}
await browser.close();
console.log(output);
