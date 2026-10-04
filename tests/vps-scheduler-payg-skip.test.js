/* global describe, test, expect */
/**
 * Source-level regression test: the VPS renewal scheduler in _index.js
 * MUST skip destructive `deleteVPSinstance` calls at T-24h / T-5h for
 * PAYG providers (DigitalOcean / Vultr / Azure), letting Phase 2 (at
 * end_time) handle the destroy instead.
 *
 * Why this test exists:
 *   - Contabo bills monthly contracts in advance, so its `cancelInstance`
 *     is non-destructive (schedules cancel at end_time). The scheduler's
 *     Phase 1 (T-24h) and Phase 1.5 (T-5h) cancel-on-Contabo calls are
 *     therefore mandatory to avoid €30+ leak charges.
 *   - DO / Vultr / Azure are PAYG and `cancelInstance` DESTROYS the VM
 *     immediately. Running Phase 1/1.5 on them would lose 24 hours of
 *     customer-paid uptime. Phase 2 (at end_time) handles the actual
 *     destroy without that loss.
 *
 * A previous version of the scheduler called `deleteVPSinstance`
 * unconditionally for every provider at T-24h. This guard fixes that.
 */
'use strict'

const fs = require('fs')
const path = require('path')

const SRC = fs.readFileSync(path.join(__dirname, '..', 'js', '_index.js'), 'utf-8')

// Extract the real _isPAYGProvider closure from _index.js and evaluate it against the REAL
// vps-provider prefix detector, so the guard is exercised as behaviour (not a frozen text match).
function loadIsPAYGProvider() {
  const m = SRC.match(/function _isPAYGProvider\(vpsPlan\) \{[\s\S]*?\n {2}\}/)
  if (!m) throw new Error('_isPAYGProvider not found in _index.js')
  const { detectProviderByInstanceId } = require('../js/vps-provider')
  // eslint-disable-next-line no-new-func
  return new Function('_detectByPrefix', `${m[0]}; return _isPAYGProvider`)(detectProviderByInstanceId)
}

describe('VPS scheduler — _isPAYGProvider guard skips early destroy for PAYG providers', () => {
  test('Helper _isPAYGProvider is defined at the top of checkVPSPlansExpiryandPayment', () => {
    expect(SRC).toMatch(/function _isPAYGProvider\(vpsPlan\)/)
  })

  test('_isPAYGProvider: every destructive-cancel (PAYG) provider is PAYG, Contabo/OVH are not', () => {
    const isPAYG = loadIsPAYGProvider()
    // by instanceId prefix
    expect(isPAYG({ contaboInstanceId: 'do-487393245' })).toBe(true)
    expect(isPAYG({ contaboInstanceId: 'cb676a83-3b48-4b6a-9f88-d62e1c9aac1f' })).toBe(true) // vultr UUID
    expect(isPAYG({ contaboInstanceId: 'az-nmd1a2b3c4' })).toBe(true)
    expect(isPAYG({ contaboInstanceId: '203228089' })).toBe(false) // contabo numeric
    expect(isPAYG({ contaboInstanceId: 'vps-12abc34.vps.ovh.net' })).toBe(false)
    // by provider field (records with no recognisable prefix)
    for (const p of ['vultr', 'digitalocean', 'digitalocean-rdp', 'azure']) {
      expect(isPAYG({ provider: p })).toBe(true)
    }
    expect(isPAYG({ provider: 'contabo' })).toBe(false)
    expect(isPAYG({})).toBe(false)
  })

  test('_isPAYGProvider agrees with vps-provider.isDestructiveCancelProvider (single source of truth)', () => {
    const isPAYG = loadIsPAYGProvider()
    const { isDestructiveCancelProvider } = require('../js/vps-provider')
    for (const p of ['vultr', 'digitalocean', 'digitalocean-rdp', 'azure', 'contabo', 'ovh']) {
      expect(isPAYG({ provider: p })).toBe(isDestructiveCancelProvider(p))
    }
  })

  test('Phase 1 — auto-renew OFF branch skips deleteVPSinstance for PAYG providers', () => {
    // The destructive call at T-24h must be gated by _isPAYGProvider
    expect(SRC).toMatch(/!vpsPlan\._contaboCancelledEarly && !_isPAYGProvider\(vpsPlan\)\) \{[\s\S]{0,2000}?cancelReason: 'auto_renew_disabled'/)
  })

  test('Phase 1 — wallet-deduct-failed branch skips deleteVPSinstance for PAYG providers', () => {
    expect(SRC).toMatch(/!vpsPlan\._contaboCancelledEarly && !_isPAYGProvider\(vpsPlan\)\) \{[\s\S]{0,2000}?cancelReason: 'wallet_deduct_failed'/)
  })

  test('Phase 1.5 — T-5h pre-emptive cancel skips PAYG providers with continue', () => {
    expect(SRC).toMatch(/for \(const vpsPlan of urgentCancellations\) \{\s*if \(_isPAYGProvider\(vpsPlan\)\) continue/)
  })

  test('Phase 2 still has the at-end_time destroy logic (do NOT remove this)', () => {
    // Sanity check: Phase 2's deleteVPSinstance must still fire at end_time
    expect(SRC).toMatch(/Phase 2: DELETE on Contabo[\s\S]{0,1000}'end_time': \{ \$lte: now \}[\s\S]{0,3000}?deleteVPSinstance\(chatId, vpsId\)/)
  })

  test('Helper imports detectProviderByInstanceId from vps-provider (real wiring)', () => {
    expect(SRC).toMatch(/const \{[^}]*detectProviderByInstanceId: _detectByPrefix[^}]*\} = require\('\.\/vps-provider'\)/)
  })
})
