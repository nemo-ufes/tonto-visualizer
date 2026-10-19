# Product roadmap

Tonto Visualizer should make an ontology easier to read and navigate while the
Tonto text remains its single source of truth. The next work therefore deepens
views, navigation and review before it considers drawing-to-edit operations.

## Priorities

| Priority | Feature | Why it comes here | Status |
|---|---|---|---|
| 1 | Named diagram views | A large model needs several intentional diagrams, each with its own content, arrangement and notation choices. | In progress |
| 2 | Focus and search | A modeller must be able to find one declaration and see only its immediate semantic neighbourhood. | Planned |
| 3 | [Layout constraints](AUTOLAYOUT.md) | Pinning, alignment, distribution and bounded taxonomy rows let automatic layout assist rather than replace a hand arrangement. | In progress |
| 4 | Diagnostics overlay | Errors and warnings belong on the affected card or relation, with a direct route back to the declaration. | Planned |
| 5 | Semantic revision diff | Ontology review should show added, removed and changed declarations against a Git revision without throwing away the familiar arrangement. | Planned |
| 6 | Diagram navigation | A minimap, back/forward history and breadcrumbs keep very large drawings navigable. | Planned |
| 7 | Documentation inspector | `///` documentation and an element's semantic connections should be readable without crowding the canvas. | Planned |
| 8 | Generalization-tree interaction | A branch needs selection and source navigation without pretending the shared stem is a generalization set or offering nonsensical route handles. | Delivered |

Editing the Tonto model by drawing is deliberately not on this roadmap. It has
different semantic, validation and undo requirements; adding it before the
reading and review workflows are strong would blur the boundary that keeps the
model authoritative.

## 1. Named diagram views

One model may have a default view and any number of named views under `views`:

```text
employment.tonto
views/
    employment.tontoview
    employment.core-taxonomy.tontoview
    employment-relations.tontoview   # not a view of employment.tonto
```

The association is intentionally lexical and local. A named view of
`employment.tonto` is `views/employment.<name>.tontoview`. The view continues to
contain only content choices, positions, routes and display options; the
filename identifies its model, so version 1 of the file format does not need
another path that can go stale when a repository moves. The folder and default
view are created lazily, only after the modeller changes the automatic result.

### Delivery slices

- [x] Discover the default and named views belonging to a model.
- [x] Save the current diagram as a named view.
- [x] Switch among views without reopening the model.
- [x] Show the active view in the panel and canvas titles.
- [x] Cover filename normalization, discovery and copied state with tests.
- [x] Keep views under `views/` and create no file for an untouched automatic layout.
- [x] Put the view switcher in the panel toolbar as well as the command palette.
- [ ] Create an empty named view as an alternative to copying the current one.
- [ ] Rename and delete named views with explicit, recoverable file operations.
- [x] Move a model's default and named views with it when it is renamed or
  moved in the editor, as part of the rename's own edit.
- [ ] Surface orphaned placements so they can be reassigned after a model rename.

## Progress log

### 2026-10-19 (development installs and releases)

- Versioning, local installs and releases now follow tonto's procedure. The
  view, canvas, CLI and extension are one release set at one stable version,
  `0.1.62` to start, checked by `npm run versions:check` in CI.
  `npm run dev:install` packages and installs `<next patch>-dev.<ms>.<pid>`
  without changing the tracked version, which replaces the old bump on every
  package and its commit of a build timestamp. `npm run release:prepare`,
  a signed tag and the `Release tonto visualizer` workflow make a release; the
  Marketplace is optional and off by default.
- F5 launches the Extension Development Host after a full build, and CI uploads
  the packaged VSIX.

### 2026-10-19 (third-party notices)

- The VSIX carried no notice for any package bundled into it: `--no-dependencies`
  leaves their LICENSE files behind and esbuild drops their copyright headers.
  The build now writes `out/THIRD-PARTY-NOTICES.txt` from what esbuild bundled,
  as tonto's extension does, with each package's license text and the headers
  its bundled files carry. A license that is not permissive stops the build.
- elkjs is the one exception, taken by name under EPL-2.0 (it is offered as
  EPL-2.0 OR GPL-3.0-or-later): its notices are kept, its license text
  included, and its section says where its source is available.
- The language pin moves to tonto's `7cca85f`, which gives `tonto-language`
  a LICENSE of its own to copy.

### 2026-10-19 (the language moves to nemo-ufes/tonto)

- The language submodule is now [`nemo-ufes/tonto`](https://github.com/nemo-ufes/tonto)
  at `vendor/tonto`, where the redesign was published as 0.9.1;
  `jpalmeida/tontoredesign` is no longer followed. `modelRoot` is the
  language's `workspaceRootOf` under this repository's name.
- That repository ships no `examples/`, so the models the layout benchmarks
  measure -- `boats`, `classonly`, `gufo`, `pets`, `showcase` and the
  `university` manifest -- are kept in `packages/canvas/test/fixtures`. They
  parse without errors under 0.9.1, which warns about more of them than the
  redesign did (lowercase package names, `const` on value attributes); they
  are left as they were so the benchmark ceilings still measure the same
  drawings. CI renders the language's own test models as well.

### 2026-10-17 (merged the September view-switcher and tree work)

- Merged four commits from 2026-09-07 that had stayed on GitHub: choosing a
  generalization set and a single leg of its tree, a tree that follows a
  dragged class, named views tied to their model, and the panel title as the
  view switcher. The toolbar has had no title since it was simplified on
  2026-09-11, so the switch is a **Views** button there instead.
- A tree redrawn during a drag reuses where the last full drawing put its
  triangle; without that it fell back to an even share of the parent's border
  and jumped sideways as the drag began. Tree legs are left out of the layout
  benchmarks, which measure routed lines.

### 2026-10-17 (views follow renames)

- Renaming or moving a `.tonto` file in VS Code moves its views to the new
  name in the same workspace edit, so one undo restores both. Legacy sibling
  views are moved into `views`; a view whose filename belongs to another model
  (`a.roles.tontoview` beside `a.roles.tonto`) stays; an existing view at the
  new name is never overwritten. An open diagram follows to the new name and
  writes to the moved file.

### 2026-10-17

- Followed tontoredesign's main, where every package belongs to a declared
  ontology: a bare package is an error, and implicit ontologies -- by shared
  document, name, namespace or `tonto.json` -- are gone. The canvas fixtures
  carry an `ontology` header above their package, so their ids are unchanged.
- The university example is now the `academia` manifest, so its benchmark
  draws resolved references again and is back under its original ceiling.

### 2026-10-16

- Followed tontoredesign to ontologies as the unit of publication: `ontology`
  headers, `bundles`, member packages (`package core in shop`), `use` for a
  package dependency and `import alias from <location>` for another ontology.
  `global` packages are gone from the language and from here.
- Drew a manifest as a package diagram: the ontology as a frame round its
  member packages, «use» between them, and each imported ontology as an
  external package, imported from the frame or from the package that declares
  the import. Laid out supplier above client; the frame is an edge end that
  moves with its packages.
- Drew a monolithic ontology as a class diagram named after the ontology, kept
  ontologies imported from outside the workspace out of its package list, and
  made the CLI find a model's root as the language does.
- Re-baselined the pets and university benchmarks for upstream's changed
  examples; university's files are three separate ontologies until upstream
  gives the folder one.

### 2026-09-07

- Defined the post-0.1 feature order.
- Delivered the first named-view slice through **Open Diagram View** and **Save
  Diagram as Named View** commands, including safe replacement confirmation.
- Added sibling discovery, filename normalization, active-view titles and a
  copy operation that works even when automatic arrangement saving is off.
- Added four storage-level tests; the repository now runs 154 tests.
- Kept the existing `.tontoview` schema and default-view behaviour compatible.
- Closed the toolbar slice of priority 1: the panel title, which already says
  which view is drawn, is the switch. Clicking it opens the same picker the
  palette command does, with the open view marked in its own row; it is a
  button, so it is reachable by keyboard, and styled as the title it is with a
  caret as the only sign that it does anything.
- Finished priority 8: the set is now chosen as itself -- clicking its bar,
  stem or label draws the whole tree chosen, where one leg chosen is one
  specialization, and the cursor on the `genset` line chooses it in the diagram.
  A chosen set stands for the classes it holds wherever a selection moves
  things, so arranging one arranges its taxonomy rather than the whole diagram.
  A tree also follows a class being dragged now: it is a figure derived from
  where its classes are rather than a line between two of them, so it is drawn
  again by the same code a full rendering uses.
- Took priority 8 while the drawing code was open. A leg of a shared tree
  carries the id of the generalization it is: clicking one chooses that
  specialization and draws it chosen, double-clicking one opens the line it is
  written on, and the stem, bar and triangle open the `genset` declaration
  instead, since those are the set rather than any one branch of it. A leg is
  offered no route handle -- the tree decides where its branches run -- and, as
  no generalization is, it cannot be hidden. Generalizations now carry where
  they are written, which nothing in the view model had.
- Corrected two things the first slice got wrong, with two more tests (156):
  discovery offered the views of a model whose name begins the same way --
  `employment.v2.roles.tontoview`, and `employment.v2.tontoview` where that
  model exists -- as views of `employment.tonto`; and the panel remembered a
  named view only while it stayed on one document, so following the editor to
  another model and back silently reopened the default arrangement.
