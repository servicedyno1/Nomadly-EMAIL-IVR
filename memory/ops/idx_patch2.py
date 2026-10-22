p='/app/js/_index.js'
s=open(p,encoding='utf-8').read()
def rep(old,new,count=1):
    global s
    assert s.count(old)==count, (old[:100], s.count(old))
    s=s.replace(old,new)

# 1. Wallet path
rep("""        orderResult = await telnyxApi.buyNumber(
          selectedNumber,
          telnyxResources.sipConnectionId,
          telnyxResources.messagingProfileId,
          { countryCode, numberType: info?.cpNumberType || 'local', areaCode: info?.cpAreaCode || null }
        )""",
"""        orderResult = await telnyxPaidCheckout(chatId, selectedNumber, {
          countryCode, countryName, numberType: info?.cpNumberType || 'local', areaCode: info?.cpAreaCode || null,
          capabilities: info?.cpSelectedCapabilities, isSubNumber: !!info?.cpIsSubNumber, planKey, price: priceUsd,
          refund: { currency: 'usd', amount: priceUsd }, paymentMethod: 'wallet_usd', lang: info?.userLanguage || 'en',
        })
        if (orderResult?._verification) return""")

# 2. Bank NGN path
rep("""    let orderResult = await telnyxApi.buyNumber(selectedNumber, telnyxResources.sipConnectionId, telnyxResources.messagingProfileId, { countryCode, numberType: info?.cpNumberType || 'local', areaCode: info?.cpAreaCode || null })
    if (orderResult?._retriedNumber) selectedNumber = orderResult._retriedNumber""",
"""    let orderResult = await telnyxPaidCheckout(chatId, selectedNumber, {
      countryCode, countryName, numberType: info?.cpNumberType || 'local', areaCode: info?.cpAreaCode || null,
      capabilities: info?.cpSelectedCapabilities, isSubNumber: !!info?.cpIsSubNumber, planKey, price,
      refund: { currency: 'ngn', amount: Math.min(Number(ngnIn) || 0, Number(ngnPrice) || Number(ngnIn) || 0) }, paymentMethod: 'bank_ngn', lang,
    })
    if (orderResult?._verification) return res.send(html())
    if (orderResult?._retriedNumber) selectedNumber = orderResult._retriedNumber""")

# 3. BlockBee path
rep("""  const orderResult = await telnyxApi.buyNumber(selectedNumber, telnyxResources.sipConnectionId, telnyxResources.messagingProfileId, { countryCode, numberType: info?.cpNumberType || 'local', areaCode: info?.cpAreaCode || null })
  if (orderResult?._retriedNumber) selectedNumber = orderResult._retriedNumber
  if (!orderResult) { addFundsTo(walletOf, chatId, 'usd', Number(price) + excessUsd, lang); return res.send(html(phoneConfig.getMsg(lang).purchaseFailed)) }
  // Credit excess to wallet only after successful purchase
  if (excessUsd > 0)""",
"""  const orderResult = await telnyxPaidCheckout(chatId, selectedNumber, {
    countryCode, countryName, numberType: info?.cpNumberType || 'local', areaCode: info?.cpAreaCode || null,
    capabilities: info?.cpSelectedCapabilities, isSubNumber: !!info?.cpIsSubNumber, planKey, price: Number(price),
    refund: { currency: 'usd', amount: Number(price) }, paymentMethod: 'crypto_' + coin, lang,
  })
  if (orderResult?._verification) {
    await auditCryptoTx(chatId, 'phone-number', price, { phoneNumber: selectedNumber, plan: planKey, countryCode, provider: 'telnyx', coin, value, ref, verification: true }, 'blockbee')
    if (excessUsd > 0) { addFundsTo(walletOf, chatId, 'usd', excessUsd, lang); sendMessage(chatId, translation('t.sentMoreMoney', lang, `$${price}`, `$${usdIn}`)) }
    return res.send(html())
  }
  if (orderResult?._retriedNumber) selectedNumber = orderResult._retriedNumber
  if (!orderResult) { addFundsTo(walletOf, chatId, 'usd', Number(price) + excessUsd, lang); return res.send(html(phoneConfig.getMsg(lang).purchaseFailed)) }
  // Credit excess to wallet only after successful purchase
  if (excessUsd > 0)""")

# 4. DynoPay path
rep("""  const orderResult = await telnyxApi.buyNumber(selectedNumber, telnyxResources.sipConnectionId, telnyxResources.messagingProfileId, { countryCode, numberType: info?.cpNumberType || 'local', areaCode: info?.cpAreaCode || null })
  if (orderResult?._retriedNumber) selectedNumber = orderResult._retriedNumber
  if (!orderResult) { addFundsTo(walletOf, chatId, 'usd', Number(price) + excessUsd, lang); return res.send(html(phoneConfig.getMsg(lang).purchaseFailed)) }
  // Credit excess to wallet only after successful purchase (DynoPay)""",
"""  const orderResult = await telnyxPaidCheckout(chatId, selectedNumber, {
    countryCode, countryName, numberType: info?.cpNumberType || 'local', areaCode: info?.cpAreaCode || null,
    capabilities: info?.cpSelectedCapabilities, isSubNumber: !!info?.cpIsSubNumber, planKey, price: Number(price),
    refund: { currency: 'usd', amount: Number(price) }, paymentMethod: 'crypto_dynopay_' + coin, lang,
  })
  if (orderResult?._verification) {
    if (excessUsd > 0) { addFundsTo(walletOf, chatId, 'usd', excessUsd, lang); sendMessage(chatId, translation('t.sentMoreMoney', lang, `$${price}`, `$${usdIn}`)) }
    return res.send(html())
  }
  if (orderResult?._retriedNumber) selectedNumber = orderResult._retriedNumber
  if (!orderResult) { addFundsTo(walletOf, chatId, 'usd', Number(price) + excessUsd, lang); return res.send(html(phoneConfig.getMsg(lang).purchaseFailed)) }
  // Credit excess to wallet only after successful purchase (DynoPay)""")

# 5. Media routing (photos + files) for the Telnyx verification
rep("""  // ── Handle photo messages for Regulatory Document Collection ──
  if (msg?.photo && chatId) {""",
"""  // ── Telnyx verification (pay-first): ID / proof-of-address photos & files ──
  if ((msg?.photo || msg?.document) && chatId) {
    const userInfo = await get(state, chatId)
    if (userInfo?.action === 'cpTxReg') {
      const handled = await handleTelnyxVerificationInput(chatId, { photo: msg.photo, document: msg.document }, userInfo?.userLanguage || 'en')
      if (handled) return
    }
  }

  // ── Handle photo messages for Regulatory Document Collection ──
  if (msg?.photo && chatId) {""")

# 6. /cancel global + text routing
rep("""  if (message === '/cancel') {
    const incompleteDoc = await regulatoryFlow.getIncompleteSession(chatId)
    if (incompleteDoc) {
      await regulatoryFlow.cancelAndRefund(chatId)
      return // cancelAndRefund sends its own refund confirmation message
    }
    // No orphaned session — fall through to normal action handling
  }""",
"""  if (message === '/cancel') {
    const incompleteDoc = await regulatoryFlow.getIncompleteSession(chatId)
    if (incompleteDoc) {
      await regulatoryFlow.cancelAndRefund(chatId)
      return // cancelAndRefund sends its own refund confirmation message
    }
    if (await cancelTelnyxVerification(chatId, info?.userLanguage || 'en')) return
    // No orphaned session — fall through to normal action handling
  }

  // Telnyx verification (pay-first) — text answers + buttons
  if (action === a.cpTxReg && typeof message === 'string' && message) {
    if (await handleTelnyxVerificationInput(chatId, { text: message }, info?.userLanguage || 'en')) return
    action = 'none'
  }""")

# 7. Hub: offer resume for Telnyx sessions too
rep("""      const incompleteDoc = await regulatoryFlow.getIncompleteSession(chatId)
      if (incompleteDoc) {
        const lang = info?.userLanguage || 'en'""",
"""      const incompleteDoc = await regulatoryFlow.getIncompleteSession(chatId) || await txReg.getIncompleteSession(chatId)
      if (incompleteDoc) {
        const lang = info?.userLanguage || 'en'""")

# 8. Resume / restart / cancel menu
rep("""    if (message === resumeBtn) {
      const resumed = await regulatoryFlow.resumeSession(chatId)
      if (!resumed) {""",
"""    const txSession = await txReg.getIncompleteSession(chatId)
    if (txSession && !(await regulatoryFlow.getIncompleteSession(chatId))) {
      if (message === resumeBtn || message === restartBtn) {
        const p = message === resumeBtn ? await txReg.resumePrompt(chatId, lang) : await txReg.restartSession(chatId, lang)
        if (p) {
          await set(state, chatId, 'action', a.cpTxReg)
          return send(chatId, p.text, { parse_mode: 'HTML', reply_markup: { keyboard: p.keyboard, resize_keyboard: true } })
        }
      }
      if (message === cancelBtn && await cancelTelnyxVerification(chatId, lang)) return
      return goto.submenu5()
    }
    if (message === resumeBtn) {
      const resumed = await regulatoryFlow.resumeSession(chatId)
      if (!resumed) {""")
open(p,'w',encoding='utf-8').write(s)
print('ok')
