// Read-only: compare CF account ownership + a live Origin CA dry-probe for working vs failing zones
require('dotenv').config({ path: process.env.ENV_PATH })
const axios = require('axios')
const H = () => ({ 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY })
const B = 'https://api.cloudflare.com/client/v4'
const names = (process.env.NAMES || '').split(',').filter(Boolean)
;(async () => {
  // who am I + which accounts does this key see
  const me = (await axios.get(`${B}/user`, { headers: H() })).data.result
  console.log('user:', me.email, me.id)
  const accts = (await axios.get(`${B}/accounts`, { headers: H(), params: { per_page: 50 } })).data.result
  console.log('accounts visible to key:', accts.map(a => `${a.name}=${a.id}`).join(' | '))
  for (const n of names) {
    const z = (await axios.get(`${B}/zones`, { headers: H(), params: { name: n } })).data.result[0]
    if (!z) { console.log(n, 'NO ZONE'); continue }
    console.log(`\n${n}: zone=${z.id} status=${z.status} account=${z.account?.name}/${z.account?.id} perms=${(z.permissions||[]).includes('#ssl:edit')}`)
    // Origin CA cert LIST for this zone (read-only) with global key
    try {
      const r = await axios.get(`${B}/certificates`, { headers: H(), params: { zone_id: z.id } })
      console.log(`  origin-ca list (global key): ok=${r.data.success} count=${r.data.result.length}`)
    } catch (e) { console.log(`  origin-ca list (global key): ERR ${e.response?.status} ${JSON.stringify(e.response?.data?.errors)}`) }
  }
  process.exit(0)
})().catch(e => { console.error('ERR', e.message, JSON.stringify(e.response?.data || '')); process.exit(1) })
