'use strict'
// Per-contact personalization for campaigns and Quick IVR: fills [Name], [Code], [Amount] and any custom column
// (e.g. [Policy]) from one contact's own fields. For spoken calls, codes are read digit by digit and amounts as money.
// A missing value is replaced with the owner's fallback word; with no fallback the contact is skipped (and listed).

// [Token] names that aren't custom columns but map to the contact's phone/name.
const BUILT_IN = { name: 'name', phone: 'number', number: 'number' }
const CODE_RE = /\b(code|pin|otp|password|passcode|ref|reference|verification|confirmation|voucher|coupon|ticket|order)\b/i
const AMOUNT_RE = /\b(amount|amt|balance|total|due|price|cost|fee|payment|owed|charge|sum)\b/i

const tokenRe = /\[([^\]\n]+)\]/g

// Every [Token] in the text (case preserved on first sight, de-duplicated case-insensitively).
function tokensIn(text) {
  const out = [], seen = new Set()
  for (const m of String(text || '').matchAll(tokenRe)) {
    const name = m[1].trim()
    if (!/^[A-Za-z][A-Za-z0-9_ ]*$/.test(name)) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key); out.push(name)
  }
  return out
}

// Contact → case-insensitive lookup of its values, keyed by token name.
function valuesOf(lead) {
  const map = {}
  if (lead?.name) map.name = String(lead.name)
  if (lead?.number) { map.number = String(lead.number); map.phone = String(lead.number) }
  for (const f of lead?.fields || []) { const k = String(f.label || '').toLowerCase().trim(); if (k && f.value != null && String(f.value) !== '') map[k] = String(f.value) }
  // Convenience aliases the owner is likely to type.
  for (const [alias, re] of [['code', CODE_RE], ['amount', AMOUNT_RE]]) {
    if (map[alias] === undefined) { const hit = Object.keys(map).find(k => re.test(k)); if (hit) map[alias] = map[hit] }
  }
  return map
}

const digits = (v) => String(v).replace(/\D/g, '')
// "4821" → "4, 8, 2, 1" so a voice reads it digit by digit (commas make the TTS pause between digits).
const sayDigits = (v) => (digits(v) ? digits(v).split('').join(', ') : String(v))
// "45.5" / "$45.50" → "45 dollars and 50 cents"; whole amounts drop the cents.
function sayMoney(v) {
  const s = String(v).trim()
  const cur = /€|eur/i.test(s) ? ['euros', 'cents'] : /£|gbp/i.test(s) ? ['pounds', 'pence'] : ['dollars', 'cents']
  const n = Number(s.replace(/[^0-9.]/g, ''))
  if (!isFinite(n)) return s
  const whole = Math.floor(n), cents = Math.round((n - whole) * 100)
  const w = `${whole} ${whole === 1 ? cur[0].replace(/s$/, '') : cur[0]}`
  return cents ? `${w} and ${cents} ${cents === 1 ? cur[1].replace(/s$/, '') : cur[1]}` : w
}

// Decide how a token's value should be spoken/written.
function render(name, value, speak) {
  if (!speak) return value
  const low = name.toLowerCase()
  if (CODE_RE.test(low) || low === 'code') return sayDigits(value)
  if (AMOUNT_RE.test(low) || low === 'amount') return sayMoney(value)
  return value
}

// Fill one contact's text. Returns { text, missing: [tokens], skip }.
// opts: { speak } read codes/amounts aloud; { fallback } word used for a missing value; no fallback → skip.
function fillPersonal(template, lead, { speak = false, fallback = '' } = {}) {
  const map = valuesOf(lead)
  const fb = String(fallback || '').trim()
  const missing = []
  const text = String(template || '').replace(tokenRe, (match, raw) => {
    const name = raw.trim()
    if (!/^[A-Za-z][A-Za-z0-9_ ]*$/.test(name)) return match
    const key = (BUILT_IN[name.toLowerCase()] || name).toLowerCase()
    const val = map[key] !== undefined ? map[key] : map[name.toLowerCase()]
    if (val !== undefined && String(val) !== '') return render(name, val, speak)
    missing.push(name)
    return fb
  })
  return { text, missing: [...new Set(missing)], skip: missing.length > 0 && !fb }
}

module.exports = { tokensIn, fillPersonal, valuesOf, sayDigits, sayMoney, CODE_RE, AMOUNT_RE }
