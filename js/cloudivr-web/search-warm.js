'use strict'
// Number search answers from a short in-memory cache that is refreshed in the background, so a search takes a second or two.
// In memory on purpose: the providers remember which numbers they offered in this process, so a buy finds its provider.
const FRESH_MS = 3 * 60000
const EMPTY_FRESH_MS = 30000
const KEEP_MS = 20 * 60000
const WARM_EVERY_MS = 10 * 60000
const RECENT_MS = 2 * 3600000
const POPULAR = ['212', '213', '214', '305', '310', '312', '323', '346', '404', '415', '424', '469', '512', '602', '617', '646', '702', '713', '718', '786', '818', '832', '917', '416', '647']

const keyOf = (a) => [a.country, a.type, a.areaCode || '', a.texting ? 1 : 0].join('|')

function create(fetchRaw, { log = () => {} } = {}) {
  const cache = new Map() // key → { at, list, job }
  const recent = new Map() // key → { a, at }

  const refresh = (k, a) => {
    const c = cache.get(k)
    if (c?.job) return c.job
    const job = Promise.resolve().then(() => fetchRaw(a)).then((list) => {
      cache.set(k, { at: Date.now(), list: list || [] })
      return list || []
    }, (e) => {
      const prev = cache.get(k)
      if (prev?.list) cache.set(k, { at: prev.at, list: prev.list }); else cache.delete(k)
      throw e
    })
    cache.set(k, { ...(c || { at: 0, list: null }), job })
    return job
  }

  async function get(a) {
    const k = keyOf(a), now = Date.now()
    recent.set(k, { a, at: now })
    const c = cache.get(k)
    const age = c?.list ? now - c.at : Infinity
    if (age < KEEP_MS) {
      if (age > (c.list.length ? FRESH_MS : EMPTY_FRESH_MS)) refresh(k, a).catch(e => log(`refresh ${k}: ${e.message}`))
      if (c.list.length || age < EMPTY_FRESH_MS) return { list: [...c.list], cached: true, age }
    }
    return { list: [...(await refresh(k, a))], cached: false, age: 0 }
  }

  // Starts a search in the background (e.g. while the customer is still typing); never throws.
  const prefetch = (a) => { const k = keyOf(a); recent.set(k, { a, at: Date.now() }); const c = cache.get(k); if (!c?.list || Date.now() - c.at > FRESH_MS) refresh(k, a).catch(() => {}) }

  // Removes a number everywhere once it is taken.
  const drop = (phone) => { for (const c of cache.values()) if (c.list) c.list = c.list.filter(n => n.phone_number !== phone) }

  async function warm(argsFor) {
    const now = Date.now()
    for (const [k, r] of recent) if (now - r.at > RECENT_MS) recent.delete(k)
    const jobs = new Map(POPULAR.map(ac => { const a = argsFor(['416', '647'].includes(ac) ? 'CA' : 'US', 'local', ac); return [keyOf(a), a] }))
    for (const [k, r] of recent) jobs.set(k, r.a)
    for (const [k, a] of [...jobs].slice(0, 60)) {
      const c = cache.get(k)
      if (c?.list && Date.now() - c.at < FRESH_MS) continue
      await refresh(k, a).catch(e => log(`warm ${k}: ${e.message}`))
    }
  }

  let timer = null
  const start = (argsFor) => {
    if (timer) return
    const run = () => warm(argsFor).catch(e => log(`warm: ${e.message}`))
    setTimeout(run, 20000).unref?.()
    timer = setInterval(run, WARM_EVERY_MS)
    timer.unref?.()
  }

  return { get, prefetch, drop, warm, start, keyOf, _cache: cache }
}

module.exports = { create, keyOf, POPULAR, FRESH_MS, KEEP_MS }
