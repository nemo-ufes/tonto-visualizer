# tonto-visualizer

An OntoUML diagram beside the text, in VS Code: a `.tonto` model drawn as you
type it, and **arranged by hand** — elements dragged where you want them, and
left there when the model changes.

It is used together with the Tonto language extension from
[`jpalmeida/tontoredesign`](https://github.com/jpalmeida/tontoredesign), which
supplies the grammar, the checks and the language server. This repository
supplies the picture, and draws it itself: no PlantUML, no Graphviz, no
rendering server, nothing sent anywhere.

See [docs/PLAN.md](docs/PLAN.md) for what is being built and why.

## Status

Working end to end, and rough in places.

- `packages/view` — a Tonto model read as an explicit diagram: nodes, edges,
  package groups and generalization sets, with ids stable across edits, colours
  from the natures a class actually classifies, and unresolved names drawn
  rather than dropped.
- `packages/canvas` — sizes, placement, routing and SVG. Lines are straight by
  default, spread apart where several join the same pair, and bent round a class
  they would otherwise cross; right angles are available for taxonomies.
  Automatic layout (ELK, layered) places only what has not been placed by hand.
- `packages/cli` — `tonto-view <file-or-directory> [--svg]`.
- `packages/extension` — the panel: live redraw as the model is typed, the last
  good picture kept while it does not parse, drag to arrange, double-click to
  open the declaration, cursor-follows-selection, package filter, display
  options, nature legend, SVG export, and a `.tontoview` file beside the model
  holding the arrangement.

The notation covers classes with stereotypes and attributes, datatypes and
enumerations, generalizations, generalization sets as one shared triangle with
`{disjoint, complete}`, relations with their stereotype and UML's solid
reading-direction triangle, cardinalities and role names on opposite sides of
each end, whole-part diamonds, `instanceOf`, and an open padlock on an end that
is not `const` -- an end that cannot change is the ordinary case, so the
exception is what carries a mark.

Not there yet: dragging a route by hand (the file format holds them; the panel
does not draw the handles), undo/redo, resizing a card, marquee selection, PNG
export, and any editing of the model from the diagram.

## Getting started

    git clone --recurse-submodules https://github.com/jpalmeida/tonto-visualizer
    cd tonto-visualizer
    npm run language     # builds tonto-language, in vendor/
    npm install
    npm run build
    npm test

    node packages/cli/bin/tonto-view.js vendor/tontoredesign/examples/university

The Tonto language itself is consumed as a pinned submodule under `vendor/`,
never edited from here — one grammar, one set of checks, one answer about what a
model says.

## Licence

MIT. See [LICENSE](LICENSE).
