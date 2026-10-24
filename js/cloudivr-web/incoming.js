'use strict'
// "Ring me in the browser": inbound calls ringing in the open web app. The app polls GET /incoming (which also marks
// the account online, so new calls ring here), then answers as text (relay engine), by voice (browser phone — the
// actual answer happens in WebRTC) or declines (the number's fallback runs now). Preview: POST /incoming/simulate.
const phoneConfig = require('../phone-config')
const relay = require('../relay-call')
const ringing = require('../relay-call/incoming')
const notify = require('./notify')
const { normPhone, E164 } = require('./numbers')

const dryRun = () => process.env.WEB_CLOUDIVR_DRY_RUN === 'true'
const bad = (res, status, error, message) => res.status(status).json({ error, message })
const fail = (res, r) => bad(res, ...r.error)
const GONE = 'This call was already answered or ended.'
const DEFAULTS = { enabled: false, answerMode: 'ask', lang: 'en', voice: 'female', announce: true }
const settingsOf = (n) => ({ ...DEFAULTS, ...(n?.features?.browserRing || {}) })

// What a live number would have done with the call (forward on no answer / busy → voicemail → missed).
function fallbackText(n, declined) {
  const f = n?.features || {}
  const fw = f.callForwarding
  if (fw?.enabled && fw.forwardTo && (fw.mode === 'no_answer' || (fw.mode === 'busy' && declined))) return `forwarded to ${fw.forwardTo}`
  if (f.voicemail?.enabled && phoneConfig.canAccessFeature(n.plan, 'voicemail')) return 'sent to voicemail'
  return 'a missed call'
}

function routes(router, { h, numbersApi, voiceService, log = console.log }) {
  const callRate = (from) => voiceService.getIvrCallRate(from)
  const canVoiceOn = (n, r) => !!n && !r.simulated && !!n.telnyxSipUsername && phoneConfig.canAccessFeature(n.plan, 'sipCredentials') && !n.sipDisabled

  const publicRing = async (chatId, r) => {
    const n = await numbersApi.findMine(chatId, r.phone)
    const br = settingsOf(n)
    return {
      id: r.id, phone: r.phone, from: r.from, startedAt: r.startedAt, timeoutAt: r.timeoutAt, simulated: r.simulated,
      answerMode: br.answerMode, lang: br.lang, voice: br.voice, announce: br.announce !== false,
      canText: !!n && phoneConfig.canAccessFeature(n.plan, 'textRelay'), canVoice: canVoiceOn(n, r),
      textRate: +(callRate(r.from) + relay.RELAY_RATE()).toFixed(4), fallback: fallbackText(n, false),
    }
  }
  const saveMode = (chatId, n, mode) => numbersApi.setField(chatId, n.phoneNumber, 'features.browserRing', { ...settingsOf(n), answerMode: mode })

  // Preview banner call that nobody took (or was declined): tell the owner what a live number would have done.
  async function previewFallback(r, why) {
    const n = await numbersApi.findMine(r.chatId, r.phone)
    const declined = why === 'declined'
    await notify.push(r.chatId, `Preview: browser call from ${r.from} to ${r.phone} — ${declined ? 'you declined it' : 'nobody answered'}. On a live number it would be ${fallbackText(n, declined)}.`, null, { kind: 'call' }).catch(() => {})
  }

  router.get('/incoming', h(async (req, res) => {
    ringing.seen(req.webChatId)
    const calls = await Promise.all(ringing.list(req.webChatId).map(r => publicRing(req.webChatId, r)))
    res.json({ calls, pollMs: 2000, now: new Date() })
  }))

  router.post('/incoming/simulate', h(async (req, res) => {
    if (!dryRun()) return bad(res, 404, 'not_found', 'Not available.')
    const chatId = req.webChatId
    const n = await numbersApi.findMine(chatId, req.body?.phone)
    if (!n || n.status !== 'active') return bad(res, 400, 'invalid_number', 'Pick one of your active numbers.')
    if (!phoneConfig.canAccessFeature(n.plan, 'textRelay')) return bad(res, 403, 'plan_upgrade_required', 'Ringing in the browser needs the Pro plan or higher on this number.')
    if (!settingsOf(n).enabled) return bad(res, 400, 'not_enabled', 'Switch on "Ring me in the browser" for this number and save first.')
    if (ringing.list(chatId).length >= 3) return bad(res, 429, 'too_many', 'Answer or decline the calls already ringing first.')
    const from = normPhone(req.body?.from || '+14155550123')
    if (!E164.test(from) || from === n.phoneNumber) return bad(res, 400, 'invalid_from', 'Enter the pretend caller with country code, e.g. +14155550123.')
    ringing.seen(chatId)
    const secs = Math.min(60, Math.max(10, n.features?.callForwarding?.ringTimeout || 25))
    const r = ringing.add({ chatId, phone: n.phoneNumber, from, timeoutMs: secs * 1000, simulated: true, onTimeout: (x) => previewFallback(x, 'timeout') })
    log(`[CloudIVR-Web] preview browser ring ${from} → ${n.phoneNumber} for ${chatId}`)
    res.status(201).json({ call: await publicRing(chatId, r) })
  }))

  router.post('/incoming/:id/text', h(async (req, res) => {
    const chatId = req.webChatId, b = req.body || {}
    const r = ringing.get(req.params.id, chatId)
    if (!r) return bad(res, 409, 'not_ringing', GONE)
    const n = await numbersApi.findMine(chatId, r.phone)
    if (!n || !phoneConfig.canAccessFeature(n.plan, 'textRelay')) return bad(res, 403, 'plan_upgrade_required', 'Answering as text needs the Pro plan or higher on this number.')
    const br = settingsOf(n)
    const opts = {
      lang: relay.LANGS[b.lang] ? b.lang : (relay.LANGS[br.lang] ? br.lang : 'en'),
      voice: (b.voice || br.voice) === 'male' ? 'male' : 'female',
      announce: b.announce === undefined ? br.announce !== false : b.announce !== false,
    }
    // Wallet / one-call-at-a-time checks first: on failure the call keeps ringing (its fallback still runs).
    const q = await relay.quote(chatId, callRate(r.from))
    if (q.error) return fail(res, q)
    if (await relay.liveFor(chatId)) return bad(res, 409, 'already_live', 'You already have a text call going. Hang it up first.')
    const taken = ringing.take(r.id, chatId)
    if (!taken) return bad(res, 409, 'not_ringing', GONE)
    let call = { ccid: null, from: taken.from, to: taken.phone }
    if (!taken.simulated) {
      call = voiceService.takeInboundForText(taken.ccid, chatId)
      if (!call) return bad(res, 409, 'not_ringing', GONE)
    }
    if (b.remember) await saveMode(chatId, n, 'text')
    const out = await relay.answerInbound({ chatId, ccid: call.ccid, from: call.from, to: call.to, ...opts, callRate: callRate(call.from), simulated: taken.simulated })
    if (out.error) return fail(res, out)
    res.status(201).json({ call: relay.view(await relay.find(out.id, chatId)) })
  }))

  router.post('/incoming/:id/voice', h(async (req, res) => {
    const chatId = req.webChatId
    const r = ringing.get(req.params.id, chatId)
    if (!r) return bad(res, 409, 'not_ringing', GONE)
    const n = await numbersApi.findMine(chatId, r.phone)
    if (req.body?.remember && n) await saveMode(chatId, n, 'voice')
    const canVoice = canVoiceOn(n, r)
    res.json({ canVoice, message: canVoice ? 'Answer in the browser phone.' : r.simulated ? 'Preview calls can only be answered as text — preview numbers are not live on the network.' : 'Answering by voice needs live SIP logins on this number (Pro and up) and the browser phone connected.' })
  }))

  router.post('/incoming/:id/decline', h(async (req, res) => {
    const chatId = req.webChatId
    const r = ringing.take(req.params.id, chatId)
    if (!r) return bad(res, 409, 'not_ringing', GONE)
    if (r.simulated) await previewFallback(r, 'declined')
    else await voiceService.declineBrowserRing(r.ccid, chatId)
    res.json({ declined: true })
  }))
}

module.exports = { routes, settingsOf, DEFAULTS }
