// SMADAV silent .it domain swap (approved by owner): 73sandoresworld.it -> 72sandoresworld.it on cPanel nsan2e0c
// Usage on droplet (inside app-wl release): STEP=<email|cancel_old|register_new|whm_swap|dns|verify> node smadav_it_swap_exec.js
require('dotenv').config({ path: process.env.ENV_PATH })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const R = process.env.REL
const op = require(R + '/js/op-service.js')
const cf = require(R + '/js/cf-service.js')

const OLD = '73sandoresworld.it'
const NEW = '72sandoresworld.it'
const CP_USER = 'nsan2e0c'
const CHAT_ID = '8514352552'
const HANDLE = 'MR971932-IT'
const NEW_EMAIL = 'hosta1@proton.me'
const OLD_OP_ID = 30421768
const OLD_CF_ZONE = '6b54f670587a2a4219c55e7723ee000d'
const B = 'https://api.openprovider.eu'
const nowIso = () => new Date().toISOString()

const steps = {
  async email() {
    const h = { Authorization: 'Bearer ' + (await op.authenticate()), 'Content-Type': 'application/json' }
    const before = (await axios.get(`${B}/v1beta/customers/${HANDLE}`, { headers: h })).data.data.email
    if (before !== NEW_EMAIL) {
      const r = await axios.put(`${B}/v1beta/customers/${HANDLE}`, { email: NEW_EMAIL }, { headers: h })
      console.log('PUT code', r.data.code, r.data.desc || '')
    }
    const after = (await axios.get(`${B}/v1beta/customers/${HANDLE}`, { headers: h })).data.data.email
    console.log(`${HANDLE} email: ${before} -> ${after}`, after === NEW_EMAIL ? 'OK' : 'FAIL')
  },

  async cancel_old() {
    const h = { Authorization: 'Bearer ' + (await op.authenticate()) }
    const info = await op.getDomainInfo(OLD)
    if (info && info.domainId === OLD_OP_ID && info.status !== 'DEL') {
      const r = await axios.delete(`${B}/v1beta/domains/${OLD_OP_ID}`, { headers: h }).catch(e => e.response)
      console.log('OP DELETE', r.status, JSON.stringify(r.data))
    }
    const after = await op.getDomainInfo(OLD)
    console.log('OP old after:', after ? `${after.domainId} ${after.status}` : 'NOT IN ACCOUNT')
  },

  async register_new(db) {
    const existing = await op.getDomainInfo(NEW)
    if (existing) { console.log('NEW already in OP account:', existing.domainId, existing.status) }
    else {
      const ds = require(R + '/js/domain-service.js')
      const res = await ds.registerDomain(NEW, 'OpenProvider', 'cloudflare', db, CHAT_ID, null, (s) => console.log('progress', s))
      console.log('registerDomain:', JSON.stringify(res))
      if (!res.success) return
    }
    const info = await op.getDomainInfo(NEW)
    const zone = await cf.getZoneByName(NEW)
    const t = new Date()
    await db.collection('registeredDomains').updateOne({ _id: NEW }, {
      $set: {
        'val.domain': NEW, 'val.provider': 'OpenProvider', 'val.registrar': 'OpenProvider',
        'val.nameserverType': 'cloudflare', 'val.nameservers': zone?.name_servers || [],
        'val.autoRenew': true, 'val.ownerChatId': CHAT_ID, 'val.status': 'registered',
        'val.registeredAt': t, 'val.linkedAt': t, 'val.cfZoneId': zone?.id || null, 'val.opDomainId': info?.domainId || null,
        'val.replacesDomain': OLD,
      },
    }, { upsert: true })
    console.log('OP new:', info?.domainId, info?.status, info?.nameservers, '| CF zone:', zone?.id, zone?.status, zone?.name_servers)
  },

  async whm_swap(db) {
    const whm = require(R + '/js/whm-service.js')
    const acct = await db.collection('cpanelAccounts').findOne({ _id: CP_USER })
    if (acct.domain !== NEW) {
      const r = await whm.changePrimaryDomain(CP_USER, NEW)
      console.log('WHM modifyacct:', JSON.stringify(r))
      if (!r.success) return
      await db.collection('cpanelAccounts').updateOne({ _id: CP_USER }, {
        $set: { domain: NEW, previousPrimaryDomain: OLD, primaryChangedAt: nowIso(), primarySwapReason: 'it_verification_email_lost_silent_swap' },
        $pull: { addonDomains: NEW },
      })
    }
    await db.collection('hostingTransactions').updateMany({ chatId: CHAT_ID, domain: OLD }, { $set: { domain: NEW, originalDomain: OLD, domainSwappedAt: nowIso() } })
    await db.collection('domainsOf').deleteMany({ domainName: OLD, chatId: CHAT_ID })
    await db.collection('registeredDomains').deleteOne({ _id: OLD })
    await db.collection('dnsHealState').deleteOne({ _id: OLD })
    await db.collection('safeBrowsingFlags').deleteOne({ _id: OLD })
    await db.collection('nsAuditLog').insertOne({ domain: NEW, chatId: CHAT_ID, action: 'silent_primary_swap', before: OLD, after: NEW, ts: nowIso(), appliedBy: 'ops/smadav_it_swap_exec' }).catch(() => {})
    const info = await whm.getAccountInfo(CP_USER).catch(e => ({ error: e.message }))
    console.log('WHM acct now:', info?.data?.domain, info?.data?.user, info?.success)
  },

  async dns(db) {
    const antiRed = require(R + '/js/anti-red-service.js')
    await antiRed.removeWorkerRoutes(OLD, OLD_CF_ZONE).catch(e => console.log('removeWorkerRoutes warn', e.message))
    console.log('CF delete old zone:', JSON.stringify(await cf.deleteZone(OLD_CF_ZONE)))
    const acct = await db.collection('cpanelAccounts').findOne({ _id: CP_USER })
    const af = require(R + '/js/addon-domain-flow.js')
    await af.runDnsAndProtection({ domain: NEW, cpUser: CP_USER, whmHost: acct.whmHost, account: acct, db, bot: null, lang: 'en' })
    console.log('runDnsAndProtection done')
  },

  async verify(db) {
    const red = (k, v) => (/pass|token|secret|pin|_iv|_tag|encrypted/i.test(k) ? '<redacted>' : v)
    const acct = await db.collection('cpanelAccounts').findOne({ _id: CP_USER })
    console.log('cpanelAccounts:', JSON.stringify({ domain: acct.domain, previousPrimaryDomain: acct.previousPrimaryDomain, primaryChangedAt: acct.primaryChangedAt }, red))
    console.log('hostingTransactions:', JSON.stringify(await db.collection('hostingTransactions').find({ chatId: CHAT_ID, $or: [{ domain: NEW }, { domain: OLD }] }).project({ domain: 1, originalDomain: 1, outcome: 1 }).toArray()))
    console.log('registeredDomains NEW:', JSON.stringify(await db.collection('registeredDomains').findOne({ _id: NEW })))
    console.log('registeredDomains OLD:', JSON.stringify(await db.collection('registeredDomains').findOne({ _id: OLD })))
    console.log('domainsOf:', JSON.stringify(await db.collection('domainsOf').find({ chatId: CHAT_ID, domainName: { $in: [NEW, OLD] } }).toArray()))
    const whm = require(R + '/js/whm-service.js')
    const info = await whm.getAccountInfo(CP_USER).catch(e => ({ error: e.message }))
    console.log('WHM acct:', JSON.stringify(info, red).slice(0, 600))
    const h = { Authorization: 'Bearer ' + (await op.authenticate()) }
    console.log('OP handle email:', (await axios.get(`${B}/v1beta/customers/${HANDLE}`, { headers: h })).data.data.email)
    const n = await op.getDomainInfo(NEW); const o = await op.getDomainInfo(OLD)
    console.log('OP NEW:', n ? `${n.domainId} ${n.status} ${n.nameservers}` : 'none', '| OP OLD:', o ? `${o.domainId} ${o.status}` : 'none')
    const zn = await cf.getZoneByName(NEW); const zo = await cf.getZoneByName(OLD)
    console.log('CF NEW:', zn ? `${zn.id} ${zn.status} ${zn.name_servers}` : 'none', '| CF OLD:', zo ? `${zo.id} ${zo.status}` : 'none')
    if (zn) console.log('CF NEW records:', JSON.stringify((await cf.listDNSRecords(zn.id)).map(r => `${r.type} ${r.name} -> ${r.content}`)))
  },
}

;(async () => {
  const step = process.env.STEP
  if (!steps[step]) throw new Error('STEP must be one of ' + Object.keys(steps).join(','))
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const db = c.db(process.env.DB_NAME)
  console.log(`=== STEP ${step} @ ${nowIso()} ===`)
  await steps[step](db)
  await new Promise(r => setTimeout(r, 1000))
  await c.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e.message, JSON.stringify(e.response?.data || '')); process.exit(1) })
