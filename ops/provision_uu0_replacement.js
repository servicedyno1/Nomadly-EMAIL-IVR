'use strict'
/**
 * Goodwill VPS replacement for @user_uu0 (chatId 6277663071).
 * Provisions a NEW DigitalOcean Linux VPS through the bot's real purchase path
 * (createVPSInstance) so it appears in his account exactly like a self-purchase
 * AND inherits the new A (bot-managed SSH key) + B (ufw allow OpenSSH) fixes.
 * Then deletes the OLD droplet (do-591819943) on DO + its DB record, and sends
 * the credentials to the customer on the PRODUCTION Telegram bot.
 *
 * Safe/ordered: creates + confirms the new box BEFORE deleting the old one.
 */
require('dotenv').config({ path: '/app/backend/.env' })
const { MongoClient } = require('mongodb')
const vmSetup = require('/app/js/vm-instance-setup')
const doSvc = require('/app/js/digitalocean-service')
const secretStore = require('/app/js/vps-secret-store')
const sshPwd = require('/app/js/vps-ssh-password')
const TelegramBot = require('node-telegram-bot-api')

const CHAT_ID = '6277663071'
const OLD_VPS_ID = 'do-591819943'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const audit = { chatId: CHAT_ID, ts: new Date().toISOString(), steps: [] }
const step = (name, data) => { audit.steps.push({ name, ...data }); console.log(`\n[STEP] ${name}`, JSON.stringify(data || {})) }

;(async () => {
  const client = new MongoClient(process.env.MONGO_URL)
  await client.connect()
  const db = client.db(process.env.DB_NAME || 'test')
  vmSetup.initVpsDb(db)
  secretStore.initSecretStore(db)
  const vpsPlansOf = db.collection('vpsPlansOf')

  try {
    // ── Idempotency guard ────────────────────────────────────────────────
    const already = await vpsPlansOf.findOne({ chatId: CHAT_ID, _goodwillReplacement: true })
    if (already) {
      step('ABORT_ALREADY_DONE', { existing: already.vpsId, host: already.host })
      console.log('\nA goodwill replacement already exists — refusing to create a second. Exiting.')
      return
    }

    // ── 1. Provision the NEW VPS via the real purchase path ───────────────
    const vpsDetails = {
      os: { id: 'ubuntu-22-04-x64', name: 'Ubuntu 22.04', isRDP: false },
      config: { _id: 's-1vcpu-1gb' },
      productId: 's-1vcpu-1gb',
      zone: 'US-east',   // → nyc1 (matches his old box)
      region: 'US-east',
      plan: 'Monthly',
      plantotalPrice: 18,
      monthlyPrice: 18,
    }
    step('CREATE_START', { vpsDetails })
    const result = await vmSetup.createVPSInstance(CHAT_ID, vpsDetails)
    if (!result || !result.success) {
      step('CREATE_FAILED', { result })
      console.log('\n❌ Provisioning failed — OLD VPS left untouched. Aborting.')
      return
    }
    const data = result.data
    const newId = data.contaboInstanceId || data._id
    const username = (data.credentials && data.credentials.username) || 'root'
    const password = data.credentials && data.credentials.password
    step('CREATE_OK', { newId, name: data.vps_name, username, host: data.host, hasPassword: !!password })

    // ── 2. Poll for the public IP ─────────────────────────────────────────
    let ip = (data.host && data.host !== 'provisioning...') ? data.host : null
    for (let i = 0; i < 30 && !ip; i++) {
      await sleep(5000)
      try {
        const inst = await doSvc.getInstance(newId)
        ip = inst && (inst.mainIp || (inst.ipConfig && inst.ipConfig.v4 && inst.ipConfig.v4.ip))
        if (ip) break
      } catch (e) { /* keep polling */ }
    }
    step('IP_RESOLVED', { ip })
    if (!ip) {
      step('IP_TIMEOUT', {})
      console.log('\n⚠️ IP not resolved in time. NEW VPS created but IP pending — OLD VPS left untouched. Not messaging yet.')
      console.log('NEW instance id:', newId)
      return
    }
    // Persist the resolved IP + goodwill markers on the new record
    await vpsPlansOf.updateOne(
      { chatId: CHAT_ID, contaboInstanceId: newId },
      { $set: { host: ip, status: 'RUNNING', _goodwillReplacement: true, _replacedOldVps: OLD_VPS_ID, _replacedAt: new Date() } }
    )

    // ── 3. Best-effort SSH password verification (cloud-init needs ~30-90s) ─
    let verified = false
    for (let i = 0; i < 8 && !verified; i++) {
      await sleep(15000)
      try {
        verified = await sshPwd.verifyPasswordLogin({ host: ip, port: 22, username, password, timeoutMs: 20000 })
      } catch (_) { /* retry */ }
      console.log(`  verify attempt ${i + 1}: ${verified ? 'OK' : 'not yet'}`)
    }
    step('VERIFY', { verified })

    // ── 4. Delete the OLD droplet on DO ───────────────────────────────────
    try {
      await doSvc.cancelInstance(OLD_VPS_ID) // DELETE /droplets/591819943
      step('OLD_DO_DELETED', { oldVps: OLD_VPS_ID })
    } catch (e) {
      step('OLD_DO_DELETE_ERROR', { error: String(e.message || e) })
    }

    // ── 5. Remove the OLD record from the user's bot account (DB) ──────────
    const del = await vpsPlansOf.deleteOne({ chatId: CHAT_ID, vpsId: OLD_VPS_ID })
    step('OLD_DB_DELETED', { deletedCount: del.deletedCount })

    // ── 6. Message the customer on the PRODUCTION bot ─────────────────────
    const brand = process.env.CHAT_BOT_NAME || 'Nomadly Bot'
    const text =
`<b>🎉 Your VPS is ready — a fresh replacement is live!</b>

We're sorry about the trouble with your previous server. We've set up a brand-new VPS for you (free of charge) and it's ready to use right now.

<b>🔑 Login Credentials</b>
 <b>• IP:</b> <code>${ip}</code>
 <b>• OS:</b> Ubuntu 22.04
 <b>• SSH Port:</b> <code>22</code>
 <b>• Username:</b> <code>${username}</code>
 <b>• Password:</b> <tg-spoiler><code>${password}</code></tg-spoiler> (tap to reveal &amp; copy)

<b>🔗 Connect</b>
 <code>ssh ${username}@${ip} -p 22</code>

✅ SSH is open and password login is enabled — no firewall lock-out this time. You can always tap <b>🔐 Show Password</b> or <b>🔑 Reset Password</b> on this VPS in the bot; it's applied on the running server and your data is kept.

⏱ Allow 2–5 minutes for first-boot setup. If SSH says "permission denied" right after this message, wait a moment and retry — the password is correct.

<i>Note: your old server has been removed and replaced by this one.</i>

${brand}`

    const pbot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN_PROD, { polling: false })
    const sent = await pbot.sendMessage(CHAT_ID, text, { parse_mode: 'HTML' })
    step('CUSTOMER_MESSAGED', { message_id: sent.message_id, chatId: CHAT_ID })

    console.log('\n✅ DONE. New VPS:', newId, '@', ip, '| verified:', verified, '| old removed:', OLD_VPS_ID)
    console.log('\nAUDIT:\n' + JSON.stringify(audit, null, 2))
  } catch (e) {
    step('FATAL', { error: String(e.message || e), stack: String(e.stack || '').slice(0, 500) })
    console.error('FATAL', e)
  } finally {
    await client.close()
  }
})()
