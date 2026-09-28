/* Unit tests for droplet-domain-server.js + the rl-save-domain-in-server facade + A-record predicate. */
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'droplet-dom-'))
const reloadLog = path.join(tmp, 'reload.log')
process.env.HOSTED_ON = 'droplet'
process.env.DROPLET_PUBLIC_IP = '146.190.238.190'
process.env.DROPLET_APP_PORT = '5001'
process.env.DROPLET_NGINX_DOMAINS_DIR = path.join(tmp, 'domains')
process.env.DROPLET_CERTS_DIR = path.join(tmp, 'certs')
process.env.DROPLET_FALLBACK_CERT = path.join(tmp, 'fb.crt')
process.env.DROPLET_FALLBACK_KEY = path.join(tmp, 'fb.key')
process.env.DROPLET_NGINX_RELOAD_CMD = `echo reload >> ${reloadLog}`
fs.writeFileSync(process.env.DROPLET_FALLBACK_CERT, 'FB')
fs.writeFileSync(process.env.DROPLET_FALLBACK_KEY, 'FBK')

// Fake cf-service: origin CA succeeds for good.com, fails for nocert.com; record zone SSL modes.
const sslModes = {}
const fakeCf = {
  generateOriginCACert: async (hostnames) => hostnames[0] === 'good.com'
    ? { success: true, certificate: 'CERT', privateKey: 'KEY' }
    : { success: false, error: 'zone-name not part of your account' },
  getZoneByName: async (d) => ({ id: `zone-${d}` }),
  setSSLMode: async (zoneId, mode) => { sslModes[zoneId] = mode; return true },
}
const origLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === './cf-service.js' && parent && /droplet-domain-server\.js$/.test(parent.filename)) return fakeCf
  return origLoad.apply(this, arguments)
}

const droplet = require('../droplet-domain-server.js')
const facade = require('../rl-save-domain-in-server.js')

let passed = 0, failed = 0
const t = async (name, fn) => {
  try { await fn(); passed++; console.log(`  ✓ ${name}`) } catch (e) { failed++; console.log(`  ✗ ${name}\n    ${e.message}`) }
}

;(async () => {
  await t('attach with Origin CA cert → strict, A record, nginx block written, reload ran', async () => {
    const r = await facade.saveDomainInServerRailway('Good.com')
    assert.deepStrictEqual(r, { server: '146.190.238.190', recordType: 'A' })
    const conf = fs.readFileSync(path.join(tmp, 'domains', 'good.com.conf'), 'utf8')
    assert.ok(conf.includes('server_name good.com *.good.com;'))
    assert.ok(conf.includes('proxy_pass http://127.0.0.1:5001;'))
    assert.ok(conf.includes(path.join(tmp, 'certs', 'good.com', 'fullchain.pem')))
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'certs', 'good.com', 'privkey.pem'), 'utf8'), 'KEY')
    assert.strictEqual(sslModes['zone-good.com'], 'strict')
    assert.strictEqual(fs.readFileSync(reloadLog, 'utf8').trim().split('\n').length, 1)
  })

  await t('attach without Origin CA → fallback cert + SSL full', async () => {
    const r = await facade.saveDomainInServerRailway('nocert.com')
    assert.strictEqual(r.recordType, 'A')
    const conf = fs.readFileSync(path.join(tmp, 'domains', 'nocert.com.conf'), 'utf8')
    assert.ok(conf.includes(process.env.DROPLET_FALLBACK_CERT))
    assert.strictEqual(sslModes['zone-nocert.com'], 'full')
  })

  await t('re-attach is idempotent (cert reused, block rewritten)', async () => {
    const r = await facade.saveDomainInServerRailway('good.com')
    assert.strictEqual(r.server, '146.190.238.190')
    assert.strictEqual(fs.readFileSync(path.join(tmp, 'certs', 'good.com', 'privkey.pem'), 'utf8'), 'KEY')
  })

  await t('list + getExisting reflect attached domains', async () => {
    const list = await facade.listRailwayCustomDomains()
    assert.deepStrictEqual(list.sort(), ['good.com', 'nocert.com'])
    assert.deepStrictEqual(await facade.getExistingRailwayDNS('good.com'), { server: '146.190.238.190', recordType: 'A' })
    assert.strictEqual(await facade.getExistingRailwayDNS('missing.com'), null)
  })

  await t('invalid domain / path traversal rejected', async () => {
    assert.ok((await facade.saveDomainInServerRailway('../etc/passwd')).error)
    assert.ok((await facade.saveDomainInServerRailway('bad domain')).error)
    assert.ok((await facade.removeDomainFromRailway('../x')).error)
  })

  await t('remove deletes block + certs; second remove is a not-found success', async () => {
    const r = await facade.removeDomainFromRailway('good.com')
    assert.deepStrictEqual(r, { success: true })
    assert.ok(!fs.existsSync(path.join(tmp, 'domains', 'good.com.conf')))
    assert.ok(!fs.existsSync(path.join(tmp, 'certs', 'good.com')))
    const r2 = await facade.removeDomainFromRailway('good.com')
    assert.strictEqual(r2.success, true)
    assert.strictEqual(r2.note, 'domain_not_found')
  })

  await t('nginx -t failure rolls back a fresh block and returns error', async () => {
    process.env.DROPLET_NGINX_RELOAD_CMD = 'echo "nginx: [emerg] boom" >&2; exit 1'
    const r = await facade.saveDomainInServerRailway('broken.com')
    assert.ok(/nginx rejected/.test(r.error), r.error)
    assert.ok(!fs.existsSync(path.join(tmp, 'domains', 'broken.com.conf')))
    process.env.DROPLET_NGINX_RELOAD_CMD = `echo reload >> ${reloadLog}`
  })

  await t('missing DROPLET_PUBLIC_IP → clear error', async () => {
    const ip = process.env.DROPLET_PUBLIC_IP
    process.env.DROPLET_PUBLIC_IP = ''
    assert.ok(/DROPLET_PUBLIC_IP/.test((await facade.saveDomainInServerRailway('x.com')).error))
    process.env.DROPLET_PUBLIC_IP = ip
  })

  await t('isShortenerDnsRecord matches droplet A + legacy Railway CNAME only', async () => {
    const f = facade.isShortenerDnsRecord
    assert.strictEqual(f({ recordType: 'A', recordContent: '146.190.238.190' }), true)
    assert.strictEqual(f({ type: 'A', content: '146.190.238.190' }), true)
    assert.strictEqual(f({ recordType: 'CNAME', recordContent: 'abc.up.railway.app' }), true)
    assert.strictEqual(f({ recordType: 'A', recordContent: '1.2.3.4' }), false)
    assert.strictEqual(f({ recordType: 'CNAME', recordContent: 'x.cfargotunnel.com' }), false)
    assert.strictEqual(f(null), false)
  })

  await t('HOSTED_ON != droplet keeps the legacy Railway path (no nginx writes)', async () => {
    process.env.HOSTED_ON = 'railway'
    const before = fs.readdirSync(path.join(tmp, 'domains')).length
    const r = await facade.listRailwayCustomDomains() // Railway GraphQL → fails fast without token → []
    assert.ok(Array.isArray(r))
    assert.strictEqual(fs.readdirSync(path.join(tmp, 'domains')).length, before)
    process.env.HOSTED_ON = 'droplet'
  })

  fs.rmSync(tmp, { recursive: true, force: true })
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
})()
