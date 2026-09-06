# How it is put together

[`PLAN.md`](PLAN.md) says what is being built and why, and was written before
any of it existed. This file says what is there now, and is the one to keep
true. If they disagree, this one is right and `PLAN.md` is history.

## The pipeline

A model becomes a picture in four steps, each in its own package, each testable
without the one after it:

    .tonto files
       │  tonto-language (vendor/, pinned submodule)  — parse, link, validate
       ▼
    Langium AST
       │  packages/view       derive.ts
       ▼
    ViewModel                 nodes, edges, groups, gensets — no coordinates
       │  packages/canvas     place.ts / autolayout.ts
       ▼
    Positions                 a Rect per node id
       │  packages/canvas     ports.ts → route.ts → render.ts
       ▼
    SVG                       plus the path each edge took, for hit-testing

`packages/extension` drives the whole run on every keystroke and owns the state;
`packages/cli` drives one run and prints the result.

### What each package may import

| package | may import | must never |
|---|---|---|
| `view` | `tonto-language`, `langium` | the DOM, `vscode`, anything in `canvas` |
| `canvas` | `tonto-view` types | `vscode`, `tonto-language`; and `./draw` must not reach `elkjs` |
| `extension` | both, and `vscode` | — |
| `cli` | both | `vscode` |

`canvas` has two entry points on purpose. `tonto-canvas` is everything;
`tonto-canvas/draw` is everything that does not need ELK. The webview imports
`/draw`, because automatic layout runs in the extension host and pulling it into
the panel would ship a megabyte of compiled Java to something that only draws.
Anything added to `index.ts` that the panel needs must go in `draw.ts` instead.

## packages/view — the model as a diagram

| file | |
|---|---|
| `language.ts` | **every** import from `tonto-language`, in one place. Nothing else in the repository imports it. |
| `derive.ts` | one walk over the packages in scope → `ViewModel`. |
| `ids.ts` | ids from what the model says: a qualified name for a declaration, the two ends plus stereotype and name for a relation. |
| `natures.ts`, `palette.ts` | `getEffectiveNatures` → a fill colour; grey when several natures disagree. |
| `model.ts`, `options.ts` | the `ViewModel` and the three option groups (`Display`, `Content`, `Layout`). |
| `viewfile.ts` | the `*.tontoview` format: read, merge, migrate. Decides what a file means; never touches the disk. |
| `session.ts` | a Langium workspace held open, one document replaced per keystroke. Node only. |

The rule behind `language.ts` is worth restating: anything about what a model
*means* — which natures a class classifies, whether a relation is a parthood,
which end holds the whole — is asked of the language and never re-derived here.
A picture that disagrees with the validator is worse than no picture.

## packages/canvas — the drawing

The order matters, and it is not obvious. Within `render()`:

1. **`assignPorts`** gives every edge end a point on the border of the box it
   meets. Ends arriving at one side are spread along it in the order they come
   from, so two relations between the same pair cannot be drawn as one line —
   except at a relator, where a mediation is anchored on the ray out of the
   centre so the pair reads as one line passing *through* it.
2. **`planTrees`** decides which generalizations are gathered into a shared tree
   (one triangle, a bus, a leg per subtype). Edges a tree takes over are not
   routed as lines of their own, so this settles before any routing.
3. **`routeEdge`** draws each line: straight by default, detouring round any box
   in the way with one bend, then two; orthogonal on request; self-loops fanned
   by index. A route the modeller dragged is obeyed exactly and nothing here
   second-guesses it.
4. **Only then are labels placed.** Every route is computed before the first
   label, because a label belongs to one line and has to be read against all of
   them — including lines drawn after it. `LabelPlacer` scores candidate spots
   (overlapping a node ×6, another label ×2, a group border ×0.6, plus the
   distance from where the label belongs, per pixel) and takes the cheapest.
5. Bounds come from the boxes, the group boxes **and the placed labels**, or a
   label pushed outside the nodes is cropped off the canvas.

Other things worth knowing before changing this package:

- **Sizes are estimated, never measured by a browser** (`measure.ts`). The same
  numbers must come out in a webview, in a test and in the CLI, or a saved
  arrangement is wrong somewhere. The font stack is Helvetica / Arial /
  Liberation Sans because they are metrically compatible across the three
  platforms; per-character weights, not one average, since guillemets and
  capitals broke the estimate before.
- **`place.ts` never moves anything already placed.** Adding a class is not a
  request to rearrange the diagram. That property is the reason this repository
  draws its own pictures instead of re-rendering through an engine.
- **`autolayout.ts` runs only when asked.** ELK's `layered`, because it is the
  only one of ELK's that keeps every supertype above its subtypes. Two ELK
  traps, both paid for once already:
  - **A compound node inherits nothing.** Spacings set on the root do not reach
    a package's children; they must be repeated on every group node, or a
    grouped diagram silently runs at ELK's 20px default.
  - **Edge coordinates are relative to the owning node** unless
    `elk.json.edgeCoords: 'ROOT'` is set (elkjs ≥ 0.12).
- **Relators are seated between their relata.** Both mediations are written
  inside the relator, so a layered algorithm ranks it above the pair like a
  supertype. The layout lays the model out plainly first, turns the mediations
  of the relators that ended up stranded (for the ranking only — the relation is
  still drawn as written), and keeps the second attempt only if it seats more of
  them. Then each relator is nudged towards the centre of what it mediates.

## packages/extension — the panel

State lives in the host, not the webview: it has the model, the arrangement, and
the file to write it to. The panel draws what it is given and reports what the
pointer did, so a disposed webview never costs anybody their arrangement, and an
export can be rendered without asking the panel for its markup.
`protocol.ts` is the whole of what they say to each other.

The loop on a keystroke: debounce 300ms → `ViewSession` replaces the dirty
document → `derive` → `reconcile` against the stored arrangement → `placeNewNodes`
for anything new → `render` → post to the panel. If the buffer does not parse,
the last good picture stays up with a note; a model is unparseable most of the
time somebody is typing in it.

## packages/cli

`node packages/cli/bin/tonto-view.js <file-or-directory> [--svg]` — the view
model as JSON, or the drawing. It runs the same code as the panel, which makes
it the cheapest end-to-end test there is: CI renders every example on every
push, so a crash in layout or drawing fails a build rather than a preview
somebody has open.

## The arrangement file

`*.tontoview` beside the model: positions, routes, hidden elements and the
options that produced the view, as plain JSON. Beside the model rather than in
the extension's storage because an arrangement is part of the work — a
co-author gets it by pulling, a reviewer sees it in a diff. Ids are the model's
own, so the file survives the text moving around it. Kept small by rounding and
by writing only what differs from what the layout would have done.
