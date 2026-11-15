'use strict'
// Released numbers come off Bird caller ID 3 days after they are released for good (suspended lines keep it).
// Queue `birdCidRemovals` remembers the release time even after the line is removed from the account.
const DAYS = 3
const DAY_MS = 24 * 60 * 60 * 1000
const e164 = (p) => `+${String(p || '').replace(/[^\d]/g, '')}`
const ended = (n) => /released|expired|cancel/i.test(String(n.status || ''))
const isLive = (n) => n.status === 'active' || n.status === 'suspended'

async function runBirdCallerIdCleanup({ db, bird, owned, systemCallers = [], log = console.log, now = new Date() }) {
  if (!bird.enabled()) return { skipped: 'bird off' }
  const q = db.collection('birdCidRemovals')
  const live = new Set(), gone = new Map()
  for (const d of await db.collection('phoneNumbersOf').find({}, { projection: { 'val.numbers': 1 } }).toArray()) {
    for (const n of d.val?.numbers || []) {
      if (!n.phoneNumber) continue
      const p = e164(n.phoneNumber)
      if (isLive(n)) live.add(p)
      else if (ended(n) && !gone.has(p)) gone.set(p, n.releasedAt || n._releasedAt || n._inactiveSince || null)
    }
  }
  for (const [p, at] of gone) {
    if (live.has(p)) continue
    const t = at ? new Date(at) : now
    await q.updateOne({ _id: p }, { $setOnInsert: { _id: p, releasedAt: isNaN(t) ? now : t, status: 'waiting' } }, { upsert: true })
  }
  // Bought again (or restored) → it stays on Bird.
  if (live.size) await q.deleteMany({ _id: { $in: [...live] }, status: 'waiting' })

  const due = await q.find({ status: 'waiting', releasedAt: { $lte: new Date(now - DAYS * DAY_MS) } }).toArray()
  if (!due.length) return { removed: 0 }
  // Still in our carrier inventory = some brand owns it again; never touch it.
  let inv
  try { inv = new Set((await owned()).map(e164)) } catch (e) { log(`[BirdCidCleanup] inventory unavailable: ${e.message}`); return { skipped: 'inventory' } }
  if (!inv.size) return { skipped: 'inventory' }
  const keep = new Set([...systemCallers.map(e164), ...(await db.collection('webCallerIds').find({ status: 'verified' }, { projection: { _id: 1 } }).toArray()).map(d => e164(d._id))])
  const cids = await bird.listCallerIds()
  let removed = 0
  for (const d of due) {
    const p = d._id
    if (live.has(p) || keep.has(p) || inv.has(p)) { await q.updateOne({ _id: p }, { $set: { status: 'kept', checkedAt: now } }); continue }
    const hits = cids.filter(v => e164(v.phone_number) === p)
    let ok = true
    for (const v of hits) ok = (await bird.deleteCallerId(v.id)) && ok
    if (!ok) { log(`[BirdCidCleanup] ${p}: Bird delete failed, will retry`); continue }
    await q.updateOne({ _id: p }, { $set: { status: hits.length ? 'removed' : 'not_on_bird', removedAt: now } })
    await db.collection('birdCallerIdVerify').deleteOne({ _id: p }).catch(() => {})
    if (hits.length) { removed++; log(`[BirdCidCleanup] removed ${p} from Bird caller ID (released ${new Date(d.releasedAt).toISOString().slice(0, 10)})`) }
  }
  if (removed) bird.forgetCallerIds?.()
  return { removed, checked: due.length }
}

module.exports = { runBirdCallerIdCleanup, DAYS }
