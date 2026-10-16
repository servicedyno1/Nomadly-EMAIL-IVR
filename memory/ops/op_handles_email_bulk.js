// Bulk-update every OpenProvider handle still on the lost cloakhost@tutamail.com → hosta1@proton.me
// Usage on droplet (app-wl release cwd): CONFIRM=1 node op_handles_email_bulk.js   (dry-run without CONFIRM)
require('dotenv').config({ path: process.env.ENV_PATH })
const axios = require('axios')
const op = require(process.env.REL + '/js/op-service.js')
const OLD = 'cloakhost@tutamail.com'
const NEW = 'hosta1@proton.me'
const B = 'https://api.openprovider.eu'
;(async () => {
  const h = { Authorization: 'Bearer ' + (await op.authenticate()), 'Content-Type': 'application/json' }
  const list = (await axios.get(`${B}/v1beta/customers`, { headers: h, params: { limit: 500, email_pattern: OLD } })).data.data.results || []
  const targets = list.filter(c => (c.email || '').toLowerCase() === OLD && !c.is_deleted)
  console.log(`found ${targets.length} handles on ${OLD}${process.env.CONFIRM ? '' : ' (dry-run)'}`)
  if (!process.env.CONFIRM) return process.exit(0)
  const failed = []
  let done = 0
  for (const c of targets) {
    try {
      const r = await axios.put(`${B}/v1beta/customers/${c.handle}`, { email: NEW }, { headers: h, timeout: 20000 })
      if (r.data?.code !== 0) throw new Error(`code ${r.data?.code} ${r.data?.desc || ''}`)
      done++
    } catch (e) {
      failed.push(`${c.handle}: ${e.response?.data?.desc || e.message}`)
    }
    await new Promise(r => setTimeout(r, 250))
  }
  const left = (await axios.get(`${B}/v1beta/customers`, { headers: h, params: { limit: 500, email_pattern: OLD } })).data.data.results || []
  const now = (await axios.get(`${B}/v1beta/customers`, { headers: h, params: { limit: 500, email_pattern: NEW } })).data.data.total
  console.log(`updated=${done} failed=${failed.length} remaining_on_old=${left.length} total_on_new=${now}`)
  failed.forEach(f => console.log('FAIL', f))
  process.exit(0)
})().catch(e => { console.error('ERR', e.message, JSON.stringify(e.response?.data || '')); process.exit(1) })
