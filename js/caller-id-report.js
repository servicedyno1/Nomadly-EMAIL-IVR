'use strict'
// Daily caller-ID activity report to the admin Telegram chat: custom caller IDs used (by channel, account and number),
// hotline look-alikes, and caller IDs Telnyx or a carrier declined (each one redialed once from the user's own number).
const { HOTLINES } = require('./cloudivr-web/caller-ids')
const { formatPhone } = require('./phone-config')

const VIA = { sip: 'Softphone / SIP', sip_test: 'Free SIP test (set)', sip_test_call: 'Free SIP test call', ivr: 'Quick IVR', bulk: 'Bulk campaigns', ivr_trial: 'Free Quick IVR trial', web: 'Browser phone' }
const HOW = { carrier: 'Carrier declined (SIP 403/603/607/608)', telnyx: 'Telnyx refused' }
const esc = (s) => String(s ?? '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
const brand = () => String(process.env.CHAT_BOT_BRAND || 'Nomadly').trim() || 'Nomadly'
const day = (d) => d.toISOString().slice(0, 10)

const group = (db, name, since, until, by) => db.collection(name).aggregate([
  { $match: { at: { $gte: since, $lt: until } } },
  { $group: { _id: by, n: { $sum: 1 }, users: { $addToSet: '$chatId' } } },
  { $sort: { n: -1 } },
]).toArray()

async function build(db, until = new Date()) {
  const since = new Date(until.getTime() - 86400000)
  const [byVia, byId, byUser, decl, declId] = await Promise.all([
    group(db, 'callerIdUses', since, until, '$via'),
    group(db, 'callerIdUses', since, until, '$showAs'),
    group(db, 'callerIdUses', since, until, '$chatId'),
    group(db, 'callerIdDeclines', since, until, '$how'),
    group(db, 'callerIdDeclines', since, until, '$showAs'),
  ])
  const total = byVia.reduce((s, r) => s + r.n, 0)
  const declined = decl.reduce((s, r) => s + r.n, 0)
  const users = new Set(byVia.flatMap(r => r.users)).size
  const head = `🎭 <b>Daily caller ID report</b> — ${esc(brand())}\n<i>${since.toUTCString().slice(5, 22)} → ${until.toUTCString().slice(5, 22)} UTC</i>`
  if (!total && !declined) return { text: `${head}\n\nNo custom caller IDs were used and none were declined.`, total, declined }
  const lines = [head, '', `📞 Custom caller ID uses: <b>${total}</b> · accounts: <b>${users}</b> · different IDs: <b>${byId.length}</b>`]
  if (byVia.length) lines.push('', '<b>By channel</b>', ...byVia.map(r => `• ${esc(VIA[r._id] || r._id)}: ${r.n}`))
  if (byId.length) lines.push('', '<b>Top caller IDs</b>', ...byId.slice(0, 10).map(r => `• ${esc(formatPhone(r._id))} — ${r.n}× by ${r.users.length} account${r.users.length === 1 ? '' : 's'}${HOTLINES[r._id] ? ` 🚩 <b>${esc(HOTLINES[r._id])}</b>` : ''}`))
  const flagged = byId.filter(r => HOTLINES[r._id])
  if (flagged.length) lines.push('', `🚩 <b>Hotline look-alikes: ${flagged.reduce((s, r) => s + r.n, 0)} use(s)</b> — ${flagged.map(r => esc(HOTLINES[r._id])).join(', ')}`)
  if (byUser.length) lines.push('', '<b>Most active accounts</b>', ...byUser.slice(0, 5).map(r => `• <code>${esc(r._id)}</code> — ${r.n}×`))
  lines.push('', `⛔ Declined: <b>${declined}</b>${declined ? ' (each redialed once from the user’s own number)' : ''}`)
  if (decl.length) lines.push(...decl.map(r => `• ${esc(HOW[r._id] || r._id)}: ${r.n}`))
  if (declId.length) lines.push(...declId.slice(0, 5).map(r => `  ↳ ${esc(formatPhone(r._id))} — ${r.n}×`))
  return { text: lines.join('\n'), total, declined }
}

// Checks hourly; sends once per brand per UTC day after `hour`. The lock row stops both deploy slots sending.
function start({ db, send, log = console.log, hour = 8 }) {
  const tick = async () => {
    const now = new Date()
    if (now.getUTCHours() < hour) return
    try { await db.collection('reportRuns').insertOne({ _id: `callerIdDaily:${brand()}:${day(now)}`, at: now }) } catch (e) { if (e.code === 11000) return; throw e }
    const { text, total, declined } = await build(db, now)
    await send(text)
    log(`[CallerIdReport] sent daily report (${total} uses, ${declined} declined)`)
  }
  const run = () => tick().catch(e => log(`[CallerIdReport] failed: ${e.message}`))
  setTimeout(run, 60000).unref?.()
  setInterval(run, 3600000).unref?.()
}

module.exports = { build, start }
