/**
 * Regression (2026-10-04, @Login4six8 "Call routing session expired"):
 * Nomadly (app-main) and Smadav (app-wl) share ONE Twilio account. Both bots used to
 * hardcode the 'speechcue-' SIP domain and overwrite its Voice URL with their own SELF_URL
 * at boot — the last bot to start won, so Nomadly's SIP→Twilio bridge callbacks were routed
 * to the Smadav process (whose in-memory pendingBridges was empty) and every call died.
 * twilio-service must only touch the domain matching TWILIO_SIP_DOMAIN_PREFIX (default speechcue).
 */
const SPEECHCUE = { sid: 'SD_speechcue', domainName: 'speechcue-7937a0.sip.twilio.com', friendlyName: 'Speechcue Cloud Phone SIP', voiceUrl: 'https://old' }
const SMADAV = { sid: 'SD_smadav', domainName: 'smadav-7937a0.sip.twilio.com', friendlyName: 'Smadav', voiceUrl: 'https://old' }
const LEGACY = { sid: 'SD_nomadly', domainName: 'nomadly-7937a0.sip.twilio.com', friendlyName: 'Nomadly SIP', voiceUrl: 'https://old' }

function loadWithMock({ prefix, domains }) {
  jest.resetModules()
  process.env.TWILIO_ACCOUNT_SID = 'AC00000000000000000000000000937a0'
  process.env.TWILIO_AUTH_TOKEN = 'tok'
  if (prefix === undefined) delete process.env.TWILIO_SIP_DOMAIN_PREFIX
  else process.env.TWILIO_SIP_DOMAIN_PREFIX = prefix

  const calls = { updated: [], created: [], credMapped: [], aclMapped: [] }
  const domainsApi = (sid) => ({
    update: jest.fn(async (p) => { calls.updated.push({ sid, ...p }); return { sid } }),
    auth: {
      registrations: { credentialListMappings: { create: jest.fn(async (p) => { calls.credMapped.push({ sid, ...p }); return {} }) } },
      calls: { ipAccessControlListMappings: { create: jest.fn(async (p) => { calls.aclMapped.push({ sid, ...p }); return {} }) } },
    },
  })
  domainsApi.list = jest.fn(async () => domains)
  domainsApi.create = jest.fn(async (p) => { const d = { sid: 'SD_new', ...p }; calls.created.push(d); return d })

  const client = {
    api: { v2010: { accounts: () => ({ fetch: async () => ({ friendlyName: 'Speechcue', status: 'active' }) }) } },
    sip: {
      domains: domainsApi,
      credentialLists: { list: async () => [{ sid: 'CL1', friendlyName: 'Speechcue SIP Credentials' }], create: async () => ({ sid: 'CLx' }) },
      ipAccessControlLists: { list: async () => [{ sid: 'AL1', friendlyName: 'Telnyx SIP Signaling IPs' }] },
    },
  }
  jest.doMock('twilio', () => Object.assign(() => client, { twiml: {} }))
  const svc = require('../js/twilio-service')
  return { svc, calls }
}

describe('twilio-service: per-brand SIP domain isolation', () => {
  afterEach(() => { jest.dontMock('twilio'); delete process.env.TWILIO_SIP_DOMAIN_PREFIX })

  test('default prefix (Nomadly) updates ONLY speechcue-* and ignores smadav-*', async () => {
    const { svc, calls } = loadWithMock({ prefix: undefined, domains: [SPEECHCUE, SMADAV] })
    const res = await svc.initializeTwilioResources('https://2.speechcue.com')
    expect(res.sipDomainName).toBe(SPEECHCUE.domainName)
    expect(calls.updated).toEqual([{ sid: 'SD_speechcue', voiceUrl: 'https://2.speechcue.com/twilio/sip-voice', voiceMethod: 'POST' }])
    expect(calls.created).toHaveLength(0)
  })

  test('TWILIO_SIP_DOMAIN_PREFIX=smadav (WhiteLabel) updates ONLY smadav-* — never speechcue-*', async () => {
    const { svc, calls } = loadWithMock({ prefix: 'smadav', domains: [SPEECHCUE, SMADAV] })
    const res = await svc.initializeTwilioResources('https://1.smadavspeech.com')
    expect(res.sipDomainName).toBe(SMADAV.domainName)
    expect(calls.updated).toEqual([{ sid: 'SD_smadav', voiceUrl: 'https://1.smadavspeech.com/twilio/sip-voice', voiceMethod: 'POST' }])
    expect(calls.updated.some(u => u.sid === 'SD_speechcue')).toBe(false)
    expect(calls.credMapped.map(m => m.sid)).toEqual(['SD_smadav'])
    expect(calls.aclMapped.map(m => m.sid)).toEqual(['SD_smadav'])
  })

  test('non-default prefix with no own domain creates <prefix>-<sid6> instead of hijacking speechcue-*', async () => {
    const { svc, calls } = loadWithMock({ prefix: 'Acme Brand', domains: [SPEECHCUE, LEGACY] })
    const res = await svc.initializeTwilioResources('https://acme.example')
    expect(calls.updated).toHaveLength(0)
    expect(calls.created).toHaveLength(1)
    expect(calls.created[0].domainName).toBe('acmebrand-0937a0.sip.twilio.com')
    expect(res.sipDomainName).toBe(calls.created[0].domainName)
  })

  test('legacy nomadly-* fallback applies to the default prefix only', async () => {
    const def = loadWithMock({ prefix: undefined, domains: [LEGACY, SMADAV] })
    const defRes = await def.svc.getTwilioResourcesFromEnv()
    expect(defRes.sipDomainName).toBe(LEGACY.domainName)

    const wl = loadWithMock({ prefix: 'smadav', domains: [LEGACY, SPEECHCUE] })
    const wlRes = await wl.svc.getTwilioResourcesFromEnv()
    expect(wlRes).toBeNull()
  })

  test('read-only init (SKIP_WEBHOOK_SYNC) resolves the brand domain without any writes', async () => {
    const { svc, calls } = loadWithMock({ prefix: 'smadav', domains: [SPEECHCUE, SMADAV] })
    const res = await svc.getTwilioResourcesFromEnv()
    expect(res.sipDomainName).toBe(SMADAV.domainName)
    expect(calls.updated).toHaveLength(0)
    expect(calls.created).toHaveLength(0)
  })
})
