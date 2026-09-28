#!/usr/bin/env bash
# Droplet auto-deploy — invoked by GitHub Actions over SSH.
# Canonical copy: scripts/droplet_deploy.sh (repo). Installed copy: /opt/nomadly/deploy.sh
# (self-updated from the repo copy after every sync; a new version applies on the NEXT run).
#
# Usage: /opt/nomadly/deploy.sh <app-dir>      e.g. app-main | app-wl | app-3
#
#   - single-flight per app (flock); survives an SSH drop (HUP ignored);
#     full log at /opt/nomadly/logs/deploy-<app>.log
#   - backs up uncommitted tree changes (lockfile noise excluded), prunes backups >30d
#   - git fetch + reset --hard origin/<current-branch>
#   - root deps only when package.json changed; frontend install/build only when
#     frontend/ changed — build goes to build.next and is swapped in only on success
#   - pm2 reload (fork mode = ~3 s restart, NOT zero-downtime), then waits for
#     /health to report "healthy"; on failure rolls back to the previous commit
#     and exits 1 so the Actions run is red
#   - Telegram notice to TELEGRAM_ADMIN_CHAT_ID (read from <app>/backend/.env)
set -uo pipefail
trap '' HUP

APP="${1:?usage: deploy.sh <app-dir> (app-main|app-wl|app-3)}"
ROOT="/opt/nomadly"
DIR="$ROOT/$APP"
BACKUP_DIR="$ROOT/deploy-backups"
LOG_DIR="$ROOT/logs"
SELF="$ROOT/deploy.sh"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-90}"
P="[deploy $APP]"
# Files npm rewrites/creates on every install — never worth a backup.
NOISE=(':(exclude)yarn.lock' ':(exclude)package-lock.json' ':(exclude)frontend/yarn.lock' ':(exclude)frontend/package-lock.json')

[ -d "$DIR/.git" ] || { echo "$P ERROR: $DIR is not a git checkout"; exit 1; }
mkdir -p "$BACKUP_DIR" "$LOG_DIR"
exec > >(tee -a -p "$LOG_DIR/deploy-$APP.log") 2>&1
exec 9>"$ROOT/.deploy-$APP.lock"
flock -w 900 9 || { echo "$P ERROR: another deploy of $APP is still running"; exit 1; }
cd "$DIR" || { echo "$P ERROR: cannot cd $DIR"; exit 1; }
echo "$P ===== $(date -u +%FT%TZ) ====="

envval() { grep -E "^$1=" backend/.env 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^["'"'"']//' -e 's/["'"'"']$//'; }
APP_PORT="$(envval PORT)"; APP_PORT="${APP_PORT:-5000}"
BOT_TOKEN="$(envval TELEGRAM_BOT_TOKEN_PROD)"; [ -n "$BOT_TOKEN" ] || BOT_TOKEN="$(envval TELEGRAM_BOT_TOKEN)"
ADMIN_CHAT="$(envval TELEGRAM_ADMIN_CHAT_ID)"

notify() {
  [ -n "$BOT_TOKEN" ] && [ -n "$ADMIN_CHAT" ] || { echo "$P (telegram notice skipped — no bot token / admin chat in backend/.env)"; return 0; }
  curl -s -m 10 -o /dev/null -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
    --data-urlencode "chat_id=$ADMIN_CHAT" --data-urlencode "text=$1" || true
}
fail() { echo "$P ERROR: $1"; notify "❌ $APP deploy FAILED — $1"; exit 1; }
sha() { sha1sum "$1" 2>/dev/null | awk '{print $1}'; }
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
print(e.get("status", "unknown"), e.get("restart_time", 0))' "$APP"
}
# $1 = pm2 restart count right after the reload; any further restart = crash loop.
wait_healthy() {
  local deadline=$((SECONDS + HEALTH_TIMEOUT)) st="" rt="" body=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    read -r st rt < <(pm2_state); st="${st:-unknown}"; rt="${rt:-0}"
    if [ "$st" = "errored" ] || [ "$rt" -gt "$1" ]; then
      echo "$P health: pm2 status=$st restarts=$rt (baseline $1) → crash loop"; return 1
    fi
    body="$(curl -s -m 5 "http://127.0.0.1:$APP_PORT/health" 2>/dev/null | tr -d '\n\r' | tr -s ' ' || true)"
    if [ "$st" = "online" ] && grep -Eq '"status": *"healthy"' <<<"$body"; then
      echo "$P health OK — pm2 online, /health healthy, restarts=$rt"; return 0
    fi
    sleep 3
  done
  echo "$P health: TIMEOUT after ${HEALTH_TIMEOUT}s — pm2 status=$st, /health: ${body:0:120}"; return 1
}
reload_and_check() {
  pm2 reload "$APP" --update-env || return 2
  pm2 save >/dev/null 2>&1 || true
  local base; read -r _ base < <(pm2_state); base="${base:-0}"
  wait_healthy "$base"
}

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
BEFORE="$(git rev-parse HEAD)"
echo "$P branch=$BRANCH  before=${BEFORE:0:8}"

# 1) Back up uncommitted changes (tracked diff + untracked files) so the reset
#    below can never silently discard local work. Lockfile churn is ignored.
if [ -n "$(git status --porcelain -- . "${NOISE[@]}")" ]; then
  TS="$(date -u +%Y%m%dT%H%M%SZ)"
  git diff HEAD -- . "${NOISE[@]}" > "$BACKUP_DIR/${APP}-${TS}.patch" 2>/dev/null || true
  [ -s "$BACKUP_DIR/${APP}-${TS}.patch" ] || rm -f "$BACKUP_DIR/${APP}-${TS}.patch"
  if [ -n "$(git ls-files --others --exclude-standard -- . "${NOISE[@]}")" ]; then
    git ls-files --others --exclude-standard -z -- . "${NOISE[@]}" \
      | tar --null -czf "$BACKUP_DIR/${APP}-${TS}-untracked.tgz" -T - 2>/dev/null || true
  fi
  echo "$P backed up local changes → $BACKUP_DIR/${APP}-${TS}.*"
  git status --porcelain -- . "${NOISE[@]}" | head -20
fi
find "$BACKUP_DIR" -type f -mtime +30 -delete 2>/dev/null || true

# 2) Snapshot dependency/frontend fingerprints, then sync to the pushed commit.
PKG_BEFORE="$(sha package.json)"
FE_PKG_BEFORE="$(sha frontend/package.json)"
FE_TREE_BEFORE="$(git rev-parse HEAD:frontend 2>/dev/null || echo none)"

git fetch --prune origin || fail "git fetch failed"
git reset --hard "origin/$BRANCH" || fail "git reset --hard origin/$BRANCH failed"
AFTER="$(git rev-parse HEAD)"
SUBJECT="$(git log -1 --format=%s | cut -c1-80)"
echo "$P synced ${BEFORE:0:8} → ${AFTER:0:8}  ($SUBJECT)"

PKG_AFTER="$(sha package.json)"
FE_PKG_AFTER="$(sha frontend/package.json)"
FE_TREE_AFTER="$(git rev-parse HEAD:frontend 2>/dev/null || echo none)"

# 2b) Keep the installed copy of this script in sync with the repo — from the
#     canonical checkout only, so an older brand branch can never downgrade it.
if [ "$APP" = "app-main" ] && [ -f scripts/droplet_deploy.sh ] && ! cmp -s scripts/droplet_deploy.sh "$SELF"; then
  cp scripts/droplet_deploy.sh "$SELF.new" && chmod 755 "$SELF.new" && mv -f "$SELF.new" "$SELF" \
    && echo "$P deploy.sh updated from repo copy (takes effect on the next run)"
fi

# 3) Root deps: install only when package.json changed (or node_modules missing).
if [ "$PKG_BEFORE" != "$PKG_AFTER" ] || [ ! -d node_modules ]; then
  echo "$P root deps changed → npm install --omit=dev"
  npm install --omit=dev --no-audit --no-fund || fail "npm install failed"
else
  echo "$P root deps unchanged → skip install"
fi

# 4) Frontend: install + build only when the frontend/ tree changed. The build
#    lands in build.next and replaces build/ only on success (CRA empties its
#    target dir first, so building in place would leave a blank panel on failure).
FE_NOTE=""
if [ -f frontend/package.json ]; then
  if [ "$FE_PKG_BEFORE" != "$FE_PKG_AFTER" ] || [ ! -d frontend/node_modules ]; then
    echo "$P frontend deps changed → npm install --legacy-peer-deps"
    ( cd frontend && npm install --legacy-peer-deps --no-audit --no-fund ) \
      || echo "$P WARN: frontend npm install failed"
  fi
  if [ "$FE_TREE_BEFORE" != "$FE_TREE_AFTER" ] || [ ! -f frontend/build/index.html ]; then
    echo "$P frontend changed → build into build.next (swapped in only on success)"
    rm -rf frontend/build.next
    if ( cd frontend && BUILD_PATH=build.next DISABLE_ESLINT_PLUGIN=true CI=false nice -n 10 npm run build ) \
       && [ -f frontend/build.next/index.html ]; then
      rm -rf frontend/build.prev
      [ -d frontend/build ] && mv frontend/build frontend/build.prev
      mv frontend/build.next frontend/build && rm -rf frontend/build.prev
      echo "$P frontend build swapped in"
    else
      rm -rf frontend/build.next
      echo "$P WARN: frontend build FAILED — previous build kept"
      FE_NOTE=" ⚠️ frontend build failed (previous build kept)"
    fi
  else
    echo "$P frontend unchanged → skip build"
  fi
fi

# 5) Restart (fork mode: pm2 reload ≈ 3 s restart) and wait for /health.
#    Never auto-start a brand-new app here — first launch is done by hand.
pm2 describe "$APP" >/dev/null 2>&1 || fail "PM2 process '$APP' not found — start it once by hand, then re-run"
reload_and_check; RC=$?
[ "$RC" -eq 2 ] && fail "pm2 reload failed"
if [ "$RC" -eq 0 ]; then
  echo "$P DONE → ${AFTER:0:8}"
  notify "✅ $APP deployed ${AFTER:0:8} on $BRANCH — $SUBJECT${FE_NOTE}"
  exit 0
fi

# 6) Unhealthy → roll back to the previous commit (deps re-installed if needed;
#    the frontend build is left as-is — static assets, harmless).
echo "$P unhealthy after deploy → ROLLBACK to ${BEFORE:0:8}"
git reset --hard "$BEFORE" || fail "${AFTER:0:8} unhealthy and rollback git reset failed"
if [ "$(sha package.json)" != "$PKG_AFTER" ]; then
  echo "$P rollback: package.json differs → npm install --omit=dev"
  npm install --omit=dev --no-audit --no-fund || echo "$P WARN: npm install during rollback failed"
fi
reload_and_check; RC=$?
[ "$RC" -eq 0 ] && fail "${AFTER:0:8} was unhealthy — ROLLED BACK to ${BEFORE:0:8} (healthy). Fix and push again."
fail "${AFTER:0:8} unhealthy AND rollback to ${BEFORE:0:8} still unhealthy — check: pm2 logs $APP"
