// Verifies pay-dynopay.js builds URLs from DYNO_PAY_BASE_URL (Noteller rename) and log-redact keeps noteller hosts. No network calls.
process.env.DYNO_PAY_BASE_URL = 'https://noteller.com/api'
process.env.DYNO_PAY_API_KEY = process.env.DYNO_PAY_API_KEY || 'TEST_KEY'
const axios = require('axios')
const calls = []
axios.request = async (opts) => { calls.push(opts); return { data: { data: {} } } }
const assert = require('assert')
const pay = require('../pay-dynopay')
const { redactDomains } = require('../log-redact')
;(async () => {
  let pass = 0, fail = 0
  const t = (name, fn) => { try { fn(); pass++; console.log('PASS', name) } catch (e) { fail++; console.log('FAIL', name, e.message) } }
  await pay.getDynopayCryptoAddress(10, 'BTC', 'https://x.test/wh', {}, 'TEST_OVERRIDE').catch(() => {})
  await pay.getDynopayCryptoPaymentStatus('addr123').catch(() => {})
  await pay.getDynopayPaymentStatusById('pid456').catch(() => {})
  const urls = calls.map(c => c.url)
  console.log('URLs:', urls, 'headers0:', calls[0] && Object.keys(calls[0].headers || {}))
  t('cryptoPayment url', () => assert.ok(urls.includes('https://noteller.com/api/user/cryptoPayment')))
  t('getCryptoTransaction url', () => assert.ok(urls.includes('https://noteller.com/api/user/getCryptoTransaction/addr123')))
  t('getPaymentStatus url', () => assert.ok(urls.includes('https://noteller.com/api/user/getPaymentStatus/pid456')))
  t('no dynopay.com host', () => assert.ok(urls.every(u => !u.includes('dynopay.com'))))
  t('x-api-key header', () => assert.ok(calls.every(c => c.headers && c.headers['x-api-key'])))
  for (const h of ['noteller.com', 'api.noteller.com', 'dynopay.com']) {
    t(`keep ${h}`, () => assert.strictEqual(redactDomains(`calling ${h}/api now`), `calling ${h}/api now`))
  }
  t('customer domain still redacted', () => assert.ok(!redactDomains('visit mycustomer-shop.com').includes('mycustomer-shop.com')))
  console.log(`noteller: ${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
