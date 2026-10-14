/* global process, require, console */
// READ-ONLY: is the password "Show Password" would reveal the one the RDP box actually got?
// Compares (hashes only, never prints passwords) the secret behind vpsPlansOf.rootPasswordSecretId with the
// server-id secret, plus password_confirmed / set_password command history / boot-script stages.
//   node rdp_password_audit_2026-10.js <backend.env>
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const env = {}
for (const line of fs.readFileSync(process.argv[2], 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) { let v = m[2].trim(); if (/^(".*"|'.*')$/.test(v)) v = v.slice(1, -1); env[m[1]] = v }
}
const { MongoClient } = require(path.join(process.cwd(), 'node_modules', 'mongodb'))
const h = (v) => (v ? crypto.createHash('sha256').update(String(v)).digest('hex').slice(0, 8) : null)
;(async () => {
  const c = new MongoClient(env.MONGO_URL); await c.connect()
  const db = c.db(env.DB_NAME)
  const secrets = db.collection('vpsPasswordSecrets')
  const get = async (id) => (id ? (await secrets.findOne({ _id: id }))?.password || null : null)
  const servers = await db.collection('doRdpServers').find({}).sort({ created_at: -1 }).toArray()
  console.log('DB', env.DB_NAME, 'servers', servers.length)
  for (const s of servers) {
    const sid = s.server_id
    const plan = await db.collection('vpsPlansOf').findOne({ $or: [{ contaboInstanceId: `rdp-${sid}` }, { instanceId: `rdp-${sid}` }, { vpsId: `rdp-${sid}` }] })
    const planSecret = plan ? await get(plan.rootPasswordSecretId) : null
    const serverSecret = await get(sid)
    const stages = (s.logs || []).map(l => l.stage).filter(st => /password|rdp_ready|reinstall|rdp_up/.test(st))
    console.log(JSON.stringify({
      sid: sid.slice(0, 8), status: s.status, created: s.created_at, fast: s.fast_deploy, golden: s.golden_image_id || null,
      chat: plan && plan.chatId, planStatus: plan && plan.status, planSecretId: plan && plan.rootPasswordSecretId,
      planSecret: h(planSecret), serverSecret: h(serverSecret), match: !!planSecret && planSecret === serverSecret,
      password_confirmed: s.password_confirmed, reset_at: s.password_reset_at || null,
      cmds: (s.commands || []).filter(x => x.type === 'set_password').map(x => `${x.status}${x.result ? ':' + String(x.result).slice(0, 60) : ''}`),
      stages: stages.join(','),
    }))
  }
  await c.close()
})().catch(e => { console.error(e); process.exit(1) })
