p='/app/js/_index.js'
s=open(p,encoding='utf-8').read()
def rep(old,new,count=1):
    global s
    assert s.count(old)==count,(old[:90],s.count(old)); s=s.replace(old,new)

# 1. require + init
rep("""const txReg = require('./telnyx-regulatory.js') // Telnyx intl numbers: pre-payment verification + review tracking""",
"""const txReg = require('./telnyx-regulatory.js') // Telnyx intl numbers: pre-payment verification + review tracking
const rsApply = require('./reseller-apply.js') // 💼 Reseller in-bot application form (RESELLER_APPLY_FORM=true)""")
rep("""  txReg.init({ db, bot, log })""", """  txReg.init({ db, bot, log })
  rsApply.init({ db, brand: process.env.CHAT_BOT_BRAND })""")

# 2. module-level helpers
rep("""  return { reminded: remind.length, expired: expire.length }
}
""", """  return { reminded: remind.length, expired: expire.length }
}

// ── 💼 Reseller applications: ordered prompts, admin alert, Priority payment completion ──
async function sendResellerPrompt(chatId, p) {
  try {
    await bot.sendMessage(chatId, p.text, { parse_mode: 'HTML', reply_markup: { keyboard: p.keyboard, resize_keyboard: true } })
    if (p.inline) await bot.sendMessage(chatId, p.inline.text, { parse_mode: 'HTML', reply_markup: { inline_keyboard: p.inline.inline_keyboard } })
  } catch (e) { log(`[Reseller] prompt send failed for ${chatId}: ${e.message}`) }
}
async function alertResellerApplication(app, note = '') {
  try {
    const m = await bot.sendMessage(TELEGRAM_ADMIN_CHAT_ID, `${rsApply.adminText(app)}${note ? '\\n\\n' + note : ''}`, { parse_mode: 'HTML', reply_markup: rsApply.adminButtons(app) })
    if (m?.message_id) await rsApply.setAdminMsg(app._id, { chatId: String(TELEGRAM_ADMIN_CHAT_ID), messageId: m.message_id })
  } catch (e) { log(`[Reseller] admin alert failed for ${app._id}: ${e.message}`) }
}
// Every payment rail lands here once the $200 is in. Closed application → money goes to the wallet instead.
async function completeResellerPriority(chatId, appId, payment, lang) {
  const l = lang || 'en'
  const t = rsApply.T(l)
  const before = await rsApply.getById(appId)
  const doc = await rsApply.markPaid(appId, { method: payment.method, amountUsd: payment.amountUsd, ref: payment.ref || null })
  if (!doc) {
    const r = payment.refund || { currency: 'usd', amount: payment.amountUsd }
    await addFundsTo(walletOf, chatId, r.currency === 'ngn' ? 'ngn' : 'usd', Number(r.amount) || 0, l)
    const amt = r.currency === 'ngn' ? `₦${Number(r.amount).toLocaleString()}` : `$${Number(r.amount).toFixed(2)}`
    send(chatId, t.payClosed(amt), translation('o', l))
    notifyAdmin(`ℹ️ [Reseller] Priority payment for application ${String(appId).slice(0, 8)} (status ${before?.status || 'missing'}) → ${amt} credited to wallet\\nchatId: ${chatId}`)
    return false
  }
  send(chatId, t.paid, translation('o', l))
  await alertResellerApplication(doc, before?.status === 'pending' ? '⬆️ <i>Upgraded from Standard after payment.</i>' : '')
  return true
}
""")

# 3. callback queries (first handler)
rep("""    // ── Post-purchase action shortcuts (UX P-Domain/VPS/Phone #4, 2026-06-21) ──""",
"""    // ── 💼 Reseller application: service toggles, Continue, admin Approve/Reject ──
    if (data.startsWith('rsa:')) {
      const lang = (await get(state, chatId))?.userLanguage || 'en'
      const rt = rsApply.T(lang)
      const [, kind, arg] = data.split(':')
      const mid = query.message?.message_id
      const answer = (text, alert = false) => bot.answerCallbackQuery(query.id, text ? { text, show_alert: alert } : {}).catch(() => {})
      if (kind === 't') {
        const panel = await rsApply.toggleService(chatId, arg, lang)
        if (!panel) return answer(rt.stale)
        answer()
        return bot.editMessageText(panel.text, { chat_id: chatId, message_id: mid, parse_mode: 'HTML', reply_markup: { inline_keyboard: panel.inline_keyboard } }).catch(() => {})
      }
      if (kind === 'c') {
        const r = await rsApply.continueServices(chatId, lang)
        if (!r) return answer(rt.stale)
        if (r.error) return answer(r.error.replace(/<[^>]+>/g, ''), true)
        answer()
        bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: mid }).catch(() => {})
        return sendResellerPrompt(chatId, r.prompt)
      }
      if (kind === 'ok' || kind === 'no') {
        if (chatId !== String(TELEGRAM_ADMIN_CHAT_ID)) return answer('Admins only.', true)
        const by = query.from?.username ? '@' + query.from.username : String(query.from?.id || 'admin')
        const doc = await rsApply.decide(arg, kind === 'ok', by)
        if (!doc) {
          const cur = await rsApply.getById(arg)
          bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: mid }).catch(() => {})
          return answer(cur ? `Already ${cur.status.replace('_', ' ')}.` : 'Application not found.', true)
        }
        answer(kind === 'ok' ? 'Approved ✅' : 'Rejected ❌')
        const paid = doc.payment?.status === 'paid'
        const footer = kind === 'ok'
          ? `✅ <b>Approved</b> by ${rsApply.esc(by)}`
          : `❌ <b>Rejected</b> by ${rsApply.esc(by)}${paid ? `\\n💰 Paid $${doc.payment.amountUsd} (${rsApply.esc(doc.payment.method)}) — no automatic refund; refund manually if needed.` : ''}`
        bot.editMessageText(`${rsApply.adminText(doc)}\\n\\n${footer}`, { chat_id: chatId, message_id: mid, parse_mode: 'HTML' }).catch(() => {})
        const aLang = (await get(state, doc.chatId))?.userLanguage || doc.lang || 'en'
        const at = rsApply.T(aLang)
        send(doc.chatId, kind === 'ok' ? at.approved(rsApply.brand(), doc.tier === 'priority') : at.rejected(rsApply.brand()), translation('o', aLang))
        return
      }
      return answer()
    }

    // ── Post-purchase action shortcuts (UX P-Domain/VPS/Phone #4, 2026-06-21) ──""")

# 4. checkout order
rep("""      case 'bundleConfirm': return { step, total: n(cp && info?.newPrice ? info?.newPrice : info?.bundlePrice), label: info?.bundleName || 'bundle', walletOkKey: 'bundleConfirm' }""",
"""      case 'bundleConfirm': return { step, total: n(cp && info?.newPrice ? info?.newPrice : info?.bundlePrice), label: info?.bundleName || 'bundle', walletOkKey: 'bundleConfirm' }
      case 'reseller-pay': return { step, total: rsApply.PRIORITY_FEE_USD, label: 'Priority Reseller Setup', walletOkKey: step }""")

# 5. goto entries
rep("""    'choose-subscription': async () => {
      await set(state, chatId, 'action', 'choose-subscription')""",
"""    // 💼 Reseller: intro (no open application) or status screen (open one)
    resellerHome: async () => {
      const open = await rsApply.getOpen(chatId)
      const scr = open ? rsApply.statusScreen(open, lang) : rsApply.homeScreen(lang)
      await set(state, chatId, 'action', 'rsHome')
      if (open) await saveInfo('rsAppId', open._id)
      return send(chatId, scr.text, { parse_mode: 'HTML', reply_markup: { keyboard: scr.keyboard, resize_keyboard: true } })
    },
    resellerAsk: async () => {
      await set(supportSessions, chatId, Date.now())
      await saveInfo('action', a.supportChat)
      await set(state, chatId, 'adminTakeover', false)
      // Seed the AI with what the user just saw so its first answer is about reselling (50/50 split).
      await addSupportContext(chatId, `[User opened the 💼 Reseller page] ${t.becomeReseller.replace(/<[^>]+>/g, '')}`)
      send(chatId, t.becomeReseller, { parse_mode: 'HTML', reply_markup: { keyboard: [['/done', '🏠 Main Menu']], resize_keyboard: true } })
      const name = await get(nameOf, chatId)
      const userTag = name ? `@${name}` : (msg?.from?.username ? `@${msg.from.username}` : 'unknown')
      send(TELEGRAM_ADMIN_CHAT_ID, `💼 <b>Reseller enquiry</b> — support session opened\\nUser: <b>${userTag}</b> (${chatId})\\n\\n🤖 <i>AI will answer reseller questions first (50/50 profit share). You'll be notified if escalation is needed.</i>\\n\\nReply with: /reply ${chatId} <i>your message</i>\\nClose with: /close ${chatId}`, adminMsgOpts({ chatId, supportSession: true }))
      log(`[Support] Reseller enquiry session opened for ${chatId} ${name}`)
      scheduleSupportSlaNudge(chatId, name || msg?.from?.username || 'unknown', Date.now())
    },
    resellerSwitchStd: async () => {
      const open = await rsApply.getOpen(chatId)
      const doc = open && await rsApply.switchToStandard(open._id)
      if (!doc) return goto.resellerHome()
      await set(state, chatId, 'action', 'none')
      send(chatId, rsApply.T(lang).switched, trans('o'))
      return alertResellerApplication(doc)
    },
    'reseller-pay': async () => {
      const app = info?.rsAppId ? await rsApply.getById(info.rsAppId) : null
      if (!app || app.status !== 'pending_payment') return goto.resellerHome()
      await set(state, chatId, 'action', 'reseller-pay')
      return checkoutScreen('reseller-pay', rsApply.T(lang).checkout, { extraRows: [[rsApply.T(lang).btn.switchStd]] })
    },
    'choose-subscription': async () => {
      await set(state, chatId, 'action', 'choose-subscription')""")

# 6. text handlers (right after the Telnyx verification text handler)
rep("""  if (action === a.cpTxReg && typeof message === 'string' && message) {
    if (await handleTelnyxVerificationInput(chatId, { text: message }, info?.userLanguage || 'en')) return
    action = 'none'
  }""",
"""  if (action === a.cpTxReg && typeof message === 'string' && message) {
    if (await handleTelnyxVerificationInput(chatId, { text: message }, info?.userLanguage || 'en')) return
    action = 'none'
  }

  // 💼 Reseller — intro / status screen buttons
  if (action === 'rsHome' && typeof message === 'string' && message) {
    if (rsApply.isBtn(message, b => b.apply) || rsApply.isBtn(message, b => b.applyAgain)) {
      if (await rsApply.getOpen(chatId)) return goto.resellerHome()
      const p = await rsApply.start(chatId, { username: currentUsername || nameOfChatId || null, lang })
      await set(state, chatId, 'action', 'rsApply')
      return sendResellerPrompt(chatId, p)
    }
    if (rsApply.isBtn(message, b => b.ask)) return goto.resellerAsk()
    if (rsApply.isBtn(message, b => b.pay)) return goto['reseller-pay']()
    if (rsApply.isBtn(message, b => b.switchStd)) return goto.resellerSwitchStd()
    if (rsApply.isBtn(message, b => b.withdraw)) {
      const open = await rsApply.getOpen(chatId)
      const doc = open && await rsApply.withdraw(open._id)
      if (!doc) return goto.resellerHome()
      await set(state, chatId, 'action', 'none')
      if (doc.adminMsg) bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: doc.adminMsg.chatId, message_id: doc.adminMsg.messageId }).catch(() => {})
      if (open.status === 'pending') notifyAdmin(`🗑 [Reseller] Application ${String(doc._id).slice(0, 8)} withdrawn by the applicant (${chatId})`)
      return send(chatId, rsApply.T(lang).withdrawn, trans('o'))
    }
    await set(state, chatId, 'action', 'none')
    action = 'none'
  }

  // 💼 Reseller — application steps
  if (action === 'rsApply' && typeof message === 'string' && message) {
    const r = await rsApply.handleInput(chatId, message, lang)
    if (!r) { await set(state, chatId, 'action', 'none'); action = 'none' }
    else if (r.closed) return goto.resellerHome()
    else if (r.cancelled) { await set(state, chatId, 'action', 'none'); return send(chatId, r.text, trans('o')) }
    else if (r.submitted) {
      const doc = r.submitted
      if (doc.status === 'pending_payment') { await saveInfo('rsAppId', doc._id); return goto['reseller-pay']() }
      await set(state, chatId, 'action', 'none')
      send(chatId, rsApply.T(lang).submittedStd, trans('o'))
      return alertResellerApplication(doc)
    } else return sendResellerPrompt(chatId, r)
  }""")

# 7. payment actions (after crypto-pay-plan)
rep("""  //
  //
  if (message === user.dnsManagement && action !== 'view-domain-actions') {""",
"""  // ── 💼 Reseller Priority setup fee ($200): wallet / crypto / bank ──
  if (action === 'reseller-pay') {
    if (isBackPress(message)) return goto.resellerHome()
    if (rsApply.isBtn(message, b => b.switchStd)) return goto.resellerSwitchStd()
    const tap = hcx.parseCheckoutTap(message)
    if (tap) return runCheckoutTap('reseller-pay', tap)
    if (message === payIn.crypto) {
      await set(state, chatId, 'action', 'crypto-pay-reseller')
      return send(chatId, t.selectCryptoToDeposit, trans('k.of', trans('supportedCryptoViewOf')))
    }
    if (message === payIn.bank) {
      await set(state, chatId, 'action', 'bank-pay-reseller')
      return send(chatId, t.askEmail, bc)
    }
    if (message === payIn.wallet) {
      set(state, chatId, 'lastStep', 'reseller-pay')
      return goto.walletSelectCurrency()
    }
    return send(chatId, t.askValidPayOption)
  }
  if (action === 'bank-pay-reseller') {
    if (isBackPress(message)) return goto['reseller-pay']()
    const email = message
    if (!isValidEmail(email)) return send(chatId, t.askValidEmail)
    const app = info?.rsAppId ? await rsApply.getById(info.rsAppId) : null
    if (!app || app.status !== 'pending_payment') return goto.resellerHome()
    const price = rsApply.PRIORITY_FEE_USD
    const priceNGN = Number(await usdToNgn(price))
    if (!priceNGN || isNaN(priceNGN) || priceNGN <= 0) return send(chatId, trans('t.vps_91'), trans('o'))
    const ref = nanoid()
    await set(state, chatId, 'action', 'none')
    set(chatIdOfPayment, ref, { chatId, price, rsAppId: app._id, endpoint: '/bank-pay-reseller', _createdAt: new Date().toISOString() })
    const { url, error } = await createCheckout(priceNGN, `/ok?a=b&ref=${ref}&`, email, username, ref)
    if (error) return send(chatId, error, trans('o'))
    return send(chatId, rsApply.T(lang).bankPay(priceNGN.toLocaleString()), trans('payBank', url))
  }
  if (action === 'crypto-pay-reseller') {
    if (isBackPress(message)) return goto['reseller-pay']()
    const ticker = trans('supportedCryptoView')[message]
    if (!ticker) return send(chatId, t.askValidCrypto)
    const app = info?.rsAppId ? await rsApply.getById(info.rsAppId) : null
    if (!app || app.status !== 'pending_payment') return goto.resellerHome()
    const price = rsApply.PRIORITY_FEE_USD
    const ref = nanoid()
    const viaBlockBee = async () => {
      const bbResult = await getCryptoDepositAddress(tickerOf[ticker], chatId, SELF_URL, `/crypto-pay-reseller?a=b&ref=${ref}&`)
      if (!bbResult?.address) return null
      set(chatIdOfPayment, ref, { chatId, price, rsAppId: app._id })
      await sendQrCode(bot, chatId, bbResult.bb, lang)
      return bbResult.address
    }
    const viaDynopay = async () => {
      const coin = tickerOfDyno[ticker]
      if (!coin) return null
      const d = await getDynopayCryptoAddress(price, coin, `${SELF_URL}/dynopay/crypto-pay-reseller`, { product_name: dynopayActions.payResellerPriority, refId: ref })
      if (!d?.address) return null
      set(chatIdOfDynopayPayment, ref, { chatId, price, rsAppId: app._id, action: dynopayActions.payResellerPriority, address: d.address })
      await generateQr(bot, chatId, d.qr_code, lang)
      return d.address
    }
    const address = BLOCKBEE_CRYTPO_PAYMENT_ON === 'true' ? (await viaBlockBee() || await viaDynopay()) : (await viaDynopay() || await viaBlockBee())
    if (!address) return send(chatId, t.errorFetchingCryptoAddress, trans('o'))
    await set(state, chatId, 'action', 'none')
    const priceCrypto = await convert(price, 'usd', tickerOf[ticker])
    return send(chatId, t.showDepositCryptoInfo(price, priceCrypto, ticker, address), trans('o'))
  }
  //
  //
  if (message === user.dnsManagement && action !== 'view-domain-actions') {""")

# 8. walletOk
rep("""    'domain-pay': async coin => {
      await set(state, chatId, 'action', 'none')
      const shownPrice = info?.couponApplied ? info?.newPrice : info?.price""",
"""    'reseller-pay': async coin => {
      await set(state, chatId, 'action', 'none')
      const fee = rsApply.PRIORITY_FEE_USD
      const app = info?.rsAppId ? await rsApply.getById(info.rsAppId) : null
      if (!app || app.status !== 'pending_payment') return goto.resellerHome()
      const { usdBal } = await getBalance(walletOf, chatId)
      if (usdBal < fee) return _showBalanceWall(usdBal, fee)
      if (!(await atomicIncrement(walletOf, chatId, 'usdOut', fee))) return _showBalanceWall(usdBal, fee)
      const name = await get(nameOf, chatId)
      set(payments, nanoid(), `Wallet,ResellerPriority,${app._id},$${fee},${chatId},${name},${new Date()}`)
      _finalizeWalletPurchase()
      return completeResellerPriority(chatId, app._id, { method: 'wallet_usd', amountUsd: fee, refund: { currency: 'usd', amount: fee } }, lang)
    },

    'domain-pay': async coin => {
      await set(state, chatId, 'action', 'none')
      const shownPrice = info?.couponApplied ? info?.newPrice : info?.price""")

# 9. 💼 Reseller entry
rep("""  if (message === user.becomeReseller) {
    await set(supportSessions, chatId, Date.now())
    await saveInfo('action', a.supportChat)
    await set(state, chatId, 'adminTakeover', false)
    // Seed the AI with what the user just saw so its first answer is about reselling (50/50 split).
    await addSupportContext(chatId, `[User opened the 💼 Reseller page] ${t.becomeReseller.replace(/<[^>]+>/g, '')}`)
    send(chatId, t.becomeReseller, { parse_mode: 'HTML', reply_markup: { keyboard: [['/done', '🏠 Main Menu']], resize_keyboard: true } })
    const name = await get(nameOf, chatId)
    const userTag = name ? `@${name}` : (msg?.from?.username ? `@${msg.from.username}` : 'unknown')
    send(TELEGRAM_ADMIN_CHAT_ID, `💼 <b>Reseller enquiry</b> — support session opened\\nUser: <b>${userTag}</b> (${chatId})\\n\\n🤖 <i>AI will answer reseller questions first (50/50 profit share). You'll be notified if escalation is needed.</i>\\n\\nReply with: /reply ${chatId} <i>your message</i>\\nClose with: /close ${chatId}`, adminMsgOpts({ chatId, supportSession: true }))
    log(`[Support] Reseller enquiry session opened for ${chatId} ${name}`)
    scheduleSupportSlaNudge(chatId, name || msg?.from?.username || 'unknown', Date.now())
    return
  }""",
"""  if (message === user.becomeReseller) {
    if (process.env.RESELLER_APPLY_FORM === 'true') return goto.resellerHome()
    return goto.resellerAsk()
  }""")

# 10. webhooks
rep("""app.get('/crypto-pay-plan', auth, async (req, res) => {""",
"""// 💼 Reseller Priority setup fee — BlockBee
app.get('/crypto-pay-reseller', auth, async (req, res) => {
  const { ref, chatId, price, rsAppId } = req.pay
  const coin = req?.query?.coin
  const value = req?.query?.value_coin
  if (!ref || !chatId || !price || !rsAppId || !coin || !value) return log(translation('t.argsErr')) || res.send(html(translation('t.argsErr')))
  const info = await state.findOne({ _id: String(chatId) })
  const lang = info?.userLanguage ?? 'en'
  del(chatIdOfPayment, ref)
  const name = await get(nameOf, chatId)
  set(payments, ref, `Crypto,ResellerPriority,${rsAppId},$${price},${chatId},${name},${new Date()},${value} ${coin}`)
  const usdIn = await convert(value, coin, 'usd')
  if (usdIn < price) {
    sendMessage(chatId, translation('t.sentLessMoney', lang, `$${price}`, `$${usdIn}`), translation('o', lang))
    addFundsTo(walletOf, chatId, 'usd', usdIn, lang)
    return res.send(html(translation('t.lowPrice')))
  }
  if (usdIn > price) {
    addFundsTo(walletOf, chatId, 'usd', usdIn - price, lang)
    sendMessage(chatId, translation('t.sentMoreMoney', lang, `$${price}`, `$${usdIn}`))
  }
  await auditCryptoTx(chatId, 'reseller-priority', price, { rsAppId, coin, value, ref }, 'blockbee')
  await completeResellerPriority(chatId, rsAppId, { method: 'crypto_' + coin, amountUsd: price, ref, refund: { currency: 'usd', amount: price } }, lang)
  res.send(html())
})

app.get('/crypto-pay-plan', auth, async (req, res) => {""")
rep("""// Dynopay Domain
app.post('/dynopay/crypto-pay-domain', authDyno, async (req, res) => {""",
"""// 💼 Reseller Priority setup fee — DynoPay
app.post('/dynopay/crypto-pay-reseller', authDyno, async (req, res) => {
  const { ref, chatId, price, rsAppId } = req.pay
  const { amount: value, currency: coin, payment_id: id } = req.body
  if (!ref || !chatId || !price || !rsAppId || !coin || !value) return log(translation('t.argsErr')) || res.send(html(translation('t.argsErr')))
  const info = await state.findOne({ _id: String(chatId) })
  const lang = info?.userLanguage ?? 'en'
  del(chatIdOfDynopayPayment, ref)
  const name = await get(nameOf, chatId)
  set(payments, ref, `Crypto,ResellerPriority,${rsAppId},$${price},${chatId},${name},${new Date()},${value} ${coin},transaction,${id}`)
  const usdIn = await resolveCryptoCreditUsd(req, { chatId, coin, value, ticker: tickerViewOfDyno[coin], invoiceUsd: parseFloat(req.body.base_amount), feePayer: req.body.fee_payer })
  if (usdIn < price) {
    sendMessage(chatId, translation('t.sentLessMoney', lang, `$${price}`, `$${usdIn}`), translation('o', lang))
    addFundsTo(walletOf, chatId, 'usd', usdIn, lang)
    return res.send(html(translation('t.lowPrice')))
  }
  if (usdIn > price) {
    addFundsTo(walletOf, chatId, 'usd', usdIn - price, lang)
    sendMessage(chatId, translation('t.sentMoreMoney', lang, `$${price}`, `$${usdIn}`))
  }
  await auditCryptoTx(chatId, 'reseller-priority', price, { rsAppId, coin, value, ref, payment_id: id }, 'dynopay')
  await completeResellerPriority(chatId, rsAppId, { method: 'crypto_dynopay_' + coin, amountUsd: price, ref, refund: { currency: 'usd', amount: price } }, lang)
  res.send(html())
})

// Dynopay Domain
app.post('/dynopay/crypto-pay-domain', authDyno, async (req, res) => {""")

# 11. bank
rep("""  '/bank-pay-domain': async (req, res, ngnIn) => {""",
"""  '/bank-pay-reseller': async (req, res, ngnIn) => {
    const { ref, chatId, price, rsAppId } = req.pay || {}
    if (!ref || !chatId || !price || !rsAppId) return log(translation('t.argsErr')) || res.send(html(translation('t.argsErr')))
    const info = await state.findOne({ _id: String(chatId) })
    const lang = info?.userLanguage ?? 'en'
    del(chatIdOfPayment, ref)
    const usdIn = await ngnToUsd(ngnIn)
    const name = await get(nameOf, chatId)
    set(payments, ref, `Bank,ResellerPriority,${rsAppId},$${usdIn},${chatId},${name},${new Date()},₦${ngnIn}`)
    const ngnPrice = await usdToNgn(price)
    if (usdIn < price) {
      sendMessage(chatId, translation('t.sentLessMoney', lang, `${ngnPrice} NGN`, `${ngnIn} NGN`), translation('o', lang))
      addFundsTo(walletOf, chatId, 'ngn', ngnIn, lang)
      return res.send(html(translation('t.lowPrice')))
    }
    if (ngnIn > ngnPrice) {
      addFundsTo(walletOf, chatId, 'ngn', ngnIn - ngnPrice, lang)
      sendMessage(chatId, translation('t.sentMoreMoney', lang, `${ngnPrice} NGN`, `${ngnIn} NGN`))
    }
    await completeResellerPriority(chatId, rsAppId, { method: 'bank_ngn', amountUsd: price, ref, refund: { currency: 'ngn', amount: Math.min(Number(ngnIn) || 0, Number(ngnPrice) || 0) } }, lang)
    res.send(html())
  },
  '/bank-pay-domain': async (req, res, ngnIn) => {""")
open(p,'w',encoding='utf-8').write(s)
print('ok')
