'use strict'
// Ring groups: every call to the number rings up to 5 phones at once; the first to answer gets the caller. When nobody
// answers: voicemail, one backup number, or a short message and hang up. The call engine runs it (voice-service).
const phoneConfig = require('../phone-config')
const dialNorm = require('../backup-numbers').norm

const MAX_MEMBERS = 5
const FALLBACKS = ['voicemail', 'forward', 'message']
const E164 = /^\+[1-9]\d{7,14}$/
const bad = (res, status, error, message) => res.status(status).json({ error, message })

const defaults = () => ({ enabled: false, members: [], ringTimeout: 25, fallback: 'voicemail', fallbackTo: null, message: '' })

// Normalizes a saved group; throws Error(message) on bad input.
function validate(body = {}, num) {
  const raw = Array.isArray(body.members) ? body.members : String(body.members || '').split(/[,;\n]+/)
  const members = [...new Set(raw.map(m => dialNorm(String(m || '').trim())).filter(Boolean))]
  if (members.length > MAX_MEMBERS) throw new Error(`Add up to ${MAX_MEMBERS} phones.`)
  for (const m of members) {
    if (!E164.test(m)) throw new Error(`${m} is not a valid number. Use the country code, e.g. +14155550100.`)
    if (phoneConfig.isBlockedPrefix(m)) throw new Error(`${m} is a blocked premium/satellite destination.`)
    if (m === num.phoneNumber) throw new Error('A number cannot ring itself — add other phones.')
  }
  const enabled = !!body.enabled
  if (enabled && members.length < 2) throw new Error('Add at least 2 phones to ring at once (for one phone, use Forwarding).')
  const ringTimeout = Math.min(60, Math.max(10, parseInt(body.ringTimeout, 10) || 25))
  let fallback = FALLBACKS.includes(body.fallback) ? body.fallback : 'voicemail'
  if (fallback === 'voicemail' && !phoneConfig.canAccessFeature(num.plan, 'voicemail')) throw new Error('Voicemail needs the Pro plan or higher.')
  let fallbackTo = null
  if (fallback === 'forward') {
    fallbackTo = dialNorm(String(body.fallbackTo || '').trim())
    if (!E164.test(fallbackTo || '')) throw new Error('Enter the backup number with country code, e.g. +14155550100.')
    if (phoneConfig.isBlockedPrefix(fallbackTo)) throw new Error(`${fallbackTo} is a blocked premium/satellite destination.`)
    if (fallbackTo === num.phoneNumber) throw new Error('The backup number must be a different phone.')
    if (members.includes(fallbackTo)) throw new Error('The backup number already rings with the group — pick another phone.')
  }
  const message = fallback === 'message' ? String(body.message || '').trim().slice(0, 300) : ''
  return { enabled, members, ringTimeout, fallback, fallbackTo, message }
}

function routes(router, { h, numbersApi }) {
  router.put('/numbers/:phone/ring-group', h(async (req, res) => {
    const num = await numbersApi.findMine(req.webChatId, req.params.phone)
    if (!num) return bad(res, 404, 'not_found', 'Number not found on your account.')
    if (!phoneConfig.canAccessFeature(num.plan, 'ringGroup')) return bad(res, 403, 'plan_upgrade_required', 'Ring groups need the Pro plan or higher on this number.')
    let value
    try { value = validate(req.body, num) } catch (e) { return bad(res, 400, 'invalid_ring_group', e.message) }
    await numbersApi.setField(req.webChatId, num.phoneNumber, 'features.ringGroup', value)
    const f = num.features || {}
    const skipped = value.enabled ? [f.callForwarding?.enabled && 'forwarding', f.ivr?.enabled && 'keypad menu', f.browserRing?.enabled && 'browser ring'].filter(Boolean) : []
    res.json({ ringGroup: value, skipped, aiAgentFirst: !!(value.enabled && f.aiAgent?.enabled && phoneConfig.canAccessFeature(num.plan, 'aiAgent')) })
  }))
}

module.exports = { routes, validate, defaults, MAX_MEMBERS, FALLBACKS }
