#!/usr/bin/env node
// Simulate a Telegram user journey against the LOCAL bot (sandbox) and print the bot's replies.
// Usage: node scripts/sim_journey.js <chatId> "msg1" "msg2" ...   (env SIM_DELAY_MS, default 1500)
const axios = require('axios')
const fs = require('fs')
const LOG = '/var/log/supervisor/nodejs.out.log'
const URL = process.env.SIM_WEBHOOK_URL || 'http://localhost:5000/telegram/webhook'
const [chatId, ...msgs] = process.argv.slice(2)
if (!chatId || !msgs.length) { console.error('usage: sim_journey.js <chatId> msg...'); process.exit(1) }
const delay = Number(process.env.SIM_DELAY_MS || 1500)
const sleep = ms => new Promise(r => setTimeout(r, ms))

function tailFrom(offset) {
  const fd = fs.openSync(LOG, 'r'); const size = fs.fstatSync(fd).size
  const buf = Buffer.alloc(Math.max(0, size - offset)); fs.readSync(fd, buf, 0, buf.length, offset); fs.closeSync(fd)
  return buf.toString('utf8')
}
function replies(chunk) {
  const out = []
  const re = /reply: ([\s\S]*?)\tto: (\d+)\n/g
  let m
  while ((m = re.exec(chunk))) if (m[2] === String(chatId)) out.push(m[1])
  return out
}

;(async () => {
  let id = Math.floor(Date.now() / 1000)
  for (const text of msgs) {
    const offset = fs.statSync(LOG).size
    await axios.post(URL, {
      update_id: id++,
      message: { message_id: id, date: Math.floor(Date.now() / 1000), chat: { id: Number(chatId), type: 'private' },
        from: { id: Number(chatId), is_bot: false, first_name: 'Sim', username: 'simuser' }, text },
    }, { timeout: 15000 }).catch(e => console.error('POST failed:', e.message))
    await sleep(delay)
    const rs = replies(tailFrom(offset))
    console.log(`\n>>> USER: ${text}`)
    if (!rs.length) console.log('<<< (no reply logged)')
    for (const r of rs) {
      const lines = r.split('\n')
      const last = lines[lines.length - 1]
      console.log('<<< BOT: ' + lines[0].slice(0, 110) + (lines.length > 1 ? ` … (${lines.length} lines)` : ''))
      console.log('    LAST LINE (text + keyboard): ' + last.slice(-260))
    }
  }
})()
