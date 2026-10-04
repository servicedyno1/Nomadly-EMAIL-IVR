/* global describe, test, expect, beforeEach, jest */
/**
 * Azure provider — integration with the vps-provider abstraction.
 *
 * Confirms:
 *   - 3-tier Dsv6 catalog ("RDP 10/20/30") — the Bsv2 tier shipped at MVP was
 *     unprovisionable on this subscription and was replaced (same sell prices)
 *   - AZURE_DSV5_ENABLED gates D-series (v5) expansion (D2s_v5 / D4s_v5)
 *   - Pricing applies 200% markup (matches VPS_MARKUP_PERCENT)
 *   - listProducts accepts the 3-arg signature (parity with contabo)
 *   - 9 customer-facing regions resolve to an Azure region slug
 *   - vps-provider routes by record + by instanceId correctly:
 *       `az-<name>` IDs → Azure
 *       `do-<num>` → DigitalOcean
 *       UUIDs → Vultr
 *       Bare numeric → Contabo
 *       `vps-…` → OVH
 *   - Customer-facing names never mention "Azure" / "Microsoft" / other providers
 *   - Windows-ONLY: listImages('linux') is empty, getCompatibleLinuxImage is null
 *   - VM name generation respects Azure's 1-15 char alphanumeric+hyphen rule
 *   - Azure password generator yields rule-compliant credentials
 *   - Per-instance dispatch via smart proxy honours `az-` prefix for start/stop/etc.
 */
process.env.VPS_MARKUP_PERCENT = '200'
process.env.AZURE_TENANT_ID = 'test-tenant'
process.env.AZURE_CLIENT_ID = 'test-client'
process.env.AZURE_CLIENT_SECRET = 'test-secret'
process.env.AZURE_SUBSCRIPTION_ID = 'test-sub'
process.env.AZURE_RESOURCE_GROUP = 'nomadly-vps'
delete process.env.AZURE_DSV5_ENABLED // ensure default = Dsv6 tier only

const path = require('path')
const azure = require(path.join(__dirname, '..', 'js', 'azure-service.js'))

describe('Azure — Cloud VPS catalog (Windows / RDP-only, Dsv6 tier)', () => {
  test('Default catalog is exactly 3 Dsv6-tier SKUs (v5 D-tier gated off)', () => {
    expect(azure.PRODUCT_CATALOG).toHaveLength(3)
    expect(azure.PRODUCT_CATALOG.map(p => p.productId)).toEqual([
      'Standard_D2s_v6', 'Standard_D4s_v6', 'Standard_D8s_v6',
    ])
  })

  test('Customer-facing names follow the "RDP X0" tier convention', () => {
    expect(azure.PRODUCT_CATALOG.map(p => p.name)).toEqual([
      'RDP 10', 'RDP 20', 'RDP 30',
    ])
  })

  test('Customer-facing names never mention provider', () => {
    for (const p of azure.PRODUCT_CATALOG) {
      expect(p.name).not.toMatch(/azure/i)
      expect(p.name).not.toMatch(/microsoft/i)
      expect(p.name).not.toMatch(/standard_[bd]/i)
      expect(p.name).not.toMatch(/_v[256]/i)
      expect(p.name).not.toMatch(/vultr/i)
      expect(p.name).not.toMatch(/contabo/i)
      expect(p.name).not.toMatch(/digital\s*ocean/i)
      expect(p.name).not.toMatch(/ovh/i)
    }
  })

  test('Tier 1 = D2s_v6 (2 vCPU / 8 GB) at $30 base (→ $90 with 200% markup)', () => {
    const tier1 = azure.PRODUCT_CATALOG[0]
    expect(tier1.productId).toBe('Standard_D2s_v6')
    expect(tier1.cpuCores).toBe(2)
    expect(tier1.ramMb).toBe(8192)
    expect(tier1.basePriceUsd).toBe(30)
  })

  test('PRODUCT_CATALOG_SSD is an alias of PRODUCT_CATALOG (Azure managed disks are SSD)', () => {
    expect(azure.PRODUCT_CATALOG_SSD).toBe(azure.PRODUCT_CATALOG)
  })

  test('AZURE_DSV5_ENABLED=true unlocks v5 D-tier expansion (5 SKUs total)', () => {
    process.env.AZURE_DSV5_ENABLED = 'true'
    jest.resetModules()
    const azureWithD = require(path.join(__dirname, '..', 'js', 'azure-service.js'))
    expect(azureWithD.PRODUCT_CATALOG).toHaveLength(5)
    expect(azureWithD.PRODUCT_CATALOG.map(p => p.productId)).toEqual([
      'Standard_D2s_v6', 'Standard_D4s_v6', 'Standard_D8s_v6',
      'Standard_D2s_v5', 'Standard_D4s_v5',
    ])
    // restore
    delete process.env.AZURE_DSV5_ENABLED
    jest.resetModules()
  })
})

describe('Azure — pricing with 200% markup', () => {
  test.each([
    ['Standard_D2s_v6',  30,  90],
    ['Standard_D4s_v6',  52, 156],
    ['Standard_D8s_v6',  96, 288],
  ])('%s costs $%i × 3 = $%i sell price', (id, base, sell) => {
    const p = azure.getProduct(id)
    const price = azure.calculatePrice(p, 'EU', true)
    expect(price.basePriceUsd).toBe(base)
    expect(price.totalWithMarkup).toBe(sell)
  })

  test('Windows licence is bundled — windowsLicense reports 0 (cross-provider compat)', () => {
    const p = azure.getProduct('Standard_D2s_v6')
    const price = azure.calculatePrice(p, 'EU', true)
    expect(price.windowsLicense).toBe(0)
  })

  test('Region surcharge is zero across all 9 supported regions (flat pricing)', () => {
    const p = azure.getProduct('Standard_D2s_v6')
    for (const region of Object.keys(azure.REGION_TO_AZURE)) {
      const price = azure.calculatePrice(p, region, true)
      expect(price).not.toBeNull()
      expect(price.regionSurcharge).toBe(0)
    }
  })

  test('Unknown region returns null pricing', () => {
    const p = azure.getProduct('Standard_D2s_v6')
    expect(azure.calculatePrice(p, 'MARS', true)).toBeNull()
  })

  test('listProducts accepts (region, isWindows, diskPreference) — Contabo signature parity', () => {
    const ssd = azure.listProducts('EU', true, 'ssd')
    const nvme = azure.listProducts('EU', true, 'nvme')
    expect(ssd).toHaveLength(3)
    expect(nvme).toHaveLength(3)
    expect(ssd.map(p => p.productId)).toEqual(nvme.map(p => p.productId))
  })

  test('listProducts with isWindows=false returns empty (Azure tier is Windows-only)', () => {
    expect(azure.listProducts('EU', false)).toEqual([])
  })
})

describe('Azure — regions: 9 customer-facing slugs map to Azure slugs', () => {
  test.each([
    ['EU',         'westeurope'],
    ['US-east',    'eastus'],
    ['US-west',    'westus3'],
    ['US-central', 'eastus2'],
    ['UK',         'uksouth'],
    ['SG',         'southeastasia'],
    ['AU',         'australiaeast'],
    ['IN',         'centralindia'],
    ['JP',         'japaneast'],
  ])('%s → %s', (slug, azureSlug) => {
    expect(azure.REGION_TO_AZURE[slug]).toBe(azureSlug)
  })

  test('listRegions returns 9 regions', async () => {
    const regions = await azure.listRegions()
    expect(regions).toHaveLength(9)
    expect(regions.map(r => r.regionSlug).sort()).toEqual(
      ['AU', 'EU', 'IN', 'JP', 'SG', 'UK', 'US-central', 'US-east', 'US-west']
    )
  })

  test('Each region exposes a display label that NEVER mentions Azure', async () => {
    const regions = await azure.listRegions()
    for (const r of regions) {
      expect(r.regionName).not.toMatch(/azure/i)
      expect(r.regionName).not.toMatch(/microsoft/i)
    }
  })
})

describe('Azure — images: Windows-ONLY, no Linux on this tier', () => {
  test('getCompatibleLinuxImage returns null (Azure is RDP-only here)', async () => {
    expect(await azure.getCompatibleLinuxImage(null, 'Standard_B1ms')).toBeNull()
  })

  test('listImages("linux") returns empty array', async () => {
    expect(await azure.listImages('linux')).toEqual([])
  })

  test('listImages("windows") returns Windows Server SKUs', async () => {
    const imgs = await azure.listImages('windows')
    expect(imgs.length).toBeGreaterThan(0)
    for (const i of imgs) {
      expect(i.isWindows).toBe(true)
      expect(i.osType).toBe('Windows')
    }
  })

  test('Default image is Windows Server 2022 Datacenter (Gen2)', async () => {
    expect(await azure.getDefaultWindowsImageId('Standard_D2s_v6')).toBe('win2022-datacenter-g2')
  })

  test('_imageReference resolves to Microsoft publisher + valid Gen2 SKU', () => {
    const ref = azure._imageReference('win2022-datacenter-g2')
    expect(ref.publisher).toBe('MicrosoftWindowsServer')
    expect(ref.offer).toBe('WindowsServer')
    expect(ref.sku).toBe('2022-datacenter-g2')
    expect(ref.version).toBe('latest')
  })

  test('Unknown imageId falls back to default Gen2 Windows Server 2022', () => {
    const ref = azure._imageReference('does-not-exist')
    expect(ref.sku).toBe('2022-datacenter-g2')
  })

  test('Legacy Gen1 image still resolvable for legacy B-series', () => {
    const ref = azure._imageReference('win2022-datacenter')
    expect(ref.sku).toBe('2022-Datacenter')
  })
})

describe('Azure — ID prefix routing (disambiguation from other providers)', () => {
  test('_wrapId adds az- prefix to bare VM name', () => {
    expect(azure._wrapId('nmd1a2b3c4')).toBe('az-nmd1a2b3c4')
  })

  test('_wrapId is idempotent (already-prefixed stays prefixed)', () => {
    expect(azure._wrapId('az-nmd1a2b3c4')).toBe('az-nmd1a2b3c4')
  })

  test('_stripIdPrefix removes az- prefix', () => {
    expect(azure._stripIdPrefix('az-nmd1a2b3c4')).toBe('nmd1a2b3c4')
  })

  test('_stripIdPrefix passes through bare names unchanged', () => {
    expect(azure._stripIdPrefix('nmd1a2b3c4')).toBe('nmd1a2b3c4')
  })

  test('_generateVmName respects Azure 15-char Windows VM name limit', () => {
    for (let i = 0; i < 20; i++) {
      const n = azure._generateVmName('nmd')
      expect(n.length).toBeLessThanOrEqual(15)
      expect(n).toMatch(/^nmd[0-9a-f]+$/)
    }
  })
})

describe('Azure — password generator', () => {
  test('Yields 20-char strings by default', () => {
    const pwd = azure._generateAzurePassword()
    expect(pwd.length).toBe(20)
  })

  test('Always contains upper, lower, digit, and special chars', () => {
    for (let i = 0; i < 20; i++) {
      const pwd = azure._generateAzurePassword()
      expect(pwd).toMatch(/[A-Z]/)
      expect(pwd).toMatch(/[a-z]/)
      expect(pwd).toMatch(/[0-9]/)
      expect(pwd).toMatch(/[!@#$%^&*()\-_=+[\]{}]/)
    }
  })

  test('Never embeds the admin username (Azure forbids this)', () => {
    for (let i = 0; i < 10; i++) {
      const pwd = azure._generateAzurePassword(20, 'nomadly')
      expect(pwd.toLowerCase()).not.toContain('nomadly')
    }
  })

  test('_safeUsername rejects reserved usernames and falls back to "nomadly"', () => {
    expect(azure._safeUsername('admin')).toBe('nomadly')
    expect(azure._safeUsername('root')).toBe('nomadly')
    expect(azure._safeUsername('administrator')).toBe('nomadly')
    expect(azure._safeUsername('test')).toBe('nomadly')
    // Allowed: alphanumeric, 3-20 chars
    expect(azure._safeUsername('customlabel')).toBe('customlabel')
  })

  test('_safeUsername strips special chars + lowercases', () => {
    expect(azure._safeUsername('My-User_42!')).toBe('myuser42')
  })

  test('_safeUsername falls back when too short / too long', () => {
    expect(azure._safeUsername('ab')).toBe('nomadly')
    expect(azure._safeUsername('a'.repeat(30))).toBe('nomadly')
  })
})

describe('vps-provider — per-record + per-instanceId routing for Azure', () => {
  beforeEach(() => {
    jest.resetModules()
  })

  test('VPS_DEFAULT_PROVIDER=azure → getProvider returns Azure', () => {
    process.env.VPS_DEFAULT_PROVIDER = 'azure'
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.getProvider().PROVIDER).toBe('azure')
  })

  test('az-prefixed instanceId → routed to Azure regardless of default', () => {
    process.env.VPS_DEFAULT_PROVIDER = 'contabo'
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    const svc = vp.dispatchByInstanceId('az-nmd1a2b3c4')
    expect(svc.PROVIDER).toBe('azure')
  })

  test('detectProviderByInstanceId recognises `az-` prefix', () => {
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.detectProviderByInstanceId('az-nmd1a2b3c4')).toBe('azure')
    expect(vp.detectProviderByInstanceId('AZ-NMD1A2B3C4')).toBe('azure') // case-insensitive
  })

  test('Existing instanceId formats still route correctly (no regression)', () => {
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.detectProviderByInstanceId('203228089')).toBe('contabo')
    expect(vp.detectProviderByInstanceId('do-487393245')).toBe('digitalocean')
    expect(vp.detectProviderByInstanceId('cb676a83-3b48-4b6a-9f88-d62e1c9aac1f')).toBe('vultr')
    expect(vp.detectProviderByInstanceId('vps-12abc34.vps.ovh.net')).toBe('ovh')
  })

  test('getProviderForRecord({provider: "azure"}) routes to Azure', () => {
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.getProviderForRecord({ provider: 'azure' }).PROVIDER).toBe('azure')
  })

  test('getProviderForRecord({contaboInstanceId: "az-..."}) routes to Azure', () => {
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    const svc = vp.getProviderForRecord({ contaboInstanceId: 'az-nmd1a2b3c4' })
    expect(svc.PROVIDER).toBe('azure')
  })

  test('Smart proxy: contabo.startInstance("az-...") routes to Azure (lifecycle compat)', () => {
    process.env.VPS_DEFAULT_PROVIDER = 'contabo'
    jest.resetModules()
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    const proxy = vp.buildSmartProxy()
    expect(typeof proxy.startInstance).toBe('function')
    const dispatched = vp.dispatchByInstanceId('az-nmd1a2b3c4')
    expect(dispatched.PROVIDER).toBe('azure')
    for (const m of [
      'startInstance', 'stopInstance', 'restartInstance', 'shutdownInstance',
      'resetPassword', 'reinstallInstance', 'cancelInstance',
      'upgradeInstance', 'updateInstanceName',
      'createSnapshot', 'listSnapshots', 'deleteSnapshot',
    ]) {
      expect(typeof dispatched[m]).toBe('function')
    }
  })
})

describe('Azure — circuit breaker & password secrets', () => {
  test('Circuit starts healthy', () => {
    azure.resetProvisioningCircuit()
    const s = azure.getCircuitState()
    expect(s.healthy).toBe(true)
    expect(s.failures).toBe(0)
  })

  test('Password secrets cache: create → resolve via secretId', async () => {
    const secret = await azure.createSecret('test-pwd', 'MyPassword42', 'password')
    expect(secret.secretId).toMatch(/^az-pwd-/)
    const fetched = await azure.getSecret(secret.secretId)
    expect(fetched).not.toBeNull()
    expect(fetched.type).toBe('password')
    // Cleanup
    await azure.deleteSecret(secret.secretId)
    expect(await azure.getSecret(secret.secretId)).toBeNull()
  })

  test('createSecret rejects unsupported type', async () => {
    await expect(azure.createSecret('x', 'y', 'oauth')).rejects.toThrow(/unsupported type/)
  })

  test('Snapshot ops use the 2025-01-02 api-version (not 2024-11-01)', () => {
    // Regression guard: Azure ARM rejects snapshots with 2024-11-01.
    // Source-level check catches accidental reverts.
    const fs = require('fs')
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'js', 'azure-service.js'), 'utf-8')
    // The snapshot api-version constant must be present and used by all 3 ops
    expect(src).toMatch(/const _SNAPSHOT_API_VERSION\s*=\s*'2025-01-02'/)
    // Helper to count occurrences of a substring
    const count = (s, needle) => s.split(needle).length - 1
    expect(count(src, '_SNAPSHOT_API_VERSION')).toBeGreaterThanOrEqual(4) // 1 const + 3 usages
  })
})

describe('Azure — formatInstanceForDisplay (cross-provider parity)', () => {
  test('Returns Contabo-shape output for the bot UX renderer', () => {
    const fmt = azure.formatInstanceForDisplay({
      instanceId:  'az-nmd1a2b3c4',
      mainIp:      '20.85.123.45',
      status:      'running',
      region:      'westeurope',
      plan:        'Standard_D2s_v6',
      ramMb:       8192,
      diskMb:      127 * 1024,
      cpuCores:    2,
      label:       'demo',
      createdDate: '2026-06-24T00:00:00Z',
      defaultUser: 'nomadly',
    })
    expect(fmt.instanceId).toBe('az-nmd1a2b3c4')
    expect(fmt.ip).toBe('20.85.123.45')
    expect(fmt.statusEmoji).toBe('🟢')
    expect(fmt.osType).toBe('Windows')
    expect(fmt.isWindows).toBe(true)
    expect(fmt.defaultUser).toBe('nomadly')
    expect(fmt.regionName).toBe('Europe (West)')
    expect(fmt.ramGb).toBe(8)
    expect(fmt.diskGb).toBe(127)
    expect(fmt.productName).toBe('RDP 10')
  })

  test('Deallocated / stopped status shows 🔴', () => {
    const fmt1 = azure.formatInstanceForDisplay({
      instanceId: 'az-x', status: 'deallocated', region: 'westeurope', plan: 'Standard_D2s_v6',
    })
    expect(fmt1.statusEmoji).toBe('🔴')
    const fmt2 = azure.formatInstanceForDisplay({
      instanceId: 'az-y', status: 'stopped', region: 'westeurope', plan: 'Standard_D2s_v6',
    })
    expect(fmt2.statusEmoji).toBe('🔴')
  })

  test('Creating / updating status shows 🟡', () => {
    const fmt = azure.formatInstanceForDisplay({
      instanceId: 'az-z', status: 'Creating', region: 'eastus', plan: 'Standard_D4s_v6',
    })
    expect(fmt.statusEmoji).toBe('🟡')
  })
})

describe('Azure — destructive-cancel guards in vm-instance-setup.js', () => {
  // Azure has no scheduled cancel: cancelInstance() destroys the VM instantly. The guard
  // list is centralised in vps-provider.isDestructiveCancelProvider and vm-instance-setup.js
  // gates every destructive branch (cancel-on-create / auto-renew OFF / delete) through it.
  const fs = require('fs')
  const vmSetupPath = path.join(__dirname, '..', 'js', 'vm-instance-setup.js')
  let src
  beforeEach(() => { src = fs.readFileSync(vmSetupPath, 'utf8'); jest.resetModules() })

  test('isDestructiveCancelProvider("azure") is true (alongside vultr / digitalocean)', () => {
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.isDestructiveCancelProvider('azure')).toBe(true)
    expect(vp.isDestructiveCancelProvider(vp.detectProviderByInstanceId('az-nmd1a2b3c4'))).toBe(true)
    expect(vp.isDestructiveCancelProvider('vultr')).toBe(true)
    expect(vp.isDestructiveCancelProvider('digitalocean')).toBe(true)
    expect(vp.isDestructiveCancelProvider('contabo')).toBe(false)
  })

  test('Cancel-on-create guard goes through isDestructiveCancelProvider(detectProviderByInstanceId(...))', () => {
    expect(src).toMatch(/isDestructiveCancelProvider\(\s*vpsProvider\.detectProviderByInstanceId\(instance\.instanceId\)\s*\)/)
  })

  test('changeVpsAutoRenewal toggle guards against destructive cancel via the shared helper', () => {
    expect(src).toMatch(/const _provName = vpsProvider\.detectProviderByInstanceId\(contaboInstanceId\)[\s\S]{0,400}?isDestructiveCancelProvider\(_provName\)/)
  })

  test('deleteVPSinstance short-circuit treats destructive providers as immediate-delete', () => {
    expect(src).toMatch(/isDestructiveCancelProvider\(_providerName\)[\s\S]{0,600}?immediate-delete/)
  })
})
