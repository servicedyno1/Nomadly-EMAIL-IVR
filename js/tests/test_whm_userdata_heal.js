/**
 * Unit tests for the WHM userdata self-heal helper (2026-08-29 fix).
 *
 * Covers:
 *   1. `isStaleUserdataError` — matcher (positive + negative)
 *   2. `attemptStaleTerminate` — success clears flag; failure increments retry;
 *      never touches live rows.
 *   3. `attemptUserdataRelease` — same-chatId release works; cross-user release
 *      REFUSED; no-stale-row returns released:false.
 *   4. `runSelfHealSweep` — walks whmTerminatePending rows and clears the ones
 *      WHM confirms; leaves the still-stuck ones flagged.
 *   5. Static wiring guards — hosting-scheduler / addon-domain-flow / _index.js
 *      each reference `whm-userdata-heal` (and, for the scheduler, set
 *      `whmTerminatePending: true` when /removeacct returns false).
 *
 * All Mongo I/O uses an in-process fake collection (no real DB touched).
 */

const fs = require('fs')
const path = require('path')
const assert = require('assert')

let pass = 0, fail = 0
function ok(name, cond, extra = '') {
  if (cond) { console.log(`  ✅ ${name}`); pass++ }
  else { console.log(`  ❌ ${name}${extra ? ' — ' + extra : ''}`); fail++ }
}

// ── in-process Mongo-ish fake for cpanelAccounts ──
function makeFakeCol(seedRows = []) {
  const rows = seedRows.map(r => ({ ...r }))
  const matchQuery = (row, q) => {
    for (const [k, v] of Object.entries(q)) {
      if (k === '$or') {
        const anyMatch = v.some(sub => matchQuery(row, sub))
        if (!anyMatch) return false
        continue
      }
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('$ne' in v && row[k] === v.$ne) return false
        if ('$exists' in v) {
          const has = row[k] !== undefined
          if (has !== v.$exists) return false
        }
        // extra ops as needed
        continue
      }
      if (Array.isArray(row[k])) {
        if (!row[k].includes(v)) return false
      } else if (row[k] !== v) return false
    }
    return true
  }
  return {
    _rows: rows,
    async findOne(q) { return rows.find(r => matchQuery(r, q)) || null },
    async updateOne(q, upd) {
      const row = rows.find(r => matchQuery(r, q))
      if (!row) return { matchedCount: 0 }
      if (upd.$set) Object.assign(row, upd.$set)
      if (upd.$unset) for (const k of Object.keys(upd.$unset)) delete row[k]
      if (upd.$inc) for (const [k, v] of Object.entries(upd.$inc)) row[k] = (row[k] || 0) + v
      return { matchedCount: 1 }
    },
    find(q) {
      const list = rows.filter(r => matchQuery(r, q))
      return { limit: () => ({ toArray: async () => list }), toArray: async () => list }
    },
  }
}
function makeFakeDb(cpanelAccountsFake) {
  return { collection: name => (name === 'cpanelAccounts' ? cpanelAccountsFake : null) }
}
function makeWhmStub({ terminate, live }) {
  return {
    terminateAccount: async (cpUser) => (terminate ? terminate(cpUser) : true),
    // live = array of cpUsers currently present on WHM (for runSelfHealSweep)
    listAccounts: async () => (Array.isArray(live) ? live.map(u => ({ user: u })) : []),
  }
}

const heal = require('../whm-userdata-heal')

console.log('=== (1) isStaleUserdataError ===')
ok('positive: raw cPanel message', heal.isStaleUserdataError('The domain "secure-resolvedesk.click" already exists in the userdata'))
ok('positive: lowercase', heal.isStaleUserdataError('domain already exists in the userdata'))
ok('positive: bare "already exists" also matches (defensive)',
  heal.isStaleUserdataError('The domain example.com already exists'))
ok('negative: unrelated error', !heal.isStaleUserdataError('WHM unreachable'))
ok('negative: empty', !heal.isStaleUserdataError('') && !heal.isStaleUserdataError(null) && !heal.isStaleUserdataError(undefined))

console.log('\n=== (2) attemptStaleTerminate ===')
;(async () => {
  const col = makeFakeCol([
    { _id: 'stale1', cpUser: 'stale1', chatId: '1', domain: 'foo.com', deleted: true, whmTerminatePending: true, whmTerminateRetryCount: 0 },
    { _id: 'live1', cpUser: 'live1', chatId: '2', domain: 'bar.com', deleted: false },
    { _id: 'clean1', cpUser: 'clean1', chatId: '3', domain: 'baz.com', deleted: true }, // deleted, historical (pre-fix), no pending flag — should still be retried
    { _id: 'done1', cpUser: 'done1', chatId: '4', domain: 'qux.com', deleted: true, terminatedOnWhm: true }, // already confirmed cleared — no-op
  ])
  const db = makeFakeDb(col)

  // Case A: /removeacct succeeds → row cleared + terminatedOnWhm true
  let r = await heal.attemptStaleTerminate({
    db, whmService: makeWhmStub({ terminate: async () => true }),
    account: await col.findOne({ _id: 'stale1' }),
  })
  ok('A: success returns { ok, cleared:true }', r.ok && r.cleared === true)
  const stale1 = await col.findOne({ _id: 'stale1' })
  ok('A: whmTerminatePending unset after success', stale1.whmTerminatePending === undefined)
  ok('A: terminatedOnWhm set', stale1.terminatedOnWhm === true)
  ok('A: whmTerminateRetryCount cleared', stale1.whmTerminateRetryCount === undefined)

  // Case B: /removeacct still fails → whmTerminateRetryCount increments
  col._rows.push({ _id: 'stuck1', cpUser: 'stuck1', chatId: '1', domain: 'stuck.com', deleted: true, whmTerminatePending: true, whmTerminateRetryCount: 0 })
  r = await heal.attemptStaleTerminate({
    db, whmService: makeWhmStub({ terminate: async () => false }),
    account: await col.findOne({ _id: 'stuck1' }),
  })
  ok('B: failure returns { ok:false, retriesUsed:1 }', r.ok === false && r.retriesUsed === 1)
  const stuck1 = await col.findOne({ _id: 'stuck1' })
  ok('B: still marked pending after failed retry', stuck1.whmTerminatePending === true)
  ok('B: retry count incremented', stuck1.whmTerminateRetryCount === 1)

  // Case C: NEVER retry a live account (deleted:false)
  r = await heal.attemptStaleTerminate({
    db, whmService: makeWhmStub({ terminate: async () => { throw new Error('BOOM should never be called') } }),
    account: await col.findOne({ _id: 'live1' }),
  })
  ok('C: refuses to touch live account (deleted:false)', r.ok === false && r.reason === 'not-deleted')

  // Case D (updated semantics): historical stuck row (deleted:true, NO pending flag)
  // SHOULD now be retried (before the fix, this was skipped, which permanently
  // stranded every legit user's pre-fix stuck domains).
  r = await heal.attemptStaleTerminate({
    db, whmService: makeWhmStub({ terminate: async () => true }),
    account: await col.findOne({ _id: 'clean1' }),
  })
  ok('D: historical stuck row (no pending flag) IS retried + cleared', r.ok === true && r.cleared === true)
  const clean1After = await col.findOne({ _id: 'clean1' })
  ok('D: historical row now has terminatedOnWhm:true', clean1After.terminatedOnWhm === true)

  // Case D2: already-cleared row (terminatedOnWhm:true) is a no-op — no WHM call.
  r = await heal.attemptStaleTerminate({
    db, whmService: makeWhmStub({ terminate: async () => { throw new Error('BOOM should never call WHM for already-terminated row') } }),
    account: await col.findOne({ _id: 'done1' }),
  })
  ok('D2: terminatedOnWhm:true short-circuits (no WHM call)', r.ok === true && r.cleared === false && r.reason === 'already-terminated')

  console.log('\n=== (3) attemptUserdataRelease ===')

  const col2 = makeFakeCol([
    { _id: 'oldA', cpUser: 'oldA', chatId: '100', domain: 'primarya.com', addonDomains: ['addona.com', 'stucka.com'], deleted: true, whmTerminatePending: true, whmTerminateRetryCount: 0 },
    { _id: 'otherusr', cpUser: 'otherusr', chatId: '200', domain: 'someoneelse.com', deleted: true, whmTerminatePending: true },
  ])
  const db2 = makeFakeDb(col2)

  // E: SAME chatId → release proceeds and succeeds
  r = await heal.attemptUserdataRelease({
    db: db2, whmService: makeWhmStub({ terminate: async () => true }),
    domain: 'stucka.com', chatId: '100',
  })
  ok('E: same-chatId → released:true', r.released === true && r.staleCpUser === 'oldA')

  // F: DIFFERENT chatId → refused (no cross-user release)
  r = await heal.attemptUserdataRelease({
    db: db2, whmService: makeWhmStub({ terminate: async () => { throw new Error('BOOM cross-user') } }),
    domain: 'someoneelse.com', chatId: '999',
  })
  ok('F: cross-user attempt REFUSED (never called WHM)', r.released === false && r.reason === 'no-stale-owner-under-same-chatid')

  // G: no stale row → refused gracefully
  r = await heal.attemptUserdataRelease({
    db: db2, whmService: makeWhmStub({ terminate: async () => true }),
    domain: 'nothing.example', chatId: '100',
  })
  ok('G: no-stale-owner → released:false', r.released === false && r.reason === 'no-stale-owner-under-same-chatid')

  // H: missing args → defensive false
  r = await heal.attemptUserdataRelease({})
  ok('H: missing args → released:false', r.released === false && r.reason === 'missing-args')

  console.log('\n=== (4) runSelfHealSweep (reclaim + reconcile) ===')
  const col3 = makeFakeCol([
    { _id: 'a', cpUser: 'a', chatId: '1', domain: 'a.com', deleted: true, whmTerminatePending: true, whmTerminateRetryCount: 0 }, // on WHM, terminates OK → cleared
    { _id: 'b', cpUser: 'b', chatId: '2', domain: 'b.com', deleted: true, whmTerminatePending: true, whmTerminateRetryCount: 0 }, // on WHM, terminate fails → stillPending
    { _id: 'c', cpUser: 'c', chatId: '3', domain: 'c.com', deleted: false /* live account — never a candidate */ },
    { _id: 'd', cpUser: 'd', chatId: '4', domain: 'd.com', deleted: true /* NO pending flag, already GONE from WHM → reconciled */ },
    { _id: 'e', cpUser: 'e', chatId: '5', domain: 'e.com', deleted: true /* NO pending flag, still ON WHM (false-success class) → terminated */ },
  ])
  const db3 = makeFakeDb(col3)

  // WHM currently has a, b, e (not d — already gone). terminate: a & e succeed, b fails.
  const summary = await heal.runSelfHealSweep({
    db: db3,
    whmService: makeWhmStub({ live: ['a', 'b', 'e'], terminate: async (cpUser) => cpUser === 'a' || cpUser === 'e' }),
  })
  ok('sweep scanned 4 deleted-not-terminated rows (c excluded)', summary.scanned === 4)
  ok('sweep terminated 2 (a + historical e)', summary.cleared === 2)
  ok('sweep reconciled 1 already-gone (d)', summary.reconciled === 1)
  ok('sweep stillPending 1 (b)', summary.stillPending === 1)
  const aAfter = await col3.findOne({ _id: 'a' })
  const bAfter = await col3.findOne({ _id: 'b' })
  const dAfter = await col3.findOne({ _id: 'd' })
  const eAfter = await col3.findOne({ _id: 'e' })
  ok('a cleared (terminatedOnWhm=true, pending unset)', aAfter.terminatedOnWhm === true && aAfter.whmTerminatePending === undefined)
  ok('b still pending (retryCount 1)', bAfter.whmTerminatePending === true && bAfter.whmTerminateRetryCount === 1)
  ok('d reconciled (gone from WHM → terminatedOnWhm true, reconciled flag)', dAfter.terminatedOnWhm === true && dAfter.whmTerminateReconciled === true)
  ok('e (historical false-success) reclaimed → terminatedOnWhm true', eAfter.terminatedOnWhm === true)

  // Deferral: if WHM is unreachable, make NO changes and report deferred.
  const col4 = makeFakeCol([
    { _id: 'x', cpUser: 'x', chatId: '9', domain: 'x.com', deleted: true },
  ])
  const summary2 = await heal.runSelfHealSweep({
    db: makeFakeDb(col4),
    whmService: { terminateAccount: async () => true, listAccounts: async () => { throw new Error('WHM down') } },
  })
  ok('sweep defers when listAccounts throws', summary2.deferred === true)
  const xAfter = await col4.findOne({ _id: 'x' })
  ok('deferred sweep made NO changes', xAfter.terminatedOnWhm === undefined)

  console.log('\n=== (5) static wiring guards ===')
  const slurp = rel => fs.readFileSync(path.join('/app', rel), 'utf8')
  const sched = slurp('js/hosting-scheduler.js')
  ok('scheduler: hourly-check captures terminated + sets whmTerminatePending on false',
    /const terminated = await terminateAccount\(account\.cpUser\)[\s\S]{0,1200}if \(!terminated\) \{[\s\S]{0,500}whmTerminatePending\s*=\s*true/.test(sched))
  ok('scheduler: startup-enforce also sets whmTerminatePending on /removeacct failure',
    /updateFields2\s*=\s*\{[\s\S]{0,120}deleted: true[\s\S]{0,500}if \(!terminated\)[\s\S]{0,200}whmTerminatePending\s*=\s*true/.test(sched))
  ok('scheduler: self-heal sweep is registered (setInterval on healInterval) — production-gated',
    /if \(_healEnabled\)[\s\S]{0,500}healInterval = setInterval\(safeRunSelfHeal, CHECK_INTERVAL_MS\)/.test(sched))
  ok('scheduler: self-heal sweep gated by BOT_ENVIRONMENT=production (matches CF-Sync / AntiRed pattern)',
    /BOT_ENVIRONMENT[\s\S]{0,80}=== 'production'/.test(sched))
  ok('scheduler: notifyAdmin helper reads TELEGRAM_ADMIN_CHAT_ID',
    /function notifyAdmin\([\s\S]{0,300}TELEGRAM_ADMIN_CHAT_ID/.test(sched))

  const addon = slurp('js/addon-domain-flow.js')
  ok('addon-flow: imports whm-userdata-heal',
    /require\('\.\/whm-userdata-heal'\)/.test(addon))
  ok('addon-flow: uses isStaleUserdataError on the cpanel reject reason',
    /heal\.isStaleUserdataError\(errMsg\)/.test(addon))
  ok('addon-flow: calls attemptUserdataRelease with the SAME chatId (never cross-user)',
    /heal\.attemptUserdataRelease\(\{[\s\S]{0,300}chatId: account\.chatId,/.test(addon))
  ok('addon-flow: retries cpProxy.addAddonDomain after successful release',
    /if \(release\.released\)[\s\S]{0,400}result = await cpProxy\.addAddonDomain\(/.test(addon))

  const idx = slurp('js/_index.js')
  ok('_index.js change-primary: imports whm-userdata-heal near the ChangePrimary log',
    /require\('\.\/whm-userdata-heal'\)[\s\S]{0,600}\[ChangePrimary\] userdata self-heal/.test(idx))
  ok('_index.js change-primary: retries changePrimaryDomain after successful release',
    /if \(release\.released\)[\s\S]{0,400}result = await whmService\.changePrimaryDomain\(plan\.cpUser, candidate\)/.test(idx))
  ok('_index.js change-primary: passes SAME chatId to attemptUserdataRelease',
    /heal\.attemptUserdataRelease\(\{[\s\S]{0,300}chatId: String\(chatId\),/.test(idx))

  console.log('\n=== summary ===')
  console.log(`  PASS: ${pass}`)
  console.log(`  FAIL: ${fail}`)
  process.exit(fail === 0 ? 0 : 1)
})().catch(e => { console.error('fatal', e); process.exit(1) })
