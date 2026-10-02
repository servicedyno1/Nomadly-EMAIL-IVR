#!/usr/bin/env node
// Re-send @morganfreebandzz's RDP credentials + .rdp file to their Telegram chat.
// Delivery of the original (ephemeral comp-vps #2) provision could not be proven in the logs,
// so this re-sends the EXISTING stored password (no reset). Mirrors vp.vpsBoughtSuccess (en).
//   cd /opt/nomadly/current/app-main && NODE_PATH=$PWD/node_modules node ops/resend_rdp_credentials_7706803914.js [--dry]
'use strict'
require('dotenv').config({ path: process.env.ENV_FILE || '/opt/nomadly/shared/app-main/backend.env' })
const { MongoClient } = require('mongodb')

const CHAT = '7706803914'
const SERVER_ID = '60811b81-70e9-47d8-807c-c5dc8616423c' // actually-applied password lives under this key
const SEED_ID = 'pwd-7706803914-1790974380211'
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN_PROD
const DRY = process.argv.includes('--dry')
const CHAT_BOT_NAME = 'NomadlyBot'
const mask = s => (s ? `${String(s)[0]}***${String(s).slice(-1)} (len ${String(s).length})` : '(empty)')

async function main() {
  if (!BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN_PROD missing from env')
  const client = new MongoClient(process.env.MONGO_URL); await client.connect()
  const db = client.db('test')
  const rec = await db.collection('vpsPlansOf').findOne({ chatId: CHAT, isRDP: true })
  if (!rec) throw new Error('no RDP record for this chat')
  const host = rec.host
  const username = rec.defaultUser || 'Administrator'
  const secrets = db.collection('vpsPasswordSecrets')
  const bySrv = (await secrets.findOne({ _id: SERVER_ID }))?.password || null
  const bySeed = (await secrets.findOne({ _id: SEED_ID }))?.password || null
  const password = bySrv || bySeed
  await client.close()

  console.log('host:', host, '| user:', username)
  console.log('pw@serverId:', mask(bySrv), '| pw@seed:', mask(bySeed), '| using:', bySrv ? 'serverId' : (bySeed ? 'seed' : 'NONE'))
  if (!password) throw new Error('no stored password found under serverId or seed — cannot re-send without a reset')
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(String(host))) throw new Error(`host is not a valid IPv4: ${host}`)

  const label = rec.displayName || rec.name || 'Windows RDP'
  const osName = 'Windows Server 2022'
  const credsMsg =
`<strong>🎉 RDP [${label}] is active!</strong>

<strong>🔑 Login Credentials:</strong>
 <strong>• IP:</strong> <code>${host}</code>
 <strong>• OS:</strong> ${osName}
 <strong>• Username:</strong> <code>${username}</code>
 <strong>• Password:</strong> <tg-spoiler><code>${password}</code></tg-spoiler> (tap to reveal & copy)

<strong>🔗 Connect:</strong> 🖥 Remote Desktop (mstsc) → <code>${host}:3389</code>
⚠️ <b>Save your password now</b> — it can't be retrieved later (use "Reset Password" in RDP management if lost).

${CHAT_BOT_NAME}`

  // Build the fast-connect .rdp file via the real service
  const rdpSvc = require('../js/digitalocean-rdp-service')
  const rdpContent = typeof rdpSvc.buildRdpFile === 'function' ? rdpSvc.buildRdpFile(String(host), username) : null
  const rdpCaption = '⚡ <b>Fast-connect file</b> — open this <code>.rdp</code> to launch a pre-tuned session (bitmap cache on, wallpaper/animations off) for the snappiest experience.'

  if (DRY) { console.log('[DRY] would send credsMsg (len', credsMsg.length, ') +', rdpContent ? `.rdp (${rdpContent.length}b)` : 'NO rdp'); return }

  // 1) credentials message
  const r1 = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT, text: credsMsg, parse_mode: 'HTML', disable_web_page_preview: true }),
  }).then(r => r.json())
  console.log('sendMessage ok:', r1.ok, 'message_id:', r1.result?.message_id, r1.ok ? '' : r1.description)

  // 2) .rdp document
  let r2 = { ok: false, description: 'no rdp content' }
  if (rdpContent) {
    const fd = new FormData()
    fd.append('chat_id', CHAT)
    fd.append('caption', rdpCaption)
    fd.append('parse_mode', 'HTML')
    fd.append('document', new Blob([Buffer.from(rdpContent, 'utf8')], { type: 'application/x-rdp' }), `nomadly-rdp-${String(host).replace(/[^0-9.]/g, '')}.rdp`)
    r2 = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendDocument`, { method: 'POST', body: fd }).then(r => r.json())
  }
  console.log('sendDocument ok:', r2.ok, 'message_id:', r2.result?.message_id, r2.ok ? '' : r2.description)
  console.log('DONE — both sends', r1.ok && r2.ok ? 'SUCCEEDED' : 'had a failure')
}
main().catch(e => { console.error('ERROR:', e.message); process.exit(1) })
