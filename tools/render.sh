#!/bin/sh
# Render every example, and this repository's own fixtures, to SVG.
#
#     tools/render.sh out/       # then: python3 tools/readability.py out/*.svg
#
# The metrics all read rendered SVG, so this is the first step of every one of
# them. Build first: the CLI runs the compiled packages, not the sources.
set -eu
out=${1:-/tmp/tonto-view}
mkdir -p "$out"
root=$(cd "$(dirname "$0")/.." && pwd)
for model in "$root"/vendor/tontoredesign/examples/*/ "$root"/vendor/tontoredesign/examples/*.tonto "$root"/tools/models/*.tonto; do
    name=$(basename "$model" .tonto)
    case $name in error) continue ;; esac  # deliberately unparseable
    node "$root/packages/cli/bin/tonto-view.js" "$model" --svg > "$out/$name.svg"
done
ls "$out"/*.svg
