// SIP-login reconciler (2026-06): prevents "SIP not registering" complaints.
//
// Root cause it guards against: the carrier migration off Telnyx (blocked) → SignalWire → our own SIP server left a
// subset of ACTIVE calling numbers with an incomplete or stale SIP login (no username/password, a missing or wrong
// server address, or the sipDisabled flag stuck on). SIP-login repair used to run only lazily — when a customer opened
// their number's SIP page or QR — so numbers whose owners never re-triggered that path kept registering against a dead
// host or with credentials our SIP server does not recognise, and the softphone could never REGISTER.
//
// This runs in-process (bot + web share phoneNumbersOf) shortly after boot and hourly after that: every active
// SIP-capable number is brought to a complete, correct login on our own SIP server (via sipLogins.ensure, which also
// fixes a missing/wrong brand domain and clears a stuck sipDisabled). Logins that already work are left untouched.
'use strict'
const sipLogins = require('./sip-logins')
const phoneConfig = require('./phone-config')
const notify = require('./cloudivr-web/notify')

const PERIOD_MS = 60 * 60 * 1000 // hourly
const FIRST_RUN_MS = 60 * 1000 // let boot settle

const sipCapable = (n) => n.status === 'active' && n.capabilities?.voice !== false && n.kind !== 'fax' && !n.faxOnly && phoneConfig.canAccessFeature(n.plan, 'sipCredentials')
const isShort = (u) => /^cv[a-z0-9]{8}$/.test(String(u || ''))
// SIP is a Pro+ feature. Some users on the old $75 plan (plan key "standard") kept SIP because that plan used to
// include Pro features — they are grandfathered and KEEP any login they already have. So this guard only MINTS a
// brand-new login for plans that truly include SIP; lower plans are repaired only when a login already exists, never
// granted one they never had.
const MINT_PLANS = ['pro', 'business']

async function runOnce(phoneNumbersOf, { log, notifyAdmin } = {}) {
  const r = { scanned: 0, repaired: 0, byReason: {}, legacy: 0, noSecret: 0, skippedNoGrant: 0, stillBroken: [] }
  const bump = (k) => { r.byReason[k] = (r.byReason[k] || 0) + 1 }
  for (const d of await phoneNumbersOf.find({ 'val.numbers.status': 'active' }).toArray()) {
    for (const n of d.val?.numbers || []) {
      if (!sipCapable(n)) continue
      r.scanned++
      const user = n.telnyxSipUsername || n.sipUsername
      // Don't hand SIP to a lower-plan number that never had it — only repair existing logins (grandfathered users).
      if (!user && !MINT_PLANS.includes(n.plan)) { r.skippedNoGrant++; continue }
      if (user && !isShort(user)) r.legacy++
      let diff
      try { diff = sipLogins.repairFields(d._id, n) } catch (e) { continue }
      if (!diff) continue
      // repairFields returns null when SIP_SERVER_SECRET is missing — so a diff here means we can act.
      if (!user && !process.env.SIP_SERVER_SECRET) { r.noSecret++; continue }
      for (const k of Object.keys(diff)) bump(k === 'sipDomain' ? 'domain' : /Username|Password|CredentialId/.test(k) ? 'login' : k)
      try {
        await sipLogins.ensure(phoneNumbersOf, d._id, n)
        r.repaired++
      } catch (e) {
        r.stillBroken.push(`${String(d._id).slice(0, 6)} ${n.phoneNumber}: ${e.message}`)
      }
    }
  }
  if (log) log(`[SipReconciler] scanned=${r.scanned} repaired=${r.repaired} legacy=${r.legacy}${r.noSecret ? ` noSecret=${r.noSecret}` : ''} ${JSON.stringify(r.byReason)}`)
  if (notifyAdmin && (r.repaired || r.stillBroken.length || r.noSecret)) {
    const lines = [`🔧 <b>SIP reconciler</b> — ${r.scanned} active SIP numbers checked`]
    if (r.repaired) lines.push(`✅ auto-fixed <b>${r.repaired}</b> (${Object.entries(r.byReason).map(([k, v]) => `${k}:${v}`).join(', ')})`)
    if (r.legacy) lines.push(`ℹ️ ${r.legacy} still on a legacy username (kept — our SIP server still accepts it)`)
    if (r.noSecret) lines.push(`⚠️ ${r.noSecret} could not be fixed — SIP_SERVER_SECRET is not set`)
    if (r.stillBroken.length) lines.push(`❌ ${r.stillBroken.length} failed:\n${r.stillBroken.slice(0, 10).join('\n')}`)
    try { notifyAdmin(lines.join('\n')) } catch (_) {}
  }
  return r
}

function start(phoneNumbersOf, opts = {}) {
  if (!phoneNumbersOf) return
  const run = () => runOnce(phoneNumbersOf, opts).catch(e => opts.log?.(`[SipReconciler] run failed: ${e.message}`))
  setTimeout(run, FIRST_RUN_MS).unref?.()
  setInterval(run, PERIOD_MS).unref?.()
  opts.log?.('[SipReconciler] started (first run in 60s, then hourly)')
}

module.exports = { start, runOnce }
