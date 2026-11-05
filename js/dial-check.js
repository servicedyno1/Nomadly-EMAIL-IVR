'use strict'
// Catches mistyped numbers (a missing or extra digit) before a call is placed. null = fine, else a message.
const { parsePhoneNumberFromString } = require('libphonenumber-js/max')
const phoneConfig = require('./phone-config')

const NANP = /^\+1[2-9]\d{2}[2-9]\d{6}$/

function dialIssue(e164) {
  const n = String(e164 || '')
  const d = n.replace(/^\+/, '')
  if (!/^\d{8,15}$/.test(d)) return `${n || 'This'} is not a phone number. Use the country code, e.g. +14155550100.`
  if (phoneConfig.isBlockedPrefix(n)) return null // the caller's blocked-destination check explains these
  if (d.startsWith('1')) {
    if (d.length < 11) return `${n} is missing a digit. USA/Canada numbers are +1 followed by 10 digits.`
    if (d.length > 11) return `${n} has an extra digit. USA/Canada numbers are +1 followed by 10 digits.`
    return NANP.test(n) ? null : `${n} is not a valid USA/Canada number. Check the area code.`
  }
  if (parsePhoneNumberFromString(n)?.isPossible()) return null
  if (d.length === 10 && NANP.test('+1' + d)) return `${n} looks like a USA number missing the 1. Did you mean +1${d}?`
  return `${n} is not a complete number. Check for a missing or extra digit.`
}

module.exports = { dialIssue }
