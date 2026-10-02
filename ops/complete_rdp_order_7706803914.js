#!/usr/bin/env node
// Manual completion of @morganfreebandzz's failed RDP order (2026-10-02, Azure 404).
// Mirrors the bot's wallet flow (_index.js 'vps-plan-pay'): debit → "payment received" →
// buyVPSPlanFullProcess (via /admin/comp-vps) → finalize.  Run ON THE DROPLET:
//   cd /opt/nomadly/current/app-main && NODE_PATH=$PWD/node_modules node ops/complete_rdp_order_7706803914.js <phase>
// phases: status | charge | provision | finalize | refund
'use strict'
require('dotenv').config({ path: process.env.ENV_FILE || '/opt/nomadly/shared/app-main/backend.env' })
const { MongoClient } = require('mongodb')
const { customAlphabet } = require('nanoid')
const nanoid = customAlphabet('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 5)

const CHAT_ID = '7706803914'
const USERNAME = 'morganfreebandzz'
const PRICE = 156
const MARKER = 'manual-rdp-completion-2026-10-02'
const ADMIN_KEY = String(process.env.SESSION_SECRET || '').slice(0, 16)
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN_PROD
const APP = process.env.APP_URL || 'http://127.0.0.1:5000'

// Power tier from the DO-RDP catalog (vm-instance-setup.fetchAvailableVPSConfigs shape), priced at
// the $156 the customer agreed to for the original Azure "RDP 20" order.
const vpsDetails = {
  isRDP: true,
  os: { name: '🖥 RDP', value: 'win', pricePerMonth: 0, isRDP: true },
  country: '🇪🇺 Europe (West)', region: 'EU', regionName: '🇪🇺 Europe (West)', zone: 'EU', zoneName: '🇪🇺 Europe (West)',
  diskType: 'nvme', diskLabel: '⚡ NVMe', diskTypeId: 'nvme',
  config: {
    _id: 'power-1m', name: 'Power — Windows RDP', cpuCores: 8, ramMb: 16384, ramGb: 16, diskMb: 327680, diskGb: 320,
    diskType: 'nvme', bandwidthTb: 4, portSpeedMbps: 1000, tier: 3,
    monthlyPrice: PRICE, basePriceUsd: PRICE, regionSurcharge: 0, windowsLicense: 0, totalBeforeMarkup: PRICE,
    billingCycles: [{ type: 'Monthly', price: PRICE, period: 1, productId: 'power-1m', discountPct: 0 }],
    specs: { vCPU: 8, RAM: 16, disk: 320, diskType: 'NVME' },
    specsStr: '8 vCPU · 16 GB RAM · 320 GB NVMe · Windows Server',
    isRDP: true,
  },
  plan: 'Monthly', durationMonths: 1, productId: 'power-1m', plantotalPrice: PRICE,
  couponApplied: false, couponDiscount: 0, planNewPrice: 0, autoRenewalPlan: true,
  selectedOSPrice: 0, selectedCpanelPrice: 0, totalPrice: PRICE.toFixed(2), _prevNavStep: 'rdp',
}

const PAYMENT_RECEIVED_EN = '✅ Payment successful!\n\nYour RDP is being set up — this takes a moment.\nYour login details will appear right here in the chat.'

async function tg(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json(); if (!j.ok) throw new Error(`telegram ${method}: ${j.description}`); return j.result
}

async function main() {
  const phase = process.argv[2]
  if (!['status', 'charge', 'provision', 'finalize', 'refund'].includes(phase)) throw new Error('usage: <status|charge|provision|finalize|refund>')
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db('test')
  const walletOf = db.collection('walletOf'), payments = db.collection('payments'), vpsPlansOf = db.collection('vpsPlansOf')
  const bal = async () => { const w = await walletOf.findOne({ _id: CHAT_ID }); return { usdIn: w.usdIn, usdOut: w.usdOut, usdBal: +(w.usdIn - w.usdOut).toFixed(2) } }
  const marker = await payments.findOne({ [MARKER]: true })
  const rdpRecords = await vpsPlansOf.find({ chatId: CHAT_ID, isRDP: true }).project({ _id: 1, contaboInstanceId: 1, host: 1, status: 1, productId: 1, region: 1, planPrice: 1, comp: 1, start_time: 1, end_time: 1, autoRenewable: 1 }).toArray()

  if (phase === 'status') {
    console.log(JSON.stringify({ wallet: await bal(), charged: !!marker, chargeLedger: marker, rdpRecords, txns: await db.collection('transactions').find({ chatId: CHAT_ID, type: 'vps' }).toArray() }, null, 1))
  }

  if (phase === 'charge') {
    if (marker) throw new Error('already charged (ledger marker present) — refusing to double-debit')
    if (rdpRecords.length) throw new Error('user already has an RDP record — refusing')
    const b = await bal(); if (b.usdBal < PRICE) throw new Error(`insufficient balance ${b.usdBal} < ${PRICE}`)
    await walletOf.updateOne({ _id: CHAT_ID }, { $inc: { usdOut: PRICE } })
    await payments.updateOne({ _id: nanoid() }, { $set: { val: `Wallet,VPSPlan,Monthly,$${PRICE},${CHAT_ID},${USERNAME},${new Date()}`, [MARKER]: true } }, { upsert: true })
    await tg('sendMessage', { chat_id: CHAT_ID, text: PAYMENT_RECEIVED_EN, reply_markup: { remove_keyboard: true } })
    console.log(JSON.stringify({ debited: PRICE, wallet: await bal(), paymentReceivedSent: true }))
  }

  if (phase === 'provision') {
    if (!marker) throw new Error('not charged yet — run charge first')
    if (rdpRecords.length) throw new Error('RDP record already exists — refusing to provision twice')
    // Plain http.request: no client-side timeout (comp-vps blocks until the IP lands, up to ~25 min).
    const body = JSON.stringify({ chatId: CHAT_ID, count: 1, compReason: `${MARKER}: Azure 404 on original RDP order; wallet debited $${PRICE} separately by ops script`, vpsDetails })
    const u = new URL(`${APP}/admin/comp-vps?key=${encodeURIComponent(ADMIN_KEY)}`)
    const out = await new Promise((resolve, reject) => {
      const req = require('http').request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
        let data = ''; res.on('data', d => data += d); res.on('end', () => resolve({ status: res.statusCode, data }))
      })
      req.on('error', reject); req.write(body); req.end()
    })
    console.log(out.status, out.data)
  }

  if (phase === 'finalize') {
    const rec = rdpRecords.sort((a, b) => new Date(b.start_time) - new Date(a.start_time))[0]
    if (!rec) throw new Error('no RDP record to finalize')
    await vpsPlansOf.updateOne({ _id: rec._id }, {
      $unset: { comp: '', compReason: '', compAt: '', compBy: '', compIndex: '', compOfTotal: '' },
      $set: { _manualOrderCompletion: { marker: MARKER, originalProductId: 'Standard_D4s_v6', originalProvider: 'azure', paidUsd: PRICE, paymentMethod: 'wallet', at: new Date() } },
    })
    await db.collection('abandonedCarts').updateOne({ chatId: CHAT_ID, status: { $in: ['in_progress', 'abandoned'] } }, { $set: { status: 'completed', completed: true, completedAt: new Date() } })
    console.log(JSON.stringify({ finalized: rec._id, record: await vpsPlansOf.findOne({ _id: rec._id }, { projection: { rootPasswordSecretId: 0 } }), wallet: await bal() }, null, 1))
  }

  if (phase === 'refund') {
    if (!marker) throw new Error('nothing to refund (no charge marker)')
    if (marker.refundedAt) throw new Error('already refunded')
    await walletOf.updateOne({ _id: CHAT_ID }, { $inc: { usdIn: PRICE } })
    await payments.updateOne({ _id: marker._id }, { $set: { refundedAt: new Date() } })
    console.log(JSON.stringify({ refunded: PRICE, wallet: await bal() }))
  }
  await client.close()
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
