# A diagram beside the text

This repository will hold **`tonto-visualizer`**, a VS Code extension that
renders a `.tonto` model as an OntoUML class diagram, live, in a panel beside
the editor. It is meant to be installed next to the language extension from
[`jpalmeida/tontoredesign`](https://github.com/jpalmeida/tontoredesign), which
supplies the grammar, the checks and the language server; this one supplies the
picture and touches neither of the other two repositories.

The functionality it replicates is the PlantUML preview that lives today in
[`nemo-ufes/Tonto`](https://github.com/nemo-ufes/Tonto). This document says what
that feature is, why it cannot be copied across, and what the work is.

---

## 1. What the feature is today

Three files in `nemo-ufes/Tonto`, about 2,600 lines:

| file | lines | what it does |
|---|---|---|
| `packages/tonto/src/cli/generators/plantuml.generator.ts` | 915 | AST → PlantUML source |
| `packages/extension/src/commands/plantumlCommand.ts` | 500 | commands, option state, Langium workspace loading |
| `packages/extension/src/diagram/plantuml-webview.ts` | 1180 | the webview: HTML, CSS, zoom/pan, options panel, exports |

What a user gets:

- **Two scopes.** `tonto.diagram.plantuml.open` renders the active file's
  package; `…openProject` renders every package under a chosen folder, with a
  checkbox list to hide packages one at a time.
- **Nine display toggles** — external references, package boxes, package names
  inside cards, external package grouping, attributes, cardinalities, relation
  labels, colors, and "spread connection points" (pads wide nodes with
  non-breaking spaces so Graphviz stops piling every edge on one border point).
- **Seven layout variants** (default, top-to-bottom, left-to-right, polyline,
  ortho, smetana, elk) and **three spacing presets** (compact, cozy, spacious),
  which map onto `skinparam nodesep/ranksep` and `!pragma layout`.
- **Nature colors** with a collapsible legend: kinds in the full tone, their
  subtypes in a lighter tone of the same hue.
- **Exports**: `.puml`, `.svg`, `.png`.
- **Refresh on save**, for the file or for any file inside the rendered folder.
- **Rendering** by encoding the diagram (deflate + PlantUML's base64 alphabet,
  via `plantuml-encoder`) into a URL on the **public** `plantuml.com` server, and
  inlining the returned SVG markup into the webview — inlined rather than put in
  an `<img>` because Chromium rasterises an `<img>` SVG once and zooming then
  blurs it.

Everything above is worth keeping. The generator's *shape* is worth keeping too:
declarations are buffered separately from relations so every element is declared
into its package box before any edge mentions it, and names that are not safe
PlantUML identifiers get aliases.

## 2. Why it cannot be copied across

The generator walks an AST that the redesign does not have. The redesign's
grammar is a deliberate rewrite, and nearly every field the generator reads has
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
| `ontologicalNatures.natures` | `natures: string[]`, plus `getEffectiveNatures()` which resolves declared / inherited / implied |
| generalization sets: parsed, never drawn | `GeneralizationSet { general, categorizers, specifics, disjoint, complete }` |
| — | `isPowerType`, `instanceOf`, relation `stereotype` / `specializes` / `inverseOf`, end `(const … subsets X.y)`, attribute `@begin` / `@end` and `ordered` / `const` / `addOnly` / `derived`, `///` documentation |

So: the PlantUML emission layer (aliasing, quoting, package boxes, degree
padding, layout and spacing directives, the header) ports almost verbatim; the
AST-walking layer is written fresh against the redesign's types; and there are
several things the redesign says that the old generator had no way to draw.

The redesign extension is a thin LSP client — it starts the server and pushes
settings, and exports no API. Nothing can be asked of it from another extension,
which settles the next question.

## 3. Where the parsed model comes from

The one decision that shapes everything else. `tonto-language` is not published
to npm (`tonto-cli` on npm is the *old* implementation), so there is no
`npm install` that fetches it by name.

**A. Depend on `tonto-language` as source — recommended.** Add
`jpalmeida/tontoredesign` as a git submodule pinned to a commit, and depend on
`file:vendor/tontoredesign/packages/language`. The extension then runs the real
grammar, the real scope provider, and the real nature reasoning in its own
process, and esbuild bundles all of it into the `.vsix`, exactly as the redesign
extension bundles its own server. No change to that repository — it is consumed,
not edited.

  - It gets cross-file linking for free: `import Person` resolves, so a relation
    to `Person.Employer` draws as an edge and not as a dangling name.
  - Colors come from `getEffectiveNatures()`, which knows that a `role` under a
    `collective` classifies collectives. Re-deriving that by hand is
    `stereotype-model.ts` + `nature-reasoning.ts` + `generalizations.ts`, ~850
    lines of exactly the reasoning this repository should not own a second copy of.
  - `TontoSession` (`packages/language/src/api.ts`) is built for this: `hold()`
    puts an unsaved buffer into the workspace so imports still resolve, which is
    what a preview of a document being typed needs.
  - Cost: contributors run `git submodule update --init` and one build; the pin
    has to be bumped when the grammar moves. CI can rebuild against
    `tontoredesign@main` nightly so drift shows up as a red build rather than as
    a wrong diagram.

**B. A tolerant parser of our own.** Self-contained, and it can draw a
half-written model that Langium rejects. But it is a second reading of a grammar
that is still moving, and it would silently disagree with the editor about what
the model says. A diagram that disagrees with the validator is worse than no
diagram.

**C. Shell out to `tonto ast`.** The redesign CLI prints the parsed model as
JSON, but only for one document, and only if the user happens to have the CLI
installed. Fine as an escape hatch, not as the mechanism.

Recommendation: **A**, with the `.vsix` self-contained so the user installs one
extension and nothing else.

## 4. Layout

Three packages, npm workspaces, ESM, the conventions of the redesign repo
(4-space indent, `tsc -b`, vitest, eslint):

    tonto-visualizer/
      vendor/tontoredesign/            git submodule, pinned
      packages/
        diagram/                       AST → PlantUML. No `vscode` import.
          src/generator.ts             the walk
          src/options.ts               the option type and its defaults
          src/natures.ts               nature → color, and the legend
          src/plantuml.ts              names, aliases, quoting, header
          src/encode.ts                deflate + PlantUML base64 (≈20 lines of node:zlib)
          bin/tonto-diagram.js         file/folder/stdin → .puml, for CI and for goldens
          test/                        golden files over the example models
        extension/                     the VS Code extension
          src/extension.ts             activation, commands
          src/model/session.ts         Langium workspace, dirty buffers, debounce
          src/webview/panel.ts         the panel and its messages
          src/webview/media/           css + js, as files rather than one template string
          esbuild.mjs

`packages/diagram` never imports `vscode`, so the generator is testable from a
terminal and usable from CI. The old code mixes the two, which is why its
generator can only be exercised through the extension.

## 5. The webview

Ported, with the parts that are already right kept as they are: inline SVG,
zoom by resizing the SVG box rather than by CSS transform, pan by translate,
state persisted through `vscode.getState()` so a toggle does not throw away the
user's viewport. Its 1,180-line single-template-literal form becomes a small
HTML file plus a CSS file plus a script file, addressed through
`asWebviewUri` — the same page, in files a diff can read.

The options panel keeps the nine toggles, the layout and spacing selects, the
package checkboxes, the legend and the three export buttons.

## 6. What makes it *tandem* rather than a second copy

Side-by-side is the point, so these are not extras:

- **Live update while typing**, debounced (~300 ms), against the dirty buffer —
  not on save. Setting: `onType` (default) or `onSave`.
- **Keep the last good picture.** While the buffer does not parse, the previous
  diagram stays on screen, dimmed, with the parse error in the status strip. The
  old command answers "fix syntax errors before generating diagram", which for
  someone typing is most of the time.
- **Follow the active editor**, so moving between files moves the diagram, with
  a pin button to hold one view.
- **Click a class, land on its declaration.** PlantUML carries `[[link]]` through
  to `<a>` elements in the SVG; emitting a `tonto:` URL per element and
  intercepting the click in the webview gives navigation from picture to text.
- **Cursor in the text highlights the element in the picture** — the reverse
  direction, done by outlining the matching `<g>`.
- **Scope follows the model, not the file.** The redesign reads a model as every
  `.tonto` file under its root, so the default view is the package the file
  declares, with its imports drawn as external references — the same
  file/project pair the old extension has, resolved the way the language
  resolves it.

Command and setting ids are namespaced `tonto.viz.*`. The old extension owns
`tonto.diagram.*`, and a user with both installed should not get two commands
with one id. This extension contributes **no** language, no grammar and no file
association: `.tonto` belongs to the redesign extension, and this one activates
on `onLanguage:tonto`.

## 7. Beyond parity

Things the redesign says that the old generator cannot draw, each behind a
toggle:

- **Generalization sets** — a `{disjoint, complete}` constraint label on the
  shared generalization, with the set's name, and `categorizer` drawn as the
  high-order type it is.
- **Relation stereotypes** — `«mediation»`, `«characterization»`, `«material»`
  on the edge, which is how an OntoUML diagram is normally read.
- **`instanceOf` and `isPowerType`** — the MLT layer, as a dashed
  `«instanceOf»` edge.
- **End decorations** — `(const father)`, `subsets`, `redefines`, on the end
  where UML puts them.
- **Documentation** — `///` prose as a PlantUML note, off by default.

## 8. Rendering, and where the model goes

Today's preview posts every model, silently, to `plantuml.com`. That is fine for
a public example and wrong for anything under NDA, and it does not work offline.

- Setting `tonto.viz.server`, default `https://www.plantuml.com/plantuml`, so a
  self-hosted PlantUML or Kroki instance is one line of configuration. The
  webview's CSP is built from that value.
- Setting `tonto.viz.render`: `server` (default) or `local`, the latter running
  a `plantuml.jar` named by `tonto.viz.jarPath` through the JRE.
- A one-time notice, the first time a model leaves the machine, saying where it
  went and how to change it.

## 9. Tests

- **Golden `.puml` files** for the example models in the redesign repo
  (`examples/university`, `boats`, `showcase`, `gufo`), regenerated by the CLI —
  the generator's behaviour becomes a diff instead of a screenshot.
- **Unit tests** for the parts that have historically broken: alias generation
  for `Package::Name`, declaration-before-reference ordering, package filtering,
  external-element grouping, cardinality rendering, nature colors per stereotype.
- **A round-trip check**: every element the model declares appears in the
  diagram exactly once, unless a filter excludes it.
- Rendering is not tested against `plantuml.com`; the goldens are the contract.

## 10. Milestones

| | |
|---|---|
| M0 | Repo scaffold: workspaces, tsconfig, eslint, vitest, AGENTS.md, submodule |
| M1 | `packages/diagram` + `bin/tonto-diagram` producing `.puml` for a file and a folder — the whole pipeline, provable from a terminal |
| M2 | Parity: classes, datatypes, enums, generalizations, relations, cardinalities, packages, colors, aliases, layouts, spacing |
| M3 | The extension: panel, options, legend, exports, zoom/pan, refresh |
| M4 | Tandem: live typing, last-good render, follow-active-editor, click-to-source, cursor highlight |
| M5 | Beyond parity: gensets, relation stereotypes, MLT, end decorations, notes |
| M6 | Packaging: bundled `.vsix`, README, CI, nightly build against `tontoredesign@main` |

M1–M3 are the replication the request asks for; M4 is what makes two panes
better than one.

## 11. Open questions

1. **The submodule.** It is the honest way to reuse a package that is not
   published, and it is a build step contributors have to know about. The
   alternative worth considering is publishing `tonto-language` to npm from the
   redesign repo — which is a change *there*, and so out of scope for now.
2. **Where a user's model may be sent.** Default to the public server, as today,
   or default to refusing and make the user choose a renderer?
3. **Scope of the first release.** Strict parity first (M0–M3), or parity and the
   redesign-native notation together?
