'use strict'
// Paid number orders that wait for a provider top-up: the number stays reserved for the buyer (nobody else can order it),
// a worker buys it once the balance is back, and after 48 h (or if the number is gone) the buyer is refunded to the wallet.
const crypto = require('crypto')
const log = (...a) => console.log('[PendingOrders]', ...a)
const MAX_AGE_MS = 48 * 3600000
let D = null, col = null
const held = new Set()

const isHeld = (phone) => held.has(String(phone || ''))
const providerMod = (p) => require(p === 'infobip' ? './infobip' : './multitel')

// Called by provider-health.buyWithBackup when the provider refused the buy for low balance.
function pendingResult(provider, phoneNumber) {
  const meta = providerMod(provider).searchedMeta?.(phoneNumber) || null
  const id = `pending:${crypto.randomUUID().slice(0, 12)}`
  if (!meta?.orderPrefix) held.add(phoneNumber) // an order-only prefix is a pool, not one number
  return { id, status: 'success', _pending: true, _provider: provider, _meta: meta, phone_numbers: [{ id, phone_number: phoneNumber, status: 'pending' }] }
}

// Callers store the waiting order after the number doc (status 'provisioning') is saved.
async function enqueue({ chatId, phoneNumber, order, amount, email = null, lang = 'en' }) {
  if (!col || !order?._pending) return
  await col.insertOne({ _id: order.id, chatId, phoneNumber, provider: order._provider, meta: order._meta, amount: Number(amount) || 0, email, lang, status: 'waiting', createdAt: new Date() })
  if (!order._meta?.orderPrefix) held.add(phoneNumber)
  D.notifyAdmin?.(`⏳ Order waiting for a ${order._provider} top-up: ${phoneNumber} for ${chatId} ($${Number(amount || 0).toFixed(2)} paid). It completes automatically once the balance is back; refunded after 48 h.`)
  D.adminEmail?.(`Order waiting for ${order._provider} top-up`, `<p><b>${phoneNumber}</b> was paid ($${Number(amount || 0).toFixed(2)}) but ${order._provider} balance is too low to buy it.</p><p>Top up and it completes automatically. Unfinished orders are refunded after 48 hours.</p>`)
}

const pendingMsg = (phone) => `⏳ <b>Payment received — setting up ${phone}</b>\nYour number is being provisioned. We'll message and email you as soon as it's ready (usually within a few hours).`

async function tell(o, text, subject) {
  D.send?.(o.chatId, text)
  if (o.email) D.email?.(o.email, subject, `<p>${text.split('\n').slice(1).join('</p><p>')}</p>`)
}

async function refund(o, why) {
  const r = await col.updateOne({ _id: o._id, status: 'waiting' }, { $set: { status: 'refunded', reason: why, doneAt: new Date() } })
  if (!r.modifiedCount) return
  await D.credit(o.chatId, o.amount)
  await D.removeNumber(o.chatId, o.phoneNumber)
  held.delete(o.phoneNumber)
  log(`refunded ${o._id} ${o.phoneNumber} $${o.amount}: ${why}`)
  await tell(o, `↩️ <b>${o.phoneNumber} is no longer available</b>\n$${o.amount.toFixed(2)} is back in your wallet. Please pick a new number.`, `${o.phoneNumber} unavailable — refunded`)
  D.notifyAdmin?.(`↩️ Waiting order ${o.phoneNumber} for ${o.chatId} refunded $${o.amount.toFixed(2)} (${why}).`)
}

async function complete(o) {
  const P = providerMod(o.provider)
  if (o.meta) P.remember?.(o.phoneNumber, o.meta)
  const r = await P.buyNumber(o.phoneNumber).catch(() => null)
  if (!r && P.wasNoFunds?.(o.phoneNumber)) return 'no_funds'
  if (!r) return refund(o, 'number no longer available')
  const phone = r.phone_numbers?.[0]?.phone_number || o.phoneNumber
  await col.updateOne({ _id: o._id }, { $set: { status: 'done', orderId: r.id, finalNumber: phone, doneAt: new Date() } })
  await D.activateNumber(o.chatId, o.phoneNumber, { phoneNumber: phone, telnyxOrderId: r.id, needsRegistration: !!r._needsRegistration })
  held.delete(o.phoneNumber)
  log(`completed ${o._id} → ${phone}`)
  await tell(o, `✅ <b>Your number ${phone} is ready</b>\nCalls and texts work now. Open your number to set it up.`, `Your number ${phone} is ready`)
}

let running = false
async function tick() {
  if (!col || running) return
  running = true
  try {
    const health = require('./provider-health'), stopped = new Set()
    // Oldest first; a provider that says "balance too low" stops its queue until the next tick (top-up).
    for (const o of await col.find({ status: 'waiting' }).sort({ createdAt: 1 }).toArray()) {
      if (Date.now() - new Date(o.createdAt).getTime() > MAX_AGE_MS) { await refund(o, 'not completed within 48 hours'); continue }
      if (stopped.has(o.provider) || health.isDown(o.provider)) continue
      const r = await complete(o).catch(e => log(`complete ${o._id}: ${e.message}`))
      if (r === 'no_funds') { stopped.add(o.provider); log(`${o.provider} balance too low — queue paused at ${o._id}`) }
    }
    await require('./spenza').retryAwaitingFunds?.().catch(e => log(`spenza: ${e.message}`))
  } finally { running = false }
}

async function init(deps) {
  D = deps; col = deps.db.collection('pendingNumberOrders')
  for (const o of await col.find({ status: 'waiting' }, { projection: { phoneNumber: 1 } }).toArray()) held.add(o.phoneNumber)
  require('./active-slot').singletonInterval('pending-number-orders', () => tick().catch(e => log(e.message)), 60000)
  log(`ready — ${held.size} waiting`)
}

module.exports = { init, tick, isHeld, pendingResult, enqueue, pendingMsg }
