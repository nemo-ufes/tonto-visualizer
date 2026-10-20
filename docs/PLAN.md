# Original design notes

This document records the initial design. Some package paths and decisions
below have since changed; see [README.md](../README.md) for the current feature
summary and [ROADMAP.md](ROADMAP.md) for planned work.

The initial design was for **`tonto-visualizer`**, a VS Code extension that
draws a `.tonto` model as an OntoUML class diagram beside the editor and lets
the modeller arrange the diagram by hand.

It is installed next to the language extension from
[`nemo-ufes/tonto`](https://github.com/nemo-ufes/tonto), which supplies the
grammar, the checks and the language server. This one supplies the picture.
That repository is not modified.

The redesign was developed as `jpalmeida/tontoredesign` and published as
`nemo-ufes/tonto` 0.9; this repository followed it there on 2026-10-19. Where
this document says "the redesign" it means that language; where it says
`nemo-ufes/Tonto` it means the old implementation the redesign replaced.

The functionality being replicated is the PlantUML preview in `nemo-ufes/Tonto`.
The *feature* carries over; the *engine* does not — see §4.

---

## 1. What the feature is today

Three files in `nemo-ufes/Tonto`, about 2,600 lines:

| file | lines | what it does |
|---|---|---|
| `packages/tonto/src/cli/generators/plantuml.generator.ts` | 915 | AST → PlantUML source |
| `packages/extension/src/commands/plantumlCommand.ts` | 500 | commands, option state, Langium workspace loading |
| `packages/extension/src/diagram/plantuml-webview.ts` | 1180 | the webview: HTML, CSS, zoom/pan, options panel, exports |

What a user gets: a preview of the active file's package or of every package
under a folder; a package filter; nine display toggles (external references,
package boxes, package names in cards, external package grouping, attributes,
cardinalities, relation labels, colors, and a "spread connection points" option
that pads wide nodes with non-breaking spaces so Graphviz stops piling every
edge onto one border point); seven layout variants and three spacing presets;
nature colors with a legend; export to `.puml`, `.svg`, `.png`; and a refresh on
save. Rendering is done by encoding the diagram into a URL on the public
`plantuml.com` server and inlining the SVG that comes back.

The user-facing surface — the scopes, the filter, the toggles, the legend, the
exports — is the specification for this repository. The rendering path is not.

## 2. Why the generator cannot be copied

It walks an AST the redesign does not have. Nearly every field it reads has
moved or split:

| `nemo-ufes/Tonto` | `jpalmeida/tontoredesign` |
|---|---|
| `Model` → `Statement` → `ContextModule` | `Model.packages: Package[]` (no `Statement` wrapper) |
| `ClassDeclaration.classElementType.ontologicalCategory` | `ClassDeclaration.stereotype` — a union of the 23 literals, not a wrapper node |
| `specializationEndurants` | `specializes` |
| `references: ElementRelation[]` | `relations: InternalRelation[]` |
| one `ElementRelation` with an optional `firstEnd` | `InternalRelation` (source is the container) and `ExternalRelation` (source is a reference), told apart by `$type`; `getRelationSource()` is the one place that cares |
| `firstCardinality` / `secondCardinality` | `sourceCardinality` / `targetCardinality` |
| `isComposition`, `isAggregation`, and their inverted twins | `isAssociation`, `isAggregation`, `isAggregationInverted` — the filled diamond is gone, on purpose |
| `DataType.isEnum` + `elements` | `Datatype` and `Enumeration.literals`, separate types |
| `ontologicalNatures.natures` | `natures: string[]`, plus `getEffectiveNatures()`, which resolves declared / inherited / implied |
| generalization sets: parsed, never drawn | `GeneralizationSet { general, categorizers, specifics, disjoint, complete }` |
| — | `isPowerType`, `instanceOf`, relation `stereotype` / `specializes` / `inverseOf`, end `(const … subsets X.y)`, attribute `@begin` / `@end` and `ordered` / `const` / `addOnly` / `derived`, `///` documentation |

So the walk is written fresh. What the old generator knows that is still worth
having is mostly bookkeeping — how to keep a name stable when it is qualified,
how to order declarations so nothing is referenced before it exists — and that
bookkeeping is different when the output is a scene graph rather than a text
format.

## 3. Where the parsed model comes from

**Decided: depend on `tonto-language` as source.** `nemo-ufes/tonto` is
pinned as a git submodule under `vendor/`, and `packages/language` is depended
on through `file:`. The extension then runs the real grammar, the real scope
provider and the real nature reasoning in its own process, and esbuild bundles
all of it into the `.vsix` — exactly as the redesign extension bundles its own
language server. That repository is consumed, never edited.

Why this dependency was chosen:

- Cross-file linking comes for free. `use person` and `import hr from
  <hr.tonto>` resolve, so a relation to `person.Employer` is an edge and not a
  dangling name -- and which ontology owns which package, which decides what
  resolves at all, is the language's answer too.
- Colors come from `getEffectiveNatures()`, which knows that a `role` under a
  `collective` classifies collectives. Using it avoids maintaining a second copy
  of the roughly 850 lines of nature reasoning in the language.
- `TontoSession` (`packages/language/src/api.ts`) is built for this: `hold()`
  puts an unsaved buffer into the workspace so imports still resolve while the
  file is being typed.

This requires initializing the submodule and updating its pin. CI also builds
nightly against `nemo-ufes/tonto@main` to catch grammar changes.
(`tonto-language` is not on npm — `tonto-cli` there is
the *old* implementation — so `npm install` by name is not available. Publishing
it would be a change in that repository, and so out of scope.)

## 4. The engine: drawn here, not by PlantUML

**Decision: this repository renders the diagram itself.** It does not use
PlantUML, Graphviz, or an external server. The old preview had four limitations:

- **A PlantUML diagram cannot be rearranged.** The layout is whatever Graphviz
  decides, and it decides differently every time a class is added. Half the old
  option surface — seven layout variants, three spacing presets, padding node
  labels with non-breaking spaces — exists to argue with that engine, and none
  of it lets a modeller say *put this here*.
- **It cannot draw a generalization set**: one triangle shared by several
  subtypes, labelled `{disjoint, complete}`. That is the notation OntoUML uses
  most, and it is beyond PlantUML's class diagrams.
- **The model leaves the machine** to be rendered by a third party.
- **There is nothing to click.** Selection, hover, and click-to-source are hacks
  over generated links, or absent.

What replaces it, in four pieces:

**(a) A view model.** The AST becomes an explicit graph: nodes for classes,
datatypes and enumerations; edges for generalizations, relations, `instanceOf`;
groups for packages; and a generalization-set node joining several
generalizations to one triangle. Every node and edge carries a **stable id** —
the qualified name for a declaration, and a derived key for a relation — because
that id is what a saved position is keyed by. This layer is pure: no DOM, no
`vscode`, and it is where the golden tests live.

Packages can be kept together or ignored, and it is a choice because the
measurements do not settle it: over the five example models, ignoring them
produced a smaller drawing three times out of five and a much worse one on
`boats`. A package box is then drawn only where it holds nothing but its own
classes -- laid out as one graph they interleave, and a box round the classes of
one package enclosed three from another, which the reader would believe.

**(b) Layout, only where the modeller has not spoken.** `elkjs` runs a single
PlantUML-like layered graph when a view is first drawn or when an arrangement is
asked for. Generalizations rank supertypes above subtypes; associations also
influence ranks and neighbour order. Elements with a saved position are pinned;
only new and unpositioned ones are placed, near the neighbours they connect to.
**Adding a class must not rearrange the diagram.** PlantUML cannot preserve
manual positions when it redraws. An explicit
*Auto-layout* command (all, or selection) is there for when the modeller does
want it.

  ELK is EPL-2.0. Bundling it in an MIT project is fine and is what the Sprotty
  and GLSP ecosystems do; modifications to ELK itself would stay EPL. `dagre`
  (MIT, smaller, no compound nodes, no orthogonal routing) is the fallback if
  that is unwelcome.

**(c) An SVG canvas.** Hand-written, no diagramming framework: a class box with
a `«stereotype»` line, a name, an attribute compartment and a nature fill;
generalizations with hollow triangles; a shared triangle with `{disjoint,
complete}` for a genset; hollow diamonds for `<>--`; association labels with
cardinalities and role names; a dashed `«instanceOf»`. Zoom by transform, pan by
drag, selection, hover. It is theme-aware — PlantUML always drew on white; this
can follow the editor.

Text is set in Helvetica, Arial or Liberation Sans -- three faces that are
metrically compatible, between them covering macOS, Windows and Linux. A
`system-ui` stack resolves to a different face on each, and the widest ran 18%
wider than the narrowest when measured: a name over the border of its box on one
machine and a card half empty on another. One stack means one set of width
estimates, calibrated against the browser and weighted per character, so `[1..*]`
is not given the room of `«characterization»`.

Lines are **straight**, border to border, and none of them passes behind a
class. Each has its own place along the border of the classes it joins, so two
associations between the same neighbours are two lines; a line blocked by a
class bends round it, twice if one bend will not clear; and specializations of
one class are gathered into a shared tree, since four subtypes each drawing its
own line to one supertype produce four that converge and two that run together.
`tools/readability.py` counts what is left. A class diagram is read as things
joined by lines, not as a circuit board: a direct line says *these two* at a
glance, where a right-angled one has to be followed round two corners, and on a
model with many associations the corridors start to read as the diagram. Two
things make straight lines work — parallel edges between the same pair are
spread into a shallow fan with distinct midpoint bends, and a line that would
cross an unrelated class takes one bend round it, since a straight line through
a class is worse than no line at all.
The curved style only smooths routed edges for which the straight router needed
a bend; a direct association or generalization remains a direct line. Its
Graphviz-style fitter fits one chord-parameterized cubic over as much of the
guide as its obstacle corridor permits, splitting at the worst-fitting bend
only when necessary.
Smoothed detours are checked against the same obstacles and crossings as their
sampled geometry. Ordinary generalizations are smoothed under the same rules;
shared taxonomy trees stay orthogonal so their branching grammar remains clear.
Right angles remain, as a choice, for the taxonomies they do suit.

**(d) The arrangement is a document.** After the modeller changes an automatic
arrangement, positions, waypoints, hidden elements and the option state are
written to a `views/*.tontoview` JSON file: plain, diffable, and committable, so
a hand-arranged diagram survives a restart and can be shared with a co-author
or reviewed in a pull request. An untouched automatic drawing creates no file.
Several views over one model are then just several files — which is how OntoUML
tools think of diagrams, and what a large model needs.

  A view file keyed by qualified name goes stale when a class is renamed. The
  entry is kept, not dropped, and the view reports what it can no longer place,
  so a rename costs a click rather than a layout.

Dragging changes the *view*, not the model. Editing the ontology from the
diagram is outside the initial release (§9).

## 5. Layout

Four packages, npm workspaces, ESM, the conventions of the redesign repo
(4-space indent, `tsc -b`, vitest, eslint):

    tonto-visualizer/
      vendor/tonto/                  git submodule, pinned
      packages/
        view/                        AST → view model. Pure; no DOM, no vscode.
          src/derive.ts              the walk over Package/ClassDeclaration/Relation/GeneralizationSet
          src/ids.ts                 stable ids for nodes, edges and gensets
          src/natures.ts             nature → color, and the legend
          src/options.ts             the display options and their defaults
          src/viewfile.ts            the *.tontoview format: read, merge, migrate
          test/                      golden view models over the example models
        canvas/                      the webview app
          src/layout.ts              elkjs, with pinned positions
          src/render/                shapes, edges, labels, markers
          src/interact/              select, drag, waypoints, marquee, undo
          src/main.ts                the message protocol with the host
        extension/                   the host side
          src/extension.ts           activation, commands
          src/model/session.ts       Langium workspace, dirty buffers, debounce
          src/panel.ts               the webview panel and its messages
          src/exports.ts             SVG / PNG / view file
          esbuild.mjs
        cli/                         headless: model → SVG, for CI and for docs
          bin/tonto-view.js

`view/` never imports `vscode` or touches the DOM, so the derivation is testable
from a terminal and reusable by the CLI. The old code mixes all three, which is
why its generator can only be exercised through the extension.

## 6. Interaction

| | |
|---|---|
| select | click, shift-click, drag a band over the background (shift adds) |
| move | drag, arrow-key nudge, snap to an 8px grid |
| route | select a line, drag a handle to bend it; select a bend and press Delete/Backspace, or double-click it, to drop it |
| resize | drag a card's corner; double-click a corner to fit the content |
| hide | hide an element or a whole package, and a panel to bring it back |
| layout | auto-layout everything, or just the selection |
| undo/redo | over view changes only — the model is edited in the editor |
| zoom/pan | wheel, alt-drag or middle-drag, fit, 1:1 |
| export | SVG, PNG, and the `.tontoview` file itself |

## 7. What makes it *tandem* rather than a second window

- **Live update while typing**, debounced (~300 ms), against the dirty buffer.
  Setting: `onType` (default) or `onSave`.
- **The picture survives a broken parse.** While the buffer does not parse, the
  last good diagram stays, dimmed, with the parse error in the status strip. The
  old command answers "fix syntax errors before generating diagram", which for
  someone mid-word is most of the time.
- **Click an element, land on its declaration**; **put the cursor in a
  declaration, and its element is selected**. Both directions, both cheap, once
  the renderer is ours.
- **Follow the active editor**, with a pin for holding one view.
- **Scope follows the model, not the file.** The redesign reads a model as every
  `.tonto` file under its root, so the default view is the package the file
  declares, with imports drawn as external references — the same file/project
  pair the old extension offers, resolved the way the language resolves it. The
  other half of that pair is a choice in the options panel: *whole workspace*
  draws every package under the root, and what was an external reference becomes
  an element like any other. The choice is stored in the view file as the scope
  rather than as the packages it comes to, because a file gains and loses
  packages as it is written; ticking packages by hand outranks it, and choosing
  a scope hands the ticks back.

Command and setting ids are namespaced `tonto.viz.*`: the old extension owns
`tonto.diagram.*`, and a user with both installed should not get two commands
with one id. This extension contributes **no** language, no grammar and no file
association — `.tonto` belongs to the redesign extension — and activates on
`onLanguage:tonto`.

## 8. The notation, in full

Parity *and* the notation the redesign can express, in the first release:

- classes with `«stereotype»`, nature fill, attribute compartment (with
  `@begin` / `@end`, `ordered`, `const`, `addOnly`, `derived`, cardinalities);
- datatypes and enumerations, with literals;
- generalizations, and **generalization sets** as one shared triangle labelled
  `{disjoint, complete}` with the set's name, `categorizer` drawn as the
  high-order type it is;
- relations with their stereotype (`«mediation»`, `«material»`,
  `«characterization»`, …) set over their name and smaller, as UML sets a
  stereotype over a class name, with the solid reading-direction triangle just
  after the name, multiplicities and role names on opposite sides of each end, and the
  whole-part diamond on the end that carries it. A multiplicity is written the
  way a diagram writes one -- no brackets, `*` rather than `0..*`, and nothing
  at all for `1`, which is what an end means when it says nothing;
- end decorations — `subsets`, `redefines`, `addOnly`, and an open padlock on an
  end that is *not* `const`: an end that cannot change is the ordinary case, and
  a decoration on the ordinary case is noise on every line, so the exception is
  what gets marked;
- `instanceOf` and `isPowerType`, as a dashed `«instanceOf»`;
- a relation's `derivedFrom`, as a UML dependency -- dashed, open arrowhead --
  from the middle of the relation's line to the relator (or qualities) it is
  derived from, leaving from further along the line when a card blocks the
  straight way from the middle;
- a historical role's `derivedFrom`, as the same dependency the other way
  round -- from the role to the middle of the `@participation`, `@creation` or
  `@termination` it names, with the arrowhead on that line -- or to the event
  type's card when it names an event;
- `///` documentation on hover, and optionally as a note;
- package boxes, external-reference elements, and the nature legend.

## 9. Not in the first release

- **Editing the model from the diagram.** Rename, add a class, draw a relation —
  all technically reachable (the language ships the edits its repairs use), and
  all a different product. The boundary for now: the diagram writes the view
  file, never the `.tonto` file.
- **Exporting to OntoUML JSON** for interoperation with the Visual Paradigm
  plugin. Worth doing; not first.
- **Keeping a PlantUML export** as an interop format. Cheap to add later against
  the same view model if anyone asks.

## 10. Tests

- **Golden view models** — JSON, for the example models in the redesign repo
  (`examples/university`, `boats`, `showcase`, `gufo`). Behaviour becomes a diff.
- **Unit tests** on the parts that break: id stability under qualification and
  renaming, view-file merge (pinned, new, orphaned), package filtering, external
  grouping, cardinality and end-decoration rendering, nature color per
  stereotype and per inherited nature.
- **Layout is not asserted pixel-wise.** What is asserted is that pinned
  elements do not move, that new ones land inside the viewport, and that no two
  nodes overlap.
- **A round-trip check**: every element the model declares appears exactly once,
  unless a filter hides it.
- The CLI renders the examples to SVG in CI, so a crash in layout or rendering
  fails a build rather than a preview.

## 11. Milestones

| | | |
|---|---|---|
| M0 | Scaffold: workspaces, tsconfig, vitest, submodule, and a build of `tonto-language` proven to work | done |
| M1 | `packages/view`: AST → view model, golden tests, `tonto-view` CLI dumping JSON | done |
| M2 | `packages/canvas`: elkjs layout, sizes, routing, SVG; `--svg` from the command line | done |
| M3 | The extension: panel, live redraw on type, last-good render, follow-active-editor, options panel, legend, package filter, SVG export | done |
| M4 | Interaction: select, marquee, drag, snap, hide, route handles, resize, undo, auto-layout — and the `.tontoview` file that makes it stick | done |
| M5 | The rest of the notation: gensets, relation stereotypes, MLT, end decorations, datatypes, documentation | done |
| M6 | Packaging: bundled `.vsix`, README, CI, nightly build against `nemo-ufes/tonto@main` | CI and the bundle done; the marketplace listing is not |

The initial ELK configuration was studied against four models -- `university`, `pets`, `boats`,
`gufo` -- by measuring each drawing (area, aspect, crossings, lines through
unrelated boxes, overlaps, taxonomy direction) and looking at it. What came out
of it: straight lines by default, with the two rules above; `layered` as the
arrangement, since it is the only one of ELK's that keeps every supertype above
its subtypes (`stress` and `mrtree` managed 27-68%); generalizations given the
layering priority and associations almost none, so a mediation cannot drag a
role a rank away from the kind it specializes; and the spacings repeated on
every package, since ELK lays a compound node out on its own and inherits
nothing from the graph around it -- set only at the root, every grouped diagram
had been running at ELK's 20px default, which is what left labels with nowhere
to go. Measured over the four models, lines through unrelated boxes fell from
10, 2, 3 and 17 to 1, 0, 0 and 1.

A route can now be taken hold of. Selecting a line offers a handle on every bend
it has and a smaller one on every stretch between them; dragging either makes the
route the modeller's. Selecting a solid bend and pressing Delete or Backspace,
or double-clicking it, drops it -- the last one gives the line back to the router
rather than leaving a two-point route, which would
keep the ends it was given and lose the ports and the way round anything in
between. Two things had to be fixed to make it usable at all, both invisible in
the markup: every `pointerdown` takes pointer capture, which retargets the click
that follows to the viewport, so `dblclick` never saw what was under it (and
double-clicking a class had been fitting the diagram to the window rather than
opening its declaration); and a line is a stroke a pixel wide with its own label
over the middle of it, so what the pointer is over decides only for boxes and
handles -- a line is chosen by measuring the pointer against the polylines.

A view change can now be taken back, over the view alone: what was typed is
undone in the editor, which is the one place it can be. The history is the
store's rather than the panel's, because a webview is disposed and rebuilt
whenever the panel is hidden, and a history that went with it would let a
modeller drag something, switch tab, come back and find nothing to undo. One
thing the modeller did is one step however many changes it made -- arranging the
diagram moves every class and drops every route -- and a change made outside a
step is not recorded at all, which is what keeps the routes the model forced to
be dropped, when a class grew an attribute, out of a history where they would
undo nothing anyone can see.

A card can be pulled roomier by any of its four corners, and fitted back to its
content by double-clicking one of them -- the card itself still opens the
declaration, which is the gesture a reader uses far more often. A size in the
view file is the *least* the card may be rather than the size it is, which is
what lets a widened card stay wide while an attribute added later still grows
it: a card too small for what is written in it is not a smaller card, it is a
broken one. There is no message of its own for a resize, because a placement
already carries an optional size -- a card that was pulled bigger reports one, a
card that was only moved does not, and a placement without one is how the file
says "as big as what it holds".

Dragging the background draws a rubber band, and what it touches is selected --
classes only, since a band is drawn to gather things to move, hide or arrange
and every one of those is about the boxes; a line caught because it happens to
pass through would be a fourth thing nobody pointed at. Holding shift adds to
what is already selected rather than replacing it. That spends the plain drag
the background used to answer with a pan, so panning moves to alt-drag and the
middle button, where every diagram holds it -- and neither panning nor starting
a band with shift held clears the selection, which the plain drag used to do on
the way past.

The diagram exports as a picture as well as a drawing. The name given in the
dialog decides which, as a Save As always has, so the toolbar keeps one button;
the two commands force one either way. Rendering still happens in the host, from
the state the host holds, and only the rasterising is asked of the panel --
which is the one thing the host cannot do for itself, since that needs a browser
and the extension host is Node. It goes through a `data:` URI because that is
what the panel's content policy admits for an image, and a self-contained SVG
drawn from one does not taint the canvas, so the pixels can be read back. At
twice the size: a diagram exported to be looked at is read on a screen denser
than the one it was drawn on.

Association distance is the toolbar's layout-density control. It is a percentage
over the tuned node and rank gaps rather than a scale transform after layout:
changing it runs Arrange again, so routing, labels, package boxes and semantic
placement all see the same denser or roomier geometry. The bounded 60–180% range
keeps the compact end legible and the spacious end finite.

Curved mode changes a route only when its editable guide contains a real bend.
That applies equally to associations and ordinary generalizations. A safe
Graphviz-style fitted spline is preferred; if its wider arc would introduce an
intersection or crossing, progressively smaller local corner curves preserve
the guide's corridor instead of exposing a sharp corner. Shared taxonomy buses
remain deliberately orthogonal because their branching structure is the
notation, not an avoidable routing bend.

No label is drawn where a class hides it. That was the worst of what the placer
did on a dense model, and the two reasons for it were both about having nowhere
to go: every place it looked was within fifty pixels of the end of the line, so
a relation running alongside a class was hemmed in for the whole of that; and a
multiplicity and the role name opposite it were placed as one group, so where
one of the pair was stuck they both were. The group now comes apart when
together would hide one of them -- reading as one group is worth a great deal
and worth less than being on the drawing -- and a label that is wholly behind a
class is charged for the share of itself that is gone as well as for the area it
covers, so it can no longer buy its way out of being near the wrong line by
disappearing instead. Measured over the six models: the three multiplicities
that were entirely out of sight are on the drawing, and nothing anywhere is more
than an eighth covered.

Labels are then placed widest first rather than in the order the model declares
its relations. Each takes the best place left, so what goes first gets the
choice, and the one with the least choice of where to go should not be the one
left over: a long role name with two property strings after it needs a stretch
of clear space, where a `*` fits almost anywhere. On gUFO that is what had
`{addOnly} {redefines Entity.parts}` struck through `wasTerminatedIn`; both read
now, and the ink one label hides of another falls by a third on the one model
that has the problem. The other five have none of it either way.

An earlier note here said 43 overlapping pairs on gUFO, an eleventh of the label
area. That was measured on the boxes the placer reserves, which are padded, and
a stereotype set over the name it belongs to overlaps by that padding on purpose.
Measured on what the glyphs actually cover it was 13 pairs and a fortieth of the
area, and is now 14 pairs and a sixtieth -- more collisions, each far smaller.

The initial plan is complete. Subsequent product work is listed in
[ROADMAP.md](ROADMAP.md). The placer still chooses a label position without
moving neighboring labels; ordering labels first addressed most of the
overlap seen in the examples.

## 12. Risks

- **Layout quality.** A layered algorithm can produce crowded diagrams for dense
  ontologies. Modellers can move elements, and their positions are saved.
- **Nothing bounds the width.** A rank is as wide as a category has kinds, and
  the drawing is as wide as its widest rank: eight kinds of twelve subkinds each
  come out 17220 across and 664 deep. `elk.aspectRatio` was set for years and
  did nothing — layered reads it only through its wrapping phase, and wrapping
  is for path-like graphs; 0.3, 1.6 and 8 draw the same picture to the pixel.
  The option has been removed rather than left looking like a defence. Bounding
  the width means folding a rank into several rows here, which is a decision
  about how a taxonomy should read rather than a setting to find.
- **The submodule pin.** Covered by the nightly build.
- **Scale.** SVG is comfortable to a couple of thousand elements; beyond that a
  view is a subset, which the package filter and hidden-element list already are.
- **View-file churn.** Positions in a committed file produce diffs. Kept small
  by rounding coordinates and by writing only what differs from the layout.
- **A generalization drawn as part of a tree cannot be pointed at.** *Settled
  after this plan closed.* Each leg now carries the id of the generalization it
  is, so a branch is chosen and opened like any other line, while the group
  around it goes on naming the set -- which is what the model declares, and what
  the stem, bar and triangle are drawn for: clicking those chooses the set
  itself, and double-clicking them opens the `genset` line. The two open
  questions were answered by what a leg *is*
  rather than by what it looks like. It is not routed, since the tree decides
  where its branches run, so it is offered no handle to bend; and it is not
  hideable, which is not a special case at all -- no generalization is.
