#!/usr/bin/env bash
# Commit a built directory to the repository's graph-data branch under SUBDIR (v1 = the region's graph tiles,
# ctx/v1 = the region's context-grid bundles), replacing what was there. A normal push, never forced; if another
# publish got there first, start again from the new tip (up to 5 times). Used by graph-region.yml and ctx-region.yml.
#   tools/graph_etl/publish_data.sh SRC_DIR SUBDIR "commit message"   (GH_TOKEN, GITHUB_REPOSITORY set)
set -euo pipefail
src=$(cd "$1" && pwd); sub="$2"; msg="$3"
root=$(cd "$(dirname "$0")/../.." && pwd)
work=$(mktemp -d)
for attempt in 1 2 3 4 5; do
  rm -rf "$work/data" && mkdir "$work/data" && cd "$work/data"
  git init -q
  git config user.name "github-actions[bot]"
  git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  git remote add origin "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
  if git ls-remote --exit-code --heads origin graph-data >/dev/null; then
    git fetch -q --depth 1 origin graph-data
    git checkout -q -b graph-data FETCH_HEAD
  else
    git checkout -q --orphan graph-data
  fi
  rm -rf "$sub" && mkdir -p "$(dirname "$sub")" && cp -r "$src" "$sub"
  cp "$root/tools/graph_etl/graph_data_README.md" README.md
  if find . -path ./.git -prune -o -type f -size +49M -print | grep -q .; then echo "::error::a file over 49 MB"; exit 1; fi
  git add -A
  if git diff --cached --quiet; then echo "no change"; exit 0; fi
  git commit -q -m "$msg"
  if git push -q origin graph-data; then echo "pushed: $msg"; exit 0; fi
  echo "push refused (another publish first?): again from the new tip"; sleep $((attempt * 10))
done
exit 1
