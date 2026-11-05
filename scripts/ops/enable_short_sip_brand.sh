#!/bin/bash
# Turn on short SIP logins for one brand on the droplet and restart its ACTIVE slot only when it has 0 live calls.
#   bash enable_short_sip_brand.sh <app-main|app-wl|app-voodoo|app-proshop>
set -u
B="$1"
F="/opt/nomadly/shared/$B/backend.env"
read SLOT PORT < <(pm2 jlist 2>/dev/null | python3 -c "
import sys,json
for p in json.load(sys.stdin):
  e=p['pm2_env']
  if p['name'].startswith('$B-') and e['status']=='online': print(p['name'], e.get('PORT') or e.get('env',{}).get('PORT',''))")
[ -n "$PORT" ] || PORT=$(grep -E '^PORT=' "$F" | cut -d= -f2 | tr -d '"')
case "$SLOT" in *-b) [ "$PORT" -lt 5100 ] && PORT=$((PORT+100));; esac
curl -sf "localhost:$PORT/health" >/dev/null || { echo "[$B] no healthy slot on :$PORT ($SLOT)"; exit 1; }
echo "[$B] active slot $SLOT on :$PORT"

if grep -q '^SIP_SHORT_LOGINS=true' "$F"; then echo "[$B] SIP_SHORT_LOGINS already on"; else
  cp -p "$F" "$F.bak.shortsip.$(date -u +%Y%m%dT%H%M%SZ)"
  sed -i '/^SIP_SHORT_LOGINS=/d' "$F"
  [ -n "$(tail -c1 "$F")" ] && echo >> "$F"
  echo 'SIP_SHORT_LOGINS=true' >> "$F"
  echo "[$B] SIP_SHORT_LOGINS=true added (backup kept)"
fi

for i in $(seq 1 60); do
  T=$(curl -s "localhost:$PORT/health" | python3 -c 'import sys,json;print(json.load(sys.stdin)["calls"]["total"])')
  [ "$T" = "0" ] && break
  echo "[$B] $T live call(s) — waiting"; sleep 5
done
[ "$T" = "0" ] || { echo "[$B] still busy — NOT restarting"; exit 1; }
pm2 restart "$SLOT" --update-env >/dev/null && echo "[$B] restarted $SLOT"
for i in $(seq 1 45); do curl -sf "localhost:$PORT/health" >/dev/null && break; sleep 2; done
sleep 4
echo "[$B] health: $(curl -s localhost:$PORT/health | head -c 120)"
pm2 logs "$SLOT" --nostream --lines 800 2>/dev/null | grep -E 'SipLogins|short SIP' | tail -2 | cut -c1-160
