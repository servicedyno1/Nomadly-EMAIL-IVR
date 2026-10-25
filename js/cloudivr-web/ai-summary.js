'use strict'
// AI summaries + caller mood for voicemails and recorded calls. Billed from the wallet per started minute of audio
// (AI_SUMMARY_RATE_PER_MIN, $0.10 by default); refunded when nothing could be summarised. Runs automatically for numbers
// with the switch on (new items only), or on demand from the logs.
const axios = require('axios')
const { ObjectId } = require('mongodb')
const phoneConfig = require('../phone-config')
const { walletOps } = require('./wallet')
const { transcribe } = require('../voicemail-transcribe')
const events = require('./events')

const RATE = () => parseFloat(process.env.AI_SUMMARY_RATE_PER_MIN || '0.10')
const KINDS = ['voicemail', 'call_recording']
const SENTIMENTS = ['positive', 'neutral', 'negative']
const SWEEP_MS = 30000
const WINDOW_MS = 2 * 3600000
const bad = (res, status, error, message) => res.status(status).json({ error, message })
const str = (v, max) => String(v ?? '').trim().slice(0, max)
const minutesOf = (l) => Math.max(1, Math.ceil((Number(l.duration) || 0) / 60))
const priceOf = (l) => Math.round(minutesOf(l) * RATE() * 100) / 100
const eligible = (l) => KINDS.includes(l.type) && !!(l.transcript || l.recordingUrl)

async function download(url) {
  const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000, maxContentLength: 25 * 1024 * 1024 })
  return Buffer.from(r.data)
}

// Transcript → { summary, sentiment, mood, actionItems } | null (owner's OpenAI key, like the AI agent summaries).
async function analyse(text, kind) {
  if (!process.env.APP_OPEN_API_KEY) return null
  try {
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.AI_AGENT_SUMMARY_MODEL || 'gpt-4.1-mini', temperature: 0.2, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `You help a small business owner triage their ${kind === 'voicemail' ? 'voicemails' : 'recorded phone calls'}. Write in the language the caller speaks. Reply as JSON {"summary": "1-2 short sentences: who called, what they want, any names, numbers or times", "sentiment": "positive" | "neutral" | "negative", "mood": "one or two words for the caller's mood, e.g. calm, upset, in a hurry", "actionItems": ["up to 3 short follow-ups for the owner"]}.` },
        { role: 'user', content: String(text).slice(-12000) },
      ],
    }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: 30000 })
    const j = JSON.parse(r.data.choices[0].message.content)
    return {
      summary: str(j.summary, 600), sentiment: SENTIMENTS.includes(j.sentiment) ? j.sentiment : 'neutral', mood: str(j.mood, 40).toLowerCase(),
      actionItems: (Array.isArray(j.actionItems) ? j.actionItems : []).map(a => str(a, 160)).filter(Boolean).slice(0, 3),
    }
  } catch (e) {
    console.log(`[AISummary] analyse failed: ${e.response?.data?.error?.message || e.message}`)
    return null
  }
}

function createSummarizer({ db, logTransaction, generateTransactionId, log = console.log }) {
  const phoneLogs = db.collection('phoneLogs')
  const w = walletOps(db)
  const set = (id, aiSummary, extra = {}) => phoneLogs.updateOne({ _id: id }, { $set: { aiSummary, ...extra } })

  // One log entry → its aiSummary. Claims the row first so two runs never bill twice.
  return async function summarize(chatId, l, { auto = false } = {}) {
    const claim = await phoneLogs.updateOne({ _id: l._id, $or: [{ aiSummary: { $exists: false } }, { 'aiSummary.status': { $in: ['failed', 'no_funds', 'empty'] } }] }, { $set: { aiSummary: { status: 'working', at: new Date() } } })
    if (!claim.modifiedCount) return (await phoneLogs.findOne({ _id: l._id }))?.aiSummary || null
    const minutes = minutesOf(l), charge = priceOf(l)
    if (!(await w.debit(chatId, charge))) {
      const s = { status: 'no_funds', charge, minutes, auto, at: new Date() }
      await set(l._id, s)
      return s
    }
    const refund = async (status, detail) => { await w.credit(chatId, charge); const s = { status, detail, charge: 0, minutes, auto, at: new Date() }; await set(l._id, s); return s }
    let text = l.transcript || null
    if (!text) {
      let buf = null
      try { buf = await download(l.recordingUrl) } catch (e) { log(`[AISummary] download failed ${l._id}: ${e.message}`) }
      if (!buf) return refund('failed', 'The recording could not be downloaded any more.')
      const tr = await transcribe(buf, { filename: 'call.mp3' })
      if (tr.status === 'empty') return refund('empty', 'No speech was heard in this recording.')
      if (!tr.text) return refund('failed', 'We could not turn this recording into text. You were not charged.')
      text = tr.text
    }
    const a = await analyse(text, l.type)
    if (!a) return refund('failed', 'The AI summary is not available right now. You were not charged.')
    const s = { status: 'done', ...a, charge, minutes, rate: RATE(), auto, at: new Date() }
    await set(l._id, s, l.transcript ? {} : { transcript: text, transcriptStatus: 'done' })
    try {
      if (logTransaction) logTransaction(db, { transactionId: generateTransactionId ? generateTransactionId() : String(new ObjectId()), chatId, type: 'ai_summary', amount: charge, currency: 'USD', status: 'completed', metadata: { phoneNumber: l.phoneNumber, kind: l.type, minutes, channel: 'web', description: `AI summary · ${minutes} min × $${RATE().toFixed(2)}` } })
    } catch (_) { /* history only */ }
    events.emit(chatId, 'ai_summary.ready', { number: l.phoneNumber, from: l.from || null, kind: l.type, logId: String(l._id), summary: a.summary, sentiment: a.sentiment, mood: a.mood, actionItems: a.actionItems, charge })
    log(`[AISummary] ${l.type} ${l._id} on ${l.phoneNumber}: ${a.sentiment} · $${charge}`)
    return s
  }
}

// Every SWEEP_MS: new voicemails / recordings (last 2 h, after the switch went on) on numbers with auto summaries.
function startSweep(db, summarize, log) {
  let busy = false
  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const docs = await db.collection('phoneNumbersOf').find({ 'val.numbers.features.aiSummary.enabled': true }, { projection: { 'val.numbers': 1 } }).toArray()
      for (const d of docs) {
        for (const n of (d.val?.numbers || [])) {
          const cfg = n.features?.aiSummary
          if (!cfg?.enabled || n.status !== 'active' || !phoneConfig.canAccessFeature(n.plan, 'aiSummary')) continue
          const since = new Date(Math.max(Date.now() - WINDOW_MS, new Date(cfg.enabledAt || 0).getTime())).toISOString()
          const rows = await db.collection('phoneLogs').find({ phoneNumber: n.phoneNumber, type: { $in: KINDS }, aiSummary: { $exists: false }, timestamp: { $gte: since } }).limit(10).toArray()
          for (const l of rows.filter(eligible)) await summarize(String(d._id), l, { auto: true }).catch(e => log(`[AISummary] auto error: ${e.message}`))
        }
      }
    } catch (e) { log(`[AISummary] sweep error: ${e.message}`) } finally { busy = false }
  }
  const t = setInterval(tick, SWEEP_MS)
  if (t.unref) t.unref()
  return tick
}

function routes(router, deps) {
  const { db, h, numbersApi, log = console.log } = deps
  const summarize = createSummarizer(deps)
  startSweep(db, summarize, log)
  const withNumber = (fn) => h(async (req, res) => {
    const num = await numbersApi.findMine(req.webChatId, req.params.phone)
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    if (!phoneConfig.canAccessFeature(num.plan, 'aiSummary')) return bad(res, 403, 'plan_upgrade_required', 'AI summaries need the Pro plan or higher on this number.')
    req.num = num
    return fn(req, res)
  })

  router.patch('/numbers/:phone/ai-summary', withNumber(async (req, res) => {
    const cur = req.num.features?.aiSummary || {}
    const enabled = !!req.body.enabled
    const value = { enabled, enabledAt: enabled ? (cur.enabled ? cur.enabledAt : new Date()) : null }
    await numbersApi.setField(req.webChatId, req.num.phoneNumber, 'features.aiSummary', value)
    res.json({ aiSummary: { enabled }, rate: RATE() })
  }))

  router.post('/numbers/:phone/logs/:id/summarize', withNumber(async (req, res) => {
    let id
    try { id = new ObjectId(String(req.params.id)) } catch (_) { return bad(res, 404, 'not_found', 'That log entry was not found.') }
    const l = await db.collection('phoneLogs').findOne({ _id: id, phoneNumber: req.num.phoneNumber })
    if (!l) return bad(res, 404, 'not_found', 'That log entry was not found.')
    if (!eligible(l)) return bad(res, 400, 'not_summarizable', 'Only voicemails and recorded calls can be summarised.')
    if (l.aiSummary?.status === 'done') return res.json({ aiSummary: l.aiSummary })
    const s = await summarize(req.webChatId, l)
    if (s?.status === 'no_funds') return bad(res, 402, 'insufficient_balance', `This summary costs $${priceOf(l).toFixed(2)} — top up your wallet first.`)
    if (s?.status === 'working') return res.status(202).json({ aiSummary: s })
    if (s?.status !== 'done') return bad(res, 424, 'summary_failed', s?.detail || 'The AI summary is not available right now. You were not charged.')
    res.json({ aiSummary: s })
  }))
}

module.exports = { routes, createSummarizer, startSweep, analyse, RATE, priceOf, minutesOf, eligible, KINDS }
