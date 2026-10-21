#!/usr/bin/env bash
# Droplet blue/green deploy — invoked by GitHub Actions over SSH (or by hand).
# Canonical copy: scripts/droplet_deploy.sh (repo). Installed copy: /opt/nomadly/deploy.sh
# (self-updated from the app-main release after each deploy; applies on the NEXT run).
#
# Every deploy builds a fresh, immutable release ("image") and only switches traffic to it
# once it is running and healthy. If anything fails before the switch, the release that is
# currently serving traffic is never touched.
#
# Usage:
#   deploy.sh <app>                  build newest commit of the app's branch → start it on the
#                                    idle port → /health OK → switch nginx → stop the old slot
#   deploy.sh <app> rollback [dir]   re-activate the previous (or the given) release the same way
#   deploy.sh <app> status           active release / port / pm2 slots
#
# Layout (all under /opt/nomadly):
#   repo/<app>.git              bare mirror of the GitHub repo (fetch source)
#   shared/<app>/backend.env    the app's .env, linked into every release as backend/.env
#   shared/<app>/branch         git branch to deploy (default: main)
#   releases/<app>/<ts>-<sha>   immutable release trees (git archive); newest KEEP_RELEASES kept
#   current/<app>               symlink → the release serving traffic
#   /etc/nginx/conf.d/nomadly-upstreams.conf   "upstream <app_with_underscores> { server 127.0.0.1:<port>; }"
# PM2 slots: <app>-a on PORT (from backend.env) and <app>-b on PORT+100. All nginx blocks proxy to
# the upstream NAME, so switching = rewrite one line + `nginx -t` + graceful reload (no dropped
# HTTP requests). Both slots overlap for ~10 s around the switch.
set -uo pipefail
trap '' HUP

APP="${1:?usage: deploy.sh <app> [deploy|rollback [release-dir]|status]}"
CMD="${2:-deploy}"
ARG="${3:-}"
ROOT="/opt/nomadly"
REPO="$ROOT/repo/$APP.git"
SHARED="$ROOT/shared/$APP"
RELEASES="$ROOT/releases/$APP"
CURRENT="$ROOT/current/$APP"
LEGACY="$ROOT/$APP"                       # pre-blue/green in-place checkout (hardlink source once)
UPSTREAMS="/etc/nginx/conf.d/nomadly-upstreams.conf"
UP="${APP//-/_}"
SELF="$ROOT/deploy.sh"
LOG_DIR="$ROOT/logs"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-120}"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
P="[deploy $APP]"

[ -d "$REPO" ] && [ -f "$SHARED/backend.env" ] || {
  echo "$P ERROR: not set up. Need $REPO (bare mirror) and $SHARED/backend.env — see memory/DEPLOYMENT_STATE.md"; exit 1; }
mkdir -p "$RELEASES" "$ROOT/current" "$LOG_DIR"
exec > >(tee -a -p "$LOG_DIR/deploy-$APP.log") 2>&1
exec 9>"$ROOT/.deploy-$APP.lock"
flock -w 900 9 || { echo "$P ERROR: another deploy of $APP is still running"; exit 1; }
echo "$P ===== $(date -u +%FT%TZ) $CMD $ARG ====="

envval() { grep -E "^$1=" "$SHARED/backend.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
BASE_PORT="$(envval PORT)"; BASE_PORT="${BASE_PORT:-5000}"
ALT_PORT=$((BASE_PORT + 100))
BRANCH="$(cat "$SHARED/branch" 2>/dev/null || true)"; BRANCH="${BRANCH:-main}"
ENTRY="$(envval DEPLOY_ENTRY)"; ENTRY="${ENTRY:-js/start-bot.js}"
BOT_TOKEN="$(envval TELEGRAM_BOT_TOKEN_PROD)"; [ -n "$BOT_TOKEN" ] || BOT_TOKEN="$(envval TELEGRAM_BOT_TOKEN)"
ADMIN_CHAT="$(envval TELEGRAM_ADMIN_CHAT_ID)"

notify() {
  [ -n "$BOT_TOKEN" ] && [ -n "$ADMIN_CHAT" ] || { echo "$P (telegram notice skipped — no bot token / admin chat in backend.env)"; return 0; }
  curl -s -m 10 -o /dev/null -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
    --data-urlencode "chat_id=$ADMIN_CHAT" --data-urlencode "text=$1" || true
}
fail() { echo "$P ERROR: $1"; notify "❌ $APP deploy FAILED — $1"; exit 1; }
sha() { sha1sum "$1" 2>/dev/null | awk '{print $1}'; }
rel_field() { sed -n "s/^$2=//p" "$1/RELEASE" 2>/dev/null | head -1; }
active_port() { sed -nE "s/^upstream $UP \{ server 127\.0\.0\.1:([0-9]+); \}.*/\1/p" "$UPSTREAMS" 2>/dev/null | head -1; }
current_dir() { readlink -f "$CURRENT" 2>/dev/null || true; }
pm2_has() { pm2 describe "$1" >/dev/null 2>&1; }
pm2_state() {
  pm2 jlist 2>/dev/null | python3 -c '
import sys, json
name = sys.argv[1]
try:
    procs = [p for p in json.load(sys.stdin) if p.get("name") == name]
except Exception:
    procs = []
if not procs:
    print("missing 0"); sys.exit(0)
e = procs[0].get("pm2_env", {})
print(e.get("status", "unknown"), e.get("restart_time", 0))' "$1"
}
# wait_healthy <port> <pm2-name> <restart-baseline>: /health "healthy" + no extra pm2 restarts
wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) st="" rt="" body=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    read -r st rt < <(pm2_state "$2"); st="${st:-unknown}"; rt="${rt:-0}"
    if [ "$st" = "errored" ] || [ "$rt" -gt "$3" ]; then
      echo "$P health: pm2 status=$st restarts=$rt (baseline $3) → crash loop"; return 1
    fi
    body="$(curl -s -m 5 "http://127.0.0.1:$1/health" 2>/dev/null | tr -d '\n\r' | tr -s ' ' || true)"
    if [ "$st" = "online" ] && grep -Eq '"status": *"healthy"' <<<"$body"; then
      echo "$P health OK on :$1 — pm2 online, /health healthy"; return 0
    fi
    sleep 3
  done
  echo "$P health: TIMEOUT after ${HEALTH_TIMEOUT}s on :$1 — pm2 status=$st, /health: ${body:0:120}"; return 1
}
# drain_calls <old-port>: before flipping nginx, let the CURRENTLY-ACTIVE (old) slot finish its
# in-flight phone calls. nginx still points at it, so its /health "calls.total" drops to 0 as calls
# end. Capped at DRAIN_MAX_SECONDS (default 30 min); after that we flip anyway — persisted
# callSessions (Mongo, TTL-indexed) let the NEW slot keep serving any still-live call's webhooks.
DRAIN_MAX_SECONDS="${DRAIN_MAX_SECONDS:-1800}"
DRAIN_POLL_SECONDS="${DRAIN_POLL_SECONDS:-10}"
drain_calls() {
  local port="$1" deadline=$((SECONDS + DRAIN_MAX_SECONDS)) live
  [ -n "$port" ] || return 0
  echo "$P drain: waiting for old slot :$port to reach 0 live calls (cap $((DRAIN_MAX_SECONDS/60))m)…"
  while [ "$SECONDS" -lt "$deadline" ]; do
    live="$(curl -s -m 5 "http://127.0.0.1:$port/health" 2>/dev/null | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin); c = d.get("calls")
    print(int(c.get("total", 0)) if isinstance(c, dict) else 0)
except Exception:
    print(0)' 2>/dev/null || echo 0)"
    case "$live" in ''|*[!0-9]*) live=0 ;; esac
    if [ "$live" -le 0 ]; then echo "$P drain: 0 live calls on :$port — flipping now"; return 0; fi
    echo "$P drain: :$port still has $live live call(s) — waiting ${DRAIN_POLL_SECONDS}s…"
    sleep "$DRAIN_POLL_SECONDS"
  done
  echo "$P drain: ${DRAIN_MAX_SECONDS}s cap reached on :$port with calls still live — flipping anyway (persisted callSessions cover the new slot)"
  return 0
}
# set_upstream <port>: rewrite this app's upstream line, validate, graceful reload (restores on failure)
set_upstream() {
  local tmp out; tmp="$(mktemp)"
  { grep -vE "^upstream $UP \{" "$UPSTREAMS" 2>/dev/null; echo "upstream $UP { server 127.0.0.1:$1; }"; } > "$tmp"
  [ -f "$UPSTREAMS" ] && cp -a "$UPSTREAMS" "$UPSTREAMS.bak"
  install -m 644 "$tmp" "$UPSTREAMS"; rm -f "$tmp"
  if out="$(nginx -t 2>&1)" && systemctl reload nginx; then rm -f "$UPSTREAMS.bak"; return 0; fi
  echo "$out"; [ -f "$UPSTREAMS.bak" ] && mv -f "$UPSTREAMS.bak" "$UPSTREAMS"; return 1
}
prev_release_dir() {   # hardlink/reuse source: active release, else the legacy checkout
  local cur; cur="$(current_dir)"
  if [ -n "$cur" ] && [ -d "$cur/node_modules" ]; then echo "$cur"; return; fi
  [ -d "$LEGACY/node_modules" ] && echo "$LEGACY"
}
# REACT_APP_* lines of the app's backend.env are exported into its frontend build (process env beats
# frontend/.env.production), so brands sharing one branch each bake their own UI. fe_env = their signature.
fe_env_lines() { grep -E '^REACT_APP_[A-Z0-9_]+=' "$SHARED/backend.env" 2>/dev/null | sort; }
fe_env_sig() { local l; l="$(fe_env_lines)"; if [ -n "$l" ]; then printf '%s' "$l" | sha1sum | awk '{print $1}'; else echo none; fi; }
prev_fe_env() { local v; v="$(rel_field "$1" fe_env)"; echo "${v:-none}"; }
export_fe_env() {
  local line k v
  while IFS= read -r line; do
    k="${line%%=*}"; v="${line#*=}"; v="${v#[\"\']}"; v="${v%[\"\']}"
    export "$k=$v"
  done < <(fe_env_lines)
}
prev_fe_tree() {       # frontend tree sha of a previous release (RELEASE file) or legacy checkout (.git)
  if [ -f "$1/RELEASE" ]; then rel_field "$1" fe_tree
  elif [ -d "$1/.git" ]; then git -C "$1" rev-parse HEAD:frontend 2>/dev/null || echo none
  else echo unknown; fi
}
link_tree() { cp -al "$1" "$2" 2>/dev/null || { rm -rf "$2"; cp -a "$1" "$2"; }; }

# build_release <sha>: immutable tree in $REL (sets REL, FE_NOTE). Never touches the active release.
build_release() {
  local sha="$1" ts prev fe_tree fe_env
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  fe_env="$(fe_env_sig)"
  REL="$RELEASES/$ts-${sha:0:7}"
  FE_NOTE=""
  mkdir -p "$REL" || return 1
  git --git-dir="$REPO" archive "$sha" | tar -x -C "$REL" || { echo "$P ERROR: git archive $sha failed"; return 1; }
  fe_tree="$(git --git-dir="$REPO" rev-parse "$sha:frontend" 2>/dev/null || echo none)"
  printf 'sha=%s\nbranch=%s\nfe_tree=%s\nfe_env=%s\nbuilt_at=%s\n' "$sha" "$BRANCH" "$fe_tree" "$fe_env" "$ts" > "$REL/RELEASE"
  mkdir -p "$REL/backend" && ln -sfn "$SHARED/backend.env" "$REL/backend/.env"
  prev="$(prev_release_dir)"
  [ -n "$prev" ] && echo "$P reuse source: $prev"

  if [ -n "$prev" ] && [ "$(sha "$prev/package.json")" = "$(sha "$REL/package.json")" ]; then
    echo "$P root deps unchanged → hardlink node_modules"
    link_tree "$prev/node_modules" "$REL/node_modules" || return 1
  else
    echo "$P root deps changed (or first release) → npm install --omit=dev"
    ( cd "$REL" && npm install --omit=dev --no-audit --no-fund ) || { echo "$P ERROR: npm install failed"; return 1; }
  fi

  [ -f "$REL/frontend/package.json" ] || return 0
  if [ -n "$prev" ] && [ -d "$prev/frontend/node_modules" ] && [ "$(sha "$prev/frontend/package.json")" = "$(sha "$REL/frontend/package.json")" ]; then
    echo "$P frontend deps unchanged → hardlink frontend/node_modules"
    link_tree "$prev/frontend/node_modules" "$REL/frontend/node_modules" || return 1
  else
    echo "$P frontend deps changed (or first release) → npm install --legacy-peer-deps"
    ( cd "$REL/frontend" && npm install --legacy-peer-deps --no-audit --no-fund ) || echo "$P WARN: frontend npm install failed"
  fi
  if [ -n "$prev" ] && [ -f "$prev/frontend/build/index.html" ] && [ "$(prev_fe_tree "$prev")" = "$fe_tree" ] && [ "$(prev_fe_env "$prev")" = "$fe_env" ]; then
    echo "$P frontend unchanged → reuse previous build"
    cp -a "$prev/frontend/build" "$REL/frontend/build"
  else
    echo "$P frontend changed (or first release) → build"
    if ( cd "$REL/frontend" && export_fe_env && DISABLE_ESLINT_PLUGIN=true CI=false nice -n 10 npm run build ) && [ -f "$REL/frontend/build/index.html" ]; then
      echo "$P frontend build OK"
    elif [ -n "$prev" ] && [ -f "$prev/frontend/build/index.html" ]; then
      rm -rf "$REL/frontend/build"; cp -a "$prev/frontend/build" "$REL/frontend/build"
      echo "$P WARN: frontend build FAILED — previous build reused"
      FE_NOTE=" ⚠️ frontend build failed (previous build reused)"
    else
      echo "$P ERROR: frontend build failed and there is no previous build to reuse"; return 1
    fi
  fi
}

# activate_release <dir>: start on the idle slot, health-check, switch nginx, stop the old slot(s).
activate_release() {
  local rel="$1" active new_port new_name n base old=()
  active="$(active_port)"
  if [ -z "$active" ]; then new_port="$BASE_PORT"; new_name="$APP-a"
  elif [ "$active" = "$BASE_PORT" ]; then new_port="$ALT_PORT"; new_name="$APP-b"
  else new_port="$BASE_PORT"; new_name="$APP-a"; fi
  for n in "$APP" "$APP-a" "$APP-b"; do [ "$n" != "$new_name" ] && pm2_has "$n" && old+=("$n"); done
  pm2_has "$new_name" && { echo "$P removing stale slot $new_name"; pm2 delete "$new_name" >/dev/null 2>&1 || true; sleep 1; }
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$new_port$"; then
    echo "$P ERROR: port $new_port is busy (not ours) — cannot start the new slot"; return 1
  fi
  echo "$P starting $new_name on :$new_port ← $(basename "$rel")  (active: ${active:-none}, old slot(s): ${old[*]:-none})"
  ( cd "$rel" && PORT="$new_port" pm2 start "$ENTRY" --name "$new_name" --cwd "$rel" \
      --node-args="--max-old-space-size=2048" --time --merge-logs >/dev/null ) || { echo "$P ERROR: pm2 start failed"; return 1; }
  read -r _ base < <(pm2_state "$new_name"); base="${base:-0}"
  if ! wait_healthy "$new_port" "$new_name" "$base"; then
    echo "$P new release unhealthy → last log lines of $new_name:"
    pm2 logs "$new_name" --nostream --lines 30 2>/dev/null | tail -30
    pm2 delete "$new_name" >/dev/null 2>&1 || true
    echo "$P active release untouched (still serving on :${active:-?})"; return 1
  fi
  # Call-aware drain: hold the nginx flip until the old slot's in-flight calls finish (30-min cap).
  if [ "${2:-}" = "drain" ] && [ -n "$active" ] && [ "$active" != "$new_port" ]; then
    drain_calls "$active"
  fi
  if ! set_upstream "$new_port"; then
    pm2 delete "$new_name" >/dev/null 2>&1 || true
    echo "$P ERROR: nginx switch failed — active release untouched (still serving on :${active:-?})"; return 1
  fi
  ln -sfn "$rel" "$CURRENT"
  echo "$P nginx → :$new_port ($new_name). Draining old slot(s) 3 s…"; sleep 3
  for n in "${old[@]}"; do pm2 delete "$n" >/dev/null 2>&1 && echo "$P stopped old slot $n"; done
  pm2 save >/dev/null 2>&1 || true
  echo "$P ACTIVE → $(basename "$rel") on :$new_port ($new_name)"
}
prune_releases() {
  local cur d; cur="$(current_dir)"
  ls -1d "$RELEASES"/*/ 2>/dev/null | sed 's#/$##' | grep -vx "$cur" | sort | head -n "-$((KEEP_RELEASES - 1))" \
    | while read -r d; do [ -n "$d" ] && rm -rf "$d" && echo "$P pruned $(basename "$d")"; done
}
self_update() {
  [ "$APP" = "app-main" ] && [ -f "$1/scripts/droplet_deploy.sh" ] && ! cmp -s "$1/scripts/droplet_deploy.sh" "$SELF" || return 0
  cp "$1/scripts/droplet_deploy.sh" "$SELF.new" && chmod 755 "$SELF.new" && mv -f "$SELF.new" "$SELF" \
    && echo "$P deploy.sh updated from repo copy (takes effect on the next run)"
}

case "$CMD" in
  status)
    cur="$(current_dir)"
    echo "$P active port: $(active_port || echo none)   current: ${cur:-none} (sha=$(rel_field "${cur:-/nonexistent}" sha | cut -c1-8))"
    for n in "$APP" "$APP-a" "$APP-b"; do pm2_has "$n" && echo "$P pm2 $n: $(pm2_state "$n")"; done
    echo "$P releases:"; ls -1 "$RELEASES" 2>/dev/null | sed "s/^/$P   /"
    exit 0 ;;
  rollback)
    cur="$(current_dir)"
    if [ -n "$ARG" ]; then target="$ARG"
    else target="$(ls -1d "$RELEASES"/*/ 2>/dev/null | sed 's#/$##' | grep -vx "$cur" | sort | tail -1)"; fi
    [ -n "$target" ] && [ -f "$target/RELEASE" ] || fail "rollback: no previous release found"
    echo "$P rolling back $(basename "${cur:-none}") → $(basename "$target")"
    activate_release "$target" || fail "rollback to $(basename "$target") failed — active release untouched"
    notify "↩️ $APP rolled back to $(rel_field "$target" sha | cut -c1-8) ($(basename "$target"))"
    exit 0 ;;
  deploy) ;;
  *) echo "$P ERROR: unknown command $CMD"; exit 1 ;;
esac

git --git-dir="$REPO" fetch --force --prune origin "+refs/heads/$BRANCH:refs/heads/$BRANCH" || fail "git fetch failed"
SHA="$(git --git-dir="$REPO" rev-parse "refs/heads/$BRANCH")" || fail "cannot resolve $BRANCH"
SUBJECT="$(git --git-dir="$REPO" log -1 --format=%s "$SHA" | cut -c1-80)"
CUR="$(current_dir)"
echo "$P branch=$BRANCH  target=${SHA:0:8} ($SUBJECT)  active=$(rel_field "${CUR:-/nonexistent}" sha | cut -c1-8)"

REL=""
# Reseller bots (they have a sales dashboard) get a payout key once, so the main bot's 💸 Reseller Payouts finds them.
if [ -n "$(envval SALES_DASHBOARD_PASSWORD)" ] && [ -z "$(envval PAYOUT_ADMIN_KEY)" ]; then
  [ -n "$(tail -c1 "$SHARED/backend.env")" ] && echo >> "$SHARED/backend.env"
  echo "PAYOUT_ADMIN_KEY=\"$(openssl rand -hex 32)\"" >> "$SHARED/backend.env" && echo "$P added PAYOUT_ADMIN_KEY (reseller payouts)"
fi
if ! build_release "$SHA"; then
  [ -n "$REL" ] && rm -rf "$REL"
  fail "release build failed for ${SHA:0:8} — active release untouched"
fi
self_update "$REL"
if ! activate_release "$REL" drain; then
  rm -rf "$REL"
  fail "${SHA:0:8} failed to start healthy — active release untouched, still serving $(rel_field "${CUR:-/nonexistent}" sha | cut -c1-8)"
fi
prune_releases
echo "$P DONE → ${SHA:0:8}"
notify "✅ $APP deployed ${SHA:0:8} on $BRANCH — $SUBJECT${FE_NOTE}"
