'use strict'
// AI agent phone calls (inbound receptionist + outbound campaign leads) and free browser test talks.
// Calls run on our own call engine (Bird for outbound, SignalWire hands inbound calls over by SIP); audio is RTP (./rtp).
const crypto = require('crypto')
const axios = require('axios')
const store = require('./store')
const { Bridge } = require('./bridge')
const recorder = require('./recorder')
const booking = require('./booking')
const { SAMPLE_LEAD } = require('./opening')
const phoneConfig = require('../phone-config')
const telnyxApi = require('../telnyx-service')
const ce = require('../callengine')
const bird = require('../bird')
const rtp = require('./rtp')
const numberHours = require('../number-hours')
const { getBalance, smartWalletDeduct } = require('../utils.js')

const RATE = () => parseFloat(process.env.AI_AGENT_RATE_PER_MIN || '0.30')
// AI receptionist (incoming calls the agent answers): its own per-minute price, on every plan.
const RECEPTION_RATE = () => parseFloat(process.env.AI_RECEPTIONIST_RATE_PER_MIN || '0.10')
const TEST_MAX_SECS = 180
const TEST_DAILY_SECS = 15 * 60
const CLIENT_STATE = Buffer.from('ai_agent').toString('base64')
const BASE = 'https://api.telnyx.com/v2'
let deps = {}
const sessions = new Map() // call_control_id → live call
const streamTokens = new Map() // stream token → call_control_id
const testTokens = new Map() // test token → { chatId, agentId, as, exp }
const carriers = new Set() // SignalWire inbound calls handed to the call engine (the agent runs on the SIP leg)

const log = (...a) => (deps.log || console.log)(...a)
const newToken = () => crypto.randomBytes(18).toString('base64url')
const tx = (path, body) => axios.post(`${BASE}${path}`, body, { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 })
const txError = (e) => e.response?.data?.errors?.[0]?.detail || e.message
const wsBase = () => String(deps.selfUrl || process.env.SELF_URL || '').replace(/^http/, 'ws').replace(/\/$/, '')
const streamParams = (t) => ({ stream_url: `${wsBase()}/ai-agent/stream/${t}`, stream_track: 'inbound_track', stream_bidirectional_mode: 'rtp', stream_bidirectional_codec: 'PCMU' })
// Recorded calls cost AI_RECORDING_RATE_PER_MIN more per started minute (agents record unless switched off).
const records = (agent) => agent?.record !== false
const recRate = (agent) => (records(agent) ? recorder.RECORD_RATE() : 0)
const leadRate = (number, recorded = false) => Math.max(RATE(), deps.voiceService?.getIvrCallRate?.(number) || 0) + (recorded ? recorder.RECORD_RATE() : 0)
const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
const hangup = (ccid) => Promise.resolve(ce.isAe(ccid) ? ce.hangupCall(ccid) : tx(`/calls/${ccid}/actions/hangup`, {})).catch(() => {})
const birdMax = () => Number(process.env.BIRD_MAX_CONCURRENT || 20)
const engineUp = () => ce.enabled() && ce.connected() && bird.enabled()

function init(d) {
  deps = d
  ce.setAiHook((token, legId) => onAiLeg(token, legId).catch(e => { log(`[AIAgent] inbound leg error: ${e.message}`); hangup(legId) }))
}

// Starts the call's audio to the AI (externalMedia on the call engine → RTP to this server).
async function startMedia(s) {
  if (s.mediaStarted) return
  s.mediaStarted = true
  const r = await ce.startExternalMedia(s.ccid, rtp.host())
  if (!r?.port) { log(`[AIAgent] no audio link for ${s.ccid} — hanging up`); return hangup(s.ccid) }
  onStream(s.token, rtp.open(r.port, r.address))
}

// The SIP leg SignalWire opened to our call engine for an inbound AI call: the agent now runs on that leg.
async function onAiLeg(token, legId) {
  const s = [...sessions.values()].find(x => x.token === token && x.awaitingLeg)
  if (!s) return hangup(legId)
  sessions.delete(s.ccid)
  s.awaitingLeg = false
  s.carrierId = s.ccid
  carriers.add(s.ccid)
  s.ccid = legId
  sessions.set(legId, s)
  streamTokens.set(s.token, legId)
  await ce.answerCall(legId)
  if (!s.answeredAt) s.answeredAt = Date.now()
  watchWallet(s)
  await startMedia(s)
}
const owns = (ccid, payload) => sessions.has(ccid) || carriers.has(ccid) || payload?.client_state === CLIENT_STATE
const activeCount = () => sessions.size

function track(ccid, s) {
  sessions.set(ccid, { ...s, ccid, startedAt: new Date() })
  streamTokens.set(s.token, ccid)
  return sessions.get(ccid)
}
function forget(s) { sessions.delete(s.ccid); streamTokens.delete(s.token); clearInterval(s.walletTimer); s.rtpMedia?.close() }

// Inbound: the number's AI agent answers (Business, wallet covers a minute). false → route the call normally.
async function tryInbound({ payload, chatId, num }) {
  const cfg = num.features?.aiAgent
  if (!cfg?.enabled || !phoneConfig.canAccessFeature(num.plan, 'aiAgent')) return false
  const agent = await store.getAgent(cfg.agentId, chatId)
  if (!agent || agent.disabled || !process.env.APP_OPEN_API_KEY) return false
  // Receptionist business hours: when closed, either take a message (AI answers) or go straight to voicemail.
  const closed = !!agent.hours?.enabled && !numberHours.isOpen(agent.hours)
  if (closed && agent.hours.afterHours === 'voicemail') { log(`[AIAgent] ${num.phoneNumber}: outside "${agent.name}" hours — voicemail`); return 'voicemail' }
  const rate = RECEPTION_RATE() + recRate(agent)
  const { usdBal } = await getBalance(deps.walletOf, chatId)
  if (usdBal < rate + committed(chatId)) { log(`[AIAgent] ${num.phoneNumber}: wallet $${usdBal} < $${rate}/min — normal routing`); return false }
  const other = (payload.from || '').replace(/[^+\d]/g, '')
  const calendar = await booking.forCall(chatId, agent, other).catch(() => null)
  const s = track(payload.call_control_id, { kind: 'inbound', afterHours: closed, rate, baseRate: RECEPTION_RATE(), recRate: recRate(agent), calendar, token: newToken(), chatId: String(chatId), agent, number: num.phoneNumber, other })
  try {
    if (ce.isAe(s.ccid)) {
      await ce.answerCall(s.ccid)
      s.answeredAt = Date.now()
      watchWallet(s)
      await startMedia(s)
    } else if (String(s.ccid).startsWith('sw:')) {
      // SignalWire number: hand the call to our call engine by SIP, where the agent picks it up (onAiLeg).
      if (!engineUp()) throw new Error('call engine offline')
      s.awaitingLeg = true
      const ok = await require('../signalwire/voice').transferCall(s.ccid, `sip:ai.${ce.app()}.${s.token}@${process.env.SIP_DOMAIN || 'sip.cloudivr.net'}`, num.phoneNumber, { timeoutSecs: 15 })
      if (!ok) throw new Error('handover to the call engine failed')
      setTimeout(() => { if (s.awaitingLeg) { log(`[AIAgent] ${s.ccid}: SIP handover never arrived — hanging up`); forget(s); hangup(s.ccid) } }, 25000).unref?.()
    } else {
      await tx(`/calls/${s.ccid}/actions/answer`, streamParams(s.token))
      s.answeredAt = Date.now()
      watchWallet(s)
    }
    log(`[AIAgent] Inbound ${s.other} → ${s.number} answered by "${agent.name}"`)
    return true
  } catch (e) {
    log(`[AIAgent] answer failed ${s.ccid}: ${txError(e)}`)
    forget(s)
    return false
  }
}

// Outbound campaign lead → { callControlId } | { error }.
async function dialLead(campaign, lead) {
  const agent = await store.getAgent(campaign.agentId, campaign.chatId)
  if (!agent) return { error: 'The AI agent for this campaign was deleted.' }
  if (agent.disabled) return { error: 'This AI agent was stopped by CloudIVR. Contact support.' }
  if (!/^\+1\d{10}$/.test(String(lead.number))) return { error: 'AI agent calls reach US and Canada numbers only.' }
  // Outbound AI calls go through Bird; while Bird can't take the call the lead waits in the queue (lineLimit).
  if (!engineUp()) return { error: 'AI calling line is offline — waiting', lineLimit: true }
  const showAs = require('../cloudivr-web/caller-ids').enabled() && campaign.showAs
  const from = showAs && await bird.presentable(showAs) ? showAs : campaign.callerId
  if (!(await bird.presentable(from))) return { error: `caller ID ${from} not linked on Bird yet — waiting`, lineLimit: true }
  if ((await bird.spendLeft()) < Number(process.env.BIRD_MIN_SPEND_LEFT || 1)) return { error: 'Bird daily spend cap reached — waiting', lineLimit: true }
  if (ce.activeBird() >= birdMax()) return { error: `all ${birdMax()} Bird lines busy — waiting for a free line`, lineLimit: true }
  const token = newToken()
  const calendar = await booking.forCall(campaign.chatId, agent, lead.number).catch(() => null)
  try {
    const r = await ce.createOutboundCall(from, lead.number, null, null, { client_state: CLIENT_STATE, timeout_secs: 30 })
    if (r.error) return { error: r.error, lineLimit: !!r.refused || r.status === 503 }
    const ccid = r.callControlId
    track(ccid, { kind: 'outbound', rate: leadRate(lead.number, records(agent)), baseRate: leadRate(lead.number), recRate: recRate(agent), calendar, token, chatId: String(campaign.chatId), agent, number: campaign.callerId, other: lead.number, leadName: lead.name || null, campaignId: campaign.id, leadIndex: lead.index, reason: lead.reason || null })
    return { callControlId: ccid }
  } catch (e) {
    const err = e.response?.data?.errors?.[0]
    return { error: txError(e), lineLimit: telnyxApi.isLineLimitError({ error: txError(e), code: err?.code, status: e.response?.status }) }
  }
}

// Money already promised to this account's live AI calls: each started minute + the next one.
function committed(chatId) {
  let sum = 0
  for (const s of sessions.values()) {
    if (s.chatId !== String(chatId) || !s.answeredAt) continue
    sum += (Math.ceil((Date.now() - s.answeredAt) / 60000) + 1) * (s.rate || RATE())
  }
  return sum
}

// Says goodbye and hangs up once the wallet can't pay for the next minute (all live AI calls of the account count).
function watchWallet(s) {
  if (s.walletTimer) return
  s.walletTimer = setInterval(async () => {
    try {
      const { usdBal } = await getBalance(deps.walletOf, s.chatId)
      if (usdBal < committed(s.chatId) && !s.wrapping) {
        s.wrapping = true
        log(`[AIAgent] ${s.ccid}: wallet $${usdBal} can't cover the next minute — wrapping up`)
        s.bridge?.wrapUp('The account balance is used up.')
        setTimeout(() => hangup(s.ccid), 15000)
      }
    } catch (_) { /* keep the call */ }
  }, 50000)
}

async function onWebhook(eventType, payload) {
  if (carriers.has(payload.call_control_id)) { if (eventType === 'call.hangup') { carriers.delete(payload.call_control_id); const s = [...sessions.values()].find(x => x.carrierId === payload.call_control_id); if (s) hangup(s.ccid) } return }
  const s = sessions.get(payload.call_control_id)
  if (!s) return
  if (eventType === 'call.answered' && !s.answeredAt) { s.answeredAt = Date.now(); watchWallet(s); if (ce.isAe(s.ccid)) startMedia(s).catch(e => log(`[AIAgent] media error: ${e.message}`)); signal(s, 'answered') }
  else if (eventType === 'call.machine.detection.ended' || eventType === 'call.machine.premium.detection.ended') {
    const r = payload.result || null
    s.answeredBy = /^human/.test(r || '') ? 'human' : r
    if (r === 'machine' || r === 'fax_detected') signal(s, 'onMachine')
  } else if (eventType === 'call.machine.greeting.ended' || eventType === 'call.machine.premium.greeting.ended') {
    if (/beep_detected|ended/.test(payload.result || 'ended')) signal(s, 'beep')
  }
  else if (eventType === 'streaming.failed') { log(`[AIAgent] stream failed ${s.ccid}: ${payload.failure_reason || ''}`); hangup(s.ccid) }
  else if (eventType === 'call.hangup') await finish(s, payload).catch(e => log(`[AIAgent] finish error: ${e.stack || e.message}`))
}

// Call events can arrive before Telnyx opens the media stream: queue them for the bridge.
function signal(s, what) {
  if (s.bridge) return s.bridge[what]()
  ;(s.pending = s.pending || []).push(what)
}

// Telnyx opened the media stream for a tracked call.
function onStream(token, ws) {
  const s = sessions.get(streamTokens.get(token))
  if (!s || s.bridge) return ws.close()
  if (ws instanceof rtp.RtpMedia) s.rtpMedia = ws
  s.bridge = new Bridge({
    agent: s.agent, ctx: { direction: s.kind, leadName: s.leadName, callerNumber: s.other, calendar: s.calendar, record: records(s.agent), reason: s.reason || null, afterHours: !!s.afterHours }, media: ws, log,
    actions: { hangup: (why) => { log(`[AIAgent] hangup ${s.ccid}: ${why}`); hangup(s.ccid) }, transfer: (to) => transfer(s, to) },
  })
  ws.on('message', (m) => { try { s.bridge.onMedia(JSON.parse(m)) } catch (_) { /* bad frame */ } })
  ws.on('close', () => s.bridge.stop())
  s.bridge.start()
  for (const what of s.pending || []) s.bridge[what]()
  s.pending = null
}

async function transfer(s, to) {
  s.transferAt = Date.now()
  s.transferredTo = to
  s.bridge?.stop()
  if (ce.isAe(s.ccid)) {
    s.rtpMedia?.close()
    await ce.stopExternalMedia(s.ccid)
    const ok = await ce.transferCall(s.ccid, to, s.number, { targetLegClientState: 'nomadly_pstn_leg', timeoutSecs: 30 })
    if (!ok) { log(`[AIAgent] transfer to ${to} failed — hanging up ${s.ccid}`); hangup(s.ccid) }
    return
  }
  await tx(`/calls/${s.ccid}/actions/streaming_stop`, {}).catch(() => {})
  const ok = await telnyxApi.transferCall(s.ccid, to, s.number, { targetLegClientState: 'nomadly_pstn_leg', timeoutSecs: 30 }).catch(() => null)
  if (!ok) { log(`[AIAgent] transfer to ${to} failed — hanging up ${s.ccid}`); hangup(s.ccid) }
}

// Settles a finished call: record + summary, opt-out, billing (inbound) or campaign lead result (outbound), owner notice.
async function finish(s, payload) {
  if (s.done) return
  s.done = true
  forget(s)
  s.bridge?.stop()
  const endAt = Date.now()
  const duration = s.answeredAt ? Math.round((endAt - s.answeredAt) / 1000) : 0
  const aiSecs = s.answeredAt ? Math.round(((s.transferAt || endAt) - s.answeredAt) / 1000) : 0
  const restSecs = s.transferAt ? Math.round((endAt - s.transferAt) / 1000) : 0
  const res = s.bridge?.result || { transcript: [], usage: {} }
  const [sum, recording] = await Promise.all([
    res.transcript.length ? store.summarize(res.transcript, s.agent) : null,
    duration ? saveRecording(s.bridge?.rec, s.chatId) : null,
  ])
  const machine = res.voicemail || s.answeredBy === 'machine'
  const talked = (res.transcript || []).some(x => x.role === 'caller')
  const outcome = res.optedOut ? 'opted_out' : res.booking ? 'booked' : s.transferredTo ? 'transferred' : machine ? 'voicemail' : res.screened && !res.outcome && !sum?.outcome && (res.transcript || []).filter(x => x.role === 'caller').length <= 1 ? 'screened' : !duration ? 'no_answer' : !talked && !res.outcome ? 'no_conversation' : res.outcome || (res.message ? 'message' : sum?.outcome) || (duration ? 'other' : null)
  // The recording surcharge only applies when an MP3 was actually saved.
  const baseRate = s.baseRate ?? (s.kind === 'inbound' ? RECEPTION_RATE() : leadRate(s.other))
  const recordingRate = recording ? (s.recRate ?? recorder.RECORD_RATE()) : 0
  const rate = +(baseRate + recordingRate).toFixed(4)
  const fwdRate = (s.transferredTo && deps.voiceService?.getIvrCallRate?.(s.transferredTo)) || 0.15
  const aiMin = duration ? Math.max(1, Math.ceil(aiSecs / 60)) : 0
  const restMin = restSecs > 0 ? Math.ceil(restSecs / 60) : 0
  const charge = +(aiMin * rate + restMin * fwdRate).toFixed(4)
  if (res.optedOut) await store.addDnc(s.chatId, s.other, 'asked on an AI call').catch(() => {})
  const callId = await store.saveCall({
    chatId: s.chatId, agentId: s.agent.id, agentName: s.agent.name, direction: s.kind, number: s.number, other: s.other, leadName: s.leadName || null,
    campaignId: s.campaignId || null, leadIndex: s.leadIndex ?? null, startedAt: s.startedAt, answeredAt: s.answeredAt ? new Date(s.answeredAt) : null, endedAt: new Date(endAt),
    duration, minutesBilled: aiMin + restMin, charge: duration ? charge : 0, rate, recordingRate, outcome, summary: sum?.summary || null, note: res.note, message: res.message,
    transferredTo: s.transferredTo || null, optedOut: res.optedOut, answeredBy: s.answeredBy || null, hangupCause: payload?.hangup_cause || null, transcript: res.transcript, usage: res.usage,
    booking: res.booking || null, afterHours: !!s.afterHours, handledAt: null, ...recordingFields(recording),
  })
  log(`[AIAgent] ${s.kind} call ${s.other} ended: ${duration}s, outcome=${outcome}, charge=$${duration ? charge : 0}`)

  require('../cloudivr-web/events').emit(s.chatId, 'call.ended', { number: s.number, from: s.kind === 'inbound' ? s.other : s.number, to: s.kind === 'inbound' ? s.number : s.other, direction: s.kind, duration, outcome: `ai_${outcome || 'no_answer'}`, summary: sum?.summary || null, agent: s.agent.name, callId: s.ccid })
  // Campaign leads settle in the campaign; one-off outbound calls (Text Triggers) bill here like inbound ones.
  if (s.kind === 'outbound' && s.campaignId) {
    return require('../bulk-call-service').onCallComplete(s.ccid, {
      campaignId: s.campaignId, leadIndex: s.leadIndex, duration, hangupCause: payload?.hangup_cause || null, sipHangupCause: payload?.sip_hangup_cause || null,
      answeredAt: s.answeredAt ? new Date(s.answeredAt) : null, answeredBy: machine ? 'machine' : (s.answeredBy || null), voicemailDropped: res.voicemail && duration > 5,
      transferred: !!s.transferredTo, transferConnected: !!s.transferredTo && restSecs > 0,
      ai: { outcome, summary: sum?.summary || null, callId, booking: res.booking ? { day: res.booking.day, time: res.booking.time, start: res.booking.start } : null },
      aiBilling: duration ? { minutesBilled: aiMin + restMin, charge, rate, recordingRate } : null,
    })
  }
  if (duration && deps.walletOf) {
    await smartWalletDeduct(deps.walletOf, s.chatId, charge, {
      type: 'ai_agent_call', callType: 'AIAgent', destination: s.other, phoneNumber: s.number,
      description: `AI agent "${s.agent.name}": ${s.other} → ${s.number} (${aiMin} min × $${rate}${recordingRate ? ` incl. $${recordingRate} recording` : ''}${restMin ? ` + ${restMin} min transferred` : ''})`,
    }).catch(e => log(`[AIAgent] billing error: ${e.message}`))
  }
  const msg = res.message ? `\n✉️ Message${res.message.name ? ` from ${esc(res.message.name)}` : ''}${res.message.callback ? ` (${esc(res.message.callback)})` : ''}: ${esc(res.message.text)}` : ''
  notice(s.chatId, `🤖 <b>AI agent call</b> · ${esc(s.agent.name)}\n${esc(s.other)} → ${esc(s.number)} · ${duration}s · ${esc(outcome || 'no answer')}${sum?.summary ? `\n${esc(sum.summary)}` : ''}${msg}${bookedLine(res.booking)}${duration ? `\n💳 $${charge.toFixed(2)}` : ''}`, recording)
}

// MP3 of the call (both sides) in our audio storage → { url, file, seconds, expiresAt } | null. Never blocks settling.
async function saveRecording(rec, chatId) {
  if (!rec || !deps.audioLibraryService?.saveBuffer) return null
  try { return await recorder.save(rec, chatId, deps.audioLibraryService.saveBuffer) } catch (e) { log(`[AIAgent] recording save failed: ${e.message}`); return null }
}
const recordingFields = (r) => (r ? { recordingUrl: r.url, recordingFile: r.file, recordingSeconds: r.seconds, recordingExpiresAt: r.expiresAt } : { recordingUrl: null })
const bookedLine = (b) => (b ? `\n📅 Booked: ${esc(b.day)} at ${esc(b.time)}${b.name ? ` · ${esc(b.name)}` : ''}` : '')
// Owner's inbox: with the recording attached as playable audio when there is one.
function notice(chatId, text, recording) {
  if (!deps.bot) return
  const p = recording?.url && deps.bot.sendAudio ? deps.bot.sendAudio(chatId, recording.url, { caption: `${text}\n🎧 Recording`, parse_mode: 'HTML' }) : deps.bot.sendMessage(chatId, text, { parse_mode: 'HTML' })
  Promise.resolve(p).catch(() => {})
}

// ── Browser test talk (free, capped): the page speaks the same media protocol as Telnyx. ──
async function createTest(chatId, agentId, as) {
  const agent = await store.getAgent(agentId, chatId)
  if (!agent) return { error: [404, 'not_found', 'Agent not found.'] }
  if (!process.env.APP_OPEN_API_KEY) return { error: [503, 'ai_unavailable', 'AI calls are not available right now.'] }
  const used = await store.testSecondsToday(chatId)
  if (used >= TEST_DAILY_SECS - 10) return { error: [429, 'test_limit', 'You have used today’s 15 free test minutes. Try again tomorrow.'] }
  const token = newToken()
  const calendar = await booking.forCall(chatId, agent, null).catch(() => null)
  testTokens.set(token, { chatId: String(chatId), agentId: agent.id, as: as === 'outbound' ? 'outbound' : 'inbound', calendar, exp: Date.now() + 60000 })
  return { token, maxSeconds: Math.min(TEST_MAX_SECS, TEST_DAILY_SECS - used) }
}

async function onTest(token, ws) {
  const t = testTokens.get(token)
  testTokens.delete(token)
  if (!t || t.exp < Date.now()) return ws.close(4001, 'expired')
  const agent = await store.getAgent(t.agentId, t.chatId)
  if (!agent) return ws.close(4004, 'not found')
  const maxSecs = Math.min(TEST_MAX_SECS, TEST_DAILY_SECS - await store.testSecondsToday(t.chatId))
  const startedAt = new Date()
  const sendUi = (o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)) }
  const bridge = new Bridge({
    agent: { ...agent, maxMinutes: Math.max(0.6, maxSecs / 60) }, ctx: { direction: t.as, leadName: t.as === 'outbound' ? SAMPLE_LEAD : null, test: true, calendar: t.calendar, record: records(agent) }, media: ws, log,
    actions: {
      hangup: () => { sendUi({ event: 'hangup' }); setTimeout(() => ws.close(), 300) },
      transfer: (to) => { sendUi({ event: 'notice', text: `On a real call the person is now connected to ${to}.` }); sendUi({ event: 'hangup' }); setTimeout(() => ws.close(), 300) },
    },
  })
  ws.on('message', (m) => { try { bridge.onMedia(JSON.parse(m)) } catch (_) { /* bad frame */ } })
  ws.on('close', async () => {
    bridge.stop()
    const r = bridge.result
    const duration = Math.round((Date.now() - startedAt) / 1000)
    const [sum, recording] = await Promise.all([r.transcript.length ? store.summarize(r.transcript, agent) : null, saveRecording(bridge.rec, t.chatId)])
    await store.saveCall({
      chatId: t.chatId, agentId: agent.id, agentName: agent.name, direction: 'test', testAs: t.as, number: null, other: null, startedAt, answeredAt: startedAt, endedAt: new Date(),
      duration, minutesBilled: 0, charge: 0, rate: 0, recordingRate: 0, outcome: r.optedOut ? 'opted_out' : r.booking ? 'booked' : r.transferredTo ? 'transferred' : r.outcome || (r.message ? 'message' : sum?.outcome) || 'no_conversation',
      summary: sum?.summary || null, note: r.note, message: r.message, transferredTo: r.transferredTo, optedOut: r.optedOut, transcript: r.transcript, usage: r.usage,
      booking: r.booking || null, ...recordingFields(recording),
    }).catch(e => log(`[AIAgent] test save failed: ${e.message}`))
  })
  bridge.start()
}

module.exports = { init, committed, RATE, RECEPTION_RATE, RECORD_RATE: recorder.RECORD_RATE, owns, activeCount, tryInbound, dialLead, onWebhook, onStream, createTest, onTest, leadRate, finish, track, sessions }
