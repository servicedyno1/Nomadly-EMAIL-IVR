'use strict'
// AI agent phone calls on Telnyx (inbound receptionist + outbound campaign leads) and free browser test talks.
const crypto = require('crypto')
const axios = require('axios')
const store = require('./store')
const { Bridge } = require('./bridge')
const phoneConfig = require('../phone-config')
const telnyxApi = require('../telnyx-service')
const { getBalance, smartWalletDeduct } = require('../utils.js')

const RATE = () => parseFloat(process.env.AI_AGENT_RATE_PER_MIN || '0.20')
const TEST_MAX_SECS = 180
const TEST_DAILY_SECS = 15 * 60
const CLIENT_STATE = Buffer.from('ai_agent').toString('base64')
const BASE = 'https://api.telnyx.com/v2'
let deps = {}
const sessions = new Map() // call_control_id → live call
const streamTokens = new Map() // stream token → call_control_id
const testTokens = new Map() // test token → { chatId, agentId, as, exp }

const log = (...a) => (deps.log || console.log)(...a)
const newToken = () => crypto.randomBytes(18).toString('base64url')
const tx = (path, body) => axios.post(`${BASE}${path}`, body, { headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 15000 })
const txError = (e) => e.response?.data?.errors?.[0]?.detail || e.message
const wsBase = () => String(deps.selfUrl || process.env.SELF_URL || '').replace(/^http/, 'ws').replace(/\/$/, '')
const streamParams = (t) => ({ stream_url: `${wsBase()}/ai-agent/stream/${t}`, stream_track: 'inbound_track', stream_bidirectional_mode: 'rtp', stream_bidirectional_codec: 'PCMU' })
const leadRate = (number) => Math.max(RATE(), deps.voiceService?.getIvrCallRate?.(number) || 0)
const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
const hangup = (ccid) => tx(`/calls/${ccid}/actions/hangup`, {}).catch(() => {})

function init(d) { deps = d }
const owns = (ccid, payload) => sessions.has(ccid) || payload?.client_state === CLIENT_STATE
const activeCount = () => sessions.size

function track(ccid, s) {
  sessions.set(ccid, { ...s, ccid, startedAt: new Date() })
  streamTokens.set(s.token, ccid)
  return sessions.get(ccid)
}
function forget(s) { sessions.delete(s.ccid); streamTokens.delete(s.token); clearInterval(s.walletTimer) }

// Inbound: the number's AI agent answers (Pro+, wallet covers a minute). false → route the call normally.
async function tryInbound({ payload, chatId, num }) {
  const cfg = num.features?.aiAgent
  if (!cfg?.enabled || !phoneConfig.canAccessFeature(num.plan, 'aiAgent')) return false
  const agent = await store.getAgent(cfg.agentId, chatId)
  if (!agent || !process.env.APP_OPEN_API_KEY) return false
  const { usdBal } = await getBalance(deps.walletOf, chatId)
  if (usdBal < RATE() + committed(chatId)) { log(`[AIAgent] ${num.phoneNumber}: wallet $${usdBal} < $${RATE()}/min — normal routing`); return false }
  const s = track(payload.call_control_id, { kind: 'inbound', rate: RATE(), token: newToken(), chatId: String(chatId), agent, number: num.phoneNumber, other: (payload.from || '').replace(/[^+\d]/g, '') })
  try {
    await tx(`/calls/${s.ccid}/actions/answer`, streamParams(s.token))
    s.answeredAt = Date.now()
    watchWallet(s)
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
  const token = newToken()
  try {
    const r = await tx('/calls', {
      connection_id: process.env.TELNYX_CALL_CONTROL_APP_ID, to: lead.number, from: campaign.callerId, webhook_url: `${deps.selfUrl}/telnyx/voice-webhook`,
      client_state: CLIENT_STATE, answering_machine_detection: 'detect', timeout_secs: 30, ...streamParams(token),
    })
    const ccid = r.data?.data?.call_control_id
    track(ccid, { kind: 'outbound', rate: leadRate(lead.number), token, chatId: String(campaign.chatId), agent, number: campaign.callerId, other: lead.number, leadName: lead.name || null, campaignId: campaign.id, leadIndex: lead.index })
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
  const s = sessions.get(payload.call_control_id)
  if (!s) return
  if (eventType === 'call.answered' && !s.answeredAt) { s.answeredAt = Date.now(); watchWallet(s) }
  else if (eventType === 'call.machine.detection.ended') { s.answeredBy = payload.result || null; if (payload.result === 'machine') s.bridge?.voicemail() }
  else if (eventType === 'streaming.failed') { log(`[AIAgent] stream failed ${s.ccid}: ${payload.failure_reason || ''}`); hangup(s.ccid) }
  else if (eventType === 'call.hangup') await finish(s, payload).catch(e => log(`[AIAgent] finish error: ${e.stack || e.message}`))
}

// Telnyx opened the media stream for a tracked call.
function onStream(token, ws) {
  const s = sessions.get(streamTokens.get(token))
  if (!s || s.bridge) return ws.close()
  s.bridge = new Bridge({
    agent: s.agent, ctx: { direction: s.kind, leadName: s.leadName }, media: ws, log,
    actions: { hangup: (why) => { log(`[AIAgent] hangup ${s.ccid}: ${why}`); hangup(s.ccid) }, transfer: (to) => transfer(s, to) },
  })
  ws.on('message', (m) => { try { s.bridge.onMedia(JSON.parse(m)) } catch (_) { /* bad frame */ } })
  ws.on('close', () => s.bridge.stop())
  s.bridge.start()
}

async function transfer(s, to) {
  s.transferAt = Date.now()
  s.transferredTo = to
  s.bridge?.stop()
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
  const sum = res.transcript.length ? await store.summarize(res.transcript, s.agent) : null
  const machine = res.voicemail || s.answeredBy === 'machine'
  const outcome = res.optedOut ? 'opted_out' : s.transferredTo ? 'transferred' : machine ? 'voicemail' : res.outcome || (res.message ? 'message' : sum?.outcome) || (duration ? 'no_conversation' : null)
  const rate = s.rate || (s.kind === 'inbound' ? RATE() : leadRate(s.other))
  const fwdRate = (s.transferredTo && deps.voiceService?.getIvrCallRate?.(s.transferredTo)) || 0.15
  const aiMin = duration ? Math.max(1, Math.ceil(aiSecs / 60)) : 0
  const restMin = restSecs > 0 ? Math.ceil(restSecs / 60) : 0
  const charge = +(aiMin * rate + restMin * fwdRate).toFixed(4)
  if (res.optedOut) await store.addDnc(s.chatId, s.other, 'asked on an AI call').catch(() => {})
  const callId = await store.saveCall({
    chatId: s.chatId, agentId: s.agent.id, agentName: s.agent.name, direction: s.kind, number: s.number, other: s.other, leadName: s.leadName || null,
    campaignId: s.campaignId || null, leadIndex: s.leadIndex ?? null, startedAt: s.startedAt, answeredAt: s.answeredAt ? new Date(s.answeredAt) : null, endedAt: new Date(endAt),
    duration, minutesBilled: aiMin + restMin, charge: duration ? charge : 0, rate, outcome, summary: sum?.summary || null, note: res.note, message: res.message,
    transferredTo: s.transferredTo || null, optedOut: res.optedOut, answeredBy: s.answeredBy || null, hangupCause: payload?.hangup_cause || null, transcript: res.transcript, usage: res.usage,
  })
  log(`[AIAgent] ${s.kind} call ${s.other} ended: ${duration}s, outcome=${outcome}, charge=$${duration ? charge : 0}`)

  if (s.kind === 'outbound') {
    return require('../bulk-call-service').onCallComplete(s.ccid, {
      campaignId: s.campaignId, leadIndex: s.leadIndex, duration, hangupCause: payload?.hangup_cause || null, sipHangupCause: payload?.sip_hangup_cause || null,
      answeredAt: s.answeredAt ? new Date(s.answeredAt) : null, answeredBy: machine ? 'machine' : (s.answeredBy || null), voicemailDropped: res.voicemail && duration > 5,
      transferred: !!s.transferredTo, transferConnected: !!s.transferredTo && restSecs > 0,
      ai: { outcome, summary: sum?.summary || null, callId }, aiBilling: duration ? { minutesBilled: aiMin + restMin, charge, rate } : null,
    })
  }
  if (duration && deps.walletOf) {
    await smartWalletDeduct(deps.walletOf, s.chatId, charge, {
      type: 'ai_agent_call', callType: 'AIAgent', destination: s.other, phoneNumber: s.number,
      description: `AI agent "${s.agent.name}": ${s.other} → ${s.number} (${aiMin} min × $${rate}${restMin ? ` + ${restMin} min transferred` : ''})`,
    }).catch(e => log(`[AIAgent] billing error: ${e.message}`))
  }
  const msg = res.message ? `\n✉️ Message${res.message.name ? ` from ${esc(res.message.name)}` : ''}${res.message.callback ? ` (${esc(res.message.callback)})` : ''}: ${esc(res.message.text)}` : ''
  deps.bot?.sendMessage(s.chatId, `🤖 <b>AI agent call</b> · ${esc(s.agent.name)}\n${esc(s.other)} → ${esc(s.number)} · ${duration}s · ${esc(outcome || 'no answer')}${sum?.summary ? `\n${esc(sum.summary)}` : ''}${msg}${duration ? `\n💳 $${charge.toFixed(2)}` : ''}`, { parse_mode: 'HTML' }).catch(() => {})
}

// ── Browser test talk (free, capped): the page speaks the same media protocol as Telnyx. ──
async function createTest(chatId, agentId, as) {
  const agent = await store.getAgent(agentId, chatId)
  if (!agent) return { error: [404, 'not_found', 'Agent not found.'] }
  if (!process.env.APP_OPEN_API_KEY) return { error: [503, 'ai_unavailable', 'AI calls are not available right now.'] }
  const used = await store.testSecondsToday(chatId)
  if (used >= TEST_DAILY_SECS - 10) return { error: [429, 'test_limit', 'You have used today’s 15 free test minutes. Try again tomorrow.'] }
  const token = newToken()
  testTokens.set(token, { chatId: String(chatId), agentId: agent.id, as: as === 'outbound' ? 'outbound' : 'inbound', exp: Date.now() + 60000 })
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
    agent: { ...agent, maxMinutes: Math.max(0.6, maxSecs / 60) }, ctx: { direction: t.as, leadName: null, test: true }, media: ws, log,
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
    const sum = r.transcript.length ? await store.summarize(r.transcript, agent) : null
    await store.saveCall({
      chatId: t.chatId, agentId: agent.id, agentName: agent.name, direction: 'test', testAs: t.as, number: null, other: null, startedAt, answeredAt: startedAt, endedAt: new Date(),
      duration, minutesBilled: 0, charge: 0, rate: 0, outcome: r.optedOut ? 'opted_out' : r.transferredTo ? 'transferred' : r.outcome || (r.message ? 'message' : sum?.outcome) || 'no_conversation',
      summary: sum?.summary || null, note: r.note, message: r.message, transferredTo: r.transferredTo, optedOut: r.optedOut, transcript: r.transcript, usage: r.usage,
    }).catch(e => log(`[AIAgent] test save failed: ${e.message}`))
  })
  bridge.start()
}

module.exports = { init, committed, RATE, owns, activeCount, tryInbound, dialLead, onWebhook, onStream, createTest, onTest, leadRate }
