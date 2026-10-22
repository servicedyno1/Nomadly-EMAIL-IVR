#!/usr/bin/env node
// Sandbox stand-in for the Telnyx endpoints used by js/telnyx-regulatory.js (TELNYX_REG_API_BASE).
// Read-only calls (regulatory_requirements, address validate, GET number_orders of real ids) are proxied to
// the REAL Telnyx API; anything that would create/charge (addresses, documents, requirement_groups,
// number_orders) is answered locally and recorded — nothing is ever bought.
//   start:  node js/tests/mock_telnyx_reg_api.js   (port MOCK_TELNYX_PORT, default 5098)
//   GET  /_calls               → recorded calls [{ ts, method, path, body }]
//   DELETE /_calls             → clear
//   POST /_config {order_status:'pending'|'success'|'failure', order_error:'...'|null, phone_status, requirements_status}
require('dotenv').config({ path: require('path').join(__dirname, '../../backend/.env') })
const http = require('http')
const axios = require('axios')
const PORT = Number(process.env.MOCK_TELNYX_PORT || 5098)
const REAL = 'https://api.telnyx.com/v2'
const calls = []
const orders = new Map()
let cfg = { order_status: 'pending', order_error: null, phone_status: 'pending', requirements_status: 'requirement-info-under-review' }
let n = 1
const id = p => `${p}-mock-${Date.now()}-${n++}`

const server = http.createServer((req, res) => {
  let raw = ''
  req.on('data', d => { raw += d; if (raw.length > 20e6) raw = raw.slice(0, 20e6) })
  req.on('end', async () => {
    const u = new URL(req.url, `http://127.0.0.1:${PORT}`)
    const path = u.pathname.replace(/^\/v2/, '')
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)) }
    let body = {}
    try { body = raw ? JSON.parse(raw) : {} } catch (_) { body = { _raw: raw.slice(0, 200) } }
    if (path === '/_calls') { if (req.method === 'DELETE') { calls.length = 0; return json(200, { ok: true }) } return json(200, calls) }
    if (path === '/_config') { cfg = { ...cfg, ...body }; return json(200, cfg) }
    const rec = { ts: Date.now(), method: req.method, path, query: Object.fromEntries(u.searchParams), body: body.file ? { ...body, file: `<base64 ${body.file.length} chars>` } : body }
    calls.push(rec)
    const proxy = async () => {
      try {
        const r = await axios({ method: req.method, url: REAL + path + u.search, data: raw || undefined, headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 30000, validateStatus: () => true })
        return json(r.status, r.data)
      } catch (e) { return json(502, { errors: [{ detail: e.message }] }) }
    }
    if (req.method === 'GET' && path === '/regulatory_requirements') return proxy()
    if (req.method === 'POST' && path === '/addresses/actions/validate') return proxy()
    if (req.method === 'POST' && path === '/addresses') return json(200, { data: { id: id('addr'), ...body } })
    if (req.method === 'POST' && path === '/documents') return json(200, { data: { id: id('doc'), filename: body.filename, status: 'pending' } })
    if (req.method === 'POST' && path === '/requirement_groups') return json(200, { data: { id: id('rg'), ...body } })
    if (req.method === 'POST' && path === '/number_orders') {
      if (cfg.order_error) return json(422, { errors: [{ detail: cfg.order_error }] })
      const o = { id: id('order'), status: cfg.order_status, phone_numbers: (body.phone_numbers || []).map(p => ({ phone_number: p.phone_number, status: cfg.phone_status, requirements_status: cfg.requirements_status, requirements_met: false })) }
      orders.set(o.id, o)
      return json(200, { data: o })
    }
    const m = path.match(/^\/number_orders\/(.+)$/)
    if (req.method === 'GET' && m) {
      const o = orders.get(decodeURIComponent(m[1]))
      return o ? json(200, { data: { ...o, status: cfg.order_status, phone_numbers: o.phone_numbers.map(p => ({ ...p, status: cfg.phone_status, requirements_status: cfg.requirements_status })) } }) : proxy()
    }
    return json(404, { errors: [{ detail: `mock: ${req.method} ${path} not handled` }] })
  })
})
server.listen(PORT, '127.0.0.1', () => console.log(`[mock-telnyx-reg] listening on http://127.0.0.1:${PORT}`))
