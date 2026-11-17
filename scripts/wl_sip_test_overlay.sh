#!/bin/bash
# Usage (on droplet): wl_sip_test_overlay.sh <app> — overlay the SIP-test-page fix (our SIP server over WSS) onto the live
# WhiteLabel release and blue/green deploy it (normal call drain). Files staged in /tmp/wlsip/ by the workspace.
set -uo pipefail
APP=$1; LIVE=$(readlink -f /opt/nomadly/current/$APP); W=/tmp/wlsip-$APP; S=/tmp/wlsip
rm -rf $W && mkdir -p $W
( cd $LIVE && tar --exclude=./node_modules --exclude=./frontend/node_modules --exclude=./frontend/build --exclude=./frontend/build.next -cf - . ) | tar -xf - -C $W
for f in js/sip-logins.js js/cloudivr-web/webrtc-config.js js/phone-test-routes.js js/cloudivr-web/trycall.js frontend/src/pages/PhoneTestPage.js frontend/src/cloudivr/sipClient.js; do cp $S/$f $W/$f; done
python3 $S/wl_patch.py $W || { echo "PATCH FAILED"; exit 1; }
for f in js/_index.js js/sip-logins.js js/cloudivr-web/webrtc-config.js js/phone-test-routes.js js/cloudivr-web/trycall.js; do node -c $W/$f || exit 1; done
SHA=$(grep '^sha=' $LIVE/RELEASE | cut -d= -f2); FE="wlsip-$(cd $W/frontend && find src -type f | sort | xargs sha1sum | sha1sum | cut -c1-12)"
grep -q '^SIP_WSS_URL=' /opt/nomadly/shared/$APP/backend.env || { cp /opt/nomadly/shared/$APP/backend.env /opt/nomadly/shared/$APP/backend.env.bak-wlsip; printf '\nSIP_WSS_URL=wss://sip.cloudivr.net:8443\n' >> /opt/nomadly/shared/$APP/backend.env; }
( cd $W && tar -czf /opt/nomadly/wlsip_$APP.tgz . )
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
open('/opt/nomadly/deploy_wlsip.sh', 'w').write(src)
PY
echo "fe_tree=$FE sha=$SHA"
LOCAL_TARBALL=/opt/nomadly/wlsip_$APP.tgz LOCAL_SHA=$SHA LOCAL_FE_TREE=$FE LOCAL_SUBJECT="sip-test-page WSS overlay on $(basename $LIVE)" bash /opt/nomadly/deploy_wlsip.sh $APP
rc=$?; rm -rf /opt/nomadly/wlsip_$APP.tgz $W; echo "WL_DEPLOY_EXIT[$APP]=$rc"
