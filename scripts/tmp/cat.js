require('/app/node_modules/dotenv').config({ path: '/app/backend/.env' })
const axios = require('/app/node_modules/axios')
;(async () => {
  const t = (await axios.post('https://api.spenza.com/api/v1.1/auth/token', { key: process.env.SPENZA_API_KEY, secret: process.env.SPENZA_API_SECRET })).data.data.access_token
  const g = async (p) => (await axios.get('https://api.spenza.com' + p, { headers: { Authorization: 'Bearer ' + t } }).catch(e => ({ data: { err: e.response?.status, msg: e.response?.data } }))).data
  for (const c of ['', '&category=SPENZA_PLAN', '&category=MSP_PLAN', '&category=RESELLER_PLAN', '&category=ENDUSER_PLAN', '&category=SIM', '&category=SaaS'])
    { const r = await g('/api/v1.1/plans?page=1&pageSize=100' + c); console.log('PLANS', c || '(default)', JSON.stringify(r.data ?? r).slice(0, 1500)) }
  console.log('SIMPRODUCTS', JSON.stringify((await g('/api/v1.1/sim-products?page=1&pageSize=100')).data).slice(0, 1500))
  console.log('SIP', JSON.stringify(await g('/api/v1/customer/register-sip')).slice(0, 400))
})()
