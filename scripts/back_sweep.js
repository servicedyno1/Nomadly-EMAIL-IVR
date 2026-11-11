#!/usr/bin/env node
// Sets every known bot action directly, presses Back, and flags screens where Back is ignored
// (no reply, still on the same action with the same prompt, "valid option" error, or AI fallback).
// Usage: node scripts/back_sweep.js <chatId> [lang=en] [filterRegex]
require('dotenv').config({ path: '/app/backend/.env' })
const fs = require('fs')
const { MongoClient } = require('mongodb')
const { makeSim, strip } = require('./lib/tg_sim')
const chatId = String(process.argv[2] || '990000201')
const LANG = process.argv[3] || 'en'
const FILTER = process.argv[4] ? new RegExp(process.argv[4]) : null
const BACK = { en: '↩️ Back', fr: '↩️ Retour', zh: '↩️ 返回', hi: '↩️ वापस', fa: '↩️ بازگشت' }[LANG] || '↩️ Back'
const INVALID_RE = /valid (option|plan|choice|selection)|choose a valid|invalid|option (in)?valide|choix (in)?valide|not a valid|doesn.t look like|isn.t a valid|format/i

const src = ['_index.js', 'bulk-esim/bot.js', 'esim-bot.js'].map(f => fs.readFileSync(`/app/js/${f}`, 'utf8')).join('\n')
const aBlock = src.slice(src.indexOf('  const a = {'), src.indexOf('\n  }\n', src.indexOf('  const a = {')))
const actions = new Set([...aBlock.matchAll(/^\s+\w+:\s*'([^']+)'/gm)].map(m => m[1]))
for (const m of src.matchAll(/action === '([\w:.-]+)'/g)) actions.add(m[1])
for (const x of ['none', '']) actions.delete(x)

;(async () => {
  const cl = await MongoClient.connect(process.env.MONGO_URL), db = cl.db(process.env.DB_NAME)
  const sim = makeSim(chatId)
  const list = [...actions].filter(x => !FILTER || FILTER.test(x))
  const flagged = []
  console.log(`sweeping ${list.length} actions (${LANG})`)
  for (const act of list) {
    await db.collection('state').replaceOne({ _id: chatId }, { _id: chatId, action: act, userLanguage: LANG, history: [] }, { upsert: true })
    const r = await sim.step({ kind: 'text', v: BACK })
    const s = await db.collection('state').findOne({ _id: chatId })
    const text = strip(r.msgs[r.msgs.length - 1]?.text || '')
    let why = null
    if (!r.msgs.length) why = 'NO_REPLY'
    else if (r.ai) why = 'AI_FALLBACK'
    else if (r.unrecognized) why = 'UNRECOGNIZED'
    else if (r.msgs.some(m => [`<b>${BACK}</b>`, `: ${BACK}`, `"${BACK}"`, `<code>${BACK}</code>`].some(x => String(m.text || '').includes(x)))) why = 'TAKEN_AS_INPUT'
    else if (s?.action === act && INVALID_RE.test(text)) why = 'INVALID'
    else if (s?.action === act) why = 'STAYED'
    if (why) { flagged.push({ action: act, why, text: text.slice(0, 140) }); console.log(`✗ ${act} ${why} :: ${text.replace(/\n/g, ' ').slice(0, 110)}`) }
  }
  await db.collection('state').deleteOne({ _id: chatId }); await cl.close()
  fs.writeFileSync(`/app/test_reports/back_sweep_${LANG}.json`, JSON.stringify({ at: new Date().toISOString(), total: list.length, flagged }, null, 2))
  console.log(`\n${list.length} actions, ${flagged.length} flagged`)
  process.exit(0)
})().catch(e => { console.error(e.message); process.exit(1) })
