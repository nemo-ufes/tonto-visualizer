"""What makes a diagram hard to read, counted from the SVG it produced.

Two things the eye trips on: lines that lie on top of each other, so two
associations look like one, and a decorator that sits nearer somebody else's
line than its own, so it is read against the wrong association.
"""
import math, re, sys

def segments(d):
    points = [tuple(map(float, p)) for p in re.findall(r'[ML] ([-\d.]+) ([-\d.]+)', d)]
    return list(zip(points, points[1:]))

def parse(svg):
    edges = {}
    for m in re.finditer(r'data-edge="([^"]+)"><path d="([^"]+)"', svg):
        edges[m.group(1).replace('&gt;', '>').replace('&amp;', '&')] = segments(m.group(2))
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
    overlap = 0.0
    ids = list(edges)
    for i, one in enumerate(ids):
        for other in ids[i + 1:]:
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

    print(f'{name:22} superimposed {overlap:7.0f}px   labels nearer another line {misread:3}/{len(labels):3}')

for path in sys.argv[1:]:
    report(path.split('/')[-1], open(path).read())
