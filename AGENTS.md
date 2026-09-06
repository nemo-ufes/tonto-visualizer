# Directions for agents

This repository draws Tonto models as OntoUML class diagrams, in a VS Code panel
beside the editor. The language they are written in lives elsewhere
(`vendor/tontoredesign`, a pinned submodule) and is **read, never
reimplemented**.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) before changing anything
that draws. It says what the four packages are, what may import what, and the
order things happen in inside `render()` — which is not obvious and is easy to
break. [`docs/PLAN.md`](docs/PLAN.md) is the original plan: useful for *why*,
out of date in places about *what*.

## Getting a build

    npm run language     # builds tonto-language in vendor/ — once, and after bumping the pin
    npm install
    npm run build        # tsc -b across the workspaces, then esbuild for the extension
    npm test             # vitest: 48 tests over view, canvas and extension

Incremental builds are the norm; `npm run build --workspace=tonto-canvas` after
touching `packages/canvas`, or `npx tsc -b packages/cli/tsconfig.json` to get
the CLI and everything under it. The CLI runs the **compiled** packages, so a
change is not in a rendered SVG until it is built.

    node packages/cli/bin/tonto-view.js vendor/tontoredesign/examples/university --svg > /tmp/u.svg

## The loop for anything visual

Layout, routing and labelling defects are invisible in a diff and obvious in a
picture. Every one fixed here so far — labels behind boxes, two relations drawn
as one line, cardinalities against the wrong association, routes landing in the
corner of the canvas — passed review as code and was caught by looking.

So: **measure, change, measure again, and look at the picture.**

    npm run build
    tools/render.sh /tmp/before          # keep the SVGs from before the change
    …make the change…
    npm run build && tools/render.sh /tmp/after
    python3 tools/readability.py /tmp/before/*.svg
    python3 tools/readability.py /tmp/after/*.svg
    node tools/relators.mjs
    node tools/shot.mjs /tmp/after/boats.svg /tmp/boats.png    # then open it

For anything in the panel rather than in the drawing — dragging, zoom, the
options panel, the legend — `node tools/panel.mjs <model>` runs the real webview
bundle in a browser, posts it a model, drags a class, and reports what it tried
to tell the host and any console error. Rendering an SVG exercises none of that.

[`tools/README.md`](tools/README.md) lists what each measurement means and where
the numbers stood when last taken. A change to drawing is argued with both
numbers: it is not enough that the one you aimed at improved. `boats` and `gufo`
are the hard models — a change that improves `university` and quietly ruins
`gufo` is not an improvement.

None of these are tests, and none of them can be. They can all be gamed by
making the drawing worse somewhere they do not count, which is why the last step
is looking at the picture.

## The rules this repository is built on

- **The language is the authority.** Anything about what a model *means* --
  which natures a class classifies, whether a relation is a parthood, which end
  holds the whole -- is asked of `tonto-language` and never re-derived here. A
  picture that disagrees with the validator is worse than no picture.
  `packages/view/src/language.ts` is the one file that names the coupling.
- **An id is what the model says, not where it is written.** A saved position
  outlives the session and must survive the text moving around it. Ids come from
  `ids.ts`, never from an array index or a line number.
- **The arrangement belongs to the modeller.** Adding a class must not move
  anything already placed. Automatic layout fills gaps; it does not overrule.
- **The picture survives a broken parse.** A model is unparseable for most of
  the time somebody is typing in it. Draw what still resolves, keep the rest,
  and say what is wrong somewhere that is not the middle of the canvas.
- **The derivation is testable without a screen.** `packages/view` has no DOM
  and no `vscode` import, so what a diagram holds is a golden file and a diff.
- **The notation is UML's where UML has one.** A reader who knows class diagrams
  should not have to learn this one. Where OntoUML adds something -- natures as
  colour, a relator read through, `instanceOf` -- it is added in UML's grammar,
  not beside it.

## Things that have already cost a day

- **ELK compound nodes inherit nothing.** Spacing options set on the root graph
  do not reach the children of a package node; repeat them on every group, or a
  grouped diagram silently runs at ELK's 20px default.
- **ELK edge coordinates are relative to the owning node** unless
  `elk.json.edgeCoords: 'ROOT'` is set. Needs elkjs ≥ 0.12.
- **`var(--vscode-…)` with no fallback renders as Times** outside VS Code — in
  an exported SVG, in a screenshot, in a test. There is a test that refuses a
  bare one; keep it passing.
- **A CSS rule scoped to `.tv-edge text` stops applying** the moment labels move
  into their own group. The base `text {}` rule in `render.ts` is what makes the
  font right everywhere; do not narrow it.
- **Text is measured by estimate, never by the browser.** The same numbers have
  to come out in a webview, in a test and in the CLI. If a string comes out too
  wide, fix the estimate in `measure.ts`; do not measure at runtime.
- **A probe that samples the first match proves nothing.** A CDP font check that
  read only the first `.tv-edge text` reported success while every association
  label on the page was in the wrong font.
- **`shx rm -rf out` does not remove `tsconfig.tsbuildinfo`,** so a stale
  incremental build can survive a clean. Delete both when a build makes no sense.

## House style

- Comments say why, not what: the reason a table has a hole in it, the defect a
  guard exists for, the thing that was tried and did not work. A number that was
  arrived at by measurement carries the measurement.
- 4-space indent, ESM, `tsc -b`, vitest, no default exports.
- Prose in comments, commits and docs: plain, specific, no hedging, no marketing.
  A commit message says what was wrong, what was done, and what the numbers were
  before and after.
- Domain examples must be true. A fixture that says a car is part of an engine
  teaches the wrong thing, and the fixtures are read more often than the code.
- Verify by running. Every fixture in `packages/view/test/fixtures` validates in
  silence under `tonto check`; keep it that way.
- **Never edit `vendor/tontoredesign`.** It is somebody else's repository,
  pinned. A bug there is reported there.

## Where the tests are

| | |
|---|---|
| `packages/view/test/derive.test.ts` | the AST read as a diagram: ids, natures, gensets, unresolved names |
| `packages/canvas/test/draw.test.ts` | what the SVG contains: shapes, decorations, multiplicities, fonts |
| `packages/canvas/test/lines.test.ts` | telling one line from another: ports, detours, loops, trees, relator anchoring |
| `packages/canvas/test/layout.test.ts` | the arrangement: ranks, spacing, overlap, packages, relator placement |
| `packages/extension/test/chrome.test.ts` | the panel's own CSS, which no render exercises |

Layout is never asserted pixel-wise. What is asserted is the property: that a
supertype is above its subtypes, that nothing overlaps, that a relator lands
between what it mediates. A test that pins a coordinate breaks on the next
spacing change and teaches nothing.
