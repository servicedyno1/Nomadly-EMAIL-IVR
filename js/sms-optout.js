'use strict'
// Text opt-outs: a recipient who replies STOP (or similar) to any number of an account is never texted by that account
// again until they reply START. One doc per (account, recipient) in `smsOptOuts`.
const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit|optout|opt out|revoke)\s*[.!]*\s*$/i
const START = /^\s*(start|unstop|subscribe)\s*[.!]*\s*$/i
let col = null
const init = (db) => { col = db.collection('smsOptOuts') }
const norm = (n) => `+${String(n || '').replace(/\D/g, '')}`

// Inbound text → 'stop' | 'start' | null (recorded for the owner account).
async function onInbound(owner, ourNumber, from, body) {
  if (!col || owner == null) return null
  const id = `${owner}:${norm(from)}`
  if (STOP.test(body || '')) {
    await col.updateOne({ _id: id }, { $set: { owner, recipient: norm(from), via: ourNumber, keyword: String(body).trim().slice(0, 20), at: new Date() } }, { upsert: true })
    return 'stop'
  }
  if (START.test(body || '') && (await col.deleteOne({ _id: id })).deletedCount) return 'start'
  return null
}
const isOptedOut = async (owner, to) => !!(col && owner != null && (await col.findOne({ _id: `${owner}:${norm(to)}` }, { projection: { _id: 1 } })))

module.exports = { init, onInbound, isOptedOut, STOP, START }
