/**
 * Shared helpers for turning raw cPanel UAPI / axios errors into friendly,
 * translatable messages for the hosting panel UI.
 *
 * Why: the FastAPI → Node proxy → WHM UAPI chain surfaces low-level strings
 * like "timeout of 30000ms exceeded" or "ECONNREFUSED" into the panel when
 * the upstream hosting server is slow or unreachable. Showing those verbatim
 * to end-users looks broken and panics them (see: @ciroovblzz report —
 * "error after login + upload forever"). These helpers map the handful of
 * known transient / outage strings to a calm, actionable message, and fall
 * back to the raw text only if it's already user-friendly.
 */

// Regex for axios/Node error codes that indicate the cPanel control plane
// is temporarily slow or unreachable (but not permanently broken).
const TIMEOUT_RX = /timeout of \d+ms exceeded|ETIMEDOUT|ECONNABORTED/i
const UNREACHABLE_RX = /ECONNREFUSED|ENOTFOUND|ECONNRESET|ENETUNREACH|EAI_AGAIN|socket hang up/i
// cPanel answered with its HTML login page instead of JSON (auth failure upstream)
const HTML_RX = /^\s*<(!doctype|html)/i

/**
 * Translate a raw cPanel/axios error string to a friendly i18n message.
 * Returns an empty string if the message doesn't match a known pattern
 * (so the caller can fall back to showing the raw text or a default).
 */
export function friendlyMessage(raw, t) {
  const msg = String(raw || '')
  if (TIMEOUT_RX.test(msg)) return t('errors.cpanelSlow')
  if (UNREACHABLE_RX.test(msg)) return t('errors.cpanelUnreachable')
  if (HTML_RX.test(msg)) return t('errors.cpanelAuthIssue')
  return ''
}

/**
 * Pick a friendly message from a cpanel-routes / cpanel-proxy response shape:
 *   { status, errors: [string], data: null, code?: 'CPANEL_DOWN', localizedMessages?: { [lang]: string } }
 * Order of preference:
 *   1. Explicit CPANEL_DOWN code → localized or generic "cpanelDown" string
 *   2. First entry in `errors[]` mapped through `friendlyMessage()`
 *   3. Raw first `errors[]` entry (last-resort passthrough)
 */
export function pickErrorMessage(res, t, lang) {
  if (!res) return ''
  if (res.code === 'CPANEL_DOWN') {
    if (res.localizedMessages && res.localizedMessages[lang]) return res.localizedMessages[lang]
    return t('errors.cpanelDown')
  }
  // Broken account homedir/quota (uapi exited status 1 / EPERM). Neither the
  // user-level call nor the WHM root fallback can proceed until ops repairs
  // the account — show a calm message (ops is auto-paged server-side).
  if (res.code === 'CPANEL_UAPI_EPERM') {
    if (res.localizedMessages && res.localizedMessages[lang]) return res.localizedMessages[lang]
    return t('errors.cpanelPermIssue')
  }
  const raw = (res.errors && res.errors[0]) || ''
  if (res.code === 'CPANEL_AUTH_FAILURE' || HTML_RX.test(raw)) return t('errors.cpanelAuthIssue')
  return friendlyMessage(raw, t) || raw
}

/**
 * True when the error looks like a transient timeout (i.e. worth offering a
 * "Try Again" button rather than a harder "service unavailable" message).
 */
export function isTransientError(raw) {
  const msg = String(raw || '')
  return TIMEOUT_RX.test(msg) || UNREACHABLE_RX.test(msg)
}
