// Read-only check of a SIP login over the browser WSS gateway: REGISTER without Contact (asks "who is signed in?").
// usage: node scripts/wss_register_probe.js <wss-url> <domain> <user> <pass>  → prints the final SIP status
const WebSocket = require('ws')
const crypto = require('crypto')
const [wss, domain, user, pass] = process.argv.slice(2)
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')
const rnd = (n) => crypto.randomBytes(n).toString('hex')
const ws = new WebSocket(wss, 'sip')
const callId = rnd(8), tag = rnd(4), uri = `sip:${domain}`
let cseq = 0, authed = false
const send = (auth) => ws.send([
  `REGISTER ${uri} SIP/2.0`, `Via: SIP/2.0/WSS ${rnd(4)}.invalid;branch=z9hG4bK${rnd(6)}`, 'Max-Forwards: 70',
  `From: <sip:${user}@${domain}>;tag=${tag}`, `To: <sip:${user}@${domain}>`, `Call-ID: ${callId}`, `CSeq: ${++cseq} REGISTER`,
  'User-Agent: cloudivr-selftest-wss', ...(auth ? [auth] : []), 'Content-Length: 0', '', ''].join('\r\n'))
const done = (s) => { console.log(`STATUS ${s}`); ws.close(); process.exit(0) }
setTimeout(() => done('timeout'), 10000)
ws.on('open', () => send(null))
ws.on('error', (e) => done(`ws-error ${e.message}`))
ws.on('message', (b) => {
  const t = b.toString(), st = Number((t.match(/^SIP\/2\.0 (\d{3})/) || [])[1] || 0)
  if (!st || st < 200) return
  if ((st === 401 || st === 407) && !authed) {
    const m = t.match(/^(WWW|Proxy)-Authenticate:\s*Digest\s+(.*)$/im)
    const ch = Object.fromEntries([...m[2].matchAll(/(\w+)="?([^",\r\n]+)"?/g)].map(x => [x[1].toLowerCase(), x[2]]))
    authed = true
    const resp = md5(`${md5(`${user}:${ch.realm}:${pass}`)}:${ch.nonce}:${md5(`REGISTER:${uri}`)}`)
    return send(`${m[1] === 'WWW' ? 'Authorization' : 'Proxy-Authorization'}: Digest username="${user}", realm="${ch.realm}", nonce="${ch.nonce}", uri="${uri}", response="${resp}", algorithm=MD5`)
  }
  done(st)
})
