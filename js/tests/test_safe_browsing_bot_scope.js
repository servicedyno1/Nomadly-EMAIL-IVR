/* global process */
// Verifies the Safe Browsing monitor now protects BOT-PURCHASED domains (end-user
// accounts with NO reseller API key) across hosting / shortener / vps / rdp, via
// scope:'all' — while the legacy scope:'reseller' still ignores them.
// LOCAL db only, mocked Safe-Browsing + webhook + unlink actions. No prod / CF / WHM.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const mon = require('/app/js/safe-browsing-monitor')

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test'

// A plain BOT customer — their chatId is NOT in resellerApiKeys.
const BOT_CHAT = '770000999'
const BOT_USER = 'botscopeuser'
const BOT_HOST = 'botscope-host.test'
const BOT_SHORT = 'go.botscope-short.test'
const RDP_DOMAIN = 'botscope-rdp.test'
const RDP_IP = '203.0.113.77'

const results = []
const ok = (name, cond, detail) => results.push([name, !!cond, detail])

async function seed(db) {
  await db.collection('cpanelAccounts').updateOne({ _id: BOT_USER }, { $set: { _id: BOT_USER, cpUser: BOT_USER, chatId: BOT_CHAT, domain: BOT_HOST, addonDomains: [], plan: 'Premium', provisionState: 'completed', whmHost: '198.51.100.9' } }, { upsert: true })
  await db.collection('shortenerActivations').updateOne({ _id: BOT_SHORT }, { $set: { _id: BOT_SHORT, domain: BOT_SHORT, chatId: BOT_CHAT, status: 'completed' } }, { upsert: true })
  await db.collection('vpsPlansOf').updateOne({ _id: 'botscope-rdp1' }, { $set: { _id: 'botscope-rdp1', vpsId: 'botscope-rdp1', chatId: BOT_CHAT, host: RDP_IP, isRDP: true, status: 'ACTIVE' } }, { upsert: true })
  await db.collection('domainsOf').updateOne({ _id: 'botscope-dom' }, { $set: { _id: 'botscope-dom', chatId: BOT_CHAT, domainName: RDP_DOMAIN } }, { upsert: true })
}
async function cleanup(db) {
  await db.collection('cpanelAccounts').deleteOne({ _id: BOT_USER })
  await db.collection('shortenerActivations').deleteOne({ _id: BOT_SHORT })
  await db.collection('vpsPlansOf').deleteOne({ _id: 'botscope-rdp1' })
  await db.collection('domainsOf').deleteOne({ _id: 'botscope-dom' })
  await db.collection(mon.COLLECTION).deleteMany({ chatId: BOT_CHAT })
}

;(async () => {
  const client = new MongoClient(MONGO_URL); await client.connect()
  const db = client.db(DB_NAME)
  await cleanup(db); await seed(db)
  const resolve4 = async (host) => (host === RDP_DOMAIN ? [RDP_IP] : [])

  // 1) scope:'reseller' (no reseller key for this chatId) → bot domains NOT enumerated.
  const resellerItems = await mon.enumerateLinkedDomains(db, { scope: 'reseller', resolve4 })
  const inReseller = resellerItems.some(i => i.chatId === BOT_CHAT)
  ok('scope reseller EXCLUDES bot domains', !inReseller, resellerItems.filter(i => i.chatId === BOT_CHAT))

  // 2) scope:'all' → bot hosting + shortener + rdp are enumerated.
  const allItems = await mon.enumerateLinkedDomains(db, { scope: 'all', resolve4 })
  const byDomain = Object.fromEntries(allItems.filter(i => i.chatId === BOT_CHAT).map(i => [i.domain, i.product]))
  ok('scope all → bot hosting enumerated', byDomain[BOT_HOST] === 'hosting', byDomain[BOT_HOST])
  ok('scope all → bot shortener enumerated', byDomain[BOT_SHORT] === 'shortener', byDomain[BOT_SHORT])
  ok('scope all → bot rdp enumerated', byDomain[RDP_DOMAIN] === 'rdp', byDomain[RDP_DOMAIN])

  // 3) scope:'all' sweep flags + unlinks the bot hosting domain.
  const emitCalls = []; const actionCalls = []
  const emit = async (_db, ev) => { emitCalls.push(ev.event + ':' + ev.payload.domain); return { delivered: 0, skipped: 1 } }
  const actions = {
    hosting: async (_db, it) => { actionCalls.push('hosting:' + it.domain); return { ok: true, action: 'hosting_suspended' } },
    shortener: async (_db, it) => { actionCalls.push('shortener:' + it.domain); return { ok: true } },
    vps: async (_db, it) => { actionCalls.push('vps:' + it.domain); return { ok: true } },
    rdp: async (_db, it) => { actionCalls.push('rdp:' + it.domain); return { ok: true } },
  }
  const sb = { isConfigured: () => true, checkDomain: async (d) => (d === BOT_HOST ? { safe: false, threats: [{ type: 'SOCIAL_ENGINEERING' }] } : { safe: true, threats: [] }) }

  const sweep = await mon.runSweep(db, { enforce: true, sb, emit, actions, resolve4, scope: 'all' })
  ok('scope all sweep flags the bot hosting domain', sweep.flaggedList.includes(BOT_HOST), sweep.flaggedList)
  ok('scope all sweep unlinks the bot hosting domain', actionCalls.includes('hosting:' + BOT_HOST), actionCalls)
  const flag = await mon.getFlag(db, BOT_HOST)
  ok('bot hosting flag recorded + unlinked', flag && flag.flagged === true && flag.status === 'unlinked', flag && { f: flag.flagged, s: flag.status })
  const acct = await db.collection('cpanelAccounts').findOne({ _id: BOT_USER })
  ok('bot cpanel stamped sbFlagged', acct && acct.sbFlagged === true, acct && acct.sbFlagged)

  // 4) recheck window: clean bot domains got a tracked record → a second immediate
  //    sweep skips them (rotation / quota-friendly).
  const sweep2 = await mon.runSweep(db, { enforce: true, sb, emit, actions, resolve4, scope: 'all' })
  ok('2nd sweep skips recently-clean (due < total)', sweep2.due < sweep2.total, { due: sweep2.due, total: sweep2.total })

  await cleanup(db); await client.close()
  let pass = true
  for (const [name, good, detail] of results) { console.log(`${good ? 'PASS' : 'FAIL'} — ${name}${good ? '' : ' :: ' + JSON.stringify(detail)}`); if (!good) pass = false }
  console.log(pass ? '\nALL PASS' : '\nSOME FAILED')
  process.exit(pass ? 0 : 1)
})().catch((e) => { console.error('ERROR', e); process.exit(2) })
