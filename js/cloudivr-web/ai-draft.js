'use strict'
// Smart setup for AI agents / receptionists: one sentence from the owner → greeting, goal, knowledge and keypad options.
const axios = require('axios')

const ACTIONS = ['transfer', 'message', 'hangup', 'repeat']
const str = (v, n) => String(v ?? '').trim().slice(0, n)

const SYSTEM = (role) => `You set up an AI phone ${role === 'receptionist' ? 'receptionist that answers incoming calls' : 'agent that places outgoing calls'} for a small business owner.
From their short description, write a natural, warm, professional setup. Reply as JSON:
{"name": "a first name for the assistant", "businessName": "the business name (invent a plausible one if not given)",
 "firstMessage": "the first sentence it says (1-2 short sentences, no AI disclosure, that is added automatically)",
 "goal": "3-6 short sentences: what it must achieve on the call, step by step, and when to transfer or take a message",
 "knowledge": "short facts it may use (hours, services, policies) written as bullet lines; only what the description implies",
 "keys": [{"key": "1", "action": "transfer|message|hangup|repeat", "label": "to speak with ..."}],
 "holdMusic": true}
Rules: 1-4 keypad options that fit the business (transfer to a person is usually key 1 or 0, message usually 0 or 9).
Never ask callers for card numbers, PINs, passwords or one-time codes. Never pretend to be a real bank, government office or well-known company.`

async function draftAgent(description, role) {
  if (!process.env.APP_OPEN_API_KEY) return null
  try {
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.AI_AGENT_DRAFT_MODEL || 'gpt-4.1-mini', temperature: 0.5, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: SYSTEM(role) }, { role: 'user', content: description }],
    }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: 30000 })
    const j = JSON.parse(r.data.choices[0].message.content)
    const keys = (Array.isArray(j.keys) ? j.keys : []).filter(k => /^[0-9*#]$/.test(String(k?.key)) && ACTIONS.includes(k?.action)).slice(0, 4)
      .map(k => ({ key: String(k.key), action: k.action, label: str(k.label, 60), to: null }))
    return { role, name: str(j.name, 40) || 'Ava', businessName: str(j.businessName, 60), firstMessage: str(j.firstMessage, 500), goal: str(j.goal, 4000), knowledge: str(Array.isArray(j.knowledge) ? j.knowledge.join('\n') : j.knowledge, 6000), keys, holdMusic: j.holdMusic !== false }
  } catch (e) {
    console.log(`[AIDraft] failed: ${e.response?.data?.error?.message || e.message}`)
    return null
  }
}

const CHAT_SYSTEM = (role) => `${require('../emily-guard').SCOPE}

You are the CloudIVR setup assistant. You help a business owner set up an AI phone ${role === 'receptionist' ? 'receptionist (answers incoming calls)' : 'agent (places outgoing calls)'} by chatting.
Each turn: reply in 1-3 short, friendly sentences (ask at most one question), and update the setup.
Reply as JSON {"reply": "...", "patch": {only the fields that change}}.
Fields: name, businessName, firstMessage, goal, knowledge (bullet lines), transferTo (E.164 like +14155550100), takeMessages (bool),
discloseAi (bool: say it is an AI at the start), record (bool), holdMusic (bool), voice (one of: marin, cedar, alloy, ash, ballad, coral, echo, sage, shimmer, verse),
speed (0.75 slow to 1.3 fast, 1 normal; "a bit slower" = current minus 0.1), language (en, es, fr, de, pt, it, hi, zh...),
keys (full list: [{"key":"1","action":"transfer|message|hangup|repeat","label":"to ...","to":"+1... or null"}]).
Fill sensible defaults from the first description. Never ask callers for card numbers, PINs, passwords or one-time codes; never pretend to be a real bank, government office or well-known company.`

const PATCHABLE = ['name', 'businessName', 'firstMessage', 'goal', 'knowledge', 'transferTo', 'takeMessages', 'discloseAi', 'record', 'holdMusic', 'voice', 'speed', 'language', 'keys']
async function builderChat(messages, current, role) {
  if (!process.env.APP_OPEN_API_KEY) return null
  try {
    const now = Object.fromEntries(PATCHABLE.map(k => [k, current?.[k] ?? null]))
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.AI_AGENT_DRAFT_MODEL || 'gpt-4.1-mini', temperature: 0.4, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: `${CHAT_SYSTEM(role)}\nCurrent setup: ${JSON.stringify(now).slice(0, 8000)}` },
        ...messages.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: str(m.content, 2000) }))],
    }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: 30000 })
    const j = JSON.parse(r.data.choices[0].message.content)
    if (j.offTopic === true) return { reply: str(j.reply, 400) || 'I can only help with setting up and using CloudIVR.', patch: {}, offTopic: true }
    const patch = Object.fromEntries(Object.entries(j.patch || {}).filter(([k]) => PATCHABLE.includes(k)))
    if (Array.isArray(patch.knowledge)) patch.knowledge = patch.knowledge.join('\n')
    if (patch.speed != null) patch.speed = Math.min(1.3, Math.max(0.75, Number(patch.speed) || 1))
    if (patch.keys) patch.keys = (Array.isArray(patch.keys) ? patch.keys : []).filter(k => /^[0-9*#]$/.test(String(k?.key)) && ACTIONS.includes(k?.action)).slice(0, 12).map(k => ({ key: String(k.key), action: k.action, label: str(k.label, 60), to: k.to || null }))
    return { reply: str(j.reply, 800) || 'Done — check the form.', patch }
  } catch (e) {
    console.log(`[AIBuilder] failed: ${e.response?.data?.error?.message || e.message}`)
    return null
  }
}

module.exports = { draftAgent, builderChat }
