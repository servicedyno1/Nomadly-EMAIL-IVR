import sys
sys.path.insert(0, '/app/scripts')
from edit_helper import edit, edit_line

J = '/app/js/'
edit(J + 'telnyx-service.js', [
("const { log } = require('console')\n", "const { log } = require('console')\nconst sipLogins = require('./sip-logins')\n"),
("""// ── Create SIP Credential (username/password for a connection) ──
async function createSIPCredential(connectionId, username, password) {
  try {""",
"""// Settings copied from the main SIP connection onto a per-number short login (everything except the login itself).
const SHORT_LOGIN_CLONE = ['webhook_event_url', 'webhook_event_failover_url', 'webhook_api_version', 'webhook_timeout_secs', 'sip_uri_calling_preference',
  'anchorsite_override', 'encrypted_media', 'default_on_hold_comfort_noise_enabled', 'dtmf_type', 'encode_contact_header_enabled',
  'onnet_t38_passthrough_enabled', 'rtcp_settings', 'inbound', 'outbound', 'ios_push_credential_id', 'android_push_credential_id']

// ── Short SIP login: a credential connection for one number (10-char username, 12-char password) ──
// Returns the same shape as a telephony credential ({ id, sip_username, sip_password }) so callers store it unchanged.
async function createShortSipLogin(mainConnectionId, phoneNumber) {
  const main = mainConnectionId ? await getSIPConnection(mainConnectionId) : null
  if (!main) return null
  const base = {}
  for (const k of SHORT_LOGIN_CLONE) if (main[k] !== undefined && main[k] !== null) base[k] = main[k]
  if (phoneNumber) base.outbound = { ...(main.outbound || {}), ani_override: phoneNumber, ani_override_type: 'always' }
  const tag = String(phoneNumber || '').replace(/\\D/g, '').slice(-12)
  for (let attempt = 0; attempt < 3; attempt++) {
    const user = sipLogins.shortUser(), pass = sipLogins.shortPass()
    try {
      const res = await axios.post(`${BASE}/credential_connections`, { ...base, active: true, connection_name: `civr-${tag}-${user}`, user_name: user, password: pass }, { headers: headers() })
      const c = res.data?.data
      if (c?.id) {
        sipLogins.remember(c.id, user)
        log(`[Telnyx] Short SIP login ${user} created for ${phoneNumber || 'number'} (connection ${c.id})`)
        return { id: String(c.id), sip_username: user, sip_password: pass, connection_id: String(c.id), kind: 'connection' }
      }
    } catch (e) {
      const detail = JSON.stringify(e.response?.data?.errors || e.message)
      log(`[Telnyx] createShortSipLogin attempt ${attempt + 1} failed: ${detail}`)
      if (!/user.?name|taken|exist|unique/i.test(detail)) break
    }
  }
  return null
}

// ── Create SIP Credential (username/password for a connection) ──
// With SIP_SHORT_LOGINS=true a short per-number login is made first; the long telephony credential is the fallback.
async function createSIPCredential(connectionId, username, password, phoneNumber) {
  if (sipLogins.enabled()) {
    const short = await createShortSipLogin(connectionId, phoneNumber)
    if (short) return short
    log('[Telnyx] Short SIP login unavailable — falling back to a telephony credential')
  }
  try {"""),
("""async function deleteSIPCredential(credentialId) {
  try {""",
"""async function deleteSIPCredential(credentialId) {
  if (sipLogins.isConnectionId(credentialId)) {
    try {
      await axios.delete(`${BASE}/credential_connections/${credentialId}`, { headers: headers() })
      sipLogins.forget(credentialId)
      log(`[Telnyx] Deleted short SIP login connection: ${credentialId}`)
      return true
    } catch (e) {
      log(`[Telnyx] delete short SIP login error: ${e.response?.data?.errors?.[0]?.detail || e.message}`)
      return false
    }
  }
  try {"""),
("  createSIPCredential,\n", "  createSIPCredential,\n  createShortSipLogin,\n"),
])

V = J + 'voice-service.js'
edit(V, [
("""        else if (payload.state === 'bridging' && payload.connection_id === (process.env.TELNYX_SIP_CONNECTION_ID || '') && ((payload.to || '').startsWith('sip:') || (payload.to || '').startsWith('gencred'))) {""",
 """        else if (payload.state === 'bridging' && sipLogins.isSipConnection(payload.connection_id) && ((payload.to || '').startsWith('sip:') || (payload.to || '').startsWith('gencred') || sipLogins.isShortLogin(payload.to))) {"""),
("""          const isBenignLeg = toField.includes('bridge_') || toField.startsWith('sip:bridge_') || toField.startsWith('gencred')""",
 """          const isBenignLeg = toField.includes('bridge_') || toField.startsWith('sip:bridge_') || toField.startsWith('gencred') || sipLogins.isShortLogin(toField)"""),
("""  const isFromSipConnection = sipConnectionId && connectionId === sipConnectionId""",
 """  const isFromSipConnection = (sipConnectionId && connectionId === sipConnectionId) || sipLogins.isSipConnection(connectionId)"""),
("""  const isSipByConnection = sipConnectionId && connectionId === sipConnectionId""",
 """  const isSipByConnection = (sipConnectionId && connectionId === sipConnectionId) || sipLogins.isSipConnection(connectionId)"""),
("""  if (!credentialExtracted && payload.from_display_name && payload.from_display_name.startsWith('gencred')) {""",
 """  // Method 3b: a per-number short login's own connection tells us the user directly.
  if (!credentialExtracted && sipLogins.userForConnection(connectionId)) {
    sipUsername = sipLogins.userForConnection(connectionId)
    credentialExtracted = true
    log(`[Voice] SIP user ${sipUsername} identified by its own connection ${connectionId}`)
  }
  if (!credentialExtracted && payload.from_display_name && (payload.from_display_name.startsWith('gencred') || sipLogins.isShortLogin(payload.from_display_name))) {"""),
("""function initVoiceService(deps) {""", """function initVoiceService(deps) {
  if (deps.phoneNumbersOf) sipLogins.loadKnown(deps.phoneNumbersOf, log)"""),
])

# Pass the phone number so the short login dials out with the right caller ID.
I = J + '_index.js'
edit_line(I, 1564, 'createSIPCredential(telnyxResources.sipConnectionId, sipUsername, sipPassword)', 'createSIPCredential(telnyxResources.sipConnectionId, sipUsername, sipPassword, doc.phoneNumber)')
edit_line(I, 3786, 'createSIPCredential(telnyxResources.sipConnectionId, seedUser, seedPass)', 'createSIPCredential(telnyxResources.sipConnectionId, seedUser, seedPass, selectedNumber)')
edit_line(I, 14144, 'createSIPCredential(telnyxResources.sipConnectionId, sipUsername, sipPassword)', 'createSIPCredential(telnyxResources.sipConnectionId, sipUsername, sipPassword, selectedNumber)')
edit_line(I, 34321, 'createSIPCredential(telnyxResources.sipConnectionId, seedUser, seedPass)', 'createSIPCredential(telnyxResources.sipConnectionId, seedUser, seedPass, num.phoneNumber)')
edit_line(I, 39737, 'createSIPCredential(telnyxResources.sipConnectionId, sipUsername, sipPassword)', 'createSIPCredential(telnyxResources.sipConnectionId, sipUsername, sipPassword, selectedNumber)')
edit_line(I, 40767, 'createSIPCredential(telnyxResources.sipConnectionId, sipUsername, sipPassword)', 'createSIPCredential(telnyxResources.sipConnectionId, sipUsername, sipPassword, selectedNumber)')
edit_line(I, 46093, 'createSIPCredential(telnyxResources.sipConnectionId, sipUsername, sipPassword)', 'createSIPCredential(telnyxResources.sipConnectionId, sipUsername, sipPassword, selectedNumber)')
edit_line(I, 50378, 'createSIPCredential(telnyxResources.sipConnectionId, newSeedUser, newSeedPass)', 'createSIPCredential(telnyxResources.sipConnectionId, newSeedUser, newSeedPass, phoneNumber)')
