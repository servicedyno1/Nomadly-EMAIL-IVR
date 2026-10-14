// Late RDP build-failure refunds, re-checked RDP renewal pricing, customer back-in-stock alerts,
// reseller *.back_in_stock webhooks and preview/production job isolation (2026-10-14 owner requirements).
// FAKE DigitalOcean (axios stubbed), isolated local MongoDB DB, in-process reseller API + webhook receiver.
//   node js/tests/test_late_refund_stock_alerts_2026-10.js
const http = require('http')
const net = require('net')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
process.env.DIGITALOCEAN_API_TOKEN = 'test-token'
process.env.NODE_ENV = 'test'
process.env.VPS_RDP_PROVIDER = 'digitalocean-rdp'
process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
process.env.RESELLER_API_LIVE = 'true'
process.env.RESELLER_PROVISION_WORKER_MS = '15000'
process.env.DO_RDP_GOLDEN_AUTOSYNC = 'false'
process.env.SKIP_WEBHOOK_SYNC = 'true' // this suite plays the PREVIEW pod
delete process.env.RESELLER_PROVISION_WORKER
delete process.env.RESELLER_JOB_ENV
const { MongoClient } = require('mongodb')

// ── Fake DigitalOcean ──
const CAT = { sizes: [], regions: [], images: [] }
const deleted = []
const doCalls = []
async function fakeDO(cfg) {
  const m = String(cfg.method || 'get').toUpperCase()
  const u = String(cfg.url || '').replace(/^https:\/\/api\.digitalocean\.com\/v2/, '')
  doCalls.push({ m, u })
  if (m === 'GET' && u.startsWith('/sizes')) return { status: 200, data: { sizes: CAT.sizes, links: {} } }
  if (m === 'GET' && u.startsWith('/regions')) return { status: 200, data: { regions: CAT.regions } }
  if (m === 'GET' && u.startsWith('/images')) return { status: 200, data: { images: CAT.images } }
  if (m === 'POST' && u.startsWith('/account/keys')) return { status: 201, data: { ssh_key: { id: 4242, name: 'reseller-key', fingerprint: 'aa:bb' } } }
  if (m === 'DELETE' && u.startsWith('/droplets/')) { deleted.push(u.split('/')[2]); return { status: 204, data: {} } }
  return { status: 404, data: { message: `fake DO: no route ${m} ${u}` } }
}
const axiosPath = require.resolve('axios')
const realAxios = require('axios')
function stubAxios(cfg) { return /digitalocean\.com/.test(String(cfg && cfg.url)) ? fakeDO(cfg) : realAxios(cfg) }
Object.assign(stubAxios, realAxios)
stubAxios.create = (defaults = {}) => ({ defaults, interceptors: { request: { use() {} }, response: { use() {} } }, request: async (cfg) => fakeDO({ ...cfg, url: (defaults.baseURL || '') + cfg.url }) })
require.cache[axiosPath].exports = stubAxios

const sizeCatalog = require('../do-size-catalog')
const rdp = require('../digitalocean-rdp-service')
const stockWatch = require('../do-stock-watch')
const stockAlerts = require('../do-stock-alerts')
const webhooks = require('../reseller-webhooks')
const { atomicIncrement } = require('../db')
const { translation } = require('../translation')
const { createResellerApi } = require('../reseller-api')
const LANGS = { en: require('../lang/en.js').en, fr: require('../lang/fr.js').fr, hi: require('../lang/hi.js').hi, zh: require('../lang/zh.js').zh }

const indexSrc = fs.readFileSync(path.join(__dirname, '../_index.js'), 'utf8')
const grab = (re) => { const m = indexSrc.match(re); if (!m) throw new Error(`not found in _index.js: ${re}`); return m[0] }
const req2 = (m) => require(m.startsWith('./') ? path.join(__dirname, '..', m) : m)

let pass = 0, fail = 0
const ok = (n, c, x) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${x !== undefined ? ' — ' + (typeof x === 'string' ? x : JSON.stringify(x)) : ''}`) } }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
async function waitFor(fn, ms = 10000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(100) } return false }

CAT.regions = [['nyc1', 'New York 1'], ['nyc2', 'New York 2'], ['nyc3', 'New York 3'], ['sfo3', 'San Francisco 3'], ['tor1', 'Toronto 1'], ['lon1', 'London 1'], ['fra1', 'Frankfurt 1'],
  ['ams3', 'Amsterdam 3'], ['blr1', 'Bangalore 1'], ['sgp1', 'Singapore 1'], ['syd1', 'Sydney 1']].map(([slug, name]) => ({ slug, name, available: true }))
const S = (slug, vcpus, gb, disk, price, regions, description) => ({ slug, vcpus, memory: gb * 1024, disk, price_monthly: price, description, available: true, regions })
const ALL_BUT_NY = ['sfo3', 'lon1', 'fra1', 'ams3', 'blr1', 'sgp1', 'syd1']
const EVERYWHERE = ['nyc1', 'nyc2', 'nyc3', ...ALL_BUT_NY]
const AMD = (rs) => [S('s-2vcpu-4gb-amd', 2, 4, 80, 28, rs, 'Basic AMD'), S('s-4vcpu-8gb-amd', 4, 8, 160, 56, rs, 'Basic AMD'), S('s-8vcpu-16gb-amd', 8, 16, 320, 112, rs, 'Basic AMD')]
const BASIC = (rs) => [S('s-2vcpu-4gb', 2, 4, 80, 24, rs, 'Basic')]
const PRICEY = (price, rs = ['nyc1']) => S('s-2vcpu-4gb-160gb-amd', 2, 4, 160, price, rs, 'Basic AMD')
async function setCatalog(sizes) { CAT.sizes = sizes; await sizeCatalog.refresh({ force: true }) }

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db(`test_late_refund_${Date.now()}`)
  const hooks = []
  const receiver = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { hooks.push({ path: req.url, ...JSON.parse(b) }) } catch (_) {} res.end('ok') }) })
  await new Promise(r => receiver.listen(0, r))
  const hookUrl = (p) => `http://127.0.0.1:${receiver.address().port}${p}`
  const servers = []
  const realLog = console.log
  try {
    sizeCatalog.init(db, { autoRefresh: false })
    await setCatalog([...AMD(EVERYWHERE), ...BASIC(EVERYWHERE)])

    // ── Bot handler, evaluated from the exact _index.js source with test doubles for its globals ──
    const sent = [], adminMsgs = []
    const plans = db.collection('vpsPlansOf'), walletOf = db.collection('walletOf'), state = db.collection('state')
    const handleRdpOrderFailed = new Function('require', 'vpsPlansOf', 'walletOf', 'atomicIncrement', 'state', 'getBalance', 'fetchRegionsWithStock', 'send', 'translation', 'notifyAdmin',
      grab(/const handleRdpOrderFailed = [\s\S]*?\n\}\)\n/) + '\nreturn handleRdpOrderFailed')(
      req2, plans, walletOf, atomicIncrement, state,
      async (w, id) => { const d = await w.findOne({ _id: String(id) }); return { usdBal: (d?.usdIn || 0) - (d?.usdOut || 0) } },
      async () => ['🇩🇪 Germany (Frankfurt)', '🇬🇧 United Kingdom (London)'],
      (chatId, text, opts) => sent.push({ chatId: String(chatId), text, opts }), translation, (m) => adminMsgs.push(m))
    rdp.init(db, { notifyAdmin: () => {}, onOrderFailed: (ctx) => handleRdpOrderFailed(ctx) })
    const srvCol = db.collection('doRdpServers')
    const app = require('express')(); app.use(require('express').json())
    app.use('/provision', rdp.provisionRouter())
    const probe = await new Promise(r => { const s = app.listen(0, () => r(s)) }); servers.push(probe)
    const callback = (server_id, token, body) => fetch(`http://127.0.0.1:${probe.address().port}/provision/callback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ server_id, token, ...body }) }).then(r => r.status)
    const bal = async (id) => { const w = await walletOf.findOne({ _id: id }); return Math.round(((w?.usdIn || 0) - (w?.usdOut || 0)) * 100) / 100 }
    const mins = (n) => new Date(Date.now() - n * 60000)
    async function order({ chatId, status = 'RUNNING', ageMin = 40, paidUsd = 56, planPrice = 56, extra = {}, server = {} }) {
      const sid = crypto.randomUUID(), token = crypto.randomBytes(8).toString('hex')
      await srvCol.insertOne({ server_id: sid, callback_token: token, tier_slug: 'standard', os_id: 'ws2022', region: 'nyc1', requested_region: 'nyc3', do_size_slug: 's-2vcpu-4gb-amd', do_monthly_cost: 28,
        status: 'converting', progress: 40, logs: [], created_at: mins(ageMin), activated_at: null, do_droplet_id: 9000 + Math.floor(Math.random() * 999), refund_on_failure: true, ...server })
      await plans.insertOne({ chatId, contaboInstanceId: `rdp-${sid}`, vpsId: `rdp-${sid}`, isRDP: true, provider: 'digitalocean-rdp', status, planPrice, paidUsd, timestamp: mins(ageMin), start_time: mins(ageMin), ...extra })
      if (!(await walletOf.findOne({ _id: chatId }))) await walletOf.insertOne({ _id: chatId, usdIn: 100, usdOut: 56 })
      return { sid, token, ext: `rdp-${sid}` }
    }

    // ── 1. A late failure (40 min in, purchase flow long finished) → ONE refund + customer + admin notice ──
    console.log('\n── 1: late RDP build failure → one wallet refund, droplet removed, customer + admin told ──')
    await state.insertOne({ _id: '7001', userLanguage: 'fr' })
    const o1 = await order({ chatId: '7001' })
    ok('Windows conversion reports failed via the on-droplet callback', (await callback(o1.sid, o1.token, { stage: 'failed', message: 'Windows setup crashed (unattend error).' })) === 200)
    await waitFor(async () => (await bal('7001')) === 100)
    const rec1 = await plans.findOne({ contaboInstanceId: o1.ext })
    ok('wallet refunded the paid $56 (balance 44 → 100)', (await bal('7001')) === 100, await bal('7001'))
    ok('order record closed: DELETED / failed / lateFailure refunded', rec1.status === 'DELETED' && rec1.provisionState === 'failed' && rec1.lateFailure && rec1.lateFailure.refunded === true && rec1.lateFailure.refund_usd === 56, rec1.lateFailure)
    const srv1 = await srvCol.findOne({ server_id: o1.sid })
    ok('half-built droplet destroyed + failure marked handled (outcome refunded)', srv1.status === 'destroyed' && deleted.length === 1 && srv1.failure_handled_at && srv1.failure_outcome === 'refunded', { st: srv1.status, deleted, out: srv1.failure_outcome })
    const msg1 = sent.find(m => m.chatId === '7001')
    ok('customer notice in their language: amount, short reason, balance, in-stock cities', msg1 && /Windows RDP/.test(msg1.text) && /\$56\.00/.test(msg1.text) && /\$100\.00/.test(msg1.text) && /Frankfurt/.test(msg1.text) && msg1.text.includes(LANGS.fr.vp.rdpFailReasons.provision_failed) && !/\bVPS\b/.test(msg1.text), msg1 && msg1.text)
    ok('customer notice has the "try another city" button (callback rdpcity)', msg1 && msg1.opts.reply_markup.inline_keyboard[0][0].callback_data === 'rdpcity' && msg1.opts.reply_markup.inline_keyboard[0][0].text === LANGS.fr.vp.rdpTryAnotherCityBtn)
    ok('admin told about the auto-refund', adminMsgs.some(m => /auto-refunded/.test(m) && m.includes(o1.ext) && /\$56\.00/.test(m)))

    // ── 2. Never twice ──
    console.log('\n── 2: idempotent — repeat callbacks, sweeps and concurrent handlers never refund twice ──')
    await callback(o1.sid, o1.token, { stage: 'failed', message: 'again' })
    await srvCol.updateOne({ server_id: o1.sid }, { $set: { status: 'failed' } })
    await rdp.handleFailedOrder(o1.sid); await rdp.reconcileOrders()
    await sleep(300)
    ok('repeat failure callback + handleFailedOrder + sweep → still exactly one refund / one notice', (await bal('7001')) === 100 && sent.filter(m => m.chatId === '7001').length === 1)
    const o2 = await order({ chatId: '7002' })
    await srvCol.updateOne({ server_id: o2.sid }, { $set: { status: 'failed', logs: [{ stage: 'failed', message: 'Provisioning error: no AMD capacity for this plan in United States (New York) right now' }] } })
    const both = await Promise.all([handleRdpOrderFailed({ instanceId: o2.ext, reason: 'x', reasonCode: 'out_of_stock' }), handleRdpOrderFailed({ instanceId: o2.ext, reason: 'x', reasonCode: 'out_of_stock' })])
    ok('two handlers racing on the same order → one "refunded", one "already"', both.map(r => r.action).sort().join() === 'already,refunded' && (await bal('7002')) === 100, both)
    ok('out_of_stock reason → the capacity wording (English default)', sent.some(m => m.chatId === '7002' && m.text.includes(LANGS.en.vp.rdpFailReasons.out_of_stock)))

    // ── 3. Who is NOT refunded here ──
    console.log('\n── 3: purchase flow still polling / reseller / comp / reinstall / legacy / already refunded ──')
    const o3 = await order({ chatId: '7003', status: 'provisioning', ageMin: 5 })
    await callback(o3.sid, o3.token, { stage: 'failed', message: 'early failure' })
    await sleep(400)
    const srv3 = await srvCol.findOne({ server_id: o3.sid })
    ok('failure while the purchase flow is still polling (<30 min, provisioning) → left to it (its caller refunds), not handled yet', (await bal('7003')) === 44 && !srv3.failure_handled_at && !(await plans.findOne({ contaboInstanceId: o3.ext })).lateFailure)
    await plans.deleteOne({ contaboInstanceId: o3.ext }) // what the purchase flow does before its caller refunds
    await srvCol.updateOne({ server_id: o3.sid }, { $set: { created_at: mins(31) } })
    await rdp.reconcileOrders()
    ok('sweep later sees no order record (purchase flow refunded) → marked handled, no extra refund', (await bal('7003')) === 44 && (await srvCol.findOne({ server_id: o3.sid })).failure_outcome === 'no_record')
    const o3b = await order({ chatId: '7013', status: 'provisioning', ageMin: 35 })
    await srvCol.updateOne({ server_id: o3b.sid }, { $set: { status: 'failed', logs: [{ stage: 'failed', message: 'RDP not reachable at 203.0.113.9:3389 after 90 min.' }] } })
    await rdp.reconcileOrders()
    await waitFor(async () => (await bal('7013')) === 100, 3000)
    ok('purchase flow died (record still provisioning, 35 min old) → sweep refunds once, reason provisioning_timeout', (await bal('7013')) === 100 && (await plans.findOne({ contaboInstanceId: o3b.ext })).lateFailure.reason_code === 'provisioning_timeout')
    const o4 = await order({ chatId: '7004', extra: { source: 'reseller_api' } })
    const o5 = await order({ chatId: '7005', extra: { comp: true } })
    const o6 = await order({ chatId: '7006', server: { activated_at: mins(600), status: 'reinstalling' } })
    const o7 = await order({ chatId: '7007', server: { refund_on_failure: undefined } })
    const o8 = await order({ chatId: '7008', extra: { lateFailure: { at: new Date(), by: 'purchase_flow' } } })
    for (const o of [o4, o5, o6, o7, o8]) await callback(o.sid, o.token, { stage: 'failed', message: 'failed' })
    await sleep(600)
    ok('reseller API order → not refunded by the bot (the reseller worker refunds + emits rdp.provision_failed)', (await bal('7004')) === 44 && (await srvCol.findOne({ server_id: o4.sid })).failure_outcome === 'reseller')
    ok('free comp server → no refund', (await bal('7005')) === 44 && (await srvCol.findOne({ server_id: o5.sid })).failure_outcome === 'comp')
    ok('reinstall failure of a live (activated) server → never refunds the purchase', (await bal('7006')) === 44 && !(await srvCol.findOne({ server_id: o6.sid })).failure_handled_at)
    ok('server created before this change (no refund_on_failure) → no retroactive refund', (await bal('7007')) === 44)
    ok('order the purchase flow already refunded (lateFailure by purchase_flow) → no second refund', (await bal('7008')) === 44 && (await srvCol.findOne({ server_id: o8.sid })).failure_outcome === 'already')
    const o9 = await order({ chatId: '7009', paidUsd: 50.4, planPrice: 56 })
    await callback(o9.sid, o9.token, { stage: 'failed', message: 'failed' })
    await waitFor(async () => (await bal('7009')) === 94.4, 3000)
    ok('refund = what was actually paid (coupon $50.40), not the list price', (await bal('7009')) === 94.4, await bal('7009'))

    // ── 4. Stuck builds ──
    console.log('\n── 4: stuck-build safety net (poller died in a restart) ──')
    const o10 = await order({ chatId: '7010', ageMin: 200, server: { ip_address: null } })
    const rdpPort = await new Promise(r => { const s = net.createServer(c => c.end()); s.listen(0, '127.0.0.1', () => r(s)) }); servers.push(rdpPort)
    const o11 = await order({ chatId: '7011', ageMin: 200, server: { ip_address: '127.0.0.1' } })
    const o12 = await order({ chatId: '7012', ageMin: 60 })
    rdp._timing.rdpPort = rdpPort.address().port
    const sw = await rdp.reconcileOrders()
    await waitFor(async () => (await bal('7010')) === 100, 3000)
    ok('build still "converting" after 3 h with no RDP → failed + refunded', (await srvCol.findOne({ server_id: o10.sid })).status === 'destroyed' && (await bal('7010')) === 100 && sw.stuck === 1, sw)
    ok('build "stuck" but RDP answers → activated, not refunded', (await srvCol.findOne({ server_id: o11.sid })).status === 'active' && (await bal('7011')) === 44)
    ok('build 60 min in → left alone', (await srvCol.findOne({ server_id: o12.sid })).status === 'converting' && (await bal('7012')) === 44)
    rdp._timing.rdpPort = 3389

    // ── 5. Wiring + wording ──
    console.log('\n── 5: bot wiring + wording ──')
    ok('DO-RDP init gets the refund handler; new servers are flagged refund_on_failure', /init\(db, \{ notifyAdmin, onOrderFailed: \(ctx\) => handleRdpOrderFailed\(ctx\) \}\)/.test(indexSrc) && /refund_on_failure: true,/.test(fs.readFileSync(path.join(__dirname, '../digitalocean-rdp-service.js'), 'utf8')))
    ok('vm-instance-setup stores paidUsd (the coupon-adjusted amount) on the order', /paidUsd: Number\(vpsDetails\.totalPrice\) > 0/.test(fs.readFileSync(path.join(__dirname, '../vm-instance-setup.js'), 'utf8')))
    ok('purchase flow marks the order when it returns false (its caller refunds) → no double refund', /createdInstanceId && vpsPlansOf\) vpsPlansOf\.updateOne\(\{ contaboInstanceId: createdInstanceId, lateFailure: \{ \$exists: false \} \}/.test(indexSrc))
    ok('"rdpcity" / "stkbuy" buttons open the RDP/VPS order flow at city selection', /data === 'rdpcity'/.test(indexSrc) && /translation\(data === 'stkbuy:v' \? 'user\.buyLinuxVpsBtn' : 'user\.buyRdpBtn', lang\)/.test(indexSrc))
    for (const [lang, L] of Object.entries(LANGS)) {
      const m = L.vp.rdpLateFailRefund('56.00', L.vp.rdpFailReasons.provisioning_timeout, '100.00', ['🇩🇪 Germany (Frankfurt)'])
      ok(`${lang}: late-failure notice says RDP (never VPS), the amount, the balance and the cities`, /RDP/.test(m) && !/\bVPS\b/.test(m) && /56\.00/.test(m) && /100\.00/.test(m) && /Frankfurt/.test(m) && ['out_of_stock', 'provisioning_timeout', 'provision_failed'].every(k => L.vp.rdpFailReasons[k]))
    }

    // ── 6. Renewal price re-checked at every renewal ──
    console.log('\n── 6: RDP renewal price re-checked on live AMD stock in the server\'s city ──')
    const rsid = crypto.randomUUID()
    await srvCol.insertOne({ server_id: rsid, callback_token: 't', tier_slug: 'standard', os_id: 'ws2022', region: 'nyc1', requested_region: 'nyc3', do_size_slug: 's-2vcpu-4gb-160gb-amd', do_monthly_cost: 32, status: 'active', activated_at: mins(1000), expires_at: new Date(Date.now() + 86400000), created_at: mins(2000), logs: [] })
    await setCatalog([PRICEY(32), ...AMD(ALL_BUT_NY)])
    let q = await rdp.renewalPrice(`rdp-${rsid}`, 1)
    ok('only a pricier same-spec AMD size in New York → $64 (base $56 + $8, 14.3%), source live_quote', q.price_usd === 64 && q.base_price_usd === 56 && q.surcharge_usd === 8 && q.surcharge_pct === 14.3 && q.price_source === 'live_quote', q)
    ok('3-month renewal at the same rate with the bundle discount → $163.20', (await rdp.renewalPrice(`rdp-${rsid}`, 3)).price_usd === 163.2)
    await setCatalog([PRICEY(32), ...AMD(EVERYWHERE)])
    q = await rdp.renewalPrice(`rdp-${rsid}`, 1)
    ok('base AMD size back in New York → renewal drops to the base $56 (price can go down)', q.price_usd === 56 && q.surcharge_usd === 0 && q.price_source === 'live_quote', q)
    await setCatalog([PRICEY(30, ['fra1']), ...AMD(ALL_BUT_NY)])
    q = await rdp.renewalPrice(`rdp-${rsid}`, 1)
    ok('no AMD stock anywhere in New York → the normal plan price $56 (server keeps running), source base_no_stock', q.price_usd === 56 && q.surcharge_usd === 0 && q.price_source === 'base_no_stock', q)
    ok('… and 3 months with no stock → normal 3-month bundle price $142.80', (await rdp.renewalPrice(`rdp-${rsid}`, 3)).price_usd === 142.8)
    await setCatalog([PRICEY(45, ['nyc1']), ...AMD(ALL_BUT_NY)])
    q = await rdp.renewalPrice(`rdp-${rsid}`, 1)
    ok('never above +15%: only a $45 (+61%) size in New York is not sellable → normal price $56', q.price_usd === 56 && q.price_source === 'base_no_stock', q)
    await setCatalog([PRICEY(32), ...AMD(ALL_BUT_NY)])
    const vpsRenewalPrice = new Function('require', grab(/const vpsRenewalPrice = async \(rec\) => \{[\s\S]*?\n\}\n/) + '\nreturn vpsRenewalPrice')(req2)
    ok('bot vpsRenewalPrice: DO-RDP record → re-checked $64; Linux VPS record → its planPrice', (await vpsRenewalPrice({ contaboInstanceId: `rdp-${rsid}`, planPrice: 56, durationMonths: 1 })) === 64 && (await vpsRenewalPrice({ contaboInstanceId: 'do-123', planPrice: 18 })) === 18)
    ok('bot auto-renew charges the re-checked price and stores it; reminder + manual renew use it too',
      /const planPrice = await vpsRenewalPrice\(vpsPlan\)\n      const deductResult|const planPrice = await vpsRenewalPrice\(vpsPlan\)/.test(indexSrc) && (indexSrc.match(/await vpsRenewalPrice\(vpsPlan\)/g) || []).length === 2
      && /planPrice !== Number\(vpsPlan\.planPrice\) \? \{ planPrice \} : \{\}/.test(indexSrc) && /vpsDetails\.totalPrice = \(await vpsRenewalPrice\(info\.userVPSDetails\)\)/.test(indexSrc))

    // Reseller renew (live, isolated DB): dry-run quote + real charge at the re-checked price.
    const OWNER = '900900988', KEY = 'test-late-raw-key'
    await db.collection('resellerApiKeys').insertMany([
      { _id: 'k-a', keyHash: crypto.createHash('sha256').update(KEY).digest('hex'), ownerChatId: OWNER, enabled: true, scopes: ['*'], webhookUrl: hookUrl('/a') },
      { _id: 'k-b', keyHash: 'x', ownerChatId: '900900989', enabled: true, scopes: ['*'], webhookUrl: hookUrl('/b') },
      { _id: 'k-c', keyHash: 'y', ownerChatId: '900900990', enabled: false, scopes: ['*'], webhookUrl: hookUrl('/c') },
      { _id: 'k-d', keyHash: 'z', ownerChatId: '900900991', enabled: true, scopes: ['*'] },
    ])
    await walletOf.insertOne({ _id: OWNER, usdIn: 500, usdOut: 0 })
    await plans.insertOne({ _id: 'rv-1', vpsId: 'rv-1', chatId: OWNER, isRDP: true, provider: 'digitalocean-rdp', instanceId: `rdp-${rsid}`, productId: 'standard-1m', plan: 'Standard — Windows RDP (1 month)', planPrice: 56, status: 'RUNNING', source: 'reseller_api', end_time: new Date(Date.now() + 86400000) })
    const logs = []
    console.log = (...a) => { logs.push(a.join(' ')); realLog(...a) }
    const apiApp = require('express')(); apiApp.use(require('express').json())
    apiApp.use('/reseller/v1', createResellerApi({ getDb: () => db, log: (m) => logs.push(String(m)), notifyAdmin: () => {} }))
    const apiSrv = await new Promise(r => { const s = apiApp.listen(0, () => r(s)) }); servers.push(apiSrv)
    const api = async (method, p, body) => { const r = await fetch(`http://127.0.0.1:${apiSrv.address().port}/reseller/v1${p}`, { method, headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) } }
    let r = await api('POST', '/rdp/rv-1/renew', { months: 1, dry_run: true })
    ok('POST /rdp/:id/renew dry_run → $64 with renewal_pricing breakdown, nothing charged', r.status === 200 && r.body.price_usd === 64 && r.body.renewal_pricing && r.body.renewal_pricing.surcharge_usd === 8 && r.body.renewal_pricing.price_source === 'live_quote' && (await bal(OWNER)) === 500, r.body)
    r = await api('POST', '/rdp/rv-1/renew', { months: 1 })
    ok('real renew charges the re-checked $64 and reports renewal_pricing', r.status === 200 && r.body.charged_usd === 64 && r.body.result.renewal_pricing.base_price_usd === 56 && (await bal(OWNER)) === 436 && (await plans.findOne({ _id: 'rv-1' })).lastRenewalPriceUsd === 64, r.body)

    // ── 7. Preview isolation ──
    console.log('\n── 7: preview pod never picks up production reseller orders ──')
    ok('preview (SKIP_WEBHOOK_SYNC=true): provision worker OFF by default', logs.some(l => /provision worker OFF on this sandbox/.test(l)), logs.filter(l => /provision worker/.test(l)))
    const jobs = db.collection('resellerProvisionJobs')
    const base = { product: 'rdp', ownerChatId: OWNER, priceUsd: 56, charged: true, mode: 'live', attempts: 0, request: { isRDP: true, plan: 'Standard', plan_id: 'standard-1m', region: 'US' } }
    await jobs.insertMany([
      { _id: 'j-legacy', ...base, vpsId: 'v-legacy', status: 'pending', createdAt: new Date() },
      { _id: 'j-prod', ...base, vpsId: 'v-prod', status: 'pending', env: 'production', createdAt: new Date() },
      { _id: 'j-prod-stale', ...base, vpsId: 'v-prod-stale', status: 'processing', env: 'production', leaseAt: mins(120), createdAt: mins(130) },
      { _id: 'j-prod-wait', ...base, vpsId: 'v-prod-wait', status: 'awaiting_provider', env: 'production', instanceId: 'rdp-elsewhere', buildHost: null, awaitingSince: mins(400), createdAt: mins(400) },
      { _id: 'j-preview', ...base, vpsId: 'v-preview', status: 'pending', env: 'preview', createdAt: new Date() },
    ])
    for (const id of ['v-legacy', 'v-prod', 'v-prod-stale', 'v-prod-wait', 'v-preview']) await plans.insertOne({ _id: id, vpsId: id, chatId: OWNER, isRDP: true, status: 'provisioning', provisionState: 'provisioning' })
    const created = []
    const realCreate = rdp.createInstance
    rdp.createInstance = rdp.createInstanceWithFallback = async (o) => { created.push(o); return { instanceId: `rdp-${crypto.randomUUID()}`, status: 'provisioning', mainIp: null } }
    process.env.RESELLER_PROVISION_WORKER = 'true'
    const previewApp = require('express')(); previewApp.use(require('express').json())
    previewApp.use('/reseller/v1', createResellerApi({ getDb: () => db, log: (m) => logs.push(String(m)), notifyAdmin: () => {} }))
    ok('RESELLER_PROVISION_WORKER=true turns it on — for env=preview jobs only', logs.some(l => /provision worker ON \(claims only env=preview jobs\)/.test(l)))
    await waitFor(async () => (await jobs.findOne({ _id: 'j-preview' })).status !== 'pending', 25000)
    await sleep(500)
    const after = Object.fromEntries((await jobs.find({}).toArray()).map(j => [j._id, j]))
    ok('preview worker processed its own preview job', after['j-preview'].status !== 'pending' && created.length === 1, after['j-preview'].status)
    ok('production jobs (tagged or untagged legacy) are NOT claimed by the preview worker', after['j-legacy'].status === 'pending' && after['j-prod'].status === 'pending' && !after['j-legacy'].attempts && !after['j-prod'].attempts)
    // The only wallet movement allowed is the preview job's own refund (its fake droplet "vanished").
    const ownRefund = after['j-preview'].refunded ? 56 : 0
    ok('a stale production "processing" job is NOT refunded/failed by preview', after['j-prod-stale'].status === 'processing' && !after['j-prod-stale'].refunded && (await bal(OWNER)) === 436 + ownRefund, { st: after['j-prod-stale'].status, ref: after['j-prod-stale'].refunded, bal: await bal(OWNER), preview: [after['j-preview'].status, after['j-preview'].refunded] })
    ok('a production awaiting_provider job is NOT judged by preview', after['j-prod-wait'].status === 'awaiting_provider')
    delete process.env.SKIP_WEBHOOK_SYNC
    const prodApp = require('express')(); prodApp.use(require('express').json())
    prodApp.use('/reseller/v1', createResellerApi({ getDb: () => db, log: (m) => logs.push(String(m)), notifyAdmin: () => {} }))
    ok('production pod (SKIP_WEBHOOK_SYNC unset): worker ON for env=production', logs.some(l => /provision worker ON \(claims only env=production jobs\)/.test(l)))
    await waitFor(async () => (await jobs.findOne({ _id: 'j-legacy' })).status !== 'pending' && (await jobs.findOne({ _id: 'j-prod' })).status !== 'pending', 25000)
    const after2 = Object.fromEntries((await jobs.find({}).toArray()).map(j => [j._id, j]))
    ok('production worker claims production + untagged legacy jobs', after2['j-legacy'].status !== 'pending' && after2['j-prod'].status !== 'pending', { l: after2['j-legacy'].status, p: after2['j-prod'].status })
    process.env.SKIP_WEBHOOK_SYNC = 'true'
    rdp.createInstance = realCreate; rdp.createInstanceWithFallback = realCreate
    const pSrv = await new Promise(rr => { const s = previewApp.listen(0, () => rr(s)) }); servers.push(pSrv)
    await setCatalog([...AMD(EVERYWHERE)])
    rdp.createInstance = rdp.createInstanceWithFallback = async (o) => ({ instanceId: `rdp-${crypto.randomUUID()}`, status: 'provisioning', mainIp: null })
    const newOrder = await fetch(`http://127.0.0.1:${pSrv.address().port}/reseller/v1/rdp`, { method: 'POST', headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ plan_id: 'standard-1m', region: 'EU', os: 'ws2022' }) }).then(x => x.json())
    ok('a new order is tagged with the environment that accepted it (env=preview)', newOrder.job_id && (await jobs.findOne({ _id: newOrder.job_id })).env === 'preview', newOrder)
    rdp.createInstance = realCreate; rdp.createInstanceWithFallback = realCreate

    // ── 8. Customer back-in-stock alerts ──
    console.log('\n── 8: customer "Notify me when it\'s back" — once, 14-day quiet expiry ──')
    const aCol = db.collection('doStockAlerts')
    const s1 = await stockAlerts.subscribe(aCol, { chatId: '8001', kind: 'rdp', region: 'nyc3', plan: 'pro', lang: 'en' })
    await stockAlerts.subscribe(aCol, { chatId: '8001', kind: 'rdp', region: 'nyc3', plan: 'pro', lang: 'en' })
    ok('subscribe → one alert per chat+product+city+plan, expires in 14 days', (await aCol.countDocuments({ chatId: '8001' })) === 1 && Math.round((s1.expiresAt - Date.now()) / 86400000) === 14 && stockAlerts.TTL_DAYS === 14)
    await stockAlerts.subscribe(aCol, { chatId: '8002', kind: 'vps', region: 'US-central', plan: null, lang: 'fr' })
    await stockAlerts.subscribe(aCol, { chatId: '8003', kind: 'rdp', region: 'tor1', plan: 'power', lang: 'en', now: new Date(Date.now() - 15 * 86400000) })
    const notified = []
    const notify = (a) => notified.push(a)
    let snap = { 'rdp|nyc3|pro': false, 'rdp|nyc3|standard': true, 'vps|US-central|s-2vcpu-4gb': false, 'vps|US-central|s-4vcpu-8gb': false, 'rdp|tor1|power': true }
    let nd = await stockAlerts.notifyDue({ col: aCol, snap, notify })
    ok('still sold out → nothing sent; a 15-day-old alert expires quietly (no message)', notified.length === 0 && nd.expired === 1 && (await aCol.findOne({ chatId: '8003' })).status === 'expired', nd)
    snap = { ...snap, 'rdp|nyc3|pro': true, 'vps|US-central|s-4vcpu-8gb': true }
    const [n1, n2] = await Promise.all([stockAlerts.notifyDue({ col: aCol, snap, notify }), stockAlerts.notifyDue({ col: aCol, snap, notify })])
    ok('back in stock → each alert sent exactly once (even with two pods), any-plan alert fires on any plan', notified.length === 2 && n1.sent + n2.sent === 2 && notified.some(a => a.chatId === '8001' && a.plan === 'pro') && notified.some(a => a.chatId === '8002' && a.plan === null))
    await stockAlerts.notifyDue({ col: aCol, snap, notify })
    ok('next refresh → no repeat', notified.length === 2 && (await aCol.countDocuments({ status: 'sent' })) === 2)
    const dd = stockAlerts.describe('rdp', 'nyc3', 'pro')
    ok('describe(): city + plan names for the message', dd.place === '🇺🇸 United States (New York)' && dd.planName === 'Pro' && stockAlerts.describe('vps', 'US-central', null).place === '🇺🇸 US Central')
    // start(): wired to the live catalogue refresh, real stock snapshot.
    stockAlerts._resetForTest()
    const viaStart = []
    await stockAlerts.subscribe(aCol, { chatId: '8004', kind: 'rdp', region: 'nyc3', plan: 'standard', lang: 'en' })
    await setCatalog([...AMD(ALL_BUT_NY)])
    ok('start() hooks the alerts to every catalogue refresh', stockAlerts.start(db, { notify: (a) => viaStart.push(a) }) === true)
    await setCatalog([...AMD(ALL_BUT_NY)]); await sleep(300)
    ok('refresh while New York is still sold out → no alert', viaStart.length === 0)
    await setCatalog([...AMD(EVERYWHERE)])
    await waitFor(async () => viaStart.length === 1, 3000)
    ok('refresh with AMD back in New York → the alert is sent automatically', viaStart.length === 1 && viaStart[0].chatId === '8004')
    // Bot wiring: the sold-out screen's button + the alert message.
    const stockNotifyKb = new Function(grab(/const stockNotifyKb = [\s\S]*?\n\}\n/) + '\nreturn stockNotifyKb')()
    const kbR = stockNotifyKb({ isRDP: true, region: 'nyc3', zone: 'nyc3', config: { _id: 'pro-1m' } }, LANGS.en.vp.stockNotifyBtn)
    const kbV = stockNotifyKb({ isRDP: false, region: 'US-central' }, LANGS.en.vp.stockNotifyBtn)
    ok('sold-out screen: "Notify me" button → stk:r:nyc3:pro (plan) / stk:v:US-central:* (whole city)', kbR.reply_markup.inline_keyboard[0][0].callback_data === 'stk:r:nyc3:pro' && kbV.reply_markup.inline_keyboard[0][0].callback_data === 'stk:v:US-central:*' && kbR.reply_markup.inline_keyboard[0][0].text === '🔔 Notify me when it\'s back')
    ok('bot: vpsOutOfStock attaches the button; "stk:" subscribes + confirms; the alert has "Order now" (stkbuy)',
      /vp\.planOutOfStock\(isRDP, here, suggestions\), stockNotifyKb\(vpsDetails, vp\.stockNotifyBtn\)\)/.test(indexSrc) && /alerts\.subscribe\(db\.collection\('doStockAlerts'\)/.test(indexSrc) && /translation\('vp\.stockNotifySaved', lang, kind === 'rdp'/.test(indexSrc) && /callback_data: `stkbuy:\$\{isRDP \? 'r' : 'v'\}`/.test(indexSrc)
      && /require\('\.\/do-stock-alerts'\)\.start\(db, \{ notify: \(a\) => sendStockAlert\(a\) \}\)/.test(indexSrc))
    for (const [lang, L] of Object.entries(LANGS)) {
      const back = L.vp.stockBackInStock(true, '🇺🇸 United States (New York)', 'Pro'), saved = L.vp.stockNotifySaved(true, 'NY', 14), vb = L.vp.stockBackInStock(false, 'US Central', null)
      ok(`${lang}: back-in-stock + confirmation texts (RDP never "VPS", 14 days shown; VPS says VPS)`, /Windows RDP/.test(back) && /Pro/.test(back) && !/\bVPS\b/.test(back) && /14/.test(saved) && /\bVPS\b/.test(vb) && !/RDP/.test(vb) && L.vp.stockNotifyBtn && L.vp.stockOrderNowBtn)
    }

    // ── 9. Reseller back-in-stock webhooks ──
    console.log('\n── 9: reseller rdp.back_in_stock / vps.back_in_stock webhooks ──')
    ok('both events are in the webhook catalogue (GET /account/webhook events)', webhooks.EVENTS.includes('rdp.back_in_stock') && webhooks.EVENTS.includes('vps.back_in_stock'))
    r = await api('GET', '/account/webhook')
    ok('GET /account/webhook lists them', r.status === 200 && r.body.events.includes('rdp.back_in_stock') && r.body.events.includes('vps.back_in_stock'))
    await setCatalog([PRICEY(32), ...AMD(ALL_BUT_NY), ...BASIC(EVERYWHERE)])
    const at = new Date('2026-10-14T09:30:00.000Z')
    const evs = stockAlerts.backInStockEvents(['rdp|nyc3|standard', 'vps|US-central|s-2vcpu-4gb', 'bogus'], at)
    const er = evs.find(e => e.event === 'rdp.back_in_stock'), ev = evs.find(e => e.event === 'vps.back_in_stock')
    ok('rdp payload: region code + label, plan + plan_ids, AMD, build datacenter, price incl. surcharge, restored_at', evs.length === 2 && er.payload.region === 'US' && er.payload.region_slug === 'nyc3' && er.payload.plan === 'standard' && JSON.stringify(er.payload.plan_ids) === '["standard-1m","standard-2m","standard-3m"]' && er.payload.cpu === 'AMD' && er.payload.build_region === 'nyc1' && er.payload.same_city_fallback === true && er.payload.price_usd === 64 && er.payload.base_price_usd === 56 && er.payload.restored_at === at.toISOString() && er.instanceId === 'nyc3:standard', er)
    ok('vps payload: region, plan_id, build datacenter, price', ev.payload.region === 'US-central' && ev.payload.plan_id === 's-2vcpu-4gb' && ev.payload.build_region === 'nyc3' && typeof ev.payload.price_usd === 'number' && ev.instanceId === 'US-central:s-2vcpu-4gb', ev)
    hooks.length = 0
    const b1 = await webhooks.broadcast(db, { ...er })
    await webhooks.broadcast(db, { ...er })
    await waitFor(async () => hooks.length >= 2, 3000); await sleep(200)
    ok('broadcast → every enabled account with a webhook URL (2 of 4 keys), never twice for the same restoration', b1.owners === 2 && hooks.length === 2 && hooks.every(h => h.event === 'rdp.back_in_stock' && h.data.id === 'nyc3:standard' && h.data.plan === 'standard') && hooks.map(h => h.path).sort().join() === '/a,/b', { b1, hooks: hooks.map(h => h.path) })
    await webhooks.broadcast(db, { ...er, dedupKey: `nyc3:standard:${new Date(at.getTime() + 3600000).toISOString()}` })
    await waitFor(async () => hooks.length >= 4, 3000)
    ok('a LATER restoration of the same city+plan is delivered again', hooks.length === 4)
    const col = db.collection('doSizeCatalog')
    const restored = []
    const onBackInStock = (keys) => { restored.push(keys) }
    await setCatalog([...AMD(EVERYWHERE)])
    await stockWatch.check({ col, notify: () => {}, onBackInStock })
    await setCatalog([...AMD(ALL_BUT_NY)])
    await stockWatch.check({ col, notify: () => {}, onBackInStock })
    ok('stock going OUT does not fire back_in_stock', restored.length === 0)
    await setCatalog([...AMD(EVERYWHERE)])
    await Promise.all([stockWatch.check({ col, notify: () => {}, onBackInStock }), stockWatch.check({ col, notify: () => {}, onBackInStock })])
    ok('New York AMD back → onBackInStock called ONCE (two pods) with rdp|nyc3|standard/pro/power', restored.length === 1 && ['standard', 'pro', 'power'].every(t => restored[0].includes(`rdp|nyc3|${t}`)), restored)
    ok('bot: stock watcher pushes them to resellers via broadcast (production pod only)', /do-stock-watch'\)\.start\(db, \{ notify: notifyAdmin, onBackInStock: \(keys, at\) => pushBackInStock\(keys, at\) \}\)/.test(indexSrc) && /webhooks\.broadcast\(resellerDb \|\| db, \{ \.\.\.e, log \}\)/.test(indexSrc))

    // ── 10. Docs ──
    console.log('\n── 10: developer docs ──')
    const html = require('../apidoc-page').renderApiDocPage('https://example.test/reseller/v1')
    ok('docs: "Stock, provisioning & refunds" guide with AMD/city/+15%, lifecycle, late refunds, renewal re-check, back_in_stock payloads',
      /id="stock-lifecycle"/.test(html) && /AMD only/.test(html) && /same city/.test(html) && /\+15%/.test(html) && /late failures/.test(html) && /re-checked at every renewal/.test(html) && /renewal_pricing/.test(html) && /rdp\.back_in_stock/.test(html) && /vps\.back_in_stock/.test(html) && /provisioning_timeout/.test(html) && /href="#stock-lifecycle"/.test(html))

    // ── 11. Live Linux image list + SSH-key-only images ──
    console.log('\n── 11: VPS Linux images mirror DigitalOcean live; Fedora/CentOS/Alma/Rocky need an SSH key ──')
    const vps = require('../digitalocean-service')
    sizeCatalog._setImagesForTest(null)
    let imgs = await vps.listImages('linux')
    ok('before the first pull: today\'s DigitalOcean list (Ubuntu 26.04/24.04/22.04, no retired Debian 12 / Fedora 42)', imgs[0].imageId === 'ubuntu-24-04-x64' && imgs[0].isDefault && ['ubuntu-26-04-x64', 'ubuntu-22-04-x64', 'debian-13-x64', 'almalinux-10-x64', 'rockylinux-8-x64', 'fedora-44-x64'].every(id => imgs.some(i => i.imageId === id)) && !imgs.some(i => /debian-12|fedora-42/.test(i.imageId)), imgs.map(i => i.imageId))
    const IMG = (slug, distribution, name, status = 'available') => ({ slug, distribution, name, status, min_disk_size: 10, regions: ['nyc1'] })
    CAT.images = [IMG('ubuntu-28-04-x64', 'Ubuntu', '28.04 (LTS) x64'), IMG('ubuntu-24-04-x64', 'Ubuntu', '24.04 (LTS) x64'), IMG('ubuntu-22-04-x64', 'Ubuntu', '22.04 (LTS) x64'),
      IMG('debian-13-x64', 'Debian', '13 x64'), IMG('almalinux-10-x64', 'AlmaLinux', 'AlmaLinux 10'), IMG('rockylinux-10-x64', 'Rocky Linux', '10 x64'),
      IMG('centos-stream-10-x64', 'CentOS', '10 Stream x64'), IMG('fedora-45-x64', 'Fedora', '45 x64'), IMG('fedora-44-x64', 'Fedora', '44 x64', 'retired'),
      IMG('gpu-h100x1-base', 'Ubuntu', 'Ubuntu NVIDIA AI/ML Ready Image')]
    sizeCatalog._resetForTest(); sizeCatalog.init(db, { autoRefresh: false })
    await setCatalog([...AMD(EVERYWHERE), ...BASIC(EVERYWHERE)])
    imgs = await vps.listImages('linux')
    const byId = Object.fromEntries(imgs.map(i => [i.imageId, i]))
    ok('after a live pull: a NEW release appears by itself (Ubuntu 28.04), GPU images and non-available ones are left out', !!byId['ubuntu-28-04-x64'] && !byId['gpu-h100x1-base'] && !byId['fedora-44-x64'] && !!byId['fedora-45-x64'] && imgs[0].imageId === 'ubuntu-24-04-x64', Object.keys(byId))
    ok('display names: "Ubuntu 28.04 LTS", "AlmaLinux 10", "Rocky Linux 10", "CentOS Stream 10", "Fedora 45"', byId['ubuntu-28-04-x64'].name === 'Ubuntu 28.04 LTS' && byId['almalinux-10-x64'].name === 'AlmaLinux 10' && byId['rockylinux-10-x64'].name === 'Rocky Linux 10' && byId['centos-stream-10-x64'].name === 'CentOS Stream 10' && byId['fedora-45-x64'].name === 'Fedora 45', imgs.map(i => i.name))
    ok('requires SSH key: Fedora, CentOS, AlmaLinux, Rocky Linux — not Ubuntu / Debian', ['almalinux-10-x64', 'rockylinux-10-x64', 'centos-stream-10-x64', 'fedora-45-x64'].every(id => byId[id].requiresSshKey === true) && ['ubuntu-28-04-x64', 'debian-13-x64'].every(id => byId[id].requiresSshKey === false))
    await waitFor(async () => ((await db.collection('doSizeCatalog').findOne({ _id: 'live' })) || {}).images?.length === CAT.images.length, 3000)
    ok('the live image list is persisted with the catalogue (survives a restart)', ((await db.collection('doSizeCatalog').findOne({ _id: 'live' })) || {}).images?.length === CAT.images.length)
    doCalls.length = 0
    let threw2 = null
    try { await vps.createInstance({ productId: 's-2vcpu-4gb', regionSlug: 'EU', osId: 'fedora-45-x64' }) } catch (e) { threw2 = e }
    ok('provider refuses an SSH-key-only image without a key (code ssh_key_required) before calling DigitalOcean', threw2 && threw2.code === 'ssh_key_required' && !doCalls.some(c => c.m === 'POST'), threw2 && threw2.message)
    r = await api('GET', '/vps/os-options')
    ok('GET /vps/os-options: live ids with requires_ssh_key + version', r.status === 200 && r.body.default_os === 'ubuntu-24-04-x64' && r.body.os_options.find(o => o.id === 'rockylinux-10-x64').requires_ssh_key === true && r.body.os_options.find(o => o.id === 'debian-13-x64').requires_ssh_key === false && r.body.os_options.find(o => o.id === 'ubuntu-28-04-x64').version === '28.04', r.body)
    r = await api('GET', '/vps/plans?region=EU')
    ok('GET /vps/plans: os_options carry requires_ssh_key; catalog freshness shown for VPS too', r.status === 200 && r.body.os_options.some(o => o.requires_ssh_key) && r.body.catalog && r.body.catalog.source === 'live' && typeof r.body.catalog.age_seconds === 'number', r.body.catalog)
    const before = await bal(OWNER)
    r = await api('POST', '/vps', { plan_id: 's-2vcpu-4gb', region: 'EU', os: 'rockylinux-10-x64' })
    ok('POST /vps Rocky Linux without ssh_keys → 400 ssh_key_required, lists os_without_ssh_key, nothing charged', r.status === 400 && r.body.error === 'ssh_key_required' && r.body.os_without_ssh_key.includes('debian-13-x64') && !r.body.os_without_ssh_key.includes('fedora-45-x64') && (await bal(OWNER)) === before, r.body)
    r = await api('POST', '/vps', { plan_id: 's-2vcpu-4gb', region: 'EU', os: 'debian-12-x64' })
    ok('POST /vps with an image DigitalOcean retired (debian-12) → 400 invalid_os, nothing charged', r.status === 400 && r.body.error === 'invalid_os' && (await bal(OWNER)) === before, r.body)
    r = await api('POST', '/vps', { plan_id: 's-2vcpu-4gb', region: 'EU', os: 'rockylinux-10-x64', ssh_keys: ['ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey user@host'] })
    const keyRec = r.body && r.body.id ? await plans.findOne({ _id: r.body.id }) : null
    ok('POST /vps Rocky Linux WITH ssh_keys → 202 accepted; the server record keeps its SSH key ids', r.status === 202 && keyRec && JSON.stringify(keyRec.sshKeyIds) === '[4242]' && keyRec.osId === 'rockylinux-10-x64', { s: r.status, b: r.body })
    if (r.body && r.body.job_id) await waitFor(async () => ['failed', 'provisioned'].includes((await jobs.findOne({ _id: r.body.job_id }))?.status), 8000)
    r = await api('POST', '/vps', { plan_id: 's-2vcpu-4gb', region: 'EU', os: 'debian-13-x64', dry_run: true })
    ok('Debian without ssh_keys still passes the SSH check (password only is fine)', r.body && r.body.error !== 'ssh_key_required', r.body)
    await plans.insertMany([
      { _id: 'lv-nokey', vpsId: 'lv-nokey', chatId: OWNER, isRDP: false, provider: 'digitalocean', instanceId: 'do-555001', osId: 'ubuntu-24-04-x64', osType: 'linux', status: 'RUNNING', source: 'reseller_api', host: '203.0.113.5' },
      { _id: 'lv-key', vpsId: 'lv-key', chatId: OWNER, isRDP: false, provider: 'digitalocean', instanceId: 'do-555002', osId: 'ubuntu-24-04-x64', osType: 'linux', status: 'RUNNING', source: 'reseller_api', host: '203.0.113.6', sshKeyIds: [4242] },
    ])
    r = await api('POST', '/vps/lv-nokey/reinstall', { os: 'fedora-45-x64' })
    ok('reinstall a key-less server to Fedora → 400 ssh_key_required (checked before the confirm step, nothing changed)', r.status === 400 && r.body.error === 'ssh_key_required' && (await plans.findOne({ _id: 'lv-nokey' })).status === 'RUNNING', r.body)
    r = await api('POST', '/vps/lv-key/reinstall', { os: 'fedora-45-x64' })
    ok('reinstall a server created with a key to Fedora → passes the SSH check (asks for confirm)', r.status === 400 && r.body.error === 'confirmation_required', r.body)
    r = await api('POST', '/vps/lv-nokey/reinstall', { os: 'debian-13-x64' })
    ok('reinstall a key-less server to Debian → no SSH requirement (asks for confirm)', r.body.error === 'confirmation_required', r.body)

    // ── 12. Stock accuracy: decisions on fresh data, per-datacenter detail, honest fast-deploy ETA ──
    console.log('\n── 12: stock is re-pulled before every decision; datacenters match DigitalOcean; ETA follows the build datacenter ──')
    const LIVE_NY = ['nyc1', 'nyc2', ...ALL_BUT_NY] // DigitalOcean today: AMD in New York 1 + 2, none in New York 3
    await setCatalog([...AMD(LIVE_NY), ...BASIC(EVERYWHERE)])
    r = await api('GET', '/rdp/availability?region=US')
    const us = r.body.regions && r.body.regions[0]
    ok('New York (nyc3 has no AMD, nyc1/nyc2 do) → in stock, built in nyc1, same-city', r.status === 200 && us.in_stock && us.plans.every(p => p.in_stock && p.build_region === 'nyc1' && p.same_city_fallback), us)
    ok('datacenters: nyc3 none · nyc1 + nyc2 all plans (matches DigitalOcean\'s control panel)', JSON.stringify(us.datacenters) === JSON.stringify([{ datacenter: 'nyc3', plans_in_stock: [] }, { datacenter: 'nyc1', plans_in_stock: ['standard', 'pro', 'power'] }, { datacenter: 'nyc2', plans_in_stock: ['standard', 'pro', 'power'] }]), us.datacenters)
    const tor = (await api('GET', '/rdp/availability?region=CA')).body.regions[0]
    ok('Toronto (no AMD sold there at all) → out of stock, its only datacenter lists nothing', !tor.in_stock && JSON.stringify(tor.datacenters) === JSON.stringify([{ datacenter: 'tor1', plans_in_stock: [] }]), tor)
    const gap = sizeCatalog._timing.minForcedGapMs
    sizeCatalog._timing.minForcedGapMs = 0
    const sizeGets = () => doCalls.filter(c => c.m === 'GET' && c.u.startsWith('/sizes')).length
    let n0 = sizeGets()
    await api('GET', '/rdp/availability?region=US')
    ok('a copy younger than ~2 min is used as is (no extra DigitalOcean call)', sizeGets() === n0)
    await api('GET', '/rdp/availability?region=US&refresh=true')
    ok('?refresh=true re-pulls from DigitalOcean now', sizeGets() === n0 + 1)
    // In-memory copy is 5 min old and says New York is SOLD OUT, but DigitalOcean has stock again → order decided on fresh data.
    sizeCatalog._setForTest([...AMD(ALL_BUT_NY)], CAT.regions, { source: 'live', fetchedAt: new Date(Date.now() - 5 * 60000) })
    rdp.createInstance = rdp.createInstanceWithFallback = async () => ({ instanceId: `rdp-${crypto.randomUUID()}`, status: 'provisioning', mainIp: null })
    n0 = sizeGets()
    const bal0 = await bal(OWNER)
    r = await api('POST', '/rdp', { plan_id: 'standard-1m', region: 'US', os: 'ws2022' })
    ok('stale copy says sold out, DigitalOcean has stock → POST /rdp re-pulls first and accepts (202), not a false 409', r.status === 202 && sizeGets() === n0 + 1, { s: r.status, e: r.body && r.body.error })
    if (r.body && r.body.job_id) await waitFor(async () => ['failed', 'provisioned', 'awaiting_provider'].includes((await jobs.findOne({ _id: r.body.job_id }))?.status), 8000)
    // …and the reverse: stale copy says in stock, DigitalOcean just sold out → 409 before charging.
    CAT.sizes = [...AMD(ALL_BUT_NY)]
    sizeCatalog._setForTest([...AMD(EVERYWHERE)], CAT.regions, { source: 'live', fetchedAt: new Date(Date.now() - 5 * 60000) })
    const bal1 = await bal(OWNER)
    r = await api('POST', '/rdp', { plan_id: 'standard-1m', region: 'US', os: 'ws2022' })
    ok('stale copy says in stock, DigitalOcean sold out → 409 out_of_stock after a fresh pull, nothing charged', r.status === 409 && r.body.error === 'out_of_stock' && (await bal(OWNER)) === bal1, { s: r.status, b: r.body })
    rdp.createInstance = realCreate; rdp.createInstanceWithFallback = realCreate
    sizeCatalog._setForTest([...AMD(ALL_BUT_NY)], CAT.regions, { source: 'live', fetchedAt: new Date(Date.now() - 5 * 60000) })
    CAT.sizes = [...AMD(LIVE_NY)]
    const ensureFreshBot = new Function('require', grab(/const vpsPlanInStock = async \(vpsDetails\) => \{[\s\S]*?\n\}\n/) + '\nreturn vpsPlanInStock')(req2)
    ok('bot stock gate re-pulls a stale copy before deciding (New York RDP → in stock)', (await ensureFreshBot({ isRDP: true, config: { _id: 'standard-1m' }, zone: 'nyc3' })) === true)
    sizeCatalog._timing.minForcedGapMs = gap
    await db.collection('doRdpOsOptions').updateOne({ _id: 'ws2022' }, { $set: { golden_status: 'available', golden_image_id: 111, golden_regions: ['nyc3', 'fra1'], golden_min_disk_gb: 50 } }, { upsert: true })
    await setCatalog([...AMD(LIVE_NY)])
    let osNy = (await rdp.listOsOptionsForRegion('nyc3')).find(o => o.id === 'ws2022'), osFr = (await rdp.listOsOptionsForRegion('fra1')).find(o => o.id === 'ws2022')
    let osAll = (await rdp.listOsOptions()).find(o => o.id === 'ws2022')
    ok('golden image only in nyc3 but New York builds in nyc1 → honest ETA: no fast deploy (45 min) for US; Frankfurt stays fast (3 min)', osNy.fast_deploy === false && osNy.eta_minutes === 45 && osFr.fast_deploy === true && osFr.eta_minutes === 3 && !osAll.fast_deploy_regions.includes('US') && osAll.fast_deploy_regions.includes('EU'), { osNy, osFr, regs: osAll.fast_deploy_regions })
    await setCatalog([...AMD(EVERYWHERE)])
    osNy = (await rdp.listOsOptionsForRegion('nyc3')).find(o => o.id === 'ws2022')
    ok('AMD back in nyc3 (where the golden image is) → New York is fast again', osNy.fast_deploy === true && (await rdp.listOsOptions()).find(o => o.id === 'ws2022').fast_deploy_regions.includes('US'))
    const html2 = require('../apidoc-page').renderApiDocPage('https://example.test/reseller/v1')
    ok('docs: live OS list, requires_ssh_key + ssh_key_required, ?refresh=true, datacenters, base_no_stock; no retired image ids', /requires_ssh_key/.test(html2) && /ssh_key_required/.test(html2) && /Requires an SSH Key/.test(html2) && /refresh=true/.test(html2) && /plans_in_stock/.test(html2) && /base_no_stock/.test(html2) && !/debian-12-x64|fedora-42-x64|current_size/.test(html2))
  } catch (e) {
    fail++; realLog('  ❌ suite crashed:', e.stack || e.message)
  } finally {
    console.log = realLog
    for (const s of servers) await new Promise(r => s.close(r))
    receiver.close()
    await db.dropDatabase().catch(() => {})
    await client.close()
  }
  console.log(`\n${fail === 0 ? '✅' : '❌'} Late refund / renewal re-check / stock alerts / isolation suite: ${pass} passed / ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})()
