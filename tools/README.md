# Tools

`readability.py` counts, from a rendered SVG, the two things that make a class
diagram hard to read and that no test catches:

- **superimposed lines** — how many pixels two associations run together closely
  enough to look like one. Two relations drawn as one line is the worst thing a
  class diagram can do: the reader counts one relationship where the model has
  two, and both sets of multiplicities land in the same place.
- **decorators nearer another line than their own** — a multiplicity is read
  against whichever line it sits closest to, and on a busy diagram that is
  regularly not the line it belongs to.

Run it over the examples after changing anything about routing or labels:

    for m in university pets.tonto boats.tonto gufo.tonto showcase.tonto; do
        node packages/cli/bin/tonto-view.js packages/canvas/test/fixtures/$m --svg > /tmp/$m.svg
    done
    python3 tools/readability.py /tmp/*.svg

Both numbers should stay at or below what they were. They are not tests: a
diagram can be worse in ways neither counts, and a number can be improved by
making the drawing worse in some other way. Look at the pictures too.
