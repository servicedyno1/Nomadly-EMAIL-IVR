'use strict'
// Emily end-to-end check: a simulated owner (LLM with a fact sheet) chats with the setup assistant until she proposes,
// the proposal is applied like the page does, checked by the real validators and saved through the real API where possible.
// Usage: node scripts/emily_e2e.js [filter] [runs]   (preview only; restores the test number's menu afterwards)
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const axios = require('axios')
const fs = require('fs')
const BASE = `${fs.readFileSync(require('path').join(__dirname, '../frontend/.env'), 'utf8').match(/REACT_APP_BACKEND_URL=(.*)/)[1].trim()}/api/cloudivr-web`
const EMAIL = process.env.E2E_EMAIL || 'civr.alice@example.com', PASS = process.env.E2E_PASS || 'AliceTest#2026', NUM = process.env.E2E_NUM || '+13346970100'
const filter = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : '', RUNS = Number(process.argv[3]) || 1

const S = [
  // ── inbound keypad menus ──
  { id: 'ivr-bakery', screen: 'ivr', open: 'I run a bakery and I want people who call to pick what they need', facts: 'Business: Bella\'s Bakery. Orders go to +14155550101. Opening hours: Tuesday to Sunday 7am to 4pm, closed Monday. Address: 12 Mill Lane, Austin. If someone wants a person, ring my mobile +14155550102. You are not technical and answer briefly.', want: { actions: ['forward', 'message'] } },
  { id: 'ivr-vague', screen: 'ivr', open: 'help me set this up', facts: 'Business: Northside Dental. Appointments +14155550111. Billing questions +14155550112. Emergencies should leave a voicemail. You do not know what an IVR is.', want: { actions: ['forward', 'voicemail'] } },
  { id: 'ivr-team-queue', screen: 'ivr', open: 'Calls for support should go to whoever on my team is free, sales goes to me', facts: 'Business: Peak Software. Support team phones: +14155550121, +14155550122, +14155550123. Sales: +14155550124. If nobody on support answers after two minutes, take a voicemail.', want: { actions: ['queue', 'forward'] } },
  { id: 'ivr-deep', screen: 'ivr', open: 'I need press 1 for sales and press 2 for support. Under support they choose billing or technical, and under technical they choose internet or phone problems.', facts: 'Business: Metro Telecom. Sales +14155550131. Billing +14155550132. Internet problems +14155550133. Phone problems +14155550134.', want: { actions: ['submenu', 'forward'], depth: 2 } },
  { id: 'ivr-webhook-collect', screen: 'ivr', open: 'Press 1 should let callers type their order number so my system gets it, press 2 should notify my CRM that someone wants a call back', facts: 'Business: QuickParts. Order numbers have 6 digits. Order system address: https://api.quickparts.example/orders. CRM address: https://crm.quickparts.example/callback. After typing the order number the caller should hear that we will text them an update.', want: { actions: ['collect', 'webhook'] } },
  { id: 'ivr-pin-pay', screen: 'ivr', open: 'Members press 1 and enter a code to reach the VIP desk, press 2 gets a payment link by text', facts: 'Business: Harbor Club. Member code is 4821. VIP desk +14155550141. Payment page https://pay.harborclub.example/dues. You have one Texting Number (use it).', want: { actions: ['pin', 'pay'] } },
  { id: 'ivr-nontech', screen: 'ivr', open: 'my phone rings all day and half of them just want to know when we are open. can you make that stop', facts: 'Business: Sam\'s Auto Repair. Open Monday to Friday 8 to 6, Saturday 9 to 1. Real customers should reach me on +14155550151. You never use technical words.', want: { actions: ['message', 'forward'] } },
  // ── editing an existing menu ──
  { id: 'ivr-edit-keep', screen: 'ivr', open: 'Change key 2 so it rings +14155550162 instead', facts: 'Nothing else should change. Answer "yes" to any confirmation.', current: { greeting: 'Thanks for calling Lakeview Vets. Press 1 for appointments, press 2 for the pharmacy, press 3 for our hours, or press 0 to leave a message.', options: [{ digit: '1', action: 'forward', label: 'Appointments', forwardTo: '+14155550160' }, { digit: '2', action: 'forward', label: 'Pharmacy', forwardTo: '+14155550161' }, { digit: '3', action: 'message', label: 'Hours', message: 'We are open every day from 8am to 8pm.' }, { digit: '0', action: 'voicemail', label: 'Message' }] }, want: { keep: ['1', '3', '0'], changed: { digit: '2', forwardTo: '+14155550162' } } },
  { id: 'ivr-edit-add', screen: 'ivr', open: 'Add a key 4 for the grooming team — it should ring both groomers until one picks up', facts: 'Groomers: +14155550163 and +14155550164. If nobody answers, say we will call back. Nothing else should change.', current: { greeting: 'Thanks for calling Lakeview Vets. Press 1 for appointments, press 3 for our hours.', options: [{ digit: '1', action: 'forward', label: 'Appointments', forwardTo: '+14155550160' }, { digit: '3', action: 'message', label: 'Hours', message: 'We are open every day from 8am to 8pm.' }] }, want: { keep: ['1', '3'], actions: ['queue'] } },
  // ── quick calls ──
  { id: 'quick-reminder', screen: 'quick', open: 'Call +14155550171 and remind them about their appointment tomorrow at 3pm, press 1 to talk to us', facts: 'Business: Northside Dental. Connect them to +14155550172.', want: { mode: 'transfer', noStop: true } },
  { id: 'quick-vague', screen: 'quick', open: 'I want to call a customer', facts: 'Business: Sam\'s Auto Repair. Customer number +14155550173. Tell them their car is ready for pickup. If they press 1 connect them to me at +14155550174.', want: { mode: 'transfer', noStop: true } },
  { id: 'quick-code', screen: 'quick', open: 'Call +14155550175 and ask them to type the 6 digit code we sent so I can check it', facts: 'Business: Harbor Club. No connecting afterwards.', want: { mode: 'otp' } },
  { id: 'quick-menu', screen: 'quick', open: 'Call +14155550176: press 1 to confirm the delivery (connect to dispatch +14155550177), press 2 to hear our returns policy', facts: 'Business: QuickParts. Returns policy: items can be returned within 30 days with the receipt.', want: { mode: 'menu', noStop: true } },
  // ── campaigns ──
  { id: 'camp-transfer', screen: 'campaign', open: 'Announce our weekend sale to my customer list, press 1 to talk to sales at +14155550100', facts: 'Business: Bella\'s Bakery. 20% off all cakes Saturday and Sunday. Answer "yes" to confirmations.', want: { mode: 'transfer', stop: true } },
  { id: 'camp-menu', screen: 'campaign', open: 'Weekend sale announcement. Press 1 for sales at +14155550100, press 2 to hear our opening hours: nine to five every day.', facts: 'Business: Bella\'s Bakery. Answer "yes" to confirmations.', want: { mode: 'menu', noStop: true } },
  { id: 'camp-menu-stop', screen: 'campaign', open: 'Weekend sale announcement. Press 1 for sales at +14155550100, press 2 to hear our opening hours: nine to five every day. And let people press 9 to stop the calls.', facts: 'Business: Bella\'s Bakery. If told a stop key is not possible with a menu, say: keep the two keys then.', want: { mode: 'menu', noStop: true } },
  { id: 'camp-survey', screen: 'campaign', open: 'Survey my customers: press 1 if they were happy with the service, press 2 if not', facts: 'Business: Peak Software. Nobody needs to be connected.', want: { mode: 'report_only', stop: true } },
  { id: 'camp-vague', screen: 'campaign', open: 'I need to call a lot of people', facts: 'Business: Metro Telecom. Tell customers about a planned network upgrade on Friday night, service may drop for 10 minutes. No keys needed except a way to stop calls. You are not technical.', want: { stop: true } },
]

const http = axios.create({ baseURL: BASE, validateStatus: () => true, timeout: 60000 })
const openai = (messages) => axios.post('https://api.openai.com/v1/chat/completions', { model: 'gpt-4.1-mini', temperature: 0.5, messages }, { headers: { Authorization: `Bearer ${process.env.APP_OPEN_API_KEY}` }, timeout: 30000 }).then(r => r.data.choices[0].message.content.trim())
const owner = (s, chat) => openai([{ role: 'system', content: `You are a small business owner setting up your phone system by chatting with an assistant. Answer ONLY what the assistant just asked, in one or two short sentences, using these facts and nothing else:\n${s.facts}\nIf asked something the facts do not cover, say you don't know or to use whatever is usual. Never invent phone numbers or web addresses.` }, ...chat.map(m => ({ role: m.role === 'assistant' ? 'user' : 'assistant', content: m.content }))])
const flat = (opts, d = 0) => (opts || []).flatMap(o => [{ ...o, depth: d }, ...flat((o.subMenu || o).options && o.action === 'submenu' ? (o.subMenu || o).options : [], d + 1)])
const toObj = (list) => Object.fromEntries(list.map(({ digit, subMenu, ...o }) => [digit, { ...o, ...(o.action === 'submenu' ? { subMenu: { ...(subMenu || {}), options: toObj(subMenu?.options || []) } } : {}) }]))
const menuToApi = (rows) => Object.fromEntries((rows || []).map(r => [r.digit, r.action === 'forward' ? { action: 'forward', forwardTo: r.forwardTo, label: r.label } : r.action === 'message' ? { action: 'message', message: r.message, label: r.label } : { action: 'submenu', greeting: r.greeting, label: r.label, options: menuToApi(r.options) }]))

async function run(s, ctx, cookie) {
  const H = { headers: { cookie } }
  const fails = [], chat = [{ role: 'user', content: s.open }]
  let current = s.current ? JSON.parse(JSON.stringify(s.current)) : {}, proposal = null, turns = 0, last = null
  const context = s.screen === 'ivr' ? ctx.ivr : s.screen === 'quick' ? { callFrom: NUM, plan: 'Business', ownConfirmRejectMessages: true, canSchedule: true } : undefined
  while (turns < 5 && !proposal) {
    turns++
    const r = await http.post(`/assist/${s.screen}`, { messages: chat, current, context }, H)
    if (r.status !== 200) { fails.push(`assist HTTP ${r.status} ${r.data?.message || ''}`); break }
    last = r.data
    chat.push({ role: 'assistant', content: r.data.reply })
    if (Object.keys(r.data.patch || {}).length) { proposal = r.data; break }
    chat.push({ role: 'user', content: await owner(s, chat) })
  }
  if (!proposal) return { fails: fails.length ? fails : [`no proposal after ${turns} turns — last: ${last?.reply?.slice(0, 160)}`], turns, chat }
  const cfg = { ...current, ...proposal.patch }
  if (proposal.missing?.length) fails.push(`still needed: ${proposal.missing.join(' | ')}`)
  // nothing invented: every phone / web address in the proposal was given by the owner or was already in the form
  const known = [s.open, s.facts, JSON.stringify(s.current || {})].join(' ')
  for (const v of JSON.stringify(proposal.patch).match(/\+\d{8,15}|https:\/\/[^"\s\\]+/g) || []) if (!known.includes(v.replace(/[.,]$/, ''))) fails.push(`invented ${v}`)
  const script = String(cfg.script || cfg.greeting || '')
  const spoken = []; JSON.stringify(cfg, (k, v) => { if (typeof v === 'string' && ['script', 'greeting', 'message', 'smsText', 'payNote', 'prompt', 'failMessage'].includes(k)) spoken.push(v); return v })
  if (spoken.some(t => /\[(?!Business name\]|Name\])/.test(t)) || (s.screen === 'ivr' && spoken.some(t => /\[/.test(t)))) fails.push('bracket placeholder left in what callers hear')
  const ownerSaid = chat.filter(m => m.role === 'user').map(m => m.content).join(' ')
  const biz = (s.facts.match(/Business: ([^.]+)\./) || [])[1]
  if (biz && ownerSaid.includes(biz) && !spoken.join(' ').includes(biz.split("'")[0])) fails.push('did not use the business name the owner gave')
  // made-up facts: numbers of 2+ digits spoken to callers that the owner never gave
  const WORDS = { nine: 9, five: 5, 'six digit': 6, noon: 12 }
  const facts = `${s.open} ${s.facts} ${JSON.stringify(s.current || {})} ${Object.entries(WORDS).filter(([w]) => known.includes(w)).map(([, n]) => n).join(' ')}`
  for (const t of spoken) for (const n of t.replace(/\b\d+[- ]digit/gi, '').match(/\d{2,}/g) || []) if (!facts.includes(n) && !facts.includes(String(Number(n) + 12)) && !facts.includes(String(Number(n) - 12))) fails.push(`made-up detail "${n}" in: ${t.slice(0, 80)}`)
  let check
  if (s.screen === 'ivr') {
    const v = (await http.post('/ivr/validate', { ivr: cfg, context }, H)).data, t = (await http.post('/ivr/simulate', { ivr: cfg, context }, H)).data
    check = v
    for (const i of v.issues || []) if (i.level === 'error') fails.push(`check: ${i.where} — ${i.message}`)
    if (!t.ok) fails.push(`test my menu: ${t.failed} failing`)
    const all = flat(cfg.options)
    for (const a of s.want.actions || []) if (!all.some(o => o.action === a)) fails.push(`expected a "${a}" key`)
    if (s.want.depth && Math.max(...all.map(o => o.depth)) < s.want.depth) fails.push(`expected ${s.want.depth + 1} menu levels`)
    for (const d of s.want.keep || []) { const a = s.current.options.find(o => o.digit === d), b = (cfg.options || []).find(o => o.digit === d); if (!b || ['action', 'forwardTo', 'message', 'label'].some(k => (a[k] || '') !== (b[k] || ''))) fails.push(`key ${d} was changed or removed`) }
    if (s.want.changed) { const b = (cfg.options || []).find(o => o.digit === s.want.changed.digit); if (b?.forwardTo !== s.want.changed.forwardTo) fails.push(`key ${s.want.changed.digit} not updated`) }
    // real save + read-back (menu stays switched off)
    const put = await http.put(`/numbers/${encodeURIComponent(NUM)}/ivr`, { enabled: false, greeting: cfg.greeting, greetingAudioUrl: null, options: toObj(cfg.options || []), language: 'en' }, H)
    if (put.status !== 200) fails.push(`SAVE refused: ${put.data?.message}`)
    else if (JSON.stringify(Object.keys(put.data.ivr.options).sort()) !== JSON.stringify((cfg.options || []).map(o => o.digit).sort())) fails.push('saved menu differs from the proposal')
  } else {
    const kind = s.screen === 'campaign' ? 'campaign' : 'quick'
    const r = (await http.post('/outbound/check', { kind, config: cfg, context: { contacts: 3 } }, H)).data
    check = r.validation
    for (const i of r.validation.issues || []) if (i.level === 'error') fails.push(`check: ${i.where} — ${i.message}`)
    if (!r.test.ok) fails.push(`walk-through: ${r.test.failed} failing`)
    if (s.want.mode && cfg.mode !== s.want.mode) fails.push(`mode ${cfg.mode}, expected ${s.want.mode}`)
    if (s.want.stop && !cfg.stopKey) fails.push('no stop-calls key on a campaign')
    if (s.want.noStop && cfg.stopKey) fails.push(`unexpected stop key ${cfg.stopKey}`)
    if (kind === 'campaign') {
      const body = { name: cfg.name || 'E2E', mode: cfg.mode || 'report_only', transferNumber: cfg.transferNumber, transferBackups: cfg.transferBackups, activeKeys: cfg.activeKeys, stopKey: cfg.mode === 'menu' ? undefined : (cfg.stopKey || undefined), menu: cfg.mode === 'menu' ? menuToApi(cfg.menu) : undefined, concurrency: cfg.concurrency || 1, holdMusic: !!cfg.holdMusic, callerId: NUM, leads: '+14155550190\n+14155550191', validateOnly: true, audioPending: true }
      const v = await http.post('/campaigns', body, H)
      if (v.status !== 200) fails.push(`SAVE check refused (${v.status} ${v.data?.error}): ${v.data?.message}`)
    }
  }
  return { fails, turns, chat, cfg, warnings: (check?.issues || []).filter(i => i.level === 'warn').map(i => i.message) }
}

;(async () => {
  const login = await http.post('/auth/login', { email: EMAIL, password: PASS })
  if (login.status !== 200) throw new Error(`login failed ${login.status} ${JSON.stringify(login.data)}`)
  const cookie = login.headers['set-cookie'].map(c => c.split(';')[0]).join('; ')
  const H = { headers: { cookie } }
  const mn = (await http.get('/mobile-numbers', H)).data
  const textingNumbers = (mn.items || []).filter(x => ['provisioning', 'active'].includes(x.status)).map(x => ({ id: x.id, phone: x.phoneNumber || 'being assigned', kind: 'Texting Number' }))
  const ctx = { ivr: { number: NUM, plan: 'Business', voicemailAvailable: true, keypadMenuOn: false, textingNumbers } }
  const nums = (await http.get('/numbers', H)).data
  const before = (nums.numbers || nums.items || []).find(n => n.phoneNumber === NUM)?.features?.ivr
  const list = S.filter(s => !filter || s.id.includes(filter) || s.screen === filter)
  let pass = 0, total = 0
  const out = []
  for (const s of list) for (let i = 0; i < RUNS; i++) {
    total++
    let r
    try { r = await run(s, ctx, cookie) } catch (e) { r = { fails: [`crashed: ${e.message}`], turns: 0, chat: [] } }
    if (!r.fails.length) pass++
    console.log(`${r.fails.length ? 'FAIL' : 'PASS'} ${s.id}${RUNS > 1 ? `#${i + 1}` : ''} — proposal after ${r.turns} turn(s)${r.fails.length ? `\n   - ${r.fails.join('\n   - ')}` : ''}`)
    if (r.fails.length || process.env.E2E_VERBOSE) console.log(`   said: ${JSON.stringify(r.cfg?.script || r.cfg?.greeting || '')}\n   chat: ${r.chat.map(m => `${m.role === 'user' ? 'OWNER' : 'EMILY'}: ${m.content}`).join('\n         ').slice(0, 1400)}`)
    out.push({ id: s.id, run: i + 1, ...r })
  }
  if (before) { const r = await http.put(`/numbers/${encodeURIComponent(NUM)}/ivr`, before, H); console.log(`menu restored: ${r.status}`) }
  fs.writeFileSync('/tmp/emily_e2e.json', JSON.stringify(out, null, 1))
  console.log(`\n${pass}/${total} conversations ended in a complete, valid${filter === 'quick' ? '' : ', saveable'} setup`)
  process.exit(0)
})().catch(e => { console.error(e.message); process.exit(1) })
