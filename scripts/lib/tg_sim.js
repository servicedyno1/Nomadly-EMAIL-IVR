// Shared sandbox-bot driver: posts fake Telegram updates to the local webhook and reads the
// dev-only `[tg-out]` trace (js/tg-opts.js) to see exactly what the bot sent back.
const axios = require('axios')
const fs = require('fs')
const LOG = process.env.SIM_LOG || '/var/log/supervisor/nodejs.out.log'
const URL = process.env.SIM_WEBHOOK_URL || 'http://localhost:5000/telegram/webhook'
const QUIET_MS = Number(process.env.CRAWL_QUIET_MS || 700)
const FIRST_MS = Number(process.env.CRAWL_FIRST_MS || 3500)
const MAX_MS = Number(process.env.CRAWL_MAX_MS || 12000)
const ERR_RE = /TypeError|ReferenceError|RangeError|SyntaxError|is not a function|is not defined|Cannot read propert|Cannot access|Unhandled Promise Rejection|Uncaught Exception/

const sleep = ms => new Promise(r => setTimeout(r, ms))
const strip = s => String(s || '').replace(/<[^>]+>/g, '')
function readFrom(offset) {
  const fd = fs.openSync(LOG, 'r'); const size = fs.fstatSync(fd).size
  const buf = Buffer.alloc(Math.max(0, size - offset)); fs.readSync(fd, buf, 0, buf.length, offset); fs.closeSync(fd)
  return buf.toString('utf8')
}
let updId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000)

function makeSim(chatId) {
  chatId = String(chatId)
  const from = { id: Number(chatId), is_bot: false, first_name: 'Crawler', username: 'crawler' }
  const chat = { id: Number(chatId), type: 'private' }
  function parseOut(chunk) {
    const msgs = []; const errors = []; let unrecognized = false; let ai = false
    for (const line of chunk.split('\n')) {
      if (line.startsWith('[tg-out] ')) {
        try { const o = JSON.parse(line.slice(9)); if (o.chat === chatId) msgs.push(o) } catch { /* partial line */ }
      } else if (line.includes(`[reset] Unrecognized message from ${chatId}:`)) unrecognized = true
      else if (line.includes(`[Support] Cold question routed to AI for ${chatId}`)) ai = true
      else if (ERR_RE.test(line)) errors.push(line.slice(0, 200))
    }
    return { msgs, errors, unrecognized, ai }
  }
  async function waitForOut(offset) {
    const t0 = Date.now(); let lastCount = 0; let lastChange = t0
    while (Date.now() - t0 < MAX_MS) {
      await sleep(200)
      const n = parseOut(readFrom(offset)).msgs.length
      if (n !== lastCount) { lastCount = n; lastChange = Date.now() }
      if (lastCount && Date.now() - lastChange > QUIET_MS) break
      if (!lastCount && Date.now() - t0 > FIRST_MS) break
    }
    return parseOut(readFrom(offset))
  }
  // st: { kind:'text', v } | { kind:'cb', data }
  let lastStartAt = 0
  async function step(st) {
    if (st.kind === 'text' && st.v === '/start') { // bot debounces /start within 3s — never trip it from a script
      const wait = 3200 - (Date.now() - lastStartAt)
      if (wait > 0) await sleep(wait)
      lastStartAt = Date.now()
    }
    const offset = fs.statSync(LOG).size
    const date = Math.floor(Date.now() / 1000)
    const update = st.kind === 'cb'
      ? { update_id: updId++, callback_query: { id: String(updId), from, chat_instance: '1', data: st.data, message: { message_id: updId, date, chat, text: '…' } } }
      : { update_id: updId++, message: { message_id: updId, date, chat, from, text: st.v } }
    await axios.post(URL, update, { timeout: 15000 })
    return waitForOut(offset)
  }
  // Reply keyboards persist on the user's screen until replaced/removed → track across messages.
  function applyScreen(screen, msgs) {
    screen.force = false
    for (const m of msgs) {
      if (m.remove) screen.kb = []
      if (m.kb.length) screen.kb = m.kb
      if (m.force) screen.force = true
    }
    return screen
  }
  const say = async (screen, text) => { const r = await step({ kind: 'text', v: text }); applyScreen(screen, r.msgs); return r }
  return { chatId, step, say, parseOut, readFrom, waitForOut, applyScreen }
}

const inlineOf = msgs => msgs.flatMap(m => m.inline || []).filter(b => b.d && !b.u)
module.exports = { makeSim, inlineOf, strip, sleep, LOG, URL }
