'use strict'
const RP = require('../bulk-esim/review-post')
let pass = 0, fail = 0
const ok = (n, c, x = '') => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n} ${c ? '' : x}`) }
;(async () => {
  ok('US number masked', RP.mask('+17207098388') === '+1 720-•••-•388', RP.mask('+17207098388'))
  ok('4★ arrived is positive', RP.positive({ stars: 4, arrived: 'yes', kind: 'single' }))
  ok('5★ spam is not posted', !RP.positive({ stars: 5, arrived: 'spam', kind: 'single' }))
  ok('3★ not posted', !RP.positive({ stars: 3, arrived: 'yes', kind: 'single' }))
  ok('4★ campaign posted', RP.positive({ stars: 4, kind: 'campaign' }))
  const sent = [], rows = []
  const db = { collection: () => ({ findOne: async (q) => rows.find(r => r.reviewId === q.reviewId), find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => rows }) }) }), insertOne: async (d) => rows.push(d) }) }
  const bot = { sendMessage: async (chat, text, o) => { sent.push({ chat, text, o }); return { message_id: 1 } } }
  const r = { _id: 'r1', kind: 'single', stars: 5, arrived: 'yes', to: '+17207098388' }
  const t1 = await RP.post(bot, db, r)
  ok('posted to @Hostbay', sent[0]?.chat === '@Hostbay')
  ok('full number never shown', !/7098388/.test(t1))
  ok('masked number shown', t1.includes('+1 720-•••-•388'), t1)
  ok('no eSIM mention', !/e-?sim|\bsim\b/i.test(t1))
  ok('links Nomadly bot', /@Nomadlybot/.test(t1) && /t\.me\/Nomadlybot/.test(sent[0].o.reply_markup.inline_keyboard[0][0].url))
  ok('same review never posted twice', (await RP.post(bot, db, r)) === null && sent.length === 1)
  const t2 = await RP.post(bot, db, { ...r, _id: 'r2' })
  ok('second post is worded differently', t2 && t2 !== t1)
  console.log('\nSAMPLE 1:\n' + t1 + '\n\nSAMPLE 2:\n' + t2)
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
