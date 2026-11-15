'use strict'
// MultiTEL end-user registration profiles (their "registration documents"): one per customer + details, reused for
// every number that needs registration. create_document → { uuid, identity_id, address_id } (not readable later, so
// we keep them), then number_identity/{number} attaches the profile to a bought number for carrier review.
const axios = require('axios')
const crypto = require('crypto')
const { PNG } = require('pngjs')

// 5×7 bitmap font (columns, LSB = top row) for typed-name signatures.
const F = {
  ' ': [0, 0, 0, 0, 0], '.': [0, 0x60, 0x60, 0, 0], ',': [0, 0x50, 0x30, 0, 0], '-': [8, 8, 8, 8, 8], "'": [0, 5, 3, 0, 0], '&': [0x36, 0x49, 0x55, 0x22, 0x50],
  0: [0x3e, 0x51, 0x49, 0x45, 0x3e], 1: [0, 0x42, 0x7f, 0x40, 0], 2: [0x42, 0x61, 0x51, 0x49, 0x46], 3: [0x21, 0x41, 0x45, 0x4b, 0x31], 4: [0x18, 0x14, 0x12, 0x7f, 0x10],
  5: [0x27, 0x45, 0x45, 0x45, 0x39], 6: [0x3c, 0x4a, 0x49, 0x49, 0x30], 7: [1, 0x71, 9, 5, 3], 8: [0x36, 0x49, 0x49, 0x49, 0x36], 9: [6, 0x49, 0x49, 0x29, 0x1e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e], B: [0x7f, 0x49, 0x49, 0x49, 0x36], C: [0x3e, 0x41, 0x41, 0x41, 0x22], D: [0x7f, 0x41, 0x41, 0x22, 0x1c], E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 9, 9, 9, 1], G: [0x3e, 0x41, 0x49, 0x49, 0x7a], H: [0x7f, 8, 8, 8, 0x7f], I: [0, 0x41, 0x7f, 0x41, 0], J: [0x20, 0x40, 0x41, 0x3f, 1],
  K: [0x7f, 8, 0x14, 0x22, 0x41], L: [0x7f, 0x40, 0x40, 0x40, 0x40], M: [0x7f, 2, 0xc, 2, 0x7f], N: [0x7f, 4, 8, 0x10, 0x7f], O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 9, 9, 9, 6], Q: [0x3e, 0x41, 0x51, 0x21, 0x5e], R: [0x7f, 9, 0x19, 0x29, 0x46], S: [0x46, 0x49, 0x49, 0x49, 0x31], T: [1, 1, 0x7f, 1, 1],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f], V: [0x1f, 0x20, 0x40, 0x20, 0x1f], W: [0x3f, 0x40, 0x38, 0x40, 0x3f], X: [0x63, 0x14, 8, 0x14, 0x63], Y: [7, 8, 0x70, 8, 7], Z: [0x61, 0x51, 0x49, 0x45, 0x43],
  a: [0x20, 0x54, 0x54, 0x54, 0x78], b: [0x7f, 0x48, 0x44, 0x44, 0x38], c: [0x38, 0x44, 0x44, 0x44, 0x20], d: [0x38, 0x44, 0x44, 0x48, 0x7f], e: [0x38, 0x54, 0x54, 0x54, 0x18],
  f: [8, 0x7e, 9, 1, 2], g: [0x0c, 0x52, 0x52, 0x52, 0x3e], h: [0x7f, 8, 4, 4, 0x78], i: [0, 0x44, 0x7d, 0x40, 0], j: [0x20, 0x40, 0x44, 0x3d, 0],
  k: [0x7f, 0x10, 0x28, 0x44, 0], l: [0, 0x41, 0x7f, 0x40, 0], m: [0x7c, 4, 0x18, 4, 0x78], n: [0x7c, 8, 4, 4, 0x78], o: [0x38, 0x44, 0x44, 0x44, 0x38],
  p: [0x7c, 0x14, 0x14, 0x14, 8], q: [8, 0x14, 0x14, 0x18, 0x7c], r: [0x7c, 8, 4, 4, 8], s: [0x48, 0x54, 0x54, 0x54, 0x20], t: [4, 0x3f, 0x44, 0x40, 0x20],
  u: [0x3c, 0x40, 0x40, 0x20, 0x7c], v: [0x1c, 0x20, 0x40, 0x20, 0x1c], w: [0x3c, 0x40, 0x30, 0x40, 0x3c], x: [0x44, 0x28, 0x10, 0x28, 0x44], y: [0x0c, 0x50, 0x50, 0x50, 0x3c], z: [0x44, 0x64, 0x54, 0x4c, 0x44],
}
const latin = (s) => String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').split('').filter(c => F[c]).join('').replace(/\s+/g, ' ').trim()

// Typed name → slanted ink-blue PNG (base64) used as the signature image the customer consented to.
function signaturePng(name) {
  const text = latin(name).slice(0, 40) || 'Signed'
  const S = 4, slant = 0.25, padX = 16, padY = 12
  const w = padX * 2 + text.length * 6 * S + Math.ceil(7 * S * slant), h = padY * 2 + 7 * S + 6
  const png = new PNG({ width: w, height: h })
  png.data.fill(255)
  const dot = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 4; png.data[i] = 20; png.data[i + 1] = 40; png.data[i + 2] = 120 }
  ;[...text].forEach((ch, ci) => F[ch].forEach((col, cx) => { for (let ry = 0; ry < 7; ry++) if (col >> ry & 1) for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) { const y = padY + ry * S + dy; dot(Math.round(padX + (ci * 6 + cx) * S + dx + (7 * S - (y - padY)) * slant), y) } }))
  for (let x = padX; x < w - padX; x++) dot(x, h - 6)
  return PNG.sync.write(png).toString('base64')
}

const mtCall = (method, path, data, headers = {}) => {
  const mt = require('./index')
  if (mt.isBlocked()) throw new Error('MultiTEL access is paused')
  return axios({ method, url: `https://api.multitel.net/v3/${path}`, auth: { username: process.env.MULTITEL_USERNAME, password: process.env.MULTITEL_PASSWORD }, httpsAgent: mt.ipv4, headers: { Accept: 'application/json', ...headers }, data, timeout: 60000, maxBodyLength: Infinity, validateStatus: () => true })
    .then(r => { if (r.status === 401) throw new Error('MultiTEL auth refused (401)'); return r.data || {} })
}
const okd = (d) => String(d?.status?.code) === '200'

// files: [{ buffer, name, type }] → encrypted-file uuids (valid 20 min — use straight away).
async function uploadFiles(files) {
  if (!files?.length) return []
  const boundary = `----civr${crypto.randomBytes(8).toString('hex')}`
  const parts = files.slice(0, 5).map(f => Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files[]"; filename="${String(f.name || 'document').replace(/"/g, '')}"\r\nContent-Type: ${f.type || 'application/octet-stream'}\r\n\r\n`), f.buffer, Buffer.from('\r\n')]))
  const d = await mtCall('post', 'create_encrypt_files', Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]), { 'Content-Type': `multipart/form-data; boundary=${boundary}` })
  if (!okd(d)) throw new Error(`MultiTEL file upload: ${d?.status?.msg || 'failed'}`)
  const r = d.response
  return [].concat(Array.isArray(r) ? r : r?.uuids || r?.files || [r]).map(x => (typeof x === 'string' ? x : x?.uuid)).filter(Boolean)
}

// p: { type: personal|business, firstName, lastName, companyName, regNumber, vatId, phone, address, city, postalCode, countryCode, nationality, signature(base64) }
function payload(p, idFiles, addrFiles) {
  return {
    identity_type: p.type === 'business' ? 'Business' : 'Personal', first_name: p.firstName, last_name: p.lastName || p.firstName,
    phone_number: String(p.phone || '').replace(/\D/g, ''), country: p.countryCode, city: p.city, postal_code: p.postalCode || '0000', address: p.address,
    nationality: p.nationality || p.countryCode, ...(p.email ? { email: p.email } : {}),
    ...(p.type === 'business' ? { company_name: p.companyName, incorporation_country: p.countryCode, ...(p.regNumber ? { company_reg_number: p.regNumber } : {}), ...(p.vatId ? { vat_id: p.vatId } : {}) } : {}),
    ...(idFiles.length ? { identity_encryptfiles: idFiles } : {}), ...(addrFiles.length ? { address_encryptfiles: addrFiles } : {}),
    signature: p.signature,
  }
}
const hashOf = (p, nFiles) => crypto.createHash('sha1').update(JSON.stringify([p.type, p.firstName, p.lastName, p.companyName, p.address, p.city, p.postalCode, p.countryCode, p.nationality, nFiles])).digest('hex').slice(0, 16)

// Reuses the customer's profile when the details (and number of documents) are unchanged, else creates a new one.
async function ensureProfile(db, chatId, p, files = []) {
  const col = db.collection('providerProfiles')
  const id = `multitel:${chatId}:${hashOf(p, files.length)}`
  const have = await col.findOne({ _id: id })
  if (have?.identityId) return have
  const uuids = await uploadFiles(files)
  const d = await mtCall('post', 'create_document', payload(p, uuids, uuids))
  if (!okd(d) || !d.response?.identity_id) throw new Error(`MultiTEL profile: ${d?.status?.msg || 'not created'}`)
  const doc = { _id: id, provider: 'multitel', chatId: String(chatId), uuid: d.response.uuid, identityId: d.response.identity_id, addressId: d.response.address_id, type: p.type, name: p.companyName || `${p.firstName} ${p.lastName}`.trim(), countryCode: p.countryCode, files: uuids.length, createdAt: new Date() }
  await col.insertOne(doc)
  return doc
}

async function attach(phoneNumber, prof) {
  const num = String(phoneNumber).replace(/\D/g, '')
  const d = await mtCall('post', `number_identity/${num}`, { identity_id: prof.identityId, address_id: prof.addressId, number: num })
  if (!okd(d)) throw new Error(`MultiTEL registration for ${phoneNumber}: ${d?.status?.msg || 'refused'}`)
  return { status: d.response?.verification_status || 'pending', id: d.response?.address_verification_id || null }
}

// Profile + attach for one bought number. Returns { via: 'api', profile } or throws (callers fall back to email).
async function registerNumber(db, { chatId, phoneNumber, person, files = [] }) {
  if (!person?.signature) throw new Error('no signature on file')
  const prof = await ensureProfile(db, chatId, person, files)
  const r = await attach(phoneNumber, prof)
  await db.collection('providerProfiles').updateOne({ _id: prof._id }, { $addToSet: { numbers: phoneNumber }, $set: { lastUsedAt: new Date() } })
  return { via: 'api', profile: prof._id, verification: r }
}

// Customer details from a web legal profile (structured address) + their saved signature.
function personFromLegal(acc) {
  const lp = acc?.legalProfile, a = lp?.address || {}
  if (!lp?.completedAt) return null
  const [firstName, ...rest] = String(lp.fullName || lp.companyName || '').trim().split(/\s+/)
  return {
    type: lp.type === 'business' ? 'business' : 'personal', firstName, lastName: rest.join(' ') || firstName, companyName: lp.companyName || '', regNumber: lp.registrationNumber || '', vatId: lp.vatNumber || '',
    phone: acc.phone || lp.phone || '', email: acc.email || '', address: [a.line1, a.line2].filter(Boolean).join(', '), city: a.city, postalCode: a.postalCode, countryCode: a.countryCode,
    nationality: lp.nationality || a.countryCode, signature: lp.signature?.png || (lp.signature?.typedName ? signaturePng(lp.signature.typedName) : null),
  }
}

module.exports = { signaturePng, uploadFiles, ensureProfile, attach, registerNumber, personFromLegal, latin }
