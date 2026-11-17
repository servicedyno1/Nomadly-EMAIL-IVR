#!/bin/bash
# Usage (on droplet): wl_commit_deploy.sh <git-dir> <commit> <app> <brand-sip-domain>
# Blue/green deploy of an exact WhiteLabel commit (e.g. a sync_whitelabel.py dry-run result) — normal call drain.
set -uo pipefail
GD=$1; C=$2; APP=$3; DOM=$4
ENV=/opt/nomadly/shared/$APP/backend.env
grep -q '^CLOUDIVR_SIP_DOMAIN=' $ENV || { cp $ENV $ENV.bak-wlsip2; printf '\nCLOUDIVR_SIP_DOMAIN=%s\n' "$DOM" >> $ENV; }
grep -q '^SIP_WSS_URL=' $ENV || printf '\nSIP_WSS_URL=wss://sip.cloudivr.net:8443\n' >> $ENV
git --git-dir=$GD archive --format=tar.gz -o /opt/nomadly/wlc_$APP.tgz $C || exit 1
FE=$(git --git-dir=$GD rev-parse $C:frontend)
python3 - <<'PY'
src = open('/opt/nomadly/deploy.sh').read()
reps = [
 ('git --git-dir="$REPO" archive "$sha" | tar -x -C "$REL" || { echo "$P ERROR: git archive $sha failed"; return 1; }', 'tar -xzf "$LOCAL_TARBALL" -C "$REL" || { echo "$P ERROR: tarball extract failed"; return 1; }'),
 ('fe_tree="$(git --git-dir="$REPO" rev-parse "$sha:frontend" 2>/dev/null || echo none)"', 'fe_tree="$LOCAL_FE_TREE"'),
 ('git --git-dir="$REPO" fetch --force --prune origin "+refs/heads/$BRANCH:refs/heads/$BRANCH" || fail "git fetch failed"', ': # tarball deploy'),
 ('SHA="$(git --git-dir="$REPO" rev-parse "refs/heads/$BRANCH")" || fail "cannot resolve $BRANCH"', 'SHA="$LOCAL_SHA"'),
 ('SUBJECT="$(git --git-dir="$REPO" log -1 --format=%s "$SHA" | cut -c1-80)"', 'SUBJECT="$LOCAL_SUBJECT"'),
 ('if [ "$CMD" = "deploy" ] && [ "${DEPLOY_CATCHUP:-0}" -lt 3 ]', 'if false && [ "$CMD" = "deploy" ]'),
]
for a, b in reps:
    assert src.count(a) == 1, a[:60]
    src = src.replace(a, b)
open('/opt/nomadly/deploy_wlc.sh', 'w').write(src)
PY
LOCAL_TARBALL=/opt/nomadly/wlc_$APP.tgz LOCAL_SHA=$(git --git-dir=$GD rev-parse $C) LOCAL_FE_TREE=$FE LOCAL_SUBJECT="WhiteLabel sync preview $C (SIP browser phone)" bash /opt/nomadly/deploy_wlc.sh $APP
rc=$?; rm -f /opt/nomadly/wlc_$APP.tgz; echo "WL_DEPLOY_EXIT[$APP]=$rc"
