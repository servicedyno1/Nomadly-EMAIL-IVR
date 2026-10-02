// Admin-only dictionary keys: must stay English in every locale (reset to en by round-2 parts).
const range = (p, a, b, skip = []) => Array.from({ length: b - a + 1 }, (_, i) => `${p}${a + i}`).filter(k => !skip.includes(k))

const { en } = require('../../js/lang/en.js')

const ADMIN_KEYS = {
  t: [
    ...Object.keys(en.t).filter(k => k.startsWith('adm_')),
    ...range('host_', 13, 22), 'host_2',
    ...range('sms_', 10, 23),
    'ev_3', 'ev_4', 'ev_5', 'ev_6', 'ev_7', 'ev_8', 'ev_9', 'ev_10', 'ev_11', 'ev_12', 'ev_13',
    'vps_9', ...range('vps_', 11, 46),
    'bulkCallProgressLine',
  ],
  vs: ['orphanedNumberAlert'],
  admin: Object.keys(en.admin || {}),
}

// Only keys that exist in the source object (lang files may drift).
const pick = (src, keys) => Object.fromEntries(keys.filter(k => k in src).map(k => [k, src[k]]))

module.exports = { ADMIN_KEYS, pick }
