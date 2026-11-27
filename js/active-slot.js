// ============================================================
// active-slot.js — single-writer rule for blue/green deploys
// ============================================================
// The droplet runs two PM2 slots per app (<app>-a on PORT, <app>-b on PORT+100) and nginx
// routes to exactly ONE of them (upstream file). Around a deploy both slots are alive for
// a while (health wait + call drain + 3 s). Any scheduled work that moves money or talks to
// customers (renewals, reconcilers, nudges, campaign launchers, node-schedule crons) must
// run on ONE slot only — otherwise a cron boundary inside the overlap double-charges.
//
// Rule: the slot nginx currently points at is the writer. Everything else is a reader.
// Outside the droplet (sandbox, Railway, tests without PM2 slot names) → always active.
'use strict'
const fs = require('fs')

const UPSTREAMS_FILE = process.env.ACTIVE_SLOT_UPSTREAMS_FILE || '/etc/nginx/conf.d/nomadly-upstreams.conf'
const SLOT_RE = /^(app-[a-z0-9]+)-[ab]$/
const SKIP_LOG_EVERY_MS = 10 * 60 * 1000
const _lastSkipLog = new Map()

function slotInfo() {
  const name = process.env.ACTIVE_SLOT_NAME || process.env.name || '' // PM2 sets process.env.name
  const m = SLOT_RE.exec(name)
  return { name, upstream: m ? m[1].replace(/-/g, '_') : null, port: String(process.env.PORT || '') }
}

function isActiveSlot() {
  const { upstream, port } = slotInfo()
  if (!upstream || !port) return true // not a blue/green slot → single process → always the writer
  let txt
  try { txt = fs.readFileSync(UPSTREAMS_FILE, 'utf8') } catch (_) { return true } // no nginx map → fail open
  const m = new RegExp(`^upstream ${upstream} \\{ server 127\\.0\\.0\\.1:(\\d+); \\}`, 'm').exec(txt)
  if (!m) return true
  return m[1] === port
}

function describe() {
  const { name, upstream, port } = slotInfo()
  return { name: name || null, upstream, port: port || null, active: isActiveSlot() }
}

function _logSkip(label) {
  const now = Date.now()
  if (now - (_lastSkipLog.get(label) || 0) < SKIP_LOG_EVERY_MS) return
  _lastSkipLog.set(label, now)
  const { name, port } = slotInfo()
  console.log(`[ActiveSlot] skip "${label}" — ${name}:${port} is not the nginx upstream (standby slot)`)
}

// Wrap a scheduled callback so it only runs on the active slot.
function singleton(label, fn) {
  return function activeSlotGuard(...args) {
    if (!isActiveSlot()) { _logSkip(label); return undefined }
    return fn.apply(this, args)
  }
}

// Drop-in for setInterval(fn, ms) → singletonInterval('label', fn, ms). With Redis (redis.js): a run is skipped while the
// previous one (either slot) is still going, each run leaves a heartbeat for the stuck-job check, and
// redis.wake(label) runs it right away on the active slot.
const R = () => require('./redis')
const STUCK_MIN_MS = 15 * 60000
function singletonInterval(label, fn, ms, ...rest) {
  const run = async () => {
    if (!isActiveSlot()) { _logSkip(label); return }
    if (!R().enabled()) return fn(...rest)
    const token = await R().lock(`job:${label}`, Math.max(2 * ms, 120000))
    if (token === false) return
    const start = Date.now(), slot = slotInfo().name || null
    R().beat(label, { start, every: ms, running: true, slot })
    let err = null
    try { return await fn(...rest) } catch (e) { err = String(e?.message || e).slice(0, 200); throw e } finally {
      R().unlock(`job:${label}`, token)
      R().beat(label, { start, end: Date.now(), every: ms, running: false, err, slot })
    }
  }
  const go = () => { Promise.resolve().then(run).catch(e => console.log(`[Job] ${label}: ${e?.message || e}`)) }
  R().onWake(label, go)
  return setInterval(go, ms)
}

// Jobs whose run has been going (or not happened) for 3× their interval, min 15 min → [{ label, why, ... }]
async function stuckJobs(now = Date.now()) {
  const all = await R().jobs()
  if (!all) return []
  return Object.entries(all).filter(([, j]) => j && j.every).map(([label, j]) => {
    const limit = Math.max(3 * j.every, STUCK_MIN_MS)
    if (j.running && now - j.start > limit) return { label, why: `running for ${Math.round((now - j.start) / 60000)} min`, ...j }
    if (!j.running && now - (j.end || j.start) > limit) return { label, why: `last ran ${Math.round((now - (j.end || j.start)) / 60000)} min ago`, ...j }
    return null
  }).filter(Boolean)
}

// node-schedule crons fire at the same wall-clock second on every slot → always singleton.
// Patches the shared module object once; supports (spec, fn[, cb]) and (name, spec, fn[, cb]).
let cronSeq = 0
function patchNodeSchedule(schedule) {
  if (!schedule || schedule.__activeSlotPatched) return schedule
  const orig = schedule.scheduleJob.bind(schedule)
  schedule.scheduleJob = function (...a) {
    const fnIdx = a.findIndex((x, i) => i >= 1 && typeof x === 'function')
    if (fnIdx === -1) return orig(...a)
    const label = fnIdx === 2 && typeof a[0] === 'string' ? a[0] : `cron ${String(a[fnIdx - 1])} ${a[fnIdx].name || ''}`.trim()
    const job = singleton(label, a[fnIdx])
    // One run per fire across slots even if both briefly think they are active (Redis; else as before).
    const key = `cron:${++cronSeq}:${label}` // registration order is the same on both slots → unique, matching keys
    a[fnIdx] = async function (...args) { if (await R().once(`${key}:${Math.floor(Date.now() / 30000)}`, 120000) === false) return; return job.apply(this, args) }
    return orig(...a)
  }
  schedule.__activeSlotPatched = true
  return schedule
}

module.exports = { isActiveSlot, describe, singleton, singletonInterval, stuckJobs, patchNodeSchedule, _slotInfo: slotInfo, UPSTREAMS_FILE }
