// Read-only: Spenza users endpoint shape + how many local lines are linked to a Spenza user.
require('dotenv').config({ path: '/app/backend/.env' })
const axios = require('axios'); const { MongoClient } = require('mongodb')
;(async () => {
  const t = await axios.post('https://api.spenza.com/api/v1.1/auth/token', { key: process.env.SPENZA_API_KEY, secret: process.env.SPENZA_API_SECRET }, { timeout: 15000 })
  const H = { Authorization: 'Bearer ' + t.data.data.access_token }
  const r = await axios.get('https://api.spenza.com/api/v1.1/users?page=1&pageSize=5', { headers: H, timeout: 15000 }).catch(e => e.response)
  const rows = Array.isArray(r?.data?.data) ? r.data.data : (r?.data?.data?.items || [])
  console.log('users', r?.status, 'count', rows.length, 'fields', Object.keys(rows[0] || {}).join(','))
  const c = await MongoClient.connect(process.env.MONGO_URL); const col = c.db(process.env.DB_NAME).collection('esimLines')
  console.log('linked', await col.countDocuments({ 'spenzaUser.linkedAt': { $ne: null } }), 'active', await col.countDocuments({ status: { $in: ['active', 'suspended'] }, iccid: { $ne: null } }))
  const one = await col.findOne({ 'spenzaUser.linkedAt': { $ne: null } }, { projection: { spenzaUser: 1, simulated: 1 } })
  console.log(one ? { private: one.spenzaUser.private, simulated: one.simulated, domain: one.spenzaUser.email.split('@')[1] } : null)
  await c.close(); process.exit(0)
})().catch(e => { console.error(e.message); process.exit(1) })
