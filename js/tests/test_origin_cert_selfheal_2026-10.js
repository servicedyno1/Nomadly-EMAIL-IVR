// Regression (2026-10-16): protection-enforcer.ensureOriginCert must NOT mint/install Origin CA
// certs for domains that aren't hosted on a LIVE cPanel account (deleted accounts orphaned certs on CF),
// and must back off after an install failure instead of re-minting every 6h.
// Run: node js/tests/test_origin_cert_selfheal_2026-10.js  (exit 0 = pass)
process.env.WHM_HOST = '127.0.0.1'
process.env.RENDER_APP_IP_ADDRESS = '127.0.0.1'
const path = require('path')
// Force the origin HTTPS probe to fail deterministically (no network; nginx may own :443 on the droplet)
const EventEmitter = require('events')
require('https').request = () => {
  const req = new EventEmitter()
  req.end = () => setImmediate(() => req.emit('error', Object.assign(new Error('stub'), { code: 'ECONNREFUSED' })))
  req.destroy = () => {}
  return req
}

let genCalls = 0, installCalls = 0, installOk = true
const cfPath = require.resolve('../cf-service.js')
const whmPath = require.resolve('../whm-service.js')
require.cache[cfPath] = { id: cfPath, filename: cfPath, loaded: true, exports: {
  generateOriginCACert: async () => { genCalls++; return { success: true, certificate: 'CERT', privateKey: 'KEY', id: 'c1' } },
} }
require.cache[whmPath] = { id: whmPath, filename: whmPath, loaded: true, exports: {
  installDomainSSL: async () => { installCalls++; return installOk ? { success: true } : { success: false, error: 'The domain is not managed on this server' } },
  excludeDomainsFromAutoSSL: async () => ({ success: true }),
} }

function makeDb(accounts) {
  const state = new Map()
  return {
    _state: state,
    collection(name) {
      if (name === 'cpanelAccounts') return {
        findOne: async (q) => accounts.find(a => q.$or.some(c => (c._id && a._id === c._id) || (c.cpUser && a.cpUser === c.cpUser))) || null,
      }
      if (name === 'originCertState') return {
        findOne: async (q) => state.get(q._id) || null,
        updateOne: async (q, u) => { state.set(q._id, { ...(state.get(q._id) || {}), ...u.$set }) },
      }
      throw new Error('unexpected collection ' + name)
    },
  }
}

const pe = require('../protection-enforcer.js')
let pass = 0, fail = 0
const ok = (n, c, d) => { if (c) { pass++; console.log(`  ✅ ${n}`) } else { fail++; console.log(`  ❌ ${n}${d ? ' — ' + d : ''}`) } }
const reset = () => { genCalls = 0; installCalls = 0; installOk = true }

;(async () => {
  const accounts = [
    { _id: 'live1', domain: 'live.com', addonDomains: ['addon.com', { domain: 'addon2.com' }] },
    { _id: 'gone1', domain: 'gone.com', deleted: true },
  ]

  console.log('── deleted account: never mint ──')
  reset(); let db = makeDb(accounts); pe.init(db)
  await pe.ensureOriginCert('gone.com', 'z', 'gone1')
  ok('no generate for deleted account', genCalls === 0 && installCalls === 0, `gen=${genCalls}`)

  console.log('── domain not hosted on the account: never mint ──')
  reset()
  await pe.ensureOriginCert('stranger.com', 'z', 'live1')
  ok('no generate for a domain not on the account', genCalls === 0, `gen=${genCalls}`)

  console.log('── unknown cpUser: never mint ──')
  reset()
  await pe.ensureOriginCert('live.com', 'z', 'nope')
  ok('no generate when cpUser has no account', genCalls === 0)

  console.log('── live primary / string addon / object addon: install ──')
  for (const d of ['live.com', 'addon.com', 'addon2.com']) {
    reset(); db = makeDb(accounts); pe.init(db)
    const a = await pe.ensureOriginCert(d, 'z', 'live1')
    ok(`${d}: generate+install once`, genCalls === 1 && installCalls === 1, `gen=${genCalls} inst=${installCalls}`)
    ok(`${d}: state recorded origin-ca`, db._state.get(d)?.via === 'origin-ca' && a.some(x => /installed/.test(x)))
  }

  console.log('── installed within 30d: skip ──')
  reset()
  await pe.ensureOriginCert('addon2.com', 'z', 'live1')
  ok('second call within refresh window does not re-mint', genCalls === 0)

  console.log('── install failure: record + back off (no re-mint every 6h) ──')
  reset(); db = makeDb(accounts); pe.init(db); installOk = false
  const f1 = await pe.ensureOriginCert('live.com', 'z', 'live1')
  ok('first failure mints once + reports FAILED', genCalls === 1 && f1.some(x => /FAILED/.test(x)))
  ok('failure recorded with failedAt', !!db._state.get('live.com')?.failedAt && db._state.get('live.com')?.via === 'install-failed')
  reset(); installOk = false
  await pe.ensureOriginCert('live.com', 'z', 'live1')
  ok('retry within 7d backoff does NOT re-mint', genCalls === 0, `gen=${genCalls}`)

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
