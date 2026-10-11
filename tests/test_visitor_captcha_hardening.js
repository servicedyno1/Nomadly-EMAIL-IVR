// Validates the Visitor-Captcha architectural fix shipped 2026-02 (Day 3).
//
// Background: verify-navy.com (user @Night_ismine) was flagged by Google
// SafeBrowsing. Initial analysis incorrectly concluded that disabling the
// captcha was a per-user choice with security trade-off. Code re-audit
// revealed the toggle was ALSO ripping out scanner cloaking, honeypots, IP
// bans and WAF — a real architectural bug.
//
//   Fix #1 — Worker code (anti-red-service.js): the `bypass:{domain}` KV
//            flag must NOT short-circuit Step 4 (scanner cloaking) or
//            Steps 1-6 (honeypot, robots, static, scanner score, cookie
//            verification). It only skips the Step 7 challenge page for
//            unknown human traffic.
//   Fix #2 — Bot toggle (_index.js): "Turn OFF Visitor Captcha" must NOT
//            call removeWorkerRoutes(). Only flip the KV bypass and write
//            `val.visitorCaptchaOff=true`.
//   Fix #3 — Enforcer (protection-enforcer.js): remove the `antiRedOff`
//            skip path. Worker route must always be deployed for hosting
//            domains regardless of captcha preference.
//   Fix #4 — One-time legacy migration: heal pre-existing
//            `val.antiRedOff=true` docs by redeploying the worker route
//            and renaming the flag to `visitorCaptchaOff`.
//   Fix #5 — Honest lang text in all 4 locales.
//
// Run with:  node tests/test_visitor_captcha_hardening.js

'use strict'

const fs = require('fs')
const path = require('path')

let passed = 0
let failed = 0
const assert = (cond, name) => {
  if (cond) { console.log(`  ✅ ${name}`); passed++ }
  else { console.log(`  ❌ ${name}`); failed++ }
}

// ── Fix #1: Worker bypass logic ───────────────────────────────────────────
console.log('\nTest A: Worker bypass does NOT short-circuit scanner cloaking')

const antiRedSrc = fs.readFileSync(path.join(__dirname, '..', 'js', 'anti-red-service.js'), 'utf8')

// The old early-return pattern must be gone
assert(!/if \(bypass\) \{\s*\/\/[^\n]*\n\s*\/\/[^\n]*\n\s*const response = await fetch\(request, \{ redirect: 'manual' \}\);\s*const newHeaders = new Headers\(response\.headers\);\s*newHeaders\.set\('X-AntiRed', 'bypassed'\);/.test(antiRedSrc),
  'A.1 old early-return on bypass=true is removed')
// New flag-based pattern must be present
assert(/let challengeBypassed = false;/.test(antiRedSrc),
  'A.2 new `challengeBypassed` flag declared at Step 0b')
assert(/if \(bypass\) challengeBypassed = true;/.test(antiRedSrc),
  'A.3 KV bypass read sets flag instead of returning')
// Scanner cloaking still appears AFTER the bypass check (i.e. it runs even when bypassed)
{
  const bypassIdx = antiRedSrc.indexOf('let challengeBypassed = false;')
  const cloakIdx  = antiRedSrc.indexOf("if (botScore >= 100)")
  assert(bypassIdx > 0 && cloakIdx > bypassIdx,
    `A.4 scanner cloaking (botScore>=100) appears AFTER bypass check (bypassIdx=${bypassIdx}, cloakIdx=${cloakIdx})`)
}
// Step 7 must check the flag
assert(/if \(challengeBypassed\) \{/.test(antiRedSrc),
  'A.5 Step 7 checks `challengeBypassed` flag to decide pass-through vs challenge')
assert(/'X-AntiRed', 'bypassed-challenge'/.test(antiRedSrc),
  'A.6 bypass pass-through tags response with `bypassed-challenge` header for observability')

// ── Fix #2: Bot toggle wiring ─────────────────────────────────────────────
console.log('\nTest B: _index.js toggle no longer calls removeWorkerRoutes / sets antiRedOff')

const idx = fs.readFileSync(path.join(__dirname, '..', 'js', '_index.js'), 'utf8')

// The disable handler must not call removeWorkerRoutes any more
{
  const idxConfirm = idx.indexOf("if (action === 'anti-red-disable-confirm')")
  assert(idxConfirm > 0, 'B.0 anti-red-disable-confirm handler present')
  const slice = idx.slice(idxConfirm, idxConfirm + 2500)
  // Strip comments so we only inspect actual code calls (the explanatory
  // comment mentions "Previously this called removeWorkerRoutes()" — fine).
  const sliceCode = slice.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  assert(!/removeWorkerRoutes/.test(sliceCode),
    'B.1 disable-confirm handler does NOT call removeWorkerRoutes')
  assert(/setDomainChallengeBypass\(domain, true\)/.test(slice),
    'B.2 disable-confirm handler sets KV bypass = true')
  assert(/'val\.visitorCaptchaOff': true/.test(slice),
    'B.3 disable-confirm handler writes new `visitorCaptchaOff` field')
  assert(/'val\.antiRedOff':\s*''/.test(slice),
    'B.4 disable-confirm handler ALSO clears legacy `antiRedOff` field')
}
// Old typed-DISABLE requirement must be gone
assert(!/if \(message !== 'DISABLE'\)/.test(idx),
  'B.5 typed-DISABLE confirm requirement removed (replaced by button confirm)')
// New confirm button must exist
assert(/antiRedConfirmDisable/.test(idx),
  'B.6 _index.js uses `antiRedConfirmDisable` button label')

// Status reads must accept both legacy and new field. The bot now derives the
// captcha on/off state via antiRedService.resolveDomainCfState(...).isOff (the
// SINGLE SOURCE OF TRUTH), and that helper OR-checks BOTH flags.
{
  assert(/resolveDomainCfState\([^)]*\)/.test(idx) && /\.isOff/.test(idx),
    'B.7a _index.js reads captcha state via resolveDomainCfState(...).isOff')
  assert(/result\.isOff = v\.visitorCaptchaOff === true \|\| v\.antiRedOff === true/.test(antiRedSrc),
    'B.7b resolveDomainCfState isOff reads BOTH `visitorCaptchaOff` (current) and `antiRedOff` (legacy)')
}
// AntiRed-Cron loop must NOT skip on antiRedOff
{
  const cronIdx = idx.indexOf('[AntiRed-Cron]')
  const slice = idx.slice(cronIdx - 200, cronIdx + 1500)
  assert(!/if \(val\.antiRedOff === true\) continue/.test(slice),
    'B.8 AntiRed-Cron loop no longer skips antiRedOff=true domains')
}

// ── Fix #3: cpanel-routes.js (HostPanel UI) ───────────────────────────────
console.log('\nTest C: cpanel-routes.js HostPanel disable path stops removing worker routes')

const routes = fs.readFileSync(path.join(__dirname, '..', 'js', 'cpanel-routes.js'), 'utf8')

// Find the captcha-toggle endpoint and check disable branch
{
  // Disable branch should persist the captcha-off preference and NOT call
  // removeWorkerRoutes. Persistence of `val.visitorCaptchaOff` is now
  // centralised in anti-red-service.setDomainChallengeBypass (single source of
  // truth: the KV bypass key + the Mongo flag are written together), so the
  // route delegates to it with (domain, true, db) instead of writing inline.
  const captchaBlock = routes.match(/\/\/ NOTE \(2026-02\): we no longer remove the CF Worker route[\s\S]{0,2500}?(?=router\.|app\.|module\.exports|$)/)
  assert(captchaBlock && /setDomainChallengeBypass\([^,]+,\s*true,\s*[^)]+\)/.test(captchaBlock[0]),
    'C.1 cpanel-routes disable path persists captcha-off via setDomainChallengeBypass(domain, true, db)')
  if (captchaBlock) {
    // Strip comments before checking — the comment legitimately mentions
    // "Previously this called removeWorkerRoutes()" but the code does not.
    const blockCode = captchaBlock[0].replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert(!/removeWorkerRoutes/.test(blockCode),
      'C.2 cpanel-routes disable path does NOT call removeWorkerRoutes')
  } else {
    assert(false, 'C.2 disable block not located')
  }
}
// Single source of truth: setDomainChallengeBypass sets the flag when bypassing
// and clears it (plus the legacy antiRedOff) when re-enabling the challenge.
assert(/'val\.visitorCaptchaOff': true/.test(antiRedSrc),
  'C.3a setDomainChallengeBypass sets `val.visitorCaptchaOff=true` when disabling the challenge')
assert(/\$unset:\s*{\s*'val\.visitorCaptchaOff': ''/.test(antiRedSrc),
  'C.3b setDomainChallengeBypass clears `val.visitorCaptchaOff` when re-enabling the challenge')

// ── Fix #4: legacy migration in protection-enforcer ─────────────────────
console.log('\nTest D: protection-enforcer exports runLegacyAntiRedOffMigration')

// Stub anti-red-service so deploySharedWorkerRoute is a no-op
const antiRedPath = require.resolve('../js/anti-red-service')
const deployCalls = []
const bypassCalls = []
require.cache[antiRedPath] = {
  id: antiRedPath, filename: antiRedPath, loaded: true,
  exports: {
    deploySharedWorkerRoute: async (domain, zoneId) => { deployCalls.push({ domain, zoneId }); return { success: true } },
    setDomainChallengeBypass: async (domain, b) => { bypassCalls.push({ domain, bypass: b }); return { success: true } },
  },
}

delete require.cache[require.resolve('../js/protection-enforcer')]
const enforcer = require('../js/protection-enforcer')
assert(typeof enforcer.runLegacyAntiRedOffMigration === 'function',
  'D.1 runLegacyAntiRedOffMigration exported')
assert(typeof enforcer.runAntiRedAutoReenable === 'undefined',
  'D.2 old runAntiRedAutoReenable export removed')

// In-memory Mongo with three test docs
function makeDb(docs) {
  const map = new Map(docs.map((d) => [d._id, d]))
  return {
    collection: (n) => ({
      find: (q) => ({
        toArray: async () => {
          const out = []
          for (const d of map.values()) {
            if (n !== 'registeredDomains') continue
            if (q && q['val.antiRedOff'] === true && d.val?.antiRedOff !== true) continue
            out.push(d)
          }
          return out
        },
      }),
      findOne: async (q) => {
        if (n === 'users') return null
        return map.get(q._id) || null
      },
      updateOne: async (q, upd) => {
        const cur = map.get(q._id)
        if (!cur) return { acknowledged: true }
        if (upd.$set) {
          for (const k of Object.keys(upd.$set)) {
            const parts = k.split('.')
            let obj = cur
            for (let i = 0; i < parts.length - 1; i++) {
              if (!obj[parts[i]]) obj[parts[i]] = {}
              obj = obj[parts[i]]
            }
            obj[parts[parts.length - 1]] = upd.$set[k]
          }
        }
        if (upd.$unset) {
          for (const k of Object.keys(upd.$unset)) {
            const parts = k.split('.')
            let obj = cur
            for (let i = 0; i < parts.length - 1; i++) obj = obj?.[parts[i]]
            if (obj) delete obj[parts[parts.length - 1]]
          }
        }
        return { acknowledged: true }
      },
    }),
    _docs: map,
  }
}

;(async () => {
  // Build 2 legacy docs + 1 already-migrated
  const docs = [
    { _id: 'legacy-with-zone.com',    val: { antiRedOff: true, antiRedOffAt: new Date(), cfZoneId: 'zoneA', ownerChatId: 111 } },
    { _id: 'legacy-no-zone.com',      val: { antiRedOff: true } },
    { _id: 'already-migrated.com',    val: { visitorCaptchaOff: true, cfZoneId: 'zoneC' } },
  ]
  const db = makeDb(docs)
  enforcer.init(db)

  const r = await enforcer.runLegacyAntiRedOffMigration()
  assert(r.processed === 2, `D.3 processed 2 legacy docs — got ${r.processed}`)
  assert(r.migrated === 2,  `D.4 migrated 2 docs — got ${r.migrated}`)
  assert(r.errors === 0,    `D.5 no errors — got ${r.errors}`)

  // Verify worker was redeployed for the one with a zone
  assert(deployCalls.some((c) => c.domain === 'legacy-with-zone.com' && c.zoneId === 'zoneA'),
    `D.6 deploySharedWorkerRoute called for legacy-with-zone.com`)
  // Verify NOT called for no-zone doc
  assert(!deployCalls.some((c) => c.domain === 'legacy-no-zone.com'),
    `D.7 deploy NOT called for legacy-no-zone.com (no cfZoneId)`)
  // Bypass preserved for the one with a zone
  assert(bypassCalls.some((c) => c.domain === 'legacy-with-zone.com' && c.bypass === true),
    `D.8 setDomainChallengeBypass(domain, true) called — user preference preserved`)

  // Verify field migration
  const d1 = db._docs.get('legacy-with-zone.com')
  assert(d1.val.visitorCaptchaOff === true, `D.9  legacy-with-zone.com renamed to visitorCaptchaOff`)
  assert(d1.val.antiRedOff   === undefined, `D.10 legacy-with-zone.com antiRedOff field cleared`)
  assert(d1.val.antiRedOffAt === undefined, `D.11 legacy-with-zone.com antiRedOffAt field cleared`)

  const d2 = db._docs.get('legacy-no-zone.com')
  assert(d2.val.visitorCaptchaOff === true, `D.12 legacy-no-zone.com renamed to visitorCaptchaOff`)
  assert(d2.val.antiRedOff   === undefined, `D.13 legacy-no-zone.com antiRedOff field cleared`)

  // Re-run: idempotent
  const r2 = await enforcer.runLegacyAntiRedOffMigration()
  assert(r2.processed === 0, `D.14 second run finds no candidates (idempotent)`)

  // ── Fix #5: honest lang text ────────────────────────────────────────────
  console.log('\nTest E: honest lang text — no more "all scanner blocking is OFF" claims')

  const langs = ['en', 'fr', 'hi', 'zh']
  // Old scary text that falsely claimed everything was off
  const oldFalseClaims = [
    /All Cloudflare edge-level scanner blocking is currently OFF/i,
    /Tout le blocage des scanners au niveau du bord Cloudflare est désactivé/i,
    /सभी Cloudflare एज-स्तर स्कैनर ब्लॉकिंग बंद है/,
    /此域名的所有 Cloudflare 边缘级扫描器拦截目前已关闭/,
  ]
  // New accurate text claiming scanner cloaking IS still active
  const stillActiveClaims = [
    /Anti-Red protection remains fully active/i,
    /protection Anti-Red reste totalement active/i,
    /Anti-Red सुरक्षा पूरी तरह सक्रिय/,
    /Anti-Red 保护完全有效/,
  ]
  for (let i = 0; i < langs.length; i++) {
    const lang = langs[i]
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'lang', `${lang}.js`), 'utf8')
    assert(!oldFalseClaims[i].test(src), `E.${lang}.1 old "all scanner blocking is OFF" claim removed`)
    assert(stillActiveClaims[i].test(src), `E.${lang}.2 new "Anti-Red remains active" disclosure present`)
    assert(/antiRedConfirmDisable/.test(src), `E.${lang}.3 antiRedConfirmDisable button label added`)
    assert(/antiRedRestoredNote/.test(src), `E.${lang}.4 antiRedRestoredNote present (migration notification)`)
  }

  console.log(`\nResults: ${passed} passed, ${failed} failed`)
  process.exit(failed === 0 ? 0 : 1)
})().catch((e) => { console.error('runner crash:', e); process.exit(2) })
