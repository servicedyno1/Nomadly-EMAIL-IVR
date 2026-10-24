'use strict'
// CloudIVR web "Ring me in the browser": which web accounts have the app open (they poll GET /incoming), and the
// inbound calls ringing for them right now. Kept in memory — the process that receives a call's Telnyx webhooks is
// the one the owner's tab polls. A restart while a call rings only drops the banner: the call keeps today's
// fallback (the SIP ring timeout, or the caller hangs up / Telnyx times out).
const crypto = require('crypto')

const ONLINE_MS = 20000 // a tab that polled within this window counts as "open"
const online = new Map() // chatId → last poll (ms)
const ringing = new Map() // ring id → { id, chatId, phone, from, ccid, startedAt, timeoutAt, simulated, timer }

const seen = (chatId) => online.set(String(chatId), Date.now())
const isOnline = (chatId) => Date.now() - (online.get(String(chatId)) || 0) < ONLINE_MS

// onTimeout(entry) runs once when nobody acted in time. Without it the entry still expires (5 s grace) so a lost
// hangup can never leave a banner behind.
function add({ chatId, phone, from, ccid = null, timeoutMs = 25000, simulated = false, onTimeout = null }) {
  const id = crypto.randomUUID()
  const now = Date.now()
  const r = { id, chatId: String(chatId), phone, from, ccid, startedAt: new Date(now), timeoutAt: new Date(now + timeoutMs), simulated: !!simulated }
  r.timer = setTimeout(() => {
    if (ringing.get(id) !== r) return
    ringing.delete(id)
    if (onTimeout) Promise.resolve().then(() => onTimeout(r)).catch(() => {})
  }, timeoutMs + (onTimeout ? 0 : 5000))
  if (r.timer.unref) r.timer.unref()
  ringing.set(id, r)
  return r
}

const list = (chatId) => [...ringing.values()].filter(r => r.chatId === String(chatId))
const get = (id, chatId) => {
  const r = ringing.get(String(id))
  return r && (chatId === undefined || r.chatId === String(chatId)) ? r : null
}
// Removes and returns the entry exactly once — the first tab / device to act wins.
function take(id, chatId) {
  const r = get(id, chatId)
  if (!r) return null
  ringing.delete(r.id)
  clearTimeout(r.timer)
  return r
}
function removeByCcid(ccid) {
  if (!ccid) return null
  for (const r of ringing.values()) {
    if (r.ccid === ccid) { ringing.delete(r.id); clearTimeout(r.timer); return r }
  }
  return null
}
const reset = () => { for (const r of ringing.values()) clearTimeout(r.timer); ringing.clear(); online.clear() }

module.exports = { ONLINE_MS, seen, isOnline, add, list, get, take, removeByCcid, reset }
