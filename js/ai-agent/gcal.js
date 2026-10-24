'use strict'
// Google Calendar for AI agent bookings. Each web account connects its OWN Google Calendar (OAuth 2.0 authorization
// code flow, offline access). Refresh tokens are AES-256-GCM encrypted at rest and never leave the server.
// Flow follows the Google Calendar playbook: access_type=offline + prompt=consent, direct POST token exchange,
// oauth2/v2/userinfo for the email, refresh on expiry, 401/invalid_grant → reconnect.
const crypto = require('crypto')
const axios = require('axios')

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'
const USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo'
const API = 'https://www.googleapis.com/calendar/v3'
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar'
const SCOPES = ['openid', 'email', CAL_SCOPE]

let http = axios
let links = null, states = null, agents = null
const tokenCache = new Map() // chatId → { token, exp }

const clientId = () => String(process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim()
const clientSecret = () => String(process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim()
const secret = () => String(process.env.CALENDAR_TOKEN_SECRET || process.env.SESSION_SECRET || '')
const configured = () => !!(clientId() && clientSecret() && secret().length >= 16)

function init(db) {
  links = db.collection('aiCalendarLinks'); states = db.collection('aiCalendarStates'); agents = db.collection('aiAgents')
  links.createIndex({ chatId: 1 }, { unique: true }).catch(() => {})
  states.createIndex({ exp: 1 }, { expireAfterSeconds: 0 }).catch(() => {})
}
const setHttp = (h) => { http = h || axios; tokenCache.clear() } // tests

class CalendarError extends Error { constructor(code, message) { super(message || code); this.code = code } }

// ── token sealing ──
const key = () => crypto.createHash('sha256').update(`aiCalendarLinks:${secret()}`).digest()
function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const enc = Buffer.concat([c.update(String(text), 'utf8'), c.final()])
  return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${enc.toString('base64')}`
}
function unseal(s) {
  const [v, iv, tag, enc] = String(s || '').split(':')
  if (v !== 'v1' || !iv || !tag || !enc) throw new CalendarError('bad_token')
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'))
  d.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8')
}

const form = (o) => new URLSearchParams(o).toString()
const FORM = { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
const gErr = (e) => e.response?.data?.error_description || e.response?.data?.error?.message || (typeof e.response?.data?.error === 'string' ? e.response.data.error : '') || e.message

// ── connect / disconnect ──
async function startConnect(chatId, { redirectUri, returnTo }) {
  if (!configured()) throw new CalendarError('not_configured', 'Google Calendar is not available yet.')
  const state = crypto.randomBytes(24).toString('base64url')
  await states.insertOne({ _id: state, chatId: String(chatId), redirectUri, returnTo: returnTo || null, exp: new Date(Date.now() + 10 * 60000) })
  const q = new URLSearchParams({
    client_id: clientId(), redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  })
  return `${AUTH_URL}?${q}`
}

// Google redirected back → { ok, returnTo, email?, error? }. The state is single-use and expires after 10 minutes.
async function finishConnect({ state, code, error }) {
  const r = await states.findOneAndDelete({ _id: String(state || '') })
  const st = r && r.value !== undefined ? r.value : r
  if (!st || new Date(st.exp).getTime() < Date.now()) return { ok: false, error: 'expired', returnTo: st?.returnTo || null }
  if (error || !code) return { ok: false, error: error === 'access_denied' ? 'denied' : 'failed', returnTo: st.returnTo }
  try {
    const t = (await http.post(TOKEN_URL, form({ code: String(code), client_id: clientId(), client_secret: clientSecret(), redirect_uri: st.redirectUri, grant_type: 'authorization_code' }), FORM)).data
    if (!String(t.scope || '').split(' ').includes(CAL_SCOPE)) return { ok: false, error: 'scope', returnTo: st.returnTo }
    if (!t.refresh_token) return { ok: false, error: 'no_refresh', returnTo: st.returnTo }
    const email = String((await http.get(USERINFO_URL, { headers: { Authorization: `Bearer ${t.access_token}` }, timeout: 15000 })).data?.email || '').slice(0, 200)
    const chatId = st.chatId
    const prev = await links.findOne({ chatId })
    await links.updateOne({ chatId }, { $set: { chatId, email, refreshToken: seal(t.refresh_token), scope: t.scope, status: 'ok', error: null, connectedAt: new Date() } }, { upsert: true })
    tokenCache.set(chatId, { token: t.access_token, exp: Date.now() + (Number(t.expires_in || 3600) - 60) * 1000 })
    // A different Google account has different calendars: agents fall back to its main calendar.
    if (prev && prev.email !== email) await agents.updateMany({ chatId, 'booking.calendarId': { $ne: 'primary' } }, { $set: { 'booking.calendarId': 'primary', 'booking.calendarName': null } }).catch(() => {})
    return { ok: true, returnTo: st.returnTo, email }
  } catch (e) {
    console.log(`[AIAgent] Google connect failed: ${gErr(e)}`)
    return { ok: false, error: 'failed', returnTo: st.returnTo }
  }
}

async function disconnect(chatId) {
  chatId = String(chatId)
  const l = await links.findOne({ chatId })
  tokenCache.delete(chatId)
  if (!l) return false
  try { await http.post(REVOKE_URL, form({ token: unseal(l.refreshToken) }), FORM) } catch (_) { /* already revoked */ }
  await links.deleteOne({ chatId })
  return true
}

// Safe for the browser: never includes tokens.
async function status(chatId) {
  const l = links ? await links.findOne({ chatId: String(chatId) }) : null
  return { configured: configured(), connected: !!l && l.status === 'ok', email: l?.email || null, status: l?.status || null, error: l?.error || null, connectedAt: l?.connectedAt || null }
}
const isConnected = async (chatId) => configured() && !!(await links?.findOne({ chatId: String(chatId), status: 'ok' }))

// ── API calls ──
async function markRevoked(chatId) {
  tokenCache.delete(chatId)
  await links.updateOne({ chatId }, { $set: { status: 'revoked', error: 'Google access was removed. Connect the calendar again.' } }).catch(() => {})
}

async function accessToken(chatId) {
  chatId = String(chatId)
  const c = tokenCache.get(chatId)
  if (c && c.exp > Date.now()) return c.token
  const l = await links.findOne({ chatId })
  if (!l || l.status !== 'ok') throw new CalendarError('not_connected', 'Google Calendar is not connected.')
  try {
    const t = (await http.post(TOKEN_URL, form({ client_id: clientId(), client_secret: clientSecret(), refresh_token: unseal(l.refreshToken), grant_type: 'refresh_token' }), FORM)).data
    tokenCache.set(chatId, { token: t.access_token, exp: Date.now() + (Number(t.expires_in || 3600) - 60) * 1000 })
    return t.access_token
  } catch (e) {
    if (e.code === 'bad_token' || e.response?.data?.error === 'invalid_grant') { await markRevoked(chatId); throw new CalendarError('revoked', 'Google access was removed.') }
    throw new CalendarError('google_error', gErr(e))
  }
}

async function call(chatId, method, path, body) {
  const token = await accessToken(chatId)
  const opts = { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
  try {
    return (await (method === 'GET' ? http.get(`${API}${path}`, opts) : http.post(`${API}${path}`, body, opts))).data
  } catch (e) {
    const st = e.response?.status
    if (st === 401) { tokenCache.delete(String(chatId)) }
    throw new CalendarError(st === 404 ? 'calendar_not_found' : st === 403 ? 'forbidden' : 'google_error', gErr(e))
  }
}

// Calendars the account can add events to.
async function listCalendars(chatId) {
  const r = await call(chatId, 'GET', '/users/me/calendarList?minAccessRole=writer&maxResults=100')
  return (r.items || []).map(c => ({ id: c.id, name: c.summaryOverride || c.summary || c.id, primary: !!c.primary, timeZone: c.timeZone || null }))
}

// Busy intervals [{start, end}] (ISO) on one calendar.
async function busy(chatId, calendarId, timeMin, timeMax) {
  const id = calendarId || 'primary'
  const r = await call(chatId, 'POST', '/freeBusy', { timeMin, timeMax, items: [{ id }] })
  const cal = r.calendars?.[id] || Object.values(r.calendars || {})[0] || {}
  if (cal.errors?.length) throw new CalendarError(cal.errors[0].reason === 'notFound' ? 'calendar_not_found' : 'google_error', cal.errors[0].reason)
  return cal.busy || []
}

async function createEvent(chatId, calendarId, event) {
  const r = await call(chatId, 'POST', `/calendars/${encodeURIComponent(calendarId || 'primary')}/events`, event)
  return { id: r.id, link: r.htmlLink || null }
}

module.exports = {
  init, setHttp, configured, startConnect, finishConnect, disconnect, status, isConnected, listCalendars, busy, createEvent,
  seal, unseal, CalendarError, SCOPES, _tokenCache: tokenCache,
}
