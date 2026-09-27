/* global process */
// Install EasyApache 4 PHP extensions via WHM API 1 (package_manager_submit_actions).
// Usage: node js/ops/whm_ea4_install_ext.js [--dry] pkg1 pkg2 ...
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') })
const axios = require('axios')

const WHM_API_URL = (process.env.WHM_API_URL || '').replace(/\/+$/, '')
const BASE = WHM_API_URL ? `${WHM_API_URL}/json-api` : `https://${process.env.WHM_HOST}:2087/json-api`
const AUTH = `whm ${process.env.WHM_USERNAME || 'root'}:${process.env.WHM_TOKEN}`

const args = process.argv.slice(2)
const dry = args.includes('--dry')
const pkgs = args.filter(a => !a.startsWith('--'))
if (!pkgs.length) { console.error('no packages given'); process.exit(1) }

const whm = (fn, params = {}, method = 'get') => axios({
  method, url: `${BASE}/${fn}`,
  [method === 'get' ? 'params' : 'data']: { 'api.version': 1, ...params },
  headers: { Authorization: AUTH, ...(method === 'post' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
  timeout: 60000,
}).then(r => r.data)

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function pkgState(names) {
  const params = {}
  names.forEach((n, i) => { params[i === 0 ? 'package' : `package-${i}`] = n })
  const r = await whm('package_manager_get_package_info', params)
  const list = r?.data?.packages || []
  return Object.fromEntries(list.map(p => [p.package, p.state]))
}

;(async () => {
  console.log(`WHM base: ${BASE}`)
  const before = await pkgState(pkgs)
  console.log('BEFORE:', before)
  const toInstall = pkgs.filter(p => before[p] !== 'installed')
  if (!toInstall.length) { console.log('All already installed. Nothing to do.'); return }
  if (dry) { console.log('DRY RUN — would install:', toInstall); return }

  const body = new URLSearchParams({ 'api.version': '1' })
  toInstall.forEach((p, i) => body.append(i === 0 ? 'install' : `install-${i}`, p))
  const sub = await axios.post(`${BASE}/package_manager_submit_actions`, body.toString(), {
    headers: { Authorization: AUTH, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 60000,
  }).then(r => r.data)
  console.log('SUBMIT:', JSON.stringify(sub?.metadata), JSON.stringify(sub?.data))
  if (!sub?.metadata?.result) { console.error('submit failed'); process.exit(2) }
  const buildId = sub?.data?.build || sub?.data?.build_id || sub?.data?.pid

  let offset = 0
  for (let i = 0; i < 60; i++) {
    await sleep(5000)
    let logChunk = ''
    if (buildId) {
      try {
        const lg = await whm('package_manager_get_build_log', { build: buildId, offset })
        const c = lg?.data?.content
        logChunk = Array.isArray(c) ? c.join('\n') : (c || '')
        offset = lg?.data?.offset ?? offset
        if (logChunk) process.stdout.write(logChunk)
        if (lg?.data?.still_running === 0 || lg?.data?.still_running === '0') break
      } catch (e) { console.log('log poll err:', e.response?.data?.metadata?.reason || e.message) }
    } else {
      const busy = await whm('package_manager_is_performing_actions').catch(() => null)
      const running = busy?.data?.performing_actions ?? busy?.data?.active
      console.log(`poll ${i}: performing_actions=${running}`)
      if (String(running) === '0') break
    }
  }
  await sleep(3000)
  const after = await pkgState(pkgs)
  console.log('AFTER:', after)
  const missing = pkgs.filter(p => after[p] !== 'installed')
  if (missing.length) { console.error('STILL MISSING:', missing); process.exit(3) }
  console.log('✅ All packages installed.')
})().catch(e => { console.error('ERR', e.response?.status, JSON.stringify(e.response?.data)?.slice(0, 500) || e.message); process.exit(1) })
