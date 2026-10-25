import re

def patch(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        assert n == 1, (path, n, old[:90])
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)
    print('patched', path, len(pairs))

N = '${CLOUD_COUNTRY_COUNT}'

TYPE_LINES = {
    'en': ("📱 Select number type for <b>${country}</b>:", {
        'local': '<b>📍 Local</b> — geographic number with an area code',
        'mobile': '<b>📱 Mobile</b> — number from the mobile range',
        'national': '<b>🌐 National</b> — nationwide number, no area code',
        'toll_free': '<b>📞 Toll-Free</b> — free for callers, nationwide'}),
    'fr': ("📱 Sélectionnez le type de numéro pour <b>${country}</b> :", {
        'local': '<b>📍 Local</b> — numéro géographique avec indicatif régional',
        'mobile': '<b>📱 Mobile</b> — numéro de la plage mobile',
        'national': '<b>🌐 National</b> — numéro national, sans indicatif régional',
        'toll_free': '<b>📞 Gratuit</b> — gratuit pour l’appelant, national'}),
    'zh': ("📱 选择 <b>${country}</b> 的号码类型：", {
        'local': '<b>📍 本地</b> — 带区号的地理号码',
        'mobile': '<b>📱 手机</b> — 手机号段号码',
        'national': '<b>🌐 全国</b> — 全国通用号码，无区号',
        'toll_free': '<b>📞 免费</b> — 来电方免费，全国通用'}),
    'hi': ("📱 <b>${country}</b> के लिए नंबर प्रकार चुनें:", {
        'local': '<b>📍 लोकल</b> — एरिया कोड वाला भौगोलिक नंबर',
        'mobile': '<b>📱 मोबाइल</b> — मोबाइल रेंज का नंबर',
        'national': '<b>🌐 नेशनल</b> — पूरे देश का नंबर, बिना एरिया कोड',
        'toll_free': '<b>📞 टोल-फ्री</b> — कॉल करने वाले के लिए मुफ्त, राष्ट्रीय'}),
}

def type_fn(lang, indent):
    head, lines = TYPE_LINES[lang]
    obj = ', '.join(f"{k}: '{v}'" for k, v in lines.items())
    return (f"selectType: (country, types = ['local', 'toll_free']) => {{\n"
            f"{indent}  const d = {{ {obj} }}\n"
            f"{indent}  return `{head}\\n\\n${{types.map(t => d[t]).filter(Boolean).join('\\n')}}`\n"
            f"{indent}}},")

P = '/app/js/phone-config.js'
patch(P, [
    ("const moreCountries = isTwilioEnabled() ? _twilioMoreCountries : (_telnyxIntlOn ? _telnyxIntlMore : [])\n",
     "const moreCountries = isTwilioEnabled() ? _twilioMoreCountries : (_telnyxIntlOn ? _telnyxIntlMore : [])\n"
     "// Countries the bot actually sells numbers in (used in the hub / welcome copy instead of a fixed \"30+\").\n"
     "const CLOUD_COUNTRY_COUNT = new Set([...allCountries, ...moreCountries].map(c => c.code)).size\n"),
    # EN hub
    ("Virtual numbers in 30+ countries · Active in 2 minutes",
     f"Virtual numbers in {N} countries · Most are live in minutes"),
    ("(${plans.starter.minutes} inbound min + ${plans.starter.sms} SMS included — incoming calls answered via SIP/browser · call forwarding & outbound billed from wallet)",
     "(${plans.starter.minutes} incoming min + ${plans.starter.sms} SMS included — minutes cover calls you answer on SIP/browser · call forwarding & outgoing calls are billed from your wallet)"),
    # EN how it works
    ("Virtual phone numbers in 30+ countries, managed from Telegram.",
     f"Virtual phone numbers in {N} countries, managed from Telegram."),
    ("2. Pay from wallet → Active immediately",
     "2. Pay from wallet → most numbers go live right away (a few countries need ID details first)"),
    ("Incoming calls answered via SIP/browser + SMS included · Call forwarding & outbound charged from wallet",
     "Incoming calls you answer on SIP/browser + received SMS are included · Call forwarding & outgoing calls are charged from your wallet"),
    ("⭐ Pro $${PHONE_PRO_PRICE}/mo — ${plans.pro.minutes} inbound min · + Voicemail, SIP, IVR",
     "⭐ Pro $${PHONE_PRO_PRICE}/mo — ${plans.pro.minutes} inbound min · + Voicemail, SIP, Call recording, Quick & Bulk IVR, OTP"),
    ("👑 Business $${PHONE_BUSINESS_PRICE}/mo — ${BUSINESS_MINUTES} inbound min · + Recording, Auto-attendant",
     "👑 Business $${PHONE_BUSINESS_PRICE}/mo — ${BUSINESS_MINUTES} inbound min · + Auto-attendant, IVR redial, Quick IVR scheduling, Priority support"),
    # FR
    ("Obtenez un numéro virtuel dans plus de 30 pays — en moins de 2 minutes.",
     f"Obtenez un numéro virtuel dans {N} pays — la plupart sont actifs en quelques minutes."),
    ("Votre propre numéro virtuel dans plus de 30 pays. Recevez des appels, envoyez des SMS, créez des menus IVR — tout depuis Telegram.",
     f"Votre propre numéro virtuel dans {N} pays. Recevez des appels et des SMS, créez des menus IVR — tout depuis Telegram."),
    ("3. Votre numéro est actif immédiatement",
     "3. La plupart des numéros sont actifs immédiatement (certains pays demandent des informations d’identité)"),
    ("• <b>Entrant</b> — appels & SMS inclus dans le forfait",
     "• <b>Entrant</b> — appels répondus (SIP/navigateur) & SMS reçus inclus dans le forfait"),
    ("— ${plans.pro.minutes} min, + messagerie, SIP, IVR, OTP",
     "— ${plans.pro.minutes} min, + messagerie vocale, SIP, enregistrement des appels, IVR rapide & en masse, OTP"),
    ("— ${BUSINESS_MINUTES} min, + enregistrement, standard auto",
     "— ${BUSINESS_MINUTES} min, + standard automatique, rappel IVR, planification IVR rapide, support prioritaire"),
    # ZH
    ("在30多个国家获取虚拟号码 — 不到2分钟。",
     f"在 {N} 个国家获取虚拟号码 — 大多数号码几分钟内即可开通。"),
    ("在30多个国家拥有您的虚拟号码。接听电话、发送短信、创建IVR菜单 — 全部通过Telegram管理。",
     f"在 {N} 个国家拥有您的虚拟号码。接听电话和短信、创建IVR菜单 — 全部通过Telegram管理。"),
    ("3. 号码立即激活",
     "3. 大多数号码立即激活（部分国家需要先提交身份信息）"),
    ("• <b>来电</b> — 通话和短信包含在套餐中",
     "• <b>来电</b> — 通过 SIP/浏览器接听的通话和收到的短信包含在套餐中"),
    ("${plans.pro.minutes}分钟，+ 语音信箱、SIP、IVR、OTP",
     "${plans.pro.minutes}分钟，+ 语音信箱、SIP、通话录音、快速及批量IVR、OTP"),
    ("${BUSINESS_MINUTES}分钟，+ 录音、自动应答、调度",
     "${BUSINESS_MINUTES}分钟，+ 自动应答、IVR重拨、快速IVR定时、优先支持"),
    # HI
    ("30 से अधिक देशों में वर्चुअल नंबर प्राप्त करें — 2 मिनट से भी कम में।",
     f"{N} देशों में वर्चुअल नंबर प्राप्त करें — ज़्यादातर नंबर कुछ ही मिनटों में चालू।"),
    ("30+ देशों में अपना वर्चुअल फ़ोन नंबर। कॉल प्राप्त करें, SMS भेजें, IVR मेनू बनाएं — सब Telegram से।",
     f"{N} देशों में अपना वर्चुअल फ़ोन नंबर। कॉल और SMS प्राप्त करें, IVR मेनू बनाएं — सब Telegram से।"),
    ("3. नंबर तुरंत सक्रिय",
     "3. ज़्यादातर नंबर तुरंत सक्रिय (कुछ देशों में पहले पहचान विवरण चाहिए)"),
    ("• <b>इनबाउंड</b> — कॉल और SMS प्लान में शामिल",
     "• <b>इनबाउंड</b> — SIP/ब्राउज़र पर उठाई गई कॉल और प्राप्त SMS प्लान में शामिल"),
    ("${plans.pro.minutes} मिनट, + वॉइसमेल, SIP, IVR, OTP",
     "${plans.pro.minutes} मिनट, + वॉइसमेल, SIP, कॉल रिकॉर्डिंग, त्वरित व बल्क IVR, OTP"),
    ("${BUSINESS_MINUTES} मिनट, + रिकॉर्डिंग, ऑटो-अटेंडेंट",
     "${BUSINESS_MINUTES} मिनट, + ऑटो-अटेंडेंट, IVR रीडायल, त्वरित IVR शेड्यूलिंग, प्राथमिकता सपोर्ट"),
    # selectType (4 languages) — list only the types this country offers
    ("  selectType: (country) => `📱 Select number type for <b>${country}</b>:\n\n<b>📍 Local</b> — Geographic number with area code\n<b>🆓 Toll-Free</b> — 800/888/877 prefix, nationwide`,",
     "  " + type_fn('en', '  ')),
    ("    selectType: (country) => `📱 Sélectionnez le type de numéro pour <b>${country}</b> :\\n\\n<b>📍 Local</b> — Numéro géographique avec indicatif régional\\n<b>🆓 Sans frais</b> — Préfixe 800/888/877, national`,",
     "    " + type_fn('fr', '    ')),
    ("    selectType: (country) => `📱 选择 <b>${country}</b> 的号码类型：\\n\\n<b>📍 本地</b> — 带区号的地理号码\\n<b>🆓 免费</b> — 800/888/877 前缀，全国通用`,",
     "    " + type_fn('zh', '    ')),
    ("    selectType: (country) => `📱 <b>${country}</b> के लिए नंबर प्रकार चुनें:\\n\\n<b>📍 लोकल</b> — एरिया कोड वाला भौगोलिक नंबर\\n<b>🆓 टोल-फ्री</b> — 800/888/877 प्रीफिक्स, राष्ट्रीय`,",
     "    " + type_fn('hi', '    ')),
    ("  telnyxIntlCountries,\n", "  telnyxIntlCountries,\n  CLOUD_COUNTRY_COUNT,\n"),
])

patch('/app/js/_index.js', [
    ("    return send(chatId, cpTxt.selectType(message), k.of(typeBtns))",
     "    return send(chatId, cpTxt.selectType(message, types), k.of(typeBtns))"),
])

C = "${require('../phone-config').CLOUD_COUNTRY_COUNT}"
patch('/app/js/lang/en.js', [
    ("Virtual numbers in 30+ countries\nIVR Auto-Attendant", f"Virtual numbers in {C} countries\nIVR Auto-Attendant"),
    ("<b>Cloud IVR</b> — Virtual numbers in 30+ countries, IVR, SMS, SIP", f"<b>Cloud IVR</b> — Virtual numbers in {C} countries, IVR, SMS, SIP"),
])
patch('/app/js/lang/fr.js', [("Numéros virtuels dans 30+ pays", f"Numéros virtuels dans {C} pays")])
patch('/app/js/lang/hi.js', [("30+ देशों में वर्चुअल नंबर", f"{C} देशों में वर्चुअल नंबर")])
patch('/app/js/lang/zh.js', [("30+ 国家虚拟号码", f"{C} 个国家虚拟号码")])

patch('/app/js/ai-support.js', [
    ("<b>C) IVR Auto-attendant / Voicemail greetings (Business plan)</b>",
     "<b>C) IVR Auto-attendant (Business plan) / Voicemail greetings (Pro and Business)</b>"),
])
