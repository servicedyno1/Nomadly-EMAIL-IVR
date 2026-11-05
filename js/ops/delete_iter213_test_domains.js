// One-off (2026-11-05): delete the 2 domains accidentally registered by test run iter213 + their CF zones.
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') })
const axios = require('axios')
const op = require('../op-service')
const cf = require('../cf-service')

const TARGETS = [
  { domain: 'iter213auto87794.com', opId: 30541484, zone: 'ede4403bf38b3b3a9ff1e101e0a54e1a' },
  { domain: 'iter213auto89550.com', opId: 30541554, zone: '1f0d41c20728e02e7d39c4f3194abed5' },
]

;(async () => {
  const token = await op.authenticate()
  const headers = { Authorization: `Bearer ${typeof token === 'string' ? token : token?.token}` }
  for (const t of TARGETS) {
    const info = await op.getDomainInfo(t.domain)
    console.log(t.domain, 'OP info:', info?.domainId, info?.status)
    if (info?.domainId && Number(info.domainId) === t.opId) {
      try {
        const r = await axios.delete(`https://api.openprovider.eu/v1beta/domains/${t.opId}`, { headers, timeout: 30000 })
        console.log(t.domain, 'OP delete:', r.data?.code, r.data?.desc || '', JSON.stringify(r.data?.data || {}))
      } catch (e) { console.log(t.domain, 'OP delete error:', e.response?.status, JSON.stringify(e.response?.data || e.message)) }
    } else console.log(t.domain, 'OP id mismatch/not found — skipped')
    const z = await cf.deleteZone(t.zone)
    console.log(t.domain, 'CF zone delete:', JSON.stringify(z))
  }
})()
