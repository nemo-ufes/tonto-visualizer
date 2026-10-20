"""Approximate route and label readability metrics from a rendered SVG.

These measurements support comparisons; they are not a complete diagram-quality
score. In particular, semantic grouping and whitespace still need visual review.
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
    view_box = re.search(r'<svg[^>]*viewBox="([\-\d.]+) ([\-\d.]+) ([\d.]+) ([\d.]+)"', svg)
    bounds = tuple(map(float, view_box.groups())) if view_box else None
    return edges, nodes, labels, bounds

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

def directed_overlap(a, b, tolerance=6.0, degrees=10):
    """Estimate how much of a lies close to a similarly angled segment b."""
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

def superimposed(a, b, tolerance=6.0, degrees=10):
    """Symmetric estimate of how much two segments visually merge."""
    return (directed_overlap(a, b, tolerance, degrees)
            + directed_overlap(b, a, tolerance, degrees)) / 2

def report(name, svg):
    edges, nodes, labels, bounds = parse(svg)
    overlap = 0.0
    ids = list(edges)
    for i, one in enumerate(ids):
        for other in ids[i + 1:]:
            for sa in edges[one]:
                for sb in edges[other]:
                    overlap += superimposed(sa, sb)
    line_length = sum(math.hypot(b[0] - a[0], b[1] - a[1])
                      for segments_for_edge in edges.values()
                      for a, b in segments_for_edge)
    overlap_rate = overlap / max(line_length, 1)
    node_area = sum(width * height for _, _, width, height in nodes)
    drawing_area = bounds[2] * bounds[3] if bounds else 0
    node_coverage = node_area / drawing_area if drawing_area else 0

    misread = 0
    for owner, x, y, chars in labels:
        own = edges.get(owner)
        if not own:
            continue
        mine = distance_to([own], (x, y))
        theirs = min((distance_to([segs], (x, y)) for key, segs in edges.items() if key != owner), default=1e9)
        if theirs < mine - 1:
            misread += 1

    print(f'{name:30} node coverage {node_coverage:5.1%}   overlap {overlap:6.0f}px ({overlap_rate:5.1%})'
          f'   labels nearer another line {misread:3}/{len(labels):3}')

for path in sys.argv[1:]:
    report(path.split('/')[-1], open(path).read())
