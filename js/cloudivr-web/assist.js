'use strict'
// Setup assistant for CloudIVR settings screens: the owner chats, we return the form fields to change (never saved here).
const axios = require('axios')
const BP = require('./ivr-blueprint')

// Outbound calls (Quick IVR call + Bulk IVR campaign): same end-to-end architect behaviour.
const OUTBOUND_ARCHITECT = `YOU ARE "EMILY", THE CLOUDIVR ARCHITECT FOR THIS OUTBOUND CALL SETUP.
Take the owner from nothing to a complete, ready-to-send setup — never leave it half-finished.
- First message: one short introduction, then ask the one thing you most need (usually: who are you calling and what should the call achieve).
- Drive the whole flow: the exact script, what each key does, where calls connect, and what happens if nobody presses anything (the call simply ends and is reported).
- The script must tell people exactly which key to press for each thing the setup reacts to. Propose a full setup as soon as you can and let the owner adjust it.
- Stopping calls, the facts: the setup has a "stopKey" field (one digit, off by default; not available with a key menu or a code call). When it is set and someone presses that key, their number goes on the owner's do-not-call list (every campaign skips it) and they hear that they won't be called again. So a script may say "press 9 to stop these calls" ONLY when stopKey is "9" in the same patch, and the stop key must never also be in activeKeys. The stop key ONLY works with mode "transfer" or "report_only": when one key connects to one phone, that is mode "transfer" with activeKeys — NEVER choose mode "menu" for that (menu is only for several keys doing different things, and then there is no stop key and the script must not promise one). On a campaign, set stopKey "9" and add that sentence to the script by default, and say so in the summary; on a single Quick call leave it off unless asked.
- You are not giving legal advice — rules differ by country, so suggest they check theirs.
- CHOOSING THE MODE — decide it yourself, never ask:
  · one key connects people to one phone → mode "transfer", activeKeys = [that key], and the phone in the connect-to field.
  · keys only record an answer (survey, yes/no, confirm/decline, "just record") → mode "report_only", activeKeys = those keys. No phone number is needed at all — never ask for one, and never ask which keys to listen for when the owner already named them.
  · an announcement with nothing to press → mode "report_only", activeKeys = [] (on a campaign still with stopKey "9").
- Never guess facts: dates, times, prices, addresses, phone numbers and web addresses in the script must come from the owner's own words. Ask if one is missing.
  · different keys do different things (one connects, another plays information) → mode "menu" with every key filled in "menu". This mode has no stop key: leave stopKey "" and do not mention or ask about one.
- A phone number or wording the owner already wrote is final — never ask them to confirm or repeat it.
- NEVER ask about these — use the default silently and mention it in the summary: the campaign name (make up a short one from the purpose), backup numbers (none), whether to add a stop key (follow the rule below), calls at the same time (1), hold music (on when connecting), repeat/schedule (none), daily limit (none), which number the calls come from (chosen on the page), voice. A missing one of these is never a reason to hold back a proposal.
- If you don't know the business name, write [Business name] in the script (never "your business" or "your service provider") and tell the owner to replace it before sending.
- On a campaign, your FIRST proposal's reply must include this in one short sentence: only call people who agreed to hear from you (rules differ by country). Do not add this reminder on a single Quick call.
- Never claim a call or campaign was sent, scheduled or tested: the owner presses the button on the page themselves.`

// Extra guidance for the keypad-menu screen: Emily acts as a whole-flow IVR architect
// that drives the owner from start to a complete, working menu — not a one-field helper.
const ARCHITECT = `YOU ARE "EMILY", THE CLOUDIVR IVR ARCHITECT FOR THIS KEYPAD MENU.
Your job is to take the owner from nothing to a complete, working keypad menu, end to end — never leave the setup half-finished.
- If this is the first message, introduce yourself in one short line ("Hi, I'm Emily — I'll set up your keypad menu") and ask the one thing you most need next (usually: what's the business and what should callers be able to do).
- Drive the whole flow: the greeting, every key and where it goes, any sub-menu, a way to reach a person (e.g. press 0), and what happens on a wrong/no key (the system already retries once then says goodbye — reassure them).
- Work in sensible defaults and PROPOSE a full menu as soon as you have enough; don't ask for things you can reasonably assume, and never stall waiting for one more detail when you could propose and let them adjust.
- Changing an existing menu: keep every other key, sub-menu and the rest of the greeting EXACTLY as they are in the current form — copy them into the patch unchanged. Never remove, renumber or rewrite a key the owner did not mention. If you think something else should change, suggest it in the reply and leave it alone.
- NEVER GUESS FACTS: opening hours, addresses, prices, phone numbers, web addresses and PIN codes must come from the owner's own words or the current form. If a key needs one you were not given, ask for it (you may ask for several missing facts in one message) — do not fill in a plausible-looking value. Never forward a key to this number itself or to a Texting Number. Only add a "reach a person" key when you know which phone it rings; otherwise suggest it in your reply.
- When you propose, fill EVERY key fully (digit, action, destination, label) and write a greeting that names each key. A proposal that leaves a key without its phone number / message / text is not acceptable — ask for that one missing piece instead.
- After the owner is happy, tell them the two steps left on this page: press "Save keypad menu", then flip the switch at the top to turn it on. Offer a test call.`

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

const IVR_ACTS = ['forward', 'message', 'sms', 'voicemail', 'webhook', 'collect', 'pin', 'pay', 'queue', 'devices', 'ringgroup', 'ai', 'fax', 'callback', 'submenu']
const extList = (v) => { const seen = new Set(); return (Array.isArray(v) ? v : []).map(e => ({ code: String(e?.code || '').replace(/\D/g, '').slice(0, 5), name: str(e?.name, 40), action: e?.action === 'devices' ? 'devices' : 'forward', forwardTo: phone(e?.forwardTo) })).filter(e => e.code.length >= 2 && !seen.has(e.code) && seen.add(e.code)).slice(0, 30) }
const afterHoursOf = (v) => (v && typeof v === 'object' ? { enabled: v.enabled !== false, greeting: str(v.greeting, 600), options: menu(IVR_ACTS, true, 3)(v.options) } : undefined)
// One menu level → rows; `acts` allowed actions, `sub` key holding the sub-menu (rows nested one level).
function menu(acts, nested, maxSub = 1) {
  const rows = (v, depth = 0) => {
    const seen = new Set()
    return (Array.isArray(v) ? v : []).filter(r => DIGITS.includes(String(r?.digit)) && acts.includes(r?.action) && !(depth >= maxSub && r.action === 'submenu') && !seen.has(String(r.digit)) && seen.add(String(r.digit))).slice(0, 10).map(r => {
      const o = { digit: String(r.digit), action: r.action, label: str(r.label, 40) }
      if (r.action === 'forward') o.forwardTo = phone(r.forwardTo)
      if (r.action === 'message') o.message = str(r.message, 400)
      if (r.action === 'webhook') { o.url = /^https:\/\//i.test(String(r.url || '').trim()) ? str(r.url, 300) : ''; o.message = str(r.message, 300); o.after = r.after === 'menu' ? 'menu' : 'hangup' }
      if (r.action === 'queue') { o.agents = [...new Set((Array.isArray(r.agents) ? r.agents : String(r.agents || '').split(/[\s,;]+/)).map(phone).filter(Boolean))].slice(0, 5); const w = Math.round(Number(r.maxWait)); o.maxWait = Number.isFinite(w) ? Math.min(900, Math.max(30, w)) : 180; o.announcePosition = r.announcePosition !== false; o.callback = r.callback === true; o.message = str(r.message, 300); const ov = r.overflow || {}; o.overflow = { action: ['voicemail', 'forward', 'message'].includes(ov.action) ? ov.action : 'message', forwardTo: phone(ov.forwardTo), message: str(ov.message, 300) } }
      if (r.action === 'pay') { o.payUrl = /^https:\/\//i.test(String(r.payUrl || '').trim()) ? str(r.payUrl, 300) : ''; o.payNote = str(r.payNote, 300); o.message = str(r.message, 300); o.after = r.after === 'menu' ? 'menu' : 'hangup'; if (/^(es|mn)_[0-9a-f]+$/.test(String(r.smsFrom))) o.smsFrom = String(r.smsFrom) }
      if (r.action === 'collect') { o.prompt = str(r.prompt, 300); const n = Math.round(Number(r.length)); o.length = Number.isFinite(n) ? Math.min(20, Math.max(1, n)) : 6; o.webhook = /^https:\/\//i.test(String(r.webhook || '').trim()) ? str(r.webhook, 300) : ''; o.forwardTo = phone(r.forwardTo); o.message = str(r.message, 300) }
      if (r.action === 'pin') { o.prompt = str(r.prompt, 300); o.pin = String(r.pin || '').replace(/\D/g, '').slice(0, 12); o.onOk = { action: r.onOk?.action === 'forward' ? 'forward' : 'message', forwardTo: phone(r.onOk?.forwardTo), message: str(r.onOk?.message, 300) }; o.failMessage = str(r.failMessage, 300) }
      if (r.action === 'sms') {
        const texts = (Array.isArray(r.smsTexts) ? r.smsTexts : [r.smsText]).map(t => str(t, 600)).filter(Boolean).slice(0, 5)
        Object.assign(o, { smsText: texts[0] || '', ...(texts.length > 1 ? { smsTexts: texts } : {}), message: str(r.message, 300), after: r.after === 'menu' ? 'menu' : 'hangup', ...(/^(es|mn)_[0-9a-f]+$/.test(String(r.smsFrom)) ? { smsFrom: String(r.smsFrom) } : {}) })
      }
      if (r.action === 'voicemail' && (r.box?.name || r.box?.email)) o.box = { name: str(r.box.name, 40), email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(r.box.email || '').trim()) ? str(r.box.email, 120) : '' }
      if (r.action === 'devices') { o.noAnswer = ['voicemail', 'menu', 'message'].includes(r.noAnswer) ? r.noAnswer : 'voicemail'; const n = Math.round(Number(r.ringSecs)); o.ringSecs = Number.isFinite(n) ? Math.min(60, Math.max(10, n)) : 25; o.noAnswerMessage = str(r.noAnswerMessage, 300); if (r.box?.name || r.box?.email) o.box = { name: str(r.box.name, 40), email: str(r.box.email, 120) } }
      if (r.action === 'ai') { o.agentId = /^[A-Za-z0-9_-]{6,64}$/.test(String(r.agentId || '')) ? String(r.agentId) : ''; o.message = str(r.message, 300) }
      if (r.action === 'fax') { o.faxFrom = phone(r.faxFrom); o.prompt = str(r.prompt, 300); o.message = str(r.message, 300) }
      if (r.action === 'callback') { o.auto = r.auto === true || r.auto === 'true'; o.callbackTo = phone(r.callbackTo); o.message = str(r.message, 300) }
      if (r.action === 'submenu') {
        const sub = nested ? r.subMenu || {} : r
        const inner = { greeting: str(sub.greeting, 400), options: rows(sub.options, depth + 1), ...(['en', 'fr', 'es'].includes(sub.language) ? { language: sub.language } : {}) }
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
      stopKey: [(v) => (/^[0-9]$/.test(String(v ?? '')) ? String(v) : ''), 'one digit that puts the person on the do-not-call list when pressed, or "" for none; never one of activeKeys'],
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
      stopKey: [(v) => (/^[0-9]$/.test(String(v ?? '')) ? String(v) : ''), 'one digit that puts the person on the do-not-call list when pressed, or "" for none; never one of activeKeys'],
      menu: [menu(['forward', 'message', 'submenu'], false), MENU_DOC(['forward', 'message', 'submenu'])],
      concurrency: [int(1, 20), 'calls at the same time, 1-20'],
      holdMusic: [bool, 'hold music during transfer'],
      repeat: [oneOf(['', 'daily', 'weekly']), '"" (once) | daily | weekly'],
      dailyLimit: [(v) => (v === '' || v == null ? '' : int(1, 10000)(v) ?? ''), 'max calls per day, "" for no limit'],
    },
    note: 'The contact list, caller ID and audio file are picked on the page, not by you. The campaign needs about $20 in the wallet to start and bills per minute as it runs — for a large list (thousands of numbers) advise the owner to top up enough credit up front so it does not pause mid-campaign when the wallet runs low.',
  },
  aicampaign: {
    what: 'an AI conversation campaign: an AI voice agent holds a real conversation with every contact on a list. You set up BOTH the agent (who it is, what it says, what it finds out) AND the campaign (who to call, from which number, when)',
    fields: {
      agentId: [(v) => str(v, 60), '"new" to write a new agent from the agent fields below, or the id of one of account info agents to reuse it (then only send agent fields the owner wants changed)'],
      agentName: [text(40), 'first name the agent uses, e.g. "Ava"'],
      businessName: [text(60), 'the business it calls for'],
      language: [(v) => require('../ai-agent/languages').LANGS.includes(v) ? v : undefined, 'language code the agent starts in'],
      voice: [oneOf(['marin', 'cedar', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse']), 'voice name'],
      firstMessage: [text(500), 'exact opening line; may use {name}, {business} and {lead_name|there}'],
      goal: [text(4000), 'personality and script: what the agent does after the opening, how it talks, what it must find out, when to transfer'],
      knowledge: [text(6000), 'FAQs and facts the agent may use (prices, hours, offers) — only what the owner told you'],
      transferTo: [phone, 'phone to hand interested people to, or "" for none'],
      takeMessages: [bool, 'take a message (name, callback number) when nobody can take a transfer'],
      discloseAi: [bool, 'agent says it is an AI at the start'],
      name: [text(80), 'campaign name'],
      callerId: [phone, 'one of account info callerNumbers the calls come from'],
      listId: [(v) => str(v, 60), 'id of one of account info contactLists to call, or "" when numbers are typed'],
      leads: [(v) => phoneList(500)(v).join('\n'), 'numbers to call, one per line, E.164 (only numbers the owner gave you)'],
      concurrency: [int(1, 20), 'calls at the same time, 1-20'],
      scheduledFor: [(v) => (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(v ?? '')) ? String(v) : v === '' ? '' : undefined), 'start time in the owner\'s local time "YYYY-MM-DDTHH:mm", or "" to start it by hand'],
      repeat: [oneOf(['', 'daily', 'weekly']), '"" (once) | daily | weekly'],
      dailyLimit: [(v) => (v === '' || v == null ? '' : int(1, 10000)(v) ?? ''), 'max calls per day, "" for no limit'],
    },
    note: `HOW TO RUN THIS CHAT: find out (one question at a time) what the calls are for and what the agent should achieve, then who to call. If account info agents already has a fitting agent, offer to reuse it (agentId = its id); otherwise agentId "new" and write the agent: a warm natural script, a short opening line, the facts it may use. Never invent prices, offers or phone numbers. Pick callerId from account info callerNumbers (if several, ask which; if one, use it and say so). For who to call: a saved list from contactLists (set listId) or numbers the owner pastes (set leads). Defaults you use silently and mention in the summary: concurrency 5, no schedule (owner presses Save, then Start), no repeat, no daily limit, discloseAi on, takeMessages on. Rules to mention once in your first proposal: calls go out only 8am-9pm in each contact's local time, do-not-call numbers are skipped, only call people who agreed to hear from you, $0.30 per started minute on the Pro and Business plans, unanswered calls are free. You never save or start the campaign — the owner presses Save campaign. Once the form is filled, suggest in one line that they press "Call me now" under the agent to hear it on their own phone first (free, 5 a day, the agent is saved but the campaign is not).`,
  },
  ivr: {
    what: 'the keypad menu (IVR) people hear when they call this number',
    fields: {
      greeting: [text(600), 'what callers hear first, listing the keys, e.g. "Thanks for calling Bella\'s. Press 1 for reservations, press 2 for our hours."'],
      options: [menu(IVR_ACTS, true, 3), `full list of keys: [{"digit":"1","action":"forward|message|sms|voicemail|webhook|collect|pin|pay|queue|devices|ringgroup|ai|fax|callback|submenu","box":{"name":"Billing - department mailbox (voicemail / devices)","email":"who gets the email copy"},"noAnswer":"voicemail|menu|message (devices)","ringSecs":"10-60 (devices)","agentId":"id from account info aiAgents (ai)","faxFrom":"+1... one of account info faxNumbers (fax)","auto":"true|false - ring the owner's phone right away (callback)","callbackTo":"+1... owner's phone (callback auto)","label":"Sales","forwardTo":"+1... (forward)","message":"words read out (message), after the text (sms), after a webhook, or after collected digits","smsFrom":"id of the texting number","smsTexts":["version A","version B (rotates)"],"url":"https://... secure webhook (webhook)","prompt":"what to ask the caller to type (collect/pin)","length":"how many digits to collect (collect)","webhook":"https://... where to send the typed digits (collect)","pin":"the digit code to check (pin)","onOk":{"action":"forward|message","forwardTo":"+1...","message":"said when the code is right"},"failMessage":"said when the code is wrong (pin)","agents":["+1...","+1... up to 5 phones (queue)"],"maxWait":"seconds a caller may wait, 30-900, default 180 (queue)","announcePosition":"true|false (queue)","callback":"true|false - offer a call back while waiting (queue)","overflow":{"action":"voicemail|forward|message","forwardTo":"+1...","message":"..."},"payUrl":"https://... the owner's own payment page (pay)","payNote":"short line texted before the link (pay)","after":"hangup|menu (sms/webhook/fax)","subMenu":{"greeting":"...","language":"en|fr|es - only for a language choice key, the sub-menu greeting and keys then written in that language","options":[same keys; nest up to 3 levels]}}]`],
      extensions: [extList, '[{"code":"101 (2-5 digits)","name":"Anna","action":"forward|devices","forwardTo":"+1... (forward)"}] - staff extensions callers can dial at any time during the main greeting (mention it in the greeting)'],
      afterHours: [afterHoursOf, '{"enabled":true,"greeting":"what callers hear outside the Hours schedule, listing its keys","options":[same keys as the main menu]} - a separate menu outside business hours (needs the Hours schedule on)'],
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
PLANS (per number): Basic, Plus, Pro, Business. Basic: forwarding, voicemail, browser phone, softphone (SIP), AI receptionist (per minute). Plus adds keypad menu (IVR), ring group, call recording, AI call summaries. Pro adds Quick IVR calls, Bulk IVR campaigns, AI conversation campaigns, verifying your customers identity via OTP, scheduling Quick calls, presets, one saved voice, SMS to email/webhook. Business adds custom caller ID (call from any number), Text Triggers, redial, own OTP confirm/reject sentences, text calls, encrypted calls. If the owner wants something their plan can't do, say which plan it needs (upgrade is in the number's Billing tab).
INBOUND — what answers a call, first match wins: 1) forwarding set to "always" (beats everything, even the AI agent) 2) AI voice agent 3) ring group 4) keypad menu — while the menu is on, busy/no-answer forwarding, browser ring and voicemail don't run except through its keys 5) forwarding when busy / not answered (rings the browser phone/softphone first) 6) browser phone / softphone 7) voicemail. The Hours schedule applies on top: when closed, callers go to voicemail (Starter+), hear a closed message and are hung up, or are forwarded to up to 5 backup numbers (~20 s each). The schedule has its own on/off switch.
KEYPAD MENU (IVR, Plus+): greeting (typed text read in the app's language, or an audio file / AI voice), then the caller presses ONE key 0-9 (up to 10 keys). Wrong or no key: they hear "invalid option" once, then goodbye. Key actions:
- forward: rings a phone (with country code); billed per minute from the wallet (US/Canada cheaper than international); blocked if the wallet can't cover a minute. Hold music follows the Forwarding tab's setting.
- message: reads words (or plays an audio file) then hangs up — good for hours, address, website.
- sms: texts the caller from one of the owner's Texting Numbers (USA eSIM / mobile line), USA callers only, $0.05 per text from the wallet; 1-5 versions rotate so each caller gets the next one; after sending it says a short line, then hangs up or replays the menu.
- voicemail: "leave a message after the tone", up to 60 seconds, lands in Inbox (+ email/transcript if set on the Voicemail tab).
- webhook: calls one of the owner's own secure https web addresses (sends who called, the number and the key pressed), then says a short line and hangs up or replays the menu — good for logging a request, notifying another system or starting a workflow. Needs a valid https URL from the owner; never invent one. When the owner says a key should call / notify / ping "my system", "my API", "my server", "my CRM" or an automation tool, they mean this action (not forward) — ask for the https address.
- collect: asks the caller to type a number (e.g. order or account number) and press pound, then sends those digits to the owner's https webhook, connects the call, or just confirms. Needs a prompt and at least one of: webhook URL, forward number, or confirmation message.
- pin: asks the caller for a code and checks it; a correct code forwards the call or plays a message, a wrong code is retried (3 tries) then hangs up. Good for a members-only or staff-only path. This is a simple access code, not for bank-grade secrets. Needs at least one PIN.
- Live data (the owner sets these in the form under each key, you cannot set them; mention them when useful): a webhook key can use the REPLY of the owner's system ("say: your balance is $42" / "route to: +1…"); collect and PIN keys can check what the caller typed in the owner's own database (MongoDB or Postgres, connected in the form) or with their system; new webhook, collect and PIN keys WAIT for the owner's Accept / Decline in the app by default (a banner pops up; the caller is on hold up to 45 seconds) — say so in one short sentence when you propose such a key, and that it can be switched off under the key; a pay key can create a link for an exact amount with the owner's Stripe, PayPal, Square, Razorpay or Mollie account. Keys that already have these settings keep them.
- queue: for a team. The caller hears hold music while up to 5 phones ring one after another, round after round, until someone answers or the maximum wait passes (default 3 minutes); a caller who is not first is told their place in the queue. If nobody answers in time, the last resort runs: voicemail (Starter+), another phone, or a closing message. Use it when the owner says team, queue, agents, "whoever is free", or gives several phones for one key; use forward for a single phone. Optional "callback": between rounds the caller can press 1 to stop waiting; the owner then gets a message with the caller's number to ring back themselves (CloudIVR does not redial automatically — say so). There is no estimated wait time — do not promise one.
- pay: texts the caller a link to the owner's OWN payment page (their Stripe, PayPal, Mollie… link) from one of the owner's Texting Numbers, then hangs up or replays the menu. Card details are never taken over the phone and CloudIVR does not handle the money. Needs the owner's https payment link (never invent one) and a Texting Number, exactly like the sms key.
- devices ("ring my phones"): rings this number's own browser phone and phone apps (its SIP login) with ringback for the caller, 10-60 s (default 25); nobody answers → voicemail (optionally a department mailbox), back to the menu, or a sorry message. Needs the number's phone app login (account info sipLogin); the owner must keep CloudIVR open or an app signed in. Use it when the owner says "ring me", "my desk phone", "my browser", "the office phone".
- ringgroup ("team group"): rings the phones saved in the number's Ring group tab all at once, first to answer gets it; the group's own no-answer choice applies. Needs at least one phone saved there (ringGroupMembers); the Ring group switch can stay off. Use queue instead when the team should ring one after another with hold music.
- ai: hands the caller to one of the owner's AI agents (account info aiAgents [{id,name}]); the agent can answer questions and book appointments if its calendar is set; billed per minute like an AI-answered call. If there are no agents, say to create one on the AI agents page first.
- fax ("fax me a document"): asks the caller for their fax number and faxes the owner's document (PDF/Word/image, up to 20 pages) from one of the owner's fax numbers (account info faxNumbers); free pages first, then the usual page price from the wallet. The owner uploads the document under the key (you cannot). If faxNumbers is empty, tell them to tap "Get a fax number" under the key first.
- callback: the caller asks to be called back and the call ends. Default: the owner gets a notification with the number. With auto on, the owner's own phone (callbackTo) rings a few seconds later and pressing 1 connects them to the caller.
- voicemail can have a department mailbox: box {name, email} — the voicemail is labelled with that name in Inbox and its email copy goes to that person (e.g. press 2 to leave a message for Billing).
- Language choice: a submenu with "language":"es" (or fr / en) — callers who press it hear that sub-menu and everything after it in that language; write its greeting and texts in that language. ANY "Spanish / French / English option", "para español" or "en français" key is ALWAYS such a submenu, even when it only does one thing: e.g. "a Spanish option on key 9 that takes a voicemail" = key 9 submenu {language:"es", greeting:"Para dejar un mensaje, pulse 1.", options:[{digit:"1",action:"voicemail"}]}. Other key actions have no language of their own — never describe a non-submenu key as being "in Spanish". The main menu language follows the app language.
- extensions: staff codes of 2-5 digits callers can dial any time during the main greeting (e.g. 101 for Anna) that ring a phone or the number's own browser phone/apps; the greeting should say "if you know your party's extension, dial it now". A single key then waits about 2 seconds before acting.
- afterHours: a separate menu used outside the number's Hours schedule (instead of the closed message), e.g. "We're closed. Press 1 to leave a message, press 2 for emergencies." Needs the Hours schedule on (account info hoursOn).
- submenu: more levels of keys with their own greeting (may nest up to 3 levels deep).
The menu must be saved AND switched on (switch at the top). Switching it on turns the AI agent off on that number.
FORWARDING: always / when busy / when not answered after 10-60 s; up to 4 backups ring one after another; forwarded phone sees the business number or, US only, the caller's number. Minutes bill from the wallet.
RING GROUP (Plus+): up to 5 phones ring together, first to answer gets it; ring 10-60 s; then voicemail, one backup number, or a sorry message. While on, forwarding and the keypad menu are skipped; Hours still apply.
VOICEMAIL (every plan): standard greeting in a chosen language, or own audio / AI voice made from text; ring time 10-60 s; email copy; transcripts.
TEXTING on a calling number is an add-on ($0.05 per text sent, receiving free); US local numbers need 10DLC registration, toll-free numbers need verification, before texts work. Missed-call text: one text per caller per day after an unanswered call (needs texting on). Text Triggers (Business): an incoming text starts a call — callback (rings the owner, reads the text, press 1 to call them back), message (calls the texter and reads a message), ai (AI agent calls them back); filters: keywords, business hours only, once per sender per hour; checked top to bottom, max 5; wallet must be over $1.
QUICK CALL (Pro+): up to 10 numbers (use a campaign for more), from one of the owner's numbers. They hear a script read by an AI voice (max 1500 characters) or an audio file. Any [Placeholder] like [Name] must be filled in the boxes under the script before calling, or the call is refused. Then:
- transfer: pressing one of the chosen keys connects them to the owner's phone (must differ from the caller ID), up to 4 backups, optional hold music. Any other key or none: the message replays once (audio) then goodbye.
- otp (code collection): the caller presses 1, hears "Please enter your N-digit verification code now" and types it (4, 5, 6 or 8 digits; "6-digit code" → length 6). If the script doesn't say "press 1", the system adds "To continue, press 1 now." They wait on hold (hold music if on) while the code appears for the owner on the Quick call page and in Inbox, who has 90 s to Accept (optional: then connect them to a phone), Decline (they're asked again, 3 tries in total) or hang up. Business plan: own sentence said after Accept and after Decline.
- menu: each key forwards to a phone, reads a message, or opens one sub-menu.
Billed per minute (rate depends on the destination); wallet must cover at least $1 / one minute. Scheduling (5 min–30 days ahead), presets and redial are Business.
BULK IVR CAMPAIGN (Pro+): one message (audio from the library or a script turned into an AI voice when saved) to a contact list; 500 numbers per campaign, bigger lists split into parts of 500 called one after another (up to 10 parts) or only the first 500; numbers on the do-not-call list and known dead numbers are skipped. Key press: just report it, transfer to the owner, or a key menu. Answering machines: leave the same message, another clip, a separate voicemail script, or hang up. 1-20 calls at a time (more with rotating caller IDs), schedule, repeat daily/weekly (not for split lists), daily call limit. Needs about $20 in the wallet to launch. Suggest calling during normal daytime hours of the contacts.
AI CALLING (Campaigns → New campaign → AI conversation, Pro and Business): the AI voice agent and its campaign are set up together in one chat; agents hold real conversations and call only 8am-9pm in each contact's local time. Saved agents are under Campaigns → AI calling agents. The AI receptionist (answering incoming calls) is under AI.`

const OTHER = 'Where things live: forwarding, keypad menu, AI agent, ring group, voicemail, hours (Answering group) and SMS, missed-call text, Text Triggers (Texting group) are tabs of each number; Quick call is under Calls; Bulk and AI calling campaigns (with their AI agents) are under Campaigns; the AI receptionist is under AI.'

function system(sc, current, context, screen) {
  const fields = Object.entries(sc.fields).map(([k, [, doc]]) => `- ${k}: ${doc}`).join('\n')
  return `${require('../emily-guard').SCOPE}

You are the CloudIVR setup assistant, an expert on the whole CloudIVR phone system. You guide a small business owner through setting up ${sc.what} in a friendly conversation.
${screen === 'ivr' ? ARCHITECT + '\n' : (screen === 'quick' || screen === 'campaign') ? OUTBOUND_ARCHITECT + '\n' : ''}${KNOWLEDGE}

HOW TO TALK
- Plain, warm language, 1-3 short sentences per turn plus an optional short list. No jargon. Ask ONE question at a time.
- Guide: find out what they need (business, who calls, where calls should go, phone numbers). Suggest what works best and why, in a few words (e.g. "most callers want a person — shall key 0 reach you?"). Point out conflicts (e.g. a ring group skips the keypad menu, voicemail needs a plan).
- Never invent facts about the business (hours, prices, addresses, links, names) or phone numbers: ask for them. Don't leave [brackets] in anything callers hear (they would be read out), except [Name]-style placeholders in Quick call / campaign scripts, and then tell the owner to fill them in.
- The proposal IS the confirmation step: as soon as you know enough, put the full setup in "patch" in that same reply. The owner sees it as a card and presses "Fill in the form" to accept, so nothing changes without their say. NEVER ask "shall I proceed?" / "shall I set this up?" with an empty patch — that just wastes a turn. If the owner's message already contains what the setup needs, propose immediately, using sensible defaults for anything minor and saying which defaults you chose.
- Only ask a question instead of proposing when something essential is truly missing (e.g. no number to call, no number to connect to, nothing about what the call should say).
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
- When proposing: "patch" holds every field to change (lists in full), "summary" 2-6 lines like "Key 1 → rings +14155550100 (Sales)", and "reply" ends by inviting them to press "Fill in the form" or tell you what to change.
Fields on this screen:
${fields}
Phones are E.164 like +14155550100; a 10-digit number without country code is US (+1).
${sc.note || ''}
${context ? `About this account: ${JSON.stringify(context).slice(0, 800)}` : ''}
Current form: ${JSON.stringify(current || {}).slice(0, 6000)}`
}

// Things a proposal still needs before it can be saved and work on a real call, in plain words.
const has = (v) => (Array.isArray(v) ? v.length > 0 : !!String(v ?? '').trim())
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).filter(([, y]) => y !== undefined && y !== '').sort(([a], [b]) => a.localeCompare(b))) : x))
const sameAs = (a, b) => a !== undefined && b !== undefined && stable(a) === stable(b)
function keyGaps(opts, ctx, where = '', said = '', prev = []) {
  const out = []
  const lines = Array.isArray(ctx?.textingNumbers) ? ctx.textingNumbers : null
  for (const o of opts || []) {
    const k = `${where}Key ${o.digit}`
    // A key the proposal leaves exactly as it is already saved isn't questioned again.
    if (sameAs(o, (prev || []).find(p => String(p.digit) === String(o.digit)))) continue
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
    if (o.action === 'voicemail' && ctx && ctx.voicemailAvailable === false) out.push(`${k}: voicemail isn’t on this number’s plan.`)
    if (o.action === 'webhook' && o.check?.source !== 'db' && !/^https:\/\//i.test(String(o.url || '').trim())) out.push(`${k}: what is the secure https web address (webhook URL) it should call?`)
    if (o.action === 'queue') {
      if (!has(o.agents)) out.push(`${k}: which phones should the queue ring (up to 5)?`)
      if (o.overflow?.action === 'forward' && !o.overflow.forwardTo) out.push(`${k}: which phone should be tried when nobody in the queue answers?`)
      if (o.overflow?.action === 'voicemail' && ctx && ctx.voicemailAvailable === false) out.push(`${k}: voicemail as the last resort isn’t on this number’s plan.`)
    }
    if (o.action === 'pay') {
      if (o.payVia !== 'provider' && !/^https:\/\//i.test(String(o.payUrl || '').trim())) out.push(`${k}: what is the https link to your own payment page?`)
      if (lines && !lines.length) out.push(`${k}: texting a payment link needs a Texting Number — order one first.`)
      else if (lines && lines.length > 1 && !lines.some(l => l.id === o.smsFrom)) out.push(`${k}: which Texting Number sends the link?`)
    }
    if (o.action === 'collect') {
      if (!has(o.prompt)) out.push(`${k}: what should the caller be asked to type?`)
      if (!/^https:\/\//i.test(String(o.webhook || '').trim()) && !o.forwardTo && !has(o.message) && !o.check?.source && !o.confirm) out.push(`${k}: what happens with the digits — send to your system, connect the call, or confirm?`)
    }
    if (o.action === 'devices' && ctx && ctx.sipLogin === false) out.push(`${k}: this number has no browser phone / phone app login yet — set it up in the Phone apps tab first.`)
    if (o.action === 'ringgroup' && ctx && ctx.ringGroupMembers === 0) out.push(`${k}: which phones are in your team group? (add them in the Ring group tab)`)
    if (o.action === 'ai' && !o.agentId) out.push(ctx && Array.isArray(ctx.aiAgents) && !ctx.aiAgents.length ? `${k}: you have no AI agent yet — create one on the AI agents page first.` : `${k}: which AI agent should take these calls?`)
    if (o.action === 'fax') {
      if (ctx && Array.isArray(ctx.faxNumbers) && !ctx.faxNumbers.length) out.push(`${k}: you need a fax number to send from — get one with the "Get a fax number" button under the key.`)
      else if (!o.faxFrom) out.push(`${k}: which fax number should send it?`)
      if (!o.fileId) out.push(`${k}: upload the document callers should get (button under the key).`)
    }
    if (o.action === 'callback' && o.auto && !o.callbackTo) out.push(`${k}: which phone of yours should ring for each call-back request?`)
    if (o.action === 'pin' && !o.check?.source && !(String(o.pin || '').replace(/\D/g, '') || (Array.isArray(o.pins) && o.pins.length))) out.push(`${k}: which code should callers enter?`)
    const sub = o.subMenu || (o.action === 'submenu' ? o : null)
    if (o.action === 'submenu') { if (!(sub.options || []).length) out.push(`${k}: the sub-menu has no keys yet.`); const was = (prev || []).find(p => String(p.digit) === String(o.digit)); out.push(...keyGaps(sub.options, ctx, `${k} → `, said, was?.options || was?.subMenu?.options)) }
  }
  return out
}
const GAPS = {
  ivr: (f, c, said, cur) => [...(f.options && !f.options.length ? ['Add at least one key.'] : []), ...keyGaps(f.options, c, '', said, cur?.options),
    ...(f.greeting && f.options ? f.options.filter(o => !new RegExp(`\\b${o.digit}\\b`).test(f.greeting)).map(o => `The greeting doesn't mention key ${o.digit}.`) : []),
    ...(f.afterHours?.options ? keyGaps(f.afterHours.options, c, 'After hours → ', said, cur?.afterHours?.options) : []),
    ...(f.afterHours?.enabled && c && c.hoursOn === false ? ['The after-hours menu only plays once your Hours schedule is on (Hours tab).'] : []),
    ...(f.extensions || []).filter(e => e.action !== 'devices' && !e.forwardTo).map(e => `Extension ${e.code}: which phone should it ring?`)],
  quick: (f) => [...(!has(f.targets) ? ['Which number(s) should I call?'] : []), ...(f.mode === 'transfer' && !f.transferTo ? ['Which phone should callers be connected to?'] : []), ...(f.mode === 'otp' && f.script && !/press\s*(1|one)/i.test(f.script) ? ['The script should tell them to press 1 before typing the code.'] : []), ...(f.mode === 'menu' ? keyGaps(f.menu) : [])],
  aicampaign: (f) => [
    ...(f.agentId === 'new' && String(f.goal || '').trim().length < 10 ? ['What should the agent say and find out on each call?'] : []),
    ...(!f.agentId ? ['Should I write a new agent for this, or reuse one of yours?'] : []),
    ...(!f.listId && !String(f.leads || '').trim() ? ['Who should the agent call? Paste the numbers here, or tell me which saved list to use.'] : []),
  ],
  campaign: (f) => [...(f.mode === 'transfer' && !f.transferNumber ? ['Which phone should calls transfer to?'] : []), ...(f.mode === 'menu' ? keyGaps(f.menu) : [])],
  forwarding: (f) => (f.mode && f.mode !== 'disabled' && !f.forwardTo ? ['Which phone should calls forward to?'] : []),
  ringgroup: (f, c) => [...(f.members && f.members.length < 2 ? ['A ring group works best with at least 2 phones.'] : []), ...(f.fallback === 'forward' && !f.fallbackTo ? ['Which backup number?'] : []), ...(f.fallback === 'voicemail' && c?.voicemailAvailable === false ? ['Voicemail needs the Starter plan or higher.'] : [])],
  hours: (f, c) => [...(f.offAction === 'forward' && !f.offForward ? ['Which backup numbers when closed?'] : []), ...(f.offAction === 'voicemail' && c?.voicemailAvailable === false ? ['Voicemail needs the Starter plan or higher.'] : [])],
  triggers: (f, c) => (f.rules || []).flatMap((r, i) => [...(r.action === 'callback' && !f.myPhone && !c?.myPhone ? [`Trigger ${i + 1}: which phone should we ring for the callback?`] : []), ...(r.action === 'message' && !r.message ? [`Trigger ${i + 1}: what should the call say?`] : []), ...(r.action === 'ai' && c?.agents === 0 ? [`Trigger ${i + 1}: create an AI agent first, then pick it in the trigger.`] : []), ...(r.keywordOnly && !r.keywords ? [`Trigger ${i + 1}: which keywords?`] : [])]),
}


// Live-data settings (database lookup, Accept / Decline, payment provider) are set in the form, not by chat: keep them when a key is re-proposed.
const LIVE_FIELDS = ['check', 'confirm', 'confirmTimeout', 'declineMessage', 'replayMessage', 'onAccept', 'onDecline', 'payVia', 'connId', 'amountFrom', 'amount', 'currency', 'description', 'waitPaid', 'paidMessage', 'length', 'prompt', 'url']
function keepLive(next, prev, fresh = []) {
  for (const o of next || []) {
    const was = (Array.isArray(prev) ? prev : []).find(x => String(x.digit) === String(o.digit) && x.action === o.action)
    // New live keys wait for the owner's Accept / Decline by default (same as the form); existing keys keep their choice.
    if (['webhook', 'collect', 'pin'].includes(o.action)) { if (was ? was.confirm === true : true) o.confirm = true; else delete o.confirm; if (!was) fresh.push(o.digit) }
    if (!was) continue
    // Fax document (uploaded in the form) and other form-only details stay on a re-proposed key.
    for (const f of ['fileId', 'pages', 'docName', 'agentId', 'faxFrom', 'box', 'callbackTo', 'smsFrom', 'payUrl', 'payNote']) if (was[f] !== undefined && (o[f] === undefined || o[f] === '')) o[f] = was[f]
    if (was.check?.source || was.confirm || was.payVia === 'provider') for (const f of LIVE_FIELDS) if (was[f] !== undefined && (o[f] === undefined || o[f] === '' || f === 'check')) o[f] = was[f]
    if (o.action === 'submenu') keepLive(o.options || o.subMenu?.options, was.options || was.subMenu?.options, fresh)
  }
  return fresh
}

// A "reach a person" key the owner never asked for and gave no phone for is left out (she may suggest it in words) instead of blocking the whole setup.
function dropUnasked(patch, messages, current) {
  const own = messages.filter(m => m.role !== 'assistant').map(m => m.content).join(' \n '), digits = own.replace(/[^\d]/g, '')
  const mine = (o) => new RegExp(`\\b(?:press|key|option|dial|number)\\s*${o.digit}\\b`, 'i').test(own) || (current?.options || []).some(c => String(c.digit) === String(o.digit))
  const gone = patch.options.filter(o => o.action === 'forward' && !mine(o) && !(o.forwardTo && digits.includes(String(o.forwardTo).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''))))
  if (!gone.length || gone.length === patch.options.length) return
  patch.options = patch.options.filter(o => !gone.includes(o))
  for (const o of gone) {
    const press = new RegExp(`\\b(?:press|dial)\\s+${o.digit}\\b`, 'i')
    if (typeof patch.greeting === 'string') patch.greeting = patch.greeting.split(/(?<=[.!?])\s+/).map(sen => (!press.test(sen) ? sen : (sen.match(/\b(?:press|dial)\s+\d\b/gi) || []).length === 1 ? '' : sen.split(/,\s*/).filter(cl => !press.test(cl)).join(', ').replace(/,?\s*(?:or|and)\s*$/i, '').replace(/([^.!?])$/, '$1.'))).filter(Boolean).join(' ')
  }
}

// Nothing invented: phones, web addresses, PIN codes and numbers in spoken words must come from the owner (their messages or the current form).
const WORDNUM = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, ninety: 90, hundred: 100, noon: 12, midnight: 12 }
function invented(screen, patch, messages, current) {
  const own = `${messages.filter(m => m.role !== 'assistant').map(m => m.content).join(' \n ')} \n ${JSON.stringify(current || {})}`
  const low = own.toLowerCase(), digits = own.replace(/[^\d]/g, '')
  const nums = new Set([...(own.match(/\d+/g) || []), ...Object.entries(WORDNUM).filter(([w]) => new RegExp(`\\b${w}\\b`, 'i').test(own)).map(([, n]) => String(n))])
  for (const n of [...nums]) { const v = Number(n); if (v >= 13 && v <= 23) nums.add(String(v - 12)); if (v >= 1 && v <= 11) nums.add(String(v + 12)); nums.add(String(v).padStart(2, '0')) }
  const out = []
  const badPhone = (p) => p && !digits.includes(String(p).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''))
  const badUrl = (u) => !!u && !low.includes(String(u).trim().toLowerCase().replace(/\/+$/, ''))
  const badFacts = (t, keys = []) => [...new Set((String(t || '').replace(/\b(?:press(?:ing)?|key|option|dial|number)\s+\d\b/gi, ' ').replace(/\b\d+[- ]digit/gi, ' ').match(/\d+/g) || []).filter(n => !nums.has(n) && !nums.has(String(Number(n))) && !(n.length === 1 && keys.includes(n)) && n !== '00'))]
  const said = (where, label, t, keys) => { if (badFacts(t, keys).length) out.push(`${where}: what are the real details ${label} should give? (I won’t guess times, dates, prices or addresses.)`) }
  const walk = (opts, where) => {
    const keys = (opts || []).map(o => String(o.digit))
    for (const o of opts || []) {
      const k = `${where}Key ${o.digit}${o.label ? ` (${o.label})` : ''}`
      if (badPhone(o.forwardTo)) out.push(`${k}: which phone should it ring?`)
      if (badPhone(o.onOk?.forwardTo)) out.push(`${k}: which phone should a correct code connect to?`)
      if (badPhone(o.overflow?.forwardTo)) out.push(`${k}: which phone should be tried when nobody answers?`)
      if ((o.agents || []).some(badPhone)) out.push(`${k}: which phones should ring (up to 5)?`)
      for (const [f, q] of [['url', 'what is the https address of your system?'], ['webhook', 'what is the https address that should receive the digits?'], ['payUrl', 'what is the https link to your payment page?']]) if (badUrl(o[f])) out.push(`${k}: ${q}`)
      if (o.action === 'pin' && o.pin && !digits.includes(o.pin)) out.push(`${k}: which code should callers enter?`)
      for (const t of [o.message, o.smsText, ...(o.smsTexts || []), o.payNote, o.onOk?.message, o.overflow?.message]) said(k, 'it', t, keys)
      const sub = o.subMenu || (o.action === 'submenu' ? o : null)
      if (sub) { said(k, 'the sub-menu greeting', sub.greeting, (sub.options || []).map(x => String(x.digit))); walk(sub.options, `${k} → `) }
    }
  }
  if (screen === 'ivr') { if (patch.options) walk(patch.options, ''); if (patch.greeting) said('Greeting', 'the greeting', patch.greeting, (patch.options || current?.options || []).map(o => String(o.digit))) }
  if (screen === 'quick' || screen === 'campaign') {
    const all = [...'0123456789']
    if (String(patch.targets || '').split(/[,\s]+/).filter(Boolean).some(badPhone)) out.push('Which number(s) should I call?')
    if (badPhone(patch.transferTo) || badPhone(patch.transferNumber)) out.push('Which phone should people be connected to?')
    if (String(patch.transferBackups || '').split(/[,\s]+/).filter(Boolean).some(badPhone)) out.push('Which backup phones, if any?')
    if (patch.menu) walk(patch.menu, '')
    if (patch.script) said('Script', 'the call', patch.script, all)
  }
  return [...new Set(out)].slice(0, 6)
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
    const ask1 = (retry) => axios.post('https://api.openai.com/v1/chat/completions', {
      model: process.env.AI_AGENT_DRAFT_MODEL || 'gpt-4.1-mini', temperature: retry ? 0.1 : 0.4, frequency_penalty: retry ? 0.4 : 0, response_format: { type: 'json_object' }, max_tokens: 3000,
      messages: [{ role: 'system', content: system(sc, current, context, screen) }, ...messages.slice(-16).map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: str(m.content, 2000) }))],
    }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: retry ? 40000 : 25000 }).then(r => JSON.parse(r.data.choices[0].message.content))
    const j = await ask1().catch((e) => { console.log(`[Assist:${screen}] retry after: ${e.response?.data?.error?.message || e.message}`); return ask1(true) })
    if (j.offTopic === true) return { reply: str(j.reply, 400) || 'I can only help with setting up and using CloudIVR.', summary: [], missing: [], patch: {}, offTopic: true }
    const patch = clean(sc, j.patch)
    const waits = screen === 'ivr' && patch.options ? keepLive(patch.options, current?.options) : []
    if (screen === 'ivr' && patch.afterHours?.options) keepLive(patch.afterHours.options, current?.afterHours?.options)
    if (screen === 'ivr' && Array.isArray(patch.options)) dropUnasked(patch, messages, current)
    // Parts the proposal just repeats unchanged are left out, so the summary and "still needed" only cover what was asked.
    const emptyAH = (v) => !v || (!v.enabled && !((v.options || []).length)), emptyExt = (v) => !v || !v.length
    const echoed = screen === 'ivr' ? ['extensions', 'afterHours'].filter(f => f in patch && (sameAs(patch[f], current?.[f]) || (f === 'afterHours' ? emptyAH(patch.afterHours) && emptyAH(current?.afterHours) : emptyExt(patch.extensions) && emptyExt(current?.extensions)))) : []
    for (const f of echoed) delete patch[f]
    if (echoed.length && Array.isArray(j.summary)) j.summary = j.summary.filter(x => !(echoed.includes('extensions') && /extension/i.test(String(x))) && !(echoed.includes('afterHours') && /after.?hours|closed/i.test(String(x))))
    const ask = Object.keys(patch).length ? invented(screen, patch, messages, current) : []
    const askFor = (list) => ({ reply: `Almost there — I just need ${list.length === 1 ? 'one thing' : 'a few things'} from you so I don’t guess:\n${list.map(a => `• ${a}`).join('\n')}`, summary: [], missing: [], patch: {} })
    if (ask.length) return askFor(ask)
    // Outbound safety net: a stop key only exists in transfer / record-only mode, and can never double as a normal key.
    if ((screen === 'quick' || screen === 'campaign') && Object.keys(patch).length) {
      const mode = patch.mode || current?.mode
      const keys = patch.activeKeys || current?.activeKeys || []
      const sk = patch.stopKey ?? current?.stopKey ?? ''
      if (sk && (mode === 'menu' || mode === 'otp' || keys.map(String).includes(String(sk)))) patch.stopKey = ''
      // Campaign rules the model keeps missing: nothing to connect to → just report; a stop key by default unless the owner refused one.
      if (screen === 'campaign') {
        if (mode === 'transfer' && !(patch.transferNumber || current?.transferNumber)) { patch.mode = 'report_only'; if (!keys.length) patch.activeKeys = [] }
        const m2 = patch.mode || mode, refused = /\b(no|without|don'?t (?:add|want|need)|do not (?:add|want|need)|remove the) (?:a |any |the )?(?:stop|opt)/i.test(messages.filter(m => m.role !== 'assistant').map(m => m.content).join(' '))
        if (!patch.stopKey && !(current?.stopKey) && !refused && (m2 === 'transfer' || m2 === 'report_only') && typeof patch.script === 'string' && patch.script.trim()) {
          const free = ['9', '8', '7', '6', '5', '4', '3', '2', '0'].find(d => !keys.map(String).includes(d))
          const said = BP.stopClauses(patch.script).hits[0]?.key
          patch.stopKey = said && !keys.map(String).includes(said) ? said : free
          if (said !== patch.stopKey) patch.script = `${BP.stripStopPromise(patch.script)} To stop receiving these calls, press ${patch.stopKey}.`
          if (Array.isArray(j.summary)) j.summary.push(`Key ${patch.stopKey} → stops future calls to that person (do-not-call list)`)
        }
      }
      // No stop key in effect → the script must not promise one (prompting alone proved unreliable).
      const effective = patch.stopKey ?? current?.stopKey ?? ''
      if (!effective && typeof patch.script === 'string') {
        const cleaned = BP.stripStopPromise(patch.script)
        const wanted = /\b(stop|opt.?out|unsubscribe)\b/i
        if (cleaned !== patch.script.trim() || wanted.test(String(j.reply))) {
          patch.script = cleaned
          const kept = String(j.reply || '').split(/(?<=[.!?])\s+/).filter(x => !wanted.test(x)).join(' ').replace(/,?\s*(?:plus|and|with)\s+(?:a\s+)?(?:press\s+)?\d?\s*(?:to\s+)?stop[^.;!?]*/gi, '')
          j.reply = `${str(kept, 700) || 'Here’s the setup.'} Note: a stop-calls key can’t be combined with ${mode === 'otp' ? 'a code call' : mode === 'menu' ? 'a key menu' : 'this setup'}, so the script doesn’t offer one.`
          if (Array.isArray(j.summary)) j.summary = j.summary.filter(x => !wanted.test(String(x)))
        }
      }
    }
    const missing = Object.keys(patch).length && GAPS[screen] ? [...new Set(GAPS[screen]({ ...(current || {}), ...patch }, context, messages.filter(m => m.role !== 'assistant').map(m => m.content).join(' ').replace(/[^\w\s]/g, ''), current || {}))].slice(0, 6) : []
    const open = missing.filter(m => /\?\s*$/.test(m))
    if (open.length) return askFor(open)
    if (waits.length && Array.isArray(patch.options)) j.reply = `${str(j.reply, 740) || 'Here’s what I suggest.'} Note: key ${waits.join(' and ')} waits for your Accept or Decline in the app before going on (the caller holds up to 45 seconds). You can switch that off under the key.`
    const out = { reply: str(j.reply, 900) || 'Here’s what I suggest.', summary: Object.keys(patch).length ? summaryOf(j.summary, patch) : [], missing, patch }
    // IVR architect: attach a whole-flow readiness report so the owner sees what's still needed to work on a real call.
    if (screen === 'ivr' && Object.keys(patch).length) out.readiness = BP.readiness({ ...(current || {}), ...patch }, context)
    return out
  } catch (e) {
    console.log(`[Assist:${screen}] failed: ${e.response?.data?.error?.message || e.message}`)
    return null
  }
}

function routes(router, { h }) {
  // Whole-flow IVR architect: validate / simulate / blueprint a keypad menu (operates on the posted config only).
  router.post('/ivr/validate', h(async (req, res) => res.json(BP.validate(req.body?.ivr || {}, req.body?.context || {}))))
  router.post('/ivr/simulate', h(async (req, res) => res.json(BP.simulate(req.body?.ivr || {}, req.body?.context || {}))))
  router.post('/outbound/check', h(async (req, res) => res.json(BP.outbound(req.body?.kind === 'campaign' ? 'campaign' : 'quick', req.body?.config || {}, req.body?.context || {}))))
  router.post('/ivr/blueprint', h(async (req, res) => res.json(BP.blueprint(req.body?.ivr || {}, req.body?.context || {}))))
  router.post('/assist/:screen', h(async (req, res) => {
    if (!SCREENS[req.params.screen]) return res.status(404).json({ error: 'unknown_screen', message: 'This page has no setup assistant.' })
    const msgs = (Array.isArray(req.body?.messages) ? req.body.messages : []).filter(m => m && typeof m.content === 'string' && m.content.trim())
    if (!msgs.length || msgs[msgs.length - 1].role === 'assistant') return res.status(400).json({ error: 'no_message', message: 'Type a message.' })
    const ctx = req.body?.context && typeof req.body.context === 'object' ? req.body.context : null
    const r = await chat(req.params.screen, msgs, req.body?.current, ctx)
    if (!r) return res.status(503).json({ error: 'assist_failed', message: 'The assistant is busy right now. Try again in a moment.' })
    if (r.offTopic) require('../emily-guard').record(`assist:${req.params.screen}`, { chatId: req.webChatId, text: require('../emily-guard').lastUserText(msgs), reply: r.reply })
    res.json(r)
  }))
}

module.exports = { routes, clean, SCREENS, summaryOf, GAPS, invented }
