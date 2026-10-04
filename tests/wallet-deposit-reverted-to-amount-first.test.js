/* global describe, test, expect */
/**
 * Regression test — Wallet deposit flow REVERTED to pre-2026-06-18 behaviour.
 *
 * Background:
 *   On 2026-06-18 the deposit flow was shortened: user tapped Deposit → went
 *   straight to a coin picker → received an open-ended address (no amount
 *   entered). Per-coin floors were enforced at webhook time, sub-floor
 *   deposits forfeited to a `dustDeposits` collection.
 *
 *   On 2026-06-24 (this test) the operator reverted that change. The user
 *   now types a USD amount (min $10) BEFORE picking coin, the address is
 *   amount-embedded (fixed-amount invoice), and the dust-forfeit machinery
 *   is gone. The Versace438 overpayment fix is preserved.
 *
 * What this locks in:
 *   1. `[a.selectCurrencyToDeposit]` shows the amount prompt (no shortcut
 *      to crypto picker when HIDE_BANK_PAYMENT=true).
 *   2. `showDepositCryptoInfo` uses `info.depositAmountUsd` as the actual
 *      invoice (not a placeholder floor).
 *   3. `selectCryptoToDeposit` action routes USDT-TRC20 picks with amount
 *      < $20 to `confirmTrc20MinDeposit` (the legacy correction screen).
 *   4. Webhook handler:
 *        - NO `openEnded` branch (would credit raw convertedValue)
 *        - NO dust-forfeit / `dustDeposits` insertion path
 *        - keeps the overpayment fix (credit actual when MORE than invoiced) — now via
 *          crypto-credit.js computeDepositCreditUsd(), which also closed the
 *          symmetric major-underpayment over-credit (2026-07-19)
 *
 * Strategy: source-level assertions on the live _index.js so any future
 * revival of the open-ended UX is caught by the suite.
 */

const fs = require('fs')
const path = require('path')

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', '_index.js'), 'utf-8')

describe('Wallet deposit reverted to amount-first flow (post-2026-06-24)', () => {

  describe('Frontend — amount-first UX restored', () => {
    test('selectCurrencyToDeposit does NOT shortcut to crypto picker on HIDE_BANK_PAYMENT', () => {
      // The 2026-06-18 PR added:
      //   if (process.env.HIDE_BANK_PAYMENT === 'true') {
      //     return goto[a.selectCryptoToDeposit]()
      //   }
      // The revert removes it — that line MUST NOT be reachable from the
      // selectCurrencyToDeposit goto.
      const m = SRC.match(/\[a\.selectCurrencyToDeposit\]:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\},/m)
      expect(m).not.toBeNull()
      const block = m[0]
      expect(block).not.toMatch(/HIDE_BANK_PAYMENT[\s\S]*?goto\[a\.selectCryptoToDeposit\]/)
      // Positive: always sets the action + shows the amount prompt
      expect(block).toMatch(/set\(state,\s*chatId,\s*'action',\s*a\.selectCurrencyToDeposit\)/)
      expect(block).toMatch(/t\.selectCurrencyToDeposit/)
    })

    test('selectCurrencyToDeposit action requires amount ≥ $10 before continuing', () => {
      // The handler at action === a.selectCurrencyToDeposit must validate
      // amount ≥ 10 then route to depositMethodSelect.
      expect(SRC).toMatch(/if\s*\(\s*action\s*===\s*a\.selectCurrencyToDeposit\s*\)\s*\{[\s\S]*?amount\s*<\s*10[\s\S]*?goto\[a\.depositMethodSelect\]/)
    })

    test('selectCryptoToDeposit action re-arms TRC20 < $20 intercept', () => {
      // The 2026-06-18 PR removed the TRC20_MIN_DEPOSIT_USD intercept from
      // this handler and routed straight to showDepositCryptoInfo. The
      // revert re-adds it.
      const m = SRC.match(/if\s*\(\s*action\s*===\s*a\.selectCryptoToDeposit\s*\)\s*\{[\s\S]*?return\s+goto\.showDepositCryptoInfo\(\)\s*\}/m)
      expect(m).not.toBeNull()
      const block = m[0]
      expect(block).toMatch(/USDT\s*\(TRC20\)/)
      expect(block).toMatch(/TRC20_MIN_DEPOSIT_USD/)
      expect(block).toMatch(/confirmTrc20MinDeposit/)
    })

    test('showDepositCryptoInfo uses info.depositAmountUsd (not minUsd placeholder)', () => {
      // Find the showDepositCryptoInfo goto definition. The reverted version
      // computes `priceUsd = info.depositAmountUsd` and passes it as the
      // invoice. It must NOT compute `invoicePlaceholderUsd = minUsd` any
      // more.
      const m = SRC.match(/showDepositCryptoInfo:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\n\s{4}\},/m)
      expect(m).not.toBeNull()
      const block = m[0]
      expect(block).toMatch(/info\?\.depositAmountUsd/)
      expect(block).not.toMatch(/invoicePlaceholderUsd/)
      expect(block).not.toMatch(/showDepositCryptoInfoOpenEnded/)
      // It uses the legacy text variant
      expect(block).toMatch(/t\.showDepositCryptoInfo\s*\(/)
    })

    test('showDepositCryptoInfo no longer sets openEnded: true in the payment session', () => {
      // chatIdOfDynopayPayment sessions saved by the wallet flow must NOT
      // carry `openEnded: true` (that flag activated the webhook's
      // open-ended credit branch which is now also gone).
      const m = SRC.match(/showDepositCryptoInfo:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\n\s{4}\},/m)
      expect(m).not.toBeNull()
      expect(m[0]).not.toMatch(/openEnded:\s*true/)
    })

    test('No more sendQr(..., qrCaption) address-only QR in wallet deposit flow', () => {
      // The amount-first flow uses sendQrCode / generateQr (the amount-
      // embedded QR from the payment provider), NOT the address-only sendQr.
      const m = SRC.match(/showDepositCryptoInfo:\s*async\s*\(\)\s*=>\s*\{[\s\S]*?\n\s{4}\},/m)
      expect(m).not.toBeNull()
      const block = m[0]
      // Block does NOT use sendQr(bot, chatId, address, caption) — the
      // address-only renderer used during the open-ended phase
      expect(block).not.toMatch(/sendQr\(bot,\s*chatId,\s*[a-zA-Z_$.[\]]+\.address/)
      // Block DOES use the amount-embedded QR helpers
      const usesSendQrCode = /sendQrCode\(/.test(block)
      const usesGenerateQr = /generateQr\(/.test(block)
      expect(usesSendQrCode || usesGenerateQr).toBe(true)
    })
  })

  describe('Webhook handler — open-ended / dust-forfeit paths removed; overpayment fix kept', () => {
    test('NO `req.pay?.openEnded` branch in /dynopay/crypto-wallet handler', () => {
      // The open-ended branch credited raw convertedValue. It must be gone.
      expect(SRC).not.toMatch(/if\s*\(\s*req\.pay\?\.openEnded\s*\)/)
    })

    test('NO `dustDeposits` collection insertion path', () => {
      // The dust-forfeit branch wrote to db.collection('dustDeposits'). Gone.
      expect(SRC).not.toMatch(/db\.collection\(\s*['"]dustDeposits['"]\s*\)\.insertOne/)
      expect(SRC).not.toMatch(/db\.collection\(\s*['"]dustDeposits['"]\s*\)\.updateOne/)
    })

    test('NO "FORFEIT (below min)" log line', () => {
      expect(SRC).not.toMatch(/FORFEIT\s*\(below min\)/)
    })

    test('NO walletDepositMinFor() call in the wallet credit flow', () => {
      // The per-coin floor was applied at webhook receipt time only by the
      // 2026-06-18 PR. We removed it. The function itself still exists
      // in config.js as a defensive import — but it must not be CALLED in
      // the live wallet flow.
      // walletDepositMinFor is imported (line 500) — we tolerate that.
      // What we forbid is an active call within the wallet handlers.
      const callsMin = SRC.match(/walletDepositMinFor\(/g) || []
      // The import-destructure pattern `walletDepositMinFor,` from the
      // require statement isn't a call. Only active calls count.
      expect(callsMin.length).toBe(0)
    })

    test('OVERPAYMENT fix preserved — credit decision goes through computeDepositCreditUsd (crypto-credit.js)', () => {
      // History: the Versace438 fix was `usdIn = Math.max(invoice, convertedValue)`. On
      // 2026-07-19 that line was REPLACED by computeDepositCreditUsd() because max() also
      // credited the FULL invoice on massive underpayments (@Spirits_Of_The_Ancesters sent
      // $5.85 of TRX against a $100 invoice → credited $100). The helper keeps the
      // overpayment behaviour and closes the underpayment hole — assert BOTH.
      expect(SRC).not.toMatch(/usdIn\s*=\s*Math\.max\(\s*invoice,\s*convertedValue\s*\)/)
      expect(SRC).toMatch(/const _decided = computeDepositCreditUsd\(\{[\s\S]{0,200}?invoiceUsd:[\s\S]{0,200}?convertedValue,[\s\S]{0,100}?feePayer,/)
      // And the log line that audits overpayments
      expect(SRC).toMatch(/\[Wallet\] OVERPAYMENT/)

      const { computeDepositCreditUsd } = require('../js/crypto-credit')
      // Versace438: sent MORE than invoiced → credit the actual market value
      expect(computeDepositCreditUsd({ invoiceUsd: 100, convertedValue: 112.4, feePayer: 'company' }))
        .toMatchObject({ creditUsd: 112.4, mode: 'overpayment' })
      // fee-shave within tolerance → goodwill: credit the invoice
      expect(computeDepositCreditUsd({ invoiceUsd: 100, convertedValue: 96, feePayer: 'company' }))
        .toMatchObject({ creditUsd: 100, mode: 'minor-underpayment' })
      // Spirits_Of_The_Ancesters: $5.85 against $100 → credit ONLY what arrived (the 07-19 fix)
      expect(computeDepositCreditUsd({ invoiceUsd: 100, convertedValue: 5.85, feePayer: 'company' }))
        .toMatchObject({ creditUsd: 5.85, mode: 'major-underpayment' })
      // ciroovblzz: conversion API returned garbage → safe fallback to the invoice, never NaN
      expect(computeDepositCreditUsd({ invoiceUsd: 50, convertedValue: null, feePayer: 'company' }))
        .toMatchObject({ creditUsd: 50, mode: 'invoice-fallback-noconvert' })
    })
  })
})
