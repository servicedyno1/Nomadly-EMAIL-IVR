// Mask credential values already sitting in PM2 logs (same rules as the live console shim). --apply to write.
const fs = require('fs'), path = require('path')
const { redactSecrets } = require(path.resolve('js/log-redact.js'))
const dir = '/root/.pm2/logs', apply = process.argv.includes('--apply')
let total = 0
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.log'))) {
  const p = path.join(dir, f)
  const src = fs.readFileSync(p, 'utf8')
  let n = 0
  const out = src.split('\n').map(l => { const r = redactSecrets(l); if (r !== l) n++; return r }).join('\n')
  if (!n) continue
  total += n
  console.log(`${f}: ${n} line(s)`)
  if (apply) fs.writeFileSync(p, out) // same inode — PM2 keeps appending
}
console.log(`${apply ? 'masked' : 'would mask'} ${total} line(s)`)
