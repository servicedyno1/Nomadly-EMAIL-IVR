'use strict'
// AI agents (per account), their call records and the do-not-call list.
const crypto = require('crypto')
const axios = require('axios')

const VOICES = ['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']
const LANGS = ['en', 'fr', 'es']
const LANG_NAMES = { en: 'English', fr: 'French', es: 'Spanish' }
const OUTCOMES = ['interested', 'not_interested', 'callback', 'message', 'transferred', 'opted_out', 'voicemail', 'no_conversation', 'other']
const E164 = /^\+[1-9]\d{7,14}$/
let agents, calls, dnc

function init(db) {
  agents = db.collection('aiAgents'); calls = db.collection('aiCalls'); dnc = db.collection('aiDoNotCall')
  agents.createIndex({ chatId: 1, id: 1 }).catch(() => {})
  calls.createIndex({ chatId: 1, startedAt: -1 }).catch(() => {})
  dnc.createIndex({ chatId: 1, number: 1 }, { unique: true }).catch(() => {})
}

const str = (v, max) => String(v ?? '').trim().slice(0, max)
const normPhone = (p) => { const d = String(p || '').replace(/[^\d+]/g, ''); return d ? (d.startsWith('+') ? d : `+${d}`) : '' }

function cleanAgent(b) {
  const name = str(b.name, 40), goal = str(b.goal, 4000)
  if (!name) throw new Error('Give the agent a name.')
  if (goal.length < 10) throw new Error('Describe what the agent should do (at least one sentence).')
  const transferTo = normPhone(b.transferTo)
  if (transferTo && !E164.test(transferTo)) throw new Error('Enter the transfer number with country code, e.g. +14155550100.')
  return {
    name, goal, businessName: str(b.businessName, 60), greeting: str(b.greeting, 300), knowledge: str(b.knowledge, 6000),
    language: LANGS.includes(b.language) ? b.language : 'en', voice: VOICES.includes(b.voice) ? b.voice : 'marin',
    transferTo: transferTo || null, takeMessages: b.takeMessages !== false,
    maxMinutes: Math.min(15, Math.max(1, parseInt(b.maxMinutes, 10) || 5)),
  }
}
const FIELDS = ['id', 'name', 'goal', 'businessName', 'greeting', 'knowledge', 'language', 'voice', 'transferTo', 'takeMessages', 'maxMinutes', 'createdAt', 'updatedAt']
const publicAgent = (a) => Object.fromEntries(FIELDS.map(k => [k, a[k] ?? null]))

const listAgents = (chatId) => agents.find({ chatId: String(chatId) }).sort({ createdAt: -1 }).limit(50).toArray()
const getAgent = (id, chatId) => (id ? agents.findOne({ id: String(id), chatId: String(chatId) }) : null)
async function createAgent(chatId, body) {
  const a = { id: crypto.randomUUID(), chatId: String(chatId), ...cleanAgent(body), createdAt: new Date(), updatedAt: new Date() }
  await agents.insertOne(a)
  return a
}
async function updateAgent(chatId, id, body) {
  const r = await agents.findOneAndUpdate({ id: String(id), chatId: String(chatId) }, { $set: { ...cleanAgent(body), updatedAt: new Date() } }, { returnDocument: 'after' })
  return r?.value !== undefined ? r.value : r
}
const deleteAgent = (chatId, id) => agents.deleteOne({ id: String(id), chatId: String(chatId) })

const saveCall = (doc) => calls.insertOne({ id: crypto.randomUUID(), ...doc })
const CALL_LIST = { transcript: 0, _id: 0 }
function listCalls(chatId, { agentId, campaignId, limit = 30 } = {}) {
  const q = { chatId: String(chatId) }
  if (agentId) q.agentId = String(agentId)
  if (campaignId) q.campaignId = String(campaignId)
  return calls.find(q, { projection: CALL_LIST }).sort({ startedAt: -1 }).limit(Math.min(100, limit)).toArray()
}
const getCall = (chatId, id) => calls.findOne({ id: String(id), chatId: String(chatId) }, { projection: { _id: 0 } })
async function testSecondsToday(chatId) {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0)
  const r = await calls.aggregate([{ $match: { chatId: String(chatId), direction: 'test', startedAt: { $gte: since } } }, { $group: { _id: null, s: { $sum: '$duration' } } }]).toArray()
  return r[0]?.s || 0
}

const addDnc = (chatId, number, reason = 'manual') => dnc.updateOne({ chatId: String(chatId), number: normPhone(number) }, { $setOnInsert: { reason, createdAt: new Date() } }, { upsert: true })
const removeDnc = (chatId, number) => dnc.deleteOne({ chatId: String(chatId), number: normPhone(number) })
const listDnc = (chatId) => dnc.find({ chatId: String(chatId) }, { projection: { _id: 0, number: 1, reason: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(1000).toArray()
const onDnc = async (chatId, number) => !!(await dnc.findOne({ chatId: String(chatId), number: normPhone(number) }))

// { summary, outcome } for the owner, from the transcript (owner's OpenAI key).
async function summarize(transcript, agent) {
  const text = (transcript || []).map(t => `${t.role === 'agent' ? 'Agent' : 'Caller'}: ${t.text}`).join('\n').slice(-12000)
  if (!text || !process.env.APP_OPEN_API_KEY) return null
  try {
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.AI_AGENT_SUMMARY_MODEL || 'gpt-4.1-mini', temperature: 0.2, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `Summarise this phone call for the business owner in 1-3 short sentences, written in ${LANG_NAMES[agent?.language] || 'English'}. Include names, callback times or requests. Then classify the outcome as exactly one of: ${OUTCOMES.join(', ')}. Reply as JSON {"summary": "...", "outcome": "..."}.` },
        { role: 'user', content: text },
      ],
    }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: 30000 })
    const j = JSON.parse(r.data.choices[0].message.content)
    return { summary: str(j.summary, 600), outcome: OUTCOMES.includes(j.outcome) ? j.outcome : 'other' }
  } catch (e) {
    console.log(`[AIAgent] summary failed: ${e.response?.data?.error?.message || e.message}`)
    return null
  }
}

module.exports = {
  init, VOICES, LANGS, LANG_NAMES, OUTCOMES, normPhone, cleanAgent, publicAgent, listAgents, getAgent, createAgent, updateAgent, deleteAgent,
  saveCall, listCalls, getCall, testSecondsToday, addDnc, removeDnc, listDnc, onDnc, summarize,
}
