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
- [ ] Treat package cohesion as a soft preference unless a view explicitly asks
  for package containers. Taxonomies crossing package boundaries must retain
  shared ranks.
- [ ] Give partial layout a fixed-neighbour halo, so relations to unselected
  nodes influence placement while those nodes remain immovable.
- [ ] Make association labels part of the final-layout quality score, then
  validate their corridors and routes after semantic movement. Passing centre,
  head and tail label boxes directly to ELK was tried and rolled back: ELK made
  room by inserting and widening ranks, producing a substantially worse overall
  arrangement, while the later semantic repair passes moved the rendered labels
  away from the geometry for which that space had been reserved.
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
  On `genealogy` this reduces crossings from 9 to 7 and label occlusions from
  28 to 25. Larger diagrams retain the established layout until the rendered
  candidate score can be updated incrementally enough to remain interactive.
