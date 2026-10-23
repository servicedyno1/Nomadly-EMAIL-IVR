'use strict'
// AI support chat for the web app (owner's OpenAI key). Answers CloudIVR questions in the user's language and
// offers the human support link when it can't help.
const OpenAI = require('openai')
const phoneConfig = require('../phone-config')
const { catalog } = require('./numbers')
const { walletOps } = require('./wallet')

const MODEL = 'gpt-4.1-mini'
const HANDOFF = '[[HANDOFF]]'
const LANG_NAMES = { en: 'English', fr: 'French', es: 'Spanish' }
const MAX_PER_10MIN = 20
// Screen names exactly as the translated app shows them, so steps match what the user sees.
const UI_NAMES = ['Overview', 'My numbers', 'Buy a number', 'Quick IVR call', 'Campaigns', 'Audio library', 'Inbox', 'Wallet', 'Settings', 'Forwarding', 'Hours', 'Voicemail', 'Recording', 'Logs', 'Billing', 'Extra numbers', 'Downgrade plan', 'Test my number', 'Test outbound SIP', 'Private mode', 'Verification']
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
Extra usage: forwarding $${c.rates.forwardingPerMin}/min, overage $${c.rates.overagePerMin}/min and $${c.rates.overagePerSms}/SMS. Quick IVR and campaign calls bill per minute from the wallet (US/CA cheaper than international).
Countries: ${c.countries.map(x => x.name).join(', ')}. Some countries need an ID check after payment (Verification page).
Payments: wallet (top up with crypto on the Wallet page) or pay a number directly with crypto. No card or bank transfer. Coupon codes work at checkout; a daily coupon is posted in the Inbox.
App sections: Overview; My numbers (each number has tabs: Overview with "what callers get now", Forwarding, Hours (on/off hours), IVR (menu builder, templates, AI voices), Voicemail (greeting language, transcripts), SMS, SIP (credentials, test inbound/outbound SIP), Recording, Logs (notes), Billing (renew, auto-renew, upgrade, downgrade — switches now, no refund — extra numbers $${phoneConfig.SUB_NUMBER_BASE_PRICE} each, delete)); Buy a number; Quick IVR call (script templates, OTP collection, per-key menu, several numbers, presets, schedule, redial — some Business only); Campaigns (bulk IVR, CSV report); Audio library (upload or AI voice); Inbox; Wallet; Settings (language, default voice, password); browser phone (phone icon in the top bar); Private mode (eye icon hides numbers).
How-tos: extra numbers = open the main number → Billing tab → Extra numbers → search and buy ($${phoneConfig.SUB_NUMBER_BASE_PRICE} each from the wallet, they share the main number's plan). Change plan = number → Billing tab. Test a number = number → Overview (Test my number) or SIP tab (Test outbound SIP). Language = flag menu in the top bar or Settings.
Rules: answer only about CloudIVR, briefly (max ~120 words), with plain steps that name the section/tab. Never invent prices or features. Never ask for passwords or codes. You cannot change accounts, move money or issue refunds.
Only when the user asks for a person, a refund, a billing dispute or an account change, or you truly cannot answer, say a support agent can help and end your reply with ${HANDOFF}. Never add it to normal how-to answers.`
}

async function userContext(db, chatId, numbersApi) {
  const nums = await numbersApi.myNumbers(chatId)
  const bal = await walletOps(db).balance(chatId)
  const list = nums.slice(0, 10).map(n => `${n.phoneNumber} (${phoneConfig.plans[n.plan]?.name || n.plan}, ${n.status}${n.isSubNumber ? `, extra on ${n.parentNumber}` : ''}, paid until ${String(n.expiresAt || '').slice(0, 10)})`).join('; ')
  return `This user: wallet $${bal.toFixed(2)}; numbers: ${list || 'none yet'}.`
}

function routes(router, { db, h, numbersApi, log = console.log }) {
  const chats = db.collection('webSupportChats')
  chats.createIndex({ chatId: 1, createdAt: -1 }).catch(() => {})
  chats.createIndex({ createdAt: 1 }, { expireAfterSeconds: 30 * 86400 }).catch(() => {})
  const supportLink = () => { const s = String(process.env.SUPPORT_HANDLE || '').trim().replace(/^@/, ''); return s ? `https://t.me/${s}` : '' }
  const bad = (res, status, error, message) => res.status(status).json({ error, message })

  router.get('/support/chat', h(async (req, res) => {
    const list = await chats.find({ chatId: req.webChatId }).sort({ createdAt: -1 }).limit(40).toArray()
    res.json({ enabled: !!ai(), supportLink: supportLink(), messages: list.reverse().map(m => ({ role: m.role, content: m.content, escalate: !!m.escalate, at: m.createdAt })) })
  }))

  router.post('/support/chat', h(async (req, res) => {
    const chatId = req.webChatId
    const text = String(req.body.message || '').trim().slice(0, 1000)
    const lang = LANG_NAMES[req.body.lang] ? req.body.lang : 'en'
    if (!text) return bad(res, 400, 'empty', 'Type your question.')
    if (!ai()) return res.json({ reply: null, escalate: true, supportLink: supportLink(), message: 'The assistant is offline right now — message our support team.' })
    if (await chats.countDocuments({ chatId, role: 'user', createdAt: { $gt: new Date(Date.now() - 600000) } }) >= MAX_PER_10MIN) return bad(res, 429, 'slow_down', 'Too many questions in a short time. Wait a few minutes or message our support team.')
    const history = (await chats.find({ chatId }).sort({ createdAt: -1 }).limit(10).toArray()).reverse()
    await chats.insertOne({ chatId, role: 'user', content: text, createdAt: new Date() })
    const messages = [
      { role: 'system', content: knowledge() },
      { role: 'system', content: `${await userContext(db, chatId, numbersApi)} Reply in ${LANG_NAMES[lang]}${lang === 'en' ? '' : `. The app is shown in ${LANG_NAMES[lang]}: always use these on-screen names instead of the English ones: ${uiNames(lang)}`}.` },
      ...history.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: text },
    ]
    let out
    try {
      const r = await ai().chat.completions.create({ model: MODEL, messages, temperature: 0.3, max_tokens: 400 })
      out = String(r.choices?.[0]?.message?.content || '').trim()
    } catch (e) {
      log(`[CloudIVR-Web] AI support failed for ${chatId}: ${e.status || ''} ${e.message}`)
      return res.json({ reply: null, escalate: true, supportLink: supportLink(), message: 'The assistant could not answer just now — message our support team.' })
    }
    const escalate = out.includes(HANDOFF) || HUMAN.test(text)
    const reply = out.replace(HANDOFF, '').trim()
    await chats.insertOne({ chatId, role: 'assistant', content: reply, escalate, createdAt: new Date() })
    res.json({ reply, escalate, supportLink: supportLink() })
  }))

  router.delete('/support/chat', h(async (req, res) => {
    await chats.deleteMany({ chatId: req.webChatId })
    res.json({ cleared: true })
  }))
}

module.exports = { routes, knowledge }
