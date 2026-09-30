/* global describe, test, expect */
/**
 * store-payment-verify.test.js — proves the storefront crypto-webhook confirms
 * payment with TRUE PARITY to the bot's wallet-deposit path (authDyno):
 * trust the webhook event; skip only definitively-unpaid statuses; the DynoPay
 * status API is advisory-only and can NEVER block a paid order.
 *
 * Regression anchor: order 9fd5da6a (lloyd-support.com, 2026-08-29) — a $69
 * ERC20 payment was CONFIRMED by webhook but DROPPED because the DynoPay status
 * re-verify returned "Application not found" (gateway unreachable).
 */
const {
  classifyStoreWebhook,
  isStoreUnderpaid,
  isPaidStatus,
  isUnpaidStatus,
} = require('../js/store-payment-verify')

describe('classifyStoreWebhook — bot parity (trust webhook, gateway advisory-only)', () => {
  test('REGRESSION lloyd-support.com: confirmed webhook + gateway UNREACHABLE → fulfills (was dropped)', () => {
    const d = classifyStoreWebhook({ event: 'payment.confirmed', gatewayReached: false, gatewayStatus: null })
    expect(d.action).toBe('unverified-fulfill')
  })

  test('confirmed webhook + gateway CONFIRMS paid → fulfill (fully verified)', () => {
    const d = classifyStoreWebhook({ event: 'payment.confirmed', gatewayReached: true, gatewayStatus: 'confirmed' })
    expect(d.action).toBe('fulfill')
  })

  test('settled webhook + gateway unreachable → fulfills', () => {
    expect(classifyStoreWebhook({ event: 'payment.settled', gatewayReached: false }).action).toBe('unverified-fulfill')
  })

  test("original silent-drop status 'received' + gateway unreachable → fulfills", () => {
    expect(classifyStoreWebhook({ event: 'received', gatewayReached: false }).action).toBe('unverified-fulfill')
  })

  test('unusual-but-paid status (settlement_failed) is NOT silently dropped → fulfills', () => {
    // authDyno only skips payment.failed exactly; settlement_failed is processed.
    expect(classifyStoreWebhook({ event: 'payment.settlement_failed', gatewayReached: false }).action).toBe('unverified-fulfill')
  })

  test('gateway CONTRADICTS a paid webhook (says pending) → still fulfills (parity, flagged)', () => {
    const d = classifyStoreWebhook({ event: 'payment.confirmed', gatewayReached: true, gatewayStatus: 'pending' })
    expect(d.action).toBe('unverified-fulfill')
  })

  test.each(['payment.pending', 'pending', 'payment.failed', 'failed', 'payment.underpaid', 'underpaid', 'expired', 'cancelled', 'waiting', 'declined'])(
    'definitively-unpaid event %s → hold (never provision)',
    (event) => {
      expect(classifyStoreWebhook({ event, gatewayReached: false }).action).toBe('hold')
    }
  )

  test('empty/missing event → hold (never provision on nothing)', () => {
    expect(classifyStoreWebhook({ event: '', gatewayReached: false }).action).toBe('hold')
    expect(classifyStoreWebhook({ event: undefined, gatewayReached: false }).action).toBe('hold')
    expect(classifyStoreWebhook({}).action).toBe('hold')
  })

  test('no paid webhook event is ever dropped to hold when gateway is down', () => {
    for (const ev of ['confirmed', 'payment.confirmed', 'settled', 'completed', 'complete', 'paid', 'success', 'received', 'received_unconfirmed']) {
      expect(classifyStoreWebhook({ event: ev, gatewayReached: false }).action).not.toBe('hold')
    }
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
