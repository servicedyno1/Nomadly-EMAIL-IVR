'use strict'
// Admin alert (never blocks) when an AI agent, IVR message or campaign is named after a bank, FDIC, IRS or similar.
const TERMS = [
  /\bFDIC\b/i, /\bIRS\b/, /internal\s+revenue/i, /\bbank(?:ing)?\b/i, /credit\s+union/i, /\bsocial\s+security\b/i,
  /\btreasury\b/i, /fraud\s+(?:prevention|department|team|alert)/i, /suspicious\s+(?:transaction|activity|charge)/i,
  /wells\s*fargo/i, /\bchase\b/i, /bank\s+of\s+america/i, /\bciti(?:bank)?\b/i, /capital\s+one/i, /navy\s+federal/i,
  /\bpaypal\b/i, /\bzelle\b/i, /\bvenmo\b/i, /\bcash\s*app\b/i, /\bcoinbase\b/i,
]
const WINDOW_MS = 24 * 3600 * 1000
const sent = new Map() // chatId|where|term → time
let notifier = null

const setNotifier = (fn) => { notifier = fn }

// Every string inside a request body / params object (bounded).
function texts(v, out = [], depth = 0) {
  if (out.join(' ').length > 20000 || depth > 6 || v == null) return out
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.slice(0, 200).forEach(x => texts(x, out, depth + 1))
  else if (typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (!/audio|url|base64|file|leads|password|token/i.test(k)) texts(x, out, depth + 1) })
  return out
}

function scan(list) {
  const hits = []
  for (const t of list) for (const re of TERMS) { const m = String(t).match(re); if (m && !hits.some(h => h.term.toLowerCase() === m[0].toLowerCase())) hits.push({ term: m[0], snippet: String(t).slice(0, 140) }) }
  return hits
}

// Fire-and-forget: alert the admin once per account + place + term per 24 h.
function watch({ chatId, who, where, data }) {
  try {
    if (!notifier) return
    const hits = scan(texts(data)).filter(h => {
      const k = `${chatId}|${where}|${h.term.toLowerCase()}`, t = sent.get(k)
      if (t && Date.now() - t < WINDOW_MS) return false
      sent.set(k, Date.now()); return true
    })
    if (!hits.length) return
    const esc = (s) => String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
    notifier(`🚩 <b>Possible impersonation</b>\n👤 ${esc(who || chatId)} (${esc(chatId)})\n📍 ${esc(where)}\n` +
      hits.slice(0, 4).map(h => `• <b>${esc(h.term)}</b> — “${esc(h.snippet)}”`).join('\n') + '\n<i>Alert only — nothing was blocked.</i>')
  } catch (_) { /* never affects the user's request */ }
}

const alert = (text) => { try { notifier?.(text) } catch (_) { /* best effort */ } }

module.exports = { setNotifier, watch, scan, texts, alert }
