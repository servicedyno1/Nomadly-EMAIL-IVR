'use strict'
// Bird ⇄ MultiTEL failover: a trunk that refuses FAIL_N calls in a row (within WINDOW_MS) is marked down and new calls
// go to the other trunk. Every PROBE_MS one call tries the original again; when it rings or connects, traffic moves back.
const FAIL_N = () => Math.max(2, Number(process.env.FAILOVER_FAIL_COUNT || 5))
const WINDOW_MS = 2 * 60000
const PROBE_MS = () => Math.max(30000, Number(process.env.FAILOVER_PROBE_MS || 180000))
// Hang-up causes that are the destination's answer, not the trunk refusing us: unallocated, busy, no answer, number changed,
// invalid — and 88, which MultiTEL returns when it won't show that caller ID (a caller-ID problem, not an outage).
const NEUTRAL = new Set([1, 16, 17, 18, 19, 22, 28, 31, 88])

const state = new Map() // trunk → { fails: [ts], down: null | { since, reason, moved, nextProbe } }
let alert = null
const log = (...a) => console.log('[Failover]', ...a)
const st = (t) => state.get(t) || state.set(t, { fails: [], down: null }).get(t)

const BIRD = 'bird'
const MULTITEL = () => process.env.CALL_ENGINE_BACKUP_TRUNK || process.env.CALLER_ID_PASSTHROUGH_TRUNK || null
const defaultTrunk = () => process.env.CALL_ENGINE_TRUNK || (process.env.BIRD_API_KEY ? BIRD : 'didww')
const NAME = (t) => (t === BIRD ? 'Bird' : t === MULTITEL() ? 'MultiTEL' : t)
// BIRD_ONLY=true: no other carrier, no failover (calls fail if Bird is down).
const birdOnly = () => String(process.env.BIRD_ONLY || '').toLowerCase() === 'true' && !!process.env.BIRD_API_KEY
function alt(t) {
  if (birdOnly()) return null
  if (t === BIRD) return MULTITEL()
  if (t === MULTITEL() && process.env.BIRD_API_KEY) return BIRD
  return null
}
const isDown = (t) => !!state.get(t)?.down

// Which trunk a new call should use. { trunk, moved, probe }
function route(want) {
  const s = st(want), other = alt(want)
  if (!s.down || !other || isDown(other)) return { trunk: want, moved: false, probe: false }
  if (Date.now() >= s.down.nextProbe) { s.down.nextProbe = Date.now() + PROBE_MS(); return { trunk: want, moved: false, probe: true } }
  s.down.moved++
  return { trunk: other, moved: true, probe: false }
}

function send(subject, text) {
  log(text.replace(/<[^>]+>/g, ''))
  try { alert?.(subject, text) } catch (e) { log(`alert: ${e.message}`) }
}

// Outcome of one outgoing PSTN leg on a trunk.
function result(trunk, { connected, cause, cancelled }) {
  if (!trunk || !alt(trunk)) return
  const s = st(trunk)
  if (connected) {
    s.fails = []
    if (s.down) {
      const d = s.down; s.down = null
      send(`${NAME(trunk)} is working again`, `✅ <b>${NAME(trunk)} is working again</b>\nCalls are back on ${NAME(trunk)} (custom caller IDs resume).\nIt was down ${Math.round((Date.now() - d.since) / 60000)} min · ${d.moved} call(s) went through ${NAME(alt(trunk))} meanwhile.`)
    }
    return
  }
  if (cancelled || NEUTRAL.has(Number(cause))) return
  const now = Date.now()
  s.fails = s.fails.filter(t => now - t < WINDOW_MS).concat(now)
  if (!s.down && s.fails.length >= FAIL_N()) {
    const other = alt(trunk)
    s.down = { since: now, reason: `${s.fails.length} calls refused in a row (last cause ${cause ?? 'unknown'})`, moved: 0, nextProbe: now + PROBE_MS() }
    send(`${NAME(trunk)} is refusing calls — switched to ${NAME(other)}`, `⚠️ <b>${NAME(trunk)} is refusing calls</b> — ${s.down.reason}.\nNew calls (campaigns included) now go through <b>${NAME(other)}</b>${isDown(other) ? ' — but it is also marked down' : ''}.${trunk === MULTITEL() ? ` Custom caller IDs show the line’s own number until ${NAME(trunk)} is back.` : ''}\nOne test call tries ${NAME(trunk)} every ${Math.round(PROBE_MS() / 60000)} min; you’ll get a message when it works again.\nCheck the ${NAME(trunk)} account (balance, billing, limits).`)
  }
}

const status = () => [...state.entries()].map(([t, s]) => ({ trunk: t, name: NAME(t), down: !!s.down, since: s.down?.since || null, reason: s.down?.reason || null, moved: s.down?.moved || 0, recentFails: s.fails.length }))
const reset = () => state.clear()

module.exports = { route, result, alt, isDown, status, reset, defaultTrunk, birdOnly, setAlert: (fn) => { alert = fn }, BIRD, MULTITEL }
