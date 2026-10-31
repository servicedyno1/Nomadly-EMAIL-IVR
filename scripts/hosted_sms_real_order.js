const fs = require('fs'); const axios = require('axios')
const env = Object.fromEntries(fs.readFileSync('/app/backend/.env', 'utf8').split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^"|"$/g, '')]))
const H = { headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` }, timeout: 20000 }
const API = 'https://api.telnyx.com/v2', P = '+18557574001'
const err = e => `${e.response?.status} ${JSON.stringify(e.response?.data?.errors || e.message).slice(0, 500)}`
;(async () => {
  let id
  try {
    const r = await axios.post(`${API}/messaging_hosted_number_orders`, { phone_numbers: [P], messaging_profile_id: env.TELNYX_MESSAGING_PROFILE_ID }, H)
    id = r.data.data.id; console.log('ORDER CREATED', id, 'status:', r.data.data.status, JSON.stringify(r.data.data.phone_numbers))
  } catch (e) { console.log('create error:', err(e)); return }
  fs.writeFileSync('/app/scripts/.hosted_order_id', id)
  try { const r = await axios.get(`${API}/messaging_hosted_number_orders/${id}`, H); console.log('order now:', JSON.stringify(r.data.data).slice(0, 700)) } catch (e) { console.log('get error:', err(e)) }
})()
