# Automatic layout improvement plan

Automatic layout should produce a useful first reading of a model and remain a
good assistant after the modeller has begun arranging it. Semantic correctness
is a constraint, not one quality measure among others: taxonomy direction,
mediation and whole-part meaning must continue to come from `tonto-language`
through the view model.

The current implementation is a hybrid. ELK first arranges the graph, then the
canvas restores taxonomy ranks, settles relators, orients whole-part pairs,
places a selected subgraph beside fixed nodes, and routes the final edges. This
has made the drawing semantically better than an unqualified graph layout, but
the independent repair passes have no common measure of compactness, crossings,
edge length, displacement or label room. A later pass can therefore undo a
useful choice made by an earlier one.

## Quality contract

Hard requirements:

- no node overlap;
- every generalization follows the selected taxonomy direction;
- saved manual positions survive ordinary model edits;
- a partial arrangement does not move unselected nodes;
- stored routes remain attached to their endpoints and clear of final nodes;
- the same model and options produce the same arrangement.

Quality measures, in priority order:

1. edge-node intersections and unreadable labels;
2. edge crossings and semantic placement violations;
3. maximum and total edge length;
4. usable aspect ratio and occupied area;
5. displacement from an existing arrangement.

The representative benchmark set is `boats`, `pets`, `gufo`, `genealogy`,
`university`, `parties` and the manually arranged `error` reference,
supplemented by synthetic broad taxonomies, disconnected packages, multiple
inheritance, relators and dense whole-part graphs. Tests should assert the hard
requirements and thresholds or deltas for the quality measures rather than
exact ELK coordinates.

## Delivery slices

- [x] Do not make a compound ELK node for the only populated package. Package
  grouping has nothing to separate in that case, and `INCLUDE_CHILDREN` turns
  disconnected components into a long row. The package frame is still derived
  from its members when the diagram is rendered.
- [x] Compact weakly connected components after semantic placement and pack
  their bounds towards a 1.6 target aspect ratio in deterministic id order.
  Components move rigidly, so their ranks and internal relationships survive.
- [x] Remove the arrangement-engine option. Layered taxonomy is the only
  supported layout; legacy `.tontoview` engine fields are ignored. Direction,
  spacing and package cohesion remain the meaningful controls.
- [x] Add a benchmark harness that records bounds, crossings, edge-node
  intersections, edge lengths, taxonomy violations and label occlusion for the
  representative models.
- [ ] Replace taxonomy re-ranking plus greedy semantic repairs with one
  rank-constrained cross-axis optimizer. Taxonomy rank is hard; generalizations,
  mediations, whole-before-part order and package cohesion receive explicit
  weights during ordering and compaction.
- [x] Treat package cohesion as a soft preference unless a view explicitly asks
  for package containers. Taxonomies crossing package boundaries must retain
  shared ranks.
- [x] Give partial layout a fixed-neighbour halo, so relations to unselected
  nodes influence placement while those nodes remain immovable.
- [x] Make association labels part of the final-layout quality score, then
  validate their corridors and routes after semantic movement. Passing centre,
  head and tail label boxes directly to ELK was tried and rolled back: ELK made
  room by inserting and widening ranks, producing a substantially worse overall
  arrangement, while the later semantic repair passes moved the rendered labels
  away from the geometry for which that space had been reserved.
- [x] Add a persisted taxonomy-only view. It keeps the same classifiers and
  user preferences, but hides attributes and non-taxonomy edges and arranges
  from inheritance alone; classifiers outside a hierarchy form an appendix.
- [ ] Add persistent pin, alignment and distribution constraints, followed by a
  bounded-rank policy whose wrapping remains stable by element id.

## Intended architecture

The mature pipeline is component-oriented:

1. derive semantic ranks and weighted constraints from the view model;
2. choose an initial layout per weakly connected component;
3. optimize ordering and cross-axis coordinates while enforcing hard ranks;
4. compact nodes without overlap and pack completed components;
5. route against final geometry, reserve label space and score the result;
6. retain the best deterministic candidate and persist only the resulting
   arrangement.

ELK remains valuable as an initializer and router. The canvas layer owns the
additional diagram-reading constraints, while the language remains the sole
authority for what those constraints mean.

## Progress log

### 2026-09-11

- Added quality ceilings for `boats`, `pets`, `gufo`, `genealogy`, `university`, `parties`
  and a dense mixed-relationship regression supplied from an actual diagram.
- Protected the direct corridor between a general and its specific from the
  association-only classes settled after taxonomy ranks. This keeps later
  semantic repair from turning a straight inheritance line into a detour.
- Added a soft right-side preference for qualities and extrinsic modes beside
  the bearer identified by their characterization. Taxonomy membership and
  collision-free placement remain stronger constraints.
- Made component packing search every stable order for up to seven components,
  removing the empty shelf space that a fixed tall-first order cannot recover
  merely by trying more shelf widths.

### 2026-09-12

- Used the modeller's saved `error.tontoview` arrangement as a qualitative
  target. A whole with several leaf parts is now placed as a compact fan instead
  of applying the pairwise whole-before-part rule repeatedly and producing a
  diagonal chain.
- Refined the right-side aspect preference for two classifiers joined by
  several relations. Such a pair is stacked with a generous vertical corridor,
  leaving separate lanes for its relationship labels and end decorations.
- Added the first bounded rank-constrained optimizer. For diagrams of up to 32
  non-appendix nodes it tries barycentric rank ordering and adjacent exchanges,
  while the taxonomy rank axis stays fixed. Candidates must improve routed
  intersections, crossings, maximum/total edge length or span, and are rejected
  if the final port-spread/tree rendering worsens crossings or label occlusion.
  On `genealogy` this reduces crossings from 9 to 7. Larger diagrams retain the
  established layout until the rendered candidate score can be updated
  incrementally enough to remain interactive.
- Extended that optimizer from ordering to cross-axis coordinates. Complete
  visual bands move rigidly towards their connected neighbours, preserving
  rank, within-band order and semantic fan shapes. Explicit multi-package
  containers are not translated across their boundaries. On `genealogy`, width
  falls from 2255 to 1924, crossings from 7 to 6, and total edge length from
  7418 to 7032.
- Corrected the label-quality measure so the deliberately stacked stereotype,
  name and end-decoration lines belonging to one relation are treated as one
  label block rather than as collisions with themselves.
- Added a bounded final corridor-reservation pass after semantic movement and
  compaction. When a labelled relation has too little room between its endpoint
  boxes, it may move only a low-degree, unranked endpoint, and keeps that move
  only if the final routed rendering has fewer label collisions without adding
  an edge-node intersection, crossing or taxonomy-lane obstruction. On
  `genealogy` this removes three of the four genuine remaining label collisions;
  the final benchmark is 1813 x 1059, 6 crossings, 1 label collision and 6981
  total edge length.
- Made anchoring part of final routing quality. Ordinary associations now ask
  for their true line-of-sight intersection with a class border and are moved
  only enough to separate a crowded fan. The renderer also evaluates the former
  even-fan candidate and retains it when the completed routes have fewer node
  intersections or crossings, so a better local anchor cannot spend global
  readability.
- Made ordinary generalizations meet the sides facing their taxonomy ranks:
  top and bottom for a downward layout, left and right for a rightward one.
  The saved layout direction is now used consistently by the panel, exports,
  CLI and optimizer's rendered safety checks.
- Extended final label-corridor reservation to ranked endpoints, which may move
  only along their cross axis and only under the same rendered safety gate. On
  `genealogy` this retains 1 label collision and 6 crossings with the clearer
  rank-facing anchors; bounds are 1818 x 1059 and total edge length is 7150.
- Added the `Taxonomy only` display setting and CLI flag. The mode suppresses
  attributes, associations and instantiations without overwriting their
  individual display settings, feeds only generalizations to automatic layout,
  and puts classifiers with no inheritance into a compact appendix after the
  taxonomy. Toggling the mode preserves manual placement; an explicit Arrange
  applies its hierarchy-specific layout.
- Made partial Arrange aware of relations crossing the selection boundary. It
  keeps the selected arrangement rigid and every unselected classifier fixed,
  then chooses a collision-free translation that shortens those boundary
  relations while retaining a smaller preference for the selection's previous
  location.
- Separated package clustering from package containment. With package boxes
  hidden, package membership is a soft ordering penalty below intersections and
  crossings. Visible package boxes still use ELK compound nodes, but taxonomy
  component discovery now crosses those package boundaries so inheritance
  levels remain shared.
