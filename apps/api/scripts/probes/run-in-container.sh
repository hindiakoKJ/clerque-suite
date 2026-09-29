#!/usr/bin/env bash
# Run a Node script inside the live API container on Railway, uploading it and
# any files it needs first. Usage:
#   run-in-container.sh <script.js> [file ...]
# Files land in /tmp under their own basename; the script is run with
# NODE_PATH pointing at the app's node_modules. Needs the Railway CLI signed in
# (or RAILWAY_TOKEN in the environment). See README.md for the transport limits.
set -euo pipefail
export MSYS_NO_PATHCONV=1
SERVICE="${RAILWAY_SERVICE:-clerque-suite}"

upload() {
  local local_file="$1" remote="$2" b64 total chunk off first part op
  b64=$(base64 -w0 "$local_file")
  total=${#b64}; chunk=16000; off=0; first=1
  while [ "$off" -lt "$total" ]; do
    part=${b64:$off:$chunk}
    if [ "$first" -eq 1 ]; then op=">"; first=0; else op=">>"; fi
    railway ssh --service "$SERVICE" -- "echo $part $op $remote.b64" >/dev/null
    off=$((off + chunk))
  done
  railway ssh --service "$SERVICE" -- "base64 -d $remote.b64 > $remote && rm $remote.b64 && wc -c $remote" | tail -1
}

script="$1"; shift
for f in "$@"; do upload "$f" "/tmp/$(basename "$f")"; done
upload "$script" "/tmp/$(basename "$script")"
args=""
for f in "$@"; do args="$args /tmp/$(basename "$f")"; done
# SHOP and SINCE travel to the read-only probes when set here.
envs=""
[ -n "${SHOP:-}" ] && envs="$envs SHOP=$SHOP"
[ -n "${SINCE:-}" ] && envs="$envs SINCE=$SINCE"
railway ssh --service "$SERVICE" -- "$envs NODE_PATH=/app/node_modules:/app/apps/api/node_modules node /tmp/$(basename "$script")$args" 2>&1 | grep -v "take precedence"
