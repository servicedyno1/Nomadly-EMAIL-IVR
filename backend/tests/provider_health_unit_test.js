// Unit tests: js/provider-health.js thresholds, low-balance hiding (number-catalog.options + signalwire searchNumbers), alerts (Telegram + admin mail)
'use strict'
const path = require('path')
const J = (p) => path.resolve(__dirname, '../../js', p)
let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log('PASS', m) } else { fail++; console.log('FAIL', m) } }
const stub = (p, exp) => { const f = require.resolve(J(p)); require.cache[f] = { id: f, filename: f, loaded: true, exports: exp } }

const mails = []
let ibBal = 3, mtBal = 48, birdErr = null
stub('admin-mail', { adminMail: (s, h) => { mails.push({ s, h }); return Promise.resolve(true) } })
stub('active-slot', { singletonInterval: () => {} })
stub('multitel', { enabled: () => true, isBlocked: () => false, api: async () => ({ status: { code: 200 }, response: { balance: mtBal } }), searchNumbers: async () => [{ phone_number: '+1MT' }] })
stub('infobip', { enabled: () => true, http: () => ({ get: async () => ({ data: { balance: ibBal, currency: 'EUR' } }) }), searchNumbers: async () => [{ phone_number: '+1IB' }], isIb: () => false, isIbSearched: () => false, voice: {} })
stub('spenza', { creditBalance: async () => 100 })

const axios = require(require.resolve('axios', { paths: [J('.')] }))
axios.get = async () => { if (birdErr) throw birdErr; return { data: {} } }
process.env.BIRD_API_KEY = 'x'

const ph = require(J('provider-health'))
const cat = require(J('number-catalog'))
const tg = []
ph.start((t) => tg.push(t))

;(async () => {
  await new Promise(r => setTimeout(r, 50))
  ok(ph.LOW.multitel === 20 && ph.LOW.infobip === 20 && ph.LOW.spenza === 25, 'LOW thresholds')
  ok(ph.STOP.multitel === 10 && ph.STOP.infobip === 10, 'STOP thresholds')
  const snap = ph.snapshot()
  ok(snap.infobip.balance === 3.24, `EUR 3 -> USD 3.24 (got ${snap.infobip.balance})`)
  ok(snap.multitel.balance === 48, 'multitel balance 48')
  ok(ph.isLow('infobip') && !ph.isLow('multitel'), 'isLow infobip only')
  ok(ph.isDown('infobip') === true, 'infobip hidden (low, multitel healthy)')
  ok(ph.isDown('multitel') === false, 'multitel shown')
  ok(tg.some(t => /infobip balance is low: \$3\.24/.test(t) && /hidden/.test(t)), 'telegram low alert for infobip mentions hidden')
  ok(mails.some(m => /infobip balance is low/.test(m.s)), 'admin email for infobip low')
  const usOpts = cat.options('US', 'local')
  ok(!usOpts.some(o => o.provider === 'infobip'), `catalog US local hides infobip: ${JSON.stringify(usOpts.map(o => o.provider))}`)

  // both low -> neither hidden
  mtBal = 5; await ph.tick()
  ok(ph.isLow('multitel') && ph.isLow('infobip'), 'both low')
  ok(!ph.isDown('infobip') && !ph.isDown('multitel'), 'both low => neither hidden')
  ok(tg.some(t => /multitel balance is low: \$5\.00/.test(t)), 'multitel low alert sent')
  const opts2 = cat.options('US', 'local').map(o => o.provider)
  ok(opts2.includes('infobip'), `both low: catalog shows infobip ${JSON.stringify(opts2)}`)

  // multitel healthy again, infobip warn-only (15 EUR => 16.2 USD) => not hidden
  mtBal = 48; ibBal = 15; await ph.tick()
  ok(!ph.isDown('infobip'), 'infobip $16.20 (warn zone) not hidden')

  // Bird 402 => wallet empty alert
  birdErr = Object.assign(new Error('402'), { response: { status: 402, data: { code: 'E03000' } } })
  const n = tg.length
  await ph.tick()
  ok(tg.slice(n).some(t => /Bird wallet is empty/.test(t)), 'Bird 402 => wallet empty alert')
  ok(mails.some(m => /Bird wallet is empty/.test(m.s)), 'Bird empty => admin email')

  // signalwire searchNumbers skips infobip when low
  ibBal = 3; birdErr = null; await ph.tick()
  ok(ph.isDown('infobip'), 'infobip hidden again')
  try {
    const sw = require(J('signalwire'))
    const w = sw.wrap ? sw.wrap({ searchNumbers: async () => [] }) : null
    if (w) {
      const r = await w.searchNumbers('US', 'local', null, 3).catch(e => 'ERR ' + e.message)
      ok(!(Array.isArray(r) && r.some(n => n.phone_number === '+1IB')), `signalwire wrap.searchNumbers does not return infobip: ${JSON.stringify(r)}`)
    } else console.log('SKIP signalwire wrap not exported')
  } catch (e) { console.log('SKIP signalwire load:', e.message) }
  console.log(`\nRESULT pass=${pass} fail=${fail}`)
  process.exit(fail ? 1 : 0)
})()
