# A diagram beside the text

This repository will hold **`tonto-visualizer`**, a VS Code extension that draws
a `.tonto` model as an OntoUML class diagram in a panel beside the editor, live
as the model is typed, and lets the diagram be **arranged by hand** — elements
dragged where the modeller wants them, and left there.

It is installed next to the language extension from
[`jpalmeida/tontoredesign`](https://github.com/jpalmeida/tontoredesign), which
supplies the grammar, the checks and the language server. This one supplies the
picture. Neither that repository nor
[`nemo-ufes/Tonto`](https://github.com/nemo-ufes/Tonto) is modified.

The functionality being replicated is the PlantUML preview in `nemo-ufes/Tonto`.
The *feature* carries over; the *engine* does not — see §4.

> **This is the plan, written before any of it existed**, and it is kept for the
> reasoning: why the generator could not be copied, why the engine is here, what
> the notation has to cover. For how the code is actually put together now, read
> [`ARCHITECTURE.md`](ARCHITECTURE.md); for how to work on it,
> [`../AGENTS.md`](../AGENTS.md).

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

**Decided: depend on `tonto-language` as source.** `jpalmeida/tontoredesign` is
pinned as a git submodule under `vendor/`, and `packages/language` is depended
on through `file:`. The extension then runs the real grammar, the real scope
provider and the real nature reasoning in its own process, and esbuild bundles
all of it into the `.vsix` — exactly as the redesign extension bundles its own
language server. That repository is consumed, never edited.

The reasons, since the alternatives keep looking attractive:

- Cross-file linking comes for free. `import Person` resolves, so a relation to
  `Person.Employer` is an edge and not a dangling name.
- Colors come from `getEffectiveNatures()`, which knows that a `role` under a
  `collective` classifies collectives. Re-deriving that by hand is
  `stereotype-model.ts` + `nature-reasoning.ts` + `generalizations.ts` — about
  850 lines of reasoning this repository must not own a second copy of, because
  a picture that disagrees with the validator is worse than no picture.
- `TontoSession` (`packages/language/src/api.ts`) is built for this: `hold()`
  puts an unsaved buffer into the workspace so imports still resolve while the
  file is being typed.

The cost is a submodule to initialise and a pin to bump. CI rebuilds nightly
against `tontoredesign@main`, so grammar drift arrives as a red build rather
than as a wrong diagram. (`tonto-language` is not on npm — `tonto-cli` there is
the *old* implementation — so `npm install` by name is not available. Publishing
it would be a change in that repository, and so out of scope.)

## 4. The engine: drawn here, not by PlantUML

**Decided: this repository renders the diagram itself.** No PlantUML, no
Graphviz, no external server. The reasons are the same ones that make the old
feature frustrating to use:

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

**(b) Layout, only where the modeller has not spoken.** `elkjs` (the layered
algorithm, packages as compound nodes) runs when a view is first drawn or when
an arrangement is asked for. Elements with a saved position are pinned; only new and
unpositioned ones are placed, near the neighbours they connect to. **Adding a
class must not rearrange the diagram** — that property is the whole point, and
it is what a re-render through PlantUML can never offer. An explicit *Auto-layout*
command (all, or selection) is there for when the modeller does want it.

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
spread apart, and a line that would cross an unrelated class takes one bend
round it, since a straight line through a class is worse than no line at all.
Right angles remain, as a choice, for the taxonomies they do suit.

**(d) The arrangement is a document.** Positions, waypoints, hidden elements and
the option state are written to a `*.tontoview` JSON file beside the model:
plain, diffable, and committable, so a hand-arranged diagram survives a restart
and can be shared with a co-author or reviewed in a pull request. Several views
over one model are then just several files — which is how OntoUML tools think of
diagrams, and what a large model needs.

  A view file keyed by qualified name goes stale when a class is renamed. The
  entry is kept, not dropped, and the view reports what it can no longer place,
  so a rename costs a click rather than a layout.

The model text stays the single source of truth. Dragging changes the *view*,
never the model; this is a visualizer, and editing the ontology from the diagram
is deliberately out of scope for now (§9).

## 5. Layout

Four packages, npm workspaces, ESM, the conventions of the redesign repo
(4-space indent, `tsc -b`, vitest, eslint):

    tonto-visualizer/
      vendor/tontoredesign/    git submodule, pinned
      packages/
        view/                  AST → view model. Pure; no DOM, no vscode.
        canvas/                sizes, placement, routing, SVG
        extension/             the host side, and the webview app under src/webview
        cli/                   headless: model → SVG, for CI and for docs

> The file-by-file tree that stood here was the plan, and the code went another
> way in several places — layout, rendering and interaction are not the three
> directories it named, and the webview app lives in `packages/extension`
> rather than in `canvas`. [`ARCHITECTURE.md`](ARCHITECTURE.md) describes what
> is actually there and is the one to keep true.

`view/` never imports `vscode` or touches the DOM, so the derivation is testable
from a terminal and reusable by the CLI. The old code mixes all three, which is
why its generator can only be exercised through the extension.

## 6. Interaction

| | |
|---|---|
| select | click, shift-click, marquee |
| move | drag, arrow-key nudge, snap to an 8px grid |
| route | drag a waypoint onto an edge; double-click a waypoint to drop it |
| resize | drag a node's corner; double-click to fit the content |
| hide | hide an element or a whole package, and a panel to bring it back |
| layout | auto-layout everything, or just the selection |
| undo/redo | over view changes only — the model is edited in the editor |
| zoom/pan | wheel, drag, fit, 1:1 |
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
  pair the old extension offers, resolved the way the language resolves it.

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
- `///` documentation on hover, and optionally as a note;
- package boxes, external-reference elements, and the nature legend.

## 9. Deliberately not in the first release

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
| M4 | Interaction: select, drag, snap, hide, auto-layout — and the `.tontoview` file that makes it stick | done, less waypoint handles, resizing, marquee and undo |
| M5 | The rest of the notation: gensets, relation stereotypes, MLT, end decorations, datatypes, documentation | done |
| M6 | Packaging: bundled `.vsix`, README, CI, nightly build against `tontoredesign@main` | CI and the bundle done; the marketplace listing is not |

Layout was then studied against four models -- `university`, `pets`, `boats`,
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

Readability was then worked the same way, and the measurements it produced are
now `tools/` -- run them before and after anything that draws. What came out of
it: a line bends round a box in its way rather than passing behind it (one bend,
then two); specializations of one class are gathered into a shared tree with its
own lane, so two trees at one rank cannot be drawn on top of each other; every
end of every edge gets its own place on the border; labels are placed against
*all* the routes rather than only the ones drawn so far, and pay for the
distance from where they belong, so none is flung into empty space; the packages
can be ignored for layout, which some models want and others do not; a relator
is seated between the classes it mediates; and a mediation meets a relator on
the ray out of its centre, so the pair reads as one line through it. Lines
behind a class went from 4 to 0 over the five examples, and superimposed pixels
from 3486 to 1097 over the four that had any. Misread labels are not comparable
across the whole span -- the metric was made stricter twice on the way -- and
stand at 75 of 372 labels; `tools/README.md` has the current figures per model.

What is left, in the order it is worth doing:

1. **`gufo` and `boats`.** They hold every remaining superimposed pixel (750
   and 347) and 65 of the 75 misread labels. Both are dense taxonomies with
   many self-loops and many relations between the same pair, which is what the
   drawing is worst at.
2. **Label placement that pushes back.** The placer walks its own line and
   settles for the least-bad spot rather than moving a neighbour that has a
   better one available.
3. **Dragging a route by hand.** The file format holds routes already; the
   panel draws no handles.
4. Undo/redo over view changes, resizing a card, marquee selection, PNG export.

## 12. Risks

- **Layout quality.** A layered algorithm on a dense ontology can still produce
  a thicket. Mitigation: the modeller can move anything, and what they move
  stays moved — which is the reason for the rewrite in the first place.
- **The submodule pin.** Covered by the nightly build.
- **Scale.** SVG is comfortable to a couple of thousand elements; beyond that a
  view is a subset, which the package filter and hidden-element list already are.
- **View-file churn.** Positions in a committed file produce diffs. Kept small
  by rounding coordinates and by writing only what differs from the layout.
