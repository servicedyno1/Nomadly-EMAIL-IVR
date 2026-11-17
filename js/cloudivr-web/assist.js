'use strict'
// Setup assistant for CloudIVR settings screens: the owner chats, we return the form fields to change (never saved here).
const axios = require('axios')

const str = (v, n) => String(v ?? '').trim().slice(0, n)
const empty = (v) => v === null || v === undefined || v === ''
const bool = (v) => (empty(v) ? undefined : v === true || v === 'true')
const int = (lo, hi) => (v) => { if (empty(v)) return undefined; const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined }
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
      if (r.action === 'sms') {
        const texts = (Array.isArray(r.smsTexts) ? r.smsTexts : [r.smsText]).map(t => str(t, 600)).filter(Boolean).slice(0, 5)
        Object.assign(o, { smsText: texts[0] || '', ...(texts.length > 1 ? { smsTexts: texts } : {}), message: str(r.message, 300), after: r.after === 'menu' ? 'menu' : 'hangup', ...(/^(es|mn)_[0-9a-f]+$/.test(String(r.smsFrom)) ? { smsFrom: String(r.smsFrom) } : {}) })
      }
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
      otp: [(v) => ({ length: [4, 5, 6, 8].includes(Number(v?.length)) ? Number(v.length) : 6, confirmMsg: str(v?.confirmMsg, 200), rejectMsg: str(v?.rejectMsg, 200) }), '{"length":4|5|6|8 digits of the code,"confirmMsg":"said after the owner accepts (Business plan)","rejectMsg":"said after a wrong code (Business plan)"} — set mode "otp" too, and the script must say to press 1 then type the code'],
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
    note: 'The contact list, caller ID and audio file are picked on the page, not by you. The campaign needs about $20 in the wallet to start and bills per minute as it runs — for a large list (thousands of numbers) advise the owner to top up enough credit up front so it does not pause mid-campaign when the wallet runs low.',
  },
  ivr: {
    what: 'the keypad menu (IVR) people hear when they call this number',
    fields: {
      greeting: [text(600), 'what callers hear first, listing the keys, e.g. "Thanks for calling Bella\'s. Press 1 for reservations, press 2 for our hours."'],
      options: [menu(['forward', 'message', 'sms', 'voicemail', 'submenu'], true), `full list of keys: [{"digit":"1","action":"forward|message|sms|voicemail|submenu","label":"Sales","forwardTo":"+1... (forward)","message":"words read out (message), or said after the text is sent (sms)","smsFrom":"id of the texting number that sends it (from account info textingNumbers)","smsTexts":["text version A","version B (optional, rotates)"],"after":"hangup|menu (sms)","subMenu":{"greeting":"...","options":[same, no submenu]}}]`],
    },
    note: `The greeting must mention every key in options.\nTEXT KEYS (sms): the text is sent FROM one of the owner's Texting Numbers listed in account info textingNumbers [{id, phone}]. If there are several, ask which one should send it and set smsFrom to its id. If there is exactly one, set smsFrom to it and tell the owner the texts go out from that number. If there are none, explain the key can't send texts until they order a Texting Number (the key row has an Order button) and offer an alternative such as a message key. Also mention: USA callers only, $0.05 per text from the wallet, and whether the call hangs up or replays the menu after. Rotation: 2-5 smsTexts versions, each caller gets the next one in turn.`,
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

// How CloudIVR works end to end, so the assistant can explain, suggest and catch mistakes on any screen.
const KNOWLEDGE = `HOW CLOUDIVR WORKS (audited from the product — rely on this, don't guess beyond it)
PLANS (per number): Basic, Starter, Pro, Business. Basic: forwarding, browser phone, softphone (SIP), AI agent. Starter adds voicemail and call recording. Pro adds keypad menu (IVR), ring group, Quick IVR calls, Bulk IVR campaigns, OTP code collection, SMS to email/webhook. Business adds Text Triggers, scheduling Quick calls, presets, redial, own OTP confirm/reject sentences, AI agent campaigns. If the owner wants something their plan can't do, say which plan it needs (upgrade is in the number's Billing tab).
INBOUND — what answers a call, first match wins: 1) forwarding set to "always" (beats everything, even the AI agent) 2) AI voice agent 3) ring group 4) keypad menu — while the menu is on, busy/no-answer forwarding, browser ring and voicemail don't run except through its keys 5) forwarding when busy / not answered (rings the browser phone/softphone first) 6) browser phone / softphone 7) voicemail. The Hours schedule applies on top: when closed, callers go to voicemail (Starter+), hear a closed message and are hung up, or are forwarded to up to 5 backup numbers (~20 s each). The schedule has its own on/off switch.
KEYPAD MENU (IVR, Pro+): greeting (typed text read in the app's language, or an audio file / AI voice), then the caller presses ONE key 0-9 (up to 10 keys). Wrong or no key: they hear "invalid option" once, then goodbye. Key actions:
- forward: rings a phone (with country code); billed per minute from the wallet (US/Canada cheaper than international); blocked if the wallet can't cover a minute. Hold music follows the Forwarding tab's setting.
- message: reads words (or plays an audio file) then hangs up — good for hours, address, website.
- sms: texts the caller from one of the owner's Texting Numbers (USA eSIM / mobile line), USA callers only, $0.05 per text from the wallet; 1-5 versions rotate so each caller gets the next one; after sending it says a short line, then hangs up or replays the menu.
- voicemail (Starter+): "leave a message after the tone", up to 60 seconds, lands in Inbox (+ email/transcript if set on the Voicemail tab).
- submenu: one more level of keys with its own greeting (no deeper levels).
The menu must be saved AND switched on (switch at the top). Switching it on turns the AI agent off on that number.
FORWARDING: always / when busy / when not answered after 10-60 s; up to 4 backups ring one after another; forwarded phone sees the business number or, US only, the caller's number. Minutes bill from the wallet.
RING GROUP (Pro+): up to 5 phones ring together, first to answer gets it; ring 10-60 s; then voicemail (Starter+), one backup number, or a sorry message. While on, forwarding and the keypad menu are skipped; Hours still apply.
VOICEMAIL (Starter+): standard greeting in a chosen language, or own audio / AI voice made from text; ring time 10-60 s; email copy; transcripts.
TEXTING on a calling number is an add-on ($0.05 per text sent, receiving free); US local numbers need 10DLC registration, toll-free numbers need verification, before texts work. Missed-call text: one text per caller per day after an unanswered call (needs texting on). Text Triggers (Business): an incoming text starts a call — callback (rings the owner, reads the text, press 1 to call them back), message (calls the texter and reads a message), ai (AI agent calls them back); filters: keywords, business hours only, once per sender per hour; checked top to bottom, max 5; wallet must be over $1.
QUICK CALL (Pro+): up to 10 numbers (use a campaign for more), from one of the owner's numbers. They hear a script read by an AI voice (max 1500 characters) or an audio file. Any [Placeholder] like [Name] must be filled in the boxes under the script before calling, or the call is refused. Then:
- transfer: pressing one of the chosen keys connects them to the owner's phone (must differ from the caller ID), up to 4 backups, optional hold music. Any other key or none: the message replays once (audio) then goodbye.
- otp (code collection): the caller presses 1, hears "Please enter your N-digit verification code now" and types it (4, 5, 6 or 8 digits; "6-digit code" → length 6). If the script doesn't say "press 1", the system adds "To continue, press 1 now." They wait on hold (hold music if on) while the code appears for the owner on the Quick call page and in Inbox, who has 90 s to Accept (optional: then connect them to a phone), Decline (they're asked again, 3 tries in total) or hang up. Business plan: own sentence said after Accept and after Decline.
- menu: each key forwards to a phone, reads a message, or opens one sub-menu.
Billed per minute (rate depends on the destination); wallet must cover at least $1 / one minute. Scheduling (5 min–30 days ahead), presets and redial are Business.
BULK IVR CAMPAIGN (Pro+): one message (audio from the library or a script turned into an AI voice when saved) to a contact list; 500 numbers per campaign, bigger lists split into parts of 500 called one after another (up to 10 parts) or only the first 500; numbers on the do-not-call list and known dead numbers are skipped. Key press: just report it, transfer to the owner, or a key menu. Answering machines: leave the same message, another clip, a separate voicemail script, or hang up. 1-20 calls at a time (more with rotating caller IDs), schedule, repeat daily/weekly (not for split lists), daily call limit. Needs about $20 in the wallet to launch. Suggest calling during normal daytime hours of the contacts.
AI VOICE AGENTS (own page) hold real conversations; AI agent campaigns (Business) call only 8am-9pm in each contact's local time.`

const OTHER = 'Where things live: forwarding, keypad menu, AI agent, ring group, voicemail, hours (Answering group) and SMS, missed-call text, Text Triggers (Texting group) are tabs of each number; Quick call and Bulk campaigns are under Make calls; AI agents have their own page.'

function system(sc, current, context) {
  const fields = Object.entries(sc.fields).map(([k, [, doc]]) => `- ${k}: ${doc}`).join('\n')
  return `You are the CloudIVR setup assistant, an expert on the whole CloudIVR phone system. You guide a small business owner through setting up ${sc.what} in a friendly conversation.
${KNOWLEDGE}

HOW TO TALK
- Plain, warm language, 1-3 short sentences per turn plus an optional short list. No jargon. Ask ONE question at a time.
- Guide: find out what they need (business, who calls, where calls should go, phone numbers). Suggest what works best and why, in a few words (e.g. "most callers want a person — shall key 0 reach you?"). Point out conflicts (e.g. a ring group skips the keypad menu, voicemail needs a plan).
- Never invent facts about the business (hours, prices, addresses, links, names) or phone numbers: ask for them. Don't leave [brackets] in anything callers hear (they would be read out), except [Name]-style placeholders in Quick call / campaign scripts, and then tell the owner to fill them in.
- Confirm before changing the form: when you know enough, propose the full setup and ask "Shall I fill this in?". Small direct edits the owner asks for ("make it 30 seconds") can be proposed straight away.
- Be thorough end to end, like a product expert: before proposing, make sure every piece the setup needs to really work is known (phone numbers, which Texting Number sends texts, plan limits, what happens if nobody answers). Ask for what's missing, one question at a time.
- Scripts and greetings callers hear must be polished and natural: start with the business name, short sentences, never read out phone numbers that calls are transferred to, end with a clear key instruction ("press 1 to…").
- "reply" and "summary" must describe exactly what is in "patch" — never say one thing and set another.
- Keep "reply" short when proposing (one sentence + the question); the details go in "summary".
- When the form is filled, tell them the next steps on this page in one line (press Save, switch the feature on if it's off, and a test call if useful).
- Nothing is saved until the owner presses Save on the page; you cannot place calls, switch features on, or save.
- If they ask for something this screen cannot do, say where it is. ${OTHER}
${SAFE}

REPLY AS JSON {"reply": "...", "summary": ["short plain lines describing the proposed setup"], "patch": {fields}}
- While still asking questions: "patch": {} and "summary": [].
- When proposing: "patch" holds every field to change (lists in full), "summary" 2-6 lines like "Key 1 → rings +14155550100 (Sales)", and "reply" ends by asking to confirm.
Fields on this screen:
${fields}
Phones are E.164 like +14155550100; a 10-digit number without country code is US (+1).
${sc.note || ''}
${context ? `About this account: ${JSON.stringify(context).slice(0, 800)}` : ''}
Current form: ${JSON.stringify(current || {}).slice(0, 6000)}`
}

// Things a proposal still needs before it can be saved and work on a real call, in plain words.
const has = (v) => (Array.isArray(v) ? v.length > 0 : !!String(v ?? '').trim())
function keyGaps(opts, ctx, where = '', said = '', prev = []) {
  const out = []
  const lines = Array.isArray(ctx?.textingNumbers) ? ctx.textingNumbers : null
  for (const o of opts || []) {
    const k = `${where}Key ${o.digit}`
    if (o.action === 'forward' && !o.forwardTo) out.push(`${k}: which phone should it ring?`)
    if (o.action === 'message' && !has(o.message)) out.push(`${k}: what should it say?`)
    if (o.action === 'sms') {
      if (!has(o.smsText)) out.push(`${k}: what should the text say?`)
      if (lines && !lines.length) out.push(`${k}: you need a Texting Number to send texts (order one in the key row).`)
      else if (lines && lines.length > 1) {
        const line = lines.find(l => l.id === o.smsFrom)
        const kept = line && (prev || []).some(p => String(p.digit) === String(o.digit) && p.smsFrom === o.smsFrom)
        const named = line && (kept || said.includes(String(line.phone).replace(/\D/g, '').slice(-4)) || said.toLowerCase().includes(line.id))
        if (!named) out.push(`${k}: which Texting Number should send it (${lines.map(l => l.phone).join(' or ')})?`)
      }
    }
    if (o.action === 'voicemail' && ctx && ctx.voicemailAvailable === false) out.push(`${k}: voicemail needs the Starter plan or higher.`)
    const sub = o.subMenu || (o.action === 'submenu' ? o : null)
    if (o.action === 'submenu') { if (!(sub.options || []).length) out.push(`${k}: the sub-menu has no keys yet.`); out.push(...keyGaps(sub.options, ctx, `${k} → `, said)) }
  }
  return out
}
const GAPS = {
  ivr: (f, c, said, cur) => [...(f.options && !f.options.length ? ['Add at least one key.'] : []), ...keyGaps(f.options, c, '', said, cur?.options),
    ...(f.greeting && f.options ? f.options.filter(o => !new RegExp(`\\b${o.digit}\\b`).test(f.greeting)).map(o => `The greeting doesn't mention key ${o.digit}.`) : [])],
  quick: (f) => [...(f.mode === 'transfer' && !f.transferTo ? ['Which phone should callers be connected to?'] : []), ...(f.mode === 'otp' && f.script && !/press\s*(1|one)/i.test(f.script) ? ['The script should tell them to press 1 before typing the code.'] : []), ...(f.mode === 'menu' ? keyGaps(f.menu) : [])],
  campaign: (f) => [...(f.mode === 'transfer' && !f.transferNumber ? ['Which phone should calls transfer to?'] : []), ...(f.mode === 'menu' ? keyGaps(f.menu) : [])],
  forwarding: (f) => (f.mode && f.mode !== 'disabled' && !f.forwardTo ? ['Which phone should calls forward to?'] : []),
  ringgroup: (f, c) => [...(f.members && f.members.length < 2 ? ['A ring group works best with at least 2 phones.'] : []), ...(f.fallback === 'forward' && !f.fallbackTo ? ['Which backup number?'] : []), ...(f.fallback === 'voicemail' && c?.voicemailAvailable === false ? ['Voicemail needs the Starter plan or higher.'] : [])],
  hours: (f, c) => [...(f.offAction === 'forward' && !f.offForward ? ['Which backup numbers when closed?'] : []), ...(f.offAction === 'voicemail' && c?.voicemailAvailable === false ? ['Voicemail needs the Starter plan or higher.'] : [])],
  triggers: (f, c) => (f.rules || []).flatMap((r, i) => [...(r.action === 'callback' && !f.myPhone && !c?.myPhone ? [`Trigger ${i + 1}: which phone should we ring for the callback?`] : []), ...(r.action === 'message' && !r.message ? [`Trigger ${i + 1}: what should the call say?`] : []), ...(r.action === 'ai' && c?.agents === 0 ? [`Trigger ${i + 1}: create an AI agent first, then pick it in the trigger.`] : []), ...(r.keywordOnly && !r.keywords ? [`Trigger ${i + 1}: which keywords?`] : [])]),
}

// The model's summary lines, or short 'field: value' lines when it sent none.
function summaryOf(lines, patch) {
  const list = (Array.isArray(lines) ? lines : []).map(x => str(x, 160)).filter(Boolean).slice(0, 8)
  if (list.length) return list
  const val = (k, v) => {
    if (typeof v === 'boolean') return v ? 'on' : 'off'
    if (Array.isArray(v)) return v.map(x => (typeof x === 'string' ? x : x?.digit ? `${x.digit} → ${x.action}` : x?.action || '')).filter(Boolean).join(', ')
    if (v && typeof v === 'object') return k === 'days' ? Object.entries(v).map(([d, x]) => `${d} ${x.on ? `${x.start || ''}-${x.end || ''}` : 'closed'}`).join(', ') : Object.keys(v).join(', ')
    return String(v)
  }
  return Object.entries(patch).map(([k, v]) => [k, val(k, v)]).filter(([, v]) => v !== '').slice(0, 6).map(([k, v]) => `${k}: ${str(v, 140)}`)
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

async function chat(screen, messages, current, context) {
  const sc = SCREENS[screen]
  if (!sc || !process.env.APP_OPEN_API_KEY) return null
  try {
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.AI_AGENT_DRAFT_MODEL || 'gpt-4.1-mini', temperature: 0.4, response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: system(sc, current, context) }, ...messages.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: str(m.content, 2000) }))],
    }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: 30000 })
    const j = JSON.parse(r.data.choices[0].message.content)
    const patch = clean(sc, j.patch)
    const missing = Object.keys(patch).length && GAPS[screen] ? [...new Set(GAPS[screen]({ ...(current || {}), ...patch }, context, messages.filter(m => m.role !== 'assistant').map(m => m.content).join(' ').replace(/[^\w\s]/g, ''), current || {}))].slice(0, 6) : []
    return { reply: str(j.reply, 900) || 'Here’s what I suggest.', summary: Object.keys(patch).length ? summaryOf(j.summary, patch) : [], missing, patch }
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
    const ctx = req.body?.context && typeof req.body.context === 'object' ? req.body.context : null
    const r = await chat(req.params.screen, msgs, req.body?.current, ctx)
    if (!r) return res.status(503).json({ error: 'assist_failed', message: 'The assistant is busy right now. Try again in a moment.' })
    res.json(r)
  }))
}

module.exports = { routes, clean, SCREENS, summaryOf, GAPS }
