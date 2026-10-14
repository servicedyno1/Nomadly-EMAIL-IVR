/**
 * Domain-name log redaction.
 *
 * Goal: CUSTOMER domain names must never appear naked in stdout / Railway logs.
 * Installed as a `console.*` shim at process startup, so every `log(...)`
 * (which is `console.log`) and every third-party log line is filtered through
 * a single chokepoint.
 *
 * Strategy (allowlist-based, NOT a blind regex):
 *   1. Find domain-like tokens, word-boundary anchored.
 *   2. Keep the token unless its final label is a REAL public TLD. This is what
 *      stops code tokens like `index.js`, `e.message`, `process.exit`,
 *      `Object.assign` from being mangled — their "TLD" (`js`, `message`,
 *      `exit`, `assign`) is not a real TLD.
 *   3. Keep INFRA domains readable (telegram, cloudflare, dynopay, twilio,
 *      railway, mongodb, the bot's own domains…) so debugging still works.
 *   4. Everything else — i.e. customer domains — is replaced with `***`.
 *
 * Disable entirely with LOG_REDACT=0. Add extra keep-suffixes (comma-separated)
 * with LOG_REDACT_KEEP="foo.com,bar.io".
 */

// Real public TLDs. Superset of js/dns-hostname-normalizer.js `commonTLDs`
// plus every TLD the platform sells (com/net/org/io/co/de/fr/it/xyz/sbs/app/dev).
const KNOWN_TLDS = new Set([
  'com', 'net', 'org', 'io', 'co', 'me', 'info', 'biz', 'us', 'uk', 'de', 'fr',
  'ru', 'cn', 'jp', 'br', 'in', 'au', 'ca', 'nl', 'eu', 'ch', 'se', 'no', 'fi',
  'dk', 'es', 'it', 'pt', 'pl', 'cz', 'at', 'be', 'ie', 'nz', 'za', 'mx', 'ar',
  'cl', 'tv', 'cc', 'ai', 'app', 'dev', 'xyz', 'online', 'site', 'store', 'sbs',
  'tech', 'cloud', 'pro', 'live', 'shop', 'space', 'fun', 'top', 'icu', 'cyou',
  'website', 'club', 'work', 'link', 'click', 'host', 'pw', 'mobi', 'name',
  'email', 'sh', 'gg', 'to', 'ws', 'su', 'ua', 'ro', 'bg', 'gr', 'hu', 'sk',
  'lt', 'lv', 'ee', 'is', 'lu', 'li', 'md', 'rs', 'si', 'hr', 'tr', 'il', 'ae',
  'sa', 'ng', 'ke', 'eg', 'ma', 'gh', 'tz', 'sg', 'my', 'th', 'vn', 'ph', 'id',
  'hk', 'tw', 'kr', 'pk', 'bd', 'lk', 'np', 'ir', 'kz', 'by', 'ge', 'am', 'az',
  'uz', 'pe', 'ec', 'uy', 'py', 'bo', 've', 'do', 'gt', 'cr', 'pa', 'ni', 'hn',
  'vc', 'ag', 'lc', 'bz', 'bond', 'monster', 'quest', 'cfd', 'rest', 'lol',
])

// Infra / own domains kept readable. Match is by suffix: a host is kept if it
// equals one of these or ends with `.<suffix>`.
const INFRA_SUFFIXES = new Set([
  // Telegram
  't.me', 'telegram.org', 'telegram.me', 'telegram.dog', 'tdlib.org',
  // Cloudflare control-plane (NOT workers.dev/pages.dev — those carry customer names)
  'cloudflare.com', 'cloudflareapi.com', 'cloudflare.net',
  // Payments
  'dynopay.com',
  // Hosting / VPS / registry / voice infra
  'contabo.com', 'openprovider.com', 'openprovider.eu', 'openprovider.nl',
  'twilio.com', 'twiml.com',
  // Platform / deploy
  'railway.app', 'railway.com', 'up.railway.app', 'emergentagent.com',
  'mongodb.net', 'mongodb.com',
  // Cloud / email / dev infra
  'amazonaws.com', 'cloudfront.net', 'amazonses.com',
  'google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com',
  'github.com', 'githubusercontent.com', 'letsencrypt.org',
  'sendgrid.net', 'sendgrid.com', 'brevo.com', 'sendinblue.com', 'mailgun.org',
  'jsdelivr.net', 'npmjs.com', 'unpkg.com', 'gravatar.com', 'socket.io',
  // The bot's own products / placeholders
  'hostbay.io', 'speechcue.com', 'bozzmail.com',
  'example.com', 'example.net', 'example.org',
])

// Add the bot's own SELF_URL host + any operator-supplied keep-list.
;(function seedDynamicInfra() {
  try {
    const self = process.env.SELF_URL
    if (self) {
      const host = new URL(self.startsWith('http') ? self : `https://${self}`).hostname.toLowerCase()
      if (host) INFRA_SUFFIXES.add(host)
    }
  } catch (_) { /* ignore malformed SELF_URL */ }
  const extra = (process.env.LOG_REDACT_KEEP || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  for (const s of extra) INFRA_SUFFIXES.add(s)
})()

// label(.label)+ .tld  — TLD is alpha-only (real TLDs), 2..24 chars.
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi

function isInfra(host) {
  if (INFRA_SUFFIXES.has(host)) return true
  for (const suf of INFRA_SUFFIXES) {
    if (host.endsWith('.' + suf)) return true
  }
  return false
}

/** Replace naked customer domain names in a string with `***`. */
function redactDomains(input) {
  if (typeof input !== 'string' || input.indexOf('.') === -1) return input
  return input.replace(DOMAIN_RE, (m) => {
    const host = m.toLowerCase()
    const tld = host.slice(host.lastIndexOf('.') + 1)
    if (!KNOWN_TLDS.has(tld)) return m   // code token / non-domain → leave as-is
    if (isInfra(host)) return m          // infra / own domain → keep readable
    return '***'
  })
}

// Credential labels (en/fr/de/es/pt/zh/hi) — a log line carrying one of these has its secret masked.
const SECRET_LABEL_RE = /pass(?:word|wd|code)?\b|mot de passe|passwort|contraseña|senha|密码|पासवर्ड|\bpin\b|पिन|api[ _-]?key|secret/i
const SECRET_TAG_RE = /(<(code|pre|tg-spoiler)>)([\s\S]*?)(<\/\2>)/gi
const SECRET_KV_RE = /((?:password|passwd|passcode|\bpin)["']?\s*[:=]\s*["']?)([^\s"'<>,;)}\]]+)/gi

/** Mask credential values (RDP/VPS/cPanel passwords, PINs, keys) in a log string. */
function redactSecrets(input) {
  if (typeof input !== 'string' || !SECRET_LABEL_RE.test(input)) return input
  return input.split('\n').map((line) => {
    const m = SECRET_LABEL_RE.exec(line)
    if (!m) return line
    // Only values AFTER the label are secrets ("files stay in <code>/home/x</code> … same password" keeps the path).
    const head = line.slice(0, m.index), tail = line.slice(m.index)
    return head + tail.replace(SECRET_TAG_RE, (s, open, _t, body, close) => (body.replace(/<[^>]+>/g, '').trim() ? `${open}***${close}` : s))
      .replace(SECRET_KV_RE, '$1***')
  }).join('\n')
}

let _installed = false
/** Wrap console.* so every string argument is domain- and secret-redacted. Idempotent. */
function installConsoleRedaction() {
  if (_installed || process.env.LOG_REDACT === '0') return
  _installed = true
  const methods = ['log', 'info', 'warn', 'error', 'debug']
  for (const name of methods) {
    const orig = console[name]
    if (typeof orig !== 'function') continue
    console[name] = (...args) => orig.apply(console, args.map(a => (typeof a === 'string' ? redactDomains(redactSecrets(a)) : a)))
  }
}

module.exports = { redactDomains, redactSecrets, installConsoleRedaction, KNOWN_TLDS, INFRA_SUFFIXES }
