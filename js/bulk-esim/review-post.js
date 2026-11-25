'use strict'
// 4–5★ BulkSMS reviews → a fresh, salesy post in @Hostbay (number masked, never mentions eSIM).
const axios = require('axios')

const CHANNEL = () => process.env.REVIEW_POST_CHANNEL || '@Hostbay'
const BOT = () => process.env.BOT_USERNAME || 'Nomadlybot'
const BANNED = /e-?\s?sims?\b|\bsim\b|spenza|telnyx|twilio|signalwire|bird|infobip|retell/i
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const mask = (num) => {
  const d = String(num || '').replace(/\D/g, '')
  if (d.length < 7) return null
  const n = d.length === 11 && d[0] === '1' ? d.slice(1) : d
  return n.length === 10 ? `+1 ${n.slice(0, 3)}-•••-•${n.slice(7)}` : `+${n.slice(0, 2)}•••••${n.slice(-3)}`
}

const positive = (r) => r && Number(r.stars) >= 4 && (r.kind === 'campaign' || r.arrived === 'yes')

const FALLBACK = [
  (m) => `Landed in seconds! A sender just reached ${m || 'their contact'} on the first try — no delays, no bounces. Your message, delivered where it counts.`,
  (m) => `Another one delivered. ${m ? `${m} got the text` : 'The text landed'} instantly and the sender rated it top marks. Fast, clean, reliable.`,
  (m) => `Straight to the inbox. ${m ? `A message to ${m}` : 'A fresh message'} arrived right away — exactly how texting should feel.`,
]

async function write(r, recent) {
  const m = r.kind === 'campaign' ? null : mask(r.to)
  const facts = r.kind === 'campaign' ? `A customer ran a bulk text campaign and rated it ${r.stars}/5.` : `A customer sent a text to ${m} and it arrived; they rated it ${r.stars}/5.`
  const key = process.env.APP_OPEN_API_KEY || process.env.OPEN_API_KEY
  if (key) {
    for (let i = 0; i < 2; i++) {
      try {
        const res = await axios.post('https://api.openai.com/v1/chat/completions', {
          model: process.env.AI_AGENT_DRAFT_MODEL || 'gpt-4.1-mini', temperature: 1, max_tokens: 200,
          messages: [
            { role: 'system', content: `You write short, punchy, salesy Telegram channel posts showcasing a real customer review of a bulk SMS / texting service sold in the @${BOT()} bot. English. 2–3 short sentences, max 260 characters, at most 2 emoji, confident and exciting. If a phone number is given, include it EXACTLY as written (it is already masked). Never mention eSIM, SIM, SIM cards, lines, carriers or any provider names. Never invent prices, volumes or stats. No hashtags, no links, no star emoji, no sign-off. Every post must use a different hook and structure from the recent posts. Plain text only.` },
            { role: 'user', content: `${facts}\nRecent posts (do NOT repeat their wording or openings):\n${recent.map(p => `- ${p}`).join('\n') || '- none'}` },
          ],
        }, { headers: { Authorization: `Bearer ${key}` }, timeout: 25000 })
        const txt = String(res.data.choices[0].message.content || '').replace(/<[^>]*>/g, '').replace(/^["']|["']$/g, '').trim()
        if (txt.length > 20 && !BANNED.test(txt) && (!m || txt.includes(m)) && !recent.includes(txt)) return txt
      } catch (_) { /* retry, then fallback */ }
    }
  }
  const fresh = FALLBACK.map(f => f(m)).filter(t => !recent.includes(t))
  const pool = fresh.length ? fresh : FALLBACK.map(f => f(m))
  return pool[Math.floor(Math.random() * pool.length)]
}

const html = (r, body) => `${'⭐'.repeat(Math.min(5, Number(r.stars)))}\n${esc(body)}\n\nStart sending today 👉 @${BOT()}`

async function post(bot, db, r) {
  if (!positive(r)) return null
  const col = db.collection('reviewPosts')
  if (await col.findOne({ reviewId: String(r._id) })) return null
  const recent = (await col.find({}, { projection: { body: 1 } }).sort({ at: -1 }).limit(15).toArray()).map(p => p.body)
  const body = await write(r, recent)
  const text = html(r, body)
  const msg = await bot.sendMessage(CHANNEL(), text, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: [[{ text: `Open @${BOT()}`, url: `https://t.me/${BOT()}?start=open_bulksms` }]] } })
  await col.insertOne({ reviewId: String(r._id), channel: CHANNEL(), body, text, stars: r.stars, messageId: msg?.message_id, at: new Date() })
  return text
}

// Completed campaign → stats post (no customer, bot, text, numbers or links — only counts and timing).
const dur = (min) => (min < 60 ? `${Math.max(1, Math.round(min))} min` : `${Math.floor(min / 60)} h${Math.round(min % 60) ? ` ${Math.round(min % 60)} min` : ''}`)
function campaignText(s) {
  const pct = s.sent >= s.total ? 100 : Math.floor((s.sent / s.total) * 1000) / 10
  return ['📣 <b>Another bulk SMS campaign just finished</b>', '',
    `✅ <b>${s.sent.toLocaleString('en-US')} texts sent</b> — ${s.sent.toLocaleString('en-US')} of ${s.total.toLocaleString('en-US')} went through (${pct}%)`,
    ...(s.minutes != null ? [`⏱ Finished in <b>${dur(s.minutes)}</b>`] : []),
    ...(s.replies ? [`💬 <b>${s.replies.toLocaleString('en-US')} ${s.replies === 1 ? 'reply' : 'replies'}</b> came back`] : []),
    '🇺🇸🇨🇦 USA &amp; Canada mobiles', '',
    'Real mobile numbers, no sender registration, results in minutes, not days.', '',
    'From <b>$0.10 a text</b>, 500 minimum, and the first test text is free.'].join('\n')
}
async function postCampaign(bot, db, s) {
  if (!s?.id || !(s.sent > 0) || !(s.total > 0)) return null
  const col = db.collection('reviewPosts')
  if (await col.findOne({ campaignId: String(s.id) })) return null
  const text = campaignText(s)
  const msg = await bot.sendMessage(CHANNEL(), text, { parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: [[{ text: '🚀 Start a campaign', url: `https://t.me/${BOT()}?start=open_bulksms` }]] } })
  await col.insertOne({ campaignId: String(s.id), kind: 'campaign_done', channel: CHANNEL(), text, messageId: msg?.message_id, at: new Date() })
  return text
}

module.exports = { post, write, mask, positive, html, campaignText, postCampaign }
