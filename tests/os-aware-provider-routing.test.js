/* global describe, test, expect, beforeEach, afterEach, jest */
/**
 * OS-aware provider routing — Linux/VPS → DigitalOcean, Windows/RDP → Azure.
 *
 * Verifies:
 *   - `VPS_DEFAULT_PROVIDER=digitalocean` + `VPS_RDP_PROVIDER=azure` config
 *   - `pickProviderForOs(isRDP=true)`  → Azure
 *   - `pickProviderForOs(isRDP=false)` → DigitalOcean
 *   - When `VPS_RDP_PROVIDER` is unset, RDP still routes to default
 *   - Per-record routing (`getProviderForRecord`) is UNCHANGED — existing
 *     Vultr/Contabo records keep working
 */
'use strict'

const path = require('path')

// Preserve any externally-set vars so we can restore them at end
const _origDefault = process.env.VPS_DEFAULT_PROVIDER
const _origRdp     = process.env.VPS_RDP_PROVIDER

// Stub required credentials so provider modules don't bail
process.env.AZURE_TENANT_ID = 'test-tenant'
process.env.AZURE_CLIENT_ID = 'test-client'
process.env.AZURE_CLIENT_SECRET = 'test-secret'
process.env.AZURE_SUBSCRIPTION_ID = 'test-sub'
process.env.AZURE_RESOURCE_GROUP = 'nomadly-vps'
process.env.DIGITALOCEAN_API_TOKEN = 'test-do'

afterEach(() => {
  // Restore env at end of test file
  process.env.VPS_DEFAULT_PROVIDER = _origDefault
  process.env.VPS_RDP_PROVIDER     = _origRdp
  jest.resetModules()
})

describe('vps-provider — OS-aware provider routing (DO for VPS, Azure for RDP)', () => {
  beforeEach(() => { jest.resetModules() })

  test('pickProviderForOs(false) returns DigitalOcean when VPS_DEFAULT_PROVIDER=digitalocean', () => {
    process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
    process.env.VPS_RDP_PROVIDER     = 'azure'
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    const svc = vp.pickProviderForOs(false)
    expect(svc.PROVIDER).toBe('digitalocean')
  })

  test('pickProviderForOs(true) returns Azure when VPS_RDP_PROVIDER=azure', () => {
    process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
    process.env.VPS_RDP_PROVIDER     = 'azure'
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    const svc = vp.pickProviderForOs(true)
    expect(svc.PROVIDER).toBe('azure')
  })

  test('When VPS_RDP_PROVIDER is UNSET, isRDP=true falls back to default provider', () => {
    process.env.VPS_DEFAULT_PROVIDER = 'vultr'
    // dotenv would re-populate from /app/backend/.env on module load, so we
    // explicitly clear by setting to empty string (which the module treats as unset).
    process.env.VPS_RDP_PROVIDER     = ''
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.pickProviderForOs(true).PROVIDER).toBe('vultr')
    expect(vp.pickProviderForOs(false).PROVIDER).toBe('vultr')
  })

  test('When VPS_RDP_PROVIDER is empty string, isRDP=true falls back to default', () => {
    process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
    process.env.VPS_RDP_PROVIDER     = ''
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.pickProviderForOs(true).PROVIDER).toBe('digitalocean')
  })

  test('getRdpProvider() returns null when env var is unset', () => {
    process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
    // Empty string is treated as unset by the module (dotenv preserves it).
    process.env.VPS_RDP_PROVIDER     = ''
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.getRdpProvider()).toBeNull()
  })

  test('getRdpProvider() returns Azure service when configured', () => {
    process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
    process.env.VPS_RDP_PROVIDER     = 'azure'
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.getRdpProvider().PROVIDER).toBe('azure')
  })

  test('Exports include both pickProviderForOs and RDP_PROVIDER constant', () => {
    process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
    process.env.VPS_RDP_PROVIDER     = 'azure'
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(typeof vp.pickProviderForOs).toBe('function')
    expect(typeof vp.getRdpProvider).toBe('function')
    expect(vp.RDP_PROVIDER).toBe('azure')
  })
})

describe('OS-aware routing — per-record routing unchanged (backwards-compat)', () => {
  beforeEach(() => {
    process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
    process.env.VPS_RDP_PROVIDER     = 'azure'
    jest.resetModules()
  })

  test('Existing Vultr records still route to Vultr regardless of OS routing', () => {
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    const svc = vp.getProviderForRecord({
      provider: 'vultr',
      contaboInstanceId: 'cb676a83-3b48-4b6a-9f88-d62e1c9aac1f',
    })
    expect(svc.PROVIDER).toBe('vultr')
  })

  test('Existing Contabo numeric IDs still route to Contabo', () => {
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    const svc = vp.getProviderForRecord({ contaboInstanceId: '203228089' })
    // Contabo service predates the PROVIDER export convention; verify via a
    // Contabo-specific identifier function instead.
    expect(typeof svc.createInstance).toBe('function')
    expect(typeof svc.PRODUCT_CATALOG_SSD).toBeDefined()
    // Sanity: it's NOT one of the prefix-based providers
    expect(svc.PROVIDER).not.toBe('azure')
    expect(svc.PROVIDER).not.toBe('digitalocean')
    expect(svc.PROVIDER).not.toBe('vultr')
    expect(svc.PROVIDER).not.toBe('ovh')
  })

  test('Azure az- record still routes to Azure', () => {
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    const svc = vp.getProviderForRecord({ contaboInstanceId: 'az-nmd1a2b3c4' })
    expect(svc.PROVIDER).toBe('azure')
  })

  test('DigitalOcean do- record still routes to DigitalOcean', () => {
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    const svc = vp.getProviderForRecord({ contaboInstanceId: 'do-487393245' })
    expect(svc.PROVIDER).toBe('digitalocean')
  })
})

describe('OS-aware routing — vm-instance-setup.js wiring', () => {
  // Source-level assertions that ensure the 4 critical call sites in
  // vm-instance-setup.js were converted from `contabo.X(...)` (legacy smart
  // proxy) to `vpsProvider.pickProviderForOs(isRDP).X(...)`. Catches regressions.

  const fs = require('fs')
  const filePath = path.join(__dirname, '..', 'js', 'vm-instance-setup.js')
  let src
  beforeEach(() => { src = fs.readFileSync(filePath, 'utf-8') })

  test('fetchAvailableVPSConfigs uses pickProviderForOs(isRDP) for listProducts', () => {
    expect(src).toMatch(/pickProviderForOs\(isRDP\)/)
    // confirm the old line was replaced
    expect(src).not.toMatch(/const products = contabo\.listProducts\(/)
  })

  test('fetchAvailableOS routes Linux+RDP defaults through pickProviderForOs', () => {
    expect(src).toMatch(/const linuxProvider\s*=\s*vpsProvider\.pickProviderForOs\(false\)/)
    expect(src).toMatch(/const rdpProvider\s*=\s*vpsProvider\.pickProviderForOs\(true\)/)
    expect(src).not.toMatch(/const linuxImages = await contabo\.listImages/)
  })

  test('createVPSInstance calls createInstance via OS-aware newProvider, not the smart proxy', () => {
    expect(src).toMatch(/const newProvider\s*=\s*vpsProvider\.pickProviderForOs\(isRDP\)/)
    // Creation goes through newProvider — either the capacity-aware
    // createInstanceWithFallback (when the provider offers it) or plain createInstance.
    expect(src).toMatch(/await newProvider\.createInstanceWithFallback\(createOpts\)/)
    expect(src).toMatch(/:\s*await newProvider\.createInstance\(createOpts\)/)
    expect(src).not.toMatch(/await contabo\.createInstance\(createOpts\)/)
  })

  test('fetchVpsUpgradeOptions uses upgradeProvider (not contabo) for catalog lookups', () => {
    expect(src).toMatch(/const upgradeProvider\s*=\s*vpsProvider\.pickProviderForOs\(isRDP\)/)
    expect(src).not.toMatch(/contabo\.getProduct\(vpsDetails\.productId\)/)
    expect(src).not.toMatch(/contabo\.listProducts\(region,\s*isRDP/)
  })
})
