#!/bin/sh
# Installs, builds, lints and tests every generated project (from
# verify-templates.mjs) in a clean container (node:22, or the case's own
# image, e.g. python). Usage: scripts/verify-templates.sh OUT
set -u
OUT="$1"
IMAGE="${NODE_IMAGE:-node:22}"
fails=0
for id in $(node -e 'for (const c of JSON.parse(require("fs").readFileSync(process.argv[1]))) console.log(c.id)' "$OUT/cases.json"); do
  cmds=$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1])).find(c=>c.id===process.argv[2]); console.log(c.run.map(r => r === "SERVE" ? "(node dist/index.js & pid=$!; sleep 2; curl -fsS localhost:3000/health; ok=$?; echo; kill $pid; exit $ok)" : r).join(" && "))' "$OUT/cases.json" "$id")
  printf '%-24s ' "$id"
  image=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1])).find(c=>c.id===process.argv[2]).image || "")' "$OUT/cases.json" "$id")
  # Copied in (not mounted), so OUT can be any folder
  cid=$(docker create -w /app "${image:-$IMAGE}" sh -c "$cmds")
  docker cp "$OUT/$id/." "$cid:/app" > /dev/null
  if docker start -a "$cid" > "$OUT/$id.log" 2>&1; then
    echo "ok"
  else
    echo "FAILED (see $OUT/$id.log)"; fails=$((fails + 1))
  fi
  docker rm "$cid" > /dev/null
done
exit $fails
