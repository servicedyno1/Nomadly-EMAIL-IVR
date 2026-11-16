'use strict'
// Spam / scam watch for calls, on top of msg-watch (same admin alerts, same master hold switch):
// Quick IVR calls and call campaigns (script text, the audio's words, who is called) and AI agent / receptionist calls
// (the agent's script when saved, what is said while the call runs). Hold off (default) = alert only. Hold on = a caught
// Quick IVR call or campaign is not dialed until the admin approves. Live AI calls are never interrupted.
const crypto = require('crypto')
const axios = require('axios')
const MW = require('./msg-watch')
const scamWatch = require('./scam-watch')

const X = { dial: null, release: null, hear: null } // test hooks
const sha = (s) => crypto.createHash('sha1').update(String(s)).digest('hex')
const day = () => new Date().toISOString().slice(0, 10)
const log = (m) => MW._S.log(`[CallWatch] ${m}`)
const db = () => MW._S.db
const held = () => db().collection('heldCalls')
const heard = new Map() // audio link → words
const dials = new Map() // chatId → [{ at, to }]
const PER_HOUR = () => Number(process.env.CALL_WATCH_QUICK_PER_HOUR || 40)
const BIG = () => Number(process.env.CALL_WATCH_BIG_CAMPAIGN || 5000)
const within = (p, ms, fallback) => Promise.race([p, new Promise(r => setTimeout(() => r(fallback), ms).unref?.())])
const dial = (p) => (X.dial || require('./voice-service').initiateOutboundIvrCall)(p)
const release = (id) => (X.release || require('./bulk-call-service').adminRelease)(id)

// The words of an audio clip (transcribed once per link).
async function hear(url) {
  if (X.hear) return X.hear(url)
  if (!url || !/^https?:\/\//i.test(url)) return ''
  if (heard.has(url)) return heard.get(url)
  try {
    const store = db().collection('callWatchAudio'), id = sha(url)
    let text = (await store.findOne({ _id: id }))?.text
    if (text === undefined) {
      const T = require('./voicemail-transcribe')
      if (!T.enabled()) return ''
      const r = await axios.get(url, { responseType: 'arraybuffer', timeout: 10000, maxContentLength: 25 * 1024 * 1024 })
      const ext = (/\.(mp3|wav|ogg|m4a|webm)(?:\?|$)/i.exec(url) || [])[1] || 'mp3'
      const t = await T.transcribe(Buffer.from(r.data), { filename: `script.${ext.toLowerCase()}`, timeoutMs: 20000 })
      if (t.status === 'failed' || t.status === 'unavailable') { log(`audio not read (${t.error || t.status})`); return '' }
      text = t.text || ''
      await store.updateOne({ _id: id }, { $set: { url: url.slice(0, 500), text, at: new Date() } }, { upsert: true })
    }
    if (heard.size > 2000) heard.delete(heard.keys().next().value)
    heard.set(url, text)
    return text
  } catch (e) { log(`audio not read (${e.message})`); return '' }
}

// Many different numbers called by one account within an hour.
function volumeFlag(chatId, to) {
  const k = String(chatId), now = Date.now()
  const list = (dials.get(k) || []).filter(x => now - x.at < 3600e3)
  list.push({ at: now, to })
  if (dials.size > 5000) dials.clear()
  dials.set(k, list)
  const n = new Set(list.map(x => x.to)).size
  return n > PER_HOUR() ? { flagged: true, kind: 'volume', reason: `${n} different numbers called in the last hour`, by: 'rules' } : null
}
// A very large list, or numbers that simply run in sequence.
function leadsFlag(leads = []) {
  const n = leads.length
  if (n >= BIG()) return { flagged: true, kind: 'volume', reason: `${n} numbers in one campaign`, by: 'rules' }
  if (n < 50) return null
  const nums = leads.map(l => Number(String(l.number || '').replace(/\D/g, ''))).filter(Boolean).sort((a, b) => a - b)
  let seq = 0
  for (let i = 1; i < nums.length; i++) if (nums[i] - nums[i - 1] === 1) seq++
  return seq / n > 0.5 ? { flagged: true, kind: 'destination', reason: `${seq + 1} of ${n} numbers run in sequence`, by: 'rules' } : null
}

// Quick IVR call about to be dialed. → null (dial it) | a quiet stand-in result (held or rejected, not dialed).
async function quickIvr(p) {
  try {
    if (!db()) return null
    const said = scamWatch.texts({ greetingText: p.greetingText, templateName: p.templateName, placeholderValues: p.placeholderValues, menu: p.menu, otpConfirmMsg: p.otpConfirmMsg, otpRejectMsg: p.otpRejectMsg }).join('\n')
    const audio = p.greetingText ? '' : await within(hear(p.audioUrl), 15000, '')
    const script = [said, audio].filter(Boolean).join('\n').trim()
    const what = p.isTrial ? 'Free trial IVR call' : 'Quick IVR call'
    let v = await MW.verdict(script, 'call'), key = `qivr:${p.chatId}:${sha(script).slice(0, 12)}:${day()}`
    if (!v.flagged) { v = volumeFlag(p.chatId, p.targetNumber); if (!v) return null; key = `qivr:${p.chatId}:volume:${day()}` }
    const g = await MW.gate({ groupKey: key, pre: v, what, chatId: p.chatId, where: `${what} to ${p.targetNumber}`, from: p.displayCallerId || p.callerId, text: script || '(no script text)', action: { type: 'quickIvr' } })
    if (g.act === 'send') return null
    if (g.act === 'hold') await held().insertOne({ gid: g.id, chatId: String(p.chatId), params: JSON.parse(JSON.stringify(p)), createdAt: new Date() })
    return { callControlId: `held:${crypto.randomBytes(6).toString('hex')}`, held: true }
  } catch (e) { log(`quick IVR check failed (${e.message}) — letting the call through`); return null }
}
MW.register('quickIvr', {
  approve: async (a, d) => {
    for (const h of await held().find({ gid: d._id }).toArray()) {
      await held().deleteOne({ _id: h._id })
      const r = await dial({ ...h.params, _cwOk: true }).catch(e => ({ error: e.message }))
      if (r?.error) log(`approved call ${h.params.targetNumber} not placed: ${r.error}`)
    }
  },
  reject: async (a, d) => { await held().deleteMany({ gid: d._id }) },
})

// Call campaign about to start. → null (dial) | hold id (the campaign must not dial until released).
async function campaign(c) {
  try {
    if (!db()) return null
    const agent = c.mode === 'ai' && c.agentId ? await require('./ai-agent/store').getAgent(c.agentId, c.chatId).catch(() => null) : null
    const audio = await within(Promise.all([hear(c.audioUrl), hear(c.voicemailAudioUrl)]), 25000, [])
    const script = [c.name, c.audioName, c.voicemailAudioName, ...scamWatch.texts(c.menu), ...(agent ? [agent.name, agent.goal, agent.firstMessage, agent.greeting, agent.knowledge] : []), ...audio].filter(Boolean).join('\n').trim()
    const what = c.mode === 'ai' ? 'AI agent campaign' : 'call campaign'
    let v = await MW.verdict(script, 'call'), key = `camp:${c.chatId}:${sha(script).slice(0, 12)}:${day()}`
    if (!v.flagged) { v = leadsFlag(c.leads); if (!v) return null; key = `camp:${c.id}:leads` }
    const g = await MW.gate({ groupKey: key, pre: v, what, chatId: c.chatId, where: `Campaign “${c.name || c.audioName || c.id}” · ${(c.leads || []).length} numbers`, from: c.showAs || c.callerId, text: script || '(no script text)', action: { type: 'campaign' } })
    return g.act === 'send' ? null : g.id
  } catch (e) { log(`campaign check failed (${e.message}) — letting it run`); return null }
}
MW.register('campaign', {
  approve: async (a, d) => { for (const c of await db().collection('bulkCallCampaigns').find({ adminHold: d._id }, { projection: { id: 1 } }).toArray()) await release(c.id) },
  reject: async () => {},
})

// AI agent / receptionist call in progress or just ended: read what was said. Alert only, once per call.
async function aiTalk(s) {
  try {
    const t = s.bridge?.result?.transcript || []
    if (s.cwDone || !db() || t.length < 2 || t.length === s.cwSeen) return
    s.cwSeen = t.length
    const text = t.slice(-40).map(x => `${x.role === 'caller' ? 'Person' : 'Agent'}: ${x.text}`).join('\n').slice(-3000)
    const v = await MW.verdict(text, 'talk')
    if (!v.flagged || s.cwDone) return
    s.cwDone = true
    const what = s.kind === 'inbound' ? 'AI receptionist call' : 'AI agent call'
    await MW.note({ pre: v, what, chatId: s.chatId, where: `${what} · agent “${s.agent?.name || ''}” · ${s.other} ${s.kind === 'inbound' ? '→' : '←'} ${s.number}`, text: text.slice(-600) })
  } catch (e) { log(`AI call check failed: ${e.message}`) }
}

// AI agent / receptionist script saved. Alert only, once per script.
async function agentScript(a) {
  try {
    if (!db()) return
    const text = [a.name, a.goal, a.firstMessage, a.greeting, a.knowledge].filter(Boolean).join('\n')
    const v = await MW.verdict(text, 'call')
    if (!v.flagged) return
    const what = /recep/i.test(a.role || '') ? 'AI receptionist script' : 'AI agent script'
    await MW.note({ key: `agent:${a.chatId}:${sha(text)}`, pre: v, what, chatId: a.chatId, where: `${what} “${a.name || ''}”`, text })
  } catch (e) { log(`agent script check failed: ${e.message}`) }
}

module.exports = { quickIvr, campaign, aiTalk, agentScript, hear, volumeFlag, leadsFlag, _X: X, _reset: () => { heard.clear(); dials.clear() } }
