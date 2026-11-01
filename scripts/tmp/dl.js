require('/app/node_modules/dotenv').config({ path: '/app/backend/.env' })
const axios = require('/app/node_modules/axios')
;(async () => {
  const t = (await axios.post('https://api.spenza.com/api/v1.1/auth/token', { key: process.env.SPENZA_API_KEY, secret: process.env.SPENZA_API_SECRET })).data.data.access_token
  const g = async (p) => (await axios.get('https://api.spenza.com' + p, { headers: { Authorization: 'Bearer ' + t } }).catch(e => ({ data: { err: e.response?.status, msg: e.response?.data } }))).data
  const r = await g('/api/v1.1/webhook-deliveries?page=1&pageSize=100')
  const items = Array.isArray(r.data) ? r.data : r.data?.items || []
  console.log('count', items.length, JSON.stringify(r.meta || {}))
  for (const x of items.slice(0, 40)) { const b = x.payload?.data || x.payload || {}; console.log(x.id, x.status || x.deliveryStatus, x.createdAt, x.eventType || x.event, (b.From || '').slice(-4), JSON.stringify(b.To), String(b.Message_Body || '').slice(0, 30)) }
  if (items[0]) console.log('keys', Object.keys(items[0]))
})()
