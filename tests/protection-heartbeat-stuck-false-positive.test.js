/* global describe, it, expect, beforeEach, afterEach */
/**
 * Unit tests for the protection-heartbeat false-positive STUCK fix (2026-06-24-v2).
 * Covers the new pure helpers + the dev-safety guard. No WHM / no real DB.
 */
'use strict'

describe('protection-heartbeat — 2026-06-24-v2 false-positive STUCK fix', () => {
  let heartbeat
  let savedSkipFlag

  beforeEach(() => {
    // Fresh require so module-level env reads pick up our test overrides
    savedSkipFlag = process.env.SKIP_WEBHOOK_SYNC
    delete process.env.SKIP_WEBHOOK_SYNC
    delete require.cache[require.resolve('../js/protection-heartbeat.js')]
    heartbeat = require('../js/protection-heartbeat.js')
  })
  afterEach(() => {
    if (savedSkipFlag === undefined) delete process.env.SKIP_WEBHOOK_SYNC
    else process.env.SKIP_WEBHOOK_SYNC = savedSkipFlag
    delete require.cache[require.resolve('../js/protection-heartbeat.js')]
  })

  describe('RETRY_DELAYS_MS', () => {
    it('is an exponential-backoff array [750, 2000, 5000]', () => {
      expect(heartbeat.RETRY_DELAYS_MS).toEqual([750, 2000, 5000])
    })
  })

  describe('isEmptyReadPair', () => {
    it('returns true when both .content are empty strings', () => {
      expect(heartbeat.isEmptyReadPair({ content: '' }, { content: '' })).toBe(true)
    })
    it('returns true when both are missing content fields', () => {
      expect(heartbeat.isEmptyReadPair({}, {})).toBe(true)
    })
    it('returns false when iniRes has content', () => {
      expect(heartbeat.isEmptyReadPair({ content: 'a' }, { content: '' })).toBe(false)
    })
    it('returns false when phpRes has content', () => {
      expect(heartbeat.isEmptyReadPair({ content: '' }, { content: 'a' })).toBe(false)
    })
    it('handles null / undefined inputs safely', () => {
      expect(heartbeat.isEmptyReadPair(null, null)).toBe(true)
      expect(heartbeat.isEmptyReadPair(undefined, undefined)).toBe(true)
    })
  })

  describe('hasNoExplicitError', () => {
    it('true when both reads have no whmErrors and no fetchError+status combo', () => {
      expect(heartbeat.hasNoExplicitError({ content: '' }, { content: '' })).toBe(true)
    })
    it('false when ini has a whmErrors entry (account gone / suspended)', () => {
      expect(heartbeat.hasNoExplicitError(
        { content: '', whmErrors: ['No such user'] },
        { content: '' }
      )).toBe(false)
    })
    it('false when php has a fetchError with status (hard HTTP failure)', () => {
      expect(heartbeat.hasNoExplicitError(
        { content: '' },
        { content: '', fetchError: 'timeout', status: 504 }
      )).toBe(false)
    })
    it('true when ini has fetchError BUT no status (network-level timeout, treat as transient)', () => {
      expect(heartbeat.hasNoExplicitError(
        { content: '', fetchError: 'timeout of 30000ms exceeded' },
        { content: '' }
      )).toBe(true)
    })
  })

  describe('shouldSkipAsTransient — the critical false-positive guard', () => {
    it('returns TRUE: both files empty, no whmErrors, lastCfIpFixSig present (= WHM read flaky)', () => {
      expect(heartbeat.shouldSkipAsTransient({
        iniContent: '', phpContent: '',
        iniWhmErrors: [], phpWhmErrors: [],
        lastCfIpFixSig: 'abc123def456',
      })).toBe(true)
    })

    it('returns FALSE: never deployed (no lastCfIpFixSig) — must attempt repair', () => {
      expect(heartbeat.shouldSkipAsTransient({
        iniContent: '', phpContent: '',
        iniWhmErrors: [], phpWhmErrors: [],
        lastCfIpFixSig: null,
      })).toBe(false)
    })

    it('returns FALSE: explicit whmError says user gone', () => {
      expect(heartbeat.shouldSkipAsTransient({
        iniContent: '', phpContent: '',
        iniWhmErrors: ['No such user'], phpWhmErrors: [],
        lastCfIpFixSig: 'abc',
      })).toBe(false)
    })

    it('returns FALSE: only one file empty (real partial mutation)', () => {
      expect(heartbeat.shouldSkipAsTransient({
        iniContent: '; some content', phpContent: '',
        iniWhmErrors: [], phpWhmErrors: [],
        lastCfIpFixSig: 'abc',
      })).toBe(false)
    })

    it('returns FALSE: fetchError + HTTP status indicates hard failure (not transient)', () => {
      expect(heartbeat.shouldSkipAsTransient({
        iniContent: '', phpContent: '',
        iniFetchError: 'unauthorized', iniStatus: 401,
        phpFetchError: 'unauthorized', phpStatus: 401,
        lastCfIpFixSig: 'abc',
      })).toBe(false)
    })

    it('returns TRUE: pure network timeout (fetchError but no HTTP status) + sig present', () => {
      // ECONNABORTED / DNS / connect failure → no axios .response.status → caller
      // got no HTTP signal. With a deploy signature on record, this IS transient.
      expect(heartbeat.shouldSkipAsTransient({
        iniContent: '', phpContent: '',
        iniFetchError: 'timeout of 30000ms exceeded', iniStatus: null,
        phpFetchError: 'timeout of 30000ms exceeded', phpStatus: null,
        lastCfIpFixSig: 'abc',
      })).toBe(true)
    })

    it('returns FALSE when input is null/undefined (defensive)', () => {
      expect(heartbeat.shouldSkipAsTransient(null)).toBe(false)
      expect(heartbeat.shouldSkipAsTransient(undefined)).toBe(false)
      expect(heartbeat.shouldSkipAsTransient({})).toBe(false)
    })
  })

  describe('Dev-safety guard via SKIP_WEBHOOK_SYNC', () => {
    it('runHeartbeat returns {skipped:true,reason:"dev_sandbox"} when SKIP_WEBHOOK_SYNC=true', async () => {
      process.env.SKIP_WEBHOOK_SYNC = 'true'
      // whmApi is built at module load from env; without WHM creds the "WHM not configured"
      // early-return fires BEFORE the dev guard. Provide dummy creds so the guard is what's tested.
      const prevHost = process.env.WHM_HOST, prevTok = process.env.WHM_TOKEN
      process.env.WHM_HOST = process.env.WHM_HOST || 'whm.test.invalid'
      process.env.WHM_TOKEN = process.env.WHM_TOKEN || 'test-token'
      // require.cache deletion is a no-op under Jest — isolate to force a fresh module load.
      let hb
      jest.isolateModules(() => { hb = require('../js/protection-heartbeat.js') })
      // Inject a fake db so the !db early-return doesn't fire first
      hb.init({ collection: () => ({ find: () => ({ toArray: async () => [] }) }) })
      const result = await hb.runHeartbeat()
      if (prevHost === undefined) delete process.env.WHM_HOST; else process.env.WHM_HOST = prevHost
      if (prevTok === undefined) delete process.env.WHM_TOKEN; else process.env.WHM_TOKEN = prevTok
      expect(result).toEqual({ skipped: true, reason: 'dev_sandbox' })
    })

    it('startScheduler is a no-op when SKIP_WEBHOOK_SYNC=true (no timer armed)', () => {
      process.env.SKIP_WEBHOOK_SYNC = 'true'
      delete require.cache[require.resolve('../js/protection-heartbeat.js')]
      const hb = require('../js/protection-heartbeat.js')
      // Should not throw, should not arm anything. Calling stop should be a no-op too.
      expect(() => hb.startScheduler()).not.toThrow()
      expect(() => hb.stopScheduler()).not.toThrow()
    })
  })

  describe('Backwards-compat: previously exported helpers still behave the same', () => {
    it('STUCK_RETRY_COOLDOWN_MS defaults to 6 hours (PROTECTION_STUCK_RETRY_COOLDOWN_MIN=360)', () => {
      // Default = 360 minutes = 6h = 21_600_000 ms
      expect(heartbeat.STUCK_RETRY_COOLDOWN_MS).toBe(360 * 60 * 1000)
    })

    it('isStuckCooledDown(null) is false', () => {
      expect(heartbeat.isStuckCooledDown(null)).toBe(false)
    })

    it('isStuckCooledDown returns true for a stuckAt older than cooldown', () => {
      const longAgo = new Date(Date.now() - 7 * 60 * 60 * 1000) // 7h ago
      expect(heartbeat.isStuckCooledDown(longAgo)).toBe(true)
    })

    it('isStuckCooledDown returns false for a stuckAt within cooldown', () => {
      const recent = new Date(Date.now() - 60 * 60 * 1000) // 1h ago
      expect(heartbeat.isStuckCooledDown(recent)).toBe(false)
    })

    it('buildAccountScanFilter includes healthy + cooled-down stuck accounts only', () => {
      const f = heartbeat.buildAccountScanFilter()
      expect(f.deleted).toEqual({ $ne: true })
      expect(Array.isArray(f.$or)).toBe(true)
      expect(f.$or.length).toBe(3)
    })

    it('MAX_CONSECUTIVE_REPAIRS is 3 (unchanged)', () => {
      expect(heartbeat.MAX_CONSECUTIVE_REPAIRS).toBe(3)
    })

    it('alertAdmin never throws even with broken inputs', async () => {
      await expect(heartbeat.alertAdmin('<test>')).resolves.toBeUndefined()
    })
  })
})
