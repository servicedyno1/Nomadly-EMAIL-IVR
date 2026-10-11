#!/usr/bin/env node
/* Verifies whm-service.changePackage re-applies the per-account MAXADDON (and MAXSQL)
 * override for each tier after /changepackage — the fix for the Weekly→Premium upgrade
 * that left nameaf15 at MAXADDON=unlimited. Stubs axios so no real WHM call is made. */
process.env.WHM_HOST = process.env.WHM_HOST || 'stub.local'
process.env.WHM_TOKEN = process.env.WHM_TOKEN || 'stub'

const Module = require('module')
const origRequire = Module.prototype.require
const calls = []
Module.prototype.require = function (id) {
  if (id === 'axios') {
    return {
      create: () => ({
        get: async (path, cfg) => {
          calls.push({ path, params: (cfg && cfg.params) || {} })
          return { data: { metadata: { result: 1 }, data: {} } }
        },
      }),
    }
  }
  return origRequire.apply(this, arguments)
}

const whm = require('../whm-service')
Module.prototype.require = origRequire

let pass = 0, fail = 0
function check(name, cond) { if (cond) { pass++; console.log(`  ✅ ${name}`) } else { fail++; console.log(`  ❌ ${name}`) } }

function modifyFor() { return calls.find(c => c.path === '/modifyacct') }

;(async () => {
  // Weekly → Premium Monthly: MAXADDON must be 5, MAXSQL 5
  calls.length = 0
  await whm.changePackage('u1', 'Premium Anti-Red HostPanel (1-Month)')
  let m = modifyFor()
  console.log('[case] Weekly→Premium Monthly:', JSON.stringify(m && m.params))
  check('changepackage called', calls.some(c => c.path === '/changepackage'))
  check('MAXADDON=5 for Premium Monthly', m && String(m.params.MAXADDON) === '5')
  check('MAXSQL=5 for Premium Monthly', m && String(m.params.MAXSQL) === '5')

  // → Golden: MAXADDON + MAXSQL unlimited
  calls.length = 0
  await whm.changePackage('u2', 'Golden Anti-Red HostPanel (1-Month)')
  m = modifyFor()
  console.log('[case] →Golden:', JSON.stringify(m && m.params))
  check('MAXADDON=unlimited for Golden', m && String(m.params.MAXADDON) === 'unlimited')
  check('MAXSQL=unlimited for Golden', m && String(m.params.MAXSQL) === 'unlimited')

  // → Weekly: MAXADDON 1, MAXSQL 2
  calls.length = 0
  await whm.changePackage('u3', 'Premium Anti-Red (1-Week)')
  m = modifyFor()
  console.log('[case] →Weekly:', JSON.stringify(m && m.params))
  check('MAXADDON=1 for Weekly', m && String(m.params.MAXADDON) === '1')
  check('MAXSQL=2 for Weekly', m && String(m.params.MAXSQL) === '2')

  console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'}: ${pass} passed, ${fail} failed`)
  process.exit(fail === 0 ? 0 : 1)
})()
