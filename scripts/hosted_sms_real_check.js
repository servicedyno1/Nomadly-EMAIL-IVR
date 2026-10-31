const fs = require('fs'); const axios = require('axios')
const env = Object.fromEntries(fs.readFileSync('/app/backend/.env', 'utf8').split('\n').map(l => l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m => [m[1], m[2].replace(/^"|"$/g, '')]))
const H = { headers: { Authorization: `Bearer ${env.TELNYX_API_KEY}` }, timeout: 20000 }
const API = 'https://api.telnyx.com/v2', P = '+18557574001'
const err = e => JSON.stringify(e.response?.data?.errors || e.message).slice(0, 400)
;(async () => {
  console.log('key present:', !!env.TELNYX_API_KEY, '| messaging profile set:', !!env.TELNYX_MESSAGING_PROFILE_ID)
  try { const r = await axios.post(`${API}/messaging_hosted_number_orders/eligibility_numbers_check`, { phone_numbers: [P] }, H); console.log('eligibility:', JSON.stringify(r.data).slice(0, 500)) } catch (e) { console.log('eligibility error:', err(e)) }
  try { const r = await axios.get(`${API}/phone_numbers?filter[phone_number]=${encodeURIComponent(P)}`, H); console.log('already on our Telnyx account:', (r.data.data || []).length > 0) } catch (e) { console.log('lookup error', err(e)) }
  try { const r = await axios.get(`${API}/messaging_hosted_number_orders?page[size]=20`, H); console.log('existing hosted orders for it:', (r.data.data || []).filter(o => (o.phone_numbers || []).some(n => n.phone_number === P)).map(o => [o.id, o.status])) } catch (e) { console.log('orders error', err(e)) }
})()
