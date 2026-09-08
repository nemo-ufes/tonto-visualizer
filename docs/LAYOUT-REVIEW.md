# What the layout knows about the language

A review of `packages/canvas/src/autolayout.ts` against the constructs Tonto
actually offers, made by measuring the arrangement of `university`, `pets`,
`boats`, `gufo`, `showcase` and the `parties` fixture and by looking at the
drawings. It is a record of where the arrangement reads the ontology and where
it reads a graph, and of what has been done about it since.

## The question

The layout is ELK's layered algorithm with three things done around it. A
layered algorithm knows about nodes and edges; a UFO model states rather more
than that. So: which of what the model states does the arrangement use, and
which does it leave on the table?

## What it uses

| construct | what the layout does with it |
|---|---|
| generalization | handed to ELK reversed, with the direction and straightness priorities, and then re-ranked from generalizations alone per connected component, so an association cannot invent a hierarchy level |
| package | a compound node, with the spacings repeated on it, so a package's classes stay together |
| relator, mediation | a relator is seated between the classes it mediates, and half a relator's mediations may be turned round for the ranking |
| parthood | handed over whole -> part, whichever end the diamond is written on |
| constitution | handed over constituted -> constituent, which the language decides for a process and its events and the written direction decides elsewhere |
| `instanceOf` | the type is seated to the left of what instantiates it, level with it |
| characterization | the aspect is seated to the right of what bears it, level with it |
| inverse pair | one association, drawn and laid out once |
| datatype, enumeration | one with no edge at all is constrained to the last layer, out of the corridors between classes |

Measured over the six models, supertypes are above their subtypes everywhere.
That part works, and it is the part a reader of a class diagram most depends on.

## What it does not

Everything below is stated by the language, carried in the view model, and
ignored by the arrangement.

**Generalization sets.** `view.gensets` is not read by `autolayout.ts` at all,
and `categorizers` is read nowhere in `packages/canvas`. Two consequences.
Sibling specifics are ordered inside their rank by whatever cross-position ELK
chose, so an unrelated class lands between them and the shared bar is drawn
across it: `Sortal` sits inside the `endurantTypesByRigidity` row on gUFO, and
`NonRigidType` inside `endurantTypesBySortality`. And a set's categorizer --
the high-order type that classifies the specifics -- is placed with no regard
for the triangle it belongs to.

**Power types.** `isPowerType` reaches only the label. A high-order type is now
ranked above what instantiates it, but a categorizer is still placed with no
regard for the triangle it categorizes.

**The other aspects.** An extrinsic mode's `externalDependence` has no rule --
a relator's mediations and a mode's characterization now do. The event
vocabulary --
`participation`, `historicalDependence`, `creation`, `termination`,
`triggering` -- carries a temporal reading that no option expresses;
`participational` at 1444px and `historicalDependence` at 1368px on `pets` are
lines nothing tried to shorten.

**`isExternal`.** A class drawn only because something in scope points at it is
context, and belongs at the edge of the drawing the way an unattached datatype
already does. It is placed like anything else.

## Two rules that were there and inert

**The relator was recognised by its keyword.** `settleRelators`,
`mediationsToTurn` and `strandedRelators` each tested
`node.stereotype === 'relator'`, while the renderer -- which aims a mediation
through the middle of a relator rather than at its border -- had already
decided that *the nature decides, not the stereotype*. On gUFO that is the
difference between 7 relator-natured classes and none: not one of them is
written `relator`. The drawing was aiming lines through a relator the
arrangement did not believe in.

**The turning pass could not run.** `autoLayout` computed `hasTaxonomy` and, for
a layered full layout, returned the first attempt whenever the model held a
single generalization between two classes in scope -- which is every ontology
anyone draws. The hundred lines of `mediationsToTurn`, and the second ELK pass
they exist for, were reachable only on a model with no taxonomy at all. The
test that covers the feature uses exactly such a model: three classes, two
mediations, no generalization.

## What was changed

**A generalization set now declares its generalizations** (`derive.ts`). The
language is explicit -- `genset-checks.ts`: *"A generalization set declares
generalizations, so its specifics must be able to specialize its general"* --
but the derivation only *marked* generalization edges that a `specializes`
clause had already created. In the `genset X where A, B specializes C` form the
class usually writes no `specializes` of its own, so the specialization was
absent from the picture entirely: no line, no rank, no triangle. Eight of them
across the examples (`boats` 2, `pets` 5, `showcase` 1). On `boats` that had
left `FunctionalMotor` and `BrokenMotor` standing in the top row, half a
diagram from the `Motor` they are the phases of; they are now under it, below
one shared triangle marked `{disjoint, complete}`.

**A relator is recognised by its nature** (`ontology.ts`, new), which is the
rule the renderer already used, now in one place and read by both halves.

**A relator settles into the nearest clear place near the middle of its relata,
and only where that hides no line.** Walking back along the line from the
ranking to the middle finds nothing when a relatum stands on that line, which
is the ordinary case for a relator of three: `ClinicVisit` stayed above its
`Pet`, `PetClinic` and `Veterinarian` because every share of the way to the
middle put it through one of them. It now looks around the middle as well as
along that line, and takes a place only if the move hides no more lines behind
classes they have nothing to do with -- which is what stops the search from
buying betweenness with the defect this drawing fights hardest.

**The turning pass is judged rather than skipped.** The `hasTaxonomy` guard is
gone; the second attempt is kept when it seats more relators and hides no more
lines. On these six models it is proposed once and refused, which is the answer
the guard was reaching for and now the answer to the question rather than to the
model's shape.

Measured over the six models, before and after, counting the lines that pass
behind a class that is not at either end of them:

| model | lines through unrelated classes | relators not between their relata |
|---|---|---|
| university | 4 → 3 | 0 → 0 |
| pets | 1 → 2 (with 5 generalizations now drawn that were not) | 0 → 0 |
| boats | 13 → 9 | 0 → 0 |
| gufo | 8 → 8 | 0 → 0 |
| showcase | 0 → 0 | 0 → 0 |
| parties | 1 → 0 | 1 → 1 |

## What was changed next: the three vertical readings

A layered algorithm ranks an edge's source above its target, and four kinds of
edge in a UFO model read the other way round or not at all. Only the
generalization was handed over reversed; the rest were plain associations with
no direction asked for, so how they came out was incidental. All four now go
through one function, `handedOver`:

- **parthood**, whole above part, reversed when the diamond is on the target;
- **constitution**, the constituted above what constitutes it -- the statue
  above its marble, the process above the events in it. There is no diamond to
  say which end that is, so `packages/view` resolves it: the language fixes the
  direction of one pair, "a process is constituted by a certain series of
  events", the single crossing in its end-nature table, and everywhere else the
  reading is the one the language's own completion offers -- `@constitution`
  "runs from what constitutes to what is constituted";
- **`instanceOf` and `@instantiation`**, the type above what instantiates it,
  since `instantiation: [EVERYTHING, ['type']]` puts the type at the target end;
- **mediation**, turned or not, as before.

Which way round the edge goes is the whole of it: the direction priority beside
it is read only when ELK breaks a cycle, and 0, 1, 3 and 6 draw all six models
to the pixel. Measured, before and after:

| model | whole above part | type above its instances | constituted above constituent | lines through unrelated classes |
|---|---|---|---|---|
| university | 3/4 → **4/4** | 0/1 → **1/1** | – | 3 → 5 |
| pets | 1/1 | – | – | 2 → 2 |
| boats | 7/11 | 0/6 → **6/6** | 1/3 → **3/3** | 9 → 10 |
| gufo | 0/2 | – | – | 8 → 8 |
| showcase | 2/2 | 0/1 → **1/1** | – | 0 → 0 |
| parties | 1/1 | – | – | 0 → 0 |

Eight instantiations out of eight now read downwards from the type, where none
did. The costs are two: `university` and `boats` each gain lines that pass
behind a class -- which the router bends around rather than hiding, so they are
bends rather than the defect itself -- and `boats` loses the seat of one
relator, `Employment`, which the settle step can no longer reach a clear place
for. Taken separately, parthood alone is a pure gain (`university` 3 lines
through to none), constitution alone the most expensive (`boats` 9 to 15), and
the three together cost less than constitution alone does.

`boats` keeps 4 parthoods with the part above the whole, and all four are the
same shape: a part that is also a subtype, where `enforceTaxonomyRanks` puts it
back under its supertype afterwards. That is the taxonomy winning, which is the
order this drawing is meant to be read in.

`parties` keeps its stranded relator: `EmploymentContract` is declared in
`Employment` and mediates two classes in `Parties`, and with the packages drawn
as boxes there is nowhere between them for it to go that does not put one box
around classes it does not hold. That is a property of grouping, not of the
relator rule, and it is why the settle step now refuses the move it used to make
there -- the move it made was worth one hidden line and no seat.

## What was changed after that: the two readings that go across

A level is not a rank, and neither is an inherence. Ranking a high-order type
above what instantiates it says `Car` is a kind of `CarType`, which is what a
generalization says and not what an instantiation does; hanging a quality under
its bearer draws it where a subtype belongs. Both read across the page, so both
are now seated across it, by a pass of their own (`settleBeside`):

- a **high-order type** goes to the **left** of what instantiates it, level
  with it -- `instantiation: [EVERYTHING, ['type']]` puts the type at the target
  end, and an `instanceOf` clause is derived the same way round;
- an **aspect** goes to the **right** of what bears it, level with it --
  `characterization` runs "from the mode or quality to its bearer, which is
  always exactly one", so the source is the aspect.

A class in a hierarchy takes the hierarchy with it, since a power type over its
own subtypes is one piece; where the two are in one hierarchy -- gUFO's `Aspect`
both specializes and characterizes its `ConcreteIndividual` -- there is nothing
to settle and the pass leaves it alone. The place is taken only where it is
clear and where the move hides no line; a type that finds no room beside its
class is offered the room above it instead, and anything still without a place
stays where the layering left it.

With the type seated rather than ranked, the layering is asked for nothing at
all on an instantiation. Asked for a rank instead, it pulled the whole drawing
about: `university` went from no line passing behind a class to five, and `boats`
lost the seat of a relator. Both come back.

| model | type left of its instances | aspect right of its bearer | lines through unrelated classes |
|---|---|---|---|
| university | **1/1** | – | 5 → **0** |
| pets | – | 0/1 | 2 → 2 |
| boats | 1/3 | **2/2** | 10 → **8** |
| gufo | – | 0/1, and rightly | 8 → 8 |
| showcase | **1/1** | – | 0 → 0 |
| parties | – | – | 0 → 0 |

The two that are not seated are both blocked by a hierarchy that will not fit
in the room beside the class: `pets` would have to bring `LegalPosition`'s three
extrinsic modes with it, and `boats` `CarType` and `CarModel` together, into a
rank whose left-hand side is full of classes nothing joins to. They keep the
column the layering gave them, which still reads as a level.

## What is worth doing next, in payoff order

1. **Teach `enforceTaxonomyRanks` the generalization sets**: one rank for a
   set's specifics, contiguous and in declaration order, with the categorizer
   beside the bar. It is a change to how a row is built and sorted, not a new
   pass.
2. **Make room rather than looking for it.** Both readings that go across fail
   the same way -- the rank beside the class is full -- and a pass that opened a
   column would seat them where searching cannot.
3. **Place external elements at the periphery**, as an unattached datatype
   already is.
4. **Seat a relator whose relata are in another package**, which grouping
   currently makes impossible -- either by letting a package box be drawn
   around what it holds rather than around a bounding rectangle, or by saying
   that a cross-package relator is one of the things a hand arrangement is for.
5. **Rank a parthood that runs against a taxonomy.** `boats` draws 7 of its 11
   parthoods with the whole above the part and the other 4 are all in the same
   shape: a part that is also a subtype of something, where the taxonomy's rank
   wins and should.
