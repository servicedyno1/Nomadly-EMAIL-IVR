/* global process */
require('dotenv').config()
const axios = require('axios')

// ─────────────────────────────────────────────────────────────────────────────
// Shortit "Random" link provider — Linkly (https://linklyhq.com/support/api)
// ─────────────────────────────────────────────────────────────────────────────
// 2026-10-22: replaced RapidAPI (srtn-me-url-shortener → srtn.me/<slug>) with
// Linkly. Links are created on Linkly's own domain (linkly.link/<code>).
//
//   POST https://api.linklyhq.com/api/v1/workspace/{workspace_id}/links
//   Authorization: Bearer <LINKLY_API_KEY>
//   JSON body: { workspace_id, url, name[, domain] }
//   200 → { id, full_url: "https://linkly.link/<code>", url, ... }
//   Errors → { error, code } with 400/401/403/404/422/429/500
//
// Env (read at call time so a key/env change needs no code change):
//   LINKLY_API_KEY       required
//   LINKLY_WORKSPACE_ID  optional — when unset, auto-discovered via
//                        GET /api/v1/workspaces (first workspace) and cached
//   LINKLY_DOMAIN        optional — a custom domain configured inside Linkly;
//                        unset = Linkly's default linkly.link
//   LINKLY_LINK_NAME     optional — nickname shown in the Linkly dashboard
//
// Notes:
//   - Linkly does NOT validate destination URLs (it accepts "notaurl"), so the
//     bot's own sanitizeShortenerUrl + isValidUrl checks remain the only guard.
//   - Linkly click analytics is a separate, heavily rate-limited API (50/h,
//     100/month on Free) — per product decision these links show
//     "analytics not available" in My Links (see shortener-analytics.js).
//
// History: url-shortener42 → url-shortener57 (goolnk.com) → tiny-url-shortner
// (tinyurl.com brand leak) → srtn-me (RapidAPI, srtn.me) → Linkly (current).
// ─────────────────────────────────────────────────────────────────────────────

const LINKLY_API_BASE = 'https://api.linklyhq.com/api/v1'
const LINKLY_TIMEOUT_MS = 15000

let _cachedWorkspaceId = null

function _linklyHeaders() {
  return {
    Authorization: `Bearer ${process.env.LINKLY_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

// Turn an axios error into a single readable message (status + Linkly's text).
function _linklyError(error) {
  if (error && error.response) {
    const d = error.response.data
    let msg
    if (d && typeof d === 'object') msg = d.error || d.message || JSON.stringify(d)
    else msg = String(d || error.message || 'unknown error')
    return new Error(`Linkly error (${error.response.status}): ${msg}`)
  }
  return error instanceof Error ? error : new Error(String(error))
}

async function getLinklyWorkspaceId() {
  const fromEnv = String(process.env.LINKLY_WORKSPACE_ID || '').trim()
  if (fromEnv) return fromEnv
  if (_cachedWorkspaceId) return _cachedWorkspaceId
  const res = await axios.get(`${LINKLY_API_BASE}/workspaces`, {
    headers: _linklyHeaders(),
    timeout: LINKLY_TIMEOUT_MS,
  })
  const first = Array.isArray(res.data) ? res.data[0] : null
  if (!first || !first.id) throw new Error('Linkly error: no workspace found for this API key')
  _cachedWorkspaceId = String(first.id)
  return _cachedWorkspaceId
}

const createShortUrlApi = async longUrl => {
  if (!process.env.LINKLY_API_KEY) {
    throw new Error('Linkly error: LINKLY_API_KEY is not configured')
  }
  try {
    const workspaceId = await getLinklyWorkspaceId()
    const body = {
      workspace_id: Number(workspaceId),
      url: longUrl,
      name: process.env.LINKLY_LINK_NAME || 'Shortit link',
    }
    const domain = String(process.env.LINKLY_DOMAIN || '').trim()
    if (domain) body.domain = domain

    const response = await axios.post(`${LINKLY_API_BASE}/workspace/${workspaceId}/links`, body, {
      headers: _linklyHeaders(),
      timeout: LINKLY_TIMEOUT_MS,
    })

    const shortLink = response.data && response.data.full_url
    if ((response.status === 200 || response.status === 201) && shortLink) {
      return shortLink
    }
    if (response.data && (response.data.error || response.data.message)) {
      throw new Error(`Linkly error: ${response.data.error || response.data.message}`)
    }
    throw new Error(`Linkly returned status ${response.status} without a full_url`)
  } catch (error) {
    throw _linklyError(error)
  }
}

const analyticsCuttly = async _shortUrlHash => {
  // Legacy ap1s.net links: PromptAPI is no longer available → 0.
  // srtn.me (old RapidAPI) and linkly.link links have no stats in My Links.
  // Own-domain links use the clicksOn MongoDB collection instead.
  return 0
}

module.exports = { createShortUrlApi, analyticsCuttly, getLinklyWorkspaceId }
