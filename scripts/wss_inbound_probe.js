// Register a WSS softphone (with Contact) and report incoming INVITEs — proves call-in routing to the browser phone.
// usage: node wss_inbound_probe.js <wss> <domain> <user> <passFile> [seconds]
const WebSocket = require('ws'), crypto = require('crypto')
const [wss, domain, user, passFile, secs] = process.argv.slice(2)
const pass = require('fs').readFileSync(passFile, 'utf8').trim()
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')
const rnd = (n) => crypto.randomBytes(n).toString('hex')
const ws = new WebSocket(wss, 'sip')
const host = `${rnd(6)}.invalid`, callId = rnd(8), tag = rnd(4), contact = `<sip:${user}@${host};transport=ws>`
let cseq = 0, authed = false, registered = false
const uri = `sip:${domain}`
const reg = (auth) => { ws.send([`REGISTER ${uri} SIP/2.0`, `Via: SIP/2.0/WSS ${host};branch=z9hG4bK${rnd(6)}`, 'Max-Forwards: 70', `From: <sip:${user}@${domain}>;tag=${tag}`, `To: <sip:${user}@${domain}>`, `Call-ID: ${callId}`, `CSeq: ${++cseq} REGISTER`, `Contact: ${contact};expires=300`, 'User-Agent: cloudivr-inbound-probe', ...(auth ? [auth] : []), 'Content-Length: 0', '', ''].join('\r\n')) }
const end = (m) => { console.log(m); try { ws.close() } catch (_) {} process.exit(0) }
setTimeout(() => end(registered ? 'RESULT: registered, no incoming INVITE within window' : 'RESULT: registration failed'), (Number(secs) || 75) * 1000)
ws.on('open', () => reg(null))
ws.on('error', (e) => end(`ws-error ${e.message}`))
ws.on('message', (b) => {
  const t = b.toString()
  if (/^INVITE /.test(t)) {
    const from = (t.match(/^From:.*$/im) || [''])[0]
    console.log(`>>> INCOMING INVITE  ${from.trim()}`)
    // Reply 180 Ringing then 486 Busy (no media needed — we only prove the call reached the softphone).
    const via = (t.match(/^Via:.*$/im) || [''])[0], f = (t.match(/^From:.*$/im) || [''])[0], to = (t.match(/^To:.*$/im) || [''])[0], ci = (t.match(/^Call-ID:.*$/im) || [''])[0], cs = (t.match(/^CSeq:.*$/im) || [''])[0]
    const hdr = (code, reason) => [`SIP/2.0 ${code} ${reason}`, via, f, `${to};tag=${rnd(3)}`, ci, cs, 'Content-Length: 0', '', ''].join('\r\n')
    ws.send(hdr('180', 'Ringing'))
    setTimeout(() => { ws.send(hdr('486', 'Busy Here')); end('RESULT: CALL-IN REACHED THE SOFTPHONE ✅ (rang, then declined by probe)') }, 4000)
    return
  }
  const st = Number((t.match(/^SIP\/2\.0 (\d{3})/) || [])[1] || 0)
  if (!st) return
  if ((st === 401 || st === 407) && !authed) {
    const m = t.match(/^(WWW|Proxy)-Authenticate:\s*Digest\s+(.*)$/im)
    const ch = Object.fromEntries([...m[2].matchAll(/(\w+)="?([^",\r\n]+)"?/g)].map(x => [x[1].toLowerCase(), x[2]]))
    authed = true
    const resp = md5(`${md5(`${user}:${ch.realm}:${pass}`)}:${ch.nonce}:${md5(`REGISTER:${uri}`)}`)
    return reg(`${m[1] === 'WWW' ? 'Authorization' : 'Proxy-Authorization'}: Digest username="${user}", realm="${ch.realm}", nonce="${ch.nonce}", uri="${uri}", response="${resp}", algorithm=MD5`)
  }
  if (st === 200 && !registered) { registered = true; console.log('RESULT: registered OK — waiting for an incoming call…') }
})
