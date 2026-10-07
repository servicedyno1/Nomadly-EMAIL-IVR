// Live end-to-end check of one reseller domain on branded NS. Usage: node scripts/branded_ns_domain_check.js <domain> [--tick]
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios')
const { MongoClient } = require('mongodb')
const { probes } = require('../js/ns-pilot')

const domain = String(process.argv[2] || '').toLowerCase()
const doTick = process.argv.includes('--tick')
const GLUE = { 'ns1.hosta.sh': '172.64.35.177', 'ns2.hosta.sh': '108.162.194.151' }
const cfH = { 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY }

;(async () => {
  if (!domain) throw new Error('domain required')
  const c = await MongoClient.connect(process.env.RESELLER_DB_URL || process.env.MONGO_URL)
  const db = c.db(process.env.RESELLER_DB_NAME || process.env.DB_NAME)

  if (doTick) {
    const adminKey = String(process.env.SESSION_SECRET || '').slice(0, 16)
    const t = await axios.post(`http://127.0.0.1:${process.env.PORT || 5000}/admin/branded-ns/tick`, null, { params: { domain }, headers: { 'x-admin-key': adminKey }, timeout: 90000 })
    console.log('TICK', JSON.stringify(t.data))
  }

  const doc = await db.collection('brandedNsDomains').findOne({ _id: domain })
  console.log('WORKER', doc ? JSON.stringify({ status: doc.status, cfZoneId: doc.cfZoneId, cfNameservers: doc.cfNameservers, lastZoneStatus: doc.lastZoneStatus, lastError: doc.lastError, switchedAt: doc.switchedAt, nextCheckAt: doc.nextCheckAt }) : 'no doc')
  if (doc && doc.history) console.log('HISTORY', (doc.history || []).slice(-6).map((h) => `${new Date(h.at).toISOString()} ${h.msg || h.message || ''}`).join(' | '))

  const zr = await axios.get('https://api.cloudflare.com/client/v4/zones', { headers: cfH, params: { name: domain } })
  const z = zr.data.result[0]
  console.log('CF_ZONE', z ? `${z.status} assigned=${z.name_servers.join(',')} activated_on=${z.activated_on}` : 'missing')

  const del = await probes.registryDelegation(domain)
  console.log('REGISTRY', JSON.stringify({ ok: del.ok, server: del.server, nameservers: del.nameservers }))

  for (const [ns, ip] of Object.entries(GLUE)) {
    const r = await probes.rawQuery(ip, domain, 'A', { rd: false })
    const ips = (r.answers || []).filter((a) => a.type === 'A').map((a) => a.data)
    console.log('GLUE_ANSWER', ns, ip, `rcode=${r.rcode} aa=${r.aa}`, ips.join('/') || '-', ips.length && ips.every(probes.isCloudflareIp) ? 'CF-EDGE' : (ips.length ? 'ORIGIN-LEAK' : 'NO-ANSWER'))
  }

  for (const p of ['cloudflare', 'google']) {
    const r = await probes.doh(domain, 'A', p)
    console.log('PUBLIC', p, (r.answers || []).join('/') || `status=${r.status}`)
  }

  for (const scheme of ['http', 'https']) {
    try {
      const r = await axios.get(`${scheme}://${domain}/`, { timeout: 15000, maxRedirects: 0, validateStatus: () => true })
      console.log('EDGE', scheme, r.status, `server=${r.headers.server} cf-ray=${r.headers['cf-ray'] || '-'}`)
    } catch (e) { console.log('EDGE', scheme, 'ERR', e.code || e.message) }
  }
  process.exit(0)
})().catch((e) => { console.error('ERR', e.response?.data || e.message); process.exit(1) })
