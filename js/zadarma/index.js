'use strict'
// Zadarma REST client (HMAC-SHA1 signed requests). Docs: https://zadarma.com/en/support/api/
const crypto = require('crypto')
const axios = require('axios')

const enabled = () => !!(process.env.ZADARMA_API_KEY && process.env.ZADARMA_API_SECRET)
const qs = (p) => Object.keys(p).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(p[k])}`.replace(/%20/g, '+')).join('&')

function sign(path, params, secret) {
  const q = qs(params)
  const md5 = crypto.createHash('md5').update(q).digest('hex')
  const hex = crypto.createHmac('sha1', secret).update(path + q + md5).digest('hex')
  return Buffer.from(hex).toString('base64')
}

async function call(method, path, params = {}) {
  const p = path.endsWith('/') ? path : `${path}/`
  const q = qs(params)
  const headers = { Authorization: `${process.env.ZADARMA_API_KEY}:${sign(p, params, process.env.ZADARMA_API_SECRET)}` }
  const url = `https://api.zadarma.com${p}`
  const m = method.toUpperCase()
  const r = await axios({ method: m, url: m === 'GET' || m === 'DELETE' ? `${url}${q ? `?${q}` : ''}` : url, data: m === 'GET' || m === 'DELETE' ? undefined : q, headers: { ...headers, ...(m === 'GET' ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }) }, timeout: 20000, validateStatus: () => true })
  return r.data
}

// Webhook signature check (NOTIFY_* events): base64(hmac_sha1(fields joined, secret)).
const verifyWebhook = (fieldsJoined, signature) => {
  const hex = Buffer.from(crypto.createHmac('sha1', process.env.ZADARMA_API_SECRET || '').update(fieldsJoined).digest('hex')).toString('base64')
  return hex === signature
}

module.exports = { enabled, call, sign, qs, verifyWebhook }
