# Tools

`readability.py` measures two routing and label problems in a rendered SVG:

- **Superimposed lines** — pixels where two associations run close enough to
  look like one.
- **Misplaced decorators** — multiplicities closer to another association's
  line than to their own.

Run it over the examples after changing anything about routing or labels:

    for m in university pets.tonto boats.tonto gufo.tonto showcase.tonto; do
        node packages/cli/bin/tonto-view.js packages/canvas/test/fixtures/$m --svg > /tmp/$m.svg
    done
    python3 tools/readability.py /tmp/*.svg

Keep both measurements at or below their previous values, then inspect the
rendered diagrams. These measurements do not catch every readability problem.
