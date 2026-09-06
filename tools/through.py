"""How near a relator's centre each of its mediations passes, in a rendered SVG.

A relator is a reified relationship, and it is read through -- from one relatum
to the other, crossing the relator on the way -- only when the lines that meet
it are aimed at it: extended, each mediation should run through the middle of
the box rather than off to one side of it. Anchored on an even share of the
border, both mediations met the middle of a side, one arriving from the left and
the other leaving to the right, which reads as two lines meeting at a box.

    tools/render.sh /tmp/svg && python3 tools/through.py /tmp/svg/*.svg

Two kinds of end are left out of the reading on purpose and still counted here,
so the number does not go to zero: a relator that mediates one class twice, and
a mediation with a class in the way. See `mediationsThrough` in
`packages/canvas/src/render.ts`.
"""
import math, os, re, sys

for path in sys.argv[1:]:
    s = open(path).read()
    nodes, relators = {}, set()
    for m in re.finditer(r'data-node="([^"]+)"', s):
        block = s[m.start():m.start() + 700]
        r = re.search(r'<rect[^>]*x="([-\d.]+)"[^>]*y="([-\d.]+)"[^>]*width="([-\d.]+)"[^>]*height="([-\d.]+)"', block)
        if not r:
            continue
        x, y, w, h = (float(g) for g in r.groups())
        nodes[m.group(1)] = (x + w / 2, y + h / 2)
        if '&#171;relator&#187;' in block or '« relator' in block or '«relator»' in block:
            relators.add(m.group(1))
    misses = []
    for m in re.finditer(r'data-edge="([^"]*)"[^>]*>\s*<path[^>]*d="([^"]*)"', s):
        key = m.group(1).replace('&gt;', '>')
        if ':mediation' not in key:
            continue
        mm = re.match(r'rel:([^>]+)->([^:]+):', key)
        pts = [(float(x), float(y)) for x, y in re.findall(r'[ML] ([-\d.]+) ([-\d.]+)', m.group(2))]
        if not mm or len(pts) < 2:
            continue
        for node, at, away in ((mm.group(1), pts[0], pts[1]), (mm.group(2), pts[-1], pts[-2])):
            if node not in relators:
                continue
            cx, cy = nodes[node]
            dx, dy = away[0] - at[0], away[1] - at[1]
            length = math.hypot(dx, dy) or 1
            misses.append(abs(dx * (cy - at[1]) - dy * (cx - at[0])) / length)
    if misses:
        print(f'{os.path.basename(path):22} mediations at a relator {len(misses):2}  '
              f'miss its centre by {sum(misses)/len(misses):5.1f}px on average, worst {max(misses):5.1f}px')
    else:
        print(f'{os.path.basename(path):22} no mediation at a relator')
