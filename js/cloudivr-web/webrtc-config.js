'use strict'
// Browser-phone WebRTC settings: the Kamailio WSS address + ICE (STUN/TURN) servers.
// TURN uses coturn's time-limited REST credentials (RFC 5766 / "use-auth-secret"),
// so the browser gets a short-lived username/password derived from a shared secret — the real secret never leaves the server.
const crypto = require('crypto')

// e.g. "wss://sip.cloudivr.net:8443" — only when the SIP server has the WSS gateway enabled.
const wssUrl = () => process.env.SIP_WSS_URL || ''
const turnHost = () => process.env.TURN_HOST || (wssUrl() ? new URL(wssUrl()).hostname : '')
const turnSecret = () => process.env.TURN_SHARED_SECRET || ''

// A credential valid for `ttl` seconds. username = "<expiry-unix>:<label>", password = base64(HMAC-SHA1(secret, username)).
function turnCredential(label = 'cloudivr', ttl = 3600) {
  const secret = turnSecret()
  if (!secret || !turnHost()) return null
  const username = `${Math.floor(Date.now() / 1000) + ttl}:${label}`
  const password = crypto.createHmac('sha1', secret).update(username).digest('base64')
  return { username, password }
}

// Full ICE server list for the browser (STUN + TURN over UDP and TLS), or just public STUN if TURN isn't configured.
function iceServers(label) {
  const host = turnHost()
  if (!host) return [{ urls: 'stun:stun.l.google.com:19302' }]
  const cred = turnCredential(label)
  const list = [{ urls: `stun:${host}:3478` }]
  if (cred) {
    list.push({ urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`], username: cred.username, credential: cred.password })
    list.push({ urls: `turns:${host}:5349?transport=tcp`, username: cred.username, credential: cred.password })
  }
  return list
}

// What the browser phone needs to register over WSS and route calls through our engine → Bird.
// Returns null when the WSS gateway isn't enabled (caller then keeps the legacy hosted-WebRTC path).
function browserWebrtc(label) {
  const wss = wssUrl()
  if (!wss) return null
  return { wss, iceServers: iceServers(label) }
}

module.exports = { wssUrl, browserWebrtc, iceServers, turnCredential }
