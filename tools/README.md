# Tools

None of these are tests. They are the measurements a change to layout, routing
or labelling is argued with — numbers that a diff cannot show and a unit test
cannot see. Run them before and after, quote both, and look at the picture too:
every one of them can be improved by making the drawing worse somewhere it does
not count.

Build first. They all run the compiled packages, not the sources.

    npm run build
    tools/render.sh /tmp/svg

| | |
|---|---|
| `render.sh <dir>` | draws every example, plus `models/`, to SVG. The first step of everything below. |
| `readability.py <svg…>` | superimposed lines, labels nearer another line than their own, and lines passing behind a class. |
| `through.py <svg…>` | how near each mediation passes the centre of the relator it meets — whether a relator is read *through*. |
| `relators.mjs` | runs the layout rather than reading an SVG: how many relators are placed between the classes they mediate. |
| `shot.mjs <in.svg> <out.png> [x y w h]` | a picture to look at, whole or cropped. Needs Playwright; see the file. |
| `panel.mjs <model> [outdir]` | the webview itself, driven in a browser: posts it a model, drags a class, opens the options panel, and reports what it said to the host and any console error. The only way to exercise dragging and the panel chrome without VS Code. |
| `models/` | fixtures for the measurements, in Tonto. `relators.tonto` is four relators covering the cases that make placement hard. |

Where they stood when last measured, over the examples and the fixture
(`classonly` is left out here; it is clean on all three):

    boats        superimposed  347px  misread labels  36/159  lines behind a class  0/79
    gufo         superimposed  750px  misread labels  29/130  lines behind a class  0/111
    pets         superimposed    0px  misread labels   0/ 20  lines behind a class  0/26
    showcase     superimposed    0px  misread labels   6/ 26  lines behind a class  0/16
    university   superimposed    0px  misread labels   4/ 37  lines behind a class  0/23
    relators     superimposed    0px  misread labels   2/ 27  lines behind a class  0/16

    relators between what they mediate: 8 of 8
    mediations missing a relator's centre: 0.3px on the fixture, 8.0px worst (boats)

`boats` and `gufo` are the hard ones, and where the next improvement is: gufo
alone draws 111 lines and 130 labels, and holds two thirds of every superimposed
pixel left.
