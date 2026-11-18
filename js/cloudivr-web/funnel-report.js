'use strict'
// Daily CloudIVR web funnel summary to the admin in Telegram (08:00 UTC): last 24 h vs the 7-day daily average.
const { isWebChatId } = require('./notify')

const HOUR = Number(process.env.FUNNEL_REPORT_HOUR_UTC || 8)
const DAY = 864e5

async function counts(db, from, to) {
  const at = (f) => ({ [f]: { $gte: from, $lt: to } })
  const web = (rows, k = 'chatId') => rows.filter(r => isWebChatId(r[k]))
  const [signups, trials, deposits, topups, orders, failed] = await Promise.all([
    db.collection('webAccounts').countDocuments(at('createdAt')),
    db.collection('webQuickCalls').countDocuments({ trial: true, ...at('at') }),
    db.collection('webDeposits').find(at('createdAt'), { projection: { chatId: 1 } }).toArray(),
    db.collection('transactions').find({ type: 'wallet-topup', ...at('createdAt') }, { projection: { chatId: 1 } }).toArray(),
    db.collection('webNumberOrders').countDocuments({ status: 'active', ...at('createdAt') }),
    db.collection('webNumberOrders').countDocuments({ status: 'failed', ...at('createdAt') }),
  ])
  return { signups, trials, payStarted: web(deposits).length, payDone: web(topups).length, numbers: orders, failed }
}

async function build(db, now = new Date()) {
  const end = new Date(Math.floor(now.getTime() / 3600e3) * 3600e3)
  const day = await counts(db, new Date(end - DAY), end)
  const week = await counts(db, new Date(end - 8 * DAY), new Date(end - DAY))
  const avg = (k) => week[k] / 7
  const row = (label, k) => {
    const a = avg(k), d = day[k] - a
    const trend = a === 0 ? (day[k] ? ' ▲ new' : '') : ` ${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round((d / a) * 100))}% vs 7-day avg ${a.toFixed(1)}`
    return `${label}: <b>${day[k]}</b>${trend}`
  }
  const brand = process.env.CHAT_BOT_BRAND || 'CloudIVR'
  return [
    `📊 <b>CloudIVR web (${brand}) — last 24 h</b>`,
    row('Sign-ups', 'signups'),
    row('Free test calls', 'trials'),
    row('Payments started', 'payStarted'),
    row('Payments finished', 'payDone'),
    row('Numbers bought', 'numbers'),
    ...(day.failed ? [`⚠️ Failed number orders: <b>${day.failed}</b>`] : []),
  ].join('\n')
}

function start({ db, notifyAdmin, log = console.log }) {
  if (process.env.FUNNEL_REPORT_ON === 'false' || !notifyAdmin) return
  const col = db.collection('webFunnelReports')
  const tick = async () => {
    const now = new Date()
    if (now.getUTCHours() !== HOUR) return
    const key = now.toISOString().slice(0, 10)
    try { await col.insertOne({ _id: key, at: now }) } catch (e) { if (e.code === 11000) return; throw e }
    notifyAdmin(await build(db, now))
    log(`[FunnelReport] sent ${key}`)
  }
  const t = setInterval(() => tick().catch(e => log(`[FunnelReport] ${e.message}`)), 10 * 60000); t.unref?.()
}

module.exports = { start, build }
