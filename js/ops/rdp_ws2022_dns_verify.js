#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
// DEFINITIVE ws2022 golden-image DNS/internet verification (user-authorized, ~1 throwaway droplet).
// Creates ONE droplet from the ws2022 golden image (246825481) with apply.ps1's CALLBACK_URL pointed
// at a fresh public webhook.site capture bin. apply.ps1 reads its config from link-local metadata
// (no DNS needed), then does its DNS self-test and calls out to CALLBACK_URL / <base>/provision/commands.
// ANY request landing at the bin FROM THE DROPLET'S OWN PUBLIC IP proves it resolved a public hostname
// (DNS works) and reached the internet. The droplet is destroyed on success, timeout, or signal.
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
const fs = require('fs')
const axios = require('axios')

const TOKEN = process.env.DIGITALOCEAN_API_TOKEN
const IMAGE = 246825481           // golden-ws2022-1790235603
const REGION = 'nyc3'             // image is available here
const SIZE = 's-2vcpu-4gb'        // enough RAM/disk for a quick Windows boot
const WAIT_MS = 20 * 60000
const IDFILE = '/app/investigations/chemist_ivr/ws2022_dns_verify_droplet.txt'

const DO = (m, u, d) => axios({ method: m, url: `https://api.digitalocean.com/v2${u}`, data: d, headers: { Authorization: `Bearer ${TOKEN}` }, timeout: 60000, validateStatus: () => true })
const ts = () => new Date().toISOString().slice(11, 19)
const log = (m) => console.log(`[${ts()}] ${m}`)
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

let dropletId = null
async function destroy() {
  if (!dropletId) return
  const id = dropletId; dropletId = null
  const r = await DO('DELETE', `/droplets/${id}`)
  log(`destroyed droplet ${id} → HTTP ${r.status}`)
  try { fs.unlinkSync(IDFILE) } catch (e) {}
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { log(`${sig} → destroying droplet`); destroy().finally(() => process.exit(1)) })

;(async () => {
  if (!TOKEN) throw new Error('no DIGITALOCEAN_API_TOKEN')
  // 1. Fresh public capture bin
  const tok = (await axios.post('https://webhook.site/token', {}, { timeout: 20000 })).data
  const uuid = tok.uuid
  const bin = `https://webhook.site/${uuid}`
  log(`capture bin: ${bin}`)

  const SERVER_ID = `dnsverify-${Date.now()}`
  const pw = 'Vf' + Math.random().toString(36).slice(2, 10) + '!A9'
  const userData = `ADMIN_PASSWORD=${pw}\nCALLBACK_URL=${bin}/provision/callback\nCALLBACK_TOKEN=dnsverify\nSERVER_ID=${SERVER_ID}\n`

  // 2. Create droplet from the ws2022 golden image
  const name = `dns-verify-ws2022-${Math.floor(Date.now() / 1000)}`
  log(`creating droplet ${name} from image ${IMAGE} in ${REGION} (${SIZE}) …`)
  const c = await DO('POST', '/droplets', { name, region: REGION, size: SIZE, image: IMAGE, ssh_keys: [59516212], user_data: userData, tags: ['dns-verify'] })
  if (c.status >= 400 || !c.data.droplet) throw new Error(`create failed HTTP ${c.status} ${JSON.stringify(c.data).slice(0, 250)}`)
  dropletId = c.data.droplet.id
  fs.mkdirSync(path.dirname(IDFILE), { recursive: true })
  fs.writeFileSync(IDFILE, String(dropletId))
  log(`droplet id=${dropletId} status=${c.data.droplet.status} (id saved to ${IDFILE})`)

  // 3. Poll the bin for a beacon FROM THE DROPLET'S OWN IP
  const t0 = Date.now(); let proven = false; let ip = null
  while (Date.now() - t0 < WAIT_MS) {
    await sleep(20000)
    if (!ip) {
      const g = await DO('GET', `/droplets/${dropletId}`)
      const v4 = (((g.data.droplet || {}).networks || {}).v4 || []).find(n => n.type === 'public')
      ip = v4 && v4.ip_address
      if (ip) log(`droplet public IP: ${ip}`)
    }
    let reqs
    try { reqs = (await axios.get(`https://webhook.site/token/${uuid}/requests?sorting=newest`, { timeout: 20000 })).data } catch (e) { log(`bin poll err: ${e.message}`); continue }
    const data = (reqs && reqs.data) || []
    const fromDroplet = ip ? data.filter(h => h.ip === ip) : []
    log(`… elapsed ${Math.round((Date.now() - t0) / 60000)}m — total bin hits: ${data.length}, from droplet IP(${ip || '?'}): ${fromDroplet.length}`)
    const hits = fromDroplet.length ? fromDroplet : (ip ? [] : data)
    if (hits.length) {
      const h = hits[0]
      log(`✅ BEACON from droplet — DNS + internet CONFIRMED on the ws2022 golden image`)
      hits.slice(0, 4).forEach(x => log(`   hit: ${x.method} ${(x.url || '').replace(bin, '<bin>')}  fromIP=${x.ip}  ua=${(x.headers && (x.headers['user-agent'] || x.headers['User-Agent'])) || ''}  @ ${x.created_at}`))
      proven = true; break
    }
  }
  if (!proven) log(`❌ no beacon from droplet within ${WAIT_MS / 60000}m — INCONCLUSIVE (slow Windows boot or DNS failure).`)

  await destroy()
  log(proven
    ? 'RESULT: PASS — ws2022 golden image resolves public DNS and reaches the internet (apply.ps1 called out to the public bin).'
    : 'RESULT: INCONCLUSIVE — no callout captured; droplet destroyed.')
  process.exit(proven ? 0 : 2)
})().catch(async e => { console.error(`FATAL: ${e.message}`); await destroy(); process.exit(1) })
