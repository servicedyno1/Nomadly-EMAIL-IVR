'use strict'
// Prepaid hosting terms (reseller API only): a MONTHLY plan can be bought / renewed for 1, 3, 6 or 12
// months at a discount. The account keeps renewalPriceUsd = the monthly price and termMonths = the
// cycle; auto-renew repeats the same term at the same discount. Weekly plans are always 1 week.
const TERM_MONTHS = [1, 3, 6, 12]
const TERM_DISCOUNTS = { 1: 0, 3: 0.10, 6: 0.15, 12: 0.25 }
const MONTH_DAYS = 30
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

const isTerm = (m) => TERM_MONTHS.includes(Number(m))
const discountOf = (months) => TERM_DISCOUNTS[months] || 0
const discountPct = (months) => Math.round(discountOf(months) * 100)
const termPrice = (monthlyUsd, months) => round2(Number(monthlyUsd) * months * (1 - discountOf(months)))

// The term an account renews on. Only monthly-cycle plans (30 days) can hold a longer term.
function termMonthsOf(acct, cycleDays) {
  const m = Number(acct && acct.termMonths)
  return Number(cycleDays) === MONTH_DAYS && isTerm(m) ? m : 1
}

function termQuote(monthlyUsd, months) {
  const price = termPrice(monthlyUsd, months)
  return {
    months, duration_days: MONTH_DAYS * months, discount_pct: discountPct(months), price_usd: price,
    monthly_equivalent_usd: round2(price / months), savings_usd: round2(Number(monthlyUsd) * months - price),
  }
}

// Validates an optional `months` request field → { months } (null when omitted) or { error, message }.
function parseMonths(raw, cycleDays) {
  if (raw === undefined || raw === null || raw === '') return { months: null }
  const m = Number(raw)
  if (!isTerm(m)) return { error: 'invalid_months', message: 'months must be one of 1, 3, 6 or 12.' }
  if (Number(cycleDays) !== MONTH_DAYS && m !== 1) return { error: 'term_not_available', message: 'Prepaid 3/6/12-month terms are available on monthly plans only. The weekly plan is 1 week at a time.' }
  return { months: m }
}

module.exports = { TERM_MONTHS, TERM_DISCOUNTS, MONTH_DAYS, isTerm, discountOf, discountPct, termPrice, termMonthsOf, termQuote, parseMonths, round2 }
