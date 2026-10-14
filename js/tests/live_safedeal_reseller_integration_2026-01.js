#!/usr/bin/env node
// Live integration test for SafeDeal + Reseller flows via mock Telegram API + webhook
// Prereqs: mock_telegram_api.js on 5099, nodejs on 5000, TELEGRAM_API_BASE_URL set, mongo on localhost.
const http = require('http')
const { MongoClient } = require('mongodb')
const crypto = require('crypto')

const WEBHOOK = 'http://127.0.0.1:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const DB_NAME = process.env.DB_NAME || 'test'
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const ADMIN_CHAT = Number(process.env.TELEGRAM_ADMIN_CHAT_ID || '5590563715')
const BUYER = 990001
const SELLER = 990002

let pass = 0, fail = 0
const failures = []
function ok(name) { pass++; console.log('  ✅ ' + name) }
function bad(name, info) { fail++; failures.push({ name, info }); console.log('  ❌ ' + name + '  ' + (info||'')) }
function t(cond, name, info) { cond ? ok(name) : bad(name, info) }

function httpReq(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const data = body ? Buffer.from(JSON.stringify(body)) : null
    const req = http.request({
      method, hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}
    }, res => {
      let chunks = []
      res.on('data', c => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }) }
        catch { resolve({ status: res.statusCode, body: raw }) }
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

async function clearCalls() { await httpReq('DELETE', `${MOCK}/_calls`) }
async function getCalls(chat) {
  const r = await httpReq('GET', `${MOCK}/_calls?chat_id=${chat}`)
  return r.body
}
async function allCalls() {
  const r = await httpReq('GET', `${MOCK}/_calls`)
  return r.body
}
async function sendMessage(chatId, text, extra = {}) {
  const update = {
    update_id: Date.now() + Math.floor(Math.random()*1000),
    message: {
      message_id: Math.floor(Math.random()*100000),
      from: { id: chatId, is_bot: false, first_name: 'U'+chatId, language_code: 'en' },
      chat: { id: chatId, type: 'private' },
      date: Math.floor(Date.now()/1000),
      text,
      ...extra
    }
  }
  await httpReq('POST', WEBHOOK, update)
  await new Promise(r => setTimeout(r, 500))
}
async function sendCallback(chatId, data) {
  const update = {
    update_id: Date.now() + Math.floor(Math.random()*1000),
    callback_query: {
      id: String(Date.now()),
      from: { id: chatId, is_bot: false, first_name: 'U'+chatId, language_code: 'en' },
      message: { message_id: 1, chat: { id: chatId, type: 'private' }, date: 0, text: 'x' },
      chat_instance: 'ci',
      data
    }
  }
  await httpReq('POST', WEBHOOK, update)
  await new Promise(r => setTimeout(r, 500))
}

async function main() {
  const client = new MongoClient(MONGO_URL)
  await client.connect()
  const db = client.db(DB_NAME)

  const insertedProducts = []
  const touchedConvs = []

  // ---------- cleanup pre ----------
  await db.collection('state').deleteMany({ _id: { $in: [String(BUYER), String(SELLER)] } })
  await db.collection('marketplaceAccess').deleteMany({ _id: { $in: [BUYER, SELLER, String(BUYER), String(SELLER)] } })
  await db.collection('aiSupportChats').deleteMany({ chatId: { $in: [BUYER, SELLER, String(BUYER), String(SELLER)] } })
  await db.collection('supportSessions').deleteMany({ _id: { $in: [String(BUYER), String(SELLER), BUYER, SELLER] } })

  // seed users – state with language
  await db.collection('state').insertOne({ _id: String(BUYER), userLanguage: 'en' })
  await db.collection('state').insertOne({ _id: String(SELLER), userLanguage: 'fr' })
  // give both marketplace paid access
  for (const id of [BUYER, SELLER]) {
    await db.collection('marketplaceAccess').updateOne(
      { _id: id }, { $set: { _id: id, paid: true, grantedAt: new Date() } }, { upsert: true }
    )
  }

  try {
    // ======================================================================
    console.log('\n=== A1: Reseller → AI support session ===')
    await clearCalls()
    await sendMessage(BUYER, '💼 Reseller')
    const resCalls = await getCalls(BUYER)
    const resText = resCalls.map(c => c.text || '').join('\n')
    t(/50\/50/.test(resText), 'reseller text shows 50/50', resText.slice(0, 200))
    t(!/65\/35/.test(resText), 'no 65/35 anywhere')
    t(/AI assistant/i.test(resText) || /AI/i.test(resText), 'mentions AI assistant')
    t(/\/done/.test(resText), 'mentions /done')
    const btns = resCalls.flatMap(c => c.buttons || [])
    t(btns.includes('/done') && btns.includes('🏠 Main Menu'), 'reply keyboard /done + Main Menu', JSON.stringify(btns))

    const st = await db.collection('state').findOne({ _id: String(BUYER) })
    t(st && (st.action === 'supportChat'), 'state.action = supportChat', 'got '+(st && st.action))

    const sup = await db.collection('supportSessions').findOne({ _id: String(BUYER) })
    t(!!sup, 'supportSessions row created')

    const adminCalls = await getCalls(ADMIN_CHAT)
    const adminTxt = adminCalls.map(c => c.text || '').join('\n')
    t(/Reseller enquiry/i.test(adminTxt), 'admin got Reseller enquiry alert', adminTxt.slice(0, 200))

    const aiRow = await db.collection('aiSupportChats').findOne({ chatId: BUYER, role: 'assistant' })
    const aiRowStr = await db.collection('aiSupportChats').findOne({ chatId: String(BUYER), role: 'assistant' })
    const row = aiRow || aiRowStr
    t(row && /User opened the/.test(row.content || row.text || ''), 'aiSupportChats assistant seed row with "User opened the"', row ? JSON.stringify(row).slice(0,200) : 'no row')

    // Next free text → routed to supportChat
    await clearCalls()
    await sendMessage(BUYER, 'what is the profit split?')
    await new Promise(r => setTimeout(r, 3000)) // allow OpenAI
    const after = (await getCalls(BUYER)).map(c => c.text || '').join('\n')
    const adminAfter = (await getCalls(ADMIN_CHAT)).map(c => c.text || '').join('\n')
    t(after.length > 0 || adminAfter.length > 0, 'message routed to supportChat handler', 'buyer:'+after.slice(0,120)+' admin:'+adminAfter.slice(0,120))

    // /done closes session
    await clearCalls()
    await sendMessage(BUYER, '/done')
    const doneCalls = (await getCalls(BUYER)).map(c => c.text || '').join('\n')
    t(/rate|rating|⭐|thanks|closed|ended/i.test(doneCalls), '/done closes w/ rating or end msg', doneCalls.slice(0,200))
    const stAfter = await db.collection('state').findOne({ _id: String(BUYER) })
    t(stAfter && stAfter.action !== 'supportChat', 'state no longer supportChat', 'action='+(stAfter&&stAfter.action))

    // Reseller in FR
    await db.collection('state').updateOne({ _id: String(BUYER) }, { $set: { userLanguage: 'fr', action: null } })
    await clearCalls()
    const fr = require('/app/js/lang/fr.js').fr
    await sendMessage(BUYER, fr.user.becomeReseller)
    const frRes = (await getCalls(BUYER)).map(c => c.text || '').join('\n')
    t(/50\/50/.test(frRes) && !/65\/35/.test(frRes), 'fr reseller shows 50/50', frRes.slice(0, 150))
    // cleanup for next tests
    await db.collection('state').updateOne({ _id: String(BUYER) }, { $set: { userLanguage: 'en', action: null } })

    // ======================================================================
    console.log('\n=== B1-B2: Price validation ===')
    // Simulate price step: set state to action='mpAddPrice' or whatever is used
    // We just directly test server by reading marketplace-service.js
    const mps = require('/app/js/marketplace-service.js')
    t(mps.MIN_PRICE === 30 && mps.MAX_PRICE === 3000, 'MIN=30 MAX=3000')
    t(!mps.isEscrowPriceOk(25) && !mps.isEscrowPriceOk(3500), '25 & 3500 rejected')
    t(mps.isEscrowPriceOk(30) && mps.isEscrowPriceOk(3000), '30 & 3000 accepted')

    // ======================================================================
    console.log('\n=== B3/B4/B5: Marketplace escrow flow via chat ===')
    // Insert in-range product + conversation
    const productId = crypto.randomUUID()
    const convId = crypto.randomUUID()
    await db.collection('marketplaceProducts').insertOne({
      _id: productId, sellerId: String(SELLER), sellerUsername: 'test_seller', title: 'Vintage Monitor', price: 100,
      category: 'misc', status: 'active', images: [], description: 'test', currency: 'USD', createdAt: new Date().toISOString()
    })
    insertedProducts.push(productId)

    await db.collection('marketplaceConversations').insertOne({
      _id: convId, productId, productTitle: 'Vintage Monitor', sellerId: String(SELLER), buyerId: String(BUYER),
      originalPrice: 100, agreedPrice: 100, status: 'active', lastMessageAt: new Date().toISOString(), createdAt: new Date().toISOString(), messageCount: 0, escrowStartedAt: null
    })
    touchedConvs.push(convId)

    // Buyer enters chat first (simulate 'mp:chat' from product card)
    await db.collection('state').updateOne({ _id: String(BUYER) }, { $set: { action: 'mpChat', mpActiveConversation: String(convId) } })
    await db.collection('state').updateOne({ _id: String(SELLER) }, { $set: { action: 'mpChat', mpActiveConversation: String(convId) } })
    const sb = await db.collection('state').findOne({ _id: String(BUYER) })
    const ss = await db.collection('state').findOne({ _id: String(SELLER) })
    console.log('  >> state buyer:', JSON.stringify(sb))
    console.log('  >> state seller:', JSON.stringify(ss))
    console.log('  >> convId:', String(convId))

    await clearCalls()
    await sendMessage(BUYER, '/escrow')
    await new Promise(r => setTimeout(r, 800))
    const buyerSteps = (await getCalls(BUYER)).map(c => ({t:c.text||'', b: (c.reply_markup && (JSON.parse(typeof c.reply_markup==='string'?c.reply_markup:JSON.stringify(c.reply_markup)))) }))
    const sellerSteps = (await getCalls(SELLER)).map(c => ({t:c.text||'', b: (c.reply_markup) }))
    const bt = buyerSteps.map(x=>x.t).join('\n')
    const stx = sellerSteps.map(x=>x.t).join('\n')
    t(/SafeDeal/i.test(bt) && /buying/i.test(bt), 'buyer gets SafeDeal buyer steps (EN)', bt.slice(0,200))
    t(/Vintage Monitor/.test(bt), 'buyer sees product title in code')
    t(/5%/.test(bt) && /\$10/.test(bt), 'buyer sees 5% min $10 fee')
    t(/SafeDeal/.test(stx) && /safedeal\.sh/i.test(stx + JSON.stringify(sellerSteps)), 'seller gets SafeDeal seller msg (FR context)', stx.slice(0,250))
    // Verify French keywords in seller
    t(/Ouvrir SafeDeal/.test(JSON.stringify(sellerSteps)) || /acheteur/i.test(stx) || /vente/i.test(stx), 'seller msg in French', stx.slice(0,200))
    // Buttons must be https://safedeal.sh/#sd-start
    const allMarkup = JSON.stringify([buyerSteps, sellerSteps])
    t(/https:\/\/safedeal\.sh\/#sd-start/.test(allMarkup), 'button URL = https://safedeal.sh/#sd-start')
    t(!/lockbay/i.test(allMarkup), 'no Lockbay anywhere')

    // Conversation status escrow_started
    const convAfter = await db.collection('marketplaceConversations').findOne({ _id: convId })
    t(convAfter && convAfter.status === 'escrow_started', 'conversation.status = escrow_started', 'got '+(convAfter && convAfter.status))

    // Admin got notification
    const adm = (await getCalls(ADMIN_CHAT)).map(c => c.text||'').join('\n')
    t(/SafeDeal escrow started/i.test(adm) || /\[Marketplace\]/i.test(adm), 'admin notified', adm.slice(0,200))

    // ======================================================================
    console.log('\n=== B5: Out-of-range (legacy $20) ===')
    const convLow = crypto.randomUUID()
    await db.collection('marketplaceConversations').insertOne({
      _id: convLow, productId, productTitle: 'Vintage Monitor', sellerId: String(SELLER), buyerId: String(BUYER),
      originalPrice: 20, agreedPrice: 20, status: 'active', lastMessageAt: new Date().toISOString(), createdAt: new Date().toISOString(), messageCount: 0
    })
    touchedConvs.push(convLow)
    await db.collection('state').updateOne({ _id: String(BUYER) }, { $set: { mpActiveConversation: String(convLow), action: 'mpChat' } })
    await db.collection('state').updateOne({ _id: String(SELLER) }, { $set: { mpActiveConversation: String(convLow), action: 'mpChat' } })

    await clearCalls()
    await sendMessage(BUYER, '/escrow')
    const bLow = (await getCalls(BUYER)).map(c=>c.text||'').join('\n')
    const sLow = (await getCalls(SELLER)).map(c=>c.text||'').join('\n')
    t(/\$20/.test(bLow) || /20/.test(bLow), 'buyer gets out-of-range note with $20', bLow.slice(0,200))
    t(/\$30/.test(bLow) && /\$3,000|\$3000/.test(bLow), 'buyer sees $30 - $3,000 range')
    t(/\/price/.test(bLow), 'buyer sees /price hint')
    t(/\$20|20\.?00|20 \$|20\$/.test(sLow) && /30/.test(sLow) && /3[\s,.]?000/.test(sLow), 'seller gets out-of-range note too (any lang)', sLow.slice(0,250))
    const convLowAfter = await db.collection('marketplaceConversations').findOne({ _id: convLow })
    t(convLowAfter.status !== 'escrow_started', 'low-price conv NOT marked escrow_started', 'status='+convLowAfter.status)

    // ======================================================================
    console.log('\n=== B4: mp:escrow_product callback (Start Escrow from product card) ===')
    // Clean conv for buyer so a new one is created
    await db.collection('marketplaceConversations').deleteMany({ productId })
    await db.collection('state').updateOne({ _id: String(BUYER) }, { $set: { action: null, mpActiveConversation: null } })
    await clearCalls()
    await sendCallback(BUYER, `mp:escrow_product:${productId}`)
    await new Promise(r => setTimeout(r, 1200))
    const buyerCardCalls = (await getCalls(BUYER)).map(c=>c.text||'').join('\n')
    const sellerCardCalls = (await getCalls(SELLER)).map(c=>c.text||'').join('\n')
    t(/You entered chat|entered chat for|chat for/i.test(buyerCardCalls), 'buyer gets "You entered chat for ..."', buyerCardCalls.slice(0,250))
    t(/SafeDeal/i.test(buyerCardCalls) && /buying/i.test(buyerCardCalls), 'buyer gets SafeDeal buyer steps after entering chat')
    const stB4 = await db.collection('state').findOne({ _id: String(BUYER) })
    t(stB4?.action === 'mpChat' && !!stB4?.mpActiveConversation, 'buyer state → mpChat + mpActiveConversation', JSON.stringify(stB4).slice(0,200))
    t(/SafeDeal/i.test(sellerCardCalls) || /safedeal/i.test(sellerCardCalls), 'seller notified w/ SafeDeal steps (new conv)', sellerCardCalls.slice(0,200))

    // ======================================================================
    console.log('\n=== B6: Chat relay (safedeal link vs payment) ===')
    // reset to normal conv - find current active conv for product
    const activeConv = await db.collection('marketplaceConversations').findOne({ productId, buyerId: String(BUYER) })
    const convIdActive = activeConv ? activeConv._id : convId
    await db.collection('marketplaceConversations').updateOne({ _id: convIdActive }, { $set: { status: 'active' } })
    await db.collection('state').updateOne({ _id: String(BUYER) }, { $set: { mpActiveConversation: String(convIdActive), action: 'mpChat' } })
    await db.collection('state').updateOne({ _id: String(SELLER) }, { $set: { mpActiveConversation: String(convIdActive), action: 'mpChat' } })
    const convB6 = await db.collection('marketplaceConversations').findOne({ _id: convIdActive })
    console.log('  >> B6 conv:', JSON.stringify(convB6))

    await clearCalls()
    await sendMessage(BUYER, 'here is the deal https://safedeal.sh/deal/ac2f9b')
    await new Promise(r => setTimeout(r, 1200))
    const sellerRelay = (await getCalls(SELLER)).map(c=>c.text||'').join('\n')
    const buyerBack = (await getCalls(BUYER)).map(c=>c.text||'').join('\n')
    t(!/WARNING: Direct payment/i.test(sellerRelay) && !/WARNING: Direct payment/i.test(buyerBack), 'no payment warning for safedeal link')
    t(/safedeal\.sh\/deal\/ac2f9b/.test(sellerRelay), 'seller received the safedeal link')
    t(/SafeDeal/i.test(sellerRelay) && /invit/i.test(sellerRelay), 'seller got SafeDeal link note', sellerRelay.slice(0,250))

    await clearCalls()
    await sendMessage(BUYER, 'use @Lockbaybot')
    await new Promise(r => setTimeout(r, 1200))
    const warnSeller = (await getCalls(SELLER)).map(c=>c.text||'').join('\n')
    const warnBuyer = (await getCalls(BUYER)).map(c=>c.text||'').join('\n')
    t(/WARNING|⚠|🚨|scam|caution/i.test(warnSeller + warnBuyer), 'Lockbay triggers warning', (warnSeller+warnBuyer).slice(0,250))

    await clearCalls()
    await sendMessage(BUYER, 'send me the link')
    await new Promise(r => setTimeout(r, 1000))
    const flagMaybe = (await getCalls(SELLER)).map(c=>c.text||'').join('\n') + (await getCalls(BUYER)).map(c=>c.text||'').join('\n')
    t(!/WARNING: Direct payment/i.test(flagMaybe), '"send me the link" NOT flagged')

    // ======================================================================
    console.log('\n=== B7: AI support KB has SafeDeal, no live Lockbay recommend ===')
    const ai = require('/app/js/ai-support.js')
    const kb = require('fs').readFileSync('/app/js/ai-support.js', 'utf8')
    t(/safedeal/i.test(kb), 'KB mentions SafeDeal')
    t(/50\/50/.test(kb), 'KB mentions 50/50 reseller')
    // Lockbay only as discontinued/scam — not as instruction
    const lockMentions = (kb.match(/lockbay/gi) || []).length
    t(lockMentions === 0 || /discontinued|scam|do not use/i.test(kb), 'Lockbay only as discontinued/scam if mentioned', 'count='+lockMentions)
    t(typeof ai.addSupportContext === 'function', 'ai-support exports addSupportContext')

    // ======================================================================
    console.log('\n=== Summary ===')
    console.log(`PASS: ${pass}  FAIL: ${fail}`)
    if (fail) console.log('Failures:\n' + failures.map(f=>' - '+f.name+' | '+(f.info||'')).join('\n'))

  } finally {
    // ---------- cleanup ----------
    await db.collection('state').deleteMany({ _id: { $in: [String(BUYER), String(SELLER)] } })
    await db.collection('marketplaceAccess').deleteMany({ _id: { $in: [BUYER, SELLER] } })
    await db.collection('aiSupportChats').deleteMany({ chatId: { $in: [BUYER, SELLER, String(BUYER), String(SELLER)] } })
    await db.collection('supportSessions').deleteMany({ _id: { $in: [String(BUYER), String(SELLER)] } })
    for (const p of insertedProducts) await db.collection('marketplaceProducts').deleteOne({ _id: p })
    await db.collection('marketplaceConversations').deleteMany({ $or: [ { buyerId: { $in: [String(BUYER), BUYER] } }, { sellerId: { $in: [String(SELLER), SELLER] } } ] })
    for (const c of touchedConvs) await db.collection('marketplaceConversations').deleteOne({ _id: c })
    await client.close()
  }
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
