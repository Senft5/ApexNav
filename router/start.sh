#!/usr/bin/env bash
# The container's entrypoint (router/Dockerfile): fetch the tile tar named by valhalla/v1/index.json, check it, serve it.
# Its parts come from $TILES_URL (the Worker's ValhallaTiles handler, reading R2; the container has no other way out).
# valhalla_service answers on 8002 only once the tiles are whole, so until then the Worker sees "starting" and the phone
# asks the public server.
set -euo pipefail
base="${TILES_URL:-http://tiles.vetta}"
dir=/data
cd "$dir"
log() { echo "vetta-router: $*"; }
get() { curl -fsS --retry 6 --retry-delay 2 --retry-all-errors --max-time 600 "$@"; }
get -o index.json "$base/valhalla/v1/index.json"
read -r build parts bytes sha < <(python3 -c 'import json,sys; i=json.load(open(sys.argv[1])); print(i["build"], i["parts"], i["bytes"], i["sha256"])' index.json)
case "$build" in *[!A-Za-z0-9_.:-]*|"") log "bad build name"; exit 2;; esac
log "build $build: $parts parts, $bytes bytes"
rm -f tiles.tar
t0=$(date +%s)
for ((i = 0; i < parts; i++)); do
  get "$base/valhalla/v1/b/$build/part-$(printf %03d "$i")" >> tiles.tar
done
have=$(stat -c %s tiles.tar)
[ "$have" = "$bytes" ] || { log "size $have, want $bytes"; exit 3; }
echo "$sha  tiles.tar" | sha256sum -c --status - || { log "sha256 mismatch"; exit 4; }
log "tiles whole in $(( $(date +%s) - t0 )) s"
# the tar alone (no tile directory, no traffic, no elevation): what the public server answers, from our tiles
valhalla_build_config --mjolnir-tile-extract "$dir/tiles.tar" --mjolnir-tile-dir "$dir/none" \
  --mjolnir-traffic-extract "" --additional-data-elevation "" --mjolnir-admin "" --mjolnir-timezone "" \
  --httpd-service-listen "tcp://*:8002" --loki-actions locate,route,sources_to_targets,optimized_route,trace_route,trace_attributes,status \
  > valhalla.json
exec valhalla_service valhalla.json "${THREADS:-2}"
