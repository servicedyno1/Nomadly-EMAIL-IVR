// CloudIVR custom domain (e.g. cloudivr.net): that host serves ONLY the CloudIVR web app, mounted at the SITE ROOT.
//   CLOUDIVR_WEB_DOMAIN="cloudivr.net"   (www.<domain> 301s to the apex)
// - /, /login, /app/… and any other page → the React SPA (frontend/src/cloudivr/paths.js mounts the app at "/")
// - legacy /cloudivr and /cloudivr/* links → 301 to the same path without the /cloudivr prefix
// - API (/api/*, /cloudivr-web*), static files and non-GET requests pass through untouched
//   (the SPA fallback also keeps the URL shortener's /:id route from running on this host).
// Unset env → no guard (other hosts are never affected).
const fs = require('fs')
const seo = require('./seo')

const normHost = (h) => String(h || '').split(',')[0].trim().toLowerCase().split(':')[0]
const parseDomain = (v) => String(v || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/\/.*$/, '').split(':')[0].replace(/^www\./, '')

const PASS_PREFIXES = ['/api/', '/cloudivr-web/', '/static/', '/assets/']
const PASS_EXACT = new Set(['/api', '/cloudivr-web', '/health', '/favicon.ico', '/manifest.json', '/robots.txt'])
const STATIC_EXT = /\.(js|css|map|png|jpe?g|gif|svg|ico|webp|json|txt|woff2?|ttf|mp3|wav|webmanifest)$/i

// Path prefix of the web app for links built server-side (password-reset e-mails):
// '' when `base` is the CloudIVR domain (app at the root), '/cloudivr' on shared hosts.
function appPathPrefix(base, domain = process.env.CLOUDIVR_WEB_DOMAIN) {
  const apex = parseDomain(domain)
  return apex && parseDomain(base) === apex ? '' : '/cloudivr'
}

// The shared build's index.html is titled for the hosting panel. On the CloudIVR domain we swap in
// CloudIVR's title/description, Open Graph + Twitter cards, JSON-LD structured data and a crawlable
// <noscript> overview so browser tabs, search results, link previews and AI assistants (ChatGPT,
// Claude, Perplexity…) show the right brand and can read the product without running JS. See ./seo.js.
const brandHtml = (html) => seo.injectIndex(html, '/')
let cachedRaw = { file: '', mtime: 0, html: '' }
function rawIndex(file) {
  const mtime = fs.statSync(file).mtimeMs
  if (cachedRaw.file !== file || cachedRaw.mtime !== mtime) cachedRaw = { file, mtime, html: fs.readFileSync(file, 'utf8') }
  return cachedRaw.html
}
function brandedIndex(file, pathname = '/') {
  return seo.injectIndex(rawIndex(file), pathname)
}

function createCloudIvrDomainGuard({ domain = process.env.CLOUDIVR_WEB_DOMAIN, buildIndex } = {}) {
  const apex = parseDomain(domain)
  if (!apex) return null
  const www = `www.${apex}`
  return function cloudIvrDomainGuard(req, res, next) {
    const host = normHost(req.headers['x-forwarded-host'] || req.headers.host)
    if (host !== apex && host !== www) return next()
    const url = req.originalUrl || req.url || '/'
    const p = req.path || url.split('?')[0] || '/'
    const q = url.includes('?') ? url.slice(url.indexOf('?')) : ''
    const isRead = req.method === 'GET' || req.method === 'HEAD'
    if (host === www) {
      res.set('Cache-Control', 'public, max-age=3600')
      return res.redirect(isRead ? 301 : 308, `https://${apex}${url}`)
    }
    // ── SEO + AI-assistant discoverability files (served only on the CloudIVR domain) ──
    if (isRead) {
      if (p === '/robots.txt') { res.set('Cache-Control', 'public, max-age=86400'); return res.type('text/plain; charset=utf-8').send(seo.robotsTxt()) }
      if (p === '/sitemap.xml') { res.set('Cache-Control', 'public, max-age=86400'); return res.type('application/xml; charset=utf-8').send(seo.sitemapXml()) }
      if (p === '/llms.txt') { res.set('Cache-Control', 'public, max-age=86400'); return res.type('text/plain; charset=utf-8').send(seo.llmsTxt()) }
      if (p === '/llms-full.txt') { res.set('Cache-Control', 'public, max-age=86400'); return res.type('text/plain; charset=utf-8').send(seo.llmsFullTxt()) }
    }
    if (PASS_EXACT.has(p) || PASS_PREFIXES.some(x => p.startsWith(x)) || STATIC_EXT.test(p)) return next()
    if (!isRead) return next()
    if (p === '/cloudivr' || p.startsWith('/cloudivr/')) {
      res.set('Cache-Control', 'public, max-age=3600')
      return res.redirect(301, `${p.slice('/cloudivr'.length) || '/'}${q}`)
    }
    if (buildIndex && fs.existsSync(buildIndex)) {
      res.set('Cache-Control', 'no-cache')
      return res.type('html').send(brandedIndex(buildIndex, p))
    }
    return next()
  }
}

module.exports = { createCloudIvrDomainGuard, parseDomain, appPathPrefix, brandHtml }
