'use strict'
// Text calls for deaf / hard-of-hearing users: the user types → the other person hears it (Telnyx speak), the other
// person's speech → live text (Telnyx real-time transcription). Billed per started minute: call rate + relay fee.
const crypto = require('crypto')
const axios = require('axios')
const { getBalance, smartWalletDeduct } = require('../utils.js')
const { spokenNumber } = require('../voicemail-greeting')
const preview = require('./preview')

const RELAY_RATE = () => parseFloat(process.env.TEXT_RELAY_RATE_PER_MIN || '0.03')
const CLIENT_STATE = Buffer.from('text_relay').toString('base64')
const BASE = 'https://api.telnyx.com/v2'
const KEEP_DAYS = 90
const MAX_TEXT = 1000
const MAX_MINUTES = 120
const STALE_MS = 3 * 60000 // no heartbeat this long → nobody is running the call any more
const OPEN = ['ringing', 'live']
const LANGS = {
  en: { tts: 'en-US', stt: 'en', intro: (who) => `Hello. This is a typed call from ${who}, placed through CloudIVR. The caller is deaf or hard of hearing. They type, and a computer voice reads their words to you. Please speak normally and pause when you finish. Your words appear as text for them.`, outOfFunds: 'The caller’s balance has run out. Goodbye.' },
  es: { tts: 'es-MX', stt: 'es', intro: (who) => `Hola. Esta es una llamada escrita de ${who}, hecha con CloudIVR. La persona que llama es sorda o tiene dificultades auditivas. Escribe y una voz de computadora le lee sus palabras. Por favor hable con normalidad y haga una pausa al terminar. Sus palabras le aparecen como texto.`, outOfFunds: 'El saldo de la persona que llama se agotó. Adiós.' },
  fr: { tts: 'fr-FR', stt: 'fr', intro: (who) => `Bonjour. Ceci est un appel écrit de ${who}, passé avec CloudIVR. La personne qui appelle est sourde ou malentendante. Elle tape ses mots et une voix de synthèse vous les lit. Parlez normalement et faites une pause quand vous avez fini. Vos paroles s’affichent pour elle en texte.`, outOfFunds: 'Le solde de la personne qui appelle est épuisé. Au revoir.' },
}
let deps = {}
let col = null
const sessions = new Map() // relay id → live call
const byCcid = new Map() // call_control_id → relay id

const log = (...a) => (deps.log || console.log)(...a)
const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const tx = (path, body) => axios.post(`${BASE}${path}`, body, { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 })
const txError = (e) => e.response?.data?.errors?.[0]?.detail || e.message

function init(d) {
  deps = d
  col = d.db.collection('relayCalls')
  col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {})
  col.createIndex({ chatId: 1, createdAt: -1 }).catch(() => {})
  col.createIndex({ ccid: 1 }).catch(() => {})
  const t = setInterval(() => sweep().catch(e => log(`[Relay] sweep error: ${e.message}`)), 60000)
  if (t.unref) t.unref()
}
const owns = (ccid, payload) => byCcid.has(ccid) || payload?.client_state === CLIENT_STATE
const fresh = () => ({ $or: [{ beatAt: { $gt: new Date(Date.now() - STALE_MS) } }, { beatAt: { $exists: false }, createdAt: { $gt: new Date(Date.now() - STALE_MS) } }] })
// The account's call in progress (this process, or another one / before a restart, still beating).
async function liveFor(chatId) {
  const s = [...sessions.values()].find(x => x.chatId === String(chatId))
  return s || col.findOne({ chatId: String(chatId), status: { $in: OPEN }, ...fresh() }, { projection: { _id: 1 } })
}
const beat = (s) => col.updateOne({ _id: s._id }, { $set: { beatAt: new Date() } }).catch(() => {})

// A call this process does not hold (restart, other deploy slot) → back into memory from Mongo, or null.
async function revive(filter) {
  const d = await col.findOne({ ...filter, status: { $in: OPEN } })
  if (!d) return null
  if (sessions.has(d._id)) return sessions.get(d._id)
  if (d.dryRun) { await settle(d, new Date(), null); return null }
  const s = { ...d, lines: d.lines || [], speaking: 0, interim: '', answeredAt: d.answeredAt ? new Date(d.answeredAt) : null }
  sessions.set(s._id, s)
  if (s.ccid) byCcid.set(s.ccid, s._id)
  if (s.answeredAt) watchWallet(s)
  s.maxTimer = setTimeout(() => hangup(s._id, s.chatId, 'max_length'), Math.max(60000, MAX_MINUTES * 60000 - (Date.now() - new Date(s.createdAt).getTime())))
  beat(s)
  log(`[Relay] picked up text call ${s._id} from the database`)
  return s
}
async function liveSession(id, chatId) {
  const s = sessions.get(String(id)) || await revive({ _id: String(id) })
  return s && s.chatId === String(chatId) ? s : null
}

// Client view of a call: live state from memory, finished calls from Mongo.
const view = (s) => ({
  id: s._id, callerId: s.callerId, to: s.to, name: s.name || '', lang: s.lang, voice: s.voice, status: s.status, outcome: s.outcome || null,
  lines: (s.lines || []).slice(-500), interim: s.interim || '', speaking: (s.speaking || 0) > 0, createdAt: s.createdAt, answeredAt: s.answeredAt || null,
  endedAt: s.endedAt || null, duration: s.answeredAt ? Math.round(((s.endedAt ? new Date(s.endedAt).getTime() : Date.now()) - new Date(s.answeredAt).getTime()) / 1000) : 0,
  rate: s.rate, charge: s.charge ?? null, dryRun: !!s.dryRun,
})
async function find(id, chatId) {
  const s = sessions.get(String(id))
  if (s) return s.chatId === String(chatId) ? s : null
  return col.findOne({ _id: String(id), chatId: String(chatId) })
}

function addLine(s, who, text) {
  const line = { n: (s.lines.length ? s.lines[s.lines.length - 1].n : 0) + 1, who, text: String(text).slice(0, MAX_TEXT), at: new Date() }
  s.lines.push(line)
  col.updateOne({ _id: s._id }, { $push: { lines: line } }).catch(() => {})
  return line
}

// → { id } | { error: [status, code, message] }
async function start({ chatId, callerId, to, name, lang, voice, announce, callRate }) {
  if (await liveFor(chatId)) return { error: [409, 'already_live', 'You already have a text call going. Hang it up first.'] }
  const rate = +(callRate + RELAY_RATE()).toFixed(4)
  const { usdBal } = await getBalance(deps.walletOf, chatId)
  if (usdBal < rate) return { error: [402, 'insufficient_balance', `A text call costs $${rate.toFixed(2)}/min. Your balance is $${usdBal.toFixed(2)} — top up first.`] }
  const now = new Date()
  const s = {
    _id: crypto.randomUUID(), chatId: String(chatId), callerId, to, name: String(name || '').trim().slice(0, 40), lang: LANGS[lang] ? lang : 'en', voice: voice === 'male' ? 'male' : 'female',
    announce: announce !== false, status: 'ringing', lines: [], interim: '', speaking: 0, rate, callRate, relayRate: RELAY_RATE(), dryRun: dryRun(), createdAt: now, beatAt: now,
    expiresAt: new Date(now.getTime() + KEEP_DAYS * 86400000),
  }
  if (!s.dryRun) {
    try {
      const r = await tx('/calls', { connection_id: process.env.TELNYX_CALL_CONTROL_APP_ID, to, from: callerId, webhook_url: `${deps.selfUrl}/telnyx/voice-webhook`, client_state: CLIENT_STATE, timeout_secs: 45 })
      s.ccid = r.data?.data?.call_control_id
    } catch (e) {
      log(`[Relay] dial ${callerId} → ${to} failed: ${txError(e)}`)
      return { error: [424, 'call_failed', 'We could not place the call right now. Check the number and try again.'] }
    }
    byCcid.set(s.ccid, s._id)
  }
  sessions.set(s._id, s)
  const { speaking, interim, ...doc } = s // eslint-disable-line no-unused-vars
  await col.insertOne(doc)
  log(`[Relay] text call ${callerId} → ${to} by ${chatId}${s.dryRun ? ' (DRY RUN)' : ''}`)
  s.maxTimer = setTimeout(() => hangup(s._id, s.chatId, 'max_length'), MAX_MINUTES * 60000)
  if (s.dryRun) preview.ring(s, { answered, onText, finish, addLine })
  return { id: s._id }
}

// Typed text → spoken to the other person (queued by Telnyx in order).
async function say(id, chatId, text) {
  const s = await liveSession(id, chatId)
  if (!s) return { error: [404, 'not_found', 'This call has ended.'] }
  if (s.status !== 'live') return { error: [409, 'not_connected', 'Wait until the other person answers.'] }
  const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
  if (!t) return { error: [400, 'empty', 'Type something to say.'] }
  const line = addLine(s, 'me', t)
  s.speaking++
  if (s.dryRun) preview.reply(s, t, { onText, spoke: () => { s.speaking = Math.max(0, s.speaking - 1) } })
  else {
    try { await tx(`/calls/${s.ccid}/actions/speak`, { payload: t, voice: s.voice, language: LANGS[s.lang].tts, command_id: crypto.randomUUID() }) } catch (e) { s.speaking = Math.max(0, s.speaking - 1); log(`[Relay] speak failed ${s.ccid}: ${txError(e)}`); return { error: [502, 'speak_failed', 'That message could not be read out. Try again.'] } }
  }
  return { line }
}

// Keypad tones, for phone menus ("press 1 for…").
async function dtmf(id, chatId, digits) {
  const s = await liveSession(id, chatId)
  if (!s || s.status !== 'live') return { error: [409, 'not_connected', 'The call is not connected.'] }
  const d = String(digits || '').replace(/[^0-9*#]/g, '').slice(0, 20)
  if (!d) return { error: [400, 'invalid_digits', 'Press 0–9, * or #.'] }
  addLine(s, 'key', d)
  if (!s.dryRun) await tx(`/calls/${s.ccid}/actions/send_dtmf`, { digits: d, duration_millis: 250 }).catch(e => log(`[Relay] dtmf failed: ${txError(e)}`))
  return { ok: true }
}

async function hangup(id, chatId, why = 'hung_up') {
  const s = await liveSession(id, chatId)
  if (!s) return { ok: true }
  s.endReason = why
  if (s.dryRun) await finish(s, {})
  else await tx(`/calls/${s.ccid}/actions/hangup`, {}).catch(() => finish(s, {}))
  return { ok: true }
}

async function answered(s) {
  if (s.answeredAt) return
  s.answeredAt = new Date()
  s.status = 'live'
  col.updateOne({ _id: s._id }, { $set: { status: 'live', answeredAt: s.answeredAt, beatAt: s.answeredAt } }).catch(() => {})
  watchWallet(s)
  const L = LANGS[s.lang]
  if (s.announce) {
    s.speaking++
    addLine(s, 'note', 'intro')
    if (!s.dryRun) tx(`/calls/${s.ccid}/actions/speak`, { payload: L.intro(s.name || spokenNumber(s.callerId)), voice: s.voice, language: L.tts, command_id: crypto.randomUUID() }).catch(e => { s.speaking--; log(`[Relay] intro failed: ${txError(e)}`) })
  }
  if (s.dryRun) return
  const cfg = { transcription_engine: 'Google', transcription_engine_config: { transcription_engine: 'Google', language: L.stt, interim_results: true }, transcription_tracks: 'inbound' }
  try { await tx(`/calls/${s.ccid}/actions/transcription_start`, cfg) } catch (e) {
    log(`[Relay] Google transcription failed (${txError(e)}) — trying Telnyx engine`)
    await tx(`/calls/${s.ccid}/actions/transcription_start`, { transcription_engine: 'Telnyx', transcription_engine_config: { transcription_engine: 'Telnyx', language: L.stt }, transcription_tracks: 'inbound' })
      .catch(e2 => { log(`[Relay] transcription failed ${s.ccid}: ${txError(e2)}`); addLine(s, 'note', 'no_transcription') })
  }
}

// Speech of the other person: interim text replaces the live line, final text becomes a message.
function onText(s, text, final) {
  const t = String(text || '').trim()
  if (!final) { s.interim = t; return }
  s.interim = ''
  if (t) addLine(s, 'them', t)
}

// Ends the call once the wallet can't pay for the next minute.
function watchWallet(s) {
  s.walletTimer = setInterval(async () => {
    beat(s)
    try {
      const mins = Math.ceil((Date.now() - s.answeredAt.getTime()) / 60000) + 1
      const { usdBal } = await getBalance(deps.walletOf, s.chatId)
      if (usdBal < mins * s.rate && !s.wrapping) {
        s.wrapping = true
        addLine(s, 'note', 'out_of_funds')
        if (!s.dryRun) await tx(`/calls/${s.ccid}/actions/speak`, { payload: LANGS[s.lang].outOfFunds, voice: s.voice, language: LANGS[s.lang].tts }).catch(() => {})
        setTimeout(() => hangup(s._id, s.chatId, 'out_of_funds'), 8000)
      }
    } catch (_) { /* keep the call */ }
  }, 50000)
}

async function onWebhook(eventType, payload) {
  const ccid = payload.call_control_id
  const s = sessions.get(byCcid.get(ccid)) || await revive({ ccid })
  if (!s) {
    if (eventType === 'call.answered') tx(`/calls/${ccid}/actions/hangup`, {}).catch(() => {}) // a relay call nobody can run
    return
  }
  if (eventType === 'call.answered') await answered(s)
  else if (eventType === 'call.transcription') { const d = payload.transcription_data || {}; onText(s, d.transcript, d.is_final !== false) }
  else if (eventType === 'call.speak.ended') s.speaking = Math.max(0, s.speaking - 1)
  else if (eventType === 'call.hangup') await finish(s, payload).catch(e => log(`[Relay] finish error: ${e.stack || e.message}`))
}

// Settles a finished call: per started minute × (call rate + relay fee), saved with the transcript.
async function finish(s, payload) {
  if (s.done) return
  s.done = true
  sessions.delete(s._id); byCcid.delete(s.ccid)
  clearInterval(s.walletTimer); clearTimeout(s.maxTimer); preview.stop(s)
  await settle(s, new Date(), payload?.hangup_cause || null)
}

// Calls whose process stopped beating: hang up and bill up to their last sign of life.
async function sweep() {
  const old = await col.find({ status: { $in: OPEN }, $nor: [fresh()] }).limit(50).toArray()
  for (const d of old) {
    if (sessions.has(d._id)) continue
    if (!d.dryRun && d.ccid) await tx(`/calls/${d.ccid}/actions/hangup`, {}).catch(() => {})
    const last = Math.max(new Date(d.beatAt || d.createdAt).getTime(), ...(d.lines || []).map(l => new Date(l.at).getTime()))
    await settle(d, new Date(last), null)
    log(`[Relay] closed stale text call ${d._id}`)
  }
}

// Saves the end of a call once (status guard) and bills it once (ledger callRef).
async function settle(s, endedAt, cause) {
  const answeredAt = s.answeredAt ? new Date(s.answeredAt) : null
  const duration = answeredAt ? Math.max(0, Math.round((endedAt - answeredAt) / 1000)) : 0
  const minutes = duration ? Math.max(1, Math.ceil(duration / 60)) : 0
  const charge = s.dryRun ? 0 : +(minutes * s.rate).toFixed(4)
  const outcome = answeredAt ? (s.endReason === 'out_of_funds' ? 'out_of_funds' : 'completed') : (cause === 'user_busy' ? 'busy' : s.endReason === 'hung_up' ? 'cancelled' : 'no_answer')
  const r = await col.updateOne({ _id: s._id, status: { $in: OPEN } }, { $set: { status: 'ended', outcome, endedAt, duration, minutes, charge, hangupCause: cause } })
  if (!r.modifiedCount) return
  if (charge > 0 && deps.walletOf) {
    await smartWalletDeduct(deps.walletOf, s.chatId, charge, {
      type: 'text_relay_call', callType: 'TextRelay', destination: s.to, phoneNumber: s.callerId, callRef: `relay:${s._id}`,
      description: `Text call ${s.callerId} → ${s.to} (${minutes} min × $${s.rate} incl. $${s.relayRate} text relay)`,
    }).catch(e => log(`[Relay] billing error: ${e.message}`))
  }
  log(`[Relay] text call ${s.to} ended: ${duration}s, ${outcome}, $${charge}`)
  if (deps.bot && answeredAt) Promise.resolve(deps.bot.sendMessage(s.chatId, `⌨️ <b>Text call</b> ${s.callerId} → ${s.to} · ${Math.floor(duration / 60)}m ${duration % 60}s${charge ? ` · $${charge.toFixed(2)}` : ''}`, { parse_mode: 'HTML' })).catch(() => {})
}

const list = (chatId, limit = 30) => col.find({ chatId: String(chatId) }, { projection: { lines: { $slice: -1 } } }).sort({ createdAt: -1 }).limit(limit).toArray()
async function remove(id, chatId) {
  if (!(await col.findOne({ _id: String(id), chatId: String(chatId) }, { projection: { _id: 1 } }))) return { error: [404, 'not_found', 'Call not found.'] }
  if (sessions.has(String(id)) || await col.findOne({ _id: String(id), status: { $in: OPEN }, ...fresh() }, { projection: { _id: 1 } })) return { error: [409, 'live', 'Hang up before deleting this call.'] }
  const r = await col.deleteOne({ _id: String(id), chatId: String(chatId) })
  return r.deletedCount ? { ok: true } : { error: [404, 'not_found', 'Call not found.'] }
}

module.exports = { init, owns, onWebhook, start, say, dtmf, hangup, find, view, list, remove, liveFor, sweep, RELAY_RATE, LANGS, MAX_TEXT }
