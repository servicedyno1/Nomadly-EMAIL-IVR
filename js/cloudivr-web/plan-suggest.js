'use strict'
// Emily suggests a plan from one sentence about the visitor's business (public — landing page and Get a number).
const axios = require('axios')
const phoneConfig = require('../phone-config')

const ROWS = [['callForwarding', 'call forwarding'], ['voicemail', 'voicemail'], ['sipCredentials', 'desk phone / softphone logins'], ['aiAgent', 'AI receptionist answering calls (per minute)'], ['ivr', 'keypad menu (press 1 for sales)'], ['ringGroup', 'ring several phones at once'], ['callRecording', 'call recording'], ['aiSummary', 'AI call summaries'], ['ivrOutbound', 'automated calls to up to 10 people'], ['bulkCall', 'recorded-message campaigns to a list'], ['aiCampaigns', 'AI conversation campaigns calling a list (per minute)'], ['otpCollection', 'verify your customers identity via OTP'], ['ivrSchedule', 'scheduled calls & presets'], ['ivrRedial', 'redial and custom code messages'], ['textTriggers', 'text triggers'], ['textRelay', 'text calls for deaf users']]

function ladder() {
  const keys = phoneConfig.PLAN_ORDER.filter(k => phoneConfig.isPlanAvailable?.(k) !== false)
  return keys.map((k, i) => {
    const p = phoneConfig.plans[k], prev = i ? keys[i - 1] : null
    const adds = ROWS.filter(([f]) => phoneConfig.canAccessFeature(k, f) && !(prev && phoneConfig.canAccessFeature(prev, f))).map(([, l]) => l)
    return `id "${k}" — ${p.name}, $${p.price}/mo, ${p.minutes} inbound min. ${prev ? `Everything in ${phoneConfig.plans[prev].name}, plus: ` : 'Includes: '}${adds.join(', ')}${k === 'business' ? ', call from any number (custom caller ID), encrypted calls, priority support' : ''}`
  }).join('\n')
}

const hits = new Map() // ip → [timestamps]
const limited = (ip) => {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 3600000)
  list.push(now); hits.set(ip, list)
  if (hits.size > 5000) hits.clear()
  return list.length > 15
}

async function suggest(text) {
  const plans = phoneConfig.PLAN_ORDER.filter(k => phoneConfig.isPlanAvailable?.(k) !== false)
  const r = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: process.env.AI_AGENT_DRAFT_MODEL || 'gpt-4.1-mini', temperature: 0.2, response_format: { type: 'json_object' }, max_tokens: 300,
    messages: [
      { role: 'system', content: `${require('../emily-guard').SCOPE}

You are Emily from CloudIVR. A visitor describes their business. Pick the CHEAPEST plan that covers what they clearly need — never upsell features they did not ask for. Plans (each includes everything in the plans above it):\n${ladder()}\nReply as JSON: {"plan": one of ${JSON.stringify(plans)}, "reason": one friendly sentence (max 30 words) naming the 1-3 features that matter for them — call plans only by their name (Basic, Plus, Pro, Business), never by id, "alsoLike": "" or a short phrase naming ONE feature that is only in a more expensive plan than the one you picked and that fits their business, "kind": "calls" (default) | "texting" (they mainly need to send and receive SMS texts on the number) | "fax" (they only need to send or receive faxes)}. If it is a plain description of a business, just pick a plan (that is in scope). Only for off-topic or improper requests set "offTopic": true with your one-sentence reply in "reason".` },
      { role: 'user', content: text },
    ],
  }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: 20000 })
  const out = JSON.parse(r.data.choices[0].message.content)
  if (out.offTopic === true) return { offTopic: true, reason: String(out.reason || 'I can only help you choose a CloudIVR plan.').slice(0, 240) }
  if (!plans.includes(out.plan)) out.plan = plans.includes('pro') ? 'pro' : plans[0]
  // Drop a "later you might like" that the suggested plan already has.
  const words = ROWS.filter(([f]) => phoneConfig.canAccessFeature(out.plan, f)).flatMap(([, l]) => l.toLowerCase().match(/[a-z]{6,}/g) || [])
  if (words.some(w => String(out.alsoLike || '').toLowerCase().includes(w))) out.alsoLike = ''
  const kind = ['calls', 'texting', 'fax'].includes(out.kind) ? out.kind : 'calls'
  return { kind, plan: out.plan, name: phoneConfig.plans[out.plan].name, price: phoneConfig.plans[out.plan].price, reason: String(out.reason || '').slice(0, 240), alsoLike: String(out.alsoLike || '').slice(0, 120) }
}

// Calls + texting: Emily picks the texting country from what's sold (or the USA eSIM / Texting Number when that fits better).
async function suggestTexting(text, items) {
  const list = items.map(i => `${i.country} — ${i.name}${i.needs10dlc ? ' (USA texting needs a one-time business registration)' : ''}, $${i.textPrice} per text sent`).join('\n')
  const r = await axios.post('https://api.openai.com/v1/chat/completions', {
    model: process.env.AI_AGENT_DRAFT_MODEL || 'gpt-4.1-mini', temperature: 0.2, response_format: { type: 'json_object' }, max_tokens: 250,
    messages: [
      { role: 'system', content: `${require('../emily-guard').SCOPE}

You are Emily from CloudIVR. A customer wants a number for calls + texting and describes what they need. Pick the country whose customers they will text (default the USA when unclear). Countries sold:\n${list}\nOther options: "esim" = a USA eSIM on their own phone (texts, calls and data on the phone, $50/month); "mobile" = a USA Texting Number used in the browser, good for receiving verification codes. Set "alt" only when that option clearly fits better than a calls + texting number. Reply as JSON: {"country": one of ${JSON.stringify(items.map(i => i.country))}, "alt": "" | "esim" | "mobile", "reason": one friendly sentence (max 30 words)}. Only for off-topic or improper requests set "offTopic": true with your one-sentence reply in "reason".` },
      { role: 'user', content: text },
    ],
  }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: 20000 })
  const out = JSON.parse(r.data.choices[0].message.content)
  if (out.offTopic === true) return { offTopic: true, reason: String(out.reason || 'I can only help you choose a texting number.').slice(0, 240) }
  const pick = items.find(i => i.country === out.country) || items.find(i => i.country === 'US') || items[0]
  return { country: pick?.country || null, name: pick?.name || null, alt: ['esim', 'mobile'].includes(out.alt) ? out.alt : null, reason: String(out.reason || '').slice(0, 240) }
}

function routes(r, { log = console.log } = {}) {
  r.post('/public/plan-suggest', async (req, res) => {
    const text = String(req.body?.text || '').trim().slice(0, 500)
    if (text.length < 8) return res.status(400).json({ error: 'too_short', message: 'Tell Emily a little more — what does your business do, and how do you use the phone?' })
    if (!process.env.APP_OPEN_API_KEY) return res.status(503).json({ error: 'unavailable', message: 'Emily can’t suggest a plan right now — Pro is the most popular choice.' })
    if (limited(String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim())) return res.status(429).json({ error: 'rate_limited', message: 'That’s a lot of questions! Try again in a little while, or compare the plans below.' })
    try {
      const out = await suggest(text)
      if (out.offTopic) {
        require('../emily-guard').record('plan-suggest', { text, ip: String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim(), reply: out.reason })
        return res.status(422).json({ error: 'off_topic', message: out.reason })
      }
      res.json(out)
    } catch (e) {
      log(`[CloudIVR-Web] plan suggest failed: ${e.message}`)
      res.status(503).json({ error: 'unavailable', message: 'Emily couldn’t answer just now — try again, or compare the plans below.' })
    }
  })
}

module.exports = { routes, suggest, suggestTexting, limited, ladder }
