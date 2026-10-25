// Checks TELNYX_PUBLIC_KEY (backend/.env) against real signed Telnyx webhooks captured in the webhook.site bin. Prints counts only.
const fs = require('fs')
const env = Object.fromEntries(fs.readFileSync('/app/backend/.env', 'utf8').split('\n').map(l => l.match(/^([A-Z0-9_]+)="?([^"]*)"?$/)).filter(Boolean).map(m => [m[1], m[2]]))
const V = require('/app/js/telnyx-webhook-verify')
const state = JSON.parse(fs.readFileSync(__dirname + '/run/state.json', 'utf8'))
;(async () => {
  const key = V.keyFrom(env.TELNYX_PUBLIC_KEY)
  const r = await fetch(`https://webhook.site/token/${state.bin}/requests?per_page=50&sorting=newest`, { headers: { Accept: 'application/json' } })
  const reqs = (await r.json()).data || []
  let ok = 0, bad = 0
  for (const q of reqs) {
    const h = Object.fromEntries(Object.entries(q.headers || {}).map(([k, v]) => [k.toLowerCase(), Array.isArray(v) ? v[0] : v]))
    const ts = Number(h['telnyx-timestamp'])
    const good = V.verify({ headers: h, rawBody: Buffer.from(q.content || '', 'utf8') }, key, ts * 1000)
    good ? ok++ : bad++
  }
  const forged = V.verify({ headers: { 'telnyx-timestamp': String(Math.floor(Date.now() / 1000)), 'telnyx-signature-ed25519': Buffer.alloc(64).toString('base64') }, rawBody: Buffer.from('{}') }, key)
  console.log(JSON.stringify({ captured: reqs.length, valid: ok, invalid: bad, forgedAccepted: forged }))
})().catch(e => { console.log('ERROR', e.message); process.exit(1) })
