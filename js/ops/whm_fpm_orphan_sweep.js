#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/*
 * WHM PHP-FPM orphan-pool sweeper / rebuild safety-net.
 *
 * WHY: cPanel `/removeacct` normally deletes an account's PHP-FPM pool. But if a
 * pool is ever orphaned (home dir deleted without a clean removeacct, or a
 * removal that couldn't rebuild FPM because a PRIOR orphan already broke the
 * master), php-fpm --test fails and the whole ea-phpXX master refuses to start
 * → EVERY vhost on that PHP version returns 503. (Live incident 2026-09-29:
 * `pent14295test.com` + `pent14361t179052.com` pools → missing /home dirs took
 * down all 39 ea-php82 sites incl. stelworxllc.com.)
 *
 * This tool SSHes to the WHM box, finds every FPM pool whose `chdir` (home dir)
 * no longer exists, and — with --confirm — backs them up, removes them, runs
 * `/scripts/php_fpm_config --rebuild` (prunes anything else stale), and restarts
 * any failed ea-phpXX-php-fpm master. Idempotent + safe to re-run.
 *
 * Exposed as a module (`sweep({confirm})`) so the pentest-removal ops scripts
 * call it automatically AFTER every removeacct — guaranteeing deleted accounts
 * never leave a pool that can 503 the whole server on the next FPM restart.
 *
 * Usage:
 *   node js/ops/whm_fpm_orphan_sweep.js            # DRY-RUN (report only)
 *   node js/ops/whm_fpm_orphan_sweep.js --confirm  # prune + rebuild + restart
 *
 * Config (env, with sane defaults for the current prod WHM box):
 *   WHM_SSH_HOST  (default 68.183.77.106)
 *   WHM_SSH_USER  (default root)
 *   WHM_SSH_KEY   (default /root/.ssh/whm_box)
 */
const { execFile } = require('child_process')
const path = require('path')
const os = require('os')

const HOST = process.env.WHM_SSH_HOST || '68.183.77.106'
const USER = process.env.WHM_SSH_USER || 'root'
const KEY = process.env.WHM_SSH_KEY || path.join(os.homedir(), '.ssh', 'whm_box')

// Remote bash payload. Emits a single JSON line prefixed with SWEEP_JSON:
// so the Node wrapper can parse it regardless of other stdout noise.
function remoteScript(confirm) {
  return `
set -u
CONFIRM=${confirm ? 1 : 0}
BACKUP=/root/fpm-orphan-backup-$(date +%Y%m%dT%H%M%SZ)
ORPHANS=()
for D in /opt/cpanel/ea-php*/root/etc/php-fpm.d; do
  [ -d "$D" ] || continue
  for f in "$D"/*.conf; do
    [ -e "$f" ] || continue
    d=$(grep -oP '^chdir\\s*=\\s*\\K.*' "$f" 2>/dev/null | head -1)
    [ -n "$d" ] && [ ! -d "$d" ] && ORPHANS+=("$f|$d")
  done
done
REMOVED=()
if [ "$CONFIRM" = "1" ] && [ "\${#ORPHANS[@]}" -gt 0 ]; then
  mkdir -p "$BACKUP"
  for o in "\${ORPHANS[@]}"; do
    f="\${o%%|*}"
    cp -a "$f" "$BACKUP"/ 2>/dev/null && rm -f "$f" && REMOVED+=("$f")
  done
  /scripts/php_fpm_config --rebuild >/dev/null 2>&1
fi
# master states (after any rebuild); restart failed ones on confirm
MASTERS=()
for v in $(ls -d /opt/cpanel/ea-php*/ 2>/dev/null | grep -oP 'ea-php\\d+'); do
  svc="\${v}-php-fpm"
  st=$(systemctl is-active "$svc" 2>/dev/null)
  if [ "$CONFIRM" = "1" ] && [ "$st" != "active" ]; then
    systemctl restart "$svc" >/dev/null 2>&1
    st=$(systemctl is-active "$svc" 2>/dev/null)
  fi
  MASTERS+=("$v:$st")
done
# build JSON
j_orphans=$(printf '%s\\n' "\${ORPHANS[@]:-}" | sed '/^$/d' | awk -F'|' '{printf "%s{\\"conf\\":\\"%s\\",\\"chdir\\":\\"%s\\"}", (NR>1?",":""), $1, $2}')
j_removed=$(printf '%s\\n' "\${REMOVED[@]:-}" | sed '/^$/d' | awk '{printf "%s\\"%s\\"", (NR>1?",":""), $0}')
j_masters=$(printf '%s\\n' "\${MASTERS[@]:-}" | sed '/^$/d' | awk -F: '{printf "%s{\\"v\\":\\"%s\\",\\"state\\":\\"%s\\"}", (NR>1?",":""), $1, $2}')
echo "SWEEP_JSON:{\\"host\\":\\"$(hostname)\\",\\"confirm\\":$CONFIRM,\\"backup\\":\\"$BACKUP\\",\\"orphans\\":[$j_orphans],\\"removed\\":[$j_removed],\\"masters\\":[$j_masters]}"
`
}

function ssh(remoteCmd) {
  return new Promise((resolve, reject) => {
    execFile('ssh', [
      '-o', 'ConnectTimeout=15',
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'BatchMode=yes',
      '-i', KEY,
      `${USER}@${HOST}`,
      remoteCmd,
    ], { timeout: 120000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && !stdout) return reject(new Error(`${err.message}${stderr ? ' :: ' + stderr.slice(0, 300) : ''}`))
      resolve({ stdout: stdout || '', stderr: stderr || '' })
    })
  })
}

/**
 * Run the FPM orphan sweep on the WHM box.
 * @param {{confirm?: boolean}} opts
 * @returns {Promise<{ok:boolean, host?:string, orphans:Array, removed:Array, masters:Array, raw?:string, error?:string}>}
 */
async function sweep({ confirm = false } = {}) {
  try {
    const { stdout } = await ssh(remoteScript(confirm))
    const line = stdout.split('\n').find(l => l.startsWith('SWEEP_JSON:'))
    if (!line) return { ok: false, error: 'no SWEEP_JSON in output', orphans: [], removed: [], masters: [], raw: stdout.slice(0, 500) }
    const data = JSON.parse(line.slice('SWEEP_JSON:'.length))
    const allActive = (data.masters || []).every(m => m.state === 'active')
    return { ok: allActive, ...data }
  } catch (e) {
    return { ok: false, error: e.message, orphans: [], removed: [], masters: [] }
  }
}

module.exports = { sweep }

if (require.main === module) {
  const CONFIRM = process.argv.includes('--confirm')
  console.log(`[FPM-Sweep] ${USER}@${HOST}  mode=${CONFIRM ? 'CONFIRM (prune+rebuild+restart)' : 'DRY-RUN'}\n`)
  sweep({ confirm: CONFIRM }).then(r => {
    if (r.error && !r.host) { console.error('❌ sweep failed:', r.error); process.exit(1) }
    console.log(`host: ${r.host}`)
    console.log(`orphan pools found: ${r.orphans.length}`)
    r.orphans.forEach(o => console.log(`   ${o.conf}  ->  ${o.chdir} (MISSING)`))
    if (CONFIRM) {
      console.log(`removed: ${r.removed.length}${r.backup ? '  (backup: ' + r.backup + ')' : ''}`)
      r.removed.forEach(f => console.log(`   rm ${f}`))
    }
    console.log('FPM masters:')
    r.masters.forEach(m => console.log(`   ${m.v}: ${m.state}${m.state !== 'active' ? '  ⚠️' : ''}`))
    console.log(`\n${r.ok ? '✅ all FPM masters active' : '⚠️ one or more masters NOT active'}`)
    if (!CONFIRM && r.orphans.length) console.log('\nRe-run with --confirm to prune the orphan pool(s) and rebuild FPM.')
    process.exit(r.ok ? 0 : 2)
  })
}
