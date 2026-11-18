'use strict'
// Renewal calendar: every upcoming charge on an account by date (plans, extra numbers, Texting Numbers, eSIMs,
// fax numbers), what the wallet covers, and the low-wallet reminder sent 3 days and 1 day before a charge it can't cover.
const lifecycle = require('./plan-lifecycle')
const phoneConfig = require('./phone-config')

const DAY = 86400000
const round2 = (x) => Math.round(Number(x) * 100) / 100
const iso = (d) => new Date(d).toISOString()
const nextMonth = (d) => { const x = new Date(d); x.setMonth(x.getMonth() + 1); return x }
const ids = (chatId) => [...new Set([String(chatId), Number(chatId)].filter(x => x === x))]
const LIVE_LINE = ['active', 'past_due', 'suspended']

async function load(db, chatId) {
  const id = { $in: ids(chatId) }
  const [doc, lines, hosted, fax] = await Promise.all([
    db.collection('phoneNumbersOf').findOne({ _id: id }),
    db.collection('esimLines').find({ chatId: id, status: { $in: LIVE_LINE } }).toArray(),
    db.collection('hostedSms').find({ chatId: id, status: { $in: ['active', 'paused'] }, planNumber: null }).toArray(),
    db.collection('faxNumbers').find({ chatId: id, status: { $in: ['active', 'past_due'] } }).toArray(),
  ])
  return { numbers: (doc?.val?.numbers || []).filter(n => n.status !== 'released'), lines, hosted, fax }
}

// → entries sorted by date: { date, type: 'charge'|'ends', kind, phone, title, amount, parts?, projected? }
function entries({ numbers = [], lines = [], hosted = [], fax = [] }, now = new Date(), days = 90) {
  const end = new Date(now.getTime() + days * DAY), out = []
  const at = (d) => (new Date(d) < now ? now : new Date(d))
  const add = (e) => { if (e.date <= end) out.push({ ...e, date: iso(e.date), amount: round2(e.amount || 0) }) }
  // A monthly charge, repeated to the end of the window (later ones are estimates).
  const monthly = (first, e, nextAmount = e.amount, nextParts = e.parts) => {
    add({ ...e, type: 'charge', date: at(first) })
    for (let d = nextMonth(at(first)); d <= end; d = nextMonth(d)) add({ ...e, type: 'charge', date: d, amount: nextAmount, parts: nextParts, projected: true })
  }
  const planName = (n) => phoneConfig.plans[n.plan]?.name || n.plan || 'Plan'

  for (const n of numbers) {
    if (!n.expiresAt || n.replacedBy || lifecycle.isInternalTest?.(n)) continue
    if (n.status === 'suspended' && n._holdUntil) { add({ type: 'ends', kind: n.isSubNumber ? 'extra' : 'plan', phone: n.phoneNumber, title: 'On hold — released unless restored', date: at(n._holdUntil) }); continue }
    if (n.status !== 'active') continue
    const main = n.isSubNumber ? numbers.find(x => x.phoneNumber === n.parentNumber && !x.isSubNumber && x.status === 'active') : null
    if (n.isSubNumber && main) continue // handled with its main number
    const price = lifecycle.renewalPrice(n) || 0
    if (n.isSubNumber) { // extra number whose main number is gone: bills on its own
      if (n.autoRenew !== false) monthly(n.expiresAt, { kind: 'extra', phone: n.phoneNumber, title: 'Extra number', amount: price })
      else add({ type: 'ends', kind: 'extra', phone: n.phoneNumber, title: 'Extra number ends', date: at(n.expiresAt) })
      continue
    }
    const g = lifecycle.groupRenewal(numbers, n)
    if (!g.autoRenew) { add({ type: 'ends', kind: 'plan', phone: n.phoneNumber, title: `${planName(n)} plan ends${g.extras.length ? ` with its ${g.extras.length} extra number${g.extras.length === 1 ? '' : 's'}` : ''}`, date: at(n.expiresAt) }); continue }
    const renewing = g.extras.filter(e => e.autoRenew)
    const part = (e) => ({ label: 'Extra number', phone: e.phoneNumber, amount: round2(e.price || 0) })
    const head = { label: `${planName(n)} plan`, phone: n.phoneNumber, amount: round2(g.main || 0) }
    const title = (k) => `${planName(n)} plan${k ? ` + ${k} extra number${k === 1 ? '' : 's'}` : ''}`
    const onDate = renewing.filter(e => e.onPlanDate)
    monthly(n.expiresAt, { kind: 'plan', phone: n.phoneNumber, title: title(onDate.length), amount: g.total, parts: [head, ...onDate.map(part)] },
      round2((g.main || 0) + renewing.reduce((t, e) => t + (e.price || 0), 0)), [head, ...renewing.map(part)])
    for (const e of g.later) add({ type: 'charge', kind: 'extra', phone: e.phoneNumber, title: 'Extra number — days up to the plan date', amount: e.firstPrice, date: at(e.expiresAt), parent: n.phoneNumber })
    for (const e of g.extras.filter(x => !x.autoRenew)) add({ type: 'ends', kind: 'extra', phone: e.phoneNumber, title: 'Extra number ends', date: at(e.expiresAt), parent: n.phoneNumber })
  }
  for (const d of lines) {
    const kind = d.kind === 'mobile' ? 'texting' : 'esim', title = kind === 'texting' ? 'USA Texting Number' : 'USA eSIM', price = Number(d.price) || 0
    if (!d.expiresAt || !(price > 0)) continue
    if (d.autoRenew !== false) monthly(d.nextBillAt || d.expiresAt, { kind, phone: d.phoneNumber || null, title, amount: price, id: String(d._id) })
    else add({ type: 'ends', kind, phone: d.phoneNumber || null, title: `${title} ends`, date: at(d.expiresAt), id: String(d._id) })
  }
  for (const d of hosted) {
    const price = Number(require('./hosted-sms.js').pub(d).monthly) || 0
    if (d.nextBillAt && price > 0) monthly(d.nextBillAt, { kind: 'texting', phone: d.phoneNumber, title: 'Landline texting', amount: price })
  }
  for (const d of fax) {
    if (!d.expiresAt) continue
    if (d.autoRenew !== false) monthly(d.expiresAt, { kind: 'fax', phone: d.phoneNumber, title: 'Fax number', amount: Number(d.price) || 0 })
    else add({ type: 'ends', kind: 'fax', phone: d.phoneNumber, title: 'Fax number ends', date: at(d.expiresAt) })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount)
}

// Walks the charges in date order against the wallet: which ones it covers, and how much is missing.
function summarize(list, balance, now = new Date()) {
  let left = round2(balance)
  const rows = list.map(e => {
    if (e.type !== 'charge') return e
    left = round2(left - e.amount)
    return { ...e, covered: left >= 0, walletAfter: left }
  })
  const charges = rows.filter(e => e.type === 'charge')
  const due = (d) => round2(charges.filter(e => new Date(e.date) - now <= d * DAY).reduce((t, e) => t + e.amount, 0))
  const months = []
  for (const e of charges) { const k = e.date.slice(0, 7); let m = months.find(x => x.month === k); if (!m) months.push(m = { month: k, total: 0, count: 0 }); m.total = round2(m.total + e.amount); m.count++ }
  const firstShort = charges.find(e => !e.covered) || null
  return { balance: round2(balance), entries: rows, months, due7: due(7), due30: due(30), shortBy30: round2(Math.max(0, due(30) - balance)), firstShort: firstShort ? { date: firstShort.date, title: firstShort.title, phone: firstShort.phone, amount: firstShort.amount } : null }
}

async function forAccount(db, chatId, { now = new Date(), days = 90 } = {}) {
  const [src, w] = await Promise.all([load(db, chatId), db.collection('walletOf').findOne({ _id: { $in: ids(chatId) } })])
  return summarize(entries(src, now, days), (w?.usdIn || 0) - (w?.usdOut || 0), now)
}

// Low wallet in the next 3 days → { stage: 3|1, date, due, balance, shortBy, first } or null when the wallet covers everything.
function shortSoon(cal, now = new Date()) {
  const soon = cal.entries.filter(e => e.type === 'charge' && !e.projected && new Date(e.date) - now <= 3 * DAY)
  const first = soon.find(e => !e.covered)
  if (!first) return null
  const due = round2(soon.reduce((t, e) => t + e.amount, 0))
  return { stage: new Date(first.date) - now <= DAY ? 1 : 3, date: first.date, due, balance: cal.balance, shortBy: round2(due - cal.balance), first, count: soon.length }
}

const fmt = (n) => `$${Number(n || 0).toFixed(2)}`
const shortDay = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
const KIND_ICON = { plan: '📞', extra: '➕', texting: '💬', esim: '📱', fax: '📠' }
const L = {
  en: { title: '📅 <b>Renewal calendar</b>', none: 'Nothing renews in the next 60 days.', wallet: 'Wallet', due: 'Due in the next 30 days', short: (x, d) => `⚠️ Your wallet is <b>${x}</b> short for the charge on ${d}. Top up to keep everything running.`, ok: '✅ Your wallet covers every charge in the next 30 days.', ends: 'ends — not renewed', est: 'est.', lowTitle: (n) => (n === 1 ? '🚨 <b>Renewal tomorrow — wallet too low</b>' : '🔔 <b>Renewal in 3 days — wallet too low</b>'), lowBody: (s) => `Charges due by ${shortDay(s.date)}: <b>${fmt(s.due)}</b>\nWallet: ${fmt(s.balance)}\nMissing: <b>${fmt(s.shortBy)}</b>\n\nTop up before then, or the lines that can't renew are paused.` },
  fr: { title: '📅 <b>Calendrier des renouvellements</b>', none: 'Aucun renouvellement dans les 60 prochains jours.', wallet: 'Portefeuille', due: 'À payer dans les 30 prochains jours', short: (x, d) => `⚠️ Il manque <b>${x}</b> dans votre portefeuille pour le paiement du ${d}. Rechargez pour que tout continue de fonctionner.`, ok: '✅ Votre portefeuille couvre tous les paiements des 30 prochains jours.', ends: 'se termine — non renouvelé', est: 'est.', lowTitle: (n) => (n === 1 ? '🚨 <b>Renouvellement demain — portefeuille insuffisant</b>' : '🔔 <b>Renouvellement dans 3 jours — portefeuille insuffisant</b>'), lowBody: (s) => `À payer d'ici le ${shortDay(s.date)} : <b>${fmt(s.due)}</b>\nPortefeuille : ${fmt(s.balance)}\nManquant : <b>${fmt(s.shortBy)}</b>\n\nRechargez avant cette date, sinon les lignes non renouvelées sont mises en pause.` },
  zh: { title: '📅 <b>续费日历</b>', none: '未来 60 天内没有续费。', wallet: '钱包', due: '未来 30 天应付', short: (x, d) => `⚠️ 您的钱包还差 <b>${x}</b> 才能支付 ${d} 的费用。请充值以保持服务运行。`, ok: '✅ 您的钱包足以支付未来 30 天的所有费用。', ends: '到期 — 不续费', est: '预计', lowTitle: (n) => (n === 1 ? '🚨 <b>明天续费 — 钱包余额不足</b>' : '🔔 <b>3 天后续费 — 钱包余额不足</b>'), lowBody: (s) => `${shortDay(s.date)} 前应付：<b>${fmt(s.due)}</b>\n钱包：${fmt(s.balance)}\n还差：<b>${fmt(s.shortBy)}</b>\n\n请在此之前充值，否则无法续费的线路将被暂停。` },
  hi: { title: '📅 <b>रिन्यूअल कैलेंडर</b>', none: 'अगले 60 दिनों में कोई रिन्यूअल नहीं है।', wallet: 'वॉलेट', due: 'अगले 30 दिनों में देय', short: (x, d) => `⚠️ ${d} के शुल्क के लिए आपके वॉलेट में <b>${x}</b> कम हैं। सब कुछ चालू रखने के लिए टॉप अप करें।`, ok: '✅ आपका वॉलेट अगले 30 दिनों के सभी शुल्क कवर करता है।', ends: 'समाप्त — रिन्यू नहीं होगा', est: 'अनुमानित', lowTitle: (n) => (n === 1 ? '🚨 <b>कल रिन्यूअल — वॉलेट में पैसे कम</b>' : '🔔 <b>3 दिन में रिन्यूअल — वॉलेट में पैसे कम</b>'), lowBody: (s) => `${shortDay(s.date)} तक देय: <b>${fmt(s.due)}</b>\nवॉलेट: ${fmt(s.balance)}\nकमी: <b>${fmt(s.shortBy)}</b>\n\nउससे पहले टॉप अप करें, वरना जो लाइनें रिन्यू नहीं हो पाएँगी वे रोक दी जाएँगी।` },
  fa: { title: '📅 <b>تقویم تمدید</b>', none: 'در ۶۰ روز آینده تمدیدی وجود ندارد.', wallet: 'کیف پول', due: 'قابل پرداخت در ۳۰ روز آینده', short: (x, d) => `⚠️ کیف پول شما برای هزینه ${d} به اندازه <b>${x}</b> کم دارد. برای ادامه کار همه چیز شارژ کنید.`, ok: '✅ کیف پول شما همه هزینه‌های ۳۰ روز آینده را پوشش می‌دهد.', ends: 'پایان — تمدید نمی‌شود', est: 'تخمینی', lowTitle: (n) => (n === 1 ? '🚨 <b>تمدید فردا — موجودی کیف پول کافی نیست</b>' : '🔔 <b>تمدید در ۳ روز — موجودی کیف پول کافی نیست</b>'), lowBody: (s) => `قابل پرداخت تا ${shortDay(s.date)}: <b>${fmt(s.due)}</b>\nکیف پول: ${fmt(s.balance)}\nکمبود: <b>${fmt(s.shortBy)}</b>\n\nقبل از آن شارژ کنید، وگرنه خط‌هایی که تمدید نشوند متوقف می‌شوند.` },
}
const T = (lang) => L[lang] || L.en
const BUTTONS = { en: '📅 Renewal Calendar', fr: '📅 Calendrier', zh: '📅 续费日历', hi: '📅 रिन्यूअल कैलेंडर', fa: '📅 تقویم تمدید' }
const isButton = (msg) => Object.values(BUTTONS).includes(String(msg || '').trim()) || /^\/renewals\b/.test(String(msg || ''))

// Bot view: the next 60 days as a dated list.
function botText(cal, lang = 'en', now = new Date()) {
  const t = T(lang), rows = cal.entries.filter(e => new Date(e.date) - now <= 60 * DAY)
  if (!rows.length) return `${t.title}\n\n${t.none}`
  const lines = rows.slice(0, 40).map(e => `${e.type === 'ends' ? '⏹' : e.covered ? '✅' : '⚠️'} <b>${shortDay(e.date)}</b> · ${KIND_ICON[e.kind] || '•'} ${e.title}${e.phone ? ` · <code>${e.phone}</code>` : ''} — ${e.type === 'ends' ? t.ends : `<b>${fmt(e.amount)}</b>${e.projected ? ` (${t.est})` : ''}`}`)
  const foot = cal.firstShort && new Date(cal.firstShort.date) - now <= 30 * DAY ? t.short(fmt(cal.shortBy30), shortDay(cal.firstShort.date)) : t.ok
  return `${t.title}\n\n${lines.join('\n')}\n\n💰 ${t.wallet}: <b>${fmt(cal.balance)}</b>\n🧾 ${t.due}: <b>${fmt(cal.due30)}</b>\n${foot}`
}

// Hourly: one notice per account per charge date, 3 days before and again the day before — only while the wallet is short.
async function remind({ db, bot, lang = async () => 'en', log = console.log, now = new Date() }) {
  const notices = db.collection('renewalShortNotices')
  notices.createIndex({ at: 1 }, { expireAfterSeconds: 45 * 86400 }).catch(() => {})
  const soon = new Date(now.getTime() + 3 * DAY)
  const [a, b, c, d] = await Promise.all([
    db.collection('phoneNumbersOf').find({ 'val.numbers': { $elemMatch: { status: 'active', expiresAt: { $lte: soon.toISOString() } } } }, { projection: { _id: 1 } }).toArray(),
    db.collection('esimLines').distinct('chatId', { status: { $in: LIVE_LINE }, autoRenew: { $ne: false }, $or: [{ nextBillAt: { $lte: soon } }, { expiresAt: { $lte: soon } }] }),
    db.collection('hostedSms').distinct('chatId', { status: { $in: ['active', 'paused'] }, planNumber: null, nextBillAt: { $lte: soon } }),
    db.collection('faxNumbers').distinct('chatId', { status: { $in: ['active', 'past_due'] }, autoRenew: { $ne: false }, expiresAt: { $lte: soon.toISOString() } }),
  ])
  let sent = 0
  for (const chatId of new Set([...a.map(x => x._id), ...b, ...c, ...d].map(String))) {
    try {
      const s = shortSoon(await forAccount(db, chatId, { now, days: 4 }), now)
      if (!s) continue
      try { await notices.insertOne({ _id: `${chatId}:${s.date.slice(0, 10)}:${s.stage}`, chatId, at: now, shortBy: s.shortBy }) } catch (e) { if (e.code === 11000) continue; throw e }
      const t = T(await lang(chatId))
      await bot.sendMessage(chatId, `${t.lowTitle(s.stage)}\n\n${t.lowBody(s)}`, { parse_mode: 'HTML', reply_markup: require('./renewal-topup').depositKeyboard(s.shortBy) })?.catch?.(e => log(`[RenewalCalendar] send to ${chatId}: ${e.message}`))
      sent++
    } catch (e) { log(`[RenewalCalendar] ${chatId}: ${e.message}`) }
  }
  if (sent) log(`[RenewalCalendar] ${sent} low-wallet renewal reminder(s) sent`)
  return sent
}

// ── Live calendar link (Google / Apple / Outlook subscribe to it; it refreshes on its own) ──
const feeds = (db) => db.collection('calendarFeeds')
async function feedToken(db, chatId, rotate = false) {
  const id = String(chatId)
  if (rotate) await feeds(db).deleteMany({ chatId: id })
  else { const f = await feeds(db).findOne({ chatId: id }); if (f) return f._id }
  const token = require('crypto').randomBytes(24).toString('hex')
  await feeds(db).insertOne({ _id: token, chatId: id, at: new Date() })
  return token
}
function feedLinks(token) {
  const url = `${String(process.env.SELF_URL || '').replace(/\/+$/, '')}/calendar/${token}.ics`
  const webcal = url.replace(/^https?:\/\//, 'webcal://')
  return { url, webcal, google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}` }
}
const links = async (db, chatId, rotate = false) => feedLinks(await feedToken(db, chatId, rotate))

const icsText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const fold = (line) => { const out = []; let x = line; while (Buffer.byteLength(x) > 74) { let n = 74; while (Buffer.byteLength(x.slice(0, n)) > 74) n--; out.push(x.slice(0, n)); x = ' ' + x.slice(n) } out.push(x); return out.join('\r\n') }
const ymd = (d) => new Date(d).toISOString().slice(0, 10).replace(/-/g, '')
const stamp = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

// iCalendar text: one all-day event per charge / end date, with a reminder the day before.
function ics(cal, { name = 'Renewals', now = new Date() } = {}) {
  const L2 = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//CloudIVR//Renewal calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(name)}`, 'X-WR-CALDESC:Upcoming charges and end dates', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H', 'X-PUBLISHED-TTL:PT6H']
  for (const e of cal.entries) {
    const end = new Date(new Date(e.date).getTime() + DAY)
    const uid = require('crypto').createHash('sha1').update(`${e.type}|${e.kind}|${e.phone || e.id || ''}|${e.title}|${e.date.slice(0, 10)}`).digest('hex')
    const summary = e.type === 'ends' ? `${e.title}${e.phone ? ` · ${e.phone}` : ''}` : `${fmt(e.amount)} renewal · ${e.title}${e.phone ? ` · ${e.phone}` : ''}`
    const desc = [e.type === 'ends' ? 'Not renewed — it ends on this date.' : `${fmt(e.amount)} is charged from your wallet on this date${e.projected ? ' (estimate from today’s prices)' : ''}.`,
      e.parts?.length > 1 ? e.parts.map(x => `${x.label}${x.phone ? ` ${x.phone}` : ''}: ${fmt(x.amount)}`).join('\n') : '',
      e.type === 'charge' ? (e.covered ? 'Your wallet covers it today.' : `Your wallet is short for this charge today — top up before ${shortDay(e.date)}.`) : ''].filter(Boolean).join('\n')
    L2.push('BEGIN:VEVENT', `UID:${uid}@renewals`, `DTSTAMP:${stamp(now)}`, `DTSTART;VALUE=DATE:${ymd(e.date)}`, `DTEND;VALUE=DATE:${ymd(end)}`, `SUMMARY:${icsText(summary)}`, `DESCRIPTION:${icsText(desc)}`, 'TRANSP:TRANSPARENT')
    if (e.type === 'charge' && !e.projected) L2.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-P1D', `DESCRIPTION:${icsText(summary)}`, 'END:VALARM')
    L2.push('END:VEVENT')
  }
  L2.push('END:VCALENDAR')
  return L2.map(fold).join('\r\n') + '\r\n'
}

// Public feed for a token → iCalendar text, or null for an unknown / reset link.
async function feed(db, token, now = new Date()) {
  if (!/^[a-f0-9]{48}$/.test(String(token || ''))) return null
  const f = await feeds(db).findOne({ _id: String(token) })
  if (!f) return null
  const web = require('./cloudivr-web/notify').isWebChatId(f.chatId)
  return ics(await forAccount(db, f.chatId, { now, days: 180 }), { name: web ? 'CloudIVR renewals' : 'Number renewals', now })
}

const FEED = {
  en: { google: '📅 Add to Google Calendar', text: (u) => `🍎 <b>Apple / Outlook / other calendars:</b> subscribe to this private link (it updates on its own):\n<code>${u}</code>\n<i>iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.</i>` },
  fr: { google: '📅 Ajouter à Google Agenda', text: (u) => `🍎 <b>Apple / Outlook / autres agendas :</b> abonnez-vous à ce lien privé (il se met à jour tout seul) :\n<code>${u}</code>\n<i>iPhone : Réglages → Calendrier → Comptes → Ajouter un compte → Autre → Ajouter un calendrier avec abonnement.</i>` },
  zh: { google: '📅 添加到 Google 日历', text: (u) => `🍎 <b>Apple / Outlook / 其他日历：</b>订阅这个私人链接（会自动更新）：\n<code>${u}</code>\n<i>iPhone：设置 → 日历 → 账户 → 添加账户 → 其他 → 添加已订阅的日历。</i>` },
  hi: { google: '📅 Google Calendar में जोड़ें', text: (u) => `🍎 <b>Apple / Outlook / अन्य कैलेंडर:</b> इस निजी लिंक को सब्सक्राइब करें (यह अपने आप अपडेट होता है):\n<code>${u}</code>\n<i>iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.</i>` },
  fa: { google: '📅 افزودن به Google Calendar', text: (u) => `🍎 <b>Apple / Outlook / تقویم‌های دیگر:</b> این لینک خصوصی را مشترک شوید (خودش به‌روز می‌شود):\n<code>${u}</code>\n<i>iPhone: Settings → Calendar → Accounts → Add Account → Other → Add Subscribed Calendar.</i>` },
}
// Bot: the calendar text plus the live-link part and its Google button.
async function botView(db, chatId, lang = 'en', now = new Date()) {
  const cal = await forAccount(db, chatId, { now }), l = await links(db, chatId), f = FEED[lang] || FEED.en
  return { text: `${botText(cal, lang, now)}\n\n${f.text(l.webcal)}`, opts: { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: f.google, url: l.google }]] } } }
}

module.exports = { load, entries, summarize, forAccount, shortSoon, botText, botView, remind, BUTTONS, isButton, feedToken, feedLinks, links, ics, feed }
