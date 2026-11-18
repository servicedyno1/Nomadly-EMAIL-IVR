// SignalWire "maximum allowed phone numbers": stock is hidden after the first refusal and comes back by itself.
const os = require('os'), path = require('path'), fs = require('fs'), assert = require('assert')
process.env.SIGNALWIRE_FULL_FILE = path.join(os.tmpdir(), `sw-full-test-${process.pid}.json`)
Object.assign(process.env, { SIGNALWIRE_PROJECT_ID: 'p', SIGNALWIRE_API_TOKEN: 't', SIGNALWIRE_SPACE_URL: 'x.signalwire.com', SIGNALWIRE_ENABLED: 'true' })

let ownedRows = [{ number: '+15550000001', id: 'a' }, { number: '+15550000002', id: 'b' }]
let refuse = true
const calls = { post: 0, search: 0 }
const axios = require('axios')
axios.create = () => ({
  get: async (url) => {
    if (url.includes('/search')) { calls.search++; return { data: { data: [{ e164: '+16672793206', country_code: 'US', capabilities: ['voice'] }] } } }
    return { data: { data: ownedRows, links: {} } }
  },
  post: async () => {
    calls.post++
    if (refuse) { const e = new Error('422'); e.response = { data: { errors: [{ detail: 'Number Your Space has reached maximum allowed phone numbers. Please contact Support.' }] } }; throw e }
    return { data: { id: 'new', number: '+16672793206' } }
  },
  put: async () => ({ data: {} }),
})
const rest = require('../signalwire/rest')
let pass = 0, fail = 0
const t = async (name, fn) => { try { await fn(); pass++; console.log(`✅ ${name}`) } catch (e) { fail++; console.log(`❌ ${name}: ${e.message}`) } }

;(async () => {
  let alerted = null
  rest.setOnFull((count, phone) => { alerted = { count, phone } })
  await t('before any refusal: numbers are offered', async () => {
    assert.strictEqual(rest.isFull(), false)
    assert.strictEqual((await rest.searchNumbers('US', 'local', '667', 3)).length, 1)
  })
  await t('refused for the number limit: no order, admin told once with the held count', async () => {
    assert.strictEqual(await rest.buyNumber('+16672793206'), null)
    assert.deepStrictEqual(alerted, { count: 2, phone: '+16672793206' })
    assert.strictEqual(rest.isFull(), true)
  })
  await t('while full: search offers nothing from SignalWire (no call made)', async () => {
    const before = calls.search
    assert.deepStrictEqual(await rest.searchNumbers('US', 'local', '667', 3), [])
    assert.strictEqual(calls.search, before)
  })
  await t('a number was released: stock comes back by itself', async () => {
    ownedRows = ownedRows.slice(0, 1)
    await rest.refreshOwned(true)
    assert.strictEqual(rest.isFull(), false)
  })
  await t('a buy that works clears the flag', async () => {
    rest.setFull(true); assert.strictEqual(rest.isFull(), true)
    refuse = false
    assert.ok(await rest.buyNumber('+16672793206'))
    assert.strictEqual(rest.isFull(), false)
  })
  await t('another error (number gone) does not hide stock', async () => {
    refuse = true
    const c = axios.create; axios.create = () => ({ ...c(), post: async () => { const e = new Error('x'); e.response = { data: { errors: [{ detail: 'Number is not available' }] } }; throw e } })
    assert.strictEqual(await rest.buyNumber('+16672793209'), null)
    assert.strictEqual(rest.isFull(), false)
    axios.create = c
  })
  try { fs.unlinkSync(process.env.SIGNALWIRE_FULL_FILE) } catch (_) {}
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})()
