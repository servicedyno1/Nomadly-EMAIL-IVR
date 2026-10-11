/* global process */
// Local, mock-driven verification for the Safe Browsing monitor (Issue 3).
// Seeds the LOCAL db only, injects a mock Safe-Browsing checker + mock webhook
// emit + mock unlink actions, and asserts enumerate → flag → notify → unlink +
// idempotency + status queries. Never touches production or real CF/WHM.
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const mon = require('/app/js/safe-browsing-monitor')

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test'
const OWNER = '555000111'

const KEY_ID = 'sbtest-key'
const HOST_USER = 'sbtestuser'
const HOST_DOMAIN = 'sbflaggedhost.test'
const HOST_ADDON = 'sbaddon.test'
const SHORT_DOMAIN = 'go.sbshort.test'
const VPS_DOMAIN = 'sbvpsdomain.test'
const VPS_IP = '203.0.113.9'

const results = []
const ok = (name, cond, detail) => { results.push([name, !!cond, detail]); }

async function seed(db) {
  await db.collection('resellerApiKeys').updateOne({ _id: KEY_ID }, { $set: { _id: KEY_ID, ownerChatId: OWNER, enabled: true, webhookUrl: 'https://example.com/hook', webhookSecret: 'whsec_test' } }, { upsert: true })
  await db.collection('cpanelAccounts').updateOne({ _id: HOST_USER }, { $set: { _id: HOST_USER, cpUser: HOST_USER, chatId: OWNER, domain: HOST_DOMAIN, addonDomains: [HOST_ADDON], plan: 'Premium', provisionState: 'completed', whmHost: '198.51.100.5' } }, { upsert: true })
  await db.collection('shortenerActivations').updateOne({ _id: SHORT_DOMAIN }, { $set: { _id: SHORT_DOMAIN, domain: SHORT_DOMAIN, chatId: OWNER, status: 'completed', server: VPS_IP } }, { upsert: true })
  await db.collection('vpsPlansOf').updateOne({ _id: 'sbvps1' }, { $set: { _id: 'sbvps1', vpsId: 'sbvps1', chatId: OWNER, host: VPS_IP, isRDP: false, status: 'ACTIVE' } }, { upsert: true })
  await db.collection('domainsOf').updateOne({ _id: 'sbtest-dom' }, { $set: { _id: 'sbtest-dom', chatId: OWNER, domainName: VPS_DOMAIN } }, { upsert: true })
}

async function cleanup(db) {
  await db.collection('resellerApiKeys').deleteOne({ _id: KEY_ID })
  await db.collection('cpanelAccounts').deleteOne({ _id: HOST_USER })
  await db.collection('shortenerActivations').deleteOne({ _id: SHORT_DOMAIN })
  await db.collection('vpsPlansOf').deleteOne({ _id: 'sbvps1' })
  await db.collection('domainsOf').deleteOne({ _id: 'sbtest-dom' })
  await db.collection(mon.COLLECTION).deleteMany({ chatId: OWNER })
}

;(async () => {
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(DB_NAME)
  await cleanup(db)
  await seed(db)

  const resolve4 = async (host) => (host === VPS_DOMAIN ? [VPS_IP] : [])

  // 1) Enumeration
  const items = await mon.enumerateLinkedDomains(db, { owners: [OWNER], resolve4 })
  const byDomain = Object.fromEntries(items.map(i => [i.domain, i.product]))
  ok('enumerate host main', byDomain[HOST_DOMAIN] === 'hosting', byDomain[HOST_DOMAIN])
  ok('enumerate host addon', byDomain[HOST_ADDON] === 'hosting', byDomain[HOST_ADDON])
  ok('enumerate shortener', byDomain[SHORT_DOMAIN] === 'shortener', byDomain[SHORT_DOMAIN])
  ok('enumerate vps domain', byDomain[VPS_DOMAIN] === 'vps', byDomain[VPS_DOMAIN])

  // 2) Sweep with mocks: flag host main + shortener only.
  const emitCalls = []
  const actionCalls = []
  const emit = async (_db, ev) => { emitCalls.push(ev.event + ':' + ev.payload.domain); return { delivered: 1, skipped: 0 } }
  const actions = {
    hosting: async (_db, it) => { actionCalls.push('hosting:' + it.domain); return { ok: true, action: 'hosting_suspended' } },
    shortener: async (_db, it) => { actionCalls.push('shortener:' + it.domain); return { ok: true, action: 'shortener_deactivated' } },
    vps: async (_db, it) => { actionCalls.push('vps:' + it.domain); return { ok: true } },
    rdp: async (_db, it) => { actionCalls.push('rdp:' + it.domain); return { ok: true } },
  }
  const sb = {
    isConfigured: () => true,
    checkDomain: async (d) => (d === HOST_DOMAIN || d === SHORT_DOMAIN)
      ? { safe: false, threats: [{ type: 'MALWARE' }] }
      : { safe: true, threats: [] },
  }

  const sweep = await mon.runSweep(db, { enforce: true, sb, emit, actions, resolve4, owners: [OWNER] })
  ok('sweep flagged count = 2', sweep.flagged === 2, sweep)
  ok('emit hosting.flagged fired', emitCalls.includes('hosting.flagged:' + HOST_DOMAIN), emitCalls)
  ok('emit shortener.flagged fired', emitCalls.includes('shortener.flagged:' + SHORT_DOMAIN), emitCalls)
  ok('no false flag on addon/vps', !emitCalls.some(c => c.includes(HOST_ADDON) || c.includes(VPS_DOMAIN)), emitCalls)
  ok('unlink hosting called', actionCalls.includes('hosting:' + HOST_DOMAIN), actionCalls)
  ok('unlink shortener called', actionCalls.includes('shortener:' + SHORT_DOMAIN), actionCalls)

  // 3) Flag records persisted with status unlinked
  const hostFlag = await mon.getFlag(db, HOST_DOMAIN)
  ok('host flag status unlinked', hostFlag && hostFlag.status === 'unlinked' && hostFlag.flagged === true, hostFlag && { s: hostFlag.status, f: hostFlag.flagged })
  const shortFlag = await mon.getFlag(db, SHORT_DOMAIN)
  ok('shortener flag status unlinked', shortFlag && shortFlag.status === 'unlinked', shortFlag && shortFlag.status)

  // 4) Resource docs stamped (status "available if called")
  const acct = await db.collection('cpanelAccounts').findOne({ _id: HOST_USER })
  ok('cpanel stamped sbFlagged', acct && acct.sbFlagged === true, acct && acct.sbFlagged)
  const act = await db.collection('shortenerActivations').findOne({ _id: SHORT_DOMAIN })
  ok('shortener stamped sbFlagged', act && act.sbFlagged === true, act && act.sbFlagged)

  // 5) listFlags + publicFlagView
  const flags = await mon.listFlags(db, { chatId: OWNER })
  ok('listFlags returns 2', flags.length === 2, flags.map(f => f.domain))
  const view = mon.publicFlagView(hostFlag)
  ok('publicFlagView shape', view && view.domain === HOST_DOMAIN && view.status === 'unlinked' && Array.isArray(view.threats), view)

  // 6) Idempotency — second sweep must NOT re-notify / re-unlink already-handled flags
  emitCalls.length = 0; actionCalls.length = 0
  const sweep2 = await mon.runSweep(db, { enforce: true, sb, emit, actions, resolve4, owners: [OWNER] })
  ok('2nd sweep still finds 2 flagged', sweep2.flagged === 2, sweep2.flagged)
  ok('2nd sweep does NOT re-notify', emitCalls.length === 0, emitCalls)
  ok('2nd sweep does NOT re-unlink', actionCalls.length === 0, actionCalls)

  await cleanup(db)
  await client.close()

  let pass = true
  for (const [name, good, detail] of results) {
    console.log(`${good ? 'PASS' : 'FAIL'} — ${name}${good ? '' : ' :: ' + JSON.stringify(detail)}`)
    if (!good) pass = false
  }
  console.log(pass ? '\nALL PASS' : '\nSOME FAILED')
  process.exit(pass ? 0 : 1)
})().catch((e) => { console.error('ERROR', e); process.exit(2) })
