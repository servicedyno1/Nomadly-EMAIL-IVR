'use strict'
// Fax numbers sold per country / brand since the launch announcement (all brands via RESELLER_DBS) + a daily admin email.
const { MongoClient } = require('mongodb')

const LAUNCH_ID = 'fax-launch-2026-11'
const resellers = () => { try { return JSON.parse(process.env.RESELLER_DBS || '[]') } catch (_) { return [] } }
const clients = {}
const resellerDb = async (r) => { if (!clients[r.key]) clients[r.key] = MongoClient.connect(r.url, { serverSelectionTimeoutMS: 8000 }); return (await clients[r.key]).db(r.db) }
const nameOf = (cc) => { try { return require('./number-catalog').nameOf(cc) || cc } catch (_) { return cc } }
const dayOf = (d) => new Date(d).toISOString().slice(0, 10)

async function report(db) {
  const first = await db.collection('announcements').find({ id: LAUNCH_ID }).sort({ at: 1 }).limit(1).next()
  const since = first?.at || new Date(Date.now() - 30 * 864e5)
  const rows = [], brands = []
  for (const src of [{ name: process.env.CHAT_BOT_BRAND || 'CloudIVR', d: db }, ...resellers().map(r => ({ name: r.name || r.key, r }))]) {
    try {
      const d = src.d || await resellerDb(src.r)
      const got = await d.collection('faxNumbers').find({ dryRun: { $ne: true } }).project({ country: 1, status: 1, price: 1, createdAt: 1, chatId: 1 }).toArray()
      rows.push(...got.map(n => ({ ...n, brand: src.name })))
      brands.push({ name: src.name, sold: got.length, soldSince: got.filter(n => new Date(n.createdAt) >= since).length, active: got.filter(n => !['released', 'pending_registration'].includes(n.status)).length })
    } catch (e) { brands.push({ name: src.name, error: true }) }
  }
  const by = {}
  for (const n of rows) {
    const c = by[n.country] || (by[n.country] = { country: n.country, name: nameOf(n.country), sold: 0, soldSince: 0, active: 0, pending: 0, released: 0, monthly: 0 })
    c.sold += 1
    if (new Date(n.createdAt) >= since) c.soldSince += 1
    if (n.status === 'released') c.released += 1; else if (n.status === 'pending_registration') c.pending += 1; else { c.active += 1; c.monthly += Number(n.price) || 0 }
  }
  const countries = Object.values(by).sort((a, b) => b.soldSince - a.soldSince || b.sold - a.sold)
  const sum = (k) => countries.reduce((t, c) => t + c[k], 0)
  const recent = rows.filter(n => n.createdAt && new Date(n.createdAt) >= since)
  const days = []
  for (let t = Date.parse(dayOf(Date.now())); t >= Date.parse(dayOf(since)); t -= 864e5) {
    const date = dayOf(t), list = recent.filter(n => dayOf(n.createdAt) === date)
    const count = (key, label) => Object.values(list.reduce((m, n) => { const k = n[key]; m[k] = m[k] || { id: k, name: label(k), n: 0 }; m[k].n++; return m }, {})).sort((a, b) => b.n - a.n)
    days.push({ date, total: list.length, countries: count('country', nameOf), brands: count('brand', (b) => b) })
  }
  return { since, announced: !!first, countries, brands, days, totals: { sold: sum('sold'), soldSince: sum('soldSince'), active: sum('active'), pending: sum('pending'), released: sum('released'), monthly: sum('monthly'), buyers: new Set(recent.map(n => n.chatId)).size } }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
function emailHtml(r, date) {
  const day = r.days.find(d => d.date === date) || { total: 0, countries: [], brands: [] }
  const li = (xs) => xs.length ? `<ul>${xs.map(x => `<li>${esc(x.name)}: ${x.n}</li>`).join('')}</ul>` : '<p>None.</p>'
  const daily = r.days.map(d => `<tr><td>${d.date}</td><td style="text-align:right">${d.total}</td><td>${esc(d.countries.map(c => `${c.name} ${c.n}`).join(', ') || '—')}</td><td>${esc(d.brands.map(b => `${b.name} ${b.n}`).join(', ') || '—')}</td></tr>`).join('')
  return `<p><b>${day.total} fax number${day.total === 1 ? '' : 's'} sold on ${date}</b> (UTC).</p><p><b>By country</b></p>${li(day.countries)}<p><b>By brand</b></p>${li(day.brands)}`
    + `<p><b>Since launch (${dayOf(r.since)}):</b> ${r.totals.soldSince} sold · ${r.totals.active} live · ${r.totals.pending} waiting for carrier · $${r.totals.monthly.toFixed(2)}/month in fees.</p>`
    + `<table cellpadding="6" style="border-collapse:collapse;font-size:13px"><tr><th align="left">Day</th><th>Sold</th><th align="left">Countries</th><th align="left">Brands</th></tr>${daily}</table>`
}

// Sends yesterday's summary once per day, after 08:00 UTC. Only the main app (it sees every brand via RESELLER_DBS) sends.
async function dailyTick(db, log = console.log, now = new Date()) {
  if (now.getUTCHours() < 8) return null
  const date = dayOf(now.getTime() - 864e5)
  const claim = await db.collection('adminReports').updateOne({ _id: `fax-sales-daily:${date}` }, { $setOnInsert: { at: new Date() } }, { upsert: true })
  if (!claim.upsertedCount) return null
  const r = await report(db)
  const day = r.days.find(d => d.date === date)
  const ok = await require('./admin-mail').adminMail(`Fax sales ${date}: ${day?.total || 0} sold · ${r.totals.soldSince} since launch`, emailHtml(r, date))
  log(`[FaxSales] daily email for ${date}: ${day?.total || 0} sold, sent=${ok}`)
  return { date, sold: day?.total || 0, sent: ok }
}

function start({ db, log = console.log }) {
  if (process.env.FAX_SALES_EMAIL === 'false') return
  if (!resellers().length) return
  require('./active-slot').singletonInterval('fax-sales-daily', () => dailyTick(db, log).catch(e => log(`[FaxSales] ${e.message}`)), 15 * 60000)
}

module.exports = { report, dailyTick, emailHtml, start }
