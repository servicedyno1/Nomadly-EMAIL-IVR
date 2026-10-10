// Detect + re-create missing apex/www web DNS (tunnel CNAME) for live hosting accounts.
const axios = require('axios')
const cfService = require('./cf-service')

const WEB_TYPES = ['A', 'AAAA', 'CNAME']
const cfHeaders = () => ({ 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY })

const domainsOf = (acct) => [...new Set(
  [acct.domain, ...(acct.addonDomains || []).map(a => (typeof a === 'string' ? a : a && a.domain))]
    .filter(Boolean).map(d => String(d).toLowerCase()),
)]

const isLiveAccount = (acct) => !!acct && acct.deleted !== true && acct.provisionState !== 'failed' && acct.terminatedOnWhm !== true

// Throws on any CF error so a failed lookup is never mistaken for "record missing".
async function webRecordsFor(zoneId, name) {
  const res = await axios.get(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    headers: cfHeaders(), params: { name, per_page: 100 }, timeout: 15000,
  })
  if (!res.data || !res.data.success) throw new Error('cf_list_failed')
  return (res.data.result || []).filter(r => WEB_TYPES.includes(r.type))
}

async function inspectDomain(domain) {
  const zone = await cfService.getZoneByName(domain)
  if (!zone) return { domain, status: 'no_zone', missing: [] }
  const missing = []
  for (const name of [domain, `www.${domain}`]) {
    if (!(await webRecordsFor(zone.id, name)).length) missing.push(name)
  }
  return { domain, zone_id: zone.id, status: missing.length ? 'missing' : 'ok', missing }
}

async function repairAccount(acct, { apply = false } = {}) {
  const tunnel = process.env.CF_TUNNEL_CNAME
  const domains = []
  for (const d of domainsOf(acct)) {
    let r
    try { r = await inspectDomain(d) } catch (e) {
      domains.push({ domain: d, status: 'error', error: e.message, missing: [] })
      continue
    }
    if (apply && r.missing.length) {
      r.created = []
      for (const name of r.missing) {
        const c = tunnel ? await cfService.createDNSRecord(r.zone_id, 'CNAME', name, tunnel, 1, true) : { success: false, error: 'tunnel_not_configured' }
        r.created.push({ name, type: 'CNAME', content: tunnel || null, proxied: true, success: !!(c && c.success), ...(c && c.success ? {} : { error: (c && (c.error || (c.errors && JSON.stringify(c.errors)))) || 'create_failed' }) })
      }
      r.status = r.created.every(c => c.success) ? 'repaired' : 'repair_failed'
    }
    domains.push(r)
  }
  return { username: acct._id, domains }
}

module.exports = { repairAccount, inspectDomain, domainsOf, isLiveAccount }
