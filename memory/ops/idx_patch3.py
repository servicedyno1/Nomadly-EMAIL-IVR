p='/app/js/_index.js'
s=open(p,encoding='utf-8').read()
def rep(old,new,count=1):
    global s
    assert s.count(old)==count, (old[:100], s.count(old))
    s=s.replace(old,new)

rep("""    await saveInfo('cpSelectedCapabilities', caps)

    // Plan already selected at the start — go directly to Order Summary
    const planKey = info?.cpPlanKey || 'starter'
    const plan = phoneConfig.plans[planKey]
    const numberType = info?.cpNumberType || 'local'
    const countryCode = info?.cpCountryCode || 'US'
    const surcharge = getNumberSurcharge(countryCode, numberType)
    const totalPrice = plan.price + surcharge
""",
"""    await saveInfo('cpSelectedCapabilities', caps)

    // Plan already selected at the start — go directly to Order Summary
    const planKey = info?.cpPlanKey || 'starter'
    const plan = phoneConfig.plans[planKey]
    const numberType = info?.cpNumberType || 'local'
    const countryCode = info?.cpCountryCode || 'US'
    let surcharge = getNumberSurcharge(countryCode, numberType)
    let verifyNote = null
    // Telnyx international: live cost + tell the user BEFORE paying what verification follows
    if (isTelnyxIntl(selectedProvider, countryCode)) {
      const rq = await txReg.getRequirements(countryCode, numberType)
      if (!rq.ok) return send(chatId, txReg.T(lang).lookupFailed, { parse_mode: 'HTML' })
      if (rq.reqs.length && !txReg.analyze(rq.reqs).supported) return send(chatId, txReg.T(lang).unsupported(info?.cpCountryName || countryCode), { parse_mode: 'HTML' })
      verifyNote = txReg.prePayNote(rq.reqs, info?.cpCountryName || countryCode, lang) || null
      surcharge = getTelnyxIntlSurcharge(selected).monthly
    }
    await saveInfo('cpVerifyNote', verifyNote)
    const totalPrice = plan.price + surcharge
""")

rep("""    const base = Number(info?.cpPriceBase) || 0
    if (base > totalPrice) s += `\\n\\n🎟️ Coupon: <s>$${base.toFixed(2)}</s> → <b>$${totalPrice.toFixed(2)}</b>`
    return s
  }""",
"""    const base = Number(info?.cpPriceBase) || 0
    if (base > totalPrice) s += `\\n\\n🎟️ Coupon: <s>$${base.toFixed(2)}</s> → <b>$${totalPrice.toFixed(2)}</b>`
    if (info?.cpVerifyNote && !info?.cpIsSubNumber) s += `\\n\\n${info.cpVerifyNote}`
    return s
  }""")

rep("""    // Non-US or toll-free: search directly with the appropriate provider
    await set(state, chatId, 'action', a.cpSelectNumber)""",
"""    // Non-US or toll-free: search directly with the appropriate provider
    await saveInfo('cpAreaCode', null)
    await saveInfo('cpAreaName', null)
    await set(state, chatId, 'action', a.cpSelectNumber)""")

rep("""    const countryEntry = phoneConfig.allCountries.find(c => c.name === message) || phoneConfig.moreCountries.find(c => c.name === message)
    const nativeProvider = countryEntry?.provider || 'telnyx'
    await saveInfo('cpCountryCode', countryCode)
    await saveInfo('cpCountryName', message)
    await saveInfo('cpProvider', nativeProvider)
    const canSearchBoth = (nativeProvider === 'telnyx') && phoneConfig.isTwilioEnabled()
    await saveInfo('cpCanSearchBoth', canSearchBoth)
    await set(state, chatId, 'action', a.cpSubAddType)""",
"""    const countryEntry = phoneConfig.allCountries.find(c => c.name === message) || phoneConfig.moreCountries.find(c => c.name === message)
    const nativeProvider = countryEntry?.provider || 'telnyx'
    // Telnyx countries that need verification can only be bought as a main number
    if (nativeProvider === 'telnyx' && countryEntry?.verify) return send(chatId, txReg.T(lang).subNotSupported, { parse_mode: 'HTML' })
    await saveInfo('cpCountryCode', countryCode)
    await saveInfo('cpCountryName', message)
    await saveInfo('cpProvider', nativeProvider)
    const canSearchBoth = (nativeProvider === 'telnyx') && phoneConfig.isTwilioEnabled()
    await saveInfo('cpCanSearchBoth', canSearchBoth)
    await set(state, chatId, 'action', a.cpSubAddType)""")
open(p,'w',encoding='utf-8').write(s)
print('ok')
