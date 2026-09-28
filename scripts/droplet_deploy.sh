#!/usr/bin/env bash
# Droplet auto-deploy — invoked by GitHub Actions over SSH.
# Canonical copy lives in the repo; the executable copy is installed on the
# droplet at /opt/nomadly/deploy.sh (the workflow calls that path).
#
# Usage: /opt/nomadly/deploy.sh <app-dir>      e.g. app-main | app-wl | app-3
#
# Behaviour (matches the repo's nixpacks build, "smart deps"):
#   - backs up any uncommitted working-tree changes (never loses work)
#   - git fetch + reset --hard origin/<current-branch>
#   - reinstalls root deps ONLY when package.json changed (npm install --omit=dev)
#   - reinstalls + rebuilds frontend ONLY when the frontend/ tree changed
#   - pm2 reload <app-dir> --update-env  (zero-downtime)
set -uo pipefail

APP="${1:?usage: deploy.sh <app-dir> (app-main|app-wl|app-3)}"
DIR="/opt/nomadly/$APP"
BACKUP_DIR="/opt/nomadly/deploy-backups"
P="[deploy $APP]"

[ -d "$DIR/.git" ] || { echo "$P ERROR: $DIR is not a git checkout"; exit 1; }
mkdir -p "$BACKUP_DIR"
cd "$DIR" || { echo "$P ERROR: cannot cd $DIR"; exit 1; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
echo "$P branch=$BRANCH  before=$(git rev-parse --short HEAD)"

# 1) Back up any uncommitted changes (tracked diff + untracked files) so the
#    reset below can never silently discard local work.
if [ -n "$(git status --porcelain)" ]; then
  TS="$(date -u +%Y%m%dT%H%M%SZ)"
  git diff HEAD > "$BACKUP_DIR/${APP}-${TS}.patch" 2>/dev/null || true
  git ls-files --others --exclude-standard -z \
    | tar --null -czf "$BACKUP_DIR/${APP}-${TS}-untracked.tgz" -T - 2>/dev/null || true
  echo "$P backed up local changes → $BACKUP_DIR/${APP}-${TS}.*"
fi

# 2) Snapshot dependency/frontend fingerprints, then sync to the pushed commit.
PKG_BEFORE="$(sha1sum package.json 2>/dev/null | awk '{print $1}')"
FE_PKG_BEFORE="$(sha1sum frontend/package.json 2>/dev/null | awk '{print $1}')"
FE_TREE_BEFORE="$(git rev-parse HEAD:frontend 2>/dev/null || echo none)"

git fetch --prune origin || { echo "$P ERROR: git fetch failed"; exit 1; }
git reset --hard "origin/$BRANCH" || { echo "$P ERROR: git reset failed"; exit 1; }
echo "$P synced to $(git rev-parse --short HEAD)"

PKG_AFTER="$(sha1sum package.json 2>/dev/null | awk '{print $1}')"
FE_PKG_AFTER="$(sha1sum frontend/package.json 2>/dev/null | awk '{print $1}')"
FE_TREE_AFTER="$(git rev-parse HEAD:frontend 2>/dev/null || echo none)"

# 3) Root deps: install only when package.json changed (or node_modules missing).
if [ "$PKG_BEFORE" != "$PKG_AFTER" ] || [ ! -d node_modules ]; then
  echo "$P root deps changed → npm install --omit=dev"
  npm install --omit=dev --no-audit --no-fund || { echo "$P ERROR: npm install failed"; exit 1; }
else
  echo "$P root deps unchanged → skip install"
fi

# 4) Frontend: install + build only when the frontend/ tree changed.
if [ -f frontend/package.json ]; then
  if [ "$FE_PKG_BEFORE" != "$FE_PKG_AFTER" ] || [ ! -d frontend/node_modules ]; then
    echo "$P frontend deps changed → npm install --legacy-peer-deps"
    ( cd frontend && npm install --legacy-peer-deps --no-audit --no-fund ) \
      || echo "$P WARN: frontend npm install failed"
  fi
  if [ "$FE_TREE_BEFORE" != "$FE_TREE_AFTER" ] || [ ! -d frontend/build ]; then
    echo "$P frontend changed → build"
    ( cd frontend && DISABLE_ESLINT_PLUGIN=true CI=false npm run build ) \
      || echo "$P WARN: frontend build failed (keeping previous build)"
  else
    echo "$P frontend unchanged → skip build"
  fi
fi

# 5) Reload the PM2 process (zero-downtime). Never auto-start a brand-new app
#    here — the first launch is done by hand so env/ports are verified.
if pm2 describe "$APP" >/dev/null 2>&1; then
  pm2 reload "$APP" --update-env || { echo "$P ERROR: pm2 reload failed"; exit 1; }
  pm2 save >/dev/null 2>&1 || true
else
  echo "$P ERROR: PM2 process '$APP' not found — start it once by hand, then re-run"; exit 1
fi

echo "$P DONE → $(git rev-parse --short HEAD)"
