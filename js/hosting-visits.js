'use strict'
/* global process */
// ============================================================
// Hosting Visits  (js/hosting-visits.js)
// ------------------------------------------------------------
// Accurate "total visitors since a domain was linked to a hosting plan".
// Source: Cloudflare GraphQL httpRequests1dGroups (NON-sampled daily uniques).
//
// Cloudflare only retains a limited analytics window (≈30 days on lower plans),
// so we SNAPSHOT each hosting zone's daily uniques into `hostingVisits` every day.
// The reseller endpoint then sums the stored lifetime history + a LIVE top-up for
// the most-recent days, so the total is accurate and keeps growing beyond CF's
// retention window. Daily rows are idempotent (upsert by zone+date).
//
// SAFETY: the daily snapshot cron only runs when BOT_ENVIRONMENT=production (or
// HOSTING_VISITS_ENABLED=true). On the dev pod it stays OFF so it never hammers
// the production Cloudflare account. The endpoint's live top-up is read-only.
// ============================================================
require('dotenv').config()
const { log: clog } = require('console')
const cf = require('./cf-service')
const { distinctValues } = require('./db')

const COLLECTION = 'hostingVisits'
const SNAPSHOT_DAYS = 7     // re-fetch a trailing window each run (CF finalizes a day a bit late)
const DEFAULT_SWEEP_HOURS = 24

const dayStr = (d) => new Date(d).toISOString().split('T')[0]

let _indexed = false
async function ensureIndexes(db) {
  if (_indexed || !db) return
  _indexed = true
  try {
    await db.collection(COLLECTION).createIndex({ zoneId: 1, date: 1 }, { unique: true })
    await db.collection(COLLECTION).createIndex({ chatId: 1 })
  } catch (_) { _indexed = false }
}

// Upsert a batch of {date,uniques,pageViews,requests} rows for a zone.
async function storeDays(db, { zoneId, domain, chatId }, days) {
  if (!db || !zoneId || !days || !days.length) return 0
  const ops = days.filter(r => r && r.date).map(r => ({
    updateOne: {
      filter: { zoneId, date: r.date },
      update: { $set: { zoneId, domain: domain || null, chatId: chatId != null ? String(chatId) : null, date: r.date, uniques: r.uniques || 0, pageViews: r.pageViews || 0, requests: r.requests || 0, updatedAt: new Date() } },
      upsert: true,
    },
  }))
  if (!ops.length) return 0
  await db.collection(COLLECTION).bulkWrite(ops, { ordered: false }).catch((e) => clog(`[HostingVisits] store warn ${zoneId}: ${e.message}`))
  return ops.length
}

// Total visitors for a zone over [since, until], merging stored history with a live
// Cloudflare top-up (live is authoritative for days it returns; stored covers older days).
// Also persists the freshly-fetched live days so lifetime history keeps extending.
async function totalVisitors(db, { zoneId, domain, chatId, since, until, live = true, cfClient = cf }) {
  const sinceD = dayStr(since)
  const untilD = dayStr(until || Date.now())
  const byDate = new Map()

  const stored = await db.collection(COLLECTION).find({ zoneId, date: { $gte: sinceD, $lte: untilD } }).toArray().catch(() => [])
  for (const r of stored) byDate.set(r.date, { date: r.date, uniques: r.uniques || 0, pageViews: r.pageViews || 0, requests: r.requests || 0 })

  let liveError = null
  if (live) {
    const r = await cfClient.getZoneVisitsRange(zoneId, sinceD, untilD)
    if (r && r.success) {
      for (const d of r.days) byDate.set(d.date, { date: d.date, uniques: d.uniques, pageViews: d.pageViews, requests: d.requests })
      await storeDays(db, { zoneId, domain, chatId }, r.days)
    } else {
      liveError = (r && r.error) || 'cloudflare_unavailable'
    }
  }

  const rows = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1))
  const totals = rows.reduce((a, r) => ({ uniques: a.uniques + (r.uniques || 0), pageViews: a.pageViews + (r.pageViews || 0), requests: a.requests + (r.requests || 0) }), { uniques: 0, pageViews: 0, requests: 0 })
  return {
    total_visitors: totals.uniques,
    total_page_views: totals.pageViews,
    total_requests: totals.requests,
    days_counted: rows.length,
    coverage_from: rows[0]?.date || null,
    coverage_to: rows[rows.length - 1]?.date || null,
    live_error: liveError,
    daily: rows,
  }
}

// ── Daily snapshot of every reseller hosting zone (production + active-slot only) ──
async function resellerOwners(db) {
  const ids = await distinctValues(db.collection('resellerApiKeys'), 'ownerChatId', { enabled: true }).catch(() => [])
  return [...new Set((ids || []).map(String))]
}

async function snapshotAll(db, { log = clog, cfClient = cf } = {}) {
  if (!db) return { zones: 0, stored: 0 }
  await ensureIndexes(db)
  const owners = await resellerOwners(db)
  if (!owners.length) return { zones: 0, stored: 0 }
  const accts = await db.collection('cpanelAccounts').find({
    chatId: { $in: owners }, cfZoneId: { $exists: true, $ne: null }, deleted: { $ne: true },
  }).limit(5000).toArray().catch(() => [])
  const since = dayStr(Date.now() - SNAPSHOT_DAYS * 86400000)
  const until = dayStr(Date.now())
  let zones = 0, stored = 0
  for (const a of accts) {
    const r = await cfClient.getZoneVisitsRange(a.cfZoneId, since, until)
    if (r && r.success && r.days.length) { zones++; stored += await storeDays(db, { zoneId: a.cfZoneId, domain: a.domain, chatId: a.chatId }, r.days) }
  }
  log(`[HostingVisits] daily snapshot: ${zones} zone(s), ${stored} day-row(s) upserted`)
  return { zones, stored }
}

function enabled() {
  const v = process.env.HOSTING_VISITS_ENABLED
  if (v === 'true' || v === 'false') return v === 'true'
  return String(process.env.BOT_ENVIRONMENT || '').toLowerCase() === 'production'
}

function start({ getDb, log = clog } = {}) {
  if (!enabled()) { log('[HostingVisits] daily snapshot OFF (BOT_ENVIRONMENT!=production; set HOSTING_VISITS_ENABLED=true to force)'); return null }
  const activeSlot = require('./active-slot')
  const ms = Math.max(1, Number(process.env.HOSTING_VISITS_SWEEP_HOURS) || DEFAULT_SWEEP_HOURS) * 3600000
  let running = false
  const t = activeSlot.singletonInterval('hosting-visits-snapshot', async () => {
    const db = getDb()
    if (running || !db) return
    running = true
    try { await snapshotAll(db, { log }) } catch (e) { log(`[HostingVisits] snapshot error: ${e.message}`) } finally { running = false }
  }, ms)
  if (t && typeof t.unref === 'function') t.unref()
  log(`[HostingVisits] scheduled daily snapshot every ${ms / 3600000}h`)
  return t
}

module.exports = {
  COLLECTION,
  ensureIndexes,
  storeDays,
  totalVisitors,
  snapshotAll,
  enabled,
  start,
  dayStr,
}
