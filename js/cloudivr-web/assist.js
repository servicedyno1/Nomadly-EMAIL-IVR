'use strict'
// Setup assistant for CloudIVR settings screens: the owner chats, we return the form fields to change (never saved here).
const axios = require('axios')

const str = (v, n) => String(v ?? '').trim().slice(0, n)
const bool = (v) => v === true || v === 'true'
const int = (lo, hi) => (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined }
const oneOf = (list) => (v) => (list.includes(v) ? v : undefined)
const phone = (v) => { const p = String(v ?? '').replace(/[^\d+]/g, ''); const e = p.startsWith('+') ? p : p.length === 10 ? `+1${p}` : `+${p}`; return /^\+\d{8,15}$/.test(e) ? e : '' }
const phoneList = (max) => (v) => (Array.isArray(v) ? v : String(v ?? '').split(/[,;\s]+/)).map(phone).filter(Boolean).slice(0, max)
const phoneCsv = (max) => (v) => phoneList(max)(v).join(', ')
const text = (n) => (v) => str(Array.isArray(v) ? v.join('\n') : v, n)
const DIGITS = '1234567890'.split('')
const keyList = (v) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[,\s]+/)).map(String).filter(d => DIGITS.includes(d)))]
const time = (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : undefined)
const zone = (v) => { try { Intl.DateTimeFormat('en-US', { timeZone: String(v) }); return String(v) } catch (_) { return undefined } }

// One menu level → rows; `acts` allowed actions, `sub` key holding the sub-menu (rows nested one level).
function menu(acts, nested) {
  const rows = (v, depth = 0) => {
    const seen = new Set()
    return (Array.isArray(v) ? v : []).filter(r => DIGITS.includes(String(r?.digit)) && acts.includes(r?.action) && !(depth && r.action === 'submenu') && !seen.has(String(r.digit)) && seen.add(String(r.digit))).slice(0, 10).map(r => {
      const o = { digit: String(r.digit), action: r.action, label: str(r.label, 40) }
      if (r.action === 'forward') o.forwardTo = phone(r.forwardTo)
      if (r.action === 'message') o.message = str(r.message, 400)
      if (r.action === 'submenu') {
        const sub = nested ? r.subMenu || {} : r
        const inner = { greeting: str(sub.greeting, 400), options: rows(sub.options, 1) }
        Object.assign(o, nested ? { subMenu: inner } : inner)
      }
      return o
    })
  }
  return (v) => rows(v)
}
const days = (v) => Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].filter(d => v?.[d]).map(d => [d, { on: bool(v[d].on), ...(time(v[d].start) ? { start: v[d].start } : {}), ...(time(v[d].end) ? { end: v[d].end } : {}) }]))
const rules = (v) => (Array.isArray(v) ? v : []).filter(r => ['callback', 'message', 'ai'].includes(r?.action)).slice(0, 5).map(r => ({
  action: r.action, keywordOnly: bool(r.keywordOnly), keywords: (Array.isArray(r.keywords) ? r.keywords : String(r.keywords ?? '').split(',')).map(k => str(k, 30)).filter(Boolean).slice(0, 10).join(', '),
  businessHoursOnly: bool(r.businessHoursOnly), oncePerHour: r.oncePerHour !== false, message: str(r.message, 500),
}))

const MENU_DOC = (acts) => `list of keys: [{"digit":"1","action":"${acts.join('|')}","label":"Sales","forwardTo":"+1... (forward)","message":"words read out (message)","greeting":"prompt (submenu)","options":[same, one level, no submenu]}]`
const SAFE = 'Never write words that pretend to be a real bank, government office or well-known company, or that ask people for card numbers, PINs or passwords.'

const SCREENS = {
  quick: {
    what: 'a Quick IVR call: an automated call to up to 10 people that plays a script, then reacts to the key they press',
    fields: {
      targets: [phoneCsv(10), 'numbers to call, comma separated, E.164'],
      script: [text(1500), 'the exact words the call reads out; may use [Name]; end with what to press, e.g. "press 1 to speak with us"'],
      mode: [oneOf(['transfer', 'otp', 'menu']), 'transfer (connect on a key) | otp (caller types a code the owner accepts or declines) | menu (route each key)'],
      transferTo: [phone, 'phone that the caller is connected to (transfer mode, or after an accepted code in otp mode)'],
      transferBackups: [phoneCsv(4), 'backup phones if busy, comma separated'],
      activeKeys: [keyList, 'keys that connect in transfer mode, e.g. ["1"]'],
      otp: [(v) => ({ length: [4, 5, 6, 8].includes(Number(v?.length)) ? Number(v.length) : 6, confirmMsg: str(v?.confirmMsg, 200), rejectMsg: str(v?.rejectMsg, 200) }), '{"length":4|5|6|8,"confirmMsg":"","rejectMsg":""}'],
      menu: [menu(['forward', 'message', 'submenu'], false), MENU_DOC(['forward', 'message', 'submenu'])],
      holdMusic: [bool, 'hold music while connecting or verifying'],
    },
  },
  campaign: {
    what: 'a Bulk IVR campaign: the same recorded or AI-voiced message is played to a whole contact list',
    fields: {
      name: [text(80), 'campaign name'],
      script: [text(1500), 'the exact words the AI voice reads to each contact; end with what to press'],
      mode: [oneOf(['report_only', 'transfer', 'menu']), 'report_only (just report key presses) | transfer (connect to the owner) | menu (route each key)'],
      transferNumber: [phone, 'phone to connect to in transfer mode'],
      transferBackups: [phoneCsv(4), 'backup phones, comma separated'],
      activeKeys: [keyList, 'keys that count/connect, e.g. ["1"]'],
      menu: [menu(['forward', 'message', 'submenu'], false), MENU_DOC(['forward', 'message', 'submenu'])],
      concurrency: [int(1, 20), 'calls at the same time, 1-20'],
      holdMusic: [bool, 'hold music during transfer'],
      repeat: [oneOf(['', 'daily', 'weekly']), '"" (once) | daily | weekly'],
      dailyLimit: [(v) => (v === '' || v == null ? '' : int(1, 10000)(v) ?? ''), 'max calls per day, "" for no limit'],
    },
    note: 'The contact list, caller ID and audio file are picked on the page, not by you.',
  },
  ivr: {
    what: 'the keypad menu (IVR) people hear when they call this number',
    fields: {
      greeting: [text(600), 'what callers hear first, listing the keys, e.g. "Thanks for calling Bella\'s. Press 1 for reservations, press 2 for our hours."'],
      options: [menu(['forward', 'message', 'voicemail', 'submenu'], true), `list of keys: [{"digit":"1","action":"forward|message|voicemail|submenu","label":"Sales","forwardTo":"+1...","message":"words read out","subMenu":{"greeting":"...","options":[same, no submenu]}}]`],
    },
    note: 'The greeting must mention every key in options.',
  },
  hours: {
    what: 'the weekly business hours of this number and what happens when it is closed',
    fields: {
      timezone: [zone, 'IANA time zone, e.g. America/New_York'],
      days: [days, 'only the days that change: {"mon":{"on":true,"start":"09:00","end":"17:00"},"sun":{"on":false}} (24h times)'],
      offAction: [oneOf(['voicemail', 'message', 'forward']), 'when closed: voicemail | message (play closed message, hang up) | forward (to backup numbers)'],
      offForward: [phoneCsv(5), 'backup numbers when closed, comma separated'],
      offMessage: [text(500), 'closed message, "" for the standard one'],
    },
    note: 'The switch that turns the schedule on is on the page; tell the owner to use it after saving.',
  },
  voicemail: {
    what: 'voicemail for missed calls on this number',
    fields: {
      greetingScript: [text(600), 'words for a new voicemail greeting; the owner then presses "Make AI voice"'],
      language: [oneOf(['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'ru', 'tr', 'ar', 'hi', 'zh', 'ja', 'ko']), 'greeting language code'],
      forwardToEmail: [(v) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v)) ? str(v, 120) : ''), 'email that also receives voicemails'],
      ringTimeout: [int(10, 60), 'seconds to ring before voicemail, 10-60'],
    },
    note: 'After you write greetingScript, tell the owner to press "Make AI voice" and then Save voicemail.',
  },
  forwarding: {
    what: 'call forwarding for this number',
    fields: {
      mode: [oneOf(['disabled', 'always', 'busy', 'no_answer']), 'disabled | always | busy | no_answer'],
      forwardTo: [phone, 'phone to forward to'],
      ringTimeout: [int(10, 60), 'seconds to ring before forwarding, 10-60'],
      backups: [phoneCsv(4), 'backup phones, comma separated'],
      holdMusic: [bool, 'hold music while connecting'],
      showCallerId: [bool, 'true = forwarded phone sees the caller\'s number (US), false = sees the business number'],
    },
  },
  ringgroup: {
    what: 'a ring group: several phones ring at once and the first to answer gets the call',
    fields: {
      members: [phoneList(5), 'phones that ring together (max 5)'],
      ringTimeout: [int(10, 60), 'seconds to ring, 10-60'],
      fallback: [oneOf(['voicemail', 'forward', 'message']), 'if nobody answers: voicemail | forward (one backup) | message (sorry message, hang up)'],
      fallbackTo: [phone, 'backup phone for forward'],
      message: [text(300), 'sorry message, "" for the standard one'],
    },
    note: 'The switch that turns the ring group on is on the page.',
  },
  textback: {
    what: 'the automatic text sent to callers whose call nobody answered (once a day per caller)',
    fields: { text: [text(300), 'the text message, friendly and short, max 300 characters'] },
    note: 'The on/off switch is on the page.',
  },
  triggers: {
    what: 'Text Triggers: when a text arrives on this number, a call starts automatically (checked top to bottom)',
    fields: {
      myPhone: [phone, 'owner\'s phone, used by callback rules'],
      rules: [rules, 'full list, max 5: [{"action":"callback (ring the owner, then connect to the texter) | message (call the texter and read message) | ai (AI agent calls them)","keywordOnly":false,"keywords":"quote, urgent","businessHoursOnly":false,"oncePerHour":true,"message":"words read out (message rule)"}]'],
    },
    note: 'For "ai" rules the owner picks which agent on the page.',
  },
}

const OTHER = 'Other settings live elsewhere: forwarding, keypad menu, ring group, voicemail and hours are tabs of each number; Quick call and campaigns are under Make calls; AI agents have their own page.'

function system(sc, current) {
  const fields = Object.entries(sc.fields).map(([k, [, doc]]) => `- ${k}: ${doc}`).join('\n')
  return `You are the CloudIVR setup assistant. You help a small business owner set up ${sc.what} by chatting.
Each turn reply in 1-3 short, friendly, plain-language sentences (ask at most one question, no jargon) and fill in the form. Say what you filled in ("I've set…"), not what you will do.
Never invent facts about the business (opening hours, prices, addresses, links, names): if a message needs one, ask for it, or write a clear placeholder like [your hours] and say so.
Reply as JSON {"reply": "...", "patch": {only the fields that change}}. Fields you may set:
${fields}
Phones are E.164 like +14155550100; if the owner gives a number without a country code and it has 10 digits, it is US (+1). Never invent phone numbers: if one is needed and unknown, leave it out and ask for it.
${sc.note || ''} Nothing is saved until the owner presses Save, so remind them once when the form looks ready.
If they ask for something this screen cannot do, say so and where to find it. ${OTHER}
${SAFE}
Current form: ${JSON.stringify(current || {}).slice(0, 6000)}`
}

function clean(sc, raw) {
  const out = {}
  for (const [k, v] of Object.entries(raw || {})) {
    const f = sc.fields[k]
    if (!f) continue
    const c = f[0](v)
    if (c !== undefined) out[k] = c
  }
  return out
}

async function chat(screen, messages, current) {
  const sc = SCREENS[screen]
  if (!sc || !process.env.APP_OPEN_API_KEY) return null
  try {
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.AI_AGENT_DRAFT_MODEL || 'gpt-4.1-mini', temperature: 0.4, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system(sc, current) }, ...messages.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: str(m.content, 2000) }))],
    }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: 30000 })
    const j = JSON.parse(r.data.choices[0].message.content)
    return { reply: str(j.reply, 800) || 'Done — check the form.', patch: clean(sc, j.patch) }
  } catch (e) {
    console.log(`[Assist:${screen}] failed: ${e.response?.data?.error?.message || e.message}`)
    return null
  }
}

function routes(router, { h }) {
  router.post('/assist/:screen', h(async (req, res) => {
    if (!SCREENS[req.params.screen]) return res.status(404).json({ error: 'unknown_screen', message: 'This page has no setup assistant.' })
    const msgs = (Array.isArray(req.body?.messages) ? req.body.messages : []).filter(m => m && typeof m.content === 'string' && m.content.trim())
    if (!msgs.length || msgs[msgs.length - 1].role === 'assistant') return res.status(400).json({ error: 'no_message', message: 'Type a message.' })
    const r = await chat(req.params.screen, msgs, req.body?.current)
    if (!r) return res.status(503).json({ error: 'assist_failed', message: 'The assistant is busy right now. Try again in a moment.' })
    res.json(r)
  }))
}

module.exports = { routes, clean, SCREENS }
