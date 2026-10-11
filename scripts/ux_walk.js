#!/usr/bin/env node
// Ad-hoc UX walk: send messages to the sandbox bot, print EVERY bot message (text + keyboard) via the mock Telegram API.
// Usage: node scripts/ux_walk.js <chatId> "msg1" "msg2" ...   (env WALK_WAIT_MS default 3000)
const axios = require('axios')
const [chatId, ...msgs] = process.argv.slice(2)
const WAIT = Number(process.env.WALK_WAIT_MS || 3000)
const HOOK = 'http://localhost:5000/telegram/webhook'
const MOCK = 'http://127.0.0.1:5099'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
;(async () => {
  let id = Math.floor(Date.now() / 1000)
  for (const text of msgs) {
    const since = Date.now()
    await axios.post(HOOK, { update_id: id++, message: { message_id: id, date: Math.floor(Date.now() / 1000), chat: { id: Number(chatId), type: 'private' }, from: { id: Number(chatId), is_bot: false, first_name: 'Walker', username: 'walker' }, text } }, { timeout: 15000 }).catch(e => console.error('POST failed:', e.message))
    await sleep(WAIT)
    const { data } = await axios.get(`${MOCK}/_calls`, { params: { chat_id: chatId, since } })
    console.log(`\n>>> USER: ${text}`)
    for (const c of data) {
      if (!/sendMessage|editMessageText|sendPhoto|sendDocument/.test(c.method)) { console.log(`<<< [${c.method}]`); continue }
      const t = strip(c.text || c.raw?.caption || '')
      console.log(`<<< [${c.method}] ${t.split('\n').map((l, i) => (i ? '    ' : '') + l).join('\n')}`)
      if (c.buttons?.length) console.log(`    ⌨ ${c.buttons.join(' | ')}`)
    }
  }
})()
