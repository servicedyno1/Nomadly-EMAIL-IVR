require('dotenv').config()
const { log } = require('console')
const sendEmail = require('./send-email')
const { assignPackageToUser, set, removeKeysFromDocumentById } = require('./db')
const { translation } = require('./translation')
const { rem } = require('./config')
const whm = require('./whm-service')
const cfService = require('./cf-service')
const opService = require('./op-service')
const cpAuth = require('./cpanel-auth')
const domainService = require('./domain-service')
const cpHealth = require('./cpanel-health')
const cpQueue = require('./cpanel-job-queue')
const { TIERS } = require('./loyalty-service')

const WHM_HOST = process.env.WHM_HOST
const TELEGRAM_DEV_CHAT_ID = process.env.TELEGRAM_DEV_CHAT_ID

// Friendly "we're processing your hosting in the background" copy
// shown when WHM is unreachable at the moment of post-payment provisioning.
// User MUST NOT learn that the hosting server is down — they paid, the order
// is committed, and the worker will finish provisioning the moment WHM is back.
const QUEUED_PROVISIONING_MSG = {
  en: (domain) => `🎉 <b>Payment confirmed!</b>\n\nYour hosting for <b>${domain}</b> is being prepared. We'll send your login details right here as soon as it's ready — usually within a few minutes.\n\n<i>You don't need to do anything — keep this chat open.</i>`,
  fr: (domain) => `🎉 <b>Paiement confirmé !</b>\n\nVotre hébergement pour <b>${domain}</b> est en cours de préparation. Nous vous enverrons vos identifiants ici dès qu'il sera prêt — généralement en quelques minutes.\n\n<i>Vous n'avez rien à faire — gardez ce chat ouvert.</i>`,
  zh: (domain) => `🎉 <b>付款已确认！</b>\n\n您的 <b>${domain}</b> 主机正在准备中。准备就绪后，我们会立即在这里发送您的登录详情 — 通常几分钟内。\n\n<i>您无需任何操作 — 保持此聊天窗口打开即可。</i>`,
  hi: (domain) => `🎉 <b>भुगतान की पुष्टि हो गई!</b>\n\n<b>${domain}</b> के लिए आपकी होस्टिंग तैयार की जा रही है। तैयार होते ही हम आपके लॉगिन विवरण यहीं भेज देंगे — आमतौर पर कुछ मिनटों में।\n\n<i>आपको कुछ नहीं करना — बस इस चैट को खुला रखें।</i>`,
}

// Shown when the DOMAIN step fails before anything was registered. Every caller
// (wallet / crypto / bank) leaves the user with nothing charged: the wallet path
// never debits, crypto + bank NGN paths credit the full payment to the wallet.
// The old text ("❌ Domain registration failed: <registrar error>") never said
// that, so users went straight to support (SMADAV @Todexman009, 2026-10-16).
const _UNAVAILABLE_ERR_RE = /not free|unassignable|not available|already registered|already taken|is taken|reserved/i
// opts.queued — the order was charged earlier and is being finished by the
// background provisioning queue (info._fromQueue). The queue does NOT refund
// automatically (it escalates to admin), so we must not say "not charged".
function _domainFailMsg(lang, domain, error, opts = {}) {
  const unavailable = _UNAVAILABLE_ERR_RE.test(String(error || ''))
  const queued = !!opts.queued
  const d = `<b>${domain}</b>`
  const T = {
    en: {
      head: unavailable
        ? `❌ ${d} can't be registered — the registry has it reserved or already taken.`
        : `❌ We couldn't register ${d} right now.`,
      money: '💵 You were <b>not charged</b> for this order. If you paid by crypto or bank transfer, the full amount has been added to your wallet.',
      moneyQueued: '💵 Your payment is safe — our team has been alerted and will refund it or help you choose another domain. You don\'t need to pay again.',
      next: unavailable
        ? 'Open 🛡️ Anti-Red Hosting below to choose a different domain name.'
        : 'Please try again in a few minutes, or choose a different domain name. Tap 💬 Get Support if it keeps failing.',
      nextQueued: 'Tap 💬 Get Support if you\'d like to pick a new name right away.',
    },
    fr: {
      head: unavailable
        ? `❌ ${d} ne peut pas être enregistré — le registre l'a réservé ou il est déjà pris.`
        : `❌ Nous n'avons pas pu enregistrer ${d} pour le moment.`,
      money: '💵 Vous <b>n\'avez pas été débité</b> pour cette commande. Si vous avez payé en crypto ou par virement, le montant total a été ajouté à votre portefeuille.',
      moneyQueued: '💵 Votre paiement est en sécurité — notre équipe a été alertée et vous remboursera ou vous aidera à choisir un autre domaine. Inutile de payer à nouveau.',
      next: unavailable
        ? 'Ouvrez 🛡️ Hébergement Anti-Red ci-dessous pour choisir un autre nom de domaine.'
        : 'Réessayez dans quelques minutes ou choisissez un autre nom de domaine. Contactez le support si le problème persiste.',
      nextQueued: 'Contactez le support si vous souhaitez choisir un nouveau nom tout de suite.',
    },
    zh: {
      head: unavailable
        ? `❌ ${d} 无法注册 — 该域名已被注册局保留或已被占用。`
        : `❌ 我们暂时无法注册 ${d}。`,
      money: '💵 此订单<b>未扣款</b>。如果您使用加密货币或银行转账付款，全部金额已退回您的钱包。',
      moneyQueued: '💵 您的付款是安全的 — 我们的团队已收到通知，将为您退款或帮助您选择其他域名。您无需再次付款。',
      next: unavailable
        ? '请在下方打开主机服务，选择其他域名。'
        : '请几分钟后重试，或选择其他域名。如持续失败，请联系客服。',
      nextQueued: '如需立即选择新域名，请联系客服。',
    },
    hi: {
      head: unavailable
        ? `❌ ${d} पंजीकृत नहीं किया जा सकता — रजिस्ट्री ने इसे आरक्षित रखा है या यह पहले से लिया जा चुका है।`
        : `❌ हम अभी ${d} पंजीकृत नहीं कर सके।`,
      money: '💵 इस ऑर्डर के लिए आपसे <b>कोई शुल्क नहीं लिया गया</b>। यदि आपने क्रिप्टो या बैंक ट्रांसफर से भुगतान किया है, तो पूरी राशि आपके वॉलेट में जोड़ दी गई है।',
      moneyQueued: '💵 आपका भुगतान सुरक्षित है — हमारी टीम को सूचित कर दिया गया है और वह आपको रिफंड करेगी या दूसरा डोमेन चुनने में मदद करेगी। आपको दोबारा भुगतान करने की आवश्यकता नहीं है।',
      next: unavailable
        ? 'दूसरा डोमेन नाम चुनने के लिए नीचे होस्टिंग खोलें।'
        : 'कुछ मिनट बाद फिर से प्रयास करें या दूसरा डोमेन नाम चुनें। समस्या बनी रहे तो सपोर्ट से संपर्क करें।',
      nextQueued: 'यदि आप तुरंत नया नाम चुनना चाहते हैं तो सपोर्ट से संपर्क करें।',
    },
  }
  const t = T[lang] || T.en
  return `${t.head}\n\n${queued ? t.moneyQueued : t.money}\n\n${queued ? t.nextQueued : t.next}`
}


// The single `transactions` hosting row for a completed order. Bot payment paths set
// info.chargedUsd (amount really debited/paid, incl. any new domain); there info.price is a
// stale domain-step value ($0/$30). Store/reseller callers carry the real total in info.price.
function hostingTxnRecord(info, domain, cpUser) {
  const charged = typeof info.chargedUsd === 'number'
  const external = !!(info.existingDomain || info.connectExternalDomain)
  // Loyalty set by applyCheckoutLoyaltyOnce on the very price charged here (wallet checkout).
  const la = info.loyaltyApplied
  const loyalty = charged && la && la.step === 'hosting-pay' && Math.abs(Number(la.to) - info.chargedUsd) < 0.01 ? Number(info.loyaltyDiscount) || 0 : 0
  const coupon = info.couponApplied ? (Number(info.couponDiscount) || 0) : 0
  const rate = loyalty > 0 ? Math.round((loyalty / (info.chargedUsd + loyalty)) * 100) / 100 : 0
  const loyaltyTier = Object.keys(TIERS).find((k) => TIERS[k].discount === rate) || 'bronze'
  return {
    type: 'hosting',
    amount: charged ? info.chargedUsd : (info.price || 0),
    currency: 'USD',
    status: 'completed',
    metadata: {
      domain, plan: info.plan, cpUser,
      ...(charged ? {
        ...(info.chargedVia || {}),
        existingDomain: external,
        hostingPrice: info.hostingPrice ?? null,
        domainPrice: external ? 0 : (info.domainPrice ?? null),
        listPrice: Math.round((info.chargedUsd + loyalty + coupon) * 100) / 100,
        loyaltyDiscount: loyalty,
        loyaltyTier,
        couponCode: info.couponApplied ? (info.couponCode || null) : null,
        couponDiscount: coupon,
      } : {}),
    },
  }
}

async function registerDomainAndCreateCpanel(send, info, keyboardButtons, state, bot = null) {
  const lang = info?.userLanguage ?? 'en'
  const chatId = info._id
  // ── Domain-ownership chatId (ISSUE-8 FIX, 2026-10) ──
  // `chatId` (= info._id) is the SESSION/state key. For the Telegram bot and the
  // web store this IS the owner. For the Reseller API it is a synthetic
  // `reseller_<uuid>` used only to isolate the provisioning session state — the
  // REAL owner is the API key's bot chatId, passed in as info.ownerChatId.
  // All DOMAIN-ownership persistence (domainsOf map, registeredDomains.ownerChatId,
  // the cpanelAccounts.chatId tag) MUST key off the real owner so GET /domains,
  // /renewals, captcha/honeypot AND the bot's "My Domain Names" all see it.
  // Falls back to chatId when ownerChatId is absent → no change for bot/store.
  const ownerChatId = info.ownerChatId ? String(info.ownerChatId) : String(chatId)
  const domain = info.website_name

  // ── domainRegistered tracker (2026-07-06 defense-in-depth) ──
  // Prevents the @HHR2009 bug class where callers charged the user for a
  // "domain-only" outcome even when domain registration ITSELF failed (i.e.
  // nothing was actually registered). This flag is the single source of truth
  // for callers deciding whether to charge the domain portion on failure.
  //   • false = new domain not yet registered in this run
  //   • true  = existing/external domain OR re-run of already-registered domain
  //             OR new domain registered successfully in this run
  let domainRegistered = !!(
    info.skipDomainRegistration || info.existingDomain || info.connectExternalDomain
  )

  // ── IDEMPOTENCY GUARD — prevent double-provisioning ──
  // A single hosting purchase must produce ONE cpanelAccount record. Without this
  // guard, a webhook retry, user double-tap, or race between payment callbacks
  // could invoke this function twice for the same domain — stacking duration
  // or creating duplicate records. We short-circuit if an active (non-deleted)
  // account already exists for this domain.
  try {
    const { MongoClient } = require('mongodb')
    const guardClient = new MongoClient(process.env.MONGO_URL)
    await guardClient.connect()
    const guardDb = guardClient.db(process.env.DB_NAME || 'test')
    // ── DUPLICATE-MATCH SCOPE (2026-10-11 fix) ──
    // Only a REAL, still-live account for this domain is a true duplicate. Two
    // records must NEVER count as a duplicate or the reseller/bot gets charged,
    // refunded, and told "contact support — a retry would be blocked the same way":
    //   1. provisionState:'failed' ghosts — a prior attempt was refunded, so the
    //      domain is free again (mirrors the reseller API outer check at
    //      reseller-api.js `findOne({domain, deleted:{$ne:true}, provisionState:{$ne:'failed'}})`).
    //   2. THIS order's own placeholder stub — the reseller API inserts a
    //      {_id: <customUsername>, provisionState:'provisioning'} row BEFORE the
    //      worker calls this function; matching it = self-collision (the exact
    //      namewords.sbs/nameb2b2 incident — guard matched its own stub,
    //      cpUser=undefined, aborted, left a non-deleted failed ghost that then
    //      permanently blocked every future order for the domain).
    const existingAccount = await guardDb.collection('cpanelAccounts').findOne({
      // Match the requested domain whether it's the PRIMARY of an existing plan
      // OR an ADDON on one (RCA @smsbeast_real 2026-10-11: luxelitecasinoreviews.com
      // was an addon on the user's own suspended eliteescapesau.com plan, so the
      // old `domain: domain` guard missed it and WHM `createacct` then collided
      // with "domain already exists in the userdata").
      $or: [{ domain: domain }, { addonDomains: domain }],
      deleted: { $ne: true },
      provisionState: { $ne: 'failed' },
      _id: { $ne: info.customUsername || '__no_self__' },
    })

    // ── RE-RUN SAFETY — skip already-registered domains ──
    // If this run is a retry from the cpanel-job-queue worker (because WHM was
    // down on the original attempt and domain registration had already
    // succeeded), DO NOT re-register — that would double-charge the user.
    // We detect by looking up the registeredDomains marker. Idempotent.
    //
    // BUG FIX (origin-leak / wrong-zone): The per-domain `registeredDomains`
    // record is the source of truth for `cfZoneId`. Previously we used
    // `info.cfZoneId || alreadyReg.val?.cfZoneId` — but `info.cfZoneId` is
    // user-session state polluted by the most recently MANAGED domain
    // (see _index.js:6385 `set(state, chatId, 'cfZoneId', cfZoneId)`).
    // For a user who manages multiple domains, this leaked the WRONG zone
    // into hosting provisioning, creating ghost records like
    // `hunt-verify.org.huntingtononlinebanking.it → origin_ip` in the
    // wrong zone (Cloudflare auto-appends the zone domain when the supplied
    // record name doesn't match the zone).
    if (!info.skipDomainRegistration) {
      const alreadyReg = await guardDb.collection('registeredDomains').findOne({
        _id: domain,
        'val.ownerChatId': ownerChatId,
        'val.status': 'registered',
      })
      if (alreadyReg) {
        info.skipDomainRegistration = true
        // Per-domain DB record WINS over user-session state
        info.cfZoneId = alreadyReg.val?.cfZoneId || info.cfZoneId
        info.cfNameservers = alreadyReg.val?.nameservers || info.cfNameservers
        info.registrar = alreadyReg.val?.registrar || info.registrar
        log(`[Hosting] re-run: ${domain} already registered to ${chatId} — skipping domain registration step`)
      }
    }

    await guardClient.close()
    if (existingAccount) {
      // ── ADDON-CONFLICT branch (RCA @smsbeast_real 2026-10-11) ──
      // The requested domain is not the primary of this record but is attached
      // as an ADDON on an existing (active/suspended) plan. Creating a brand-new
      // cPanel account with it as primary WILL fail at WHM ("already exists in
      // the userdata"). Block BEFORE createAccount with an actionable message so
      // the user unlinks it (or manages/renews the owning plan) first.
      const isAddonConflict = existingAccount.domain !== domain &&
        Array.isArray(existingAccount.addonDomains) &&
        existingAccount.addonDomains.includes(domain)
      if (isAddonConflict) {
        const sameOwner = String(existingAccount.chatId) === String(ownerChatId)
        const susp = existingAccount.suspended ? true : false
        log(`[Hosting] PRE-FLIGHT: ${domain} is an ADDON on existing${susp ? ' suspended' : ''} plan ${existingAccount.cpUser} (primary=${existingAccount.domain}, owner=${existingAccount.chatId}) — blocking new-primary provisioning for ${chatId}`)
        if (sameOwner) {
          const suspTxt = { en: susp ? ' (currently suspended)' : '', fr: susp ? ' (actuellement suspendu)' : '', zh: susp ? '（当前已暂停）' : '', hi: susp ? ' (वर्तमान में निलंबित)' : '' }
          send(chatId, {
            en: `⚠️ <b>${domain}</b> is already part of your hosting plan for <b>${existingAccount.domain}</b>${suspTxt.en}.\n\nTo host <b>${domain}</b> on its own plan, first unlink it via 🛡️ Anti-Red Hosting → 📋 My Hosting Plans → 🗑️ Unlink a Domain, then try again.`,
            fr: `⚠️ <b>${domain}</b> fait déjà partie de votre plan d'hébergement pour <b>${existingAccount.domain}</b>${suspTxt.fr}.\n\nPour héberger <b>${domain}</b> sur son propre plan, dissociez-le d'abord via 🛡️ Hébergement Anti-Red → 📋 Mes Plans d'Hébergement → 🗑️ Dissocier un domaine, puis réessayez.`,
            zh: `⚠️ <b>${domain}</b> 已经是您 <b>${existingAccount.domain}</b> 主机套餐的一部分${suspTxt.zh}。\n\n若要为 <b>${domain}</b> 单独开通套餐，请先通过 🛡️ Anti-Red 主机 → 📋 我的主机套餐 → 🗑️ 取消关联域名 解除关联，然后重试。`,
            hi: `⚠️ <b>${domain}</b> पहले से ही आपके <b>${existingAccount.domain}</b> होस्टिंग प्लान का हिस्सा है${suspTxt.hi}।\n\n<b>${domain}</b> को अलग प्लान पर होस्ट करने के लिए, पहले इसे 🛡️ Anti-Red Hosting → 📋 My Hosting Plans → 🗑️ Unlink a Domain से अनलिंक करें, फिर पुनः प्रयास करें।`,
          }[lang] || `⚠️ <b>${domain}</b> is already part of your hosting plan for <b>${existingAccount.domain}</b>. Unlink it first, then try again.`, keyboardButtons)
        } else {
          send(chatId, { en: `⚠️ <b>${domain}</b> is already attached to an existing hosting plan. If this is unexpected, contact support.`, fr: `⚠️ <b>${domain}</b> est déjà rattaché à un plan d'hébergement existant. Si inattendu, contactez le support.`, zh: `⚠️ <b>${domain}</b> 已附加到现有主机套餐。如意外，请联系支持。`, hi: `⚠️ <b>${domain}</b> पहले से ही किसी मौजूदा होस्टिंग प्लान से जुड़ा है। यदि अप्रत्याशित है, तो समर्थन से संपर्क करें।` }[lang] || `⚠️ <b>${domain}</b> is already attached to an existing hosting plan.`, keyboardButtons)
        }
        return { success: false, error: 'domain_is_addon_on_existing_plan', duplicate: true, addonConflict: true }
      }

      log(`[Hosting] IDEMPOTENCY: cpanel already exists for ${domain} (cpUser=${existingAccount.cpUser}, chatId=${existingAccount.chatId}) — aborting duplicate provisioning for ${chatId}`)
      send(chatId, { en: `⚠️ Hosting for <b>${domain}</b> is already provisioned. If this is unexpected, contact support.`, fr: `⚠️ L'hébergement pour <b>${domain}</b> est déjà provisionné. Si inattendu, contactez le support.`, zh: `⚠️ <b>${domain}</b> 的主机已经配置。如果这是意外，请联系支持。`, hi: `⚠️ <b>${domain}</b> के लिए होस्टिंग पहले से ही प्रावधान की गई है। यदि अप्रत्याशित है, तो समर्थन से संपर्क करें।` }[lang] || `⚠️ Hosting for <b>${domain}</b> is already provisioned.`, keyboardButtons)
      return { success: false, error: 'duplicate_provisioning_prevented', duplicate: true }
    }

    // ── Archive old terminated records for this domain ──
    // When a user re-purchases hosting for a domain that had a terminated plan,
    // archive the old record(s) so they don't interfere with the new plan.
    try {
      const archiveClient = new MongoClient(process.env.MONGO_URL)
      await archiveClient.connect()
      const archiveDb = archiveClient.db(process.env.DB_NAME || 'test')
      const oldTerminated = await archiveDb.collection('cpanelAccounts').find({
        domain: domain,
        chatId: ownerChatId,
        $or: [{ deleted: true }, { terminatedOnWhm: true }],
      }).toArray()
      if (oldTerminated.length > 0) {
        log(`[Hosting] Found ${oldTerminated.length} old terminated record(s) for ${domain} — archiving`)
        for (const old of oldTerminated) {
          await archiveDb.collection('cpanelAccounts').updateOne(
            { _id: old._id },
            { $set: { archived: true, archivedAt: new Date(), archivedReason: 'domain_reuse_new_plan' } }
          )
        }
      }
      await archiveClient.close()
    } catch (archiveErr) {
      log(`[Hosting] Archive old records error (non-blocking): ${archiveErr.message}`)
    }
  } catch (guardErr) {
    // Non-blocking — if guard fails, we continue but log loudly
    log(`[Hosting] IDEMPOTENCY guard error (non-blocking): ${guardErr.message}`)
  }

  // ── PRE-FLIGHT WHM HEALTH CHECK ──
  // If the WHM control plane is unreachable RIGHT NOW, do NOT show the user
  // a server-down error in the middle of the post-payment flow. Their payment
  // is committed, the order is real — we just defer the provisioning to a
  // background worker that re-runs this whole function the moment WHM comes
  // back. The user sees a calm "your hosting is being prepared" message and
  // gets their login details automatically when ready.
  //
  // We skip this check when re-entered from the queue worker (info._fromQueue)
  // to avoid re-queueing forever on a flaky probe.
  if (!info._fromQueue) {
    try {
      const reachable = await cpHealth.isWhmReachable()
      if (!reachable) {
        log(`[Hosting] WHM unreachable at payment time — queueing provisioning for ${domain} (chat=${chatId})`)
        try {
          await cpQueue.enqueue({
            type: 'provision',
            chatId,
            lang,
            domain,
            plan: info.plan,
            params: { info: { ...info, _fromQueue: true } },
            dedupeKey: `provision:${domain}:${chatId}`,
          })
        } catch (qErr) {
          log(`[Hosting] failed to enqueue provisioning (non-blocking): ${qErr.message}`)
        }
        const queuedMsg = (QUEUED_PROVISIONING_MSG[lang] || QUEUED_PROVISIONING_MSG.en)(domain)
        send(chatId, queuedMsg, keyboardButtons)
        // Preflight-only path (interactive purchase saw WHM already down
        // BEFORE any work started). Caller in _index.js treats
        // `queued:true` as "background provisioning kicked off, don't fail
        // the purchase UX". The queue worker never enters this branch
        // because it always sets `_fromQueue=true`.
        return { success: true, queued: true }
      }
    } catch (hErr) {
      log(`[Hosting] WHM health check error (non-blocking): ${hErr.message}`)
    }
  }

  // ── UX Enhancement: Progress Tracking ──
  let progress = null
  if (bot) {
    const { createProgressTracker } = require('./progress-tracker')
    const steps = [
      { en: 'Payment confirmed', fr: 'Paiement confirmé', zh: '付款已确认', hi: 'भुगतान की पुष्टि' }[lang] || 'Payment confirmed'
    ]
    
    const isNewDomain = !info.existingDomain && !info.connectExternalDomain
    if (isNewDomain) {
      steps.push({ en: `Registering ${domain}`, fr: `Enregistrement de ${domain}`, zh: `正在注册 ${domain}`, hi: `${domain} पंजीकृत कर रहे हैं` }[lang] || `Registering ${domain}`)
    }
    
    steps.push(
      { en: 'Creating cPanel account', fr: 'Création du compte cPanel', zh: '正在创建 cPanel 账户', hi: 'cPanel खाता बना रहे हैं' }[lang] || 'Creating cPanel account',
      { en: 'Configuring DNS', fr: 'Configuration DNS', zh: '正在配置 DNS', hi: 'DNS कॉन्फ़िगर कर रहे हैं' }[lang] || 'Configuring DNS',
      { en: 'Installing SSL certificate', fr: 'Installation du certificat SSL', zh: '正在安装 SSL 证书', hi: 'SSL प्रमाणपत्र इंस्टॉल कर रहे हैं' }[lang] || 'Installing SSL certificate',
      { en: 'Activating protection', fr: 'Activation de la protection', zh: '正在激活保护', hi: 'सुरक्षा सक्रिय कर रहे हैं' }[lang] || 'Activating protection'
    )
    
    progress = createProgressTracker(bot, chatId, 
      { en: 'Hosting Setup', fr: 'Configuration hébergement', zh: '主机设置', hi: 'होस्टिंग सेटअप' }[lang] || 'Hosting Setup',
      steps
    )
    await progress.startStep(1)
    await progress.completeStep(1)
  } else {
    // Fallback: Original simple message
    send(chatId, { en: `✅ <b>Payment confirmed</b> — $${info.totalPrice || info.hostingPrice}\n\nProvisioning your hosting now...`, fr: `✅ <b>Paiement confirmé</b> — $${info.totalPrice || info.hostingPrice}\n\nProvisionnement de votre hébergement en cours...`, zh: `✅ <b>付款已确认</b> — $${info.totalPrice || info.hostingPrice}\n\n正在配置您的主机...`, hi: `✅ <b>भुगतान की पुष्टि</b> — $${info.totalPrice || info.hostingPrice}\n\nआपकी होस्टिंग प्रावधान कर रहे हैं...` }[lang] || `✅ <b>Payment confirmed</b> — $${info.totalPrice || info.hostingPrice}\n\nProvisioning your hosting now...`, rem)
  }

  try {
    const nsChoice = info?.nameserver || info?.nsChoice
    const isCloudflareNS = nsChoice === 'cloudflare' || nsChoice === 'Cloudflare'
    const isExisting = info.existingDomain
    const isExternal = info.connectExternalDomain
    const isNewDomain = !isExisting && !isExternal

    // Track CF zone info — populated during domain registration (new domains)
    // or CF DNS setup (existing/external domains).
    //
    // BUG FIX (wrong-zone): NEVER trust `info.cfZoneId` from session state.
    // Historically, `_index.js` stamped `state.cfZoneId` for every "Manage DNS"
    // interaction. That value then leaked into hosting provisioning, causing
    // records to be created in the WRONG zone (Cloudflare auto-appends the
    // zone domain when the supplied record name doesn't match the zone, so
    // `name="hunt-verify.org"` + `zone=*.it` produced
    // `hunt-verify.org.huntingtononlinebanking.it` in the .it zone with NO
    // records in the actual hunt-verify.org zone).
    //
    // The session-state setter has been removed (_index.js:6385), but for
    // backward safety we ALSO ignore `info.cfZoneId` here and always
    // re-resolve from per-domain sources. Only `_fromQueue` runs (true
    // mid-flight resume) keep their queued zone — the queue persists the
    // same per-domain id.
    let cfZoneId = null
    let cfNameservers = []

    if (info._fromQueue && info.cfZoneId) {
      cfZoneId = info.cfZoneId
      cfNameservers = info.cfNameservers || []
    } else {
      const stale = info.cfZoneId || null
      try {
        const { MongoClient } = require('mongodb')
        const zClient = new MongoClient(process.env.MONGO_URL)
        await zClient.connect()
        const zDb = zClient.db(process.env.DB_NAME || 'test')
        const reg = await zDb.collection('registeredDomains').findOne({ _id: domain })
        await zClient.close()
        if (reg?.val?.cfZoneId) {
          cfZoneId = reg.val.cfZoneId
          cfNameservers = reg.val.nameservers || []
          log(`[Hosting] cfZoneId for ${domain} resolved from DB: ${cfZoneId}${stale && stale !== cfZoneId ? ` (ignored stale info.cfZoneId=${stale})` : ''}`)
        }
      } catch (zErr) {
        log(`[Hosting] DB cfZoneId lookup failed for ${domain}: ${zErr.message}`)
      }
      // Fall back to a live CF lookup if DB had no record (e.g. CF zone
      // exists but was created out-of-band).
      if (!cfZoneId) {
        try {
          const liveZone = await cfService.getZoneByName(domain)
          if (liveZone?.id) {
            cfZoneId = liveZone.id
            cfNameservers = liveZone.name_servers || []
            log(`[Hosting] cfZoneId for ${domain} resolved live from CF: ${cfZoneId}${stale && stale !== cfZoneId ? ` (ignored stale info.cfZoneId=${stale})` : ''}`)
          }
        } catch (lErr) {
          log(`[Hosting] live CF zone lookup failed for ${domain}: ${lErr.message}`)
        }
      }
    }

    // ── Step 2: Domain registration FIRST (for new domains only) ──
    // This prevents orphan WHM accounts if domain registration fails.
    // For cloudflare NS: registerDomain() internally creates CF zone and
    // passes zone-specific NS to the registrar API at registration time.
    if (isNewDomain && !info.skipDomainRegistration) {
      if (progress) {
        await progress.startStep(2)
      } else {
        send(chatId, { en: `🌐 Registering <b>${domain}</b>...`, fr: `🌐 Enregistrement de <b>${domain}</b>...`, zh: `🌐 正在注册 <b>${domain}</b>...`, hi: `🌐 <b>${domain}</b> पंजीकृत कर रहे हैं...` }[lang] || `🌐 Registering <b>${domain}</b>...`, rem)
      }

      try {
        const registrar = info?.registrar || 'ConnectReseller'
        const regNsChoice = nsChoice || 'cloudflare'
        const { MongoClient } = require('mongodb')
        const regClient = new MongoClient(process.env.MONGO_URL)
        await regClient.connect()
        const regDb = regClient.db(process.env.DB_NAME || 'test')

        const regResult = await domainService.registerDomain(domain, registrar, regNsChoice, regDb, ownerChatId)
        await regClient.close()

        if (regResult.success) {
          log(`[Hosting] Domain ${domain} registered at ${regResult.registrar} (ID: ${regResult.opDomainId || 'N/A'})`)
          info.registrar = regResult.registrar

          // Capture CF zone info from registration — avoids double createZone later
          if (regResult.cfZoneId) {
            cfZoneId = regResult.cfZoneId
            cfNameservers = regResult.nameservers || []
            log(`[Hosting] CF zone captured from registration: ${cfZoneId} NS: ${cfNameservers.join(', ')}`)
          }

          // ── Belt-and-suspenders: force OP→registry NS re-push ──
          // op.registerDomain() stores the CF NS in OP's internal DB and *should*
          // push them to the registry at registration time, but for some TLD/state
          // combinations (notably .com under load, and DENIC's ns_group binding —
          // see op-service.js:683) OP silently keeps the registry on its parking NS
          // (ina*.registrar.eu). Calling updateNameservers() here sends the
          // `ns_group: ''` reset and forces a fresh `domain:update` to the registry.
          // Real prod incident 2026-06-17 (@HHR2009 / strivepartypaperless.com)
          // confirmed this gap — fixing here eliminates the entire bug class for
          // future purchases without waiting for the DnsHealer to detect & heal it.
          if (
            regResult.registrar === 'OpenProvider' &&
            regNsChoice === 'cloudflare' &&
            Array.isArray(regResult.nameservers) &&
            regResult.nameservers.length >= 2
          ) {
            try {
              const opService = require('./op-service')
              const nsRes = await opService.updateNameservers(domain, regResult.nameservers)
              log(`[Hosting] ${domain}: OP→registry NS re-push ${nsRes.success ? 'ok' : 'failed'} ${nsRes.error || ''}`)
            } catch (nsErr) {
              log(`[Hosting] ${domain}: OP NS re-push error (non-blocking): ${nsErr.message}`)
            }
          }

          // Store in user's domainsOf + registeredDomains
          const regClient2 = new MongoClient(process.env.MONGO_URL)
          await regClient2.connect()
          const regDb2 = regClient2.db(process.env.DB_NAME || 'test')
          const domainKey = domain.replace(/\./g, '@')
          await regDb2.collection('domainsOf').updateOne(
            { _id: ownerChatId },
            { $set: { [domainKey]: true } },
            { upsert: true }
          )

          await regDb2.collection('registeredDomains').updateOne(
            { _id: domain },
            { $set: {
              val: {
                domain,
                provider: regResult.registrar,
                registrar: regResult.registrar,
                nameserverType: regNsChoice,
                nameservers: regResult.nameservers || [],
                autoRenew: true,
                ownerChatId: ownerChatId,
                status: 'registered',
                registeredAt: new Date(),
                linkedAt: new Date(),
                cfZoneId: regResult.cfZoneId || null,
                opDomainId: regResult.opDomainId || null,
              }
            }},
            { upsert: true }
          )

          // ── B1: Inline delegation guard for pre-delegation TLDs ──
          // For .de/.nl/.se/.fi/.be/.ch/.ie/.it/.eu/.at/.li/.dk/.cz/.no the
          // registry pre-checks NS during/after registration. If that race
          // fails, the OP API still returns success but the domain stays
          // parked at the registry. Catch that here, heal once inline, and
          // queue any remaining cases for the background DnsHealer.
          if (regNsChoice === 'cloudflare' && Array.isArray(regResult.nameservers) && regResult.nameservers.length >= 2) {
            try {
              const dnsHealer = require('./dns-healer')
              const guard = await dnsHealer.verifyDelegationOrQueue(
                regDb2,
                domain,
                regResult.nameservers,
                ownerChatId
              )
              if (!guard.healthy) {
                info._delegationDeferred = true
                info._delegationReason = guard.reason || 'pending'
                log(`[Hosting] ${domain}: registry delegation not live yet (${guard.reason}). Queued for DnsHealer; hosting will continue.`)
              } else if (guard.action === 'healed-now') {
                log(`[Hosting] ${domain}: registry delegation required an inline NS re-push but is now live.`)
              }
            } catch (gErr) {
              log(`[Hosting] B1 delegation guard failed (non-blocking): ${gErr.message}`)
            }
          }

          await regClient2.close()

          // ✅ Domain is now registered in DB + registry — set the flag so
          // downstream callers know it's safe to charge for the domain even
          // if the subsequent WHM step fails (defense-in-depth for @HHR2009
          // 2026-07-06 bug class).
          domainRegistered = true

          send(chatId, { en: `✅ Domain <b>${domain}</b> registered`, fr: `✅ Domaine <b>${domain}</b> enregistré`, zh: `✅ 域名 <b>${domain}</b> 已注册`, hi: `✅ डोमेन <b>${domain}</b> पंजीकृत` }[lang] || `✅ Domain <b>${domain}</b> registered`, rem)
        } else {
          log(`[Hosting] Domain registration failed for ${domain}: ${regResult.error}`)
          send(chatId, _domainFailMsg(lang, domain, regResult.error, { queued: !!info._fromQueue }), keyboardButtons)
          return { success: false, error: `Domain registration failed: ${regResult.error}`, domainRegistered, userNotified: true }
        }
      } catch (regErr) {
        log(`[Hosting] Domain registration error: ${regErr.message}`)
        send(chatId, _domainFailMsg(lang, domain, null, { queued: !!info._fromQueue }), keyboardButtons)
        return { success: false, error: `Domain registration error: ${regErr.message}`, domainRegistered, userNotified: true }
      }
    } else if (isExisting) {
      send(chatId, { en: `🔗 Linking <b>${domain}</b> to your hosting...`, fr: `🔗 Liaison de <b>${domain}</b> à votre hébergement...`, zh: `🔗 正在将 <b>${domain}</b> 链接到您的主机...`, hi: `🔗 <b>${domain}</b> को आपकी होस्टिंग से जोड़ रहे हैं...` }[lang] || `🔗 Linking <b>${domain}</b> to your hosting...`, rem)
    } else if (isExternal) {
      send(chatId, { en: `🔗 Connecting external domain <b>${domain}</b>...`, fr: `🔗 Connexion du domaine externe <b>${domain}</b>...`, zh: `🔗 正在连接外部域名 <b>${domain}</b>...`, hi: `🔗 बाहरी डोमेन <b>${domain}</b> कनेक्ट कर रहे हैं...` }[lang] || `🔗 Connecting external domain <b>${domain}</b>...`, rem)
    }

    // ── Step 3: Create hosting account (AFTER domain registration) ──
    send(chatId, { en: '⚙️ Creating hosting account...', fr: '⚙️ Création du compte d\'hébergement...', zh: '⚙️ 正在创建主机账户...', hi: '⚙️ होस्टिंग खाता बना रहे हैं...' }[lang] || '⚙️ Creating hosting account...', rem)

    const result = await whm.createAccount(
      domain,
      info.plan,
      info.email || process.env.NOMADLY_SERVICE_EMAIL,
      info.customUsername || undefined,
      { useCloudflareNS: isCloudflareNS },
    )

    // ── Mid-flight WHM outage handling ──
    // If WHM became unreachable between the pre-flight check and now (rare,
    // but we just paid and possibly registered the domain), defer the rest of
    // provisioning to the queue. Persist the partial state (skipDomainRegistration
    // + cfZoneId + cfNameservers) into the queued info so the worker doesn't
    // re-register the domain.
    if (!result.success && result.code === 'CPANEL_DOWN') {
      log(`[Hosting] WHM down mid-flight for ${domain} — queueing remaining provisioning`)
      try {
        await cpQueue.enqueue({
          type: 'provision',
          chatId,
          lang,
          domain,
          plan: info.plan,
          params: { info: {
            ...info,
            _fromQueue: true,
            skipDomainRegistration: true, // domain is already registered (or wasn't a new domain)
            cfZoneId,
            cfNameservers,
            registrar: info.registrar,
          } },
          dedupeKey: `provision:${domain}:${chatId}`,
        })
      } catch (qErr) {
        log(`[Hosting] failed to enqueue mid-flight provisioning (non-blocking): ${qErr.message}`)
      }
      // Only surface the "your hosting is being prepared" reassurance to
      // the customer on the FIRST time we defer (interactive purchase
      // path). Suppress on re-runs from the queue worker so the user
      // isn't spammed with the same reassurance every 30s.
      if (!info._fromQueue) {
        const queuedMsg = (QUEUED_PROVISIONING_MSG[lang] || QUEUED_PROVISIONING_MSG.en)(domain)
        send(chatId, queuedMsg, keyboardButtons)
      }
      // BUG FIX (@HHR2009, 2026-07-06): historically returned
      // `{ success: true, queued: true }` here, which fooled the queue
      // handler into marking the job DONE and DM'ing a false "🎉 Login
      // details delivered above" — even though no cPanel account was
      // created and no credentials were sent. Return success:false + a
      // `deferred:true` tag so the handler correctly classifies this as
      // a retry (job stays pending; next drain tick completes it once
      // WHM is back).
      return { success: false, queued: true, deferred: true, code: 'CPANEL_DOWN', domainRegistered }
    }

    // ── Self-heal: "domain already exists in the userdata" (stale DELETED account) ──
    // Defense-in-depth for the Mongo-says-deleted / WHM-still-has-it class: a
    // prior DELETED account (SAME owner) can still hold this domain (primary or
    // addon) in WHM userdata because grace-period /removeacct silently failed.
    // The pre-flight guard excludes deleted rows, so provisioning proceeds, then
    // cPanel rejects here. Retry /removeacct on the stale row via
    // whm-userdata-heal (same-owner only — never cross-user) + retry createAccount
    // once. (The active/suspended-addon case is handled earlier by the pre-flight
    // guard; this covers the deleted-but-not-removed-from-WHM case.)
    if (!result.success) {
      const heal = require('./whm-userdata-heal')
      if (heal.isStaleUserdataError(result.error)) {
        try {
          const { MongoClient } = require('mongodb')
          const healClient = new MongoClient(process.env.MONGO_URL)
          await healClient.connect()
          const release = await heal.attemptUserdataRelease({
            db: healClient.db(process.env.DB_NAME || 'test'),
            whmService: whm,
            domain,
            chatId: ownerChatId,
          })
          await healClient.close()
          if (release.released) {
            log(`[Hosting] userdata self-heal released ${domain} from stale ${release.staleCpUser} — retrying createAccount`)
            result = await whm.createAccount(
              domain,
              info.plan,
              info.email || process.env.NOMADLY_SERVICE_EMAIL,
              info.customUsername || undefined,
              { useCloudflareNS: isCloudflareNS },
            )
          } else {
            log(`[Hosting] userdata self-heal did NOT release ${domain}: ${release.reason}`)
          }
        } catch (healErr) {
          log(`[Hosting] userdata self-heal error (non-blocking): ${healErr.message}`)
        }
      }
    }

    if (!result.success) {
      log(`[Hosting] WHM createAccount failed: ${result.error}`)
      send(chatId, `❌ Hosting setup failed. Tap 💬 Get Support for help.`, keyboardButtons)
      return { success: false, error: `Hosting setup failed: ${result.error}`, domainRegistered }
    }

    send(chatId, { en: '✅ Hosting account created', fr: '✅ Compte d\'hébergement créé', zh: '✅ 主机账户已创建', hi: '✅ होस्टिंग खाता बनाया गया' }[lang] || '✅ Hosting account created', rem)

    // P0 FIX: Save cPanel username for cleanup if subsequent steps fail
    const cpanelUsername = result.username
    let dnsSetupSuccess = false

    // ── Step 4: Cloudflare DNS setup ──
    // For new domains: reuse CF zone from registration (no double createZone)
    // For existing/external domains: create CF zone now
    if (isCloudflareNS) {
      try {
        if (!cfZoneId) {
          // Existing/external domain — CF zone not yet created
          const zone = await cfService.createZone(domain)
          if (zone.success && zone.zoneId) {
            cfZoneId = zone.zoneId
            cfNameservers = zone.nameservers || []
            log(`[Hosting] CF zone created for existing/external domain ${domain}: ${cfZoneId}`)
          }
        }

        if (cfZoneId) {
          // Issue E Fix: Clean up any conflicting A/AAAA/CNAME records for root and www
          // before creating hosting records. This is essential when transitioning a domain
          // from shortener (CNAME→Railway) to hosting (A→WHM), since Cloudflare doesn't
          // allow both CNAME and A records for the same name.
          try {
            const cleanup = await cfService.cleanupConflictingDNS(cfZoneId, domain)
            if (cleanup.deleted.length > 0) {
              log(`[Hosting] Cleaned up ${cleanup.deleted.length} conflicting DNS records for ${domain}`)
              // If a Railway CNAME was deleted (shortener was active), also remove from Railway
              const hadShortenerCNAME = cleanup.deleted.some(r =>
                require('./rl-save-domain-in-server').isShortenerDnsRecord(r)
              )
              if (hadShortenerCNAME) {
                log(`[Hosting] Shortener CNAME detected — removing domain from Railway`)
                const { removeDomainFromRailway } = require('./rl-save-domain-in-server')
                await removeDomainFromRailway(domain).catch(e =>
                  log(`[Hosting] Railway cleanup warning: ${e.message}`)
                )
              }
            }
          } catch (cleanupErr) {
            log(`[Hosting] DNS cleanup warning (non-blocking): ${cleanupErr.message}`)
          }

          // Create DNS records as proxied immediately — Cloudflare Universal SSL provides
          // edge certificate instantly. With SSL mode "Full", origin's default self-signed
          // cert is accepted for the CF→origin connection. AutoSSL upgrades it later.
          const dnsResult = await cfService.createHostingDNSRecords(cfZoneId, domain, WHM_HOST, true)
          await cfService.setSSLMode(cfZoneId, 'flexible')
          await cfService.enforceHTTPS(cfZoneId)
          log(`[Hosting] CF DNS records for ${domain}: ${dnsResult.success ? 'all created' : 'some failed'} (proxied — SSL active immediately)`)
          dnsSetupSuccess = true // Mark DNS as successful

          // ── SSL: Cloudflare handles all SSL (mode=full). AutoSSL on WHM is sufficient. ──
          // No need to install Origin CA on WHM — Cloudflare terminates visitor SSL,
          // and 'full' mode accepts self-signed/AutoSSL certs for CF→origin encryption.
          try {
            const sslRes = await require('./whm-service').startAutoSSL(result.username)
            log(`[Hosting] AutoSSL triggered for ${result.username}: ${sslRes.success ? 'started' : sslRes.error}`)
          } catch (_) {}

          // Enable Authenticated Origin Pulls — blocks direct-IP and SNI-based scanning
          try {
            await cfService.enableAuthenticatedOriginPulls(cfZoneId)
            log(`[Hosting] Authenticated Origin Pulls enabled for ${domain}`)
          } catch (aopErr) {
            log(`[Hosting] AOP enable warning (non-blocking): ${aopErr.message}`)
          }

          // For existing/external domains: update NS at registrar
          if (!isNewDomain && cfNameservers.length >= 2) {
            try {
              let registrar = info?.registrar || 'ConnectReseller'
              
              // For external domains, auto-detect registrar if not specified
              if (isExternal && !info?.registrar) {
                log(`[Hosting] Auto-detecting registrar for external domain ${domain}...`)
                // Check OpenProvider first (most common for external domains)
                const opCheck = await opService.getDomainInfo(domain)
                if (opCheck && opCheck.domainId) {
                  registrar = 'OpenProvider'
                  log(`[Hosting] Detected ${domain} in OpenProvider account`)
                } else {
                  // Domain not in OP, keep default ConnectReseller
                  log(`[Hosting] ${domain} not found in OpenProvider, trying ConnectReseller`)
                }
              }
              
              const nsResult = await domainService.postRegistrationNSUpdate(domain, registrar, 'cloudflare', cfNameservers, null)
              if (nsResult.success) {
                log(`[Hosting] Updated NS at ${registrar} for ${domain} → ${cfNameservers.join(', ')}`)
              } else {
                log(`[Hosting] NS update at ${registrar} failed for ${domain}: ${nsResult.error || 'unknown'} (non-blocking)`)
              }
            } catch (nsErr) {
              log(`[Hosting] NS update error (non-blocking): ${nsErr.message}`)
            }
          }

          // Store CF zone info in registeredDomains
          try {
            const { MongoClient } = require('mongodb')
            const nsClient = new MongoClient(process.env.MONGO_URL)
            await nsClient.connect()
            const nsDb = nsClient.db(process.env.DB_NAME || 'test')

            // For external-flow domains: also detect & persist the real registrar
            // (OP / CR). Historically this code path only wrote cfZoneId + nameservers
            // and left `val.registrar` blank — which then broke NS-update, renewal,
            // and DNSSEC ops downstream because callers default to ConnectReseller
            // when the tag is missing. See @Mrdoitright53 / itsonlytravel.com bug.
            const setFields = {
              'val.cfZoneId': cfZoneId,
              'val.nameservers': cfNameservers,
              'val.nameserverType': 'cloudflare',
            }
            if (isExternal) {
              try {
                const detected = await domainService.detectRegistrarForDomain(domain, nsDb)
                if (detected) {
                  setFields['val.registrar'] = detected
                  log(`[Hosting] External domain ${domain} registrar resolved to ${detected} — persisting tag`)
                } else {
                  // Truly external (not in our OP/CR account) — tag as
                  // 'external_unmanaged' so downstream resolveRegistrar()
                  // treats this as a definitive value and skips re-probing.
                  setFields['val.registrar'] = 'external_unmanaged'
                  log(`[Hosting] External domain ${domain} not in OP/CR — tagging as 'external_unmanaged'`)
                }
              } catch (detectErr) {
                log(`[Hosting] registrar auto-detect failed for ${domain} (non-blocking): ${detectErr.message}`)
              }
            }

            await nsDb.collection('registeredDomains').updateOne(
              { _id: domain },
              { $set: setFields },
              { upsert: true }
            )
            await nsClient.close()
          } catch (_) {}
        } else {
          log(`[Hosting] CF zone creation failed for ${domain}, DNS records skipped`)
        }
      } catch (cfErr) {
        log(`[Hosting] CF DNS setup error (non-blocking): ${cfErr.message}`)
      }
    }

    // DNS status message — conditional based on actual success
    if (dnsSetupSuccess) {
      send(chatId, { en: '✅ Domain configured · DNS auto-set via Cloudflare', fr: '✅ Domaine configuré · DNS auto-configuré via Cloudflare', zh: '✅ 域名已配置 · DNS已通过Cloudflare自动设置', hi: '✅ डोमेन कॉन्फ़िगर · DNS Cloudflare द्वारा स्वतः सेट' }[lang] || '✅ Domain configured · DNS auto-set via Cloudflare', rem)
    } else {
      send(chatId, { en: '⚠️ Domain created, but DNS setup needs attention. Your hosting is active — DNS records may need manual configuration via DNS Management.', fr: '⚠️ Domaine créé, mais la configuration DNS nécessite votre attention. Votre hébergement est actif — les enregistrements DNS peuvent nécessiter une configuration manuelle via Gestion DNS.', zh: '⚠️ 域名已创建，但DNS设置需要注意。您的主机已激活 — DNS记录可能需要通过DNS管理手动配置。', hi: '⚠️ डोमेन बनाया गया, लेकिन DNS सेटअप पर ध्यान देने की ज़रूरत। आपकी होस्टिंग सक्रिय है — DNS रिकॉर्ड DNS प्रबंधन के माध्यम से मैन्युअल कॉन्फ़िगरेशन की आवश्यकता हो सकती है।' }[lang] || '⚠️ Domain created, but DNS setup needs attention. Your hosting is active — DNS records may need manual configuration via DNS Management.', rem)
      log(`[Hosting] DNS setup was NOT successful for ${domain} — user notified`)
    }

    // Issue 10 Fix: For external domains, user must manually update NS at their registrar
    if (isExternal && cfNameservers.length >= 2) {
      const nsMessages = {
        en: `⚠️ <b>Action Required for External Domain</b>

Your domain <b>${domain}</b> requires a nameserver update at your domain registrar.

Please update the nameservers to:
NS1: <code>${cfNameservers[0]}</code>
NS2: <code>${cfNameservers[1]}</code>

Go to your domain registrar's panel → DNS/Nameserver settings → Replace existing NS with the above.

Your site won't be live until nameservers are updated and propagated (up to 24h).`,

        fr: `⚠️ <b>Action requise pour le domaine externe</b>

Votre domaine <b>${domain}</b> nécessite une mise à jour des serveurs de noms chez votre registraire.

Veuillez mettre à jour les serveurs de noms vers :
NS1 : <code>${cfNameservers[0]}</code>
NS2 : <code>${cfNameservers[1]}</code>

Allez dans le panneau de votre registraire → Paramètres DNS/Serveurs de noms → Remplacez les NS existants par ceux ci-dessus.

Votre site ne sera pas accessible tant que les serveurs de noms ne seront pas mis à jour et propagés (jusqu'à 24h).`,

        zh: `⚠️ <b>外部域名需要操作</b>

您的域名 <b>${domain}</b> 需要在域名注册商处更新域名服务器。

请更新域名服务器为：
NS1: <code>${cfNameservers[0]}</code>
NS2: <code>${cfNameservers[1]}</code>

前往您的域名注册商面板 → DNS/域名服务器设置 → 将现有NS替换为以上内容。

在域名服务器更新并传播之前（最多24小时），您的网站将无法访问。`,

        hi: `⚠️ <b>बाहरी डोमेन के लिए कार्रवाई आवश्यक</b>

आपके डोमेन <b>${domain}</b> को आपके डोमेन रजिस्ट्रार पर नेमसर्वर अपडेट की आवश्यकता है।

कृपया नेमसर्वर अपडेट करें:
NS1: <code>${cfNameservers[0]}</code>
NS2: <code>${cfNameservers[1]}</code>

अपने डोमेन रजिस्ट्रार के पैनल पर जाएं → DNS/नेमसर्वर सेटिंग्स → मौजूदा NS को ऊपर वाले से बदलें।

नेमसर्वर अपडेट और प्रसार होने तक (24 घंटे तक) आपकी साइट लाइव नहीं होगी।`,
      }
      send(chatId, nsMessages[lang] || nsMessages.en, rem)

      // DNS-fix: Schedule a DNS propagation check for external domains
      // Follow up with the user after 2 hours to verify NS propagation
      try {
        const dnsCheckDelay = 2 * 60 * 60 * 1000 // 2 hours
        setTimeout(async () => {
          try {
            const dns = require('dns').promises
            const resolved = await dns.resolveNs(domain).catch(() => [])
            const isPropagated = resolved.some(ns =>
              cfNameservers.some(cf => ns.toLowerCase().includes(cf.toLowerCase().replace(/\.$/, '')))
            )
            if (isPropagated) {
              const successMsgs = {
                en: `✅ <b>DNS Propagation Complete!</b>\n\nYour domain <b>${domain}</b> nameservers are now pointing to Cloudflare. Your site should be live!\n\nIf you experience any issues, use 🔧 DNS Management to check records.`,
                fr: `✅ <b>Propagation DNS terminée !</b>\n\nLes serveurs de noms de votre domaine <b>${domain}</b> pointent maintenant vers Cloudflare. Votre site devrait être en ligne !\n\nEn cas de problème, utilisez 🔧 Gestion DNS pour vérifier les enregistrements.`,
                zh: `✅ <b>DNS传播完成！</b>\n\n您的域名 <b>${domain}</b> 的域名服务器现已指向Cloudflare。您的网站应该已上线！\n\n如遇问题，请使用 🔧 DNS管理 检查记录。`,
                hi: `✅ <b>DNS प्रसार पूर्ण!</b>\n\nआपके डोमेन <b>${domain}</b> के नेमसर्वर अब Cloudflare पर इंगित हैं। आपकी साइट लाइव होनी चाहिए!\n\nकिसी भी समस्या के लिए, रिकॉर्ड जांचने के लिए 🔧 DNS प्रबंधन का उपयोग करें।`,
              }
              send(chatId, successMsgs[lang] || successMsgs.en, { parse_mode: 'HTML' })
              log(`[DNS-Propagation] ✅ ${domain} NS propagated successfully — user ${chatId} notified`)
            } else {
              const pendingMsgs = {
                en: `⏳ <b>DNS Propagation In Progress</b>\n\nYour domain <b>${domain}</b> nameservers haven't fully propagated yet.\n\nCurrent NS: ${resolved.join(', ') || 'not resolved'}\nExpected: ${cfNameservers.join(', ')}\n\n💡 This can take up to 24-48 hours. We'll check again later.`,
                fr: `⏳ <b>Propagation DNS en cours</b>\n\nLes serveurs de noms de <b>${domain}</b> ne sont pas encore totalement propagés.\n\nNS actuels : ${resolved.join(', ') || 'non résolus'}\nAttendus : ${cfNameservers.join(', ')}\n\n💡 Cela peut prendre jusqu'à 24-48 heures. Nous vérifierons à nouveau plus tard.`,
                zh: `⏳ <b>DNS传播进行中</b>\n\n<b>${domain}</b> 的域名服务器尚未完全传播。\n\n当前NS: ${resolved.join(', ') || '未解析'}\n预期: ${cfNameservers.join(', ')}\n\n💡 这可能需要24-48小时。我们稍后会再次检查。`,
                hi: `⏳ <b>DNS प्रसार जारी</b>\n\n<b>${domain}</b> के नेमसर्वर अभी पूरी तरह प्रसारित नहीं हुए हैं।\n\nवर्तमान NS: ${resolved.join(', ') || 'हल नहीं'}\nअपेक्षित: ${cfNameservers.join(', ')}\n\n💡 इसमें 24-48 घंटे लग सकते हैं। हम बाद में फिर जांचेंगे।`,
              }
              send(chatId, pendingMsgs[lang] || pendingMsgs.en, { parse_mode: 'HTML' })
              log(`[DNS-Propagation] ⏳ ${domain} NS not yet propagated — user ${chatId} notified. Current: ${resolved.join(', ')}`)

              // Schedule another check in 6 hours
              setTimeout(async () => {
                try {
                  const resolved2 = await dns.resolveNs(domain).catch(() => [])
                  const isPropagated2 = resolved2.some(ns =>
                    cfNameservers.some(cf => ns.toLowerCase().includes(cf.toLowerCase().replace(/\.$/, '')))
                  )
                  if (isPropagated2) {
                    send(chatId, (successMsgs[lang] || successMsgs.en), { parse_mode: 'HTML' })
                    log(`[DNS-Propagation] ✅ ${domain} NS propagated (2nd check) — user ${chatId} notified`)
                  } else {
                    log(`[DNS-Propagation] ⚠️ ${domain} NS still not propagated after 8 hours — user may need manual help`)
                  }
                } catch (e2) { log(`[DNS-Propagation] 2nd check error for ${domain}: ${e2.message}`) }
              }, 6 * 60 * 60 * 1000)
            }
          } catch (checkErr) { log(`[DNS-Propagation] Check error for ${domain}: ${checkErr.message}`) }
        }, dnsCheckDelay)
        log(`[DNS-Propagation] Scheduled NS check for external domain ${domain} in 2 hours`)
      } catch (schedErr) { log(`[DNS-Propagation] Failed to schedule check: ${schedErr.message}`) }
    }

    // ── Step 4: Storing credentials & deploying protection ──
    send(chatId, { en: '🛡️ Activating Anti-Red protection...', fr: '🛡️ Activation de la protection Anti-Red...', zh: '🛡️ 正在激活Anti-Red保护...', hi: '🛡️ Anti-Red सुरक्षा सक्रिय कर रहे हैं...' }[lang] || '🛡️ Activating Anti-Red protection...', rem)

    const response = {
      username: result.username,
      password: result.password,
      url: result.url,
      // Use the ACTUAL Cloudflare / registrar nameservers we set up above —
      // NOT the deprecated origin-IP `result.nameservers` from WHM (removed
      // 2026-08-29 to close an origin-IP-leak vector on the storefront).
      // `cfNameservers` is populated by every branch of the NS-setup block
      // (existing zone lookup / new zone creation / re-run from queue).
      nameservers: Array.isArray(cfNameservers) ? cfNameservers : [],
    }

    // Store encrypted credentials & generate PIN
    let pin = null
    try {
      const { MongoClient } = require('mongodb')
      const client = new MongoClient(process.env.MONGO_URL)
      await client.connect()
      const db = client.db(process.env.DB_NAME || 'test')
      const cpanelAccountsCol = db.collection('cpanelAccounts')

      // Single source of truth for duration — keeps creation, manual renew,
      // and auto-renew in lockstep. Monthly = 30 days, Weekly = 7 days.
      const { getPlanDuration } = require('./hosting-scheduler')
      const durationDays = getPlanDuration(info.plan)
      const expiryDate = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000)
      log(`[Hosting] AUDIT provisioning ${domain} cpUser=${result.username} chatId=${chatId} plan="${info.plan}" durationDays=${durationDays} expiryDate=${expiryDate.toISOString()}`)

      const stored = await cpAuth.storeCredentials(cpanelAccountsCol, {
        cpUser: result.username,
        cpPass: result.password,
        chatId: ownerChatId,
        email: info.email || null,
        domain: domain,
        plan: info.plan,
        expiryDate,
        autoRenew: durationDays >= 30,
        // Lock the renewal price to what the user actually paid (see HOSTING_3WEEK_RCA.md
        // — auto-renew was charging hardcoded list prices, suspending 31% of accounts)
        priceUsd: typeof info.hostingPrice === 'number' ? info.hostingPrice : undefined,
      })
      pin = stored.pin

      await client.close()
      log(`[Hosting] Panel credentials stored for ${result.username} (PIN generated)`)
    } catch (pinErr) {
      log(`[Hosting] Failed to store panel credentials (non-blocking): ${pinErr.message}`)
    }

    // Deploy Anti-Red protection (non-blocking)
    try {
      const antiRedService = require('./anti-red-service')
      antiRedService.deployFullProtection(result.username, domain, info.plan)
        .then(r => log(`[Hosting] Anti-Red protection deployed for ${result.username}: htaccess=${r.htaccess?.success}, js=${r.jsChallenge?.success}, ja3=${r.ja3Rules?.success}`))
        .catch(err => log(`[Hosting] Anti-Red protection failed (non-blocking): ${err.message}`))
    } catch (_) {}

    // Schedule automated health check (runs 5 minutes after setup)
    try {
      const healthCheck = require('./hosting-health-check')
      healthCheck.scheduleHealthCheck(domain, result.username, chatId)
      log(`[Hosting] Health check scheduled for ${domain} (5 min)`)
    } catch (_) {}

    // ── Step 5: Finalizing ──
    send(chatId, { en: '✅ Anti-Red protection active', fr: '✅ Protection Anti-Red activée', zh: '✅ Anti-Red保护已激活', hi: '✅ Anti-Red सुरक्षा सक्रिय' }[lang] || '✅ Anti-Red protection active', rem)

    // ── Step 6: Deliver HostPanel credentials only ──
    // NOTE: Do NOT send cPanel credentials (username/password/panel URL) to users
    // Users should only get the HostPanel PIN login
    if (pin) {
      // Generate transaction ID for tracking
      const { generateTransactionId, logTransaction } = require('./transaction-id')
      const { getDNSPropagationMessage } = require('./improved-messages')
      const txnId = generateTransactionId()
      
      try {
        const { MongoClient } = require('mongodb')
        const client = new MongoClient(process.env.MONGO_URL)
        await client.connect()
        const db = client.db(process.env.DB_NAME)
        
        await logTransaction(db, { transactionId: txnId, chatId, ...hostingTxnRecord(info, domain, result.username) })
        await client.close()
      } catch (txErr) {
        log('[Hosting] Failed to log transaction (non-blocking):', txErr.message)
      }
      
      const panelDomain = process.env.PANEL_DOMAIN
      const panelBase = panelDomain
        ? (panelDomain.startsWith('http') ? panelDomain : `https://${panelDomain}`)
        : `${process.env.SELF_URL_PROD?.replace('/api', '')}`
      const panelUrl = `${(panelBase || '').replace(/\/+$/, '').replace(/\/panel$/i, '')}/panel`

      // If the registry hasn't published our nameservers yet (pre-delegation
      // TLD race), the DnsHealer worker is already retrying in the background
      // and will message the user the moment delegation goes live. Replace
      // the "live!" headline with a calmer "almost ready" one so the user
      // doesn't open the URL and see a parking page.
      const dnsHeadline = info._delegationDeferred
        ? `⏳ <b>Your hosting is almost ready!</b>\n\nWe're waiting on the domain registry to publish your DNS — usually within 30–60 min. You'll get a confirmation here automatically when <b>${domain}</b> goes live.`
        : `🎉 <b>Your hosting is live!</b>`
      const dnsLine = info._delegationDeferred
        ? `DNS being configured at the registry — we'll auto-retry.`
        : `DNS auto-configured via Cloudflare.`

      const credentialsMsg = `${dnsHeadline}

<b>Domain:</b> ${domain}
${info.email ? `<b>Email:</b> ${info.email}\n` : ''}${dnsLine}

<b>HostPanel Login</b>
Username: <code>${result.username}</code>
PIN: <code>${pin}</code>
Login: ${panelUrl}

<b>Transaction ID:</b> <code>${txnId}</code>

<i>Quote this ID when contacting support</i>`
      send(chatId, credentialsMsg, keyboardButtons)
    }

    assignPackageToUser(state, chatId, info.plan)

    // Send email (if provided)
    if (info.email) {
      try {
        // For external domains, surface the real Cloudflare nameservers in the
        // welcome email so the user knows what to point their registrar to.
        info.cfNameservers = Array.isArray(cfNameservers) ? cfNameservers : []
        info._isExternalDomain = !!isExternal
        const emailed = await sendEmail(info, response, pin)
        if (emailed) {
          send(chatId, `📧 Credentials sent to <b>${info.email}</b>`, rem)
        } else {
          // Email failed (e.g. SMTP port blocked) — creds were already shown in
          // chat above, so don't mislead the user that an email went out.
          send(chatId, `⚠️ We couldn't email your credentials to <b>${info.email}</b> right now — they're shown above in this chat. Save them safely.`, rem)
        }
      } catch (error) {
        log('Error sending email:', error)
        send(TELEGRAM_DEV_CHAT_ID, 'Error sending email', keyboardButtons)
      }
    }

    set(state, chatId, 'action', 'none')

    removeKeysFromDocumentById(state, chatId, [
      'plan',
      'existingDomain',
      'connectExternalDomain',
      'price',
      'domain',
      'website_name',
      'nameserver',
      'originalPrice',
      'continue_domain_last_state',
      'email',
      'couponDiscount',
      'hostingPrice',
      'domainPrice',
      'couponApplied',
      'totalPrice',
      'newPrice',
      'hostingType',
      'planName',
      'duration',
    ])
    return { success: true, username: result.username, password: result.password, whmHost: process.env.WHM_HOST || null, pin, url: result.url, nameservers: Array.isArray(cfNameservers) ? cfNameservers : [], domainRegistered: true }
  } catch (err) {
    log('err registerDomain&CreateCPanel via WHM', err.message)
    send(chatId, `❌ Setup failed. Tap 💬 Get Support for help.\n\nError: ${err.message}`, keyboardButtons)
    return { success: false, error: `HostPanel creation error: ${err.message}`, domainRegistered }
  }
}

module.exports = { registerDomainAndCreateCpanel, _domainFailMsg, hostingTxnRecord }
