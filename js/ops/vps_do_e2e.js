#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
// Linux VPS deploy E2E on DigitalOcean (same digitalocean-service.js the bots use).
// Creates a small droplet -> waits active + public IP -> checks SSH:22 reachable -> destroys.
// Billable ~a few cents; self-destroys on completion or SIGINT/SIGTERM. Uses local Mongo/env.
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
const net = require('net')
const crypto = require('crypto')
const axios = require('axios')

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i === -1 ? def : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true) }
const SIZE = String(arg('size', 's-1vcpu-1gb'))
const REGION = String(arg('region', 'US-east'))
const OS = String(arg('os', 'ubuntu-24-04-x64'))
const WAIT_MIN = Number(arg('wait-min', 8))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ts = () => new Date().toISOString().slice(11, 19)

const svc = require('../digitalocean-service.js')
const DO_TOKEN = process.env.DIGITALOCEAN_API_TOKEN
const doDelete = async id => axios.delete(`https://api.digitalocean.com/v2/droplets/${id}`, { headers: { Authorization: `Bearer ${DO_TOKEN}` }, validateStatus: () => true })

function checkPort(host, port, timeout = 5000) {
  return new Promise(res => {
    const s = new net.Socket()
    let done = false
    const finish = ok => { if (done) return; done = true; try { s.destroy() } catch {} ; res(ok) }
    s.setTimeout(timeout)
    s.once('connect', () => finish(true))
    s.once('timeout', () => finish(false))
    s.once('error', () => finish(false))
    s.connect(port, host)
  })
}

;(async () => {
  const pw = 'Vps!' + crypto.randomBytes(9).toString('base64').replace(/[^a-zA-Z0-9]/g, '') + '7x'
  console.log(`[${ts()}] createInstance size=${SIZE} region=${REGION} os=${OS}`)
  const t0 = Date.now()
  const inst = await svc.createInstance({ productId: SIZE, regionSlug: REGION, osId: OS, label: 'vps-deploy-e2e', password: pw, tag: 'vps-e2e-test' })
  const rawId = inst.instanceId
  const numId = String(rawId).replace(/^do-/, '')
  console.log(`[${ts()}] created instanceId=${rawId} status=${inst.status} providerStatus=${inst.providerStatus}`)
  let cleaned = false
  const cleanup = async (why) => {
    if (cleaned) return; cleaned = true
    try { await svc.cancelInstance(rawId) } catch {}
    const chk = await doDelete(numId) // belt & suspenders
    console.log(`[${ts()}] cleanup (${why}) -> destroy issued (verify http ${chk.status})`)
  }
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => cleanup(sig).then(() => process.exit(1)))

  let ip = null, status = inst.status
  try {
    // 1) wait active + public IP
    while (Date.now() - t0 < WAIT_MIN * 60000) {
      await sleep(8000)
      const g = await svc.getInstance(rawId)
      if (!g) { console.log(`[${ts()}] getInstance null`); continue }
      status = g.status; ip = g.mainIp
      console.log(`[${ts()}] +${Math.round((Date.now() - t0) / 1000)}s status=${g.status} providerStatus=${g.providerStatus} ip=${ip || '-'} size=${g.plan} region=${g.region}`)
      // DO "active" is mapped to canonical "running"; accept either as up.
      if ((g.status === 'running' || g.status === 'active' || g.providerStatus === 'active') && ip) break
    }
    const isUp = (status === 'running' || status === 'active')
    if (!(isUp && ip)) throw new Error(`droplet not active with IP within ${WAIT_MIN}min (status=${status})`)

    // 2) SSH port reachable (cloud-init/sshd may take another ~30-90s after active)
    let sshOk = false
    const sshDeadline = Date.now() + 3 * 60000
    while (Date.now() < sshDeadline) {
      sshOk = await checkPort(ip, 22, 5000)
      console.log(`[${ts()}] SSH ${ip}:22 -> ${sshOk ? 'OPEN' : 'not yet'}`)
      if (sshOk) break
      await sleep(12000)
    }
    const secs = Math.round((Date.now() - t0) / 1000)
    console.log(`\n[${ts()}] RESULT: ${isUp && ip && sshOk ? 'PASS' : 'FAIL'} — droplet active in ${(secs / 60).toFixed(1)}min, ip=${ip}, ssh:22=${sshOk ? 'open' : 'CLOSED'}`)
    await cleanup('done')
    process.exit(isUp && ip && sshOk ? 0 : 1)
  } catch (e) {
    console.log(`[${ts()}] ERROR: ${e.message}`)
    await cleanup('error')
    process.exit(1)
  }
})().catch(e => { console.error('FATAL', e.message); process.exit(1) })
