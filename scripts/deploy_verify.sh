#!/usr/bin/env bash
# Post-deploy check (run on the droplet by the "verify" job in deploy.yml):
#   bash deploy_verify.sh "<run title>" app-main app-wl ...
# For each app: is the live release the newest commit of its branch, and is the live slot healthy?
# If not → one more deploy.sh, re-check. Then one Telegram message to the admin with the result per bot.
set -uo pipefail
ROOT=/opt/nomadly
TITLE="${1:-Deploy}"; shift || true
declare -A NAME=([app-main]="Nomadly bot + CloudIVR web" [app-wl]="Smadav bot" [app-voodoo]="Voodoo Land bot" [app-proshop]="ProShop bot")

IGNORE='^(memory/|\.emergent/|test_reports/|investigations/|\.github/|\.whitelabel-sync$|scripts/sync_whitelabel\.py$|scripts/test_sync_whitelabel\.sh$)|\.md$'
# Files between the live release and the branch head that a deploy would actually ship (same paths-ignore as deploy.yml).
runtime_diff() { git --git-dir="$ROOT/repo/$1.git" diff --name-only "$2" "$3" 2>/dev/null | grep -vE "$IGNORE"; }

check() {  # → "ok <sha>" | "behind <live> <want>" | "unhealthy <sha>"
  local app="$1" branch want live port code
  branch="$(cat "$ROOT/shared/$app/branch" 2>/dev/null || echo main)"
  git --git-dir="$ROOT/repo/$app.git" fetch -q --force origin "+refs/heads/$branch:refs/heads/$branch" 2>/dev/null
  want="$(git --git-dir="$ROOT/repo/$app.git" rev-parse --short=7 "refs/heads/$branch" 2>/dev/null)"
  live="$(readlink -f "$ROOT/current/$app" | sed -E 's/.*-([0-9a-f]{7,})$/\1/')"
  port="$(sed -nE "s/^upstream ${app//-/_} \{ server 127\.0\.0\.1:([0-9]+); \}.*/\1/p" /etc/nginx/conf.d/nomadly-upstreams.conf | head -1)"
  code="$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:$port/health")"
  if [ "${live:0:7}" != "${want:0:7}" ] && [ -n "$(runtime_diff "$app" "$live" "$want")" ]; then echo "behind ${live:0:7} ${want:0:7}"
  elif [ "$code" != "200" ]; then echo "unhealthy ${live:0:7}"
  else echo "ok ${live:0:7}"; fi
}

lines=(); bad=0
for app in "$@"; do
  r="$(check "$app")"
  if [ "${r%% *}" != "ok" ]; then
    echo "[verify] $app: $r — retrying deploy once"
    bash "$ROOT/deploy.sh" "$app" >"/tmp/verify-retry-$app.log" 2>&1
    r2="$(check "$app")"
    if [ "${r2%% *}" = "ok" ]; then line="✅ ${NAME[$app]:-$app} — updated on retry (${r2#ok })"
    else bad=1; line="❌ ${NAME[$app]:-$app} — $( [ "${r2%% *}" = behind ] && echo "still on old code (live ${r2#behind }, wanted newer)" || echo "not healthy after retry" ) — needs a look"; fi
  else line="✅ ${NAME[$app]:-$app} — up to date (${r#ok })"; fi
  echo "[verify] $line"; lines+=("$line")
done

ENV="$ROOT/shared/app-main/backend.env"
TOKEN="$(grep -E '^TELEGRAM_BOT_TOKEN_PROD=' "$ENV" | cut -d= -f2- | tr -d '"')"
CHAT="$(grep -E '^TELEGRAM_ADMIN_CHAT_ID=' "$ENV" | cut -d= -f2- | tr -d '"')"
head="🚢 <b>$TITLE</b> — $( [ $bad = 0 ] && echo 'all bots healthy' || echo 'ACTION NEEDED' )"
msg="$(printf '%s\n' "$head" "${lines[@]}")"
[ -z "${NO_TELEGRAM:-}" ] && [ -n "$TOKEN" ] && [ -n "$CHAT" ] && curl -s -m 20 "https://api.telegram.org/bot$TOKEN/sendMessage" \
  --data-urlencode "chat_id=$CHAT" --data-urlencode "text=$msg" -d parse_mode=HTML >/dev/null && echo "[verify] Telegram sent"
exit $bad
