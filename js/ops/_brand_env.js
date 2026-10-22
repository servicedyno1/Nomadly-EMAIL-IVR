// Ops helper: load a production brand's backend.env from the Nomadly droplet over SSH
// INTO MEMORY ONLY (never written to disk). Requires DROPLET_IP / DROPLET_SSH_USER /
// DROPLET_SSH_KEY_B64 in /app/backend/.env (vault).
//
// Brands (droplet dirs): app-main (Nomadly), app-proshop, app-voodoo, app-wl (Smadav).
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const dotenv = require('dotenv')

const BRANDS = ['app-main', 'app-proshop', 'app-voodoo', 'app-wl']
const LOCAL = dotenv.parse(fs.readFileSync('/app/backend/.env'))

function _keyFile() {
  const p = path.join(os.homedir(), '.ssh', 'nomadly_droplet')
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, Buffer.from(LOCAL.DROPLET_SSH_KEY_B64 || '', 'base64'), { mode: 0o600 })
  }
  return p
}

function loadBrandEnv(brand) {
  if (!BRANDS.includes(brand)) throw new Error(`unknown brand ${brand}`)
  const out = execFileSync('ssh', [
    '-i', _keyFile(), '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=20', '-o', 'BatchMode=yes',
    `${LOCAL.DROPLET_SSH_USER}@${LOCAL.DROPLET_IP}`, `cat /opt/nomadly/shared/${brand}/backend.env`,
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  const env = dotenv.parse(out)
  env.__brand = brand
  return env
}

function parseBrandsArg(argv) {
  const a = argv.find(x => x.startsWith('--brands='))
  if (!a) return BRANDS
  return a.split('=')[1].split(',').map(s => s.trim()).filter(Boolean)
}

const maskPhone = p => String(p || '').replace(/(\+\d{4})\d+(\d{2})$/, '$1xxxx$2')

module.exports = { BRANDS, loadBrandEnv, parseBrandsArg, maskPhone }
