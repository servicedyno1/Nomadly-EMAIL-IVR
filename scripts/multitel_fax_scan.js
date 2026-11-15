// Read-only MultiTEL scan: which countries/number types support fax (T.38) and what they cost.
// Run from an app release dir with its env loaded:
//   TMPDIR=/tmp/mtscan COUNTRIES=US,CA,... node scripts/multitel_fax_scan.js > out.json
// (own TMPDIR so a 403 pause file never blocks the live app). Samples up to SAMPLE areas per number type;
// features + prices come from one sample number (getnumbers) or the prefix info for order-only prefixes.
const mt = require('../js/multitel')
const SAMPLE = Number(process.env.SAMPLE || 5)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ISO = (process.env.COUNTRIES || '').split(',').filter(Boolean)
const get = async (path) => { const r = await mt.api('get', path); await sleep(350); return r?.response }

async function sample(a) {
  const pre = await get(`getprefixes/${a.uuid}`)
  const p = (Array.isArray(pre) ? pre : []).find(x => +x.available > 0) || (Array.isArray(pre) ? pre[0] : null)
  if (!p) return null
  if (String(p.returns_numbers) === '0') {
    const info = await get(`getprefix/${p.uuid}`)
    return { features: [].concat(info?.features || []).map(String), prices: (info?.prices || []).map(x => ({ monthly: +x.monthly_price, setup: +x.setup_price || 0, perMin: +x.per_minute || 0, ch: +x.channels || 0 })), reg: String(p.needs_registration) === '1' }
  }
  const n = (await get(`getnumbers/${p.uuid}/1`) || [])[0]
  if (!n) return null
  return { features: [].concat(n.features || []).map(String), prices: (n.price || []).map(x => ({ monthly: +x.monthly_price, setup: +x.setup_price || 0, perMin: +x.per_minute || 0, ch: +x.channels || 0 })), reg: String(n.restrictions?.needs_registration) === '1' }
}

;(async () => {
  const out = {}
  for (const cc of ISO) {
    let areas
    try { areas = await get(`getareas/${cc}`) } catch (e) { console.error(cc, e.message); if (/auth/.test(e.message)) break; continue }
    const byType = {}
    for (const a of (Array.isArray(areas) ? areas : []).filter(a => +a.available > 0)) (byType[String(a.number_type || a.area_type || 'other').toLowerCase().replace(/[^a-z]/g, '')] ||= []).push(a)
    for (const [type, list] of Object.entries(byType)) {
      const t = (out[cc] ||= {})[type] = { areas: list.length, stock: list.reduce((s, a) => s + +a.available, 0), sampled: 0, fax: 0, faxAreas: [], cheapest: [], reg: 0 }
      for (const a of list.sort((x, y) => +y.available - +x.available).slice(0, SAMPLE)) {
        let s = null
        try { s = await sample(a) } catch (e) { console.error(cc, type, e.message); if (/auth/.test(e.message)) break; continue }
        if (!s) continue
        t.sampled++
        if (!s.features.includes('t38')) continue
        t.fax++
        if (t.faxAreas.length < 4) t.faxAreas.push(a.name)
        const c = [...s.prices].sort((x, y) => (x.ch - y.ch) || (x.monthly - y.monthly))[0]
        if (c) t.cheapest.push(c)
        if (s.reg) t.reg++
      }
    }
    console.error('done', cc)
  }
  console.log(JSON.stringify(out))
  process.exit(0)
})()
