#!/usr/bin/env bash
# Mirror the graph-data branch's map data into our R2 bucket through the Worker (backend/src/data_store.ts), for
# .github/workflows/data-mirror.yml. Auth is the run's GitHub OIDC token (audience vetta-data, `id-token: write`), asked
# for again every BATCH files so it never expires mid-run. Graph tiles go up under their build first; the index last, so the
# Worker switches to the new build only when all its tiles are there. Unchanged files are skipped by the Worker (same sha).
#   tools/graph_etl/upload_r2.sh DATA_DIR [BASE_URL]   (DATA_DIR = a checkout of graph-data: v1/, ctx/v1/, cameras/v1/; or osm-ctx.yml's osm/v1/)
set -euo pipefail
dir=$(cd "$1" && pwd); base="${2:-https://apexnav.senftns.workers.dev}"
BATCH=150; PAR=8
tok() { curl -fsS -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=vetta-data" | python3 -c 'import json,sys;print(json.load(sys.stdin)["value"])'; }
# one file: "<local path> <key>"; prints "<status> <key>"; up to 3 tries (a 5xx or a dropped connection)
export base
send() {
  local f="$1" k="$2" s
  for i in 1 2 3; do
    s=$(curl -sS -o /dev/null -w '%{http_code}' -X PUT --data-binary "@$f" -H "authorization: Bearer $TOKEN" \
      -H "origin: $base" -H "x-apexnav: 1" -H "content-type: application/octet-stream" "$base/api/ops/data?key=$k" || echo 000)
    case "$s" in 2??) echo "$s $k"; return 0;; 4??) echo "$s $k"; return 1;; esac
    sleep $((i * 3))
  done
  echo "$s $k"; return 1
}
export -f send
upload() {   # stdin: lines "<path> <key>"
  local list; list=$(mktemp); cat > "$list"
  local n; n=$(wc -l < "$list"); [ "$n" -gt 0 ] || return 0
  split -l "$BATCH" "$list" "$list.part."
  local bad=0
  for part in "$list".part.*; do
    TOKEN=$(tok); export TOKEN
    xargs -P "$PAR" -L 1 bash -c 'send "$0" "$1"' < "$part" > "$part.out" || bad=1
    grep -v '^2' "$part.out" | head -5 || true
  done
  echo "  $(cat "$list".part.*.out | grep -c '^2') of $n sent"
  return $bad
}
fail=0
# The lower 48 (graph-us.yml, builds named us-*) is a superset of the OH/KY/IN region: once it is live, the region's weekly
# mirror leaves the graph alone instead of shrinking it back to three states.
live=$(curl -fsS "$base/api/graph/v1/index.json" 2>/dev/null | python3 -c 'import json,sys;print(json.load(sys.stdin).get("build") or "")' 2>/dev/null || true)
if [ -f "$dir/v1/index.json" ]; then
  build=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["build"])' "$dir/v1/index.json")
fi
if [ -f "$dir/v1/index.json" ] && [ "${live#us-}" != "$live" ] && [ "${build#us-}" = "$build" ]; then
  echo "graph: the lower 48 ($live) is live; the region build $build is not mirrored over it"
elif [ -f "$dir/v1/index.json" ]; then
  echo "graph build $build:"
  ( cd "$dir/v1" && ls *.vgr 2>/dev/null | sed "s|.*|$dir/v1/& graph/v1/b/$build/&|" ) | upload || fail=1
  if [ "$fail" = 0 ]; then echo "$dir/v1/index.json graph/v1/index.json" | upload || fail=1; fi
fi
if [ -d "$dir/ctx/v1" ]; then
  echo "context grid:"
  ( cd "$dir/ctx/v1" && find 8 -name '*.vcg' 2>/dev/null | sed "s|.*|$dir/ctx/v1/& ctx/v1/&|" ) | upload || fail=1
  [ -f "$dir/ctx/v1/index.json" ] && { echo "$dir/ctx/v1/index.json ctx/v1/index.json" | upload || fail=1; }
fi
if [ -d "$dir/osm/v1" ]; then   # the OSM route context bundles (.github/workflows/osm-ctx.yml), the index last
  echo "osm route context:"
  ( cd "$dir/osm/v1" && ls *.txt.gz 2>/dev/null | sed "s|.*|$dir/osm/v1/& osm/v1/&|" ) | upload || fail=1
  [ -f "$dir/osm/v1/index.json" ] && { echo "$dir/osm/v1/index.json osm/v1/index.json" | upload || fail=1; }
fi
if [ -f "$dir/cameras/v1/region.json" ]; then
  echo "cameras:"
  echo "$dir/cameras/v1/region.json cameras/v1/region.json" | upload || fail=1
fi
exit $fail
