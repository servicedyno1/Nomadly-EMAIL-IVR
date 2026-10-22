/* global process */
// ─────────────────────────────────────────────────────────────────────────────
// Shortener analytics capability detector
// ─────────────────────────────────────────────────────────────────────────────
// Some shortener providers expose click stats (bit.ly via its API; our own
// SELF_URL host via the `clicksOn` MongoDB collection). Others (linkly.link —
// current Shortit provider, srtn.me via the old RapidAPI single-hop, legacy
// ap1s.net via PromptAPI) don't report stats here — so we tell the user up-front
// in the "My Links" listing that analytics is N/A for those links.
//
// Adding a new provider is a one-line edit: drop a regex into the right list.
// ─────────────────────────────────────────────────────────────────────────────

const NO_ANALYTICS_PROVIDERS = [
  // Linkly (current Shortit "Random" provider, 2026-10-22). Its analytics API
  // is rate-limited to 50/h and 100/month on the Free plan, so per product
  // decision we don't pull click counts for these links.
  { match: /^(https?:\/\/)?linkly\.link\//i, label: 'linkly.link' },
  { match: /^(https?:\/\/)?srtn\.me\//i,  label: 'srtn.me'  },
  { match: /^(https?:\/\/)?ap1s\.net\//i, label: 'ap1s.net' },
]

// Optional custom domain configured inside Linkly (LINKLY_DOMAIN). Links on it
// are served by Linkly, not by our app.get('/:id') handler, so no stats either.
function _isLinklyCustomDomain(url) {
  const d = String(process.env.LINKLY_DOMAIN || '').trim().toLowerCase()
  if (!d) return false
  const u = String(url).replace(/^https?:\/\//, '').toLowerCase()
  return u.startsWith(d + '/')
}

const WITH_ANALYTICS_PROVIDERS = [
  { match: /^(https?:\/\/)?(bit\.ly|j\.mp|bitly\.is)\//i, label: 'bitly' },
]

// Own-host detection: matches the SELF_URL host (and any other custom domain
// the user owns that routes through our `app.get('/:id')` handler).
function _isOwnHost(url) {
  if (!url) return false
  const selfHost = String(process.env.SELF_URL || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '')
    .toLowerCase()
  if (!selfHost) return false
  const u = String(url).replace(/^https?:\/\//, '').toLowerCase()
  return u.startsWith(selfHost + '/') || u === selfHost
}

/**
 * Return { available: bool, provider: string } for a given short URL.
 * `maskUrl` is the user-facing short URL (e.g. https://srtn.me/abc,
 * https://bit.ly/xyz, https://app.railway.app/alias).
 */
function getAnalyticsCapability(maskUrl) {
  const url = String(maskUrl || '')
  if (_isOwnHost(url)) return { available: true,  provider: 'self'    }
  for (const p of WITH_ANALYTICS_PROVIDERS) if (p.match.test(url)) return { available: true,  provider: p.label }
  for (const p of NO_ANALYTICS_PROVIDERS)   if (p.match.test(url)) return { available: false, provider: p.label }
  if (_isLinklyCustomDomain(url)) return { available: false, provider: 'linkly' }
  // Anything else here is a user-owned CUSTOM DOMAIN shortlink (e.g.
  // mydomain.com/alias). Those are served by our own `app.get('/:id')` redirect
  // handler, which records every hit via `increment(clicksOn, lookupKey)` under
  // the exact same key the link is stored with. So the click count genuinely
  // lives in the `clicksOn` collection — report it instead of hiding it behind
  // "analytics not available". (Known external shorteners with no stats API are
  // already caught by NO_ANALYTICS_PROVIDERS above, so they never reach here.)
  return { available: true, provider: 'self' }
}

module.exports = { getAnalyticsCapability }
