'use strict'
// Paid number orders that wait for a provider top-up: the number stays reserved for the buyer (nobody else can order it),
// a worker buys it once the supplier works again (a similar number if that one is gone), and after 24 h the buyer is refunded.
// Calling numbers (Retell / Infobip / MultiTEL) and fax numbers (kind 'fax') use the same queue.
const crypto = require('crypto')
const log = (...a) => console.log('[PendingOrders]', ...a)
const MAX_AGE_MS = 24 * 3600000
const QUIET_MAX_AGE_MS = 7 * 24 * 3600000 // 2Chat: the admin can finish it by hand, so it waits longer
const RETRY_MS = 10 * 60000
let D = null, col = null
const held = new Set()
const quiet = new Set() // 2Chat holds: the buyer only ever sees "setting up"
const isQuiet = (p) => p === '2chat'

const isHeld = (phone) => held.has(String(phone || ''))
const providerMod = (p) => require(p === 'retell' ? './retell' : p === 'infobip' ? './infobip' : p === '2chat' ? './twochat' : './multitel')
const areaOf = (n) => (/^\+1\d{10}$/.test(String(n)) ? String(n).slice(2, 5) : null)

// Called by provider-health.buyWithBackup when the provider refused the buy for low balance.
function pendingResult(provider, phoneNumber, knownMeta = null) {
  const meta = knownMeta || providerMod(provider).searchedMeta?.(phoneNumber) || null
  const id = `pending:${crypto.randomUUID().slice(0, 12)}`
  if (!meta?.orderPrefix && !isQuiet(provider)) held.add(phoneNumber) // an order-only prefix is a pool, not one number
  if (isQuiet(provider)) quiet.add(phoneNumber)
  return { id, status: 'success', _pending: true, _provider: provider, _meta: meta, phone_numbers: [{ id, phone_number: phoneNumber, status: 'pending' }] }
}

// Callers store the waiting order after the number doc (status 'provisioning') is saved.
async function enqueue({ chatId, phoneNumber, order, amount, email = null, lang = 'en', kind = 'number' }) {
  if (!col || !order?._pending) return
  await col.insertOne({ _id: order.id, kind, chatId, phoneNumber, provider: order._provider, meta: order._meta, amount: Number(amount) || 0, email, lang, status: 'waiting', createdAt: new Date() })
  if (!order._meta?.orderPrefix && !isQuiet(order._provider)) held.add(phoneNumber)
  if (isQuiet(order._provider)) {
    const where = order._meta?.label || phoneNumber, why = order._meta?.why || 'supplier error'
    const text = `🛠 <b>2Chat order needs a hand</b> — ${order._meta?.type || 'local'} UK number in ${where} for ${chatId} ($${Number(amount || 0).toFixed(2)} paid). Reason: ${why}\nIt retries every ${RETRY_MS / 60000} min. Or buy one on 2Chat yourself, then enter it under CloudIVR Admin → Overview → 2Chat orders (add an Infobip landing number there too if Infobip is the problem). The customer only sees "setting up".`
    D.notifyAdmin?.(text); D.adminEmail?.('2Chat order needs a hand', `<p>${text.replace(/<\/?b>/g, '').replace(/\n/g, '</p><p>')}</p>`)
    return
  }
  D.notifyAdmin?.(`⏳ Order waiting on ${order._provider} (top-up or outage): ${phoneNumber} for ${chatId} ($${Number(amount || 0).toFixed(2)} paid). It completes automatically once the supplier works again; refunded after 24 h.`)
  D.adminEmail?.(`Order waiting for ${order._provider} top-up`, `<p><b>${phoneNumber}</b> was paid ($${Number(amount || 0).toFixed(2)}) but ${order._provider} balance is too low to buy it.</p><p>Top up and it completes automatically. Unfinished orders are refunded after 24 hours.</p>`)
}

const pendingMsg = (phone, kind = 'number') => quiet.has(String(phone)) ? `⏳ <b>Setting up your UK number</b> — ready shortly. We'll message you as soon as calls reach it.` : `⏳ <b>Payment received — setting up ${phone}</b>\nWe're reserving it with the carrier and try again every ${RETRY_MS / 60000} minutes on our own. ${kind === 'fax' ? 'Once it\'s reserved, receiving works straight away and sending in about 5 minutes.' : 'Once it\'s reserved, calls in work straight away and calls out in about 5 minutes.'} We'll message and email you when it's ready — if it isn't within 24 hours, you're refunded.`

async function tell(o, text, subject) {
  D.send?.(o.chatId, text)
  if (o.email) D.email?.(o.email, subject, `<p>${text.split('\n').slice(1).join('</p><p>')}</p>`)
}

async function refund(o, why) {
  const r = await col.updateOne({ _id: o._id, status: 'waiting' }, { $set: { status: 'refunded', reason: why, doneAt: new Date() } })
  if (!r.modifiedCount) return
  await D.credit(o.chatId, o.amount)
  if (o.kind === 'fax') await D.removeFax?.(o.chatId, o.phoneNumber)
  else await D.removeNumber(o.chatId, o.phoneNumber)
  held.delete(o.phoneNumber)
  log(`refunded ${o._id} ${o.phoneNumber} $${o.amount}: ${why}`)
  await tell(o, `↩️ <b>We couldn't set up ${o.phoneNumber}</b>\n$${o.amount.toFixed(2)} is back in your wallet. Please pick a new number.`, `${o.phoneNumber} could not be set up — refunded`)
  D.notifyAdmin?.(`↩️ Waiting order ${o.phoneNumber} for ${o.chatId} refunded $${o.amount.toFixed(2)} (${why}).`)
}

// Buy the paid number, or a similar one (same area code first) when it's gone. null = supplier still failing.
async function buyOrSimilar(o) {
  if (o.kind === 'fax') {
    const F = require('./infobip/fax')
    const first = await F.orderFax(o.phoneNumber).catch(e => { log(`fax ${o.phoneNumber}: ${e.message}`); return null })
    if (first) return { phone: first.phoneNumber, id: first.id }
    const alt = (await F.searchFax(o.meta?.country || 'US', areaOf(o.phoneNumber)).catch(() => [])).filter(n => n.phoneNumber !== o.phoneNumber)[0]
    const r = alt && await F.orderFax(alt.phoneNumber).catch(() => null)
    return r ? { phone: r.phoneNumber, id: r.id } : null
  }
  const P = providerMod(o.provider)
  if (o.meta) P.remember?.(o.phoneNumber, o.meta)
  let r = await P.buyNumber(o.phoneNumber).catch(() => null)
  if (!r && !isQuiet(o.provider) && !P.wasNoFunds?.(o.phoneNumber) && P.searchNumbers) {
    const cc = o.meta?.cc || 'US', type = o.meta?.type || 'local'
    const alt = (await P.searchNumbers(cc, type, areaOf(o.phoneNumber), 3).catch(() => [])).map(n => n.phone_number || n.phoneNumber).filter(n => n && n !== o.phoneNumber)[0]
    if (alt) r = await P.buyNumber(alt).catch(() => null)
  }
  if (r?._pending) return null // still waiting (2Chat hands back another hold)
  return r ? { phone: r.phone_numbers?.[0]?.phone_number || o.phoneNumber, id: r.id, landingNumber: r._landingNumber || null, needsRegistration: !!r._needsRegistration } : null
}

async function complete(o, given = null) {
  const got = given || await buyOrSimilar(o)
  if (!got) { await col.updateOne({ _id: o._id }, { $set: { nextTryAt: new Date(Date.now() + RETRY_MS) }, $inc: { tries: 1 } }); return 'failed' }
  const { phone } = got
  const won = await col.updateOne({ _id: o._id, status: 'waiting' }, { $set: { status: 'done', orderId: got.id, finalNumber: phone, doneAt: new Date() } })
  if (!won.modifiedCount) { log(`${o._id} was finished elsewhere — ${phone} left unassigned`); D.notifyAdmin?.(`⚠️ ${phone} (${o.provider}) was bought for ${o._id} but that order was already finished — release it if unused.`); return 'done' }
  if (o.kind === 'fax') await D.activateFax(o.chatId, o.phoneNumber, { phoneNumber: phone, orderId: got.id })
  else await D.activateNumber(o.chatId, o.phoneNumber, { phoneNumber: phone, telnyxOrderId: got.id, landingNumber: got.landingNumber, needsRegistration: got.needsRegistration })
  held.delete(o.phoneNumber); quiet.delete(o.phoneNumber)
  log(`completed ${o._id} → ${phone}`)
  if (isQuiet(o.provider)) { D.notifyAdmin?.(`✅ 2Chat order bought: ${phone} for ${o.chatId}. Next: its forward (alert follows).`); return 'done' } // the 2Chat watcher tells the buyer once calls reach it
  const swapped = phone !== o.phoneNumber ? ` (${o.phoneNumber} was taken, so you got a similar number)` : ''
  await tell(o, o.kind === 'fax'
    ? `✅ <b>Your fax number ${phone} is ready</b>${swapped}\nIt can send and receive faxes now.`
    : `✅ <b>Your number ${phone} is ready</b>${swapped}\nCalls work now. Open your number to set it up.`, `Your number ${phone} is ready`)
  D.notifyAdmin?.(`✅ Waiting order completed: ${phone} for ${o.chatId}${swapped ? ` (instead of ${o.phoneNumber})` : ''}.`)
}

let running = false
async function tick() {
  if (!col || running) return
  running = true
  try {
    const health = require('./provider-health'), stopped = new Set()
    // Oldest first; a provider that says "balance too low" stops its queue until the next tick (top-up).
    for (const o of await col.find({ status: 'waiting' }).sort({ createdAt: 1 }).toArray()) {
      if (Date.now() - new Date(o.createdAt).getTime() > (isQuiet(o.provider) ? QUIET_MAX_AGE_MS : MAX_AGE_MS)) { await refund(o, 'not completed within 24 hours'); continue }
      if (stopped.has(o.provider) || health.isDown(o.provider) || (o.nextTryAt && new Date(o.nextTryAt) > new Date())) continue
      const r = await complete(o).catch(e => log(`complete ${o._id}: ${e.message}`))
      if (r === 'failed') { stopped.add(o.provider); log(`${o.provider} still failing — queue paused at ${o._id}`) }
    }
    await require('./spenza').retryAwaitingFunds?.().catch(e => log(`spenza: ${e.message}`))
  } finally { running = false }
}

async function init(deps) {
  D = deps; col = deps.db.collection('pendingNumberOrders')
  for (const o of await col.find({ status: 'waiting' }, { projection: { phoneNumber: 1, provider: 1 } }).toArray()) (isQuiet(o.provider) ? quiet : held).add(o.phoneNumber)
  require('./active-slot').singletonInterval('pending-number-orders', () => tick().catch(e => log(e.message)), 60000)
  log(`ready — ${held.size} waiting`)
}

// Admin finished a waiting order by hand (2Chat: the number they bought + optional own Infobip landing number).
async function completeManual(id, number, landing = null) {
  const o = await col.findOne({ _id: id, status: 'waiting' })
  if (!o) throw new Error('That order is no longer waiting')
  const r = await providerMod(o.provider).adopt(number, landing || null, o.meta)
  const got = { phone: r.phone_numbers[0].phone_number, id: r.id, landingNumber: r._landingNumber || null }
  if (await complete(o, got) === 'failed') throw new Error('Could not finish the order')
  return got
}
const waiting = (provider) => col.find({ status: 'waiting', ...(provider ? { provider } : {}) }).sort({ createdAt: 1 }).toArray()

module.exports = { init, tick, isHeld, pendingResult, enqueue, pendingMsg, completeManual, waiting }
