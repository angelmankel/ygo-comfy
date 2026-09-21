#!/usr/bin/env bash
# Push ~/Github/ygo-comfy/app to a running pod through its own file API (/ygo/app/api/files).
# The app lives on the volume at /workspace/ygo-app and live.py hot-reloads it, so no image rebuild.
#
#   scratchpad/push.sh 1.2.3.4:10695
#
# Auth comes from ygo-art-studio/.env (COMFY_LOCAL_USER / COMFY_LOCAL_TOKEN).
set -euo pipefail

HOSTPORT="${1:?usage: push.sh <ip:port>}"
BASE="http://${HOSTPORT}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENVFILE="${YGO_ENV:-$HOME/Github/ygo-art-studio/.env}"

set -a; . "$ENVFILE"; set +a
AUTH="${COMFY_LOCAL_USER}:${COMFY_LOCAL_TOKEN}"

ok=0; fail=0
while IFS= read -r -d '' f; do
  rel="${f#"$ROOT"/app/}"
  code=$(curl -sS -o /dev/null -w '%{http_code}' -u "$AUTH" -X PUT \
    --data-binary "@$f" "${BASE}/ygo/app/api/files?path=$(printf %s "$rel" | jq -sRr @uri)")
  if [ "$code" = "200" ]; then
    ok=$((ok+1)); printf '  ok   %s\n' "$rel"
  else
    fail=$((fail+1)); printf '  FAIL %s (HTTP %s)\n' "$rel" "$code"
  fi
done < <(find "$ROOT/app" -type f -not -path '*/__pycache__/*' -print0)

echo "pushed $ok file(s), $fail failure(s) -> ${BASE}/ygo/app/lab/"
[ "$fail" -eq 0 ]
