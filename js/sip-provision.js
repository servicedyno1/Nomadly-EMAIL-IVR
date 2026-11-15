// One-tap softphone setup: a 15-minute link Linphone reads from a QR code, plus a plain SIP address for other apps.
const crypto = require('crypto')
const TTL_MS = 15 * 60 * 1000

const xml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const login = (n) => ({ user: n.telnyxSipUsername || n.sipUsername, pass: n.telnyxSipUsername ? (n.telnyxSipPassword || n.sipPassword) : n.sipPassword })

let indexed = false
async function mint(db, chatId, phone, domain) {
  const col = db.collection('sipProvision')
  if (!indexed) { indexed = true; col.createIndex({ exp: 1 }, { expireAfterSeconds: 0 }).catch(() => {}) }
  const _id = crypto.randomBytes(18).toString('base64url')
  await col.insertOne({ _id, chatId: String(chatId), phone, domain, exp: new Date(Date.now() + TTL_MS) })
  return _id
}

function linphoneXml(n, domain) {
  const { user, pass } = login(n)
  return `<?xml version="1.0" encoding="UTF-8"?>
<config xmlns="http://www.linphone.org/xsds/lpconfig.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.linphone.org/xsds/lpconfig.xsd lpconfig.xsd">
  <section name="proxy_0">
    <entry name="reg_proxy">${xml(`<sip:${domain};transport=udp>`)}</entry>
    <entry name="reg_identity">${xml(`"${n.phoneNumber}" <sip:${user}@${domain}>`)}</entry>
    <entry name="realm">${xml(domain)}</entry>
    <entry name="reg_expires">600</entry>
    <entry name="reg_sendregister">1</entry>
    <entry name="publish">0</entry>
  </section>
  <section name="auth_info_0">
    <entry name="username">${xml(user)}</entry>
    <entry name="passwd">${xml(pass)}</entry>
    <entry name="realm">${xml(domain)}</entry>
    <entry name="domain">${xml(domain)}</entry>
  </section>
</config>
`
}

// Returns the XML for a live token, or null (unknown, expired, number gone).
async function render(db, token) {
  const t = await db.collection('sipProvision').findOne({ _id: String(token || '') })
  if (!t || t.exp < new Date()) return null
  const doc = await db.collection('phoneNumbersOf').findOne({ _id: /^\d+$/.test(t.chatId) ? Number(t.chatId) : t.chatId }) || await db.collection('phoneNumbersOf').findOne({ _id: t.chatId })
  const n = (doc?.val?.numbers || []).find(x => x.phoneNumber === t.phone && x.status === 'active')
  if (!n || !login(n).user || !login(n).pass) return null
  return linphoneXml(n, t.domain)
}

const generic = (n, domain) => { const { user, pass } = login(n); return `sip:${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${domain}:5060` }
const linkFor = (token) => `${String(process.env.SELF_URL || '').replace(/\/$/, '')}/sip-provision/${token}`

async function codes(db, chatId, n, domain) {
  return { linphone: linkFor(await mint(db, chatId, n.phoneNumber, domain)), generic: generic(n, domain), expiresInMin: TTL_MS / 60000 }
}

module.exports = { mint, render, codes, linphoneXml, generic, TTL_MS }
