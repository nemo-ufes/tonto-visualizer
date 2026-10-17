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
| 8 | Generalization-tree interaction | A branch needs selection and source navigation without pretending the shared stem is a generalization set or offering nonsensical route handles. | Design needed |

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
- [ ] Put the view switcher in the panel toolbar as well as the command palette.
- [ ] Create an empty named view as an alternative to copying the current one.
- [ ] Rename and delete named views with explicit, recoverable file operations.
- [ ] Surface orphaned placements so they can be reassigned after a model rename.

## Progress log

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
