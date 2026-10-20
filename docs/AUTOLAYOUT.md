# Automatic layout: decision and trials

## Current decision

The only automatic class-diagram strategy is a PlantUML-like directed layered
graph using ELK's Network Simplex layering and linear-segment node placement.
Generalizations are directed from supertype to subtype for ranking; association
edges participate in ranking and within-rank order. Saved positions still
belong to the modeller and survive ordinary edits. Ontology package diagrams
use the same layered options.

## Tried and abandoned

- **Semantic ELK post-processing.** The earlier pipeline re-ranked taxonomies,
  moved relators and whole-part pairs, packed components, then searched local
  rank and spacing changes using a composite score. On the example renders it
  did not find consistent improvements over the direct layered result. Its
  separate repair passes also made the score hard to trust because later moves
  could undo earlier ones.
- **Legacy-specific root ordering and hub padding.** The old generator emits
  taxonomy roots first and widens high-degree labels with non-breaking spaces.
  Reproducing those cues made hub cards conspicuously wide in the canvas (for
  example, `Person` in the demo) without a clear readability gain. We keep the
  useful PlantUML-like graph behavior, not those generator workarounds.
- **Proxy-metric optimization.** Coverage, approximate path overlap, and
  label-to-line distance were useful diagnostics, but the examples showed they
  do not reliably rank human-readable arrangements. Visual comparison with the
  saved example views remains the deciding check; no score is treated as a
  substitute for it.
- **Taxonomy-rank wrapping.** A canvas post-pass used to split broad ranks at a
  configurable pixel span. It was part of the semantic repair pipeline, not the
  PlantUML-like layered result, so the control was removed with that pipeline.
  Older `.tontoview` files may still contain `maxRankSpan`; it is ignored.

The strategy comparison was rendered on `demo-isao` and `palm-oil-supply`.
No saved manual arrangement is replaced by automatic layout.

---

## Historical improvement notes

The notes below record earlier iterations and are kept as project history; they
do not describe the current pipeline. Several semantic repair and scoring
passes documented here were removed after the visual comparison summarized
above.

Automatic layout should produce a useful first reading of a model and remain a
good assistant after the modeller has begun arranging it. Semantic correctness
is a constraint, not one quality measure among others: taxonomy direction,
mediation and whole-part meaning must continue to come from `tonto-language`
through the view model.

An earlier implementation was a hybrid. ELK first arranged the graph, then the
canvas restored taxonomy ranks, settled relators, oriented whole-part pairs,
placed a selected subgraph beside fixed nodes, and routed the final edges. The
independent repair passes had no common measure of compactness, crossings, edge
length, displacement or label room. A later pass could therefore undo a useful
choice made by an earlier one; this is why the pipeline was simplified.

## Requirements

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

## Implementation tasks

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
- [x] Replace taxonomy re-ranking plus greedy semantic repairs with one
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
- [x] Add a persisted partonomy-only view, its counterpart for whole-part
  relations: wholes rank above their parts as supertypes rank above subtypes,
  through the same ranking passes asked which end of an edge goes above.
  Constitution ranks the constituted above its constituent. Parts are mostly
  roles, so a generalization is drawn, and ranked, when its supertype is a
  whole or both ends are parts of one whole (`FrontMotorcycleWheel` under
  `MotorcycleWheel`); a generic supertype every part role specializes is not.
  A generalization set's specifics stay side by side, off each other's bus.
  The two views are exclusive; a file that asks for both is read as
  taxonomy-only.
- [x] Keep a hierarchy-only appendix off the hierarchy's rows in package
  containers: under its package while that box can still be drawn, else in one
  block after the model.
- [x] Add persistent pin, alignment and distribution constraints, followed by a
  bounded-rank policy whose wrapping remains stable by element id.

## Intended architecture

The proposed pipeline has six stages:

1. derive semantic ranks and weighted constraints from the view model;
2. choose an initial layout per weakly connected component;
3. optimize ordering and cross-axis coordinates while enforcing hard ranks;
4. compact nodes without overlap and pack completed components;
5. route against final geometry, reserve label space and score the result;
6. retain the best deterministic candidate and persist only the resulting
   arrangement.

ELK remains useful for initial placement and routing. The canvas applies layout
constraints; the language supplies the model semantics behind them.
