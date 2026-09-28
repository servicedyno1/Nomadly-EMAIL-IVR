/*global process */
// Droplet-native replacement for the Railway custom-domain API.
// Attaching a customer domain = Cloudflare A record → droplet IP (proxied) + a
// per-domain nginx server block on this box (Cloudflare Origin CA cert when
// available, fallback cert otherwise) + zone SSL mode full/strict.
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { log } = require('console')

const cfg = () => ({
  ip: (process.env.DROPLET_PUBLIC_IP || '').trim(),
  appPort: (process.env.DROPLET_APP_PORT || process.env.PORT || '5000').trim(),
  domainsDir: process.env.DROPLET_NGINX_DOMAINS_DIR || '/etc/nginx/nomadly-domains',
  certsDir: process.env.DROPLET_CERTS_DIR || '/etc/nginx/nomadly-certs',
  fallbackCert: process.env.DROPLET_FALLBACK_CERT || '',
  fallbackKey: process.env.DROPLET_FALLBACK_KEY || '',
  reloadCmd: process.env.DROPLET_NGINX_RELOAD_CMD || 'nginx -t && systemctl reload nginx',
  brand: (process.env.CHAT_BOT_BRAND || 'nomadly').toLowerCase().replace(/[^a-z0-9]/g, ''),
})

const isDroplet = () => process.env.HOSTED_ON === 'droplet'
const isIPv4 = (s) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(String(s || '').trim())
const validDomain = (d) => /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(String(d || '').trim().toLowerCase())
const norm = (d) => String(d || '').trim().toLowerCase().replace(/\.$/, '')

const confPath = (d) => path.join(cfg().domainsDir, `${d}.conf`)
const certDir = (d) => path.join(cfg().certsDir, d)

// True when a DNS record (viewDNSRecords or raw CF shape) is the shortener pointer:
// legacy Railway CNAME, or an A record at our droplet IP.
function isShortenerDnsRecord(r) {
  if (!r) return false
  const type = String(r.recordType || r.type || '').toUpperCase()
  const content = String(r.recordContent || r.content || '')
  if (type === 'CNAME' && content.includes('.up.railway.app')) return true
  const ip = cfg().ip
  return !!ip && type === 'A' && content.trim() === ip
}

function runShell(cmd) {
  return new Promise((resolve) => {
    execFile('/bin/sh', ['-c', cmd], { timeout: 60000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') })
    })
  })
}

async function reloadNginx() {
  const r = await runShell(cfg().reloadCmd)
  if (!r.ok) log(`[Droplet] nginx reload failed: ${r.err.slice(0, 400)}`)
  return r
}

function nginxBlock(domain, cert, key) {
  const { appPort, brand } = cfg()
  return `# ${brand} shortener domain — managed by droplet-domain-server.js (do not edit)
server {
    listen 80;
    listen [::]:80;
    server_name ${domain} *.${domain};
    location / {
        proxy_pass http://127.0.0.1:${appPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${domain} *.${domain};
    ssl_certificate     ${cert};
    ssl_certificate_key ${key};
    ssl_protocols TLSv1.2 TLSv1.3;
    client_max_body_size 60M;
    location / {
        proxy_pass http://127.0.0.1:${appPort};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
`
}

// Issue (or reuse) a Cloudflare Origin CA cert for domain + *.domain. Returns {cert,key,origin:true}
// or the fallback pair with origin:false.
async function ensureCert(domain) {
  const dir = certDir(domain)
  const cert = path.join(dir, 'fullchain.pem')
  const key = path.join(dir, 'privkey.pem')
  if (fs.existsSync(cert) && fs.existsSync(key)) return { cert, key, origin: true }
  try {
    const cfService = require('./cf-service.js')
    const res = await cfService.generateOriginCACert([domain, `*.${domain}`])
    if (res?.success && res.certificate && res.privateKey) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      fs.writeFileSync(cert, res.certificate, { mode: 0o600 })
      fs.writeFileSync(key, res.privateKey, { mode: 0o600 })
      return { cert, key, origin: true }
    }
    log(`[Droplet] Origin CA cert unavailable for ${domain}: ${res?.error || 'unknown'} — using fallback cert`)
  } catch (e) {
    log(`[Droplet] Origin CA cert error for ${domain}: ${e.message} — using fallback cert`)
  }
  const { fallbackCert, fallbackKey } = cfg()
  if (fallbackCert && fallbackKey && fs.existsSync(fallbackCert) && fs.existsSync(fallbackKey)) {
    return { cert: fallbackCert, key: fallbackKey, origin: false }
  }
  return null
}

// Cloudflare must talk TLS to the origin: strict when we hold an Origin CA cert, full otherwise.
async function setZoneSsl(domain, mode) {
  try {
    const cfService = require('./cf-service.js')
    const zone = await cfService.getZoneByName(domain)
    if (!zone?.id) return false
    const ok = await cfService.setSSLMode(zone.id, mode)
    log(`[Droplet] ${domain}: Cloudflare SSL mode → ${mode} (${ok ? 'ok' : 'failed'})`)
    return ok
  } catch (e) {
    log(`[Droplet] ${domain}: setSSLMode error ${e.message}`)
    return false
  }
}

async function saveDomainInServer(domainRaw) {
  const domain = norm(domainRaw)
  const { ip } = cfg()
  if (!ip || !isIPv4(ip)) return { error: 'DROPLET_PUBLIC_IP is not configured on this server' }
  if (!validDomain(domain)) return { error: `Invalid domain: ${domainRaw}` }

  const existed = fs.existsSync(confPath(domain))
  const pair = await ensureCert(domain)
  if (!pair) return { error: 'No TLS certificate available for the origin (Origin CA failed and no fallback cert configured)' }

  try {
    fs.mkdirSync(cfg().domainsDir, { recursive: true })
    fs.writeFileSync(confPath(domain), nginxBlock(domain, pair.cert, pair.key))
  } catch (e) {
    return { error: `Could not write nginx config: ${e.message}` }
  }

  const reload = await reloadNginx()
  if (!reload.ok) {
    if (!existed) { try { fs.unlinkSync(confPath(domain)) } catch (_) {} ; await reloadNginx() }
    return { error: `nginx rejected the config for ${domain}: ${reload.err.split('\n')[0].slice(0, 200)}` }
  }

  await setZoneSsl(domain, pair.origin ? 'strict' : 'full')
  log(`[Droplet] ${domain} ${existed ? 'refreshed' : 'attached'} → ${ip} (cert: ${pair.origin ? 'origin-ca' : 'fallback'})`)
  return { server: ip, recordType: 'A' }
}

async function removeDomainFromServer(domainRaw) {
  const domain = norm(domainRaw)
  if (!validDomain(domain)) return { error: `Invalid domain: ${domainRaw}`, transient: false, statusCode: null }
  const conf = confPath(domain)
  if (!fs.existsSync(conf)) {
    log(`[Droplet] ${domain}: no nginx block — nothing to remove`)
    return { success: true, note: 'domain_not_found' }
  }
  try {
    fs.unlinkSync(conf)
    fs.rmSync(certDir(domain), { recursive: true, force: true })
  } catch (e) {
    return { error: e.message, transient: false, statusCode: null }
  }
  const reload = await reloadNginx()
  if (!reload.ok) return { error: `nginx reload failed: ${reload.err.split('\n')[0].slice(0, 200)}`, transient: true, statusCode: null }
  log(`[Droplet] ${domain} detached`)
  return { success: true }
}

async function listServerDomains() {
  try {
    return fs.readdirSync(cfg().domainsDir).filter(f => f.endsWith('.conf')).map(f => f.slice(0, -5))
  } catch (_) {
    return []
  }
}

async function getExistingServerDNS(domainRaw) {
  const domain = norm(domainRaw)
  if (!fs.existsSync(confPath(domain))) return null
  return { server: cfg().ip, recordType: 'A' }
}

module.exports = {
  isDroplet,
  isIPv4,
  isShortenerDnsRecord,
  saveDomainInServer,
  removeDomainFromServer,
  listServerDomains,
  getExistingServerDNS,
  // exported for tests
  _internals: { nginxBlock, cfg, confPath, certDir },
}
