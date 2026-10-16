#!/bin/bash
# Stage TTS hardening + WHM_LICENSE_LIMIT on the 3 live releases (no reload). Run on droplet.
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
SRC=/root/ttshard
declare -A REL=(
  [app-main]=/opt/nomadly/releases/app-main/20261015T154823Z-32532c1
  [app-wl]=/opt/nomadly/releases/app-wl/20261015T154852Z-c89b4d7
  [app-voodoo]=/opt/nomadly/releases/app-voodoo/20261015T154919Z-c89b4d7
)
FILES="tts-service.js balance-monitor.js _index.js lang/en.js lang/fr.js lang/hi.js lang/zh.js"
for app in app-main app-wl app-voodoo; do
  R=${REL[$app]}; echo "=== $app ($R)"
  cd $R/js
  for f in $FILES; do cp -p "$f" "$f.bak.ttshard.$TS"; done
  # identical bases verified by md5 before copy → straight copy; _index.js differs per brand → targeted patch
  cp $SRC/tts-service.js $SRC/balance-monitor.js ./
  cp $SRC/lang/en.js $SRC/lang/fr.js $SRC/lang/hi.js $SRC/lang/zh.js lang/
  python3 $SRC/patch_tts_hardening.py $R/js
  for f in $FILES; do node --check "$f"; done
  mkdir -p tests && cp $SRC/test_tts_billing_fallback_2026-10.js tests/
  (cd $R && timeout 60 node js/tests/test_tts_billing_fallback_2026-10.js 2>&1 | tail -1)
  ENVF=/opt/nomadly/shared/$app/backend.env
  cp -p $ENVF $ENVF.bak.license.$TS
  python3 - "$ENVF" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p).read()
if re.search(r'^WHM_LICENSE_LIMIT=', s, re.M):
    s = re.sub(r'^WHM_LICENSE_LIMIT=.*$', 'WHM_LICENSE_LIMIT=100', s, flags=re.M)
else:
    s = s + ('' if s.endswith('\n') else '\n') + 'WHM_LICENSE_LIMIT=100\n'
open(p, 'w').write(s)
PY
  grep -n "^WHM_LICENSE_LIMIT" $ENVF
done
echo "STAGED $TS"
