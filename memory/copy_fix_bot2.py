def patch(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        assert n == 1, (path, n, old[:90])
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)
    print('patched', path.replace('/app/', ''), len(pairs))

J = '/app/js/'
PC = "const { CLOUD_COUNTRY_COUNT: N } = require('../phone-config')\n"

patch(J + 'promo-copy/en.js', [
    ("module.exports = {\n", PC + "module.exports = {\n"),
    ("'A local number in 30+ countries, live in 60 seconds'", "`A phone number in ${N} countries, most live in minutes`"),
    ("'Virtual numbers in 30+ countries — no SIM, no contract'", "`Virtual numbers in ${N} countries — no SIM, no contract`"),
])
patch(J + 'promo-copy/fr.js', [
    ("module.exports = {\n", PC + "module.exports = {\n"),
    ("'Un numéro local dans 30+ pays, actif en 60 secondes'", "`Un numéro dans ${N} pays, la plupart actifs en quelques minutes`"),
    ("'Numéros virtuels dans 30+ pays — sans SIM, sans engagement'", "`Numéros virtuels dans ${N} pays — sans SIM, sans engagement`"),
])
patch(J + 'promo-copy/hi.js', [
    ("module.exports = {\n", PC + "module.exports = {\n"),
    ("'30+ देशों में लोकल नंबर, 60 सेकंड में चालू'", "`${N} देशों में फ़ोन नंबर, ज़्यादातर कुछ ही मिनटों में चालू`"),
    ("'30+ देशों में वर्चुअल नंबर — न SIM, न कॉन्ट्रैक्ट'", "`${N} देशों में वर्चुअल नंबर — न SIM, न कॉन्ट्रैक्ट`"),
])
patch(J + 'promo-copy/zh.js', [
    ("module.exports = {\n", PC + "module.exports = {\n"),
    ("'30+ 国家的本地号码，60 秒开通'", "`${N} 个国家的电话号码，大多数几分钟内开通`"),
    ("'30+ 国家虚拟号码 — 无需 SIM 卡，无合约'", "`${N} 个国家虚拟号码 — 无需 SIM 卡，无合约`"),
])

C = "${require('./phone-config').CLOUD_COUNTRY_COUNT}"
patch(J + 'monetization-engine.js', [
    ("`Get a real phone number in 30+ countries with:\\n`", f"`Get a real phone number in {C} countries with:\\n`"),
    ("Numéros virtuels dans 30+ pays. À partir de", f"Numéros virtuels dans {C} pays. À partir de"),
    ("30+国家虚拟号码。方案从", f"{C} 个国家虚拟号码。方案从"),
    ("30+ देशों में वर्चुअल नंबर। <b>", f"{C} देशों में वर्चुअल नंबर। <b>"),
])
patch(J + 'new-user-conversion.js', [
    ("Real numbers in 30+ countries — calls, SMS, IVR, SIP, voicemail.", f"Real numbers in {C} countries — calls, SMS, IVR, SIP, voicemail."),
    ("Obtenez un vrai numéro dans 30+ pays — appels,", f"Obtenez un vrai numéro dans {C} pays — appels,"),
    ("在30多个国家获取真实号码——通话", f"在 {C} 个国家获取真实号码——通话"),
    ("30+ देशों में असली नंबर पाएं — कॉल", f"{C} देशों में असली नंबर पाएं — कॉल"),
])
patch(J + 'auto-promo.js', [
    ("details: ['Virtual phone numbers in 30+ countries, no SIM, no contract', 'IVR menu, voicemail, SMS forwarded to Telegram', 'SIP credentials for softphones, call forwarding anywhere', 'Active in about a minute'],",
     f"details: [`Virtual phone numbers in {C} countries, no SIM, no contract`, 'IVR menu, voicemail, SMS forwarded to Telegram', 'SIP credentials for softphones, call forwarding anywhere', 'Most numbers are active in minutes; a few countries need ID details first'],"),
])
