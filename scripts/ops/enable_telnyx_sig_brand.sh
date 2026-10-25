#!/bin/bash
# Turn on Telnyx webhook signature checks for one brand on the droplet, safely, then prove it works.
#   bash enable_telnyx_sig_brand.sh <app-wl|app-voodoo|app-proshop>
# Copies TELNYX_PUBLIC_KEY from app-main (same Telnyx account), restarts the ACTIVE slot only when it has 0 live calls,
# checks a forged webhook gets 403 and a real Telnyx-signed event (a 2-second test call leg) is accepted.
set -u
B="$1"
F="/opt/nomadly/shared/$B/backend.env"
M="/opt/nomadly/shared/app-main/backend.env"
# blue/green: the online slot of this brand and its port (a = PORT, b = PORT+100)
read SLOT PORT < <(pm2 jlist 2>/dev/null | python3 -c "
import sys,json
for p in json.load(sys.stdin):
  e=p['pm2_env']
  if p['name'].startswith('$B-') and e['status']=='online': print(p['name'], e.get('PORT') or e.get('env',{}).get('PORT',''))")
[ -n "$PORT" ] || PORT=$(grep -E '^PORT=' "$F" | cut -d= -f2 | tr -d '"')
case "$SLOT" in *-b) [ "$PORT" -lt 5100 ] && PORT=$((PORT+100));; esac
curl -sf "localhost:$PORT/health" >/dev/null || { echo "[$B] no healthy slot on :$PORT ($SLOT)"; exit 1; }
echo "[$B] active slot $SLOT on :$PORT"

if ! grep -q '^TELNYX_PUBLIC_KEY=' "$F"; then
  cp -p "$F" "$F.bak.telnyxsig.$(date -u +%Y%m%dT%H%M%SZ)"
  [ -n "$(tail -c1 "$F")" ] && echo >> "$F"
  grep '^TELNYX_PUBLIC_KEY=' "$M" >> "$F"
  echo "[$B] key added (backup kept)"
fi

for i in $(seq 1 60); do
  T=$(curl -s "localhost:$PORT/health" | python3 -c 'import sys,json;print(json.load(sys.stdin)["calls"]["total"])')
  [ "$T" = "0" ] && break
  echo "[$B] $T live call(s) — waiting"; sleep 5
done
[ "$T" = "0" ] || { echo "[$B] still busy — NOT restarting"; exit 1; }
pm2 restart "$SLOT" --update-env >/dev/null && echo "[$B] restarted $SLOT"
for i in $(seq 1 40); do curl -sf "localhost:$PORT/health" >/dev/null && break; sleep 2; done
sleep 3
pm2 logs "$SLOT" --nostream --lines 400 2>/dev/null | grep TelnyxSig | tail -1 | cut -c1-140

echo "[$B] forged sms → $(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:$PORT/telnyx/sms-webhook -H 'Content-Type: application/json' -d '{"data":{"event_type":"message.received"}}')  forged voice → $(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:$PORT/telnyx/voice-webhook -H 'Content-Type: application/json' -d '{"data":{"event_type":"call.initiated"}}')"

KEY=$(grep -E '^TELNYX_API_KEY=' "$F" | cut -d= -f2- | tr -d '"')
APP=$(grep -E '^TELNYX_CALL_CONTROL_APP_ID=' "$F" | cut -d= -f2 | tr -d '"')
CC=$(curl -s -X POST https://api.telnyx.com/v2/calls -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"connection_id\":\"$APP\",\"to\":\"+19379800767\",\"from\":\"+19379800767\",\"timeout_secs\":10}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("data",{}).get("call_control_id",""))')
sleep 3
[ -n "$CC" ] && curl -s -o /dev/null -X POST "https://api.telnyx.com/v2/calls/$CC/actions/hangup" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d '{}'
sleep 6
SINCE=$(date -u -d '-25 seconds' +%Y-%m-%dT%H:%M:%S)
L=$(pm2 logs "$SLOT" --nostream --lines 600 2>/dev/null)
echo "[$B] test leg ${CC:0:12}… real events accepted: $(echo "$L" | grep -c "voice webhook received.*from=+19379800767") · refused since restart: $(echo "$L" | grep -c 'TelnyxSig\] refused')"
