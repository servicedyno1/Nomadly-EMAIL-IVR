#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
/* READ-ONLY production investigation for the 2026-09-27 anomalies:
 *  (1) $9999 forged-webhook overcredit  (2) accesd-securite.ca dead DNS
 *  (3) pentest/forged web orders. Only .find()/.findOne() — no writes. */
const fs = require('fs')
const { MongoClient } = require('mongodb')

const vault = fs.readFileSync('/tmp/vault_env', 'utf8')
const val = k => { const m = vault.match(new RegExp('^#?\\s*' + k + '="?([^"\\n]+)"?', 'm')); return m ? m[1].trim() : null }
const MONGO = val('ORIGINAL_PROD_MONGO_URL')
const DB = val('DB_NAME')

function mask(u) { return String(u || '').replace(/(:\/\/)[^@]*@/, '$1***@') }

;(async () => {
  if (!MONGO) { console.error('no prod mongo url'); process.exit(1) }
  console.log('connecting to', mask(MONGO), 'db=', DB)
  const c = new MongoClient(MONGO, { serverSelectionTimeoutMS: 15000 })
  await c.connect()
  const db = c.db(DB)

  const j = (o) => JSON.stringify(o)

  // ── Task 1: the $9999 credit ──
  console.log('\n===== TASK 1: $9999 topup =====')
  const order = await db.collection('webOrders').findOne({ _id: 'be6daa6f-0514-4433-80fb-1ea0ad47709c' })
  console.log('webOrder be6daa6f:', order ? j({ kind: order.kind, amountUsd: order.amountUsd, coin: order.coin, status: order.status, usdCredited: order.usdCredited, provider: order.provider, webUserId: order.webUserId, paymentId: order.paymentId, createdAt: order.createdAt }) : 'NOT FOUND')
  const wu = await db.collection('webUsers').findOne({ _id: 'af2061c7-034e-4a19-a257-cafbe00583b8' })
  console.log('webUser af2061c7 walletUsd:', wu ? wu.walletUsd : 'NOT FOUND', '| email:', wu?.email || '-', '| createdAt:', wu?.createdAt)
  const txns = await db.collection('webWalletTxns').find({ webUserId: 'af2061c7-034e-4a19-a257-cafbe00583b8' }).sort({ createdAt: -1 }).limit(10).toArray()
  console.log('recent txns for af2061c7:')
  txns.forEach(t => console.log('  ', j({ type: t.type, amountUsd: t.amountUsd, balanceAfter: t.balanceAfter, note: t.note, orderId: t.orderId, createdAt: t.createdAt })))

  // ── Task 2: accesd-securite.ca ──
  console.log('\n===== TASK 2: accesd-securite.ca =====')
  const rd = await db.collection('registeredDomains').findOne({ _id: 'accesd-securite.ca' })
  console.log('registeredDomains:', rd ? j({ _id: rd._id, val: rd.val }) : 'NOT FOUND')
  const cps = await db.collection('cpanelAccounts').find({ $or: [{ domain: /accesd-securite\.ca/i }, { 'addonDomains.domain': /accesd-securite\.ca/i }] }).toArray()
  console.log('cpanelAccounts matching accesd-securite.ca:', cps.length)
  cps.forEach(a => console.log('  ', j({ _id: a._id, cpUser: a.cpUser, domain: a.domain, plan: a.plan, deleted: a.deleted, whmHost: a.whmHost, nameservers: a.nameservers, registrar: a.registrar, webUserId: a.webUserId, chatId: a.chatId, createdAt: a.createdAt })))
  const wos = await db.collection('webOrders').find({ domain: /accesd-securite\.ca/i }).sort({ createdAt: 1 }).toArray()
  console.log('webOrders for accesd-securite.ca:', wos.length)
  wos.forEach(o => console.log('  ', j({ _id: o._id, kind: o.kind, plan: o.plan, amountUsd: o.amountUsd, status: o.status, domainMode: o.domainMode, registrar: o.registrar, username: o.username, nameservers: o.nameservers, note: o.note, email: o.email, createdAt: o.createdAt })))

  // ── Task 3: pentest/forged orders (last 48h) ──
  console.log('\n===== TASK 3: suspicious web orders =====')
  const since = new Date(Date.now() - 48 * 3600 * 1000)
  const sus = await db.collection('webOrders').find({ $or: [ { domain: /example\.com$|\.test\.com$|test\.com$|pent/i }, { status: 'failed' } ], createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(30).toArray()
  console.log('suspicious/failed orders last 48h:', sus.length)
  sus.forEach(o => console.log('  ', j({ _id: o._id, kind: o.kind, domain: o.domain, amountUsd: o.amountUsd, status: o.status, usdCredited: o.usdCredited, note: o.note, email: o.email, webUserId: o.webUserId, createdAt: o.createdAt })))

  // Any other wallet balances >= 500 (possible other exploited accounts)
  console.log('\n===== webUsers with walletUsd >= 500 =====')
  const rich = await db.collection('webUsers').find({ walletUsd: { $gte: 500 } }).project({ walletUsd: 1, email: 1, createdAt: 1 }).sort({ walletUsd: -1 }).limit(20).toArray()
  rich.forEach(u => console.log('  ', j({ _id: u._id, walletUsd: u.walletUsd, email: u.email, createdAt: u.createdAt })))

  await c.close()
  console.log('\nDONE (read-only).')
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
