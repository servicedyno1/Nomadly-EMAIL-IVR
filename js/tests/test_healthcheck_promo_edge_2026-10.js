// Independent edge-case regression suite covering corners the main tunnel + lift suites don't:
//
//   HealthCheck (hosting-health-check.js):
//     - scanDirectory throws on cpanelresult.error AND on event.result === 0 (never silently empty)
//     - sub-folder scan failure keeps a successful ROOT scan content
//     - reportResults HTML-escapes error messages that contain '<', '>', '&'
//
//   AutoPromo zeroLiftVerdict (auto-promo.js):
//     - "expected exactly 3" boundary (>= 3 → alert)
//     - cooldown expiry after 7 days re-alerts
//     - baseline excludes same theme+slot
//     - different language is isolated (fr baseline doesn't power en verdict)
//
//   Node 20, no network. HealthCheck: stubs axios + anti-red-service via require.cache (same
//   pattern as test_healthcheck_tunnel_2026-10.js). AutoPromo: isolated local Mongo db
//   'autopromo_edge_test' (same pattern as test_promo_lift_metric_2026-06.js).
//
//   Run:  node js/tests/test_healthcheck_promo_edge_2026-10.js

const path = require('path')
const Module = require('module')
const { MongoClient } = require('mongodb')

let pass = 0, fail = 0
const ok = (n, c, x) => {
  if (c) { pass++; console.log(`  ✅ ${n}`) }
  else { fail++; console.log(`  ❌ ${n}${x !== undefined ? ' — ' + (typeof x === 'string' ? x.slice(0, 300) : JSON.stringify(x).slice(0, 300)) : ''}`) }
}

// ─────────────────────────────────────────────────────────────────────
// Part A — hosting-health-check edge cases
// ─────────────────────────────────────────────────────────────────────

const NET = { listfilesResponder: null, telegram: [] }
function whmGet(params) {
  if (params.cpanel_jsonapi_func === 'listfiles' && NET.listfilesResponder) {
    return NET.listfilesResponder(params)
  }
  if (params.cpanel_jsonapi_func === 'get_file_content') {
    return Promise.resolve({ status: 200, data: { result: { status: 0, errors: ['File does not exist'], data: null } } })
  }
  return Promise.resolve({ status: 200, data: {} })
}
function fakeAxios() { return Promise.resolve({ status: 200, data: '<html>' + 'x'.repeat(800) + '</html>', headers: {} }) }
fakeAxios.create = () => ({ get: (_url, { params }) => whmGet(params) })
fakeAxios.post = async (_url, body) => { NET.telegram.push(body); return { data: { ok: true } } }

const AR = { ipFixDeploys: 0 }
const fakeAntiRed = {
  deployCFIPFix: async () => { AR.ipFixDeploys++; return { ok: true } },
  deployHtaccess: async () => ({ ok: true }),
}

function loadHealthCheck(env) {
  for (const k of ['WHM_HOST', 'WHM_TOKEN', 'WHM_API_URL', 'CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET', 'TELEGRAM_DEV_CHAT_ID', 'TELEGRAM_BOT_TOKEN_PROD']) delete process.env[k]
  Object.assign(process.env, env)
  require('axios')
  require.cache[require.resolve('axios')].exports = fakeAxios
  const arPath = path.resolve(__dirname, '../anti-red-service.js')
  require.cache[arPath] = Object.assign(new Module(arPath), { filename: arPath, loaded: true, exports: fakeAntiRed })
  const hcPath = require.resolve('../hosting-health-check')
  delete require.cache[hcPath]
  return require('../hosting-health-check')
}

async function partA() {
  console.log('\n── A1: scanDirectory throws on cpanelresult.error (never silently "empty") ──')
  const hc = loadHealthCheck({ WHM_HOST: '1.2.3.4', WHM_TOKEN: 't', WHM_API_URL: 'https://whm.example/' })
  NET.listfilesResponder = () => Promise.resolve({ status: 200, data: { cpanelresult: { error: 'Access denied for user vabi' } } })
  let threw = null
  try { await hc.scanDirectory('vabi', '/public_html') } catch (e) { threw = e }
  ok('scanDirectory({cpanelresult:{error}}) throws with the error reason', threw && /Access denied/.test(threw.message), threw && threw.message)

  console.log('\n── A2: scanDirectory throws on cpanelresult.event.result === 0 ──')
  NET.listfilesResponder = () => Promise.resolve({ status: 200, data: { cpanelresult: { event: { result: 0, reason: 'Invalid user' } } } })
  threw = null
  try { await hc.scanDirectory('nope', '/public_html') } catch (e) { threw = e }
  ok('scanDirectory({event:{result:0}}) throws with the reason', threw && /Invalid user/.test(threw.message), threw && threw.message)

  console.log('\n── A3: scanDirectory throws on missing cpanelresult envelope ──')
  NET.listfilesResponder = () => Promise.resolve({ status: 200, data: {} })
  threw = null
  try { await hc.scanDirectory('x', '/public_html') } catch (e) { threw = e }
  ok('scanDirectory on malformed response throws "unexpected WHM response"', threw && /unexpected WHM response/.test(threw.message), threw && threw.message)

  console.log('\n── A4: sub-folder scan failure does NOT wipe a successful root scan ──')
  // Root listing: 1 file (index.php) + 1 dir (broken). Broken sub-folder listing fails.
  NET.listfilesResponder = (params) => {
    const rel = String(params.dir).replace('/home/u1/public_html', '').replace(/^\//, '')
    if (rel === '') {
      const list = params.types === 'dir' ? [{ file: 'broken' }] : [{ file: 'index.php' }]
      return Promise.resolve({ status: 200, data: { cpanelresult: { event: { result: 1 }, data: list } } })
    }
    // Any sub-folder listing explodes.
    return Promise.resolve({ status: 200, data: { cpanelresult: { error: 'Permission denied scanning broken/' } } })
  }
  const content = await hc.detectUserContent('u1')
  ok('root content still detected (public_html)', content.location === 'public_html' && content.hasRootIndex === true, content)
  ok('scanErrors counted for failing sub-folder, not swallowed as empty', (content.scanErrors || 0) >= 1, content)
  ok('result has no error field (partial success, not total failure)', !content.error, content)

  console.log('\n── A5: reportResults HTML-escapes an error containing < > & ──')
  const r = {
    issues: [], autoFixes: [], warnings: [],
    checks: {
      originRoot: { status: null, error: 'conn <reset> & ECONNRESET' },
      content: { error: 'listfiles files: <bad> & "oops"' },
      prepend: { error: 'EAI_AGAIN <dns>' },
    },
  }
  const msg = await hc.reportResults('d.example', 'u1', '1', r, 1)
  ok('originRoot error is HTML-escaped (no raw <)', msg.includes('conn &lt;reset&gt; &amp; ECONNRESET') && !/conn <reset>/.test(msg), msg)
  ok('content error is HTML-escaped', msg.includes('listfiles files: &lt;bad&gt; &amp; &quot;oops&quot;') ? true : msg.includes('listfiles files: &lt;bad&gt; &amp;'), msg)
  // Note: _esc currently escapes & < > only (NOT quotes). We accept the real behaviour: & < > escaped.
  ok('prepend error is HTML-escaped', msg.includes('EAI_AGAIN &lt;dns&gt;') && !/EAI_AGAIN <dns>/.test(msg), msg)
  ok('report label uses Site (via Cloudflare tunnel) when WHM_API_URL set', /Site \(via Cloudflare tunnel\)/.test(msg), msg)
}

// ─────────────────────────────────────────────────────────────────────
// Part B — zeroLiftVerdict edge cases
// ─────────────────────────────────────────────────────────────────────

async function partB() {
  // Load auto-promo with harmless env.
  process.env.TELEGRAM_ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID || '999999'
  process.env.TELEGRAM_BOT_ON = 'false'
  // Fresh require (health check already loaded a fake axios into cache; auto-promo doesn't use axios here).
  const { initAutoPromo } = require('../auto-promo.js')

  const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db('autopromo_edge_test')
  await db.collection('promoStats').deleteMany({})
  await db.collection('state').deleteMany({})
  await db.collection('promoTracker').deleteMany({})

  const adminMsgs = []
  const bot = { sendMessage: async (c, t) => { adminMsgs.push({ c, t }); return {} }, getChat: async () => { throw new Error('n/a') } }
  const ap = initAutoPromo(bot, db, db.collection('nameOf'), db.collection('state'), null)

  const SLOT = 'evening'
  const now = Date.now()
  const daysAgo = (d) => new Date(now - d * 86400000)

  async function seedBaseline({ lang = 'en', deliveredEach, returnsEach, blasts, theme = 'other_theme' }) {
    for (let i = 0; i < blasts; i++) {
      await db.collection('promoStats').insertOne({
        theme, lang, slot: SLOT, success: deliveredEach,
        sentAt: daysAgo(1 + i), liftEvaluated: true, liftReturnedUsers: returnsEach, liftRate: 0,
        liftUserIds: new Array(returnsEach).fill(0).map((_, k) => `base_${i}_${k}`),
      })
    }
  }

  // Clean state helper
  async function reset() {
    await db.collection('promoStats').deleteMany({})
    await db.collection('promoTracker').deleteMany({})
  }

  // ── B1: expected == 3 boundary → alert ────────────────────────────
  console.log('\n[B1] expected exactly 3 → ALERT (>= 3)')
  await reset()
  // baseline rate = 3/1000 = 0.003 → delivered 1000 → expected 3.0
  await seedBaseline({ deliveredEach: 1000, returnsEach: 3, blasts: 1, theme: 'other' })
  const zeroDoc1 = await db.collection('promoStats').insertOne({
    theme: 'leads_validation', lang: 'en', slot: SLOT, success: 1000,
    sentAt: new Date(now - 46 * 60 * 1000), liftEvaluated: false, liftUserIds: [], liftHubTapCount: 0, liftStartCount: 0,
  })
  adminMsgs.length = 0
  await ap.evaluateBlastLift(zeroDoc1.insertedId)
  ok('expected == 3 → admin alerted', adminMsgs.some(m => /Zero-lift theme/.test(m.t) && /leads_validation\/en\/evening/.test(m.t)), adminMsgs.map(m => m.t))

  // ── B2: expected 2.999 → NO alert ─────────────────────────────────
  console.log('\n[B2] expected just under 3 → NO alert')
  await reset()
  // 2 returns / 1000 = 0.002 → delivered 1000 → expected 2.0
  await seedBaseline({ deliveredEach: 1000, returnsEach: 2, blasts: 1, theme: 'other' })
  const zeroDoc2 = await db.collection('promoStats').insertOne({
    theme: 'leads_validation', lang: 'en', slot: SLOT, success: 1000,
    sentAt: new Date(now - 46 * 60 * 1000), liftEvaluated: false, liftUserIds: [], liftHubTapCount: 0, liftStartCount: 0,
  })
  adminMsgs.length = 0
  await ap.evaluateBlastLift(zeroDoc2.insertedId)
  ok('expected 2.0 → NOT alerted', !adminMsgs.some(m => /Zero-lift theme/.test(m.t)), adminMsgs.map(m => m.t))

  // ── B3: cooldown expiry — re-alert after 7 days ───────────────────
  console.log('\n[B3] cooldown expiry — alert again 7+ days after a prior alert')
  await reset()
  await seedBaseline({ deliveredEach: 1000, returnsEach: 5, blasts: 1, theme: 'other' })
  // Prior alert 8 days ago
  await db.collection('promoTracker').insertOne({
    _id: `lift_alert_leads_validation_en_${SLOT}`,
    lastAlertAt: new Date(now - 8 * 86400000),
  })
  const zeroDoc3 = await db.collection('promoStats').insertOne({
    theme: 'leads_validation', lang: 'en', slot: SLOT, success: 1000,
    sentAt: new Date(now - 46 * 60 * 1000), liftEvaluated: false, liftUserIds: [], liftHubTapCount: 0, liftStartCount: 0,
  })
  adminMsgs.length = 0
  await ap.evaluateBlastLift(zeroDoc3.insertedId)
  ok('old alert 8d ago → cooldown expired → re-alert', adminMsgs.some(m => /Zero-lift theme/.test(m.t)), adminMsgs.map(m => m.t))
  // Confirm tracker was updated to "now"
  const trk = await db.collection('promoTracker').findOne({ _id: `lift_alert_leads_validation_en_${SLOT}` })
  ok('promoTracker lastAlertAt advanced to within the last minute', trk && (now - new Date(trk.lastAlertAt).getTime()) < 60000, trk)

  // ── B4: cooldown still active — 6 days → no alert ─────────────────
  console.log('\n[B4] cooldown still active (6 days) → NO alert')
  await reset()
  await seedBaseline({ deliveredEach: 1000, returnsEach: 5, blasts: 1, theme: 'other' })
  await db.collection('promoTracker').insertOne({
    _id: `lift_alert_leads_validation_en_${SLOT}`,
    lastAlertAt: new Date(now - 6 * 86400000),
  })
  const zeroDoc4 = await db.collection('promoStats').insertOne({
    theme: 'leads_validation', lang: 'en', slot: SLOT, success: 1000,
    sentAt: new Date(now - 46 * 60 * 1000), liftEvaluated: false, liftUserIds: [], liftHubTapCount: 0, liftStartCount: 0,
  })
  adminMsgs.length = 0
  await ap.evaluateBlastLift(zeroDoc4.insertedId)
  ok('6-day-old alert → cooldown blocks re-alert', !adminMsgs.some(m => /Zero-lift theme/.test(m.t)), adminMsgs.map(m => m.t))

  // ── B5: baseline excludes same theme+slot ─────────────────────────
  console.log('\n[B5] baseline excludes same theme+slot (would otherwise inflate expected)')
  await reset()
  // Other-theme baseline is below threshold on its own (<500 delivered OR 0 returns),
  // but same-theme past blasts have lots of delivered. Those must NOT be used as baseline.
  await seedBaseline({ deliveredEach: 100, returnsEach: 0, blasts: 1, theme: 'other_theme' }) // weak baseline
  // Same theme/slot, previous zero-lift blasts: 3 blasts × 1000 delivered, 0 returns.
  await db.collection('promoStats').insertOne({
    theme: 'leads_validation', lang: 'en', slot: SLOT, success: 1000,
    sentAt: daysAgo(3), liftEvaluated: true, liftReturnedUsers: 0, liftUserIds: [],
  })
  await db.collection('promoStats').insertOne({
    theme: 'leads_validation', lang: 'en', slot: SLOT, success: 1000,
    sentAt: daysAgo(5), liftEvaluated: true, liftReturnedUsers: 0, liftUserIds: [],
  })
  const zeroDoc5 = await db.collection('promoStats').insertOne({
    theme: 'leads_validation', lang: 'en', slot: SLOT, success: 1000,
    sentAt: new Date(now - 46 * 60 * 1000), liftEvaluated: false, liftUserIds: [], liftHubTapCount: 0, liftStartCount: 0,
  })
  adminMsgs.length = 0
  await ap.evaluateBlastLift(zeroDoc5.insertedId)
  // Baseline from other_theme only: 0 returns / 100 delivered → baseRet === 0 or baseDel < 500 → "not enough history"
  ok('same-theme+slot stats excluded from baseline → "not enough history" → no alert', !adminMsgs.some(m => /Zero-lift theme/.test(m.t)), adminMsgs.map(m => m.t))

  // Also verify the current blast is counted together with same-theme history in deliveredTotal
  const d5 = await db.collection('promoStats').findOne({ _id: zeroDoc5.insertedId })
  ok('current blast evaluated (liftEvaluated=true, liftReturnedUsers=0)', d5 && d5.liftEvaluated === true && d5.liftReturnedUsers === 0, d5)

  // ── B6: language isolation — fr baseline must not power an en verdict ─
  console.log('\n[B6] language isolation — FR history does not power EN verdict')
  await reset()
  // Strong FR baseline that WOULD alert if languages leaked.
  await seedBaseline({ lang: 'fr', deliveredEach: 1000, returnsEach: 10, blasts: 1, theme: 'other' })
  // EN has nothing.
  const zeroDoc6 = await db.collection('promoStats').insertOne({
    theme: 'leads_validation', lang: 'en', slot: SLOT, success: 1000,
    sentAt: new Date(now - 46 * 60 * 1000), liftEvaluated: false, liftUserIds: [], liftHubTapCount: 0, liftStartCount: 0,
  })
  adminMsgs.length = 0
  await ap.evaluateBlastLift(zeroDoc6.insertedId)
  ok('FR baseline does not leak into EN verdict → no alert', !adminMsgs.some(m => /Zero-lift theme/.test(m.t)), adminMsgs.map(m => m.t))

  // And confirm the symmetric case: FR with its own strong EN-ish baseline alerts.
  await reset()
  await seedBaseline({ lang: 'fr', deliveredEach: 1000, returnsEach: 10, blasts: 1, theme: 'other' })
  const zeroDoc6b = await db.collection('promoStats').insertOne({
    theme: 'leads_validation', lang: 'fr', slot: SLOT, success: 1000,
    sentAt: new Date(now - 46 * 60 * 1000), liftEvaluated: false, liftUserIds: [], liftHubTapCount: 0, liftStartCount: 0,
  })
  adminMsgs.length = 0
  await ap.evaluateBlastLift(zeroDoc6b.insertedId)
  ok('same strong baseline in FR with FR zero-blast → alerts', adminMsgs.some(m => /Zero-lift theme/.test(m.t) && /\/fr\//.test(m.t)), adminMsgs.map(m => m.t))

  await client.close()
}

;(async () => {
  try {
    await partA()
    await partB()
  } catch (e) {
    console.error('\nFATAL:', e.stack || e.message)
    fail++
  }
  console.log('\n──────────────────────────────')
  console.log(`RESULT: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})()
