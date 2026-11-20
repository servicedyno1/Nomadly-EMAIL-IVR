'use strict'
// Admin "Move bot plan": bot user's plan (+ extra numbers) → CloudIVR web account; other bots refused.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const { MongoClient } = require('mongodb')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { if (c) { pass++; console.log(`✅ ${n}`) } else { fail++; console.log(`❌ ${n} ${x}`) } }
;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(`${process.env.DB_NAME}_planmove_test`)
  const BOT = '777000111', WEB = 5000000000000777, U = 'qa_move_user'
  const clean = () => Promise.all([db.collection('phoneNumbersOf').deleteMany({ _id: { $in: [BOT, String(WEB)] } }), db.collection('chatIdOf').deleteMany({ _id: U }), db.collection('webAccounts').deleteMany({ _id: WEB }), db.collection('planMoves').deleteMany({ from: BOT })])
  await clean()
  await db.collection('chatIdOf').insertOne({ _id: U, val: BOT })
  await db.collection('webAccounts').insertOne({ _id: WEB, email: 'qa-move@example.com' })
  await db.collection('phoneNumbersOf').insertOne({ _id: BOT, val: { numbers: [
    { phoneNumber: '+18885550001', status: 'active', plan: 'business', sipUsername: 'gencredX', expiresAt: '2026-12-20' },
    { phoneNumber: '+18885550002', status: 'active', isSubNumber: true, parentNumber: '+18885550001' },
    { phoneNumber: '+18885550003', status: 'released', plan: 'pro' },
  ] } })
  const sent = []
  const M = require('../cloudivr-web/admin-move').createAdminMove(db, { log: () => {}, adminAuth: { require: (q, r, n) => n() }, sendBot: async (id, t) => sent.push([id, t]) })
  ok('other bots refused for now', (await M.find('voodoo', U, 'qa-move@example.com')).error?.[1] === 'bot_not_ready')
  ok('unknown username → not found', (await M.find('nomadly', 'nobody_xyz', 'qa-move@example.com')).error?.[1] === 'user_not_found')
  const f = await M.find('nomadly', '@' + U, 'QA-Move@example.com ')
  ok('lookup: @ and email case tolerated; only live numbers listed', !f.error && f.fromNums.length === 2 && f.to === String(WEB), JSON.stringify(f.error))
  const r = await M.move(f, ['+18885550001'], 'qa')
  const web = (await db.collection('phoneNumbersOf').findOne({ _id: String(WEB) })).val.numbers, bot = (await db.collection('phoneNumbersOf').findOne({ _id: BOT })).val.numbers
  ok('plan + its extra number moved, SIP login and renewal kept', web.length === 2 && web[0].sipUsername === 'gencredX' && web[0].expiresAt === '2026-12-20' && web.every(n => n.movedFrom?.chatId === BOT))
  ok('bot keeps only the released history row', bot.length === 1 && bot[0].status === 'released')
  ok('audit snapshot saved + bot user told', (await db.collection('planMoves').findOne({ _id: r.moveId }))?.snapshot?.length === 2 && sent[0]?.[0] === BOT && /qa-move@example.com/.test(sent[0][1]))
  ok('moving again → nothing to move', (await M.move(await M.find('nomadly', U, 'qa-move@example.com'), ['+18885550001'], 'qa')).error?.[1] === 'nothing_to_move')
  await clean(); await cl.close()
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
