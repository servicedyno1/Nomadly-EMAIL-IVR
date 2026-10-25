// CloudIVR custom domain (e.g. cloudivr.net): that host serves ONLY the CloudIVR web app, mounted at the SITE ROOT.
//   CLOUDIVR_WEB_DOMAIN="cloudivr.net"   (www.<domain> 301s to the apex)
// - /, /login, /app/… and any other page → the React SPA (frontend/src/cloudivr/paths.js mounts the app at "/")
// - legacy /cloudivr and /cloudivr/* links → 301 to the same path without the /cloudivr prefix
// - API (/api/*, /cloudivr-web*), static files and non-GET requests pass through untouched
//   (the SPA fallback also keeps the URL shortener's /:id route from running on this host).
// Unset env → no guard (other hosts are never affected).
const fs = require('fs')

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

// The shared build's index.html is titled for the hosting panel; on the CloudIVR domain swap in CloudIVR's
// title + description so tabs, search results and link previews show the right brand.
const countryCount = () => { try { return require('./numbers').countries().length } catch (_) { return 0 } }
const brandHead = () => {
  const n = countryCount()
  return [
    '<title>CloudIVR — Virtual phone numbers, IVR &amp; AI voice agents</title>',
    `<meta name="description" content="Virtual phone numbers${n ? ` in ${n} countries` : ''} with call forwarding, voicemail, an SMS inbox, IVR menus, bulk IVR campaigns and AI voice agents. Pay with crypto." />`,
    '<meta property="og:title" content="CloudIVR — Virtual phone numbers, IVR &amp; AI voice agents" />',
    '<meta property="og:description" content="Phone numbers that answer, route and call for you — IVR menus, campaigns and AI voice agents. Pay with crypto, run it from your browser." />',
    '<meta property="og:type" content="website" />',
    '<meta name="theme-color" content="#0a0a0a" />',
    '<link rel="icon" type="image/png" href="/civr/brand/parrot-icon-48.png" />',
    '<link rel="apple-touch-icon" href="/civr/brand/apple-touch-icon.png" />',
  ].join('')
}
const brandHtml = (html) => {
  const BRAND_HEAD = brandHead()
  const out = html.replace(/<meta name="description"[^>]*>/i, '').replace(/<meta name="theme-color"[^>]*>/i, '')
  if (/<title>[^<]*<\/title>/i.test(out)) return out.replace(/<title>[^<]*<\/title>/i, BRAND_HEAD)
  return out.includes('</head>') ? out.replace('</head>', `${BRAND_HEAD}</head>`) : out
}
let cachedIndex = { file: '', mtime: 0, html: '' }
function brandedIndex(file) {
  const mtime = fs.statSync(file).mtimeMs
  if (cachedIndex.file !== file || cachedIndex.mtime !== mtime) cachedIndex = { file, mtime, html: brandHtml(fs.readFileSync(file, 'utf8')) }
  return cachedIndex.html
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
    if (PASS_EXACT.has(p) || PASS_PREFIXES.some(x => p.startsWith(x)) || STATIC_EXT.test(p)) return next()
    if (!isRead) return next()
    if (p === '/cloudivr' || p.startsWith('/cloudivr/')) {
      res.set('Cache-Control', 'public, max-age=3600')
      return res.redirect(301, `${p.slice('/cloudivr'.length) || '/'}${q}`)
    }
    if (buildIndex && fs.existsSync(buildIndex)) {
      res.set('Cache-Control', 'no-cache')
      return res.type('html').send(brandedIndex(buildIndex))
    }
    return next()
  }
}

module.exports = { createCloudIvrDomainGuard, parseDomain, appPathPrefix, brandHtml }
