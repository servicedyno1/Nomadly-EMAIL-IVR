// Keys intentionally left identical to English: admin-only messages, brand/product names,
// lookup tables whose keys are matched programmatically, and placeholder-only templates.
const { ADMIN_KEYS } = require('./admin_keys.js')

const SKIP_PREFIX = [
  't.adm_', 'admin.', 'aO.', 'npl.', 'alcazar.', 'tickerView', 'tickerOf.', 'k.', 'supportedCrypto',
  'buyLeadsSelect', '_buyLeadsSelect', 'validatorSelect', 'vp.of',
]
const SKIP_EXACT = new Set([
  ...ADMIN_KEYS.t.map(k => `t.${k}`),
  ...ADMIN_KEYS.vs.map(k => `vs.${k}`),
  ...ADMIN_KEYS.admin.map(k => `admin.${k}`),
  // brand / product / placeholder-only / slash commands
  't.dpEsim', 't.dpIonosSmtp', 't.cp_234', 't.cp_251', 't.ld_1', 't.wlt_3', 't.host_4',
  't.mpConvItem', 't.mpDoneCmd', 't.mpEscrowCmd', 't.mpPriceCmd', 't.mpReportCmd',
  't.cp_172', 't.cp_181', 't.cp_191', 't.cp_260', 't.cp_261', 't.cp_262', 't.cp_38', 't.cp_54', 't.cp_62', 't.cp_71',
  't.cp_nested_2', 't.cp_nested_3', 't.cp_nested_4',
  'user.smsAppMain', 'user.redBitly', 'user.vpsPlans', 'user.cloudPhone', 'vp.vpsLinuxBtn', 'vp.vpsRdpBtn', 'vp.rdpEditionBtn',
  'u.usd', 'u.ngn',
  'show', 'html', 'getRecordTypeKeyboard', 'hP.generatePlanText',
])
// Same word in that language (no translation needed).
const SKIP_BY_LANG = {
  fr: new Set(['u.txHistory', 'u.depositCrypto', 'user.getSupport', 'payIn.crypto']),
  hi: new Set(),
  zh: new Set(),
}
function isSkipped(k, lang) {
  if (SKIP_EXACT.has(k)) return true
  if (/(^|\.)parse_mode$/.test(k)) return true
  if (lang && SKIP_BY_LANG[lang]?.has(k)) return true
  return SKIP_PREFIX.some(p => k.startsWith(p))
}
module.exports = { SKIP: SKIP_EXACT, SKIP_BY_LANG, isSkipped }
