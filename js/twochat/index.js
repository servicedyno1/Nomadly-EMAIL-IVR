'use strict'
// 2Chat virtual numbers forward to an Infobip landing number of ours; the forwarded leg shows the 2Chat number
// as caller, so the real caller is read from 2Chat's live call history.
const axios = require('axios')

const log = (...a) => console.log('[2Chat]', ...a)

async function realCaller(number) {
  const key = process.env.TWOCHAT_API_KEY
  if (!key) return null
  try {
    const r = await axios.get('https://api.p.2chat.io/open/voip/call-history', { params: { page_number: 0 }, headers: { 'X-User-API-Key': key }, timeout: 2500 })
    const c = (r.data?.cdrs || []).find(c => c.direction === 'I' && c.received_on_number === number && Date.now() - new Date(c.created_at).getTime() < 60000)
    return /^\+\d{6,15}$/.test(String(c?.from || '')) && c.from !== number ? c.from : null
  } catch (e) { log('call history:', e.response?.status || e.message); return null }
}

module.exports = { realCaller }
