# Product roadmap

Tonto Visualizer should make an ontology easier to read and navigate while the
Tonto text remains its single source of truth. The next work therefore deepens
views, navigation and review before it considers drawing-to-edit operations.

## Priorities

| Priority | Feature | Why it comes here | Status |
|---|---|---|---|
| 1 | Named diagram views | A large model needs several intentional diagrams, each with its own content, arrangement and notation choices. | In progress |
| 2 | Focus and search | A modeller must be able to find one declaration and see only its immediate semantic neighbourhood. | Planned |
| 3 | Layout constraints | Pinning, alignment, distribution and bounded taxonomy rows let automatic layout assist rather than replace a hand arrangement. | Planned |
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

One model may have a default view and any number of named views beside it:

```text
employment.tonto
employment.tontoview
employment.core-taxonomy.tontoview
employment-relations.tontoview       # not a view of employment.tonto
```

The association is intentionally lexical and local. A named view of
`employment.tonto` is `employment.<name>.tontoview` in the same directory. The
view continues to contain only content choices, positions, routes and display
options; the filename identifies its model, so version 1 of the file format does
not need another path that can go stale when a repository moves.

### Delivery slices

- [x] Discover the default and named sibling views.
- [x] Save the current diagram as a named view.
- [x] Switch among views without reopening the model.
- [x] Show the active view in the panel and canvas titles.
- [x] Cover filename normalization, discovery and copied state with tests.
- [ ] Put the view switcher in the panel toolbar as well as the command palette.
- [ ] Create an empty named view as an alternative to copying the current one.
- [ ] Rename and delete named views with explicit, recoverable file operations.
- [ ] Surface orphaned placements so they can be reassigned after a model rename.

## Progress log

### 2026-09-07

- Defined the post-0.1 feature order.
- Delivered the first named-view slice through **Open Diagram View** and **Save
  Diagram as Named View** commands, including safe replacement confirmation.
- Added sibling discovery, filename normalization, active-view titles and a
  copy operation that works even when automatic arrangement saving is off.
- Added four storage-level tests; the repository now runs 154 tests.
- Kept the existing `.tontoview` schema and default-view behaviour compatible.
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
