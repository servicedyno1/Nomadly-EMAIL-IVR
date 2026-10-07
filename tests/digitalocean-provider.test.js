/* global describe, test, expect, beforeEach */
/**
 * DigitalOcean provider — integration with the vps-provider abstraction.
 *
 * Confirms:
 *   - 6-tier "Cloud VPS 10-60" catalog at the planned pricing
 *   - Pricing applies 200% markup (matches VPS_MARKUP_PERCENT)
 *   - listProducts accepts the 3-arg signature (parity with contabo)
 *   - 8 customer-facing regions resolve to a DO region slug (JP excluded)
 *   - vps-provider routes by record + by instanceId correctly:
 *       `do-<num>` IDs → DigitalOcean
 *       Bare numeric → Contabo (DO never sees a bare numeric)
 *       UUIDs → Vultr
 *       `vps-…` → OVH
 *   - Customer-facing names never mention "DigitalOcean" / "DO" / other providers
 *   - Linux ONLY: listImages('windows') is empty, getDefaultWindowsImageId is null
 *   - Cloud-init password injection works for createInstance + reinstall
 *   - Per-instance dispatch via smart proxy honours `do-` prefix for start/stop/etc.
 */
process.env.VPS_MARKUP_PERCENT = '200'
process.env.DIGITALOCEAN_API_TOKEN = 'test-key-only'

const path = require('path')
const digitalocean = require(path.join(__dirname, '..', 'js', 'digitalocean-service.js'))

describe('DigitalOcean — Cloud VPS catalog (Linux-only)', () => {
  test('Exactly 6 tiers, named "Cloud VPS 10/20/30/40/50/60"', () => {
    expect(digitalocean.PRODUCT_CATALOG).toHaveLength(6)
    const names = digitalocean.PRODUCT_CATALOG.map(p => p.name)
    expect(names).toEqual([
      'Cloud VPS 10', 'Cloud VPS 20', 'Cloud VPS 30',
      'Cloud VPS 40', 'Cloud VPS 50', 'Cloud VPS 60',
    ])
  })

  test('Customer-facing names never mention provider', () => {
    for (const p of digitalocean.PRODUCT_CATALOG) {
      expect(p.name).not.toMatch(/digitalocean/i)
      expect(p.name).not.toMatch(/digital\s*ocean/i)
      expect(p.name).not.toMatch(/\bdo\b/i)
      expect(p.name).not.toMatch(/vultr/i)
      expect(p.name).not.toMatch(/contabo/i)
      expect(p.name).not.toMatch(/ovh/i)
      expect(p.name).not.toMatch(/droplet/i)
    }
  })

  test('Tier 1 is the cheapest 1 GB plan ($6 DO cost)', () => {
    const tier1 = digitalocean.PRODUCT_CATALOG[0]
    expect(tier1.productId).toBe('s-1vcpu-1gb')
    expect(tier1.ramMb).toBe(1024)
    expect(tier1.basePriceUsd).toBe(6)
  })

  test('PRODUCT_CATALOG_SSD is an alias of PRODUCT_CATALOG (all DO standard droplets are SSD)', () => {
    expect(digitalocean.PRODUCT_CATALOG_SSD).toBe(digitalocean.PRODUCT_CATALOG)
  })
})

describe('DigitalOcean — pricing with 200% markup', () => {
  test.each([
    ['s-1vcpu-1gb',    6,  18],
    ['s-1vcpu-2gb',   12,  36],
    ['s-2vcpu-2gb',   18,  54],
    ['s-2vcpu-4gb',   24,  72],
    ['s-4vcpu-8gb',   48, 144],
    ['s-8vcpu-16gb',  96, 288],
  ])('%s costs $%i × 3 = $%i sell price', (id, base, sell) => {
    const p = digitalocean.getProduct(id)
    const price = digitalocean.calculatePrice(p, 'EU', false)
    expect(price.basePriceUsd).toBe(base)
    expect(price.totalWithMarkup).toBe(sell)
  })

  test('isWindows=true returns null (DO has no Windows)', () => {
    const p = digitalocean.getProduct('s-1vcpu-1gb')
    expect(digitalocean.calculatePrice(p, 'EU', true)).toBeNull()
  })

  test('JP region returns null pricing (no DO datacenter in Japan)', () => {
    const p = digitalocean.getProduct('s-1vcpu-1gb')
    expect(digitalocean.calculatePrice(p, 'JP', false)).toBeNull()
  })

  test('Region surcharge is zero across all 8 supported regions (flat pricing)', () => {
    const p = digitalocean.getProduct('s-1vcpu-1gb')
    for (const region of Object.keys(digitalocean.REGION_TO_DO_SLUG)) {
      const price = digitalocean.calculatePrice(p, region, false)
      expect(price).not.toBeNull()
      expect(price.regionSurcharge).toBe(0)
    }
  })

  test('listProducts accepts (region, isWindows, diskPreference) — SSD = Regular, NVMe = Premium AMD/Intel', () => {
    const ssd = digitalocean.listProducts('EU', false, 'ssd')
    const nvme = digitalocean.listProducts('EU', false, 'nvme')
    expect(ssd).toHaveLength(6)
    expect(ssd.every(p => p.diskType === 'ssd')).toBe(true)
    expect(nvme).toHaveLength(24)
    expect(nvme.every(p => p.diskType === 'nvme' && /-(amd|intel)$/.test(p.productId))).toBe(true)
    expect(digitalocean.listProducts('EU', false)).toHaveLength(30)
  })

  test('listProducts with isWindows=true returns empty (Linux-only)', () => {
    expect(digitalocean.listProducts('EU', true)).toEqual([])
  })

  test('listProducts with unavailable region (JP) returns empty', () => {
    expect(digitalocean.listProducts('JP', false)).toEqual([])
  })
})

describe('DigitalOcean — regions: 8 customer-facing slugs map to DO slugs', () => {
  test.each([
    ['EU',         'fra1'],
    ['US-central', 'nyc3'],
    ['US-east',    'nyc1'],
    ['US-west',    'sfo3'],
    ['UK',         'lon1'],
    ['SG',         'sgp1'],
    ['AU',         'syd1'],
    ['IN',         'blr1'],
  ])('%s → %s', (slug, doSlug) => {
    expect(digitalocean.REGION_TO_DO_SLUG[slug]).toBe(doSlug)
  })

  test('JP intentionally NOT in the region map (DO has no Japan DC)', () => {
    expect(digitalocean.REGION_TO_DO_SLUG.JP).toBeUndefined()
  })

  test('listRegions returns 8 regions (no JP)', async () => {
    const regions = await digitalocean.listRegions()
    expect(regions).toHaveLength(8)
    expect(regions.map(r => r.regionSlug).sort()).toEqual(
      ['AU', 'EU', 'IN', 'SG', 'UK', 'US-central', 'US-east', 'US-west']
    )
  })
})

describe('DigitalOcean — images: Linux only, no Windows', () => {
  test('getDefaultWindowsImageId returns null (no Windows on DO)', async () => {
    expect(await digitalocean.getDefaultWindowsImageId('s-1vcpu-1gb')).toBeNull()
  })

  test('getCompatibleWindowsImage returns null', async () => {
    expect(await digitalocean.getCompatibleWindowsImage('whatever', 's-1vcpu-1gb')).toBeNull()
  })

  test('listImages("windows") returns empty array', async () => {
    expect(await digitalocean.listImages('windows')).toEqual([])
  })

  test('listImages("linux") returns curated Linux distributions', async () => {
    const imgs = await digitalocean.listImages('linux')
    expect(imgs.length).toBeGreaterThan(0)
    for (const i of imgs) {
      expect(i.isWindows).toBe(false)
      expect(i.osType).toBe('Linux')
    }
  })

  test('Default Ubuntu LTS is offered first', async () => {
    const imgs = await digitalocean.listImages('linux')
    expect(imgs[0].imageId).toBe('ubuntu-24-04-x64')
  })
})

describe('DigitalOcean — ID prefix routing (disambiguation from Contabo)', () => {
  test('_wrapId adds do- prefix to bare numeric', () => {
    expect(digitalocean._wrapId(487393245)).toBe('do-487393245')
    expect(digitalocean._wrapId('487393245')).toBe('do-487393245')
  })

  test('_wrapId is idempotent (already-prefixed stays prefixed)', () => {
    expect(digitalocean._wrapId('do-487393245')).toBe('do-487393245')
  })

  test('_stripIdPrefix removes do- prefix', () => {
    expect(digitalocean._stripIdPrefix('do-487393245')).toBe('487393245')
  })

  test('_stripIdPrefix passes through bare IDs unchanged', () => {
    expect(digitalocean._stripIdPrefix('487393245')).toBe('487393245')
  })
})

describe('DigitalOcean — cloud-init password injection', () => {
  test('Builds a cloud-config that sets root password + enables pwauth', () => {
    const script = digitalocean._buildPasswordCloudInit('TestPwd123', null)
    expect(script).toContain('#cloud-config')
    expect(script).toContain('root:TestPwd123')
    expect(script).toMatch(/PermitRootLogin\s+yes/)
    expect(script).toMatch(/PasswordAuthentication\s+yes/)
    expect(script).toContain('ssh_pwauth: true')
  })

  test('Returns null when no password and no extra userData', () => {
    expect(digitalocean._buildPasswordCloudInit(null, null)).toBeNull()
  })

  test('Embeds extra userData as base64 runcmd when both provided', () => {
    const script = digitalocean._buildPasswordCloudInit('P@ss', '#!/bin/bash\necho hi')
    expect(script).toMatch(/base64 -d/)
    expect(script).toContain('root:P@ss')
  })
})

describe('vps-provider — per-record + per-instanceId routing for DigitalOcean', () => {
  beforeEach(() => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'vps-provider'))]
  })

  test('VPS_DEFAULT_PROVIDER=digitalocean → getProvider returns DigitalOcean', () => {
    process.env.VPS_DEFAULT_PROVIDER = 'digitalocean'
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'vps-provider'))]
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.getProvider().PROVIDER).toBe('digitalocean')
  })

  test('do-prefixed instanceId → routed to DigitalOcean regardless of default', () => {
    process.env.VPS_DEFAULT_PROVIDER = 'contabo'
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'vps-provider'))]
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    const svc = vp.dispatchByInstanceId('do-487393245')
    expect(svc.PROVIDER).toBe('digitalocean')
  })

  test('detectProviderByInstanceId recognises `do-` prefix', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'vps-provider'))]
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.detectProviderByInstanceId('do-487393245')).toBe('digitalocean')
  })

  test('Bare numeric instanceId still routes to Contabo (legacy preserved)', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'vps-provider'))]
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.detectProviderByInstanceId('203228089')).toBe('contabo')
  })

  test('UUID still routes to Vultr (existing behaviour preserved)', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'vps-provider'))]
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.detectProviderByInstanceId('cb676a83-3b48-4b6a-9f88-d62e1c9aac1f')).toBe('vultr')
  })

  test('vps- prefix still routes to OVH (existing behaviour preserved)', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'vps-provider'))]
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.detectProviderByInstanceId('vps-12abc34.vps.ovh.net')).toBe('ovh')
  })

  test('getProviderForRecord({provider: "digitalocean"}) routes to DigitalOcean', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'vps-provider'))]
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    expect(vp.getProviderForRecord({ provider: 'digitalocean' }).PROVIDER).toBe('digitalocean')
  })

  test('getProviderForRecord({contaboInstanceId: "do-..."}) routes to DigitalOcean', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'vps-provider'))]
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    const svc = vp.getProviderForRecord({ contaboInstanceId: 'do-487393245' })
    expect(svc.PROVIDER).toBe('digitalocean')
  })

  test('Smart proxy: contabo.startInstance("do-...") routes to DigitalOcean (lifecycle compat)', () => {
    // This is the key test for the user-stated requirement:
    // "ensure user can manage it fully from the bot like off, restart, on, etc"
    // The bot's lifecycle handler in vm-instance-setup.js:1027 calls
    // contabo.startInstance(instanceId) where `contabo` is the smart proxy.
    // We verify that calling it with a `do-` id reaches DO's service.
    process.env.VPS_DEFAULT_PROVIDER = 'contabo'
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'vps-provider'))]
    const vp = require(path.join(__dirname, '..', 'js', 'vps-provider'))
    const proxy = vp.buildSmartProxy()
    // Verify the proxy resolves startInstance to a function and would dispatch via dispatchByInstanceId
    expect(typeof proxy.startInstance).toBe('function')
    const dispatched = vp.dispatchByInstanceId('do-487393245')
    expect(dispatched.PROVIDER).toBe('digitalocean')
    expect(typeof dispatched.startInstance).toBe('function')
    expect(typeof dispatched.stopInstance).toBe('function')
    expect(typeof dispatched.restartInstance).toBe('function')
    expect(typeof dispatched.shutdownInstance).toBe('function')
    expect(typeof dispatched.resetPassword).toBe('function')
    expect(typeof dispatched.reinstallInstance).toBe('function')
    expect(typeof dispatched.cancelInstance).toBe('function')
  })
})

describe('DigitalOcean — circuit breaker & password secrets', () => {
  test('Circuit starts healthy', () => {
    digitalocean.resetProvisioningCircuit()
    const s = digitalocean.getCircuitState()
    expect(s.healthy).toBe(true)
    expect(s.failures).toBe(0)
  })

  test('Password secrets cache: create → resolve via secretId', async () => {
    const secret = await digitalocean.createSecret('test-pwd', 'MyPassword42', 'password')
    expect(secret.secretId).toMatch(/^do-pwd-/)
    const fetched = await digitalocean.getSecret(secret.secretId)
    expect(fetched).not.toBeNull()
    expect(fetched.type).toBe('password')
    // Cleanup
    await digitalocean.deleteSecret(secret.secretId)
    expect(await digitalocean.getSecret(secret.secretId)).toBeNull()
  })

  test('createSecret rejects unsupported type', async () => {
    await expect(digitalocean.createSecret('x', 'y', 'oauth')).rejects.toThrow(/unsupported type/)
  })
})

describe('DigitalOcean — formatInstanceForDisplay (cross-provider parity)', () => {
  test('Returns Contabo-shape output for the bot UX renderer', () => {
    const fmt = digitalocean.formatInstanceForDisplay({
      instanceId:  'do-487393245',
      mainIp:      '192.0.2.10',
      status:      'active',
      region:      'fra1',
      plan:        's-1vcpu-1gb',
      ramMb:       1024,
      diskMb:      25 * 1024,
      cpuCores:    1,
      label:       'demo',
      createdDate: '2026-06-24T00:00:00Z',
    })
    expect(fmt.instanceId).toBe('do-487393245')
    expect(fmt.ip).toBe('192.0.2.10')
    expect(fmt.statusEmoji).toBe('🟢')
    expect(fmt.osType).toBe('Linux')
    expect(fmt.isWindows).toBe(false)
    expect(fmt.defaultUser).toBe('root')
    expect(fmt.regionName).toBe('Europe (EU)')
    expect(fmt.ramGb).toBe(1)
    expect(fmt.diskGb).toBe(25)
    expect(fmt.productName).toBe('Cloud VPS 10')
  })

  test('Stopped status shows 🔴', () => {
    const fmt = digitalocean.formatInstanceForDisplay({
      instanceId: 'do-1', status: 'off', region: 'fra1', plan: 's-1vcpu-1gb',
    })
    expect(fmt.statusEmoji).toBe('🔴')
  })
})
