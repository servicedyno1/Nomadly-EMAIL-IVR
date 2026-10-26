// One-off ops (2026-10-26): gift a CloudIVR web account a US toll-free number on the Business plan for 7 days
// (auto-renew off), add $30 to its wallet, and tell them in the in-app Inbox (the "number live" email is skipped).
// Same records as a web purchase (js/cloudivr-web/numbers.js purchaseLocked) but $0 and no referral payout.
// Idempotent per account (GIFT tag). Run on the droplet from the live release:
//   cd /opt/nomadly/current/app-main && NODE_PATH=$PWD/node_modules node /root/civr_gift_number.js [--go] email1 email2
// Without --go it only shows what it would do. Restart/deploy afterwards so the live app learns the new SIP logins.
require('dotenv').config({ path: 'backend/.env' })
const path = require('path')
const { MongoClient, ObjectId } = require('mongodb')
const J = (f) => require(path.join(process.cwd(), 'js', f))
const phoneConfig = J('phone-config')
const telnyxApi = J('telnyx-service.js')
const { logTransaction, generateTransactionId } = J('transaction-id.js')

const GO = process.argv.includes('--go')
const EMAILS = process.argv.slice(2).filter(a => !a.startsWith('--')).map(e => e.trim().toLowerCase())
const GIFT = 'business-week-2026-10-26'
const PLAN = 'business', DAYS = 7, CREDIT = 30
const round2 = (n) => Math.round(Number(n) * 100) / 100
const day = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

;(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db(process.env.DB_NAME)
  const phoneNumbersOf = db.collection('phoneNumbersOf'), locks = db.collection('webNumberLocks')
  const plan = phoneConfig.plans[PLAN]
  if (!plan || !phoneConfig.isPlanAvailable(PLAN)) throw new Error('Business plan not available')
  const tr = await telnyxApi.getTelnyxResources()
  const us = phoneConfig.countries.find(c => c.code === 'US')
  const countryName = us.name.slice(us.name.indexOf(' ') + 1)
  const holderOf = async (phone) => (await phoneNumbersOf.findOne({ 'val.numbers': { $elemMatch: { phoneNumber: phone, status: { $ne: 'released' } } } }, { projection: { _id: 1 } }))?._id ?? null
  const taken = new Set()

  for (const email of EMAILS) {
    console.log(`\n=== ${email}`)
    const acc = await db.collection('webAccounts').findOne({ email }, { projection: { _id: 1, disabled: 1 } })
    if (!acc || acc.disabled) { console.log('  SKIP: no active web account'); continue }
    const chatId = String(acc._id)
    const nums = (await phoneNumbersOf.findOne({ _id: chatId }))?.val?.numbers || []
    let gifted = nums.find(n => n.gift === GIFT && n.status !== 'released')

    if (gifted) console.log(`  number already gifted: ${gifted.phoneNumber}`)
    else {
      const found = (await telnyxApi.searchNumbers('US', 'toll_free', null, 12)) || []
      let hit = null
      for (const n of found) if (!taken.has(n.phone_number) && (await holderOf(n.phone_number)) === null) { hit = n; break }
      if (!hit) { console.log('  FAIL: no US toll-free number available right now'); continue }
      const phone = hit.phone_number
      taken.add(phone)
      const caps = { voice: true, sms: !!hit._capabilities?.sms, fax: !!hit._capabilities?.fax }
      console.log(`  picked ${phone} caps=${JSON.stringify(caps)} cost=${JSON.stringify(hit.cost_information || {})}`)
      if (!GO) { console.log('  (dry) would order it, save Business 7 days, auto-renew off'); continue }

      try { await locks.insertOne({ _id: phone, chatId, at: new Date() }) } catch (e) { console.log(`  FAIL: lock ${e.message}`); continue }
      try {
        const order = await telnyxApi.buyNumber(phone, tr.sipConnectionId, caps.sms ? tr.messagingProfileId : null, { countryCode: 'US', numberType: 'toll_free', areaCode: null })
        if (!order) { console.log('  FAIL: Telnyx order refused — nothing saved'); continue }
        const selected = order._retriedNumber || phone
        console.log(`  ordered ${selected} (order ${order.id}, status ${order.status})`)
        if (tr.callControlAppId) console.log(`  call control: ${(await telnyxApi.assignNumberToCallControlApp(selected, tr.callControlAppId)) ? 'assigned' : 'NOT assigned yet (boot migration retries)'}`)
        let sipUsername = phoneConfig.generateSipUsername(), sipPassword = phoneConfig.generateSipPassword()
        let tUser = null, tPass = null, tCredId = null
        if (tr.sipConnectionId) {
          const cred = await telnyxApi.createSIPCredential(tr.sipConnectionId, sipUsername, sipPassword, selected)
          if (cred?.sip_username) { tUser = sipUsername = cred.sip_username; tPass = sipPassword = cred.sip_password || sipPassword; tCredId = cred.id || null }
        }
        console.log(`  SIP login: ${tUser || 'NOT created (owner can press New credentials)'}`)
        const now = new Date(), expiresAt = new Date(now.getTime() + DAYS * 86400000)
        const doc = {
          phoneNumber: selected, telnyxOrderId: order.id, provider: 'telnyx', country: 'US', countryName,
          type: 'toll_free', plan: PLAN, planPrice: round2(plan.price), purchaseDate: now.toISOString(), expiresAt: expiresAt.toISOString(), autoRenew: false, status: 'active',
          sipUsername, sipPassword, telnyxSipUsername: tUser, telnyxSipPassword: tPass, telnyxCredentialId: tCredId, sipDomain: phoneConfig.WEB_SIP_DOMAIN,
          messagingProfileId: caps.sms ? tr.messagingProfileId || null : null, connectionId: tr.sipConnectionId || null, smsUsed: 0, minutesUsed: 0,
          capabilities: caps, channel: 'web', gift: GIFT,
          features: {
            sms: caps.sms,
            callForwarding: { enabled: false, mode: 'disabled', forwardTo: null, ringTimeout: 25, holdMusic: false },
            voicemail: { enabled: false, greetingType: 'default', customGreetingUrl: null, forwardToTelegram: true, forwardToEmail: null, ringTimeout: 25 },
            smsForwarding: { toTelegram: true, toEmail: null, webhookUrl: null },
            faxForwarding: { toTelegram: true }, recording: false,
          },
        }
        await phoneNumbersOf.updateOne({ _id: chatId }, { $push: { 'val.numbers': doc } }, { upsert: true })
        const ptxId = new ObjectId()
        // Owner chose the in-app notice only: mark this purchase's "number live" email as handled before the scanner sees it.
        await db.collection('webEmailLog').insertOne({ _id: `ptx:${ptxId}`, chatId, type: 'missed-grouped', at: now, note: `gift ${GIFT}: in-app notice only` })
        await db.collection('phoneTransactions').insertOne({ _id: ptxId, chatId, phoneNumber: selected, action: 'purchase', plan: PLAN, amount: 0, paymentMethod: 'gift', gift: GIFT, channel: 'web', timestamp: now.toISOString() })
        await logTransaction(db, { transactionId: generateTransactionId(), chatId, type: 'phone-number', amount: 0, currency: 'USD', status: 'completed', metadata: { phoneNumber: selected, plan: PLAN, provider: 'telnyx', country: 'US', gift: GIFT, channel: 'web' } })
        await db.collection('webNotifications').insertOne({ chatId, kind: 'billing', mediaUrl: null, meta: { gift: GIFT, phoneNumber: selected }, read: false, createdAt: new Date(),
          text: `Gift from CloudIVR: your US toll-free number ${phoneConfig.formatPhone(selected)} is live on the Business plan, free for 1 week — until ${day(expiresAt)}. Auto-renew is off, so it pauses on that date unless you renew it from the number's Billing tab.` })
        gifted = doc
        console.log(`  saved: Business until ${expiresAt.toISOString()}, auto-renew off, inbox notice added`)
      } finally { await locks.deleteOne({ _id: phone }).catch(() => {}) }
    }

    const creditId = `gift-credit-${chatId}-${GIFT}`
    if (await db.collection('transactions').findOne({ _id: creditId })) { console.log('  $30 credit already added'); continue }
    if (!GO) { console.log(`  (dry) would add $${CREDIT} to the wallet`); continue }
    await db.collection('transactions').insertOne({ _id: creditId, chatId, type: 'admin-credit', amount: CREDIT, currency: 'USD', status: 'completed', metadata: { reason: 'Business plan gift', gift: GIFT, channel: 'web' }, createdAt: new Date(), updatedAt: new Date() })
    await db.collection('walletOf').updateOne({ _id: chatId }, { $inc: { usdIn: CREDIT } }, { upsert: true })
    const w = await db.collection('walletOf').findOne({ _id: chatId })
    const bal = round2((w?.usdIn || 0) - (w?.usdOut || 0))
    await db.collection('webNotifications').insertOne({ chatId, kind: 'wallet', mediaUrl: null, meta: { gift: GIFT, amount: CREDIT }, read: false, createdAt: new Date(),
      text: `We added $${CREDIT.toFixed(2)} credit to your wallet. New balance: $${bal.toFixed(2)}.` })
    console.log(`  wallet +$${CREDIT} → $${bal.toFixed(2)}, inbox notice added`)
  }
  await client.close()
})().catch(e => { console.error('ERR', e.stack || e.message); process.exit(1) })
