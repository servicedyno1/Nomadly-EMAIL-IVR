#!/usr/bin/env node
// iter214: walk EVERY main-menu button in English and Farsi (one level deeper + Back) against the REAL bot via
// mock Telegram API (:5099). Flags: silence, "Unrecognized message" (fallback), exceptions in bot log, fa≠en behaviour.
// Requires mock_telegram_api.js on :5099 and bot started with TELEGRAM_API_BASE_URL=http://127.0.0.1:5099, logging to BOT_LOG.
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const fs = require('fs')
const axios = require('axios')
const { MongoClient } = require('mongodb')
const WEBHOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const BOT_LOG = process.env.BOT_LOG || '/tmp/bot.log'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const IDS = { en: '990213120', fa: '990213121' }
let uid = 8_000_000 + Math.floor(Math.random() * 100000)
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
const NAV = /^(↩️|🏠|❌|Cancel|Back|Main Menu|بازگشت|منوی اصلی|لغو|انصراف)/
const logSize = () => fs.statSync(BOT_LOG).size
const logSince = off => { const fd = fs.openSync(BOT_LOG, 'r'); const len = logSize() - off; const b = Buffer.alloc(Math.max(0, len)); fs.readSync(fd, b, 0, b.length, off); fs.closeSync(fd); return b.toString() }
async function say(chat, text, wait = 3000) {
  const since = Date.now(), off = logSize(), n = uid++
  await axios.post(WEBHOOK, { update_id: n, message: { message_id: n, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat }, text } }, { timeout: 15000 })
  await sleep(wait)
  const cs = (await axios.get(`${MOCK}/_calls?${new URLSearchParams({ chat_id: chat, since: String(since) })}`)).data
  const lg = logSince(off)
  const mine = lg.split('\n').filter(l => l.includes(chat) || /Error|Exception|TypeError|Cannot read/.test(l))
  return {
    text: cs.filter(c => /^send|^edit/.test(c.method)).map(c => strip(c.text || c.caption)).join(' | '),
    btns: cs.flatMap(c => c.buttons || []),
    n: cs.filter(c => /^send|^edit/.test(c.method)).length,
    unrec: mine.some(l => /Unrecognized message from/.test(l)),
    err: mine.filter(l => /❌|TypeError|ReferenceError|Cannot read|Uncaught|Unhandled|is not a function|is not defined/.test(l)).slice(0, 3),
  }
}
;(async () => {
  const mc = await MongoClient.connect(process.env.MONGO_URL)
  const db = mc.db(process.env.DB_NAME)
  const ALL = Object.values(IDS)
  const cleanup = async () => {
    for (const c of ['state', 'walletOf', 'nameOf', 'chatIdOf', 'userConversion']) await db.collection(c).deleteMany({ _id: { $in: ALL } })
    await db.collection('userConversion').deleteMany({ chatId: { $in: ALL } })
    await db.collection('resumableSessions').deleteMany({ _id: { $in: ALL.map(c => 'resume_' + c) } })
  }
  await cleanup()
  const out = {}
  try {
    for (const [lang, id] of Object.entries(IDS)) {
      await db.collection('state').insertOne({ _id: id, userLanguage: lang, action: 'none', firstSessionIntentDone: true })
      await db.collection('walletOf').insertOne({ _id: id, usdIn: 0, usdOut: 0 })
      const m = await say(id, '/start', 3500)
      const menu = m.btns.filter(b => !NAV.test(b))
      out[lang] = { menu, rows: [] }
      for (let i = 0; i < menu.length; i++) {
        await say(id, '/start', 2000)
        const r1 = await say(id, menu[i], 4000)
        const sub = r1.btns.filter(b => !NAV.test(b) && !menu.includes(b))
        let r2 = null, r3 = null
        if (sub.length) {
          r2 = await say(id, sub[0], 4000)
          const back = r2.btns.find(b => /^↩️/.test(b)) || r1.btns.find(b => /^↩️/.test(b))
          if (back) r3 = await say(id, back, 3000)
        }
        out[lang].rows.push({ i, btn: menu[i], r1: { n: r1.n, unrec: r1.unrec, err: r1.err, text: r1.text.slice(0, 160), btns: r1.btns.slice(0, 6) }, sub: sub[0], r2: r2 && { n: r2.n, unrec: r2.unrec, err: r2.err, text: r2.text.slice(0, 160), btns: r2.btns.slice(0, 6) }, r3: r3 && { n: r3.n, unrec: r3.unrec, err: r3.err, text: r3.text.slice(0, 100) } })
        console.log(`[${lang}] ${menu[i]} → n=${r1.n} unrec=${r1.unrec} err=${r1.err.length} :: ${r1.text.slice(0, 90).replace(/\n/g, ' ')} || deeper "${sub[0] || '-'}" → ${r2 ? `n=${r2.n} unrec=${r2.unrec} err=${r2.err.length} :: ${r2.text.slice(0, 80).replace(/\n/g, ' ')}` : '-'} || back → ${r3 ? `n=${r3.n} unrec=${r3.unrec}` : '-'}`)
      }
    }
    // Compare fa vs en by index
    let fails = 0
    const en = out.en.rows, fa = out.fa.rows
    console.log(`\nmenu sizes en=${en.length} fa=${fa.length}`)
    for (let i = 0; i < Math.max(en.length, fa.length); i++) {
      const e = en[i], f = fa[i]
      const bad = []
      if (!f) { bad.push('missing in fa'); }
      else {
        if (!f.r1.n) bad.push('fa silent')
        if (f.r1.unrec && !(e && e.r1.unrec)) bad.push('fa unrecognized (fallback) but en ok')
        if (f.r1.err.length) bad.push('fa err: ' + f.r1.err.join(' / '))
        if (f.r2 && !f.r2.n) bad.push('fa deeper silent')
        if (f.r2 && f.r2.unrec && !(e && e.r2 && e.r2.unrec)) bad.push(`fa deeper "${f.sub}" unrecognized but en ok`)
        if (f.r2 && f.r2.err.length) bad.push('fa deeper err: ' + f.r2.err.join(' / '))
        // localized reverse-lookup maps (planOptionsOf etc.) broken → price shows $0.00 in fa only
        if (f.r2 && /\$0\.00/.test(f.r2.text) && e && e.r2 && !/\$0\.00/.test(e.r2.text)) bad.push(`fa deeper "${f.sub}" shows $0.00 but en shows a price`)
        if (e && e.r2 && !f.r2) bad.push(`fa had no sub buttons; en had "${e.sub}"`)
        if (f.r3 && f.r3.unrec && !(e && e.r3 && e.r3.unrec)) bad.push('fa Back unrecognized')
      }
      if (bad.length) fails++
      console.log(`${bad.length ? 'FAIL' : 'PASS'} #${i} en="${e?.btn}" fa="${f?.btn}" ${bad.join('; ')}`)
    }
    fs.writeFileSync('/app/test_reports/fa_menu_walk_iter214.json', JSON.stringify(out, null, 1))
    console.log(`\nRESULT ${Math.max(en.length, fa.length) - fails}/${Math.max(en.length, fa.length)} fa buttons OK`)
  } catch (e) { console.log('script error', e.stack) } finally { await cleanup(); await mc.close(); process.exit(0) }
})()
