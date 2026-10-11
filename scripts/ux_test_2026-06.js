#!/usr/bin/env node
// Drive the local sandbox bot (mock Telegram API) and print exact text + buttons per step.
// Usage: node scripts/ux_test_2026-06.js <chatId> "msg1" "msg2" ...
const axios = require('axios')
const WEBHOOK = process.env.SIM_WEBHOOK_URL || 'http://localhost:5000/telegram/webhook'
const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:5099'
const [chatId, ...msgs] = process.argv.slice(2)
if (!chatId || !msgs.length) { console.error('usage: ux_test.js <chatId> msg...'); process.exit(1) }
const delay = Number(process.env.SIM_DELAY_MS || 2600)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const from = { id: Number(chatId), is_bot: false, first_name: 'UXTester', username: 'uxtester' }
const chat = { id: Number(chatId), type: 'private' }
let uid = Math.floor(Date.now() / 1000)

;(async () => {
  for (const text of msgs) {
    const since = Date.now()
    await axios.post(WEBHOOK, { update_id: uid++, message: { message_id: uid, date: Math.floor(Date.now() / 1000), chat, from, text } }, { timeout: 15000 }).catch(e => console.error('POST failed:', e.message))
    await sleep(delay)
    let calls = []
    try { calls = (await axios.get(`${MOCK}/_calls?chat_id=${chatId}&since=${since}`, { timeout: 5000 })).data } catch (e) { console.error('mock read failed', e.message) }
    console.log(`\n>>> USER: ${JSON.stringify(text)}`)
    if (!calls.length) { console.log('<<< (no bot message)'); continue }
    for (const c of calls) {
      if (!c.text && !(c.buttons && c.buttons.length)) continue
      const t = String(c.text || '').replace(/<[^>]+>/g, '')
      console.log(`<<< [${c.method}] ${t.slice(0, 280).replace(/\n/g, ' ⏎ ')}`)
      if (c.buttons && c.buttons.length) console.log(`    BTNS: ${JSON.stringify(c.buttons)}`)
    }
  }
  process.exit(0)
})()
