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
- [x] Put the view switcher in the panel toolbar as well as the command palette.
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

### 2026-09-08

- Reviewed the arrangement against the constructs the language offers, by
  measuring six models and looking at the drawings:
  [LAYOUT-REVIEW.md](LAYOUT-REVIEW.md). It reads the taxonomy, the packages and
  the relators, and is blind to the generalization sets, parthood, `instanceOf`,
  the categorizers, the aspects that are not relators, and the natures.
- A generalization set now declares its generalizations, as the language says
  it does. `genset X where A, B specializes C` is the one form in which the
  class writes no `specializes` of its own, and those specializations had been
  absent from the picture altogether -- no line, no rank, no triangle. Eight of
  them across the examples; `boats` had been drawing `FunctionalMotor` and
  `BrokenMotor` as two loose cards half a diagram from `Motor`.
- What counts as a relator is now the nature the language resolves rather than
  the `relator` keyword, in the layout as well as in the drawing, which had
  disagreed about it: gUFO declares seven relator-natured classes and writes the
  keyword on none of them.
- A relator now looks around the middle of its relata for a clear place, not
  only along the line back to where the ranking left it -- which finds nothing
  when a relatum stands on that line, as one does for a relator of three. It
  takes a place only where the move hides no line behind a class that has
  nothing to do with it.
- The pass that turns a relator's mediations round for the ranking is judged
  rather than skipped. It had been unreachable on any model holding a single
  generalization, which is every ontology anyone draws, and the test covering it
  used the one shape that could still reach it.
- Lines passing behind an unrelated class, over the six models: 4, 1, 13, 8, 0,
  1 before, and 3, 2, 9, 8, 0, 0 after -- with five generalizations drawn on
  `pets` that were not being drawn at all. The repository now runs 169 tests.
- Gave the three other vertical readings the treatment the generalization
  already had, since a layered algorithm ranks a source above its target and
  they all read the other way round: a whole above its parts, whichever end the
  diamond is on; what is constituted above what constitutes it, the statue above
  its marble and the process above the events in it; and a type above what
  instantiates it, which is where the language's end-nature table puts it. Eight
  instantiations out of eight in the examples had been drawn with the type under
  its instances.
- Which end of a constitution is the constituted one is now derived where the
  language can be asked. It fixes the direction of one pair -- a process is
  constituted by the events in it, the single crossing in its end-nature table
  -- and elsewhere the reading is its own completion's: `@constitution` runs
  from what constitutes to what is constituted.
- The cost, measured: `university` and `boats` each draw one or two more lines
  behind a class the line has nothing to do with, which the router bends around
  rather than hiding, and `boats` loses the seat of one relator whose middle the
  settle step can no longer reach. Parthood on its own is a pure gain, and the
  three together cost less than constitution does on its own. The repository now
  runs 173 tests.
- Seated the two readings that go across the drawing rather than down it. A
  high-order type is put to the left of what instantiates it and an aspect to
  the right of what bears it, level with it in both cases: a level is not a
  rank, and a quality hanging under its bearer is drawn where a subtype belongs.
  A class in a hierarchy takes the hierarchy with it, and where the two are in
  one hierarchy -- gUFO's `Aspect` both specializes and characterizes its
  `ConcreteIndividual` -- there is nothing to settle.
- With the type seated rather than ranked, the layering is asked for nothing on
  an instantiation. Asked for a rank instead, as it was for a day, it pulled the
  whole drawing about: `university` went from no line passing behind a class to
  five, and `boats` lost a relator's seat. Both come back, and `boats` is down
  to 8 such lines from the 13 it started at. 175 tests.
- Seated a relator that mediates one class beside that class. `Marriage` on
  `boats` involves `[2] (const spouses) Spouse` -- two spouses as a cardinality
  on one mediation -- so it has one relatum, and every rule about relators is
  about betweenness, which needs two: `settleRelators`, `strandedRelators` and
  `mediationsToTurn` all passed over it. It was drawn 1083px from the `Spouse`
  it involves, the longest line in the drawing, and the stranded count said
  zero. Such a relator is dependent on one class and nothing else, which is what
  an aspect is, so it is seated where an aspect is: 180px now, and `Supervision`
  -- which mediates `Person` twice -- 222px from 320. 176 tests.
- Made room in the arrangement for what a relation writes on itself. A corridor
  between two ranks is deepened by a line of text for every labelled association
  crossing it, and the gap between two neighbours in a rank is opened to the
  widest reading written between them. gUFO had nine label blocks sharing one
  hundred-pixel corridor and `«bringingAbout» broughtAboutBy` -- a hundred and
  seventy pixels of text -- written along a sixty-pixel gap. Overlapping label
  pairs: gUFO 21 to 7 and the ink they cover 2.4% of the label area to 0.3%;
  `boats` 14 to 6 and 1.4% to 0.6%, with two fewer lines drawn behind unrelated
  classes. gUFO pays a fifth of its height; no other model changes size.
- Handing ELK the labels themselves, which is the textbook answer, was tried and
  measured first: it helped `boats` and made gUFO worse under every centre-label
  placement strategy, since it reserves room between ranks only and a straight
  drawing throws ELK's edge routing away. 178 tests.
- The gap between two neighbours in a rank now fits each of the readings written
  between them rather than the widest of them: two associations between one pair
  write two labels there, which is why `«bringingAbout» broughtAboutBy` and
  `«triggering» contributedToTrigger` were drawn over each other between gUFO's
  `Situation` and `Event`. gUFO: 7 overlapping label pairs to 6, and the ink they
  cover 0.29% of the label area to 0.18%, for 5% more width; nothing else moves.
- Two other ways of making room were measured and dropped. Widening a gap by the
  lines passing through it bought one collision for a fifth of gUFO's width and
  cost `university` its clean sheet. Raising `nodeSpacing` -- the obvious answer
  to a crowded drawing -- makes it worse: at 80 gUFO goes from 7 pairs to 8 and
  `showcase` from none to two; at 100 gUFO reaches 13. A longer line carries the
  same text past more of everything else, so the room has to be made where the
  text is.
- Opened the default spacing to 100 between neighbours and 140 between ranks,
  and gave the panel the three spacings the PlantUML preview offered: tight
  (60/100, what the default was), comfortable and roomy. gUFO's
  `Endurant`/`Situation`/`Event` neighbourhood -- eight labelled associations
  meeting three classes -- could not be read at the old default, and reads at
  the new one.
- The measurement said otherwise and was wrong to. Counting labels that touch
  another label or carry a line through them, gUFO sits at about half of them at
  60, at 100 and at 140 alike; what changes is that at 60 the eight stereotypes
  of that neighbourhood are one grey mass and at 100 each is on its own line.
  Counting is not reading, and the drawings decided this one.
- Four other ways to the same end were measured and dropped: ELK's own edge
  labels, its edge-edge and edge-node spacings, a gap widened by the lines
  passing through it, and `elk.margins` per class -- which the JSON API ignores
  in elkjs 0.12 entirely. Making the label placer cheaper to move and its reach
  longer changed nothing either: what limits it is the candidates it is offered,
  which all lie along its own line. 181 tests.
