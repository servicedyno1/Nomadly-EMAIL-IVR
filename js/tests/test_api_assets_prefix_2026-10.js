// Regression: browser audio players load /api/assets/user-audio/<file>. On the droplet nginx passes /api through to
// Node, so these URLs must be served by the /assets handlers (not the SPA HTML). Bug 2026-10-26 (web user
// iammills404@gmail.com: Audio library players stuck at 0:00 / 0:00). Needs the local nodejs service on PORT (5000).
// Run: node js/tests/test_api_assets_prefix_2026-10.js
const fs = require('fs')
const path = require('path')
const http = require('http')
const { execSync } = require('child_process')
const { createCloudIvrDomainGuard } = require('../cloudivr-web/domain-guard')

const PORT = process.env.PORT || 5000
const DIR = path.join(__dirname, '..', 'assets', 'user-audio')
const PROBE = `zz_regress_api_assets_${Date.now()}.mp3`
const get = (p, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p, headers }, (r) => {
    const chunks = []
    r.on('data', c => chunks.push(c))
    r.on('end', () => resolve({ status: r.statusCode, type: String(r.headers['content-type'] || ''), body: Buffer.concat(chunks) }))
  }).on('error', reject)
})

;(async () => {
  let pass = 0, fail = 0
  const ok = (c, m) => { if (c) { pass++; console.log('✓', m) } else { fail++; console.log('✗', m) } }
  fs.mkdirSync(DIR, { recursive: true })
  execSync(`ffmpeg -loglevel error -f lavfi -i "sine=frequency=440:duration=2" -ac 1 -codec:a libmp3lame -y "${path.join(DIR, PROBE)}"`)
  try {
    const a = await get(`/api/assets/user-audio/${PROBE}`)
    ok(a.status === 200 && a.type.startsWith('audio/mpeg') && a.body.length > 1000, `/api/assets/user-audio → 200 audio/mpeg (got ${a.status} ${a.type})`)
    const q = await get(`/api/assets/user-audio/${PROBE}?v=2`)
    ok(q.status === 200 && q.type.startsWith('audio/mpeg'), `with ?v=2 cache-buster → 200 audio/mpeg (got ${q.status} ${q.type})`)
    const r = await get(`/api/assets/user-audio/${PROBE}?v=2`, { Range: 'bytes=0-99' })
    ok(r.status === 206 && r.body.length === 100, `Range request → 206, 100 bytes (got ${r.status}, ${r.body.length})`)
    const plain = await get(`/assets/user-audio/${PROBE}`)
    ok(plain.status === 200 && plain.type.startsWith('audio/mpeg'), `/assets/user-audio (Telnyx URL form) unchanged → 200 audio/mpeg`)
    const png = await get('/api/assets/brand/nomadly/logo.png')
    ok(png.status === 200 && png.type.startsWith('image/png'), `/api/assets/brand/... → 200 image/png (got ${png.status} ${png.type})`)
    const miss = await get('/api/assets/user-audio/zz_does_not_exist_regress.mp3')
    ok(miss.status === 404 && !/html/i.test(miss.type), `missing audio → clean 404, not HTML (got ${miss.status} ${miss.type})`)
    const api = await get('/api/cloudivr-web/audio')
    ok(api.status === 401, `/api/cloudivr-web still routed (unauthenticated → 401, got ${api.status})`)
  } finally {
    try { fs.unlinkSync(path.join(DIR, PROBE)) } catch (_) { /* probe already gone */ }
  }
  // cloudivr.net domain guard must let /api/assets/* through to the asset handlers (not the SPA index).
  const guard = createCloudIvrDomainGuard({ domain: 'cloudivr.net', buildIndex: '/nonexistent/index.html' })
  let nexted = false
  guard({ headers: { host: 'cloudivr.net' }, method: 'GET', originalUrl: '/api/assets/user-audio/x.mp3?v=2', url: '/api/assets/user-audio/x.mp3?v=2', path: '/api/assets/user-audio/x.mp3' }, { set() {}, redirect() {}, type() { return this }, send() {} }, () => { nexted = true })
  ok(nexted, 'cloudivr.net domain guard passes /api/assets/user-audio/* through')
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
