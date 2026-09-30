#!/usr/bin/env node
// READ-ONLY: fetch the prod DO-RDP server record + vpsPlansOf for the confirmation order.
// Confirms credentials to share + gathers callback diagnostics.
const fs = require('fs')
const { MongoClient } = require('mongodb')
const url = fs.readFileSync('/app/backend/.env', 'utf8').match(/ORIGINAL_PROD_MONGO_URL\s*=\s*"?([^"\n]+)"?/)[1].trim()

const VPS_ID = '3bc97ea9-8411-4c28-8365-d6979f07332c'
const SERVER_UUID = 'c05c84be-638c-45a6-9ab9-3763ca698597'
const DROPLET_ID = 603051404
const IP = '68.183.146.200'

;(async () => {
  const c = new MongoClient(url, { serverSelectionTimeoutMS: 15000 }); await c.connect()
  const db = c.db('test')

  const rdp = await db.collection('doRdpServers').findOne({ $or: [
    { server_id: SERVER_UUID }, { _id: SERVER_UUID }, { droplet_id: DROPLET_ID }, { ip: IP },
  ] })
  if (rdp) {
    console.log('=== doRdpServers ===')
    console.log(JSON.stringify({
      _id: rdp._id, server_id: rdp.server_id, droplet_id: rdp.droplet_id, ip: rdp.ip,
      status: rdp.status, os_id: rdp.os_id, admin_username: rdp.admin_username,
      admin_password: rdp.admin_password, rootPassword: rdp.rootPassword,
      callback_token: rdp.callback_token ? rdp.callback_token.slice(0, 8) + '…' : null,
      callback_received_at: rdp.callback_received_at, agent_seen_at: rdp.agent_seen_at,
      password_confirmed: rdp.password_confirmed, activated_at: rdp.activated_at,
      created_at: rdp.created_at, fast_deploy: rdp.fast_deploy, callback_url: rdp.callback_url,
    }, null, 2))
    console.log('logs:', JSON.stringify((rdp.logs || rdp.provision_logs || []).slice(-8)))
  } else { console.log('doRdpServers: NO MATCH') }

  const v = await db.collection('vpsPlansOf').findOne({ _id: VPS_ID })
  if (v) console.log('\n=== vpsPlansOf ===\n', JSON.stringify({
    _id: v._id, status: v.status, host: v.host, osId: v.osId, instanceId: v.instanceId,
    rootPasswordSecretId: v.rootPasswordSecretId,
  }, null, 2))
  await c.close()
})().catch(e => { console.error('ERR:', e.message); process.exit(1) })
