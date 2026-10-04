/**
 * Scheduler registry — tracks every setInterval/setTimeout the bot starts so
 * we can clean them up on SIGTERM/SIGINT and prevent reentrancy when a tick
 * takes longer than its period.
 *
 * Use from anywhere:
 *   const sched = require('./scheduler-registry')
 *   sched.every('refresh-cache', 60_000, async () => { ... })
 *   sched.after('cleanup-X', 30_000, async () => { ... })
 *
 * On shutdown:
 *   sched.stopAll()
 *
 * Safety:
 *   - If a previous tick is still running when the next one fires, we skip
 *     (no overlap, no thundering DB writes).
 *   - All errors are caught and logged with the scheduler label.
 */
const _intervals = new Map()    // label -> { id, running, lastTickAt, errCount, fn, ms }
const _timeouts = new Map()
let _stopped = false
// Blue/green single-writer: during a deploy both PM2 slots are alive; only the slot nginx
// routes to may run recurring crons (prevents double-billing). Fails OPEN off the droplet.
const _activeSlot = (() => { try { return require('./active-slot') } catch (_) { return null } })()

function _log(level, label, msg, extra) {
  const ts = new Date().toISOString()
  const line = `[${ts}] [Scheduler:${label}] ${level} ${msg}`
  if (extra) console.log(line, extra)
  else console.log(line)
}

function every(label, ms, fn) {
  if (_stopped) {
    _log('warn', label, 'registry stopped, not starting new interval')
    return null
  }
  if (_intervals.has(label)) {
    _log('warn', label, `interval already registered; replacing`)
    clearInterval(_intervals.get(label).id)
  }
  const entry = { id: null, running: false, lastTickAt: 0, errCount: 0, fn, ms }
  const tick = async () => {
    if (entry.running) {
      _log('warn', label, 'previous tick still running, skipping this one')
      return
    }
    if (_activeSlot && !_activeSlot.isActiveSlot()) return // standby blue/green slot — skip
    entry.running = true
    const t0 = Date.now()
    try {
      await fn()
      const dur = Date.now() - t0
      entry.lastTickAt = t0
      // Only log if a tick is unusually slow vs its period (might indicate a problem)
      if (dur > Math.max(2000, ms * 2)) {
        _log('warn', label, `tick took ${dur}ms (period=${ms}ms)`)
      }
    } catch (err) {
      entry.errCount++
      _log('error', label, `tick error #${entry.errCount}: ${err.message}`)
    } finally {
      entry.running = false
    }
  }
  entry.id = setInterval(tick, ms)
  _intervals.set(label, entry)
  return entry.id
}

function after(label, ms, fn) {
  if (_stopped) return null
  if (_timeouts.has(label)) {
    clearTimeout(_timeouts.get(label))
    _timeouts.delete(label)
  }
  const id = setTimeout(async () => {
    _timeouts.delete(label)
    try { await fn() }
    catch (err) { _log('error', label, `error: ${err.message}`) }
  }, ms)
  _timeouts.set(label, id)
  return id
}

function stopAll() {
  for (const [, entry] of _intervals) clearInterval(entry.id)
  for (const [, id] of _timeouts) clearTimeout(id)
  _log('info', 'registry', `stopped ${_intervals.size} interval(s), ${_timeouts.size} timeout(s)`)
  _intervals.clear()
  _timeouts.clear()
}

function snapshot() {
  return {
    intervals: Array.from(_intervals.entries()).map(([label, e]) => ({
      label,
      periodMs: e.ms,
      running: e.running,
      lastTickAt: e.lastTickAt ? new Date(e.lastTickAt).toISOString() : null,
      errCount: e.errCount,
    })),
    timeouts: Array.from(_timeouts.keys()),
    stopped: _stopped,
  }
}

// Hook clean shutdown — Railway sends SIGTERM on redeploy
let _signalsBound = false
function bindSignals() {
  if (_signalsBound) return
  _signalsBound = true
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      _log('info', 'registry', `received ${sig}, stopping schedulers`)
      _stopped = true
      stopAll()
      // give a beat for graceful shutdown then exit
      setTimeout(() => process.exit(0), 200)
    })
  }
}
bindSignals()

module.exports = { every, after, stopAll, snapshot }
