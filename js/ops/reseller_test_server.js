require("../log-redact.js").installConsoleRedaction()
/* Standalone reseller-API test server (sandbox only).
 * Mounts the REAL reseller router on :5000 so the FastAPI proxy
 * (/api/reseller/v1/* → 127.0.0.1:5000/reseller/v1/*) reaches it.
 * External providers (WHM/Cloudflare/registrar) are stubbed so the agent
 * exercises OUR router logic without any live provider calls. isLive() is
 * forced false by SKIP_WEBHOOK_SYNC=true, so no mutations are possible. */
require('dotenv').config({ path: '/app/backend/.env' })
const crypto = require('crypto')
const express = require('express')
const { MongoClient } = require('mongodb')

const MONGO_URL = process.env.MONGO_URL
const DB_NAME = process.env.DB_NAME || 'test'
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')
const OWNER = 'gapfix-owner'
const KEY = 'nmdly_test_reseller_gapfix'

;(async () => {
  const client = new MongoClient(MONGO_URL); await client.connect()
  const db = client.db(DB_NAME)

  // ── seed (idempotent) ──
  await db.collection('resellerApiKeys').deleteMany({ ownerChatId: OWNER })
  await db.collection('resellerApiKeys').insertOne({ _id: 'gapfixkey', keyHash: sha256(KEY), enabled: true, ownerChatId: OWNER, label: 'gapfix-test' })
  await db.collection('domainsOf').deleteMany({ chatId: OWNER })
  await db.collection('domainsOf').insertOne({ chatId: OWNER, domainName: 'zone-a.example', registrar: 'OpenProvider', nameserverType: 'cloudflare', cfZoneId: 'zoneA' })
  await db.collection('registeredDomains').deleteOne({ _id: 'zone-a.example' })
  await db.collection('registeredDomains').insertOne({ _id: 'zone-a.example', val: { domain: 'zone-a.example', cfNameservers: ['x.ns.cloudflare.com', 'y.ns.cloudflare.com'], cfZoneId: 'zoneA', nameserverType: 'cloudflare' } })
  await db.collection('cpanelAccounts').deleteMany({ chatId: OWNER })
  await db.collection('cpanelAccounts').insertMany([
    // DB says active, but live WHM (stub) says suspended → tests Gap 7 (trust live + self-heal)
    { _id: 'gapacct1', cpUser: 'gapacct1', chatId: OWNER, domain: 'primary-a.example', plan: 'Premium Anti-Red', suspended: false, autoRenew: true, addonDomains: [{ domain: 'addon-a.example' }], createdAt: new Date(), expiryDate: new Date(Date.now() + 7 * 86400000) },
    // Suspended for non-payment with reason fields → tests Gap 4
    { _id: 'gapacct2', cpUser: 'gapacct2', chatId: OWNER, domain: 'primary-b.example', plan: 'Premium Anti-Red (1-Week)', suspended: true, suspendedReason: 'auto_renew_insufficient_funds', suspendedAt: new Date(), autoRenewLastError: 'insufficient_funds', autoRenewLastAttemptAt: new Date(), autoRenew: true, addonDomains: [], createdAt: new Date(), expiryDate: new Date(Date.now() - 86400000) },
  ])

  // ── stub external providers (no live calls) ──
  const whm = require('/app/js/whm-service')
  whm.getAccountInfo = async (u) => {
    if (u === 'gapacct1' || u === 'gapacct2') return { success: true, data: { suspended: 1, disklimit: '1024', diskused: '100', bwlimit: 'unlimited' } }
    return { success: false }
  }
  whm.getAccountBandwidth = async () => ({ success: false })
  whm.createUserSession = async () => ({ success: true, url: 'https://panel.example/cpsess/login' })
  const cfService = require('/app/js/cf-service')
  cfService.createDNSRecord = async (zoneId, type, name, content) => ({ success: true, name, type, content, cfRecordId: 'rec_' + Math.random().toString(36).slice(2, 8) })
  cfService.getZoneByName = async () => null
  const ds = require('/app/js/domain-service')
  ds.viewDNSRecords = async (domain) => ({ domain, records: [{ recordType: 'NS', recordContent: 'x.ns.cloudflare.com', recordName: domain }], source: 'cloudflare' })
  ds.checkDomainPrice = async (domain) => ({ available: true, price: 9.99, registrar: 'ConnectReseller', message: '' })

  // ── mount ──
  const { createResellerApi } = require('/app/js/reseller-api')
  const app = express(); app.use(express.json())
  app.use('/reseller/v1', createResellerApi({ getDb: () => db, log: () => {}, notifyAdmin: async () => {} }))
  app.listen(5000, '127.0.0.1', () => console.log(`[reseller-test-server] listening on 127.0.0.1:5000  key=${KEY}  owner=${OWNER}`))
})().catch(e => { console.error('SERVER ERROR', e); process.exit(2) })
