'use strict'
// Infobip countries sold on CloudIVR (from the 14 Nov 2026 offer scan). instant = pick a number now;
// request = Infobip assigns one after an order (needs: none | company name | name + address). Voice local numbers.
const INSTANT = {
  US: 'United States', CA: 'Canada',
  AR: 'Argentina', CL: 'Chile', ES: 'Spain', FR: 'France', HR: 'Croatia', LT: 'Lithuania', MX: 'Mexico',
  MY: 'Malaysia', PL: 'Poland', PR: 'Puerto Rico', RO: 'Romania', UA: 'Ukraine',
}
// keys = Infobip requirement keys to fill from the customer's profile; clientType LOCAL = offer only for in-country businesses.
const REQUEST = {
  AT: { name: 'Austria', keys: [], sms: true },
  CR: { name: 'Costa Rica', keys: [] },
  DO: { name: 'Dominican Republic', keys: [] },
  EC: { name: 'Ecuador', keys: [] },
  PE: { name: 'Peru', keys: [] },
  PY: { name: 'Paraguay', keys: [] },
  SE: { name: 'Sweden', keys: ['companyName'], sms: true },
  AU: { name: 'Australia', keys: ['companyName', 'companyAddress'], sms: true },
  DK: { name: 'Denmark', keys: ['companyName', 'companyAddress'], sms: true },
  DE: { name: 'Germany', keys: ['companyName', 'companyAddress'], clientType: 'LOCAL' },
  CY: { name: 'Cyprus', keys: ['companyName', 'companyAddress', 'contactPerson'], clientType: 'LOCAL' },
}
const FLAG = (cc) => String.fromCodePoint(...[...cc].map(c => 0x1f1e6 + c.charCodeAt(0) - 65))
const isInstant = (cc) => !!INSTANT[cc]
const requestOf = (cc) => REQUEST[cc] || null

module.exports = { INSTANT, REQUEST, FLAG, isInstant, requestOf }
