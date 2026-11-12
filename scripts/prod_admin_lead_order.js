// Admin-placed leads order, run on the prod droplet inside a brand release dir (uses that release's lead engine).
// Debits the wallet once (idempotent marker), tells the user it started, generates via validateBulkNumbers,
// delivers leads.txt to the user (+ admin copy) on that brand's bot. Job is parked as 'admin_running' so the
// bot's restart-resume never runs it twice.
// ENVF=/opt/nomadly/shared/app-wl/backend.env ORDER_ID=<id> CHAT_ID=<id> AMOUNT=1000 PRICE=150 COUNTRY=Canada AREA=Ontario CARRIER="Mixed Carriers" node prod_admin_lead_order.js
const fs = require('fs')
for (const l of fs.readFileSync(process.env.ENVF, 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const path = require('path'), R = (m) => require(path.join(process.cwd(), 'js', m))
const { MongoClient } = require('mongodb'), TelegramBot = require('node-telegram-bot-api')
const say = (...a) => console.log(new Date().toISOString(), ...a)
;(async () => {
  const { ORDER_ID, CHAT_ID, COUNTRY, AREA, CARRIER } = process.env, AMOUNT = Number(process.env.AMOUNT), PRICE = Number(process.env.PRICE)
  if (!ORDER_ID || !CHAT_ID || !AMOUNT || !PRICE) throw new Error('missing ORDER_ID/CHAT_ID/AMOUNT/PRICE')
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const { areasOfCountry, countryCodeOf } = R('areasOfCountry')
  const cc = countryCodeOf[COUNTRY], areaCodes = areasOfCountry[COUNTRY][AREA]
  const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN_PROD || process.env.TELEGRAM_BOT_TOKEN, { polling: false, baseApiUrl: process.env.TELEGRAM_API_BASE_URL || undefined })
  const me = await bot.getMe(); say(`BOT @${me.username} (expect ${process.env.TELEGRAM_BOT_USERNAME || '?'})`)
  if (process.env.EXPECT_BOT && me.username.toLowerCase() !== process.env.EXPECT_BOT.toLowerCase()) throw new Error('wrong bot')
  if (process.env.DRY === '1') { say('DRY RUN — areaCodes', areaCodes.join(','), 'cc', cc); process.exit(0) }
  const chatId = /^\d+$/.test(CHAT_ID) ? Number(CHAT_ID) : CHAT_ID
  const orders = db.collection('adminLeadOrders')
  if (await orders.findOne({ _id: ORDER_ID })) { say('ORDER EXISTS — refusing to charge twice', JSON.stringify(await orders.findOne({ _id: ORDER_ID }))); process.exit(2) }
  const w = await db.collection('walletOf').findOne({ _id: chatId }) || await db.collection('walletOf').findOne({ _id: String(chatId) })
  const bal = (w?.usdIn || 0) - (w?.usdOut || 0)
  if (!w || bal < PRICE) { say(`INSUFFICIENT balance $${bal.toFixed(2)} < $${PRICE}`); process.exit(3) }
  await orders.insertOne({ _id: ORDER_ID, chatId, amount: AMOUNT, price: PRICE, country: COUNTRY, area: AREA, carrier: CARRIER, areaCodes, status: 'charging', at: new Date() })
  await db.collection('walletOf').updateOne({ _id: w._id }, { $inc: { usdOut: PRICE } })
  const nb = bal - PRICE
  await orders.updateOne({ _id: ORDER_ID }, { $set: { status: 'charged', chargedAt: new Date(), balanceBefore: bal, balanceAfter: nb } })
  say(`CHARGED $${PRICE} → ${chatId}; balance $${bal.toFixed(2)} → $${nb.toFixed(2)}`)
  const label = `${AMOUNT.toLocaleString('en-US')} valid ${AREA} mobile numbers`
  await bot.sendMessage(chatId, `🧾 <b>Your order has started</b>\n\n📱 ${label} (${CARRIER.toLowerCase()})\n💰 <b>$${PRICE.toFixed(2)}</b> was charged from your wallet — new balance <b>$${nb.toFixed(2)}</b>.\n\n⏳ We're validating the numbers now. Your file will arrive right here in this chat when it's ready.`, { parse_mode: 'HTML' }).catch(e => say('start msg failed', e.message))

  const lj = R('lead-job-persistence.js'); lj.initLeadJobPersistence(db)
  const t0 = new Date()
  const park = setInterval(() => db.collection('leadJobs').updateMany({ chatId, status: 'running', createdAt: { $gte: t0 } }, { $set: { status: 'admin_running', adminOrderId: ORDER_ID } }).catch(() => {}), 2000)
  const { validateBulkNumbers } = R('validatePhoneBulk')
  let res
  try {
    res = await validateBulkNumbers(CARRIER, AMOUNT, cc, areaCodes, false, bot, chatId, 'en', false, { target: `${AREA} mobile numbers`, price: PRICE, walletDeducted: true, paymentCoin: 'ADMIN' })
  } catch (e) { res = null; say('GENERATION ERROR', e.message) }
  clearInterval(park)
  const job = await db.collection('leadJobs').findOne({ adminOrderId: ORDER_ID }) || await db.collection('leadJobs').findOne({ chatId, createdAt: { $gte: t0 } }, { sort: { createdAt: -1 } })
  if (job && job.status === 'admin_running') await db.collection('leadJobs').updateOne({ _id: job._id }, { $set: { status: res?.length ? 'completed' : 'admin_failed', adminOrderId: ORDER_ID } })
  const n = res?.length || 0
  say(`RESULT ${n}/${AMOUNT}${res?._partialReason ? ` partial=${res._partialReason}` : ''} job=${job?.jobId}`)
  const admin = process.env.TELEGRAM_ADMIN_CHAT_ID
  if (!n) {
    await orders.updateOne({ _id: ORDER_ID }, { $set: { status: 'failed', jobId: job?.jobId || null, endedAt: new Date() } })
    if (admin) await bot.sendMessage(admin, `🚨 <b>Admin leads order produced 0 numbers</b>\nUser ${chatId} · ${label}\n$${PRICE} was charged — decide on refund.`, { parse_mode: 'HTML' }).catch(() => {})
    process.exit(4)
  }
  const content = res.map(a => a[0]).join('\n'), buf = Buffer.from(content)
  await bot.sendDocument(chatId, buf, { caption: `📋 ${n} verified ${AREA} mobile numbers` }, { filename: 'leads.txt', contentType: 'text/plain' })
  if (admin) await bot.sendDocument(admin, buf, { caption: `📋 <b>[Admin order] ${n}/${AMOUNT} ${AREA} leads</b>\n👤 User: ${chatId} · $${PRICE} charged${res._partialReason ? `\n⚠️ partial: ${res._partialReason}` : ''}`, parse_mode: 'HTML' }, { filename: 'leads.txt', contentType: 'text/plain' }).catch(() => {})
  await orders.updateOne({ _id: ORDER_ID }, { $set: { status: n >= AMOUNT ? 'delivered' : 'partial_delivered', delivered: n, partialReason: res._partialReason || null, jobId: job?.jobId || null, endedAt: new Date() } })
  say(`DELIVERED ${n} to ${chatId}`)
  await cl.close(); process.exit(0)
})().catch(e => { say('FATAL', e.message, e.stack); process.exit(1) })
