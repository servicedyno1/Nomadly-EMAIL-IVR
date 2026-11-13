'use strict'
// RTP media for AI agent calls on our own call engine (Asterisk externalMedia → this server, 8 kHz μ-law).
// Each call looks like the Telnyx media WebSocket to the bridge: JSON 'media' / 'mark' / 'clear' frames.
const dgram = require('dgram')
const crypto = require('crypto')
const { EventEmitter } = require('events')

const FRAME = 160 // 20 ms of 8 kHz μ-law
const SILENCE = Buffer.alloc(FRAME, 0xff)
let sock = null
const byPort = new Map() // Asterisk's RTP port → media

const port = () => Number(process.env.AI_RTP_PORT || 41000 + (Number(process.env.PORT || 5000) % 1000))
const host = () => `${String(process.env.AI_RTP_HOST || process.env.DROPLET_PUBLIC_IP || '').trim()}:${port()}`

function socket() {
  if (sock) return sock
  sock = dgram.createSocket('udp4')
  sock.on('message', (m, r) => byPort.get(r.port)?.onRtp(m, r))
  sock.on('error', (e) => console.log('[AIAgent] RTP socket error:', e.message))
  sock.bind(port())
  return sock
}

// μ-law payload of an RTP packet (skips CSRCs and header extension), or null for anything that isn't audio.
function payloadOf(m) {
  if (m.length < 12 || (m[0] >> 6) !== 2) return null
  if ((m[1] & 0x7f) >= 96) return null
  let off = 12 + (m[0] & 0x0f) * 4
  if (m[0] & 0x10) { if (m.length < off + 4) return null; off += 4 + m.readUInt16BE(off + 2) * 4 }
  return off < m.length ? m.subarray(off) : null
}

class RtpMedia extends EventEmitter {
  constructor(remotePort, address) {
    super()
    this.readyState = 1
    this.remotePort = remotePort
    // Send to Asterisk right away (the greeting can't wait for the caller to make a sound); the first packet confirms it.
    this.remote = address ? { address, port: remotePort } : null
    this.q = []
    this.rest = Buffer.alloc(0)
    this.seq = crypto.randomInt(0, 65535)
    this.ts = crypto.randomInt(0, 2 ** 31)
    this.ssrc = crypto.randomInt(1, 2 ** 31)
    this.t0 = Date.now()
    this.sent = 0
    this.rx = 0
    this.tx = 0
    byPort.set(remotePort, this)
    socket()
    this.timer = setInterval(() => this.tick(), 10)
  }

  onRtp(m, r) {
    this.remote = { address: r.address, port: r.port }
    this.rx++
    const p = payloadOf(m)
    if (p) this.emit('message', JSON.stringify({ event: 'media', media: { track: 'inbound', payload: p.toString('base64') } }))
  }

  // Frames from the bridge: audio is queued and played in real time; a mark comes back once the audio before it played.
  send(str) {
    if (this.readyState !== 1) return
    const o = JSON.parse(str)
    if (o.event === 'media' && o.media?.payload) {
      let b = Buffer.concat([this.rest, Buffer.from(o.media.payload, 'base64')])
      for (; b.length >= FRAME; b = b.subarray(FRAME)) this.q.push(b.subarray(0, FRAME))
      this.rest = b
    } else if (o.event === 'clear') { this.q = []; this.rest = Buffer.alloc(0) }
    else if (o.event === 'mark') {
      if (this.rest.length) { this.q.push(Buffer.concat([this.rest, SILENCE.subarray(this.rest.length)])); this.rest = Buffer.alloc(0) }
      this.q.push({ mark: o.mark?.name })
    }
  }

  tick() {
    const due = Math.min(5, Math.floor((Date.now() - this.t0) / 20) - this.sent)
    for (let i = 0; i < due; i++) {
      while (this.q.length && !Buffer.isBuffer(this.q[0])) this.emit('message', JSON.stringify({ event: 'mark', mark: { name: this.q.shift().mark } }))
      this.frame(this.q.length ? this.q.shift() : SILENCE)
    }
  }

  frame(payload) {
    this.sent++
    this.seq = (this.seq + 1) & 0xffff
    this.ts = (this.ts + FRAME) >>> 0
    if (!this.remote) return
    const h = Buffer.alloc(12)
    h[0] = 0x80; h[1] = 0 // PCMU
    h.writeUInt16BE(this.seq, 2); h.writeUInt32BE(this.ts, 4); h.writeUInt32BE(this.ssrc, 8)
    this.tx++
    sock.send(Buffer.concat([h, payload]), this.remote.port, this.remote.address)
  }

  close() {
    if (this.readyState !== 1) return
    this.readyState = 3
    clearInterval(this.timer)
    byPort.delete(this.remotePort)
    console.log(`[AIAgent] RTP ${this.remotePort} closed: ${this.rx} packets in, ${this.tx} out`)
    this.emit('close')
  }
}

const open = (remotePort, address) => new RtpMedia(remotePort, address)

module.exports = { open, host, port, payloadOf, RtpMedia, _byPort: byPort }
