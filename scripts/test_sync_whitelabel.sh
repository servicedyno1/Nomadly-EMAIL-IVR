#!/usr/bin/env bash
# Local end-to-end harness for scripts/sync_whitelabel.py.
# Builds a throw-away "GitHub" (bare repo) in /tmp/sim from the REAL main + WhiteLabel
# branches (cloned read-only into /tmp/gh), adds this workspace's files on top of main,
# and runs 8 scenarios. Never touches /app/.git or GitHub.
set -u
SIM=/tmp/sim; GH=/tmp/gh; PASS=0; FAIL=0
ok()   { echo "  ✅ PASS: $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ FAIL: $1"; FAIL=$((FAIL+1)); }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }

[ -d "$GH" ] || { URL=$(git -C /app remote get-url origin); git clone -q --no-checkout "$URL" "$GH"; git -C "$GH" fetch -q origin WhiteLabel:refs/remotes/origin/WhiteLabel; }
rm -rf "$SIM" && mkdir -p "$SIM" && cd "$SIM" || exit 1
git clone --bare -q "$GH" origin.git
git -C origin.git fetch -q "$GH" +refs/remotes/origin/WhiteLabel:refs/heads/WhiteLabel +refs/remotes/origin/main:refs/heads/main
REAL_WL=$(git -C origin.git rev-parse WhiteLabel)
git clone -q origin.git work && cd work || exit 1
git config user.name sim; git config user.email sim@local
git fetch -q /app HEAD && git reset -q --hard FETCH_HEAD
mkdir -p .github/workflows scripts
cp /app/scripts/sync_whitelabel.py scripts/; cp /app/.github/workflows/sync-whitelabel.yml /app/.github/workflows/deploy.yml .github/workflows/
git add -A; git commit -qm "workspace: WhiteLabel sync button"; git push -q origin HEAD:main; git fetch -q origin
S="python3 scripts/sync_whitelabel.py"
main_commit() { git checkout -q -B main origin/main; eval "$1"; git commit -qam "$2"; git push -q origin main; git fetch -q origin; }
main_undo()   { git checkout -q -B main origin/main; git revert --no-edit HEAD >/dev/null; git push -q origin main; git fetch -q origin; }
wl()          { git -C origin.git rev-parse WhiteLabel 2>/dev/null || git -C "$SIM/origin.git" rev-parse WhiteLabel; }

echo "T1 first real sync (--push)"
$S --push > /tmp/t1.log 2>&1; rc=$?; git fetch -q origin
check "exit 0" "[ $rc = 0 ]"
check "fast-forward from real WhiteLabel ${REAL_WL:0:8}" "[ \"\$(git rev-parse origin/WhiteLabel^)\" = $REAL_WL ]"
check "shortlink fix now on WhiteLabel" "[ \"\$(git rev-parse origin/WhiteLabel:js/shortener-analytics.js)\" = \"\$(git rev-parse origin/main:js/shortener-analytics.js)\" ]"
check "both dev check pages on WhiteLabel" "[ \$(git show origin/WhiteLabel:js/_index.js | grep -c -E \"app.get\\('/dev/(shortlink-analytics-test|rdp-pricing-test)'\") = 2 ]"
check "WL /sales + /branding wiring kept" "git show origin/WhiteLabel:js/_index.js | grep -q \"routes/sales.js\" && git show origin/WhiteLabel:js/_index.js | grep -q \"app.get('/branding'\""
check "all brand files byte-identical to real WhiteLabel" "git diff --quiet $REAL_WL origin/WhiteLabel -- frontend/.env.production frontend/public frontend/src/App.js frontend/src/App.css frontend/src/index.js frontend/src/index.css frontend/src/branding.js frontend/src/pages/SalesDashboard.js frontend/tailwind.config.js js/branding.js js/routes/sales.js"
check ".whitelabel-sync marker records main" "git show origin/WhiteLabel:.whitelabel-sync | grep -q \"^main=\$(git rev-parse origin/main)\$\""
check "no .github/workflows file changed (GitHub would reject an Actions-token push)" "[ -z \"\$(git diff --name-only $REAL_WL origin/WhiteLabel -- .github/workflows)\" ] && grep -q 'Skipped — GitHub workflow files' /tmp/t1.log"
check "sync commit is runtime-only: WL now == main except brand files + WL wiring" "[ \"\$(git diff --name-only origin/main origin/WhiteLabel -- js backend scripts ops package.json ':!**/tests/**' ':!**/*.md' ':!scripts/sync_whitelabel.py' | sort | tr '\n' ' ')\" = 'js/_index.js js/branding.js js/routes/sales.js js/vps-ssh-reachability.js ' ]"

echo "T2 re-run (idempotent)"
B=$(wl); out=$($S --push 2>&1); rc=$?
check "exit 0 + 'nothing to do' + no new commit" "[ $rc = 0 ] && echo \"\$out\" | grep -q 'nothing to do' && [ \"\$(wl)\" = $B ]"

echo "T3 later main change -> only that change carried"
main_commit "echo '// T3' >> js/shortener-analytics.js" "T3"
$S --push > /tmp/t3.log 2>&1; rc=$?; git fetch -q origin
check "exit 0, base read from marker, 1 file" "[ $rc = 0 ] && grep -q 'from .whitelabel-sync' /tmp/t3.log && grep -q '^sync(WhiteLabel).*(1 file' <(git log -1 --format=%s origin/WhiteLabel)"

echo "T4 main touches a WL brand-only file -> skipped"
main_commit "echo '// NOMADLY overwrite' > js/branding.js; git add js/branding.js" "T4"
$S --push > /tmp/t4.log 2>&1; rc=$?; git fetch -q origin
check "exit 0 and WL keeps Smadav js/branding.js" "[ $rc = 0 ] && ! git show origin/WhiteLabel:js/branding.js | grep -q 'NOMADLY overwrite'"

echo "T5 real conflict in branded App.js -> STOP, nothing pushed"
B=$(wl); main_commit "L=\$(grep -n NomadlyBot frontend/src/App.js | head -1 | cut -d: -f1); sed -i \"\${L}s/NomadlyBot/NomadlyBot PRO/\" frontend/src/App.js" "T5"
$S --push > /tmp/t5.log 2>&1; rc=$?
check "exit 2, App.js listed, WL unchanged" "[ $rc = 2 ] && grep -q 'frontend/src/App.js' /tmp/t5.log && [ \"\$(wl)\" = $B ]"
main_undo; $S --push >/dev/null 2>&1

echo "T6 main pushes broken JS -> STOP, nothing pushed"
B=$(wl); main_commit "echo 'function broken( {' >> js/shortener-analytics.js" "T6"
$S --push > /tmp/t6.log 2>&1; rc=$?
check "exit 3 (syntax), WL unchanged" "[ $rc = 3 ] && grep -q 'SYNTAX CHECK FAILED' /tmp/t6.log && [ \"\$(wl)\" = $B ]"
main_undo; $S --push >/dev/null 2>&1

echo "T7 WL-only hotfix + later main edit in same file -> both kept"
rm -rf "$SIM/wlc"; git clone -q -b WhiteLabel "$SIM/origin.git" "$SIM/wlc"
( cd "$SIM/wlc" && git config user.name wl && git config user.email wl@l && sed -i '1s/^/\/\/ WL-HOTFIX-T7\n/' js/_index.js && git commit -qam "WL hotfix" && git push -q origin WhiteLabel )
git fetch -q origin
main_commit "L=\$(grep -n \"app.get('/dev/rdp-pricing-test'\" js/_index.js | cut -d: -f1); sed -i \"\${L}i // MAIN-T7\" js/_index.js" "T7"
$S --push > /tmp/t7.log 2>&1; rc=$?; git fetch -q origin
check "exit 0, merged, WL has hotfix AND main edit" "[ $rc = 0 ] && git show origin/WhiteLabel:js/_index.js | grep -q WL-HOTFIX-T7 && git show origin/WhiteLabel:js/_index.js | grep -q MAIN-T7"

echo "T8 WhiteLabel moved after we fetched -> push refused (never forced)"
( cd "$SIM/wlc" && git pull -q && echo '// concurrent' >> js/branding.js && git commit -qam "concurrent WL edit" && git push -q origin WhiteLabel )
main_commit "echo '// T8' >> js/shortener-analytics.js" "T8"   # main_commit fetches; re-point WL to the stale tip:
git update-ref refs/remotes/origin/WhiteLabel "$(git -C "$SIM/origin.git" rev-parse WhiteLabel^)"
$S --push > /tmp/t8.log 2>&1; rc=$?
check "exit 1 + rejected, WL tip is still the concurrent edit" "[ $rc = 1 ] && grep -qiE 'rejected|fetch first|non-fast-forward' /tmp/t8.log && [ \"\$(git -C $SIM/origin.git log -1 --format=%s WhiteLabel)\" = 'concurrent WL edit' ]"

echo; echo "RESULT: $PASS passed, $FAIL failed"; [ $FAIL = 0 ]
