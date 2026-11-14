#!/usr/bin/env node
// One-time: the Telnyx SIP trunk all brands' Telnyx numbers point at (TLS + SRTP → our SIP server). Idempotent.
//   node js/ops/telnyx_sip_setup_2026-11.js [--env <backend.env>]
'use strict'
const fs = require('fs')
const i = process.argv.indexOf('--env')
if (i > 0) for (const l of fs.readFileSync(process.argv[i + 1], 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '') }
const txs = require('../telnyx-sip')
const fa = require('../telnyx-fax-account')
const axios = require('axios')
;(async () => {
  const id = await txs.connection({ create: true })
  const h = { headers: { Authorization: `Bearer ${process.env.TELNYX_SIP_API_KEY || process.env.TELNYX_FAX_API_KEY}` } }
  const c = (await axios.get(`${fa.BASE}/fqdn_connections/${id}`, h)).data.data
  const f = (await axios.get(`${fa.BASE}/fqdns`, { ...h, params: { 'filter[connection_id]': id } })).data.data
  console.log(JSON.stringify({ id, name: c.connection_name, active: c.active, transport: c.transport_protocol, media: c.encrypted_media, inbound: c.inbound, fqdns: f.map(x => `${x.fqdn}:${x.port}`) }, null, 1))
})().catch(e => { console.error('ERR', e.response?.data ? JSON.stringify(e.response.data) : e.message); process.exit(1) })
