'use strict'
// Keeps a copy of each uploaded contact file in Emergent Object Storage (reference stored in bsUploads).
const axios = require('axios')
const crypto = require('crypto')

const url = () => `${((process.env.INTEGRATION_PROXY_URL || '').trim() || 'https://integrations.emergentagent.com').replace(/\/$/, '')}/objstore/api/v1/storage`
let key = null
async function init(force) {
  if (key && !force) return key
  const r = await axios.post(`${url()}/init`, { emergent_key: process.env.EMERGENT_LLM_KEY }, { timeout: 30000 })
  key = r.data.storage_key; return key
}
async function put(path, data, contentType) {
  const go = async () => (await axios.put(`${url()}/objects/${path}`, data, { headers: { 'X-Storage-Key': await init(), 'Content-Type': contentType }, timeout: 120000, maxBodyLength: Infinity })).data
  try { return await go() } catch (e) { if (e.response?.status !== 404) throw e; await init(true); return go() }
}
async function get(path) {
  const r = await axios.get(`${url()}/objects/${path}`, { headers: { 'X-Storage-Key': await init() }, responseType: 'arraybuffer', timeout: 60000 })
  return Buffer.from(r.data)
}
// Returns the bsUploads record, or null when storage is not available (the upload still works).
async function saveUpload(db, cid, { name, data }) {
  if (!process.env.EMERGENT_LLM_KEY) return null
  const ext = /\.csv$/i.test(name || '') ? 'csv' : 'txt', type = ext === 'csv' ? 'text/csv' : 'text/plain'
  const r = await put(`cloudivr-bulksms/uploads/${cid.replace(/[^\w-]/g, '_')}/${crypto.randomUUID()}.${ext}`, Buffer.from(data), type)
  const doc = { _id: crypto.randomUUID(), cid, storagePath: r.path, originalName: String(name || `contacts.${ext}`).slice(0, 120), contentType: type, size: r.size, isDeleted: false, createdAt: new Date() }
  await db.collection('bsUploads').insertOne(doc); return doc
}

module.exports = { init, put, get, saveUpload }
