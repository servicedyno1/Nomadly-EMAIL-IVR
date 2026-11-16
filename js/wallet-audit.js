// Wallet audit: every wallet balance change (read from the MongoDB oplog) must match a billing record
// (transactions / walletLedger / phoneTransactions) of the same amount for the same account, or be cancelled
// out by an equal reverse change seconds later (failed purchase refunded). Anything else is alerted to admins.
const r2 = (x) => Math.round(Number(x) * 100) / 100
const WIN = 3 * 60e3, PAIR = 30e3, SETTLE = 6 * 60e3

// deltas = [{ amt, at }] for one account; records = [{ a, at }] → unexplained deltas.
function unexplained(deltas, records) {
  const gone = new Set(), used = new Set()
  deltas.forEach((x, i) => {
    if (gone.has(i)) return
    const j = deltas.findIndex((y, k) => k !== i && !gone.has(k) && Math.abs(x.amt + y.amt) < 0.011 && Math.abs(x.at - y.at) < PAIR)
    if (j >= 0) { gone.add(i); gone.add(j) }
  })
  return deltas.filter((_, i) => !gone.has(i)).filter((d) => {
    let best = -1, dt = WIN
    records.forEach((r, j) => {
      const t = Math.abs(new Date(r.at) - d.at)
      if (!used.has(j) && Math.abs(r.a - Math.abs(d.amt)) < 0.011 && t < dt) { dt = t; best = j }
    })
    if (best >= 0) used.add(best)
    return best < 0
  })
}

// One oplog entry → { id, fields: { usdIn?, usdOut? }, held } (null when it isn't a wallet balance write).
function parseOp(d) {
  const id = d.op === 'i' ? d.o?._id : d.o2?._id
  if (id == null || !['i', 'u'].includes(d.op)) return null
  const s = d.op === 'i' || (!d.o.diff && !d.o.$set && !d.o.$v) ? d.o : { ...(d.o.diff?.i || {}), ...(d.o.diff?.u || {}), ...(d.o.$set || {}) }
  const fields = {}
  if (s.usdIn != null) fields.usdIn = Number(s.usdIn)
  if (s.usdOut != null) fields.usdOut = Number(s.usdOut)
  return Object.keys(fields).length ? { id: String(id), fields, held: s.usdHeld != null } : null
}

async function recordsFor(db, id, lo, hi) {
  const q = { chatId: { $in: [id, Number(id)] } }
  const tx = db.collection('transactions')
  const [a, b, c, d] = await Promise.all([
    tx.find({ ...q, createdAt: { $gte: lo, $lte: hi } }).project({ amount: 1, createdAt: 1 }).toArray(),
    tx.find({ ...q, createdAt: { $gte: lo.toISOString(), $lte: hi.toISOString() } }).project({ amount: 1, createdAt: 1 }).toArray(),
    db.collection('walletLedger').find({ ...q, timestamp: { $gte: lo, $lte: hi } }).project({ amount: 1, timestamp: 1 }).toArray(),
    db.collection('phoneTransactions').find({ ...q, timestamp: { $gte: lo.toISOString(), $lte: hi.toISOString() } }).project({ amount: 1, timestamp: 1 }).toArray(),
  ])
  return [...a, ...b].map((t) => ({ a: Math.abs(r2(t.amount)), at: t.createdAt })).concat([...c, ...d].map((t) => ({ a: Math.abs(r2(t.amount)), at: t.timestamp })))
}

async function runOnce({ db, alert, log = console.log }) {
  const state = db.collection('walletAuditState'), last = db.collection('walletAuditLast'), findings = db.collection('walletAuditFindings')
  const oplog = db.client.db('local').collection('oplog.rs')
  const cp = await state.findOne({ _id: 'checkpoint' })
  const until = new Date(Date.now() - SETTLE)
  if (!cp) {
    // First run: remember every wallet's current balance so the very first change of each one can be checked.
    const now = new Date()
    if (!(await state.insertOne({ _id: 'checkpoint', wall: now, at: now }).then(() => true, () => false))) return { skipped: true }
    for await (const w of db.collection('walletOf').find({}, { projection: { usdIn: 1, usdOut: 1 } })) {
      await last.updateOne({ _id: String(w._id) }, { $set: { usdIn: w.usdIn ?? null, usdOut: w.usdOut ?? null, at: now } }, { upsert: true })
    }
    return { started: true }
  }
  if (cp.wall >= until) return { skipped: true }
  // Claim the range so a second app slot (blue/green deploy) never audits it twice.
  const claimed = await state.updateOne({ _id: 'checkpoint', wall: cp.wall }, { $set: { wall: until, at: new Date() } })
  if (!claimed.modifiedCount) return { skipped: true }
  const { Timestamp } = require('mongodb')
  const tsOf = (d) => new Timestamp({ t: Math.floor(d.getTime() / 1000), i: 0 })
  const ops = await oplog.find({ ts: { $gt: tsOf(new Date(cp.wall)), $lte: tsOf(until) }, ns: `${db.databaseName}.walletOf` }).toArray()
  const byId = {}
  for (const d of ops) { const p = parseOp(d); if (p) (byId[p.id] ||= []).push({ ...p, at: d.wall }) }
  const found = []
  for (const [id, list] of Object.entries(byId)) {
    const prev = (await last.findOne({ _id: id })) || {}
    const cur = { usdIn: prev.usdIn, usdOut: prev.usdOut }
    const deltas = []
    for (const p of list) {
      for (const f of ['usdIn', 'usdOut']) {
        if (p.fields[f] == null) continue
        const dv = cur[f] != null ? r2(p.fields[f] - cur[f]) : 0
        cur[f] = p.fields[f]
        // Card-check holds move money between usdOut and usdHeld; they are not balance changes.
        if (dv && !p.held) deltas.push({ amt: f === 'usdIn' ? dv : -dv, at: p.at })
      }
    }
    await last.updateOne({ _id: id }, { $set: { usdIn: cur.usdIn, usdOut: cur.usdOut, at: new Date() } }, { upsert: true })
    if (!deltas.length) continue
    const lo = new Date(Math.min(...deltas.map((x) => +x.at)) - WIN), hi = new Date(Math.max(...deltas.map((x) => +x.at)) + WIN)
    for (const u of unexplained(deltas, await recordsFor(db, id, lo, hi))) found.push({ chatId: id, amount: u.amt, at: u.at })
  }
  if (found.length) {
    await findings.insertMany(found.map((f) => ({ ...f, foundAt: new Date() })))
    const lines = found.slice(0, 20).map((f) => `• ${f.chatId}: ${f.amount > 0 ? '+' : ''}$${f.amount.toFixed(2)} at ${f.at.toISOString().slice(0, 16).replace('T', ' ')} UTC`)
    const net = r2(found.reduce((s, f) => s + f.amount, 0))
    alert(`Wallet audit: ${found.length} unrecorded balance change(s)`, `🧾 <b>Wallet audit</b> — ${found.length} wallet change(s) with no billing record (net ${net >= 0 ? '+' : ''}$${net.toFixed(2)}):\n${lines.join('\n')}${found.length > 20 ? `\n…and ${found.length - 20} more` : ''}`)
  }
  log(`[WalletAudit] ${ops.length} wallet writes checked, ${found.length} unrecorded`)
  return { ops: ops.length, found }
}

function start({ db, alert, log = console.log, everyMs = 30 * 60e3 }) {
  let warned = false
  const tick = () => runOnce({ db, alert, log }).catch((e) => {
    log(`[WalletAudit] ${e.message}`)
    if (!warned) { warned = true; alert('Wallet audit is not running', `⚠️ <b>Wallet audit</b> could not read wallet changes: ${e.message}`) }
  })
  setTimeout(tick, 60e3)
  return setInterval(tick, everyMs)
}

module.exports = { start, runOnce, unexplained, parseOp }
