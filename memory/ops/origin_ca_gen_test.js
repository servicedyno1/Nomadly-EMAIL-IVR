// Live test: generate (NOT install) an Origin CA cert for one currently-active zone that previously failed.
require('dotenv').config({ path: process.env.ENV_PATH })
const cf = require(process.env.REL + '/js/cf-service.js')
const d = process.env.D
;(async () => {
  const r = await cf.generateOriginCACert([d, `*.${d}`])
  console.log(d, '=>', r.success ? `SUCCESS (cert len ${String(r.certificate || '').length}, key len ${String(r.privateKey || '').length})` : `FAIL ${r.code || ''} ${r.error}`)
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
