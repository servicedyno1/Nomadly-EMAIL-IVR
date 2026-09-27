#!/usr/bin/env node
require("../log-redact.js").installConsoleRedaction()
// ============================================================
// DigitalOcean Windows-RDP preflight probe  (js/ops/rdp_do_preflight.js)
// ------------------------------------------------------------
// Boots ONE throw-away Ubuntu droplet of the golden BUILD_SIZE, and from inside
// it reports back (via the normal /provision/callback endpoint of the running
// bot) the facts the golden-image pipeline depends on:
//   • /dev/kvm + vmx/svm flags   → can QEMU/KVM install Windows here?
//   • does the platform answer DHCP on the public NIC?  (how Windows gets its IP)
//   • is 169.254.169.254 reachable link-local (APIPA-style) and/or via gateway?
// Then destroys the droplet. Cost ≈ one billed hour of the probe size (~$0.10).
//
//   node js/ops/rdp_do_preflight.js [--size gd-2vcpu-8gb] [--region nyc3]
// ============================================================
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env') })
const axios = require('axios')
const crypto = require('crypto')
const { MongoClient } = require('mongodb')

function arg(name, def) { const i = process.argv.indexOf(`--${name}`); return i === -1 ? def : (process.argv[i + 1] || def) }
const SIZE = arg('size', process.env.DO_RDP_BUILD_SIZE || 'gd-2vcpu-8gb')
const REGION = arg('region', process.env.DO_RDP_BUILD_REGION || 'nyc3')
const TOKEN = process.env.DIGITALOCEAN_API_TOKEN
const BASE = String(process.env.SELF_URL || '').replace(/\/+$/, '')
if (!TOKEN || !BASE || !process.env.MONGO_URL) { console.error('need DIGITALOCEAN_API_TOKEN, SELF_URL, MONGO_URL in backend/.env'); process.exit(1) }

const doApi = async (method, p, data) => {
  const r = await axios({ method, url: `https://api.digitalocean.com/v2${p}`, headers: { Authorization: `Bearer ${TOKEN}` }, data, timeout: 60000, validateStatus: () => true })
  if (r.status >= 400) throw new Error(`DO ${method} ${p} → ${r.status} ${JSON.stringify(r.data).slice(0, 300)}`)
  return r.data || {}
}

function userData(id, token) {
  return `#!/bin/bash
CB="${BASE}/provision/callback"; TOKEN="${token}"; ID="${id}"
report(){ curl -s -m 20 -X POST "$CB" -H 'Content-Type: application/json' -d "$(python3 -c 'import json,sys; print(json.dumps({"server_id":sys.argv[1],"token":sys.argv[2],"stage":sys.argv[3],"message":sys.argv[4][:1500]}))' "$ID" "$TOKEN" "$1" "$2")" >/dev/null 2>&1 || true; }
report boot "$(uname -r) $(lsb_release -ds 2>/dev/null) size=$(curl -s -m 5 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address)"
KVM=$([ -e /dev/kvm ] && echo yes || echo no); FLAGS=$(grep -c -E 'vmx|svm' /proc/cpuinfo); CPU=$(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs)
report kvm "dev_kvm=$KVM vmx_svm_cpus=$FLAGS nproc=$(nproc) mem_mb=$(awk '/MemTotal/{printf "%d",$2/1024}' /proc/meminfo) disk=$(lsblk -ndo NAME,SIZE,TYPE | awk '$3=="disk"{print $1":"$2}' | tr '\\n' ' ') cpu=[$CPU]"
IFACE=$(ip route | awk '/default/{print $5; exit}'); GW=$(ip route | awk '/default/{print $3; exit}')
report route "iface=$IFACE gw=$GW metadata_route=[$(ip route get 169.254.169.254 2>&1 | head -1)]"
report netplan "$(cat /etc/netplan/*.yaml 2>/dev/null | tr '\\n' ' ' | tr -s ' ')"
which dhclient >/dev/null 2>&1 || (apt-get update -y >/dev/null 2>&1; apt-get install -y -q isc-dhcp-client >/dev/null 2>&1)
OUT=$(timeout 30 dhclient -d -v -1 -sf /bin/true "$IFACE" 2>&1 | grep -E 'DHCPOFFER|DHCPACK|DHCPDISCOVER|No DHCPOFFERS|Timed out|bound to' | head -6 | tr '\\n' ' ')
report dhcp "platform DHCP on $IFACE → [$OUT]"
ip addr add 169.254.77.77/16 dev "$IFACE" 2>/dev/null
ip route replace 169.254.169.254/32 dev "$IFACE" src 169.254.77.77
LL=$(curl -s -m 6 http://169.254.169.254/metadata/v1/id 2>&1 || echo FAIL)
report linklocal "metadata via link-local APIPA-style route → [$LL]"
ip route replace 169.254.169.254/32 via "$GW" dev "$IFACE" 2>/dev/null || ip route del 169.254.169.254/32 2>/dev/null
ip addr del 169.254.77.77/16 dev "$IFACE" 2>/dev/null
VIA=$(curl -s -m 6 http://169.254.169.254/metadata/v1/id 2>&1 || echo FAIL)
report viagw "metadata via gateway/default route → [$VIA]; user-data head → [$(curl -s -m 6 http://169.254.169.254/metadata/v1/user-data | head -c 40 | tr '\\n' ' ')]"
report done "probe complete"
`
}

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const builds = client.db(process.env.DB_NAME || 'test').collection('doRdpImageBuilds')
  const id = `probe-${crypto.randomBytes(4).toString('hex')}`
  const token = crypto.randomBytes(18).toString('base64url')
  await builds.insertOne({ build_id: id, os_id: null, status: 'probe', phase: 'probe', logs: [], callback_token: token, created_at: new Date(), updated_at: new Date() })
  let dropletId = null
  const cleanup = async () => {
    if (dropletId) { try { await doApi('DELETE', `/droplets/${dropletId}`); console.log(`\n🗑  droplet ${dropletId} destroyed`) } catch (e) { console.error(`!! could not delete droplet ${dropletId}: ${e.message}`) } }
    await builds.deleteOne({ build_id: id }).catch(() => {})
    await client.close().catch(() => {})
  }
  process.on('SIGINT', async () => { await cleanup(); process.exit(1) })
  try {
    console.log(`Creating preflight droplet ${SIZE} in ${REGION} (probe ${id})...`)
    const d = (await doApi('POST', '/droplets', { name: `preflight-${id.slice(-8)}`, region: REGION, size: SIZE, image: process.env.DO_UBUNTU_IMAGE || 'ubuntu-22-04-x64', user_data: userData(id, token), tags: ['golden-build', 'preflight'] })).droplet
    dropletId = d.id
    console.log(`droplet ${dropletId} created — waiting for callbacks (max 8 min)...`)
    const started = Date.now(); let seen = 0; let done = false
    while (Date.now() - started < 8 * 60000 && !done) {
      await new Promise(r => setTimeout(r, 5000))
      const doc = await builds.findOne({ build_id: id })
      const logs = (doc && doc.logs) || []
      for (const l of logs.slice(seen)) { console.log(`  [${new Date(l.ts).toISOString().slice(11, 19)}] ${l.stage.padEnd(17)} ${l.message}`); if (l.stage === 'droplet:done') done = true }
      seen = logs.length
    }
    if (!done) console.log('!! probe did not finish in time (see partial results above)')
  } catch (e) { console.error('ERROR:', e.message) }
  await cleanup()
})()
