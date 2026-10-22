#!/usr/bin/env node
// Local stand-in for api.telegram.org (sandbox only). Records every Bot API call so bot flows
// can be driven by POSTing fake updates to /telegram/webhook and asserting what the bot replied.
//   start:  node js/tests/mock_telegram_api.js            (port MOCK_TG_PORT, default 5099)
//   point the bot at it: TELEGRAM_API_BASE_URL=http://127.0.0.1:5099 in backend/.env
//   GET    /_calls?chat_id=123&since=<ms>  → [{ ts, method, chat_id, text, reply_markup, buttons[], raw }]
//   DELETE /_calls                         → clears the log
//   GET    /_health
const http = require('http')
const { URL } = require('url')
const PORT = Number(process.env.MOCK_TG_PORT || 5099)
const calls = []
const failRules = []
let nextMsgId = 1000

function parseBody(raw, ctype) {
  if (!raw) return {}
  if (/json/i.test(ctype)) { try { return JSON.parse(raw) } catch (_) { return { _raw: raw } } }
  if (/x-www-form-urlencoded/i.test(ctype)) return Object.fromEntries(new URLSearchParams(raw))
  if (/multipart/i.test(ctype)) {
    const out = { _multipart: true }
    for (const m of raw.matchAll(/name="([^"]+)"\r\n\r\n([\s\S]*?)\r\n--/g)) if (m[2].length < 20000) out[m[1]] = m[2]
    return out
  }
  return { _raw: raw }
}

function buttonsOf(markup) {
  if (!markup) return []
  let m = markup
  if (typeof m === 'string') { try { m = JSON.parse(m) } catch (_) { return [] } }
  const rows = m.keyboard || m.inline_keyboard || []
  return rows.flat().map(b => (typeof b === 'string' ? b : b.text)).filter(Boolean)
}

function result(method, p) {
  const chat = { id: Number(p.chat_id) || 0, type: 'private' }
  if (method === 'getMe') return { id: 1, is_bot: true, first_name: 'MockBot', username: 'mock_sandbox_bot' }
  if (method === 'getWebhookInfo') return { url: 'https://mock.invalid/telegram/webhook', has_custom_certificate: false, pending_update_count: 0 }
  if (/^(setWebhook|deleteWebhook|answerCallbackQuery|deleteMessage|sendChatAction|setMyCommands|pinChatMessage|unpinChatMessage)$/.test(method)) return true
  if (method === 'getChat') return { ...chat, first_name: 'Sim', username: 'sim_user' }
  if (method === 'getChatMember') return { status: 'member', user: { id: chat.id, is_bot: false, first_name: 'Sim' } }
  if (method === 'getFile') return { file_id: p.file_id, file_path: 'mock/file.bin' }
  return { message_id: nextMsgId++, date: Math.floor(Date.now() / 1000), chat, text: p.text || p.caption || '' }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
  if (u.pathname === '/_health') return json(200, { ok: true, calls: calls.length })
  if (u.pathname === '/_calls' && req.method === 'DELETE') { calls.length = 0; return json(200, { ok: true }) }
  // Test-only failure injection: POST /_fail?method=sendMessage&match=<substring>&count=N → next N matching calls get HTTP 500
  if (u.pathname === '/_fail') { failRules.push({ method: u.searchParams.get('method'), match: u.searchParams.get('match') || '', left: Number(u.searchParams.get('count') || 1) }); return json(200, { ok: true, rules: failRules }) }
  if (u.pathname === '/_calls') {
    const chat = u.searchParams.get('chat_id'), since = Number(u.searchParams.get('since') || 0), method = u.searchParams.get('method')
    return json(200, calls.filter(c => (!chat || String(c.chat_id) === String(chat)) && c.ts >= since && (!method || c.method === method)))
  }
  if (/^\/file\/bot[^/]+\//.test(u.pathname)) { res.writeHead(200, { 'Content-Type': 'application/pdf' }); return res.end(Buffer.from('%PDF-1.4\n% mock telegram file\n%%EOF\n')) }
  const m = u.pathname.match(/^\/bot[^/]+\/(\w+)$/)
  if (!m) return json(404, { ok: false, description: 'not found' })
  const method = m[1]
  let raw = ''
  req.on('data', d => { raw += d; if (raw.length > 5e6) raw = raw.slice(0, 5e6) })
  req.on('end', () => {
    const p = { ...Object.fromEntries(u.searchParams), ...parseBody(raw, req.headers['content-type'] || '') }
    const rec = { ts: Date.now(), method, chat_id: p.chat_id != null ? Number(p.chat_id) : null, text: p.text || p.caption || null, reply_markup: p.reply_markup || null, buttons: buttonsOf(p.reply_markup), raw: p._multipart ? undefined : p }
    calls.push(rec)
    if (calls.length > 5000) calls.splice(0, calls.length - 5000)
    console.log(`[mock-tg] ${method} chat=${rec.chat_id} ${rec.text ? JSON.stringify(String(rec.text).slice(0, 80)) : ''} ${rec.buttons.length ? 'buttons=' + JSON.stringify(rec.buttons) : ''}`)
    const rule = failRules.find(r => r.left > 0 && (!r.method || r.method === method) && String(rec.text || '').includes(r.match))
    if (rule) { rule.left--; rec.injectedFailure = true; return json(500, { ok: false, error_code: 500, description: 'Internal Server Error: injected by mock' }) }
    json(200, { ok: true, result: result(method, p) })
  })
})
server.listen(PORT, '127.0.0.1', () => console.log(`[mock-tg] listening on http://127.0.0.1:${PORT}`))
