'use strict'
// Prepaid Linux VPS terms (reseller API + bot): a VPS is a single monthly product that can be
// bought / renewed for 1, 3, 6 or 12 months. The record keeps planPrice = the MONTHLY price and
// durationMonths = the chosen term; the multi-month term carries a bundle discount so longer
// prepay is cheaper per month (parity with hosting's 1/3/6/12-month terms).
const TERM_MONTHS = [1, 3, 6, 12]
const TERM_DISCOUNTS = { 1: 0, 3: 0.10, 6: 0.15, 12: 0.25 }
const MONTH_DAYS = 30

const round2 = (n) => Math.round(Number(n) * 100) / 100
const isTerm = (m) => TERM_MONTHS.includes(Number(m))
const discountOf = (months) => TERM_DISCOUNTS[Number(months)] || 0
const discountPct = (months) => Math.round(discountOf(months) * 100)
const termPrice = (monthlyUsd, months) => round2(Number(monthlyUsd) * Number(months) * (1 - discountOf(months)))

function termQuote(monthlyUsd, months) {
  const m = Number(months)
  const price = termPrice(monthlyUsd, m)
  return {
    months: m, duration_days: MONTH_DAYS * m, discount_pct: discountPct(m), price_usd: price,
    monthly_equivalent_usd: round2(price / m), savings_usd: round2(Number(monthlyUsd) * m - price),
  }
}

// All term quotes for a monthly price — powers GET /vps/plans → terms[].
function termsFor(monthlyUsd) { return TERM_MONTHS.map(m => termQuote(monthlyUsd, m)) }

// Validates an optional `months` request field → { months } (1 when omitted) or { error, message }.
function parseMonths(raw) {
  if (raw === undefined || raw === null || raw === '') return { months: 1 }
  const m = Number(raw)
  if (!Number.isInteger(m) || !isTerm(m)) return { error: 'invalid_months', message: 'months must be one of 1, 3, 6 or 12.' }
  return { months: m }
}

module.exports = { TERM_MONTHS, TERM_DISCOUNTS, MONTH_DAYS, isTerm, discountOf, discountPct, termPrice, termQuote, termsFor, parseMonths, round2 }
