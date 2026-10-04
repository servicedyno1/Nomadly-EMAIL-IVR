/* global describe, test, expect */
/**
 * store-payment-verify.test.js — the storefront crypto-webhook decision matrix.
 *
 * Regression anchor: order 9fd5da6a (lloyd-support.com, 2026-08-29) — a $69
 * ERC20 payment was CONFIRMED by webhook but DROPPED because the DynoPay status
 * re-verify returned "Application not found" (gateway unreachable). A paid order
 * must never be silently dropped.
 *
 * Security anchor (2026-06, forged-webhook exploit): the webhook body is UNTRUSTED.
 * We fulfill only when an AUTHORITATIVE source confirms payment — the gateway
 * status, or a VALID DynoPay HMAC signature on the webhook. An unsigned webhook
 * can never fulfill on its own, and a gateway that CONTRADICTS a "paid" webhook
 * always wins (hold).
 */
const {
  classifyStoreWebhook,
  isStoreUnderpaid,
  isPaidStatus,
  isUnpaidStatus,
} = require('../js/store-payment-verify')

const SIGNED = { signatureValid: true }

describe('classifyStoreWebhook — authoritative sources: gateway status OR valid signature', () => {
  test('REGRESSION lloyd-support.com: SIGNED confirmed webhook + gateway UNREACHABLE → fulfills (was dropped)', () => {
    const d = classifyStoreWebhook({ event: 'payment.confirmed', gatewayReached: false, gatewayStatus: null, ...SIGNED })
    expect(d.action).toBe('unverified-fulfill')
    expect(d.reason).toMatch(/gateway-unreachable,signed/)
  })

  test('confirmed webhook + gateway CONFIRMS paid → fulfill (fully verified, signature not even needed)', () => {
    const d = classifyStoreWebhook({ event: 'payment.confirmed', gatewayReached: true, gatewayStatus: 'confirmed' })
    expect(d.action).toBe('fulfill')
  })

  test('SIGNED settled webhook + gateway unreachable → fulfills', () => {
    expect(classifyStoreWebhook({ event: 'payment.settled', gatewayReached: false, ...SIGNED }).action).toBe('unverified-fulfill')
  })

  test("SIGNED original silent-drop status 'received' + gateway unreachable → fulfills", () => {
    expect(classifyStoreWebhook({ event: 'received', gatewayReached: false, ...SIGNED }).action).toBe('unverified-fulfill')
  })

  test('SIGNED unusual-but-paid status (settlement_failed) is NOT silently dropped → fulfills', () => {
    // authDyno only skips payment.failed exactly; settlement_failed is processed.
    expect(classifyStoreWebhook({ event: 'payment.settlement_failed', gatewayReached: false, ...SIGNED }).action).toBe('unverified-fulfill')
  })

  test('SIGNED paid webhook + gateway reachable with an unknown/transitional status → fulfill', () => {
    const d = classifyStoreWebhook({ event: 'payment.confirmed', gatewayReached: true, gatewayStatus: 'processing', ...SIGNED })
    expect(d.action).toBe('fulfill')
    expect(d.reason).toMatch(/gateway-unknown.*signed/)
  })

  test.each(['payment.pending', 'pending', 'payment.failed', 'failed', 'payment.underpaid', 'underpaid', 'expired', 'cancelled', 'waiting', 'declined'])(
    'definitively-unpaid event %s → hold even when signed (never provision)',
    (event) => {
      expect(classifyStoreWebhook({ event, gatewayReached: false, ...SIGNED }).action).toBe('hold')
    }
  )

  test('empty/missing event → hold (never provision on nothing)', () => {
    expect(classifyStoreWebhook({ event: '', gatewayReached: false, ...SIGNED }).action).toBe('hold')
    expect(classifyStoreWebhook({ event: undefined, gatewayReached: false, ...SIGNED }).action).toBe('hold')
    expect(classifyStoreWebhook({}).action).toBe('hold')
  })

  test('no SIGNED paid webhook event is ever dropped to hold when gateway is down', () => {
    for (const ev of ['confirmed', 'payment.confirmed', 'settled', 'completed', 'complete', 'paid', 'success', 'received', 'received_unconfirmed']) {
      expect(classifyStoreWebhook({ event: ev, gatewayReached: false, ...SIGNED }).action).not.toBe('hold')
    }
  })
})

describe('classifyStoreWebhook — forged-webhook exploit is closed', () => {
  test('UNSIGNED paid webhook + gateway UNREACHABLE → hold (the forgery window)', () => {
    for (const ev of ['confirmed', 'payment.confirmed', 'settled', 'completed', 'paid', 'received']) {
      const d = classifyStoreWebhook({ event: ev, gatewayReached: false })
      expect(d.action).toBe('hold')
      expect(d.reason).toMatch(/gateway-unreachable.*unsigned/)
    }
    // explicit false behaves like absent
    expect(classifyStoreWebhook({ event: 'payment.confirmed', gatewayReached: false, signatureValid: false }).action).toBe('hold')
  })

  test('UNSIGNED paid webhook + gateway reachable but unknown status → hold', () => {
    const d = classifyStoreWebhook({ event: 'payment.confirmed', gatewayReached: true, gatewayStatus: 'processing' })
    expect(d.action).toBe('hold')
    expect(d.reason).toMatch(/gateway-unknown.*unsigned/)
  })

  test('gateway CONTRADICTS a "paid" webhook (says pending/waiting) → hold, EVEN IF signed', () => {
    for (const gw of ['pending', 'waiting', 'payment.pending', 'failed', 'underpaid']) {
      expect(classifyStoreWebhook({ event: 'payment.confirmed', gatewayReached: true, gatewayStatus: gw }).action).toBe('hold')
      const signed = classifyStoreWebhook({ event: 'payment.confirmed', gatewayReached: true, gatewayStatus: gw, ...SIGNED })
      expect(signed.action).toBe('hold')
      expect(signed.reason).toMatch(/gateway-contradicts/)
    }
  })

  test('a forged "completed / base_amount:9999" body with the gateway saying waiting → hold', () => {
    const d = classifyStoreWebhook({ event: 'completed', gatewayReached: true, gatewayStatus: 'waiting' })
    expect(d.action).toBe('hold')
  })
})

describe('isStoreUnderpaid — network-fee tolerance (money-safety gate stays intact)', () => {
  test('fee-shaved payment within tolerance provisions ($67.31 of $69)', () => {
    expect(isStoreUnderpaid(67.31, 69)).toBe(false)
  })
  test('exact payment provisions ($69 of $69)', () => {
    expect(isStoreUnderpaid(69, 69)).toBe(false)
  })
  test('overpayment provisions ($75 of $69)', () => {
    expect(isStoreUnderpaid(75, 69)).toBe(false)
  })
  test('materially underpaid does NOT provision ($10 of $69)', () => {
    expect(isStoreUnderpaid(10, 69)).toBe(true)
  })
  test('zero / invalid amount does NOT provision', () => {
    expect(isStoreUnderpaid(0, 69)).toBe(true)
    expect(isStoreUnderpaid(NaN, 69)).toBe(true)
  })
})

describe('status helpers reflect real DynoPay events observed in production forensics', () => {
  test('confirmed + settled are paid; pending/underpaid/failed are unpaid', () => {
    expect(isPaidStatus('payment.confirmed')).toBe(true)
    expect(isPaidStatus('payment.settled')).toBe(true)
    expect(isUnpaidStatus('payment.pending')).toBe(true)
    expect(isUnpaidStatus('payment.underpaid')).toBe(true)
    expect(isUnpaidStatus('payment.failed')).toBe(true)
  })
})
