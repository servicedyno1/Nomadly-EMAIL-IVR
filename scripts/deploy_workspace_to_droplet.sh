#!/bin/bash
# ============================================================
# Deploy THIS workspace's code to a droplet app over SSH (no GitHub round-trip)
# ============================================================
# Same blue/green safety as /opt/nomadly/deploy.sh (build → /health → call drain → nginx flip →
# old slot stopped; any failure keeps the live release). The only difference: the release tree comes
# from a tarball of the workspace (tracked + new, non-ignored files, incl. uncommitted edits) instead of
# `git archive origin/<branch>`. A temporary patched copy of deploy.sh is generated on the droplet and
# deleted afterwards. The next normal deploy (GitHub Actions) builds from the app's branch again —
# so "Save to GitHub" afterwards or that deploy will roll these changes back.
#
# Usage:  bash scripts/deploy_workspace_to_droplet.sh [app]     (default app-main)
#         then watch: ssh ... 'tail -f /opt/nomadly/logs/ws-deploy-<sha>.log'
# Needs: /root/.ssh/nomadly_droplet (VAULT_PASSWORD=... bash scripts/restore_infra_keys.sh)
# ============================================================
set -euo pipefail
APP="${1:-app-main}"
HOST="${DROPLET_IP:-$(grep -E '^DROPLET_IP=' /app/backend/.env | cut -d= -f2- | tr -d '"')}"
KEY=/root/.ssh/nomadly_droplet
SSH=(ssh -n -i "$KEY" -o ConnectTimeout=15 "root@$HOST")
cd /app
SHA=$(git rev-parse HEAD); SHORT=${SHA:0:7}
DIRTY=$(git status --porcelain | grep -c . || true)
FE=$(git ls-files -z --cached --others --exclude-standard frontend | xargs -0 sha1sum | sha1sum | cut -c1-40)
TGZ=/tmp/ws_release_${SHORT}.tgz
git ls-files -z --cached --others --exclude-standard | tar --null -czf "$TGZ" -T -
echo "📦 $TGZ ($(du -h "$TGZ" | cut -f1)) — HEAD $SHORT + $DIRTY uncommitted change(s)"
scp -q -i "$KEY" "$TGZ" "root@$HOST:/opt/nomadly/ws_release_${SHORT}.tgz"
rm -f "$TGZ"
"${SSH[@]}" "python3 - <<'PY'
src = open('/opt/nomadly/deploy.sh').read()
reps = [
 ('git --git-dir=\"\$REPO\" archive \"\$sha\" | tar -x -C \"\$REL\" || { echo \"\$P ERROR: git archive \$sha failed\"; return 1; }',
  'tar -xzf \"\$LOCAL_TARBALL\" -C \"\$REL\" || { echo \"\$P ERROR: tarball extract failed\"; return 1; }'),
 ('fe_tree=\"\$(git --git-dir=\"\$REPO\" rev-parse \"\$sha:frontend\" 2>/dev/null || echo none)\"', 'fe_tree=\"\$LOCAL_FE_TREE\"'),
 ('git --git-dir=\"\$REPO\" fetch --force --prune origin \"+refs/heads/\$BRANCH:refs/heads/\$BRANCH\" || fail \"git fetch failed\"', ': # workspace tarball deploy'),
 ('SHA=\"\$(git --git-dir=\"\$REPO\" rev-parse \"refs/heads/\$BRANCH\")\" || fail \"cannot resolve \$BRANCH\"', 'SHA=\"\$LOCAL_SHA\"'),
 ('SUBJECT=\"\$(git --git-dir=\"\$REPO\" log -1 --format=%s \"\$SHA\" | cut -c1-80)\"', 'SUBJECT=\"\$LOCAL_SUBJECT\"'),
]
for a, b in reps:
    assert src.count(a) == 1, ('deploy.sh changed — patch target not found exactly once', a[:60])
    src = src.replace(a, b)
open('/opt/nomadly/deploy_from_tarball.sh', 'w').write(src)
PY
chmod 755 /opt/nomadly/deploy_from_tarball.sh && bash -n /opt/nomadly/deploy_from_tarball.sh"
LOG="/opt/nomadly/logs/ws-deploy-${SHORT}.log"
"${SSH[@]}" "cd /opt/nomadly && LOCAL_TARBALL=/opt/nomadly/ws_release_${SHORT}.tgz LOCAL_SHA=$SHA LOCAL_FE_TREE=ws-$FE \
  LOCAL_SUBJECT='workspace $SHORT (+$DIRTY uncommitted) via SSH' setsid nohup bash -c \
  'bash /opt/nomadly/deploy_from_tarball.sh $APP; rc=\$?; rm -f /opt/nomadly/deploy_from_tarball.sh /opt/nomadly/ws_release_${SHORT}.tgz; \
   [ \$rc -eq 0 ] && echo \"source=workspace-tarball ${SHORT} +${DIRTY} uncommitted\" >> /opt/nomadly/current/$APP/RELEASE; echo WS_DEPLOY_EXIT=\$rc' \
  > $LOG 2>&1 < /dev/null & disown"
echo "🚀 started $APP deploy on $HOST — log: $LOG (ends with WS_DEPLOY_EXIT=<code>)"
