'use strict'
// AI support chat for the web app (owner's OpenAI key). Answers CloudIVR questions in the user's language and
// offers the human support link when it can't help.
const OpenAI = require('openai')
const phoneConfig = require('../phone-config')
const { catalog } = require('./numbers')
const { walletOps } = require('./wallet')
const { clientIp } = require('./auth')

const MODEL = 'gpt-4.1-mini'
const HANDOFF = '[[HANDOFF]]'
const LANG_NAMES = { en: 'English', fr: 'French', es: 'Spanish' }
const MAX_PER_10MIN = 20
const VISITOR_PER_HOUR = 10
// Screen names exactly as the translated app shows them, so steps match what the user sees.
const UI_NAMES = ['Overview', 'My numbers', 'Buy a number', 'Quick IVR call', 'Campaigns', 'Audio library', 'Inbox', 'Wallet', 'Settings', 'Forwarding', 'Hours', 'Voicemail', 'Recording', 'Logs', 'Billing', 'Extra numbers', 'Downgrade plan', 'Test my number', 'Test outbound SIP', 'Private mode', 'Verification', 'Get your number', 'Free test call', 'Sign in', 'Pricing']
const uiNames = (lang) => {
  try {
    const d = require(`../../frontend/src/cloudivr/i18n/${lang}.json`)
    return UI_NAMES.filter(k => d[k]).map(k => `"${k}" = "${d[k]}"`).join('; ')
  } catch (_) { return '' }
}
const HUMAN = /\b(human|agent|person|operator|refund|chargeback|humain|remboursement|persona|reembolso)\b/i

let client = null
const ai = () => {
  if (client) return client
  const apiKey = process.env.APP_OPEN_API_KEY || process.env.OPEN_API_KEY
  if (apiKey) client = new OpenAI({ apiKey })
  return client
}

function knowledge() {
  const c = catalog()
  const plans = c.plans.filter(p => p.available).map(p => `- ${p.name}: $${p.price}/month, ${p.minutes} inbound minutes, ${p.sms} SMS, up to ${phoneConfig.getSubNumberLimit(p.id)} extra numbers. Includes: ${p.webFeatures.filter(f => f.included).map(f => f.label).join('; ')}.`).join('\n')
  return `You are the support assistant inside the CloudIVR web app (cloud phone numbers, IVR and SIP).
Plans:
${plans}
A new number costs its plan's monthly price (from $${Math.min(...c.plans.filter(p => p.available).map(p => p.price))}/month, plus a small surcharge for some countries/types). Extra numbers ($${phoneConfig.SUB_NUMBER_BASE_PRICE}/month) can only be added to a number you already have.
Extra usage: forwarding $${c.rates.forwardingPerMin}/min, overage $${c.rates.overagePerMin}/min and $${c.rates.overagePerSms}/SMS. Quick IVR and campaign calls bill per minute from the wallet (US/CA cheaper than international).
Countries: ${c.countries.map(x => x.name).join(', ')}. Some countries need an ID check after payment (Verification page).
Payments: wallet (top up with crypto on the Wallet page) or pay a number directly with crypto. No card or bank transfer. Coupon codes work at checkout; a daily coupon is posted in the Inbox.
App sections: Overview; SIP & softphones (every number's SIP username, password, server and a Zoiper/Linphone/MicroSIP setup guide; Pro plan and up); My numbers (each number has tabs: Overview with "what callers get now", Forwarding, Hours (on/off hours), Keypad menu (IVR: callers press keys; builder, templates, spoken voices; Business), AI voice agent (pick the agent that answers; Business), Voicemail (greeting language, transcripts), SMS, SIP (credentials, test inbound/outbound SIP), Recording, Logs (notes), Billing (renew, auto-renew, upgrade, downgrade — switches now, no refund — extra numbers $${phoneConfig.SUB_NUMBER_BASE_PRICE} each, delete)); Buy a number; Quick IVR call (script templates, OTP collection, per-key menu, several numbers; needs a Pro or Business caller number; scheduling a call, saved presets, redial, custom OTP confirm/reject messages and a saved default voice are Business only); Campaigns (bulk IVR, CSV report; AI voice agent campaigns need a Business caller number); AI voice agents (build and test agents free in the browser; real calls need a Business number, $${require('../ai-agent').RATE()}/min from the wallet); Audio library (upload or AI voice); Inbox; Wallet; Settings (language, default voice, password); Help center (short how-to articles: book icon in the sidebar or the phone More menu, ? icon in the top bar opens help for the current page); browser phone (phone icon in the top bar); Private mode (eye icon hides numbers).
How-tos: extra numbers = open the main number → Billing tab → Extra numbers → search and buy ($${phoneConfig.SUB_NUMBER_BASE_PRICE} each from the wallet, they share the main number's plan). Change plan = number → Billing tab. Test a number = number → Overview (Test my number) or SIP tab (Test outbound SIP). Language = globe menu in the top bar or Settings; spoken IVR menus follow the app language. News and daily coupons: our Telegram channel (link in the sidebar and Settings).
Keypad menu vs AI voice agent: the keypad menu plays a greeting and callers press a key (uses plan minutes); the AI voice agent holds a real conversation, answers questions, books appointments and takes messages (billed per minute from the wallet). A number uses one or the other — turning one on switches the other off.
Rules: answer only about CloudIVR, briefly (max ~120 words), with plain steps that name the section/tab. Never invent prices or features. Never ask for passwords or codes. You cannot change accounts, move money or issue refunds.
Only when the user asks for a person, a refund, a billing dispute or an account change, or you truly cannot answer, say a support agent can help and end your reply with ${HANDOFF}. Never add it to normal how-to answers.`
}

async function userContext(db, chatId, numbersApi) {
  const nums = await numbersApi.myNumbers(chatId)
  const bal = await walletOps(db).balance(chatId)
  const list = nums.slice(0, 10).map(n => `${n.phoneNumber} (${phoneConfig.plans[n.plan]?.name || n.plan}, ${n.status}${n.isSubNumber ? `, extra on ${n.parentNumber}` : ''}, paid until ${String(n.expiresAt || '').slice(0, 10)})`).join('; ')
  return `This user: wallet $${bal.toFixed(2)}; numbers: ${list || 'none yet'}.`
}
const VISITOR = 'This is a visitor on the public landing page, not signed in. Answer pre-sales questions (plans, prices, countries, features, how it works). To buy, they sign up free with the "Get your number" button; the free test call is on the landing page.'

const supportLink = () => String(process.env.CLOUDIVR_SUPPORT_LINK || '').trim()
const bad = (res, status, error, message) => res.status(status).json({ error, message })

// Chat endpoints on `path`. `who(req)` → Mongo filter owning the thread (null = bad request), `context(req)` → system
// note about the asker, `limit` = { max, windowMs, scope(req) → filter counted for the rate limit }.
function chatRoutes(router, { h, chats, path, who, context, limit, log }) {
  const owner = (req, res) => { const f = who(req); if (!f) bad(res, 400, 'invalid_visitor', 'Reload the page and try again.'); return f }
  router.get(path, h(async (req, res) => {
    const f = owner(req, res); if (!f) return
    const list = await chats.find(f).sort({ createdAt: -1 }).limit(40).toArray()
    res.json({ enabled: !!ai(), supportLink: supportLink(), messages: list.reverse().map(m => ({ role: m.role, content: m.content, escalate: !!m.escalate, at: m.createdAt })) })
  }))
  router.post(path, h(async (req, res) => {
    const f = owner(req, res); if (!f) return
    const text = String(req.body.message || '').trim().slice(0, 1000)
    const lang = LANG_NAMES[req.body.lang] ? req.body.lang : 'en'
    // Screen the signed-in user is on (from the app's page map), so "how do I do this here?" makes sense.
    const page = String(req.body.page || '').replace(/[^\p{L}\p{N} &·—()-]/gu, '').trim().slice(0, 80)
    if (!text) return bad(res, 400, 'empty', 'Type your question.')
    if (!ai()) return res.json({ reply: null, escalate: true, supportLink: supportLink(), message: 'The assistant is offline right now — message our support team.' })
    if (await chats.countDocuments({ ...limit.scope(req), role: 'user', createdAt: { $gt: new Date(Date.now() - limit.windowMs) } }) >= limit.max) return bad(res, 429, 'slow_down', limit.message)
    const history = (await chats.find(f).sort({ createdAt: -1 }).limit(10).toArray()).reverse()
    await chats.insertOne({ ...f, ...limit.scope(req), role: 'user', content: text, createdAt: new Date() })
    const messages = [
      { role: 'system', content: knowledge() },
      { role: 'system', content: `${await context(req)}${page ? ` They are on this screen: ${page}.` : ''} Reply in ${LANG_NAMES[lang]}${lang === 'en' ? '' : `. The app is shown in ${LANG_NAMES[lang]}: always use these on-screen names instead of the English ones: ${uiNames(lang)}`}.` },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]
    let out
    try {
      const r = await ai().chat.completions.create({ model: MODEL, messages, temperature: 0.3, max_tokens: 400 })
      out = String(r.choices?.[0]?.message?.content || '').trim()
    } catch (e) {
      log(`[CloudIVR-Web] AI support failed for ${JSON.stringify(f)}: ${e.status || ''} ${e.message}`)
      return res.json({ reply: null, escalate: true, supportLink: supportLink(), message: 'The assistant could not answer just now — message our support team.' })
    }
    const escalate = out.includes(HANDOFF) || HUMAN.test(text)
    const reply = out.replace(HANDOFF, '').trim()
    await chats.insertOne({ ...f, role: 'assistant', content: reply, escalate, createdAt: new Date() })
    res.json({ reply, escalate, supportLink: supportLink() })
  }))
  router.delete(path, h(async (req, res) => {
    const f = owner(req, res); if (!f) return
    await chats.deleteMany(f)
    res.json({ cleared: true })
  }))
}

function routes(router, { db, h, numbersApi, log = console.log }) {
  const chats = db.collection('webSupportChats')
  chats.createIndex({ chatId: 1, createdAt: -1 }).catch(() => {})
  chats.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 }).catch(() => {})
  chatRoutes(router, {
    h, chats, path: '/support/chat', log,
    who: (req) => ({ chatId: req.webChatId }),
    context: (req) => userContext(db, req.webChatId, numbersApi),
    limit: { max: MAX_PER_10MIN, windowMs: 600000, scope: (req) => ({ chatId: req.webChatId }), message: 'Too many questions in a short time. Wait a few minutes or message our support team.' },
  })
}

// Landing-page chat for visitors: thread per browser (visitorId), 10 questions an hour per network.
function publicRoutes(router, { db, h, log = console.log }) {
  const chats = db.collection('webVisitorChats')
  chats.createIndex({ visitorId: 1, createdAt: -1 }).catch(() => {})
  chats.createIndex({ ip: 1, createdAt: -1 }).catch(() => {})
  chats.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7 * 86400 }).catch(() => {})
  const visitorOf = (req) => { const v = String(req.body?.visitorId || req.query.visitorId || ''); return /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null }
  chatRoutes(router, {
    h, chats, path: '/public/support/chat', log,
    who: (req) => (visitorOf(req) ? { visitorId: visitorOf(req) } : null),
    context: async () => VISITOR,
    limit: { max: VISITOR_PER_HOUR, windowMs: 3600000, scope: (req) => ({ ip: clientIp(req) }), message: 'You have asked 10 questions this hour. Sign up free to keep chatting, or message our support team.' },
  })
}

module.exports = { routes, publicRoutes, knowledge, supportLink }
