'use strict'
// Infobip countries sold on CloudIVR (from the 14 Nov 2026 offer scan). instant = pick a number now;
// request = Infobip assigns one after an order (needs: none | company name | name + address). Voice local numbers.
const INSTANT = {
  US: 'United States', CA: 'Canada',
  AR: 'Argentina', CL: 'Chile', ES: 'Spain', FR: 'France', HR: 'Croatia', LT: 'Lithuania', MX: 'Mexico',
  MY: 'Malaysia', PL: 'Poland', PR: 'Puerto Rico', RO: 'Romania', UA: 'Ukraine', AT: 'Austria',
}
// keys = Infobip requirement keys to fill from the customer's profile; clientType LOCAL = offer only for in-country businesses.
// dial = calling code used for the "assigned after your order" placeholder (checked with requirements-lookup, 23 Nov 2026).
const REQUEST = {
  CR: { name: 'Costa Rica', keys: [], dial: '506' },
  DO: { name: 'Dominican Republic', keys: [], dial: '1809' },
  EC: { name: 'Ecuador', keys: [], dial: '593' },
  PE: { name: 'Peru', keys: [], dial: '51' },
  PY: { name: 'Paraguay', keys: [], dial: '595' },
  SE: { name: 'Sweden', keys: ['companyName'], sms: true, dial: '46' },
  AU: { name: 'Australia', keys: ['companyName', 'companyAddress'], sms: true, dial: '61' },
  DK: { name: 'Denmark', keys: ['companyName', 'companyAddress'], sms: true, dial: '45' },
  DE: { name: 'Germany', keys: ['companyName', 'companyAddress'], clientType: 'LOCAL', dial: '49' },
}
const FLAG = (cc) => String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
const isInstant = (cc) => !!INSTANT[cc]
const requestOf = (cc) => REQUEST[cc] || null

module.exports = { INSTANT, REQUEST, FLAG, isInstant, requestOf }
