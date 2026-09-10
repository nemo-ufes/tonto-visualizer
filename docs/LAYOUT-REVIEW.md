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
| relator, mediation | a relator is seated between the classes it mediates -- or beside the one class, where it mediates one -- and half a relator's mediations may be turned round for the ranking |
| parthood | handed over whole -> part, whichever end the diamond is written on |
| constitution | handed over constituted -> constituent, which the language decides for a process and its events and the written direction decides elsewhere |
| `instanceOf` | the type is seated to the left of what instantiates it, level with it |
| characterization | the aspect is seated to the right of what bears it, level with it |
| inverse pair | one association, drawn and laid out once |
| datatype, enumeration | one with no edge at all is constrained to the last layer, out of the corridors between classes |
| a relation's label | the corridor between two ranks is deepened by a line for every labelled association crossing it, and the gap between two neighbours in a rank is opened to fit what is written between them |

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

## A relator of one, which no rule held

`Marriage` on `boats` is written `@mediation relation Marriage -- involves --
[2] (const spouses) Spouse`: two spouses, stated as a cardinality on one
mediation. So the relator has one relatum, and every rule about relators is
about betweenness, which needs two -- `settleRelators`, `strandedRelators` and
`mediationsToTurn` all pass over it at `relata.length < 2`. Nothing held it
anywhere near the class it involves, and nothing counted that as a defect: it
came out 1083px from `Spouse`, the longest line in the drawing, and the
stranded-relator count said zero.

A relator that mediates one class is dependent on that class and on nothing
else, which is what an aspect is, so it is now seated the way an aspect is: at
the class's side. The side is a preference rather than the point -- the right
first, as an aspect's is, then the left, then above -- and the move is taken
only while it brings the two cards closer than the layering left them.
Measured between the cards rather than between their centres, because a card
beside another has its centre further away than a card under it, and measuring
centres would refuse the very move this is for.

Two spouses written as `[2]` and two written as two mediations to the same class
are the same relator, and both are covered: `Supervision`, which mediates
`Person` twice, was 320px from it and is now 222.

| model | relator | before | after |
|---|---|---|---|
| boats | `Marriage` -> `Spouse` | 1083px | **180px** |
| boats | `Supervision` -> `Person` | 320px | **222px** |
| showcase | `Marriage` -> `Spouse` | 366px | 366px, the rank being full either side |
| gufo | `Relator` -> `Endurant` | 434px | 434px, and rightly: it specializes what it mediates, so moving it would take the class with it |

## Room for what is written

Every association writes its stereotype and its name in the middle of itself,
and until now nothing in the arrangement knew that. A corridor between two ranks
was one `rankSpacing` however many lines had to be written in it, and the gap
between two neighbours in a rank was one `nodeSpacing` however long the label
between them was. The label placer runs afterwards and can only choose among the
places a finished drawing offers; where the drawing has already decided there is
no room, its best answer is the least bad collision.

gUFO is the model that shows it. Nine label blocks shared one hundred-pixel
corridor between the `Endurant`/`Situation`/`Event` row and the `Object`/`Aspect`
row -- `«participation»` printed over `contributedToTrigger`, `{redefines
Entity.parts}` through `«bringingAbout»`, a `*` on a role name -- and
`«bringingAbout» broughtAboutBy`, a hundred and seventy pixels of text, was
written along a sixty-pixel gap between `Situation` and `Event`.

Both halves are now the arrangement's business, in the one pass that lays the
ranks out itself:

- a corridor is deepened by **one line of text for every labelled association
  that crosses it**, bounded at twice the rank spacing;
- the gap between two neighbours in a rank is opened to fit **each of the
  readings written between them**, plus room for the triangle after a name --
  each, not the widest, because two associations between one pair write two
  labels there and the space for one is where `«bringingAbout» broughtAboutBy`
  and `«triggering» contributedToTrigger` were drawn over each other.

A line each rather than a block each is what measurement chose: labels share a
corridor side by side as well as one above another, and reserving a whole block
each spread the drawing enough to bring the next pair together.

| model | overlapping label pairs | of the label area | size |
|---|---|---|---|
| gufo | 21 → **6** | 2.4% → **0.18%** | 1772x936 → 1911x1132 |
| boats | 14 → **6** | 1.4% → **0.6%** | unchanged |
| pets | 1 → 1 | 1.2% | unchanged |
| university, showcase, parties | 0 → 0 | 0% | unchanged |

More pairs than the ink would suggest, and that is the shape of the answer: what
is left are slivers where whole labels used to be struck through each other.
gUFO pays a fifth of its height for it; nothing else changes size at all, and
`boats` draws two fewer lines behind unrelated classes into the bargain.

**Two other ways of making room, measured and dropped.** Widening a gap by the
*lines* that pass through it -- eight to twenty pixels a line -- bought gUFO one
collision for a fifth of its width and cost `university` its clean sheet.
Raising `nodeSpacing` itself, which is the obvious answer to a crowded drawing,
makes it worse: at 80 gUFO goes from 7 overlapping pairs to 8 and `showcase`
from none to two, at 100 gUFO reaches 13. Longer lines do not carry more text;
they carry the same text past more of everything else. Room has to be made where
the text is, which is why both rules that survived are about what is written
rather than about how much space there is.

**What did not work.** ELK can be handed the labels themselves -- an edge label
with a width and a height, which its layered algorithm reserves space for with
label dummy nodes -- and that is the textbook answer. Measured here it helped
`boats` (14 overlapping pairs to 10) and made gUFO worse (21 to 26), whichever
of `MEDIAN_LAYER`, `SPACE_EFFICIENT_LAYER` and `WIDEST_LAYER` placed the centre
labels. The reason is that it reserves room between ranks only, while gUFO's
collisions are as often between an end decoration and the centre label of the
line beside it; and for a straight drawing ELK's own edge routing, which is what
the rest of its label handling serves, is thrown away here anyway. Deepening the
corridor is the same idea applied where this repository already decides the
geometry.

## How much room a drawing needs

The two rules above make room where a label has to go. They do not answer the
prior question: how much room the drawing starts with. The default was 60
between neighbours and 100 between ranks, and on gUFO's
`Endurant`/`Situation`/`Event` neighbourhood -- eight labelled associations
meeting three classes -- that is not enough to tell one association's labels
from the next's, whatever the arrangement does with them.

Six things were tried against it, and only the last one works:

| tried | result |
|---|---|
| handing ELK the edge labels, so its layered algorithm reserves space | `boats` better, gUFO worse, under every centre-label strategy |
| `elk.spacing.edgeEdge` and `elk.spacing.edgeNode` | nothing: a straight drawing discards ELK's routes |
| widening a gap by the lines passing through it | one collision for a fifth of gUFO's width, and `university` worse |
| `elk.margins` per class, sized by the associations meeting it | inert: the JSON API ignores node margins in elkjs 0.12 |
| making the label placer cheaper to move, and its reach longer | nothing: the candidates, not the cost, are the limit |
| **more room between the classes** | the neighbourhood reads |

The measurements are worth reading carefully, because they say something that
looks like a contradiction: counting label collisions, more spacing changes
almost nothing -- gUFO sits at about half its labels touching another or having
a line through them at 60, at 100 and at 140. Counting is not reading. What
changes is that at 60 the eight stereotypes of that neighbourhood are one grey
mass and at 100 each sits on its own line, which no collision count expresses:
the labels were never *overlapping*, they were merely indistinguishable.

So the default is now 100 and 140, and -- since how much room a model needs is a
property of the model -- the panel offers the three spacings the preview this
replaces offered: tight (60/100, what it was), comfortable (100/140, the
default) and roomy (150/200). A taxonomy of bare classes reads at the tight one;
a neighbourhood where a dozen associations meet two classes may want the roomy
one, and no arrangement can make text fit where it will not fit.

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
