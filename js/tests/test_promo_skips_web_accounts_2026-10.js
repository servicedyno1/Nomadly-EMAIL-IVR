// node js/tests/test_promo_skips_web_accounts_2026-10.js — bot promos + admin broadcasts never reach CloudIVR web accounts.
// Needs a local MongoDB (MONGO_URL); uses its own throwaway database.
const assert = require('assert')
const { MongoClient } = require('mongodb')
for (const k of ['OPENAI_API_KEY', 'OPEN_API_KEY', 'APP_OPEN_API_KEY', 'TELEGRAM_ADMIN_CHAT_ID']) delete process.env[k]
const ap = require('../auto-promo.js')
const { sendMessageToAllUsers, broadcastNewListing, getTelegramChatIds } = require('../utils.js')
const { isWebChatId } = require('../cloudivr-web/notify')

const TG = Array.from({ length: 16 }, (_, i) => String(100000001 + i))
const WEB = ['5000000000000001', 5000000000000002, '5000000000000003']

;(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db('promo_webskip_test')
  await db.dropDatabase()
  await db.collection('nameOf').insertMany([...TG, ...WEB].map(id => ({ _id: id, val: 'User' })))
  await db.collection('state').insertMany([...TG, ...WEB].map(id => ({ _id: String(id), userLanguage: 'en' })))
  const sent = []
  const bot = {
    sendMessage: async (chatId, text) => { sent.push({ chatId: String(chatId), text }); return {} },
    sendPhoto: async (chatId, file, opts) => { sent.push({ chatId: String(chatId), text: opts?.caption }); return {} },
    getMe: async () => ({ username: 'TestPromoBot' }),
    getChat: async () => { throw new Error('n/a') },
  }
  const inst = ap.initAutoPromo(bot, db, db.collection('nameOf'), db.collection('state'), null)
  await inst.broadcastPromoForLang(0, 'en', 'morning')
  await inst.broadcastPromoForLang(0, 'en', 'evening')
  const promoTo = sent.filter(s => /stoppromos/.test(s.text || '')).map(s => s.chatId)
  assert.ok(promoTo.length > 0, 'some Telegram users got the promo')
  assert.ok(promoTo.every(id => TG.includes(id)), `promo went only to Telegram users: ${promoTo.join(',')}`)
  assert.ok(!sent.some(s => isWebChatId(s.chatId)), 'no promo send to a web account')
  console.log(`PASS auto-promo: ${promoTo.length} Telegram sends, 0 web sends`)

  sent.length = 0
  await sendMessageToAllUsers(bot, 'Admin announcement', 'sendMessage', db.collection('nameOf'), '999', db)
  const got = sent.filter(s => s.text === 'Admin announcement').map(s => s.chatId)
  assert.deepStrictEqual([...got].sort(), [...TG].sort(), `admin broadcast reached exactly the Telegram users (got ${got.length})`)
  console.log(`PASS admin broadcast: ${got.length}/${TG.length} Telegram users, 0 web accounts`)

  sent.length = 0
  await broadcastNewListing(bot, { _id: 'p1', title: 'Test item', description: 'd', price: 5, category: 'misc', sellerId: TG[0] }, db.collection('nameOf'), db)
  const listing = sent.filter(s => /New Listing/.test(s.text || '')).map(s => s.chatId)
  assert.deepStrictEqual([...listing].sort(), TG.slice(1).sort(), `marketplace listing reached the Telegram users except the seller (got ${listing.length})`)
  console.log(`PASS marketplace listing: ${listing.length} Telegram users, 0 web accounts`)
  const tg = await getTelegramChatIds(db.collection('nameOf'))
  assert.ok(tg.length === TG.length && !tg.some(isWebChatId), 'getTelegramChatIds (used by /gift5all) drops web accounts')
  console.log('PASS getTelegramChatIds (gift5all): web accounts excluded')

  await db.dropDatabase()
  await client.close()
  console.log('ALL PASS')
  process.exit(0)
})().catch(e => { console.error('FAIL', e.message); process.exit(1) })
