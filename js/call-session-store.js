'use strict'
// ============================================================
// call-session-store.js — persist in-flight call sessions to Mongo
// ============================================================
// The voice service keeps live call state in-memory (activeCalls, pendingBridges,
// outboundIvrCalls, twilioIvrSessions). On a blue/green cutover the NEW slot starts with
// empty maps, so a Twilio/Telnyx webhook for a call that began on the OLD slot would land
// on a process that has never heard of it → "Call routing session expired" + a billed-but-
// dropped call (the @Login4six8 class of bug).
//
// This module mirrors those maps to a TTL-indexed Mongo collection:
//   - write-through : voice-service wraps each map in a Proxy whose set/delete call persist()/remove()
//   - periodic snapshot : catches nested field mutations (e.g. session.callSid = ...) the Proxy can't see
//   - warm-load on boot : loadAll() rehydrates every live session before the slot goes healthy
//   - read-through on miss : rehydrate() restores a single call on demand from a webhook
//
// Everything is best-effort and non-blocking: if Mongo is unavailable or the store was never
// initialised (sandbox / unit tests), all calls no-op and the in-memory maps behave as before.
const { log } = require('console')

const COLLECTION = 'callSessions'
// A session doc auto-expires this long after its last update. Must comfortably exceed the
// longest in-memory call lifetime (voice-service ACTIVE_CALL_MAX_AGE = 30 min) so a genuinely
// live call is never evicted mid-call, yet short enough that a crashed slot's leftovers self-clean.
const TTL_SECONDS = parseInt(process.env.CALL_SESSION_TTL_SECONDS || '7200', 10) // 2h

// Fields stored as Date in memory — JSON round-trip turns them into ISO strings, so revive them.
const DATE_FIELDS = ['startedAt', 'createdAt', 'startTime', 'initiatedAt', 'registeredAt', 'blockedAt', 'answeredAt']

let _col = null

function _sanitize(obj) {
  // JSON round-trip drops functions, timers (_limitTimer), and circular refs; the replacer
  // also strips any `_`-prefixed internal field (timers/flags that cannot survive a process).
  try {
    return JSON.parse(JSON.stringify(obj, (k, v) => {
      if (k && typeof k === 'string' && k.startsWith('_')) return undefined
      if (typeof v === 'function') return undefined
      return v
    }))
  } catch (_) { return null }
}

function _revive(data) {
  if (!data || typeof data !== 'object') return data
  for (const f of DATE_FIELDS) {
    if (typeof data[f] === 'string') { const d = new Date(data[f]); if (!isNaN(d.getTime())) data[f] = d }
  }
  return data
}

async function init(db) {
  if (!db || typeof db.collection !== 'function') return false
  _col = db.collection(COLLECTION)
  try {
    await _col.createIndex({ updatedAt: 1 }, { expireAfterSeconds: TTL_SECONDS, name: 'callSessions_ttl' })
    await _col.createIndex({ sid: 1 }, { name: 'callSessions_sid' })
    await _col.createIndex({ 'data.callControlId': 1 }, { name: 'callSessions_ccid' })
  } catch (e) { log(`[CallSessionStore] index init warn: ${e.message}`) }
  log(`[CallSessionStore] Initialized (collection=${COLLECTION}, ttl=${TTL_SECONDS}s)`)
  return true
}

function persist(kind, sid, obj) {
  if (!_col || !kind || !sid) return
  const data = _sanitize(obj)
  if (!data) return
  _col.updateOne(
    { _id: `${kind}:${sid}` },
    { $set: { kind, sid: String(sid), data, updatedAt: new Date() } },
    { upsert: true }
  ).catch(e => log(`[CallSessionStore] persist ${kind}:${sid} err: ${e.message}`))
}

function remove(kind, sid) {
  if (!_col || !kind || !sid) return
  _col.deleteOne({ _id: `${kind}:${sid}` }).catch(() => {})
}

// Warm-load every persisted session into the RAW (un-proxied) maps on boot. Writing to the raw
// maps avoids a redundant write-back through the Proxy. Only fills gaps (never clobbers live state).
async function loadAll(rawStores) {
  if (!_col) return 0
  let n = 0
  try {
    const docs = await _col.find({}).toArray()
    for (const doc of docs) {
      const store = rawStores[doc.kind]
      if (!store || !doc.sid) continue
      if (!store[doc.sid]) { store[doc.sid] = _revive(doc.data || {}); n++ }
    }
    if (n) log(`[CallSessionStore] Warm-loaded ${n} call session(s) from Mongo on boot`)
  } catch (e) { log(`[CallSessionStore] loadAll err: ${e.message}`) }
  return n
}

// Read-through: restore any session keyed by (or referencing) this callControlId that is not
// already in local memory. Called from the webhook hot path ONLY on a local-memory miss.
async function rehydrate(callControlId, rawStores) {
  if (!_col || !callControlId) return 0
  let n = 0
  try {
    const docs = await _col.find({
      $or: [{ sid: String(callControlId) }, { 'data.callControlId': callControlId }],
    }).toArray()
    for (const doc of docs) {
      const store = rawStores[doc.kind]
      if (!store || !doc.sid) continue
      if (!store[doc.sid]) { store[doc.sid] = _revive(doc.data || {}); n++ }
    }
    if (n) log(`[CallSessionStore] Read-through rehydrated ${n} session(s) for ${callControlId}`)
  } catch (e) { log(`[CallSessionStore] rehydrate err: ${e.message}`) }
  return n
}

// Periodic full snapshot of everything currently in memory — upserts each live session so that
// nested field updates (which the top-level Proxy cannot observe) reach Mongo within one interval.
function snapshot(rawStores) {
  if (!_col) return
  for (const kind of Object.keys(rawStores)) {
    const store = rawStores[kind]
    for (const sid of Object.keys(store)) persist(kind, sid, store[sid])
  }
}

module.exports = { init, persist, remove, loadAll, rehydrate, snapshot, COLLECTION, TTL_SECONDS, _sanitize, _revive }
