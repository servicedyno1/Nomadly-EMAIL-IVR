// Verify CloudIVR SEO + AI-discoverability wiring through the real domain guard.
// Run: node js/tests/test_cloudivr_seo_2026-09.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCloudIvrDomainGuard } = require('../cloudivr-web/domain-guard')
const seo = require('../cloudivr-web/seo')

const idx = path.join(os.tmpdir(), `civr_seo_${process.pid}.html`)
fs.writeFileSync(idx, '<!doctype html><html lang="en"><head><meta name="description" content="Hosting Control Panel" /><meta name="theme-color" content="#000000" /><title>Hosting Panel</title></head><body><div id="root"></div></body></html>')
const guard = createCloudIvrDomainGuard({ domain: 'cloudivr.net', buildIndex: idx })

const run = (url, method = 'GET') => {
  const out = { next: false, type: null, body: null, headers: {} }
  const req = { method, headers: { host: 'cloudivr.net' }, originalUrl: url, url, path: url.split('?')[0] }
  const res = {
    set: (k, v) => { out.headers[k] = v },
    type: (t) => { out.type = t; return res },
    send: (b) => { out.body = String(b) },
  }
  guard(req, res, () => { out.next = true })
  return out
}

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

// robots.txt
t('robots.txt welcomes AI crawlers + search + sitemap', () => {
  const r = run('/robots.txt')
  assert.ok(/text\/plain/.test(r.type), 'content-type')
  for (const ua of ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot']) assert.ok(r.body.includes(`User-agent: ${ua}`), `missing ${ua}`)
  assert.ok(r.body.includes('Sitemap: https://cloudivr.net/sitemap.xml'))
  assert.ok(r.body.includes('Disallow: /app/') && r.body.includes('Disallow: /api/'))
})

// sitemap.xml
t('sitemap.xml lists public pages', () => {
  const r = run('/sitemap.xml')
  assert.ok(/xml/.test(r.type))
  assert.ok(r.body.includes('<loc>https://cloudivr.net/</loc>'))
  assert.ok(r.body.includes('<loc>https://cloudivr.net/signup</loc>'))
  assert.ok(r.body.startsWith('<?xml'))
})

// llms.txt
t('llms.txt is a markdown overview with links', () => {
  const r = run('/llms.txt')
  assert.ok(r.body.startsWith('# CloudIVR'))
  assert.ok(r.body.includes('](https://cloudivr.net/signup)'))
  assert.ok(r.body.includes('/llms-full.txt'))
})

// llms-full.txt
t('llms-full.txt has features, pricing and FAQ', () => {
  const r = run('/llms-full.txt')
  assert.ok(r.body.includes('## Features'))
  assert.ok(r.body.includes('## Pricing'))
  assert.ok(r.body.includes('## Frequently asked questions'))
  assert.ok(/\$\d+\/month per number/.test(r.body), 'has per-number pricing')
})

// Home HTML injection
t('home HTML has CloudIVR SEO head + JSON-LD + noscript, no hosting panel', () => {
  const r = run('/')
  assert.ok(r.body.includes('<title>CloudIVR'), 'title')
  assert.ok(!r.body.includes('Hosting Panel') && !r.body.includes('Hosting Control Panel'), 'no panel branding')
  assert.ok(r.body.includes('<link rel="canonical" href="https://cloudivr.net/"'), 'canonical')
  assert.ok(r.body.includes('property="og:image"') && r.body.includes('og-share.jpg'), 'og image')
  assert.ok(r.body.includes('<meta property="og:description" content="Reach out: Quick IVR and Bulk IVR campaigns call your list, play your message, connect interested leads and collect codes." />'), 'share text')
  assert.ok(r.body.includes('<meta property="og:image:type" content="image/jpeg" />'), 'og image type')
  assert.ok(!r.body.includes('accounts.google.com/gsi/client'), 'no Google script preload on the home page')
  assert.ok(r.body.includes('name="twitter:card"'), 'twitter card')
  assert.ok(r.body.includes('application/ld+json'), 'json-ld present')
  assert.ok(r.body.includes('"FAQPage"') && r.body.includes('"SoftwareApplication"') && r.body.includes('"Organization"'), 'schema types')
  assert.ok(r.body.includes('<noscript>') && r.body.includes('Frequently asked questions'), 'crawlable noscript')
  assert.ok(r.body.includes('<div id="root"></div>'), 'root preserved')
  // JSON-LD must be valid JSON
  const m = r.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  const parsed = JSON.parse(m[1].replace(/\\u003c/g, '<'))
  assert.strictEqual(parsed['@context'], 'https://schema.org')
  assert.ok(Array.isArray(parsed['@graph']))
  console.log('   JSON-LD @graph nodes:', parsed['@graph'].map(n => n['@type']).join(', '))
})

// Signup page gets its own canonical + title, still indexable
t('signup page has its own canonical + title', () => {
  const r = run('/signup')
  assert.ok(r.body.includes('<link rel="canonical" href="https://cloudivr.net/signup"'))
  assert.ok(r.body.includes('<title>Create your CloudIVR account'))
  assert.ok(r.body.includes('content="index, follow'), 'indexable')
  assert.ok(r.body.includes('<link rel="preload" as="script" href="https://accounts.google.com/gsi/client" />'), 'Google script preloaded on sign-up')
  assert.ok(run('/login').body.includes('<link rel="preload" as="script" href="https://accounts.google.com/gsi/client" />'), 'Google script preloaded on sign-in')
})

// Private app route must be noindex
t('private /app route is noindex', () => {
  const r = run('/app/wallet')
  assert.ok(r.body.includes('content="noindex'), 'noindex for /app')
})

// AggregateOffer reflects live plan prices
t('JSON-LD offers reflect live plan prices', () => {
  const r = run('/')
  const m = r.body.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)
  const graph = JSON.parse(m[1].replace(/\\u003c/g, '<'))['@graph']
  const app = graph.find(n => n['@type'] === 'SoftwareApplication')
  assert.ok(app.offers && app.offers['@type'] === 'AggregateOffer', 'aggregate offer')
  assert.ok(Number(app.offers.lowPrice) > 0 && app.offers.offers.length >= 1, 'has priced offers')
  console.log('   price range:', app.offers.lowPrice, '-', app.offers.highPrice, 'USD;', app.offers.offerCount, 'plans')
})

fs.unlinkSync(idx)
console.log(`\n${pass}/8 passed`)
