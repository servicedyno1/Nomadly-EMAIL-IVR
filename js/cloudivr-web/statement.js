'use strict'
// Monthly statement: on the 1st (UTC) every account with activity last month gets one email listing its line
// payments and the texts it sent. Opt out in Settings (webPrefs.statementOff). Each month is sent once (webStatements).
const LINE_TYPES = /purchase|renewal|replace|refund|^phone-number$|^hosted-sms-setup$/
const LABEL = { 'esim-purchase': 'USA eSIM purchase', 'mobile-number-purchase': 'USA mobile number purchase', 'esim-renewal': 'eSIM / mobile number renewal', 'esim-number-replace': 'Mobile number replacement', 'number-replace': 'Number replacement', 'phone-number': 'Business number', 'hosted-sms-setup': 'Landline to Texting setup', 'hosted-sms-renewal': 'Landline to Texting renewal', 'esim-refund': 'Refund', 'mobile-number-refund': 'Refund', 'hosted-sms-refund': 'Refund' }
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const usd = (n) => `$${Number(n || 0).toFixed(2)}`
const monthName = (d) => d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })

async function build(db, chatId, from, to) {
  const pays = await db.collection('transactions').find({ chatId: String(chatId), createdAt: { $gte: from, $lt: to }, type: LINE_TYPES }).sort({ createdAt: 1 }).limit(200).toArray()
  const texts = await db.collection('phoneLogs').aggregate([{ $match: { chatId: String(chatId), type: 'sms_out', timestamp: { $gte: from, $lt: to } } }, { $group: { _id: null, n: { $sum: 1 }, cost: { $sum: { $ifNull: ['$charge', 0] } } } }]).toArray()
  return { pays, texts: texts[0]?.n || 0, textCost: texts[0]?.cost || 0 }
}

function html({ pays, texts, textCost }, month, settingsUrl) {
  const paid = pays.filter(p => !/refund/.test(p.type)).reduce((n, p) => n + Number(p.amount || 0), 0)
  const back = pays.filter(p => /refund/.test(p.type)).reduce((n, p) => n + Number(p.amount || 0), 0)
  const rows = pays.map(p => `<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap">${p.createdAt.toISOString().slice(0, 10)}</td><td style="padding:6px 12px 6px 0">${esc(LABEL[p.type] || p.type)}${p.metadata?.phoneNumber ? ` <span style="color:#64748b">${esc(p.metadata.phoneNumber)}</span>` : ''}</td><td style="padding:6px 0;text-align:right;white-space:nowrap">${/refund/.test(p.type) ? '+' : '−'}${usd(p.amount)}</td></tr>`).join('')
  return `<h2 style="margin:0 0 4px">Your ${esc(month)} statement</h2><p style="margin:0 0 18px;color:#64748b">Line payments and texts on your CloudIVR account.</p>
<table style="border-collapse:collapse;font-size:14px;width:100%;max-width:560px">${rows || '<tr><td style="color:#64748b">No line payments this month.</td></tr>'}</table>
<table style="border-collapse:collapse;font-size:14px;margin-top:18px"><tr><td style="padding:4px 16px 4px 0;color:#64748b">Line payments</td><td><b>${usd(paid)}</b></td></tr>${back ? `<tr><td style="padding:4px 16px 4px 0;color:#64748b">Refunds</td><td><b>+${usd(back)}</b></td></tr>` : ''}<tr><td style="padding:4px 16px 4px 0;color:#64748b">Texts sent</td><td><b>${texts}</b>${textCost ? ` (${usd(textCost)} from your wallet)` : ''}</td></tr></table>
<p style="color:#64748b;font-size:12px;margin-top:22px">Don’t want these? Turn off monthly statements in <a href="${esc(settingsUrl)}">Settings</a>.</p>`
}

async function runOnce(db, { log, now = new Date(), force = false } = {}) {
  if (!force && now.getUTCDate() !== 1) return 0
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  const ym = from.toISOString().slice(0, 7), sent = db.collection('webStatements')
  const active = new Set([...await db.collection('transactions').distinct('chatId', { createdAt: { $gte: from, $lt: to }, type: LINE_TYPES }), ...await db.collection('phoneLogs').distinct('chatId', { type: 'sms_out', timestamp: { $gte: from, $lt: to } })].map(String))
  const { sendMail } = require('./auth'), { appUrl } = require('./emails')
  let n = 0
  for (const chatId of active) {
    const acc = await db.collection('webAccounts').findOne({ _id: { $in: [chatId, Number(chatId)] } }, { projection: { email: 1 } })
    if (!acc?.email) continue
    if ((await db.collection('webPrefs').findOne({ _id: { $in: [chatId, Number(chatId)] } }, { projection: { statementOff: 1 } }))?.statementOff) continue
    try { await sent.insertOne({ _id: `${chatId}|${ym}`, chatId, month: ym, at: new Date() }) } catch (e) { if (e.code === 11000) continue; throw e }
    const data = await build(db, chatId, from, to)
    const ok = await sendMail(acc.email, `Your CloudIVR statement for ${monthName(from)}`, html(data, monthName(from), appUrl('/app/settings'))).catch(() => false)
    await sent.updateOne({ _id: `${chatId}|${ym}` }, { $set: { emailed: !!ok, payments: data.pays.length, texts: data.texts } })
    n++
  }
  if (n) log(`[Statement] ${ym}: ${n} sent`)
  return n
}

function start(db, { log = console.log } = {}) {
  const t = setInterval(() => runOnce(db, { log }).catch(e => log(`[Statement] ${e.message}`)), 3600000)
  t.unref?.()
  setTimeout(() => runOnce(db, { log }).catch(e => log(`[Statement] ${e.message}`)), 60000).unref?.()
}

module.exports = { start, runOnce, build, html }
