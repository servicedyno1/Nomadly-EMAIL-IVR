// Unit test: CloudIVR custom-domain guard (js/cloudivr-web/domain-guard.js) — app mounted at the SITE ROOT on its own domain.
// Run: node js/tests/test_cloudivr_domain_guard_2026-10.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCloudIvrDomainGuard, parseDomain, appPathPrefix, brandHtml } = require('../cloudivr-web/domain-guard')

const idx = path.join(os.tmpdir(), `civr_idx_${process.pid}.html`)
fs.writeFileSync(idx, '<html><head><meta name="description" content="Hosting Control Panel" /><title>Hosting Panel</title></head><body>spa</body></html>')
const guard = createCloudIvrDomainGuard({ domain: 'https://www.CloudIVR.net/', buildIndex: idx })

// out.file = idx when the SPA index (CloudIVR-branded) was served.
const run = (host, url, method = 'GET', g = guard) => {
  const out = { next: false, status: null, location: null, file: null, html: null, headers: {} }
  const req = { method, headers: { host }, originalUrl: url, url, path: url.split('?')[0] }
  const res = {
    set: (k, v) => { out.headers[k] = v },
    redirect: (s, l) => { out.status = s; out.location = l },
    type: () => res,
    send: (b) => { out.html = b; if (String(b).includes('spa')) out.file = idx },
  }
  g(req, res, () => { out.next = true })
  return out
}

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

t('parseDomain normalises', () => assert.strictEqual(parseDomain('https://www.CloudIVR.net/x'), 'cloudivr.net'))
t('no env → no guard', () => assert.strictEqual(createCloudIvrDomainGuard({ domain: '' }), null))
t('other hosts untouched', () => { assert.ok(run('2.speechcue.com', '/').next); assert.ok(run('2.speechcue.com', '/cloudivr/login').next); assert.ok(run('panel.2.hostbay.io', '/panel').next) })
t('root serves the SPA (no redirect)', () => { const r = run('cloudivr.net', '/'); assert.strictEqual(r.file, idx); assert.strictEqual(r.status, null) })
t('root with query serves the SPA', () => assert.strictEqual(run('cloudivr.net', '/?ref=abc').file, idx))
t('clean app paths serve the SPA', () => { for (const p of ['/login', '/signup', '/forgot', '/reset-password?token=x', '/app', '/app/numbers/%2B1555']) assert.strictEqual(run('cloudivr.net', p).file, idx, p) })
t('unknown pages serve the SPA (shortener never runs here)', () => { assert.strictEqual(run('cloudivr.net', '/panel').file, idx); assert.strictEqual(run('cloudivr.net', '/xYz12').file, idx) })
t('legacy /cloudivr → / (301)', () => { const r = run('cloudivr.net', '/cloudivr'); assert.strictEqual(r.status, 301); assert.strictEqual(r.location, '/') })
t('legacy /cloudivr/* → stripped path, query kept (301)', () => {
  assert.strictEqual(run('cloudivr.net', '/cloudivr/login').location, '/login')
  assert.strictEqual(run('cloudivr.net', '/cloudivr/reset-password?token=abc').location, '/reset-password?token=abc')
  assert.strictEqual(run('cloudivr.net', '/cloudivr/app/wallet').location, '/app/wallet')
})
t('www → apex 301 (path kept)', () => { const r = run('www.cloudivr.net:443', '/login'); assert.strictEqual(r.status, 301); assert.strictEqual(r.location, 'https://cloudivr.net/login') })
t('www POST → 308', () => assert.strictEqual(run('www.cloudivr.net', '/api/cloudivr-web/auth/login', 'POST').status, 308))
t('API passes', () => { assert.ok(run('cloudivr.net', '/api/cloudivr-web/auth/me').next); assert.ok(run('cloudivr.net', '/cloudivr-web/wallet').next) })
t('static passes', () => { assert.ok(run('cloudivr.net', '/static/js/main.abc.js').next); assert.ok(run('cloudivr.net', '/favicon.ico').next); assert.ok(run('cloudivr.net', '/health').next) })
t('non-GET on apex passes', () => assert.ok(run('cloudivr.net', '/whatever', 'POST').next))
t('missing build → next()', () => {
  const g2 = createCloudIvrDomainGuard({ domain: 'cloudivr.net', buildIndex: '/nonexistent/index.html' })
  assert.ok(run('cloudivr.net', '/login', 'GET', g2).next)
})
t('appPathPrefix: own domain → "", shared host → /cloudivr', () => {
  assert.strictEqual(appPathPrefix('https://cloudivr.net', 'cloudivr.net'), '')
  assert.strictEqual(appPathPrefix('https://www.cloudivr.net/', 'cloudivr.net'), '')
  assert.strictEqual(appPathPrefix('https://2.speechcue.com', 'cloudivr.net'), '/cloudivr')
  assert.strictEqual(appPathPrefix('https://ivr-features-lab.preview.emergentagent.com', ''), '/cloudivr')
})

t('served index is CloudIVR-branded (no hosting-panel title/description)', () => {
  const html = run('cloudivr.net', '/').html
  assert.ok(html.includes('<title>CloudIVR'), html)
  assert.ok(!html.includes('Hosting Panel') && !html.includes('Hosting Control Panel'), html)
  assert.ok(html.includes('og:title'))
})
t('brandHtml injects into <head> when there is no <title>', () => assert.ok(brandHtml('<html><head></head></html>').includes('<title>CloudIVR')))

fs.unlinkSync(idx)
console.log(`\n${pass}/18 passed`)
