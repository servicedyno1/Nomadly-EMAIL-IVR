#!/usr/bin/env node
// iter215 helper: send one or more messages as a chat to the real bot (mock TG :5099) and print replies + buttons + log flags.
// usage: node js/tests/say_iter215.js <chatId> "<text1>" ["<text2>" ...]   (env WAIT ms per step, default 3500)
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const fs = require('fs'), axios = require('axios')
const BOT_LOG = process.env.BOT_LOG || '/tmp/bot.log'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
;(async () => {
  const [chat, ...texts] = process.argv.slice(2)
  for (const text of texts) {
    const since = Date.now(), off = fs.statSync(BOT_LOG).size, n = Math.floor(Math.random() * 1e9)
    await axios.post('http://localhost:5000/telegram/webhook', { update_id: n, message: { message_id: n % 1e7, date: Math.floor(Date.now() / 1000), chat: { id: Number(chat), type: 'private', first_name: 'Sim' }, from: { id: Number(chat), is_bot: false, first_name: 'Sim', username: 'sim' + chat }, text } }, { timeout: 15000 })
    await sleep(Number(process.env.WAIT || 3500))
    const cs = (await axios.get(`http://127.0.0.1:5099/_calls?${new URLSearchParams({ chat_id: chat, since: String(since) })}`)).data
    const b = Buffer.alloc(fs.statSync(BOT_LOG).size - off); const fd = fs.openSync(BOT_LOG, 'r'); fs.readSync(fd, b, 0, b.length, off); fs.closeSync(fd)
    const lg = b.toString().split('\n').filter(l => l.includes(chat) || /TypeError|ReferenceError|Cannot read|is not a function|is not defined|Unhandled/.test(l))
    console.log(`\n>>> ${text}`)
    for (const c of cs.filter(c => /^send|^edit/.test(c.method))) console.log(`  [${c.method}] ${strip(c.text || c.caption).slice(0, Number(process.env.LEN || 700)).replace(/\n+/g, ' ⏎ ')}`)
    console.log('  BTNS:', JSON.stringify(cs.flatMap(c => c.buttons || [])))
    const flags = lg.filter(l => /Unrecognized message|AI support|TypeError|ReferenceError|Cannot read|is not a function|is not defined|Some Issue|❌/.test(l)).slice(0, 4)
    if (flags.length) console.log('  LOGFLAGS:', flags.map(l => l.slice(0, 250)).join(' || '))
    if (!cs.length) console.log('  !!! SILENT')
  }
  process.exit(0)
})()
