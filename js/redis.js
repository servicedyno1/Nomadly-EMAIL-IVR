'use strict'
// Optional Redis (REDIS_URL): shared rate limits, locks, job heartbeats and state across all bots and both deploy slots.
// On only where REDIS_ENABLED=true (the droplet apps) so a preview copy never shares production keys or locks.
// Every helper fails open — it returns null when Redis is off or down, and callers keep their in-process behaviour.
const Redis = require('ioredis')

const log = (...a) => console.log('[Redis]', ...a)
const ID = `${process.pid}-${Math.random().toString(36).slice(2, 8)}`
const scope = () => process.env.DB_NAME || 'app'
const gk = (...p) => ['nomadly', 'g', ...p].join(':') // shared by every app (provider-wide limits)
const sk = (...p) => ['nomadly', scope(), ...p].join(':') // one app (its own database)
const bus = () => sk('bus')

const enabled = () => !!process.env.REDIS_URL && process.env.REDIS_ENABLED === 'true'
let cli = null, sub = null, lastErr = 0, subscribed = null
const readyFns = [], maps = new Map(), wakers = new Map()
function onErr(e) { if (Date.now() - lastErr > 60000) { lastErr = Date.now(); log('unavailable:', e.message) } }
function onMessage(_ch, raw) {
  let m; try { m = JSON.parse(raw) } catch (_) { return }
  if (m.t === 'wake') return wakers.get(m.label)?.()
  if (m.t !== 'map' || m.from === ID) return
  const x = maps.get(m.n); if (!x) return
  m.op === 'del' ? x.del(m.k) : x.put(m.k, m.v)
}
function connect() {
  if (cli || !enabled()) return
  cli = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, connectTimeout: 3000, commandTimeout: 1500, retryStrategy: (n) => Math.min(n * 500, 10000) })
  cli.on('error', onErr)
  cli.on('ready', () => {
    log('connected')
    if (!sub) { sub = cli.duplicate({ enableOfflineQueue: true, maxRetriesPerRequest: null }); sub.on('error', onErr); sub.on('message', onMessage) }
    // Load shared state only once live updates are flowing, so nothing written in between is missed.
    subscribed = sub.subscribe(bus()).catch(onErr).then(() => { for (const fn of readyFns) Promise.resolve(fn(cli)).catch(onErr) })
  })
}
const client = () => { connect(); return cli?.status === 'ready' ? cli : null }
const onReady = (fn) => { readyFns.push(fn); if (client() && subscribed) subscribed.then(() => fn(cli)).catch(onErr) }
const safe = async (fn) => { const c = client(); if (!c) return null; try { return await fn(c) } catch (e) { onErr(e); return null } }

// Shared lane: the caller's turn comes `gap` ms after the previous one. → ms to wait, -1 if longer than maxWait, null = no Redis.
const GATE = `local now=tonumber(ARGV[1]) local gap=tonumber(ARGV[2]) local maxw=tonumber(ARGV[3])
local t=math.max(now, tonumber(redis.call('GET', KEYS[1]) or '0'))
if t-now > maxw then return -1 end
redis.call('SET', KEYS[1], t+gap, 'PX', t-now+gap+1000) return t-now`
const gate = (name, gapMs, maxWaitMs) => safe(c => c.eval(GATE, 1, gk('gate', name), Date.now(), gapMs, Math.max(0, maxWaitMs)))
// Provider said "slow down": nobody gets a turn for `ms`.
const PUSH = `local t=tonumber(ARGV[1]) if t > tonumber(redis.call('GET', KEYS[1]) or '0') then redis.call('SET', KEYS[1], t, 'PX', tonumber(ARGV[2])+1000) end return 1`
const pushBack = (name, ms) => safe(c => c.eval(PUSH, 1, gk('gate', name), Date.now() + ms, ms))
// Fixed-window counter → true while under `limit` per window.
const take = (name, limit, windowMs) => safe(async c => { const k = gk('rate', name, Math.floor(Date.now() / windowMs)); const [[, n]] = await c.multi().incr(k).pexpire(k, windowMs + 1000).exec(); return n <= limit })

// First caller in `ttl` gets true (shared alert dedupe, one cron run per fire).
const once = (name, ttlMs) => safe(async c => (await c.set(sk('once', name), '1', 'PX', ttlMs, 'NX')) === 'OK')
const forget = (name) => safe(c => c.del(sk('once', name)))
const lock = (name, ttlMs) => safe(async c => ((await c.set(sk('lock', name), ID, 'PX', ttlMs, 'NX')) === 'OK' ? ID : false))
const UNLOCK = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`
const unlock = (name, token) => (token ? safe(c => c.eval(UNLOCK, 1, sk('lock', name), token)) : null)

// Job heartbeats (one hash per app) for the stuck-job check.
const beat = (label, data) => safe(c => c.hset(sk('jobs'), label, JSON.stringify(data)))
const dropJob = (label) => safe(c => c.hdel(sk('jobs'), label))
const jobs = () => safe(async c => Object.fromEntries(Object.entries(await c.hgetall(sk('jobs'))).map(([k, v]) => { try { return [k, JSON.parse(v)] } catch (_) { return [k, null] } })))
// Run a singleton job now on the active slot (`label` as given to singletonInterval).
const wake = (label) => safe(c => c.publish(bus(), JSON.stringify({ t: 'wake', label })))
const onWake = (label, fn) => { wakers.set(label, fn); connect() }

// A Map that every slot of this app shares: writes go to Redis and to the other slots; a restart reloads it (entries live ttl).
function sharedMap(name, ttlMs = 24 * 3600000) {
  const m = new Map(), h = sk('map', name)
  const put = Map.prototype.set.bind(m), del = Map.prototype.delete.bind(m)
  const send = (op, k, v) => safe(c => {
    const t = c.multi(); op === 'set' ? t.hset(h, k, JSON.stringify({ v, x: Date.now() + ttlMs })) : t.hdel(h, k)
    return t.pexpire(h, ttlMs).publish(bus(), JSON.stringify({ t: 'map', n: name, op, k, v, from: ID })).exec()
  })
  m.set = (k, v) => { put(k, v); send('set', k, v); return m }
  m.delete = (k) => { const had = del(k); send('del', k); return had }
  maps.set(name, { put, del })
  onReady(async c => {
    const now = Date.now(), dead = []
    for (const [k, j] of Object.entries(await c.hgetall(h))) { try { const { v, x } = JSON.parse(j); if (x > now) { if (!m.has(k)) put(k, v) } else dead.push(k) } catch (_) { dead.push(k) } }
    if (dead.length) await c.hdel(h, ...dead)
  })
  return m
}

const close = async () => { await Promise.all([cli, sub].filter(Boolean).map(x => x.quit().catch(() => {}))); cli = sub = null }

module.exports = { enabled, client, onReady, gate, pushBack, take, once, forget, lock, unlock, beat, jobs, dropJob, wake, onWake, sharedMap, close, _key: { gk, sk } }
