// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Provider Name Sanitizer — strips API provider names from user-facing messages
// Replaces Twilio, Telnyx, OpenProvider, ConnectReseller with user-friendly alternatives
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Sanitize an error message to remove API provider names.
 * Used for ALL user-facing error messages to prevent provider name leaks.
 *
 * @param {string} msg - The raw error message
 * @param {string} [context='generic'] - Context: 'voice', 'domain', 'sms', 'generic'
 * @returns {string} Sanitized message safe for user display
 */
function sanitizeProviderError(msg, context = 'generic') {
  if (!msg || typeof msg !== 'string') return msg || 'An error occurred'

  // ── Known registrar "domain status" lock → friendly, actionable message ──
  // ConnectReseller/OpenProvider reject nameserver/contact updates while a
  // domain is in a state that disallows them: freshly registered & still
  // activating at the registry, pending transfer, registry-locked, or expired.
  // The raw text ("This action is prohibitted for current domain status")
  // confused a user (support chat 2026-08-07, user 8868602470 "What's wrong
  // with my domain? Rbc"). Short-circuit with a clear next-step so users aren't
  // left staring at a registrar-speak error.
  const _lc = msg.toLowerCase()
  if (_lc.includes('current domain status') &&
      (_lc.includes('prohibit') || _lc.includes('not allowed') || _lc.includes('cannot'))) {
    return "Your domain isn't ready for nameserver changes yet — it may still be activating at the registry (this can take a few minutes after registration) or is temporarily locked. Please try again shortly. If it keeps failing, tap 💬 Support and we'll sort it out."
  }

  let sanitized = msg

  // ── FIX: HTML entity escaping ──
  // Cloudflare error messages contain URLs like <https://...> which break Telegram HTML parse mode.
  // Escape < > & to prevent "Unsupported start tag" errors from Telegram.
  sanitized = sanitized.replace(/&/g, '&amp;')
  sanitized = sanitized.replace(/</g, '&lt;')
  sanitized = sanitized.replace(/>/g, '&gt;')

  // ── STRIP provider URLs FIRST (before name substitution) ──
  // Real prod incident (2026-05-26): OpenProvider 500 error message contained
  // "see https://support.openprovider.eu/hc/..." → after the OpenProvider→registrar
  // substitution that ran on line below, the link became "https://support.registrar.eu/hc/..."
  // which is a real domain that goes NOWHERE useful (and looks suspicious).
  // We strip BEFORE substitution so we match the original URL patterns and we
  // also defensively catch the post-substitution forms in case anything else
  // injects them.
  //
  // Character class excludes URL terminators (whitespace, ), ], <, >, ", ', ;)
  // so the closing paren / bracket of (see URL) is preserved for cleanup below.
  const _PROVIDER_HOSTS = [
    'openprovider', 'connectreseller', 'connect-reseller',
    'registrar', // post-substitution defensive match
    'twilio', 'telnyx', // voice providers
  ]
  const _PROVIDER_TLDS = '(?:eu|com|net|io|co|nl|be|de|uk|fr|us|ca|app)'
  for (const host of _PROVIDER_HOSTS) {
    // (?:[\w-]+\.)*  → any number of subdomains (api., support., www., etc.)
    const re = new RegExp(
      `https?:\\/\\/(?:[\\w-]+\\.)*${host}\\.${_PROVIDER_TLDS}[^\\s)\\]<>"';]*`,
      'gi'
    )
    sanitized = sanitized.replace(re, '')
  }
  // Bracketed/parenthesized leftovers like "(see )", "[see ]", "( )" after URL removal
  sanitized = sanitized.replace(/\(\s*(?:see|visit|check|cf\.?|cf|more\s+(?:info|details)|details?|docs?|help)?\s*\)/gi, '')
  sanitized = sanitized.replace(/\[\s*(?:see|visit|check|more\s+(?:info|details)|details?|docs?|help)?\s*\]/gi, '')
  // Also strip "see <empty>" / "visit <empty>" trailing fragments
  sanitized = sanitized.replace(/\b(?:see|visit|check|read\s+more\s+at|details?\s+at|docs?\s+at|more\s+at)[\s:]*(?=[.;,!?]|$)/gi, '')
  // Strip "For more information please [check|visit|see] <stripped-url>" / "For more details ..." dangling fragments
  // Real prod: OpenProvider returns "...registry message below. For more information please check https://support.openprovider.eu/..."
  // After URL scrub the trailing "For more information please " is meaningless to the user.
  sanitized = sanitized.replace(/\bFor\s+more\s+(?:information|details|info)\s+please(?:\s+(?:check|visit|see|refer\s+to))?\s*[.,;:]?\s*$/gi, '')
  sanitized = sanitized.replace(/\bplease\s+(?:check|visit|see|refer\s+to)\s*[.,;:]?\s*$/gi, '')

  // ── Scrub bare provider-nameserver hostnames BEFORE name substitution ──
  // e.g. "ns1.openprovider.nl unreachable" — must run before the OpenProvider→registrar
  // rename below or it would morph into "ns1.registrar.nl" which is misleading.
  sanitized = sanitized.replace(/\bns\d+\.openprovider\.(?:nl|be|eu|com|net|de)\b/gi, 'default nameserver')
  sanitized = sanitized.replace(/\bns\d+\.connectreseller\.(?:com|net|eu)\b/gi, 'default nameserver')

  // ── Voice/Call provider names ──
  sanitized = sanitized.replace(/\bTwilio\b/gi, 'Speechcue')
  sanitized = sanitized.replace(/\bTelnyx\b/gi, 'Speechcue')

  // ── Domain registrar names ──
  sanitized = sanitized.replace(/\bOpenProvider\b/gi, 'registrar')
  sanitized = sanitized.replace(/\bConnectReseller\b/gi, 'registrar')
  sanitized = sanitized.replace(/\bConnect Reseller\b/gi, 'registrar')
  // Abbreviations sometimes used internally
  sanitized = sanitized.replace(/\bOP\s+(API|service|error|domain)/gi, 'registrar $1')
  sanitized = sanitized.replace(/\bCR\s+(API|service|error|domain)/gi, 'registrar $1')

  // ── Infrastructure / hosting provider names ──
  // Railway / .up.railway.app URLs that may leak into error messages
  sanitized = sanitized.replace(/https?:\/\/[\w-]+\.up\.railway\.app[^\s)\]<>"';]*/gi, '')
  sanitized = sanitized.replace(/\b[\w-]+\.up\.railway\.app\b/gi, 'our infrastructure')
  sanitized = sanitized.replace(/\bRailway\b/g, 'our infrastructure')
  // Contabo (VPS provider) — never expose to end users
  sanitized = sanitized.replace(/https?:\/\/(?:[\w-]+\.)*contabo\.com[^\s)\]<>"';]*/gi, '')
  sanitized = sanitized.replace(/\b(?:[\w-]+\.)*contabo\.com\b/gi, 'our VPS provider')
  sanitized = sanitized.replace(/\bContabo\b/gi, 'our VPS provider')

  // ── Strip internal API paths / account identifiers ──
  // Twilio account paths like /2010-04-01/Accounts/AC.../
  sanitized = sanitized.replace(/\/\d{4}-\d{2}-\d{2}\/Accounts\/AC[a-f0-9]+\/[^\s]*/gi, '[internal]')
  // Twilio SIDs (AC..., PN..., etc.)
  sanitized = sanitized.replace(/\b(AC|PN|SK|CL|SD|CR)[a-f0-9]{32}\b/gi, '[redacted]')
  // Telnyx UUIDs in error messages
  sanitized = sanitized.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[ref]')

  // ── Strip provider hostnames that appear bare (no scheme) — e.g.
  //    "api.openprovider.eu returned 500". We do this AFTER the URL strip
  //    because bare hostnames must be matched without a scheme prefix.
  for (const host of _PROVIDER_HOSTS) {
    const re = new RegExp(`\\b(?:[\\w-]+\\.)*${host}\\.${_PROVIDER_TLDS}\\b`, 'gi')
    sanitized = sanitized.replace(re, 'our provider')
  }

  // ── Strip "purchased from Twilio/Telnyx" patterns ──
  sanitized = sanitized.replace(/you've verified or purchased from Speechcue/gi, 'you own or have verified')
  sanitized = sanitized.replace(/purchased from Speechcue/gi, 'purchased')
  sanitized = sanitized.replace(/verified for your account/gi, 'verified for your account')

  // ── Final scrub: catch any stray scheme-less hostnames that may have
  //    been introduced after the name substitutions above (defense-in-depth). ──
  sanitized = sanitized.replace(/\bns\d+\.(?:openprovider|registrar|connectreseller)\.(?:nl|be|eu|com|net|de)\b/gi, 'default nameserver')

  // ── Clean up double spaces, orphan punctuation, and trailing dots ──
  sanitized = sanitized.replace(/\s+([.,;!?])/g, '$1') // remove space before punctuation
  sanitized = sanitized.replace(/([.,;!?])\1+/g, '$1') // collapse repeated punctuation
  sanitized = sanitized.replace(/\s{2,}/g, ' ').trim()

  // If sanitization left us with empty / near-empty content, fall back to
  // a friendly generic so we never show "" or "(.)" to the user.
  if (!sanitized || sanitized.length < 3 || /^[.,;!?\s]*$/.test(sanitized)) {
    sanitized = context === 'voice' ? 'Voice service temporarily unavailable'
      : context === 'domain' ? 'Domain provider returned an error'
      : context === 'sms' ? 'SMS service temporarily unavailable'
      : 'Service temporarily unavailable'
  }

  return sanitized
}

/**
 * Sanitize a hangup cause for user display in campaign progress.
 * Returns a short, user-friendly reason.
 */
function sanitizeHangupCause(cause) {
  if (!cause || typeof cause !== 'string') return 'Unknown error'

  const lower = cause.toLowerCase()

  // Map known Twilio/Telnyx error patterns to friendly messages
  if (lower.includes('not yet verified') || lower.includes('not verified')) {
    return 'Caller ID not verified for this account'
  }
  // Twilio error 20003 = "Authenticate" — sub-account credentials rejected.
  // Happens when the caller-ID's Twilio sub-account has been suspended by
  // the provider, disabled, or its authToken was rotated. Users used to see
  // a bare "Authenticate" and had no idea what to do (see @Padrino_voodoo
  // support-chat transcript 2026-07-24 05:27 — AI misdiagnosed it as a SIP
  // credential issue). Give them the real explanation + action. Fix 2026-07-24.
  //
  // 2026-08-01 REFINEMENT: makeOutboundCall now self-heals via master + retries
  // once after a 750ms delay before surfacing the error. Two distinct final
  // messages are used:
  //   (a) "Voice provider is temporarily rate-limiting..." — sub-account is
  //       still 'active' on Twilio but calls keep 401'ing (Twilio transient
  //       trust-hub / rate-limit blip). Tell user to retry, NOT contact support.
  //   (b) "Authenticate — sub-account is closed/suspended..." — verified via
  //       master fetch that the sub-account really is dead. Support required.
  if (lower.includes('temporarily rate-limiting') ||
      lower.includes('provider auth service temporarily unavailable') ||
      lower.includes('rate-limiting caller-id auth')) {
    return 'Voice provider is temporarily rate-limiting caller-ID auth. Please try the call again in a moment.'
  }
  // Telnyx auth failure — 10009 "No key found matching the ID 'KEY…' with the provided secret."
  // Leaks the API key ID in the message; also users can't fix this. Ops task.
  if (lower.includes('no key found matching the id') || lower.includes('code=10009') || lower.startsWith('10009')) {
    return 'Voice service is temporarily unavailable. Please try again shortly — our team has been notified.'
  }
  if (lower === 'authenticate' || lower.startsWith('authenticate ') || lower.includes('authenticate error') || lower.includes('20003') || lower.includes('authentication error')) {
    return 'Caller ID rejected by provider (authentication failed). Your number\'s sub-account may be suspended — contact support.'
  }
  if (lower.includes('blacklisted') || lower.includes('blocked')) {
    return 'Number is blocked or blacklisted'
  }
  if (lower.includes('invalid phone') || lower.includes('invalid number') || lower.includes('not a valid phone')) {
    return 'Invalid phone number'
  }
  if (lower.includes('insufficient') || lower.includes('balance')) {
    return 'Insufficient account balance'
  }
  if (lower.includes('rate limit') || lower.includes('too many')) {
    return 'Rate limit reached — try again later'
  }
  if (lower.includes('unreachable') || lower.includes('not reachable')) {
    return 'Number not reachable'
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'Call timed out'
  }
  if (lower.includes('rejected') || lower.includes('declined')) {
    return 'Call was rejected'
  }
  if (lower.includes('network') || lower.includes('connectivity')) {
    return 'Network error'
  }
  if (lower.includes('permission') || lower.includes('not allowed') || lower.includes('geo permission')) {
    return 'Calling this destination is not permitted'
  }

  // Fallback: sanitize the raw message
  return sanitizeProviderError(cause, 'voice')
}

/**
 * Sanitize text for use in AI LLM CONTEXT (system prompt / user context blocks).
 * - Strips third-party provider brand names so the AI never sees them and can't repeat them.
 * - Does NOT HTML-escape (we don't want literal &lt;b&gt; appearing in user-context strings).
 * - Maps registrar/voice-provider names to user-facing brand "Nomadly" / "Speechcue".
 *
 * Used before injecting any string sourced from DB (registrar, provider, error logs, etc.)
 * into the LLM context for AI support, marketplace AI, etc.
 */
function sanitizeAiContext(text) {
  if (text === null || text === undefined) return text
  if (typeof text !== 'string') return text
  let s = text

  // Strip provider URLs first (api.openprovider.eu, support.openprovider.eu, etc.)
  const _HOSTS = ['openprovider', 'connectreseller', 'connect-reseller', 'twilio', 'telnyx']
  const _TLDS = '(?:eu|com|net|io|co|nl|be|de|uk|fr|us|ca|app)'
  for (const host of _HOSTS) {
    s = s.replace(new RegExp(`https?:\\/\\/(?:[\\w-]+\\.)*${host}\\.${_TLDS}[^\\s)\\]<>"';]*`, 'gi'), '')
    s = s.replace(new RegExp(`\\b(?:[\\w-]+\\.)*${host}\\.${_TLDS}\\b`, 'gi'), 'our provider')
  }

  // Voice / SIP brand names → Speechcue (the consumer-facing voice brand)
  s = s.replace(/\bTwilio\b/gi, 'Speechcue')
  s = s.replace(/\bTelnyx\b/gi, 'Speechcue')

  // Domain-registrar brand names → Nomadly (the consumer-facing brand for purchased domains)
  s = s.replace(/\bOpenProvider\b/gi, (process.env.CHAT_BOT_BRAND || 'Nomadly'))
  s = s.replace(/\bConnect\s?Reseller\b/gi, (process.env.CHAT_BOT_BRAND || 'Nomadly'))
  // Strip lowercase forms that may come from DB source fields like source: 'openprovider'
  s = s.replace(/\bopenprovider\b/gi, (process.env.CHAT_BOT_BRAND || 'Nomadly'))
  s = s.replace(/\bconnectreseller\b/gi, (process.env.CHAT_BOT_BRAND || 'Nomadly'))

  // Internal abbreviations
  s = s.replace(/\bOP\s+(API|service|error|domain|account)/gi, 'registrar $1')
  s = s.replace(/\bCR\s+(API|service|error|domain|account)/gi, 'registrar $1')

  // Infrastructure / VPS providers
  s = s.replace(/\b[\w-]+\.up\.railway\.app\b/gi, 'our infrastructure')
  s = s.replace(/\bRailway\b/g, ((process.env.CHAT_BOT_BRAND || 'Nomadly') + ' infrastructure'))
  s = s.replace(/\b(?:[\w-]+\.)*contabo\.com\b/gi, 'our VPS provider')
  s = s.replace(/\bContabo\b/gi, ((process.env.CHAT_BOT_BRAND || 'Nomadly') + ' VPS'))

  // Provider-default nameserver hostnames
  s = s.replace(/\bns\d+\.(?:openprovider|nomadly)\.(?:nl|be|eu|com|net|de)\b/gi, 'default nameserver')
  s = s.replace(/\bns\d+\.connectreseller\.(?:com|net|eu)\b/gi, 'default nameserver')

  return s.replace(/\s{2,}/g, ' ').trim()
}

/**
 * Sanitize a final user-facing AI response just before sending to Telegram.
 * - Like sanitizeProviderError but does NOT HTML-escape, because the AI is instructed
 *   to use <b>, <i>, <code> tags for formatting and Telegram needs them intact.
 * - Defence-in-depth: even with system-prompt instructions, the LLM can still slip
 *   in a brand name from training data. This is the last line of defence.
 */
function sanitizeUserText(text) {
  if (text === null || text === undefined) return text
  if (typeof text !== 'string') return text
  let s = text

  // Strip provider URLs (any subdomain of openprovider/connectreseller/twilio/telnyx)
  const _HOSTS = ['openprovider', 'connectreseller', 'connect-reseller', 'twilio', 'telnyx']
  const _TLDS = '(?:eu|com|net|io|co|nl|be|de|uk|fr|us|ca|app)'
  for (const host of _HOSTS) {
    s = s.replace(new RegExp(`https?:\\/\\/(?:[\\w-]+\\.)*${host}\\.${_TLDS}[^\\s)\\]<>"';]*`, 'gi'), '')
  }

  // Bare host references → "our provider"
  for (const host of _HOSTS) {
    s = s.replace(new RegExp(`\\b(?:[\\w-]+\\.)*${host}\\.${_TLDS}\\b`, 'gi'), 'our provider')
  }

  // Brand names → user-facing alternatives
  s = s.replace(/\bTwilio\b/gi, 'Speechcue')
  s = s.replace(/\bTelnyx\b/gi, 'Speechcue')
  s = s.replace(/\bOpenProvider\b/gi, (process.env.CHAT_BOT_BRAND || 'Nomadly'))
  s = s.replace(/\bopenprovider\b/gi, (process.env.CHAT_BOT_BRAND || 'Nomadly'))
  s = s.replace(/\bConnect\s?Reseller\b/gi, (process.env.CHAT_BOT_BRAND || 'Nomadly'))
  s = s.replace(/\bconnectreseller\b/gi, (process.env.CHAT_BOT_BRAND || 'Nomadly'))

  // Infrastructure / VPS providers
  s = s.replace(/https?:\/\/[\w-]+\.up\.railway\.app[^\s)\]<>"';]*/gi, '')
  s = s.replace(/\b[\w-]+\.up\.railway\.app\b/gi, 'our infrastructure')
  s = s.replace(/\bRailway\b/g, ((process.env.CHAT_BOT_BRAND || 'Nomadly') + ' infrastructure'))
  s = s.replace(/https?:\/\/(?:[\w-]+\.)*contabo\.com[^\s)\]<>"';]*/gi, '')
  s = s.replace(/\b(?:[\w-]+\.)*contabo\.com\b/gi, 'our VPS provider')
  s = s.replace(/\bContabo\b/gi, ((process.env.CHAT_BOT_BRAND || 'Nomadly') + ' VPS'))

  // Provider-default nameserver hostnames
  s = s.replace(/\bns\d+\.(?:openprovider|connectreseller)\.(?:nl|be|eu|com|net|de)\b/gi, 'default nameserver')

  // Clean up orphaned parens / "(see )" leftovers from URL strip
  s = s.replace(/\(\s*(?:see|visit|check|more\s+(?:info|details)|details?|docs?|help)?\s*\)/gi, '')
  s = s.replace(/\[\s*(?:see|visit|check|more\s+(?:info|details)|details?|docs?|help)?\s*\]/gi, '')
  s = s.replace(/\bFor\s+more\s+(?:information|details|info)\s+please(?:\s+(?:check|visit|see|refer\s+to))?\s*[.,;:]?\s*$/gim, '')

  // Tidy spaces & space-before-punct — but PRESERVE line breaks so list items
  // and paragraphs don't collapse into one run-on line (AI formatting fix).
  s = s.replace(/[ \t]+([.,;!?])/g, '$1')
  s = s.replace(/[ \t]{2,}/g, ' ')
  s = s.replace(/[ \t]*\n[ \t]*/g, '\n')
  s = s.replace(/\n{3,}/g, '\n\n').trim()

  return s
}

// Display name for a voice carrier in any chat message (customer, support or admin). Raw values stay in DB/logs.
const NETWORK_LABELS = { telnyx: 'Speechcue' }
const networkLabel = (provider) => NETWORK_LABELS[String(provider || '').toLowerCase()] || provider

module.exports = {
  networkLabel,
  sanitizeProviderError,
  sanitizeHangupCause,
  sanitizeAiContext,
  sanitizeUserText,
}
