import sys
sys.path.insert(0, '/app/scripts')
from edit_helper import edit

J = '/app/js/'
edit(J + 'sip-logins.js', [
("const shortPass = () => shuffle(pick(UPPER, 2) + pick(DIGITS, 3) + pick(LOWER + UPPER + DIGITS, 7))",
 "const shortPass = () => shuffle(pick(UPPER, 2) + pick(DIGITS, 3) + pick(LOWER, 2) + pick(LOWER + UPPER + DIGITS, 5))"),
])
edit(J + 'voice-service.js', [
("const planLifecycle = require('./plan-lifecycle.js')\n", "const planLifecycle = require('./plan-lifecycle.js')\nconst sipLogins = require('./sip-logins.js')\n"),
])
edit(J + 'phone-config.js', [
("""function generateSipUsername() {
  // Random seed for Telnyx API — actual sip_username comes from Telnyx response
  const crypto = require('crypto')
  return 'test_' + crypto.randomBytes(8).toString('hex')
}

function generateSipPassword() {
  // Must meet Twilio's requirements: 12+ chars, at least one number, uppercase, lowercase
  const crypto = require('crypto')
  const base = crypto.randomBytes(6).toString('base64').replace(/[^a-zA-Z0-9]/g, '')
  return base + 'Aa1' + crypto.randomBytes(4).toString('hex')
}""",
"""// Short SIP login seed (10 chars, e.g. cvk3x9p2qa). With SIP_SHORT_LOGINS on it is replaced by the real short login;
// otherwise Telnyx answers with its own long gencred… username.
function generateSipUsername() {
  return require('./sip-logins.js').shortUser()
}

// 12 chars with upper, lower and digits (also meets Twilio's 12+ / mixed-case rule).
function generateSipPassword() {
  return require('./sip-logins.js').shortPass()
}"""),
])
edit(J + 'cloudivr-web/numbers.js', [
("const cred = await telnyxApi.createSIPCredential(tr.sipConnectionId, sipUsername, sipPassword)", "const cred = await telnyxApi.createSIPCredential(tr.sipConnectionId, sipUsername, sipPassword, selected)"),
("const cred = await telnyxApi.createSIPCredential(tr.sipConnectionId, user, pass)", "const cred = await telnyxApi.createSIPCredential(tr.sipConnectionId, user, pass, n.phoneNumber)"),
])
