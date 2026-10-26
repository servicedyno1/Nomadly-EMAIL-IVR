// The SIP sales page (cloudivr.net/sip) gets its own SEO head, FAQ rich results and a sitemap entry, while the
// SIP server itself (sip.cloudivr.net) is described as a phone-only address.
// Run: node js/tests/test_cloudivr_sip_page_seo_2026-10.js
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { createCloudIvrDomainGuard } = require('../cloudivr-web/domain-guard')
const seo = require('../cloudivr-web/seo')

const idx = path.join(os.tmpdir(), `civr_sip_seo_${process.pid}.html`)
fs.writeFileSync(idx, '<!doctype html><html lang="en"><head><title>Hosting Panel</title></head><body><div id="root"></div></body></html>')
const guard = createCloudIvrDomainGuard({ domain: 'cloudivr.net', buildIndex: idx })

const run = (url, host = 'cloudivr.net') => {
  const out = { next: false, type: null, body: null, headers: {}, redirect: null }
  const req = { method: 'GET', headers: { host }, originalUrl: url, url, path: url.split('?')[0] }
  const res = {
    set: (k, v) => { out.headers[k] = v },
    type: (t) => { out.type = t; return res },
    send: (b) => { out.body = String(b) },
    redirect: (code, to) => { out.redirect = [code, to] },
  }
  guard(req, res, () => { out.next = true })
  return out
}
const ld = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('PASS', name) }

t('/sip serves the SPA with its own title, description and canonical', () => {
  const r = run('/sip')
  assert.strictEqual(r.next, false)
  assert.ok(/html/.test(r.type))
  assert.ok(r.body.includes('<title>SIP Phone Numbers for Softphones &amp; Desk Phones · CloudIVR</title>'), 'sip title')
  assert.ok(r.body.includes('<link rel="canonical" href="https://cloudivr.net/sip" />'), 'sip canonical')
  assert.ok(/<meta name="description" content="[^"]*sip\.cloudivr\.net[^"]*5061 \(TLS\)/.test(r.body), 'description names the SIP server + ports')
  assert.ok(r.body.includes('content="index, follow'), 'sip page is indexable')
  assert.ok(!r.body.includes('Hosting Panel'))
})

t('/sip/ (trailing slash) and /cloudivr/sip map to the same page', () => {
  assert.ok(run('/sip/').body.includes('href="https://cloudivr.net/sip"'))
  assert.deepStrictEqual(run('/cloudivr/sip').redirect, [301, '/sip'])
})

t('/sip JSON-LD has a SIP FAQPage; home keeps the general FAQ', () => {
  const sip = ld(run('/sip').body)['@graph'].find(n => n['@type'] === 'FAQPage')
  assert.ok(sip, 'sip FAQPage')
  assert.strictEqual(sip['@id'], 'https://cloudivr.net/sip#faq')
  const qs = sip.mainEntity.map(q => q.name)
  assert.ok(qs.some(q => /sip\.cloudivr\.net open in my browser/.test(q)), 'explains the SIP server is not a website')
  const plan = sip.mainEntity.find(q => q.name === 'Which plan do I need for SIP?').acceptedAnswer.text
  assert.ok(/Pro and Business/.test(plan) && /\$75\/month/.test(plan) && /Starter includes the browser phone/.test(plan), plan)
  const home = ld(run('/').body)['@graph'].find(n => n['@type'] === 'FAQPage')
  assert.strictEqual(home['@id'], 'https://cloudivr.net/#faq')
  assert.ok(!home.mainEntity.some(q => /open in my browser/.test(q.name)), 'home FAQ unchanged')
  assert.ok(!ld(run('/signup').body)['@graph'].some(n => n['@type'] === 'FAQPage'), 'no FAQ on signup')
})

t('sitemap and llms.txt list the SIP page', () => {
  assert.ok(seo.sitemapXml().includes('<loc>https://cloudivr.net/sip</loc>'))
  assert.ok(seo.llmsTxt().includes('(https://cloudivr.net/sip)'))
})

t('other hosts are untouched (the SIP host never reaches the web app)', () => {
  assert.strictEqual(run('/sip', 'sip.cloudivr.net').next, true)
  assert.strictEqual(run('/sip', 'panel.example.com').next, true)
})

fs.unlinkSync(idx)
console.log(`\n${pass}/5 passed`)
