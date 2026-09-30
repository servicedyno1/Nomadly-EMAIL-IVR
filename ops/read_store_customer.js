'use strict'
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')

  const o = await db.collection('webOrders').findOne({ _id: '9fd5da6a-d587-4de1-a3a3-1bd75d315149' })
  console.log('=== FULL webOrders doc (all keys) ===')
  console.log(JSON.stringify(o, null, 1))

  const email = 'triborg799@protonmail.com'
  console.log('\n=== webUsers by email', email, '===')
  const wu = await db.collection('webUsers').find({ email }).toArray().catch(() => [])
  for (const u of wu) console.log(JSON.stringify({ _id: u._id, email: u.email, username: u.username, tgChatId: u.tgChatId, tgUsername: u.tgUsername, createdAt: u.createdAt }))
  if (!wu.length) console.log('(no webUser with that email)')

  // any other orders by this guest email
  console.log('\n=== all webOrders by this email ===')
  const all = await db.collection('webOrders').find({ email }).toArray().catch(() => [])
  for (const x of all) console.log(JSON.stringify({ _id: x._id, coin: x.coin, status: x.status, domain: x.domain, createdAt: x.createdAt }))

  // the bot-login webUser seen at 17:15 (tgChatId 652303768) — is it the same person?
  console.log('\n=== tgChatId 652303768 (bot-login at 17:15) ===')
  const u2 = await db.collection('webUsers').findOne({ tgChatId: '652303768' }).catch(() => null)
  console.log('webUser:', u2 ? JSON.stringify({ email: u2.email, username: u2.username, tgUsername: u2.tgUsername }) : '(none)')
  const tgUser = await db.collection('users').findOne({ chatId: '652303768' }).catch(() => null)
  console.log('Telegram users doc:', tgUser ? JSON.stringify({ chatId: tgUser.chatId, username: tgUser.username, firstName: tgUser.firstName }) : '(none)')

  await client.close()
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
