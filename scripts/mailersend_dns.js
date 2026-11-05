// Adds the DNS records MailerSend needs for a sending domain hosted on Cloudflare, then asks MailerSend to verify it.
//   node scripts/mailersend_dns.js cloudivr.net            → shows the plan (no changes)
//   node scripts/mailersend_dns.js cloudivr.net --apply    → writes the records + triggers verification
// SPF is MERGED into the existing record (never a second SPF). DKIM / return-path CNAMEs are DNS-only (not proxied).
// Click-tracking and inbound-routing records are skipped (not used).
require('dotenv').config({ path: require('path').join(__dirname, '..', 'backend', '.env') })
const axios = require('axios')

const domain = String(process.argv[2] || '').toLowerCase()
const apply = process.argv.includes('--apply')
if (!domain) { console.log('usage: node scripts/mailersend_dns.js <domain> [--apply]'); process.exit(1) }

const ms = axios.create({ baseURL: 'https://api.mailersend.com/v1', headers: { Authorization: `Bearer ${process.env.MAILERSEND_API_TOKEN}` }, timeout: 20000 })
const cf = axios.create({ baseURL: 'https://api.cloudflare.com/client/v4', headers: { 'X-Auth-Email': process.env.CLOUDFLARE_EMAIL, 'X-Auth-Key': process.env.CLOUDFLARE_API_KEY }, timeout: 20000 })
const unq = (s) => String(s || '').replace(/^"|"$/g, '')

function mergeSpf(current, wanted) {
  // keep every existing mechanism, add the includes MailerSend wants, one "all" at the end
  const parts = (unq(current) || 'v=spf1 ~all').split(/\s+/).filter(Boolean)
  const all = parts.find(p => /^[~\-+?]?all$/.test(p)) || '~all'
  const body = parts.filter(p => p !== 'v=spf1' && !/^[~\-+?]?all$/.test(p))
  for (const inc of unq(wanted).split(/\s+/).filter(p => /^include:/.test(p))) if (!body.includes(inc)) body.push(inc)
  return ['v=spf1', ...body, all].join(' ')
}

;(async () => {
  const d = (await ms.get('/domains?limit=100')).data.data.find(x => x.name === domain)
  if (!d) throw new Error(`${domain} is not added in MailerSend (Email → Domains → Add domain)`)
  const need = (await ms.get(`/domains/${d.id}/dns-records`)).data.data
  const zone = (await cf.get('/zones', { params: { name: domain } })).data.result[0]
  if (!zone) throw new Error(`${domain} is not a zone in this Cloudflare account`)
  const recs = (await cf.get(`/zones/${zone.id}/dns_records`, { params: { per_page: 500 } })).data.result

  const plan = []
  // SPF (TXT at apex)
  if (need.spf?.value) {
    const cur = recs.find(r => r.type === 'TXT' && r.name === domain && /^"?v=spf1/i.test(r.content))
    const next = mergeSpf(cur?.content, need.spf.value)
    if (!cur) plan.push({ op: 'create', type: 'TXT', name: domain, content: next })
    else if (unq(cur.content) !== next) plan.push({ op: 'update', id: cur.id, type: 'TXT', name: domain, content: next, was: unq(cur.content) })
  }
  // DKIM ms1/ms2 + return-path (CNAMEs)
  for (const k of ['dkim_ms1', 'dkim_ms2', 'return_path']) {
    const r = need[k]
    if (!r?.hostname || !r.value) continue
    const cur = recs.find(x => x.name === r.hostname && (x.type === 'CNAME' || x.type === 'TXT' || x.type === 'A'))
    if (!cur) plan.push({ op: 'create', type: 'CNAME', name: r.hostname, content: r.value })
    else if (cur.type !== 'CNAME' || cur.content !== r.value || cur.proxied) plan.push({ op: 'update', id: cur.id, type: 'CNAME', name: r.hostname, content: r.value, was: `${cur.type} ${cur.content}${cur.proxied ? ' (proxied)' : ''}` })
  }

  console.log(`MailerSend domain ${domain}: verified=${d.is_verified} dkim=${d.dkim} spf=${d.spf} return_path=${d.tracking}`)
  if (!plan.length) console.log('DNS already has every record MailerSend needs.')
  for (const p of plan) console.log(`${apply ? 'APPLY' : 'PLAN '} ${p.op.padEnd(6)} ${p.type.padEnd(5)} ${p.name} → ${p.content}${p.was ? `   (was: ${p.was})` : ''}`)
  if (!apply) { if (plan.length) console.log('\nRun again with --apply to write these records.'); return }

  for (const p of plan) {
    const body = { type: p.type, name: p.name, content: p.content, ttl: 1, ...(p.type === 'CNAME' ? { proxied: false } : {}) }
    if (p.op === 'create') await cf.post(`/zones/${zone.id}/dns_records`, body)
    else await cf.put(`/zones/${zone.id}/dns_records/${p.id}`, body)
  }
  console.log('Records written. Asking MailerSend to verify (DNS can take a few minutes)…')
  const v = (await ms.get(`/domains/${d.id}/verify`)).data
  console.log('verify:', JSON.stringify(v.data || v))
})().catch(e => { console.error('ERROR', e.response?.status || '', JSON.stringify(e.response?.data?.errors || e.response?.data?.message || e.message)); process.exit(1) })
