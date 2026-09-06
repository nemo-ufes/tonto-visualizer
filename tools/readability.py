"""What makes a diagram hard to read, counted from the SVG it produced.

Three things the eye trips on, none of which a unit test can see:

- **superimposed lines**: how many pixels two lines run together closely enough
  to look like one. Two associations drawn as one line is the worst thing a
  class diagram can do -- the reader counts one relationship where the model has
  two, and both sets of multiplicities land in the same place.
- **misread labels**: a decorator sitting nearer somebody else's line than its
  own, so it is read against the wrong association.
- **lines behind a class**: a line that disappears under a box it has nothing to
  do with is read as ending there.

    tools/render.sh /tmp/svg && python3 tools/readability.py /tmp/svg/*.svg

Generalization trees are counted as one drawing: a tree's stem, bus and legs
touch each other by construction, and are read as one thing.
"""
import math, re, sys

def segments(d):
    points = [tuple(map(float, p)) for p in re.findall(r'[ML] ([-\d.]+) ([-\d.]+)', d)]
    return list(zip(points, points[1:]))

def parse(svg):
    edges = {}
    for m in re.finditer(r'data-edge="([^"]+)"><path d="([^"]+)"', svg):
        edges[m.group(1).replace('&gt;', '>').replace('&amp;', '&')] = segments(m.group(2))
    # the trees have no edge ids: their legs are lines too, and cross boxes too
    for i, m in enumerate(re.finditer(r'<g class="tv-edge tv-tree"[^>]*>(.*?)</g>', svg, re.S)):
        for j, p in enumerate(re.finditer(r'<path d="([^"]+)"', m.group(1))):
            edges['tree%d.%d' % (i, j)] = segments(p.group(1))
    nodes = [tuple(map(float, m.groups())) for m in re.finditer(
        r'data-node="[^"]*"><rect x="([-\d.]+)" y="([-\d.]+)" width="([\d.]+)" height="([\d.]+)"', svg)]
    labels = []
    for m in re.finditer(r'<text[^>]*data-for="([^"]+)"[^>]*x="([-\d.]+)" y="([-\d.]+)"[^>]*>([^<]*)</text>', svg):
        owner = m.group(1).replace('&gt;', '>').replace('&amp;', '&')
        text = m.group(4)
        labels.append((owner, float(m.group(2)), float(m.group(3)), max(len(text), 1)))
    for m in re.finditer(r'class="tv-lock" data-for="([^"]+)" transform="translate\(([-\d.]+), ([-\d.]+)\)', svg):
        labels.append((m.group(1).replace('&gt;', '>').replace('&amp;', '&'), float(m.group(2)) + 6, float(m.group(3)) + 6, 2))
    return edges, nodes, labels

def point_segment_distance(p, seg):
    (x1, y1), (x2, y2) = seg
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(p[0] - x1, p[1] - y1)
    t = max(0, min(1, ((p[0] - x1) * dx + (p[1] - y1) * dy) / (dx * dx + dy * dy)))
    return math.hypot(p[0] - (x1 + t * dx), p[1] - (y1 + t * dy))

def distance_to(paths, p):
    return min((point_segment_distance(p, s) for segs in paths for s in segs), default=1e9)

def angle(seg):
    (x1, y1), (x2, y2) = seg
    return math.atan2(y2 - y1, x2 - x1) % math.pi

def superimposed(a, b, tolerance=6.0, degrees=10):
    """Length over which two segments run together close enough to look like one."""
    if abs(angle(a) - angle(b)) > math.radians(degrees) and \
       abs(abs(angle(a) - angle(b)) - math.pi) > math.radians(degrees):
        return 0.0
    (x1, y1), (x2, y2) = a
    length = math.hypot(x2 - x1, y2 - y1)
    if length == 0:
        return 0.0
    steps = max(int(length / 4), 1)
    close = sum(1 for i in range(steps + 1)
                if point_segment_distance((x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps), b) < tolerance)
    return length * close / (steps + 1)

def report(name, svg):
    edges, nodes, labels = parse(svg)
    def family(key):
        # A tree's stem, bus and legs are one drawing: a leg that continues the
        # stem is the tree, not two lines pretending to be one.
        return key.split('.')[0] if key.startswith('tree') else key

    overlap = 0.0
    ids = list(edges)
    for i, one in enumerate(ids):
        for other in ids[i + 1:]:
            if family(one) == family(other):
                continue
            for sa in edges[one]:
                for sb in edges[other]:
                    overlap += superimposed(sa, sb)

    misread = 0
    for owner, x, y, chars in labels:
        own = edges.get(owner)
        if not own:
            continue
        mine = distance_to([own], (x, y))
        theirs = min((distance_to([segs], (x, y)) for key, segs in edges.items() if key != owner), default=1e9)
        if theirs < mine - 1:
            misread += 1

    behind = 0
    for key, segs in edges.items():
        ends = [segs[0][0], segs[-1][1]]
        for rect in nodes:
            if any(rect[0] - 3 <= p[0] <= rect[0] + rect[2] + 3 and rect[1] - 3 <= p[1] <= rect[1] + rect[3] + 3
                   for p in ends):
                continue
            crossing = False
            for a, b in segs:
                steps = max(int(math.hypot(b[0] - a[0], b[1] - a[1]) / 3), 1)
                for i in range(steps + 1):
                    x, y = a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps
                    if rect[0] + 2 < x < rect[0] + rect[2] - 2 and rect[1] + 2 < y < rect[1] + rect[3] - 2:
                        crossing = True
                        break
                if crossing:
                    break
            if crossing:
                behind += 1
                break

    print(f'{name:22} superimposed {overlap:6.0f}px  misread labels {misread:3}/{len(labels):3}'
          f'  lines behind a class {behind:3}/{len(edges):3}')

for path in sys.argv[1:]:
    report(path.split('/')[-1], open(path).read())
