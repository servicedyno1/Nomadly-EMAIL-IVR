require("../log-redact.js").installConsoleRedaction()
/* global process */
// READ-ONLY probe: create a tiny direct-crypto payment to inspect the FULL
// response shape — specifically whether DynoPay returns a webhook signing
// secret (whsec_) at payment-create time. No funds move; this only mints an
// address. Prints redacted output.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../backend/.env') })
const axios = require('axios')

const baseUrl = process.env.DYNO_PAY_BASE_URL
const apiKey = process.env.DYNO_PAY_API_KEY

function redact(obj) {
  const s = JSON.stringify(obj, null, 2)
  return s.replace(/(dpk_[a-z]+_)[A-Za-z0-9]+/g, '$1…').replace(/(whsec_)[A-Za-z0-9]+/g, '$1…KEEP_THIS_SECRET')
}

;(async () => {
  console.log('BASE_URL =', baseUrl)
  const url = `${baseUrl}/user/cryptoPayment`
  try {
    const resp = await axios.post(url, {
      amount: 1,
      currency: 'USDT-TRC20',
      redirect_uri: 'https://example.com/done',
      webhook_url: 'https://example.com/webhook-probe',
      meta_data: { probe: true, refId: 'inspect-' + Date.now() },
    }, {
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': apiKey },
    })
    console.log('HTTP', resp.status)
    console.log('--- TOP-LEVEL KEYS ---', Object.keys(resp.data || {}))
    const data = resp.data?.data || {}
    console.log('--- data KEYS ---', Object.keys(data))
    // Flag any secret-ish fields
    const secretish = Object.keys(data).filter(k => /secret|whsec|sign|hmac/i.test(k))
    console.log('--- secret-ish fields in data ---', secretish.length ? secretish : 'NONE')
    console.log('--- FULL RESPONSE (redacted) ---')
    console.log(redact(resp.data))
    // Also probe the recommended verify-by-id endpoint if we got a payment_id
    const pid = data.payment_id || data.id
    if (pid) {
      try {
        const st = await axios.get(`${baseUrl}/user/getPaymentStatus/${pid}`, {
          headers: { accept: 'application/json', 'x-api-key': apiKey },
        })
        console.log('--- getPaymentStatus/:id KEYS ---', Object.keys(st.data?.data || st.data || {}))
        console.log(redact(st.data))
      } catch (e) {
        console.log('getPaymentStatus/:id error', e?.response?.status, e?.response?.data?.message || e.message)
      }
    }
  } catch (e) {
    console.log('CREATE error', e?.response?.status, JSON.stringify(e?.response?.data || e.message))
  }
})()
