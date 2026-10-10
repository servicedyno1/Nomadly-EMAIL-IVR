'use strict'
// Per-service change-activity log behind GET /activity (actor api | bot | system).
// Entries expire after RETENTION_DAYS via a TTL index. Writes are best-effort and never throw.
const crypto = require('crypto')

const COLLECTION = 'resellerActivity'
const RETENTION_DAYS = 90
const ACTORS = ['api', 'bot', 'system']
const TYPES = ['hosting', 'vps', 'rdp', 'domain', 'account']
const CASE_INSENSITIVE = ['hosting', 'domain']
const _indexed = new WeakSet()

class ActivityQueryError extends Error {
  constructor(code, message) { super(message); this.code = code; this.status = 400 }
}

function ensureIndexes(db) {
  if (!db || _indexed.has(db)) return Promise.resolve()
  _indexed.add(db)
  const c = db.collection(COLLECTION)
  return Promise.all([
    c.createIndex({ at: 1 }, { expireAfterSeconds: RETENTION_DAYS * 86400, name: 'ttl_at' }),
    c.createIndex({ ownerChatId: 1, at: -1, _id: -1 }),
    c.createIndex({ ownerChatId: 1, resourceType: 1, resourceId: 1, at: -1 }),
  ]).catch(() => { _indexed.delete(db) })
}

const normId = (type, id) => (id == null || id === '' ? null : (CASE_INSENSITIVE.includes(type) ? String(id).toLowerCase() : String(id)))

function record(db, { ownerChatId, resourceType = null, resourceId = null, action, actor, details = {} } = {}) {
  if (!db || typeof db.collection !== 'function' || !ownerChatId || !action || !ACTORS.includes(actor)) return Promise.resolve(false)
  ensureIndexes(db)
  const doc = { _id: crypto.randomUUID(), ownerChatId: String(ownerChatId), resourceType, resourceId: normId(resourceType, resourceId), action, actor, details, at: new Date() }
  return db.collection(COLLECTION).insertOne(doc).then(() => true, () => false)
}

const encodeCursor = (d) => Buffer.from(`${d.at.toISOString()}|${d._id}`).toString('base64url')
function decodeCursor(s) {
  const [at, id] = Buffer.from(String(s), 'base64url').toString('utf8').split('|')
  const d = new Date(at)
  if (!id || isNaN(d.getTime())) throw new ActivityQueryError('invalid_cursor', 'cursor is not valid — pass next_cursor back unchanged.')
  return { at: d, id }
}

function parseFilters(q = {}) {
  const f = { limit: 50 }
  if (q.resource) {
    const s = String(q.resource).trim()
    const i = s.indexOf(':')
    if (i > 0 && TYPES.includes(s.slice(0, i).toLowerCase())) { f.resourceType = s.slice(0, i).toLowerCase(); f.resourceId = s.slice(i + 1).trim() }
    else f.resourceId = s
    if (!f.resourceId) throw new ActivityQueryError('invalid_resource', 'resource must be "<type>:<id>" (type = hosting | vps | rdp | domain | account) or a bare id.')
  }
  const type = q.resource_type || q.product
  if (type && !f.resourceType) {
    f.resourceType = String(type).toLowerCase()
    if (!TYPES.includes(f.resourceType)) throw new ActivityQueryError('invalid_resource_type', `resource_type must be one of: ${TYPES.join(', ')}.`)
  }
  if (q.actor) {
    f.actor = String(q.actor).toLowerCase()
    if (!ACTORS.includes(f.actor)) throw new ActivityQueryError('invalid_actor', 'actor must be api, bot or system.')
  }
  if (q.action) f.action = String(q.action).trim().slice(0, 64)
  for (const k of ['since', 'until']) {
    if (!q[k]) continue
    f[k] = new Date(String(q[k]))
    if (isNaN(f[k].getTime())) throw new ActivityQueryError('invalid_date', `${k} must be an ISO-8601 date/time.`)
  }
  if (q.limit != null && q.limit !== '') {
    const n = parseInt(q.limit, 10)
    if (!Number.isFinite(n) || n < 1) throw new ActivityQueryError('invalid_limit', 'limit must be a positive integer (max 200).')
    f.limit = Math.min(200, n)
  }
  if (q.cursor) f.cursor = decodeCursor(q.cursor)
  return f
}

const escRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const publicView = (d) => ({ id: d._id, at: d.at.toISOString(), resource_type: d.resourceType, resource_id: d.resourceId, action: d.action, actor: d.actor, details: d.details || {} })

async function list(db, ownerChatId, f) {
  const and = [{ ownerChatId: String(ownerChatId) }]
  if (f.resourceType) and.push({ resourceType: f.resourceType })
  if (f.resourceId) and.push({ resourceId: { $in: [...new Set([f.resourceId, f.resourceId.toLowerCase()])] } })
  if (f.actor) and.push({ actor: f.actor })
  // "dns" matches dns.repair; "auto_renew" matches auto_renew.charged / auto_renew.failed …
  if (f.action) and.push({ action: { $regex: `^${escRx(f.action)}(\\.|$)` } })
  if (f.since) and.push({ at: { $gte: f.since } })
  if (f.until) and.push({ at: { $lte: f.until } })
  if (f.cursor) and.push({ $or: [{ at: { $lt: f.cursor.at } }, { at: f.cursor.at, _id: { $lt: f.cursor.id } }] })
  const docs = await db.collection(COLLECTION).find({ $and: and }).sort({ at: -1, _id: -1 }).limit(f.limit + 1).toArray()
  const page = docs.slice(0, f.limit)
  const hasMore = docs.length > f.limit
  return { items: page.map(publicView), has_more: hasMore, next_cursor: hasMore ? encodeCursor(page[page.length - 1]) : null }
}

module.exports = { record, list, parseFilters, ensureIndexes, publicView, ActivityQueryError, COLLECTION, RETENTION_DAYS, ACTORS, TYPES }
