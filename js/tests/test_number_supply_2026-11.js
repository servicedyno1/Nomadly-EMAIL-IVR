// SignalWire "space is full" flag + complete area-code table. Run: node js/tests/test_number_supply_2026-11.js
process.env.SIGNALWIRE_FULL_FILE = require('path').join(require('os').tmpdir(), `sw-full-test-${process.pid}.json`)
process.env.SIGNALWIRE_PROJECT_ID = 'p'; process.env.SIGNALWIRE_API_TOKEN = 't'; process.env.SIGNALWIRE_SPACE_URL = 'x.invalid'
const assert = require('assert')
const rest = require('../signalwire/rest')
let pass = 0
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log('✅', name) }, (e) => { console.log('❌', name, e.message); process.exitCode = 1 })
;(async () => {
  await ok('area codes: every US/CA code maps to its state (667 MD, 225 LA, 501 AR, 416 ON)', () => {
    assert.deepStrictEqual([667, 225, 501, 212, 416].map(c => rest.AREA_REGION[c]), ['MD', 'LA', 'AR', 'NY', 'ON'])
    assert.ok(Object.keys(rest.AREA_REGION).length > 400)
  })
  await ok('full flag: off by default, on after a refused buy, search then offers nothing', async () => {
    assert.strictEqual(rest.isFull(), false)
    rest.setFull(true)
    assert.strictEqual(rest.isFull(), true)
    assert.deepStrictEqual(await rest.searchNumbers('US', 'local', '667', 3), [])
  })
  await ok('full flag: cleared again (a buy worked / limit raised)', () => { rest.setFull(false); assert.strictEqual(rest.isFull(), false) })
  await ok('admin alert for a full account is sent once per 6 h', () => {
    process.env.PROVIDER_HEALTH_SEEN_FILE = require('path').join(require('os').tmpdir(), `ph-seen-test-${process.pid}.json`)
    delete require.cache[require.resolve('../provider-health')]
    const ph = require('../provider-health'); const sent = []
    ph.start = undefined
    const orig = require('../admin-mail').adminMail; require('../admin-mail').adminMail = (s) => sent.push(s)
    ph.numbersFull('signalwire', 23, '+16672793206'); ph.numbersFull('signalwire', 23, '+16672793209')
    require('../admin-mail').adminMail = orig
    assert.strictEqual(sent.length, 1)
  })
  console.log(`\n${pass} passed`); process.exit(process.exitCode || 0)
})()
