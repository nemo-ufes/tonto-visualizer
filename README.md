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
The work after the first complete release is tracked in
[docs/ROADMAP.md](docs/ROADMAP.md).

## Status

Working end to end, and rough in places.

- `packages/view` — a Tonto model read as an explicit diagram: nodes, edges,
  package groups and generalization sets, with ids stable across edits, colours
  from the natures a class actually classifies, and unresolved names drawn
  rather than dropped.
- `packages/canvas` — sizes, placement, routing and SVG. Lines are straight by
  default, each with its own place on the border of the classes it joins, and
  bent -- twice if it takes twice -- round any class in the way: a line that
  disappears behind a class it has nothing to do with is read as ending there.
  Specializations of one class are gathered into a shared tree. A mediation
  meets a relator on the ray out of its centre, so that the two of them read as
  one line passing through the relator rather than as two lines meeting at a
  box. Multiple associations between the same classes fan apart through a real
  bend instead of running as parallel rails. Curved detours and right angles are
  available as alternatives; a direct edge remains straight, while a necessary
  bend is fitted with a Graphviz-style cubic spline and retains
  sampled geometry for labels, selection and collision checks. Automatic layout
  (ELK, layered) places only what has not been placed by hand, seats a relator
  between the classes it mediates -- it is a reified relationship, and that is
  where a reader looks for it -- and can be told to ignore the packages and lay
  the model out as one graph.
- `packages/cli` — `tonto-view <file-or-directory> [--svg]`.
- `packages/extension` — the panel: live redraw as the model is typed, the last
  good picture kept while it does not parse, drag to arrange, double-click to
  open the declaration, cursor-follows-selection, a scope that is either the
  opened file's packages or the whole workspace, package, class and association
  filters, display options, nature legend, SVG export, and default or named
  `.tontoview` files under the model's `views` folder holding separate
  arrangements. Typeface presets range from condensed and humanist sans-serif
  to book serif and monospace, apply to all diagram text, and share their
  measurements with exported SVG. A persisted **Taxonomy only** setting hides
  attributes and
  associations and arranges from inheritance alone. Pins, centre alignment,
  equal distribution and a maximum taxonomy-rank span are also persisted and
  reapplied by Arrange. The toolbar's **Distance −/+** control scales association
  and neighbor spacing from 60% to 180%, immediately rearranging the diagram so
  its overall density can be tuned. **Fit** is a viewport toggle that follows
  panel and window resizing; moving a diagram into a new window enables it
  automatically. An untouched automatic layout creates no file.

  Selecting an edge reveals its editable guide. Drag a hollow midpoint handle
  to add a bend or a solid bend handle to move it; with a bend selected, Delete
  or Backspace removes it. Removing the final bend returns the edge to automatic
  routing.

The notation covers classes with stereotypes and attributes, datatypes and
enumerations, generalizations, generalization sets as one shared triangle with
`{disjoint, complete}`, relations with their stereotype set over their
name and smaller, UML's solid reading-direction triangle just after the name,
multiplicities and role names on opposite sides of each end, whole-part diamonds, `instanceOf`, a relation's
`derivedFrom` as a UML dependency from the middle of its line to the relator or qualities it is
derived from, a historical role's `derivedFrom` as one from the role to the middle of the
participation (or creation, or termination) it names, or to the event type, and an open padlock on an end that
is not `const` -- an end that cannot change is the ordinary case, so the
exception is what carries a mark.

Multiplicities are written as a diagram writes them: no brackets, and nothing at
all where the multiplicity is `1`, which is what an end means when it says
nothing. Attributes keep their brackets, where UML puts them and where the
multiplicity has a type beside it to be told apart from.

Editing the model from the diagram is deliberately out of scope; diagram
interaction changes only the persisted view.

## Getting started

    git clone --recurse-submodules https://github.com/jpalmeida/tonto-visualizer
    cd tonto-visualizer
    npm run language     # builds tonto-language, in vendor/
    npm install
    npm run build
    npm test

    node packages/cli/bin/tonto-view.js vendor/tontoredesign/examples/university

With a diagram open, **Tonto: Save Diagram as Named View** copies its current
content and arrangement to a named file such as
`views/employment.core-taxonomy.tontoview`. **Tonto: Open Diagram View**
switches between that model's default and named views.

The Tonto language itself is consumed as a pinned submodule under `vendor/`,
never edited from here — one grammar, one set of checks, one answer about what a
model says.

## Licence

MIT. See [LICENSE](LICENSE).
