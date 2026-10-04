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

// Drop-in for setInterval(fn, ms) → singletonInterval('label', fn, ms)
function singletonInterval(label, fn, ms, ...rest) {
  return setInterval(singleton(label, fn), ms, ...rest)
}

// node-schedule crons fire at the same wall-clock second on every slot → always singleton.
// Patches the shared module object once; supports (spec, fn[, cb]) and (name, spec, fn[, cb]).
function patchNodeSchedule(schedule) {
  if (!schedule || schedule.__activeSlotPatched) return schedule
  const orig = schedule.scheduleJob.bind(schedule)
  schedule.scheduleJob = function (...a) {
    const fnIdx = a.findIndex((x, i) => i >= 1 && typeof x === 'function')
    if (fnIdx === -1) return orig(...a)
    const label = fnIdx === 2 && typeof a[0] === 'string' ? a[0] : `cron ${String(a[fnIdx - 1])} ${a[fnIdx].name || ''}`.trim()
    a[fnIdx] = singleton(label, a[fnIdx])
    return orig(...a)
  }
  schedule.__activeSlotPatched = true
  return schedule
}

module.exports = { isActiveSlot, describe, singleton, singletonInterval, patchNodeSchedule, _slotInfo: slotInfo, UPSTREAMS_FILE }
