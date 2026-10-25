import json, os

F = '/app/frontend/src/cloudivr/'
J = '/app/js/cloudivr-web/'


def patch(path, pairs):
    s = open(path, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        assert n == 1, (path, n, old[:100])
        s = s.replace(old, new)
    open(path, 'w', encoding='utf-8').write(s)
    print('patched', path.replace('/app/', ''), len(pairs))


# ── Backend: plan feature labels + catalog facts ──
patch(J + 'numbers.js', [
    ("  ['inbox', 'SMS inbox for your texts', null],", "  ['inbox', 'SMS inbox — read texts and reply', null],"),
    ("  ['voicemail', 'Voicemail in 4 languages + transcripts', 'voicemail'],",
     "  ['voicemail', () => `Voicemail in ${vmGreeting.LANG_CODES.length} languages + transcripts`, 'voicemail'],"),
    ("  ['aiAgent', 'AI voice agent that answers and calls for you ($0.20/min)', 'aiAgent'],",
     "  ['aiAgent', () => `AI voice agent that answers and calls for you ($${Number(require('../ai-agent').RATE()).toFixed(2)}/min)`, 'aiAgent'],"),
    ("  ['textRelay', 'Text calls for deaf & hard-of-hearing users (+$0.03/min)', 'textRelay'],",
     "  ['textRelay', () => `Text calls for deaf & hard-of-hearing users (+$${Number(require('../relay-call').RELAY_RATE()).toFixed(2)}/min)`, 'textRelay'],"),
    ("const webFeatures = (plan) => WEB_FEATURES.map(([key, label, gate]) => ({\n  key, label, included:",
     "const webFeatures = (plan) => WEB_FEATURES.map(([key, label, gate]) => ({\n  key, label: typeof label === 'function' ? label() : label, included:"),
    ("    sipDomain: phoneConfig.WEB_SIP_DOMAIN, dryRun: dryRun(), livePayments: livePayments(),\n  }",
     "    sipDomain: phoneConfig.WEB_SIP_DOMAIN, dryRun: dryRun(), livePayments: livePayments(),\n"
     "    extraNumber: { price: phoneConfig.SUB_NUMBER_BASE_PRICE, limits: Object.fromEntries(Object.keys(phoneConfig.plans).map(id => [id, phoneConfig.getSubNumberLimit(id)])) },\n  }"),
])

patch(J + 'domain-guard.js', [
    ("const BRAND_HEAD = [\n"
     "  '<title>CloudIVR — Virtual phone numbers, IVR &amp; SIP</title>',\n"
     "  '<meta name=\"description\" content=\"Virtual numbers in 17 countries with call forwarding, voicemail, SMS, IVR menus and outbound IVR campaigns. Pay with crypto.\" />',\n"
     "  '<meta property=\"og:title\" content=\"CloudIVR — Virtual phone numbers, IVR &amp; SIP\" />',\n"
     "  '<meta property=\"og:description\" content=\"Phone numbers that answer, route and call for you. Pay with crypto, run it from your browser.\" />',\n"
     "  '<meta property=\"og:type\" content=\"website\" />',\n"
     "].join('')\n"
     "const brandHtml = (html) => {\n",
     "const countryCount = () => { try { return require('./numbers').countries().length } catch (_) { return 0 } }\n"
     "const brandHead = () => {\n"
     "  const n = countryCount()\n"
     "  return [\n"
     "    '<title>CloudIVR — Virtual phone numbers, IVR &amp; AI voice agents</title>',\n"
     "    `<meta name=\"description\" content=\"Virtual phone numbers${n ? ` in ${n} countries` : ''} with call forwarding, voicemail, an SMS inbox, IVR menus, bulk IVR campaigns and AI voice agents. Pay with crypto.\" />`,\n"
     "    '<meta property=\"og:title\" content=\"CloudIVR — Virtual phone numbers, IVR &amp; AI voice agents\" />',\n"
     "    '<meta property=\"og:description\" content=\"Phone numbers that answer, route and call for you — IVR menus, campaigns and AI voice agents. Pay with crypto, run it from your browser.\" />',\n"
     "    '<meta property=\"og:type\" content=\"website\" />',\n"
     "    '<meta name=\"theme-color\" content=\"#0a0a0a\" />',\n"
     "    '<link rel=\"icon\" type=\"image/png\" href=\"/civr/brand/parrot-icon-48.png\" />',\n"
     "    '<link rel=\"apple-touch-icon\" href=\"/civr/brand/apple-touch-icon.png\" />',\n"
     "  ].join('')\n"
     "}\n"
     "const brandHtml = (html) => {\n"
     "  const BRAND_HEAD = brandHead()\n"),
    ("  const out = html.replace(/<meta name=\"description\"[^>]*>/i, '')\n",
     "  const out = html.replace(/<meta name=\"description\"[^>]*>/i, '').replace(/<meta name=\"theme-color\"[^>]*>/i, '')\n"),
])

# ── Landing ──
patch(F + 'pages/landing/Hero.js', [
    ('<span className="civr-l-dot" />Cloud numbers · IVR · SIP</div>', '<span className="civr-l-dot" />Cloud numbers · IVR · AI agents</div>'),
    ("            Virtual numbers in {n} countries with forwarding, voicemail, SMS, a press-1 auto-attendant and outbound IVR campaigns. Pay with crypto or your wallet, and run it all from the browser.\n",
     "            {`Virtual numbers in ${n} countries with call forwarding, voicemail, an SMS inbox, a press-1 auto-attendant, bulk IVR campaigns and AI voice agents. Call from your browser and pay with crypto or your wallet.`}\n"),
])

patch(F + 'pages/landing/Sections.js', [
    ("import { Workflow, PhoneForwarded, Voicemail, MessageSquare, Megaphone, Headphones, UserPlus, Hash, Wallet } from 'lucide-react';",
     "import { Workflow, PhoneForwarded, Voicemail, MessageSquare, Megaphone, Headphones, UserPlus, Hash, Wallet, Bot, Captions } from 'lucide-react';"),
    ('title={`Local numbers in ${list.length || 17} countries.`} sub="Local, toll-free and mobile numbers. Pick a country, pay, and your number is ready to route calls."',
     'title={`Phone numbers in ${list.length || 17} countries.`} sub="Local, toll-free and mobile numbers. Pick a country and pay — most numbers are ready in about a minute; a few countries ask for ID details first."'),
    ('font-mono uppercase tracking-wider">Voice · SMS · SIP on one line</p>', 'font-mono uppercase tracking-wider">Voice and SIP on every number · SMS on most</p>'),
    ('text="Paste leads, pick a message, watch answers and key presses live. Pause or cancel any time."',
     'text="Paste leads, pick a message or an AI agent, watch answers and key presses live. Schedule, pause or cancel any time."'),
    ('text="Always, when busy or on no answer — to any phone worldwide."',
     'text="Always, when busy or on no answer — to any phone worldwide, with up to 4 backup numbers. Billed per minute from your wallet."'),
    ('text="Custom greetings, recordings in your inbox and email."',
     'text={`Greetings in ${catalog?.voicemailLanguages?.length || 5} languages or your own audio. Recordings and transcripts land in your inbox and email.`}'),
    ("text=\"Call and answer from your browser tab on your number's SIP line.\"",
     'text="Call and answer in your browser tab — by voice or by typing — or log in from any SIP softphone."'),
    ('text="Inbound texts land in your inbox. Email and webhook delivery on Pro and up." plans={plans} className="md:col-span-4" testid="feature-card-5" />',
     'text="Read and reply to texts in your inbox. Email and webhook delivery on Pro and up." plans={plans} className="md:col-span-4" testid="feature-card-5" />\n'
     '          <FeatureCard icon={Bot} title="AI voice agents" text="An AI that answers your number or calls your leads in English, French or Spanish — it answers FAQs, books appointments, takes messages or transfers to you." k="aiAgent" plans={plans} dark className="md:col-span-7" testid="feature-card-6" />\n'
     '          <FeatureCard icon={Captions} title="Text calls" text="For deaf and hard-of-hearing callers: you type and they hear a voice; they talk and you read their words live." k="textRelay" plans={plans} className="md:col-span-5" testid="feature-card-7" />'),
])

patch(F + 'pages/landing/PricingFaq.js', [
    ('data-testid={`pricing-allowance-${p.id}`}>{p.minutes} minutes · {p.sms} SMS included each month</div>',
     'data-testid={`pricing-allowance-${p.id}`}>{`${p.minutes} incoming minutes · ${p.sms} SMS included each month`}</div>'),
    ("            {`Extra usage is paid from your wallet: minutes over your plan ${money(r.overagePerMin)}/min, SMS over your plan ${money(r.overagePerSms)} each, calls forwarded to a phone ${money(r.forwardingPerMin)}/min. Outbound IVR calls show their price before you start.`}",
     "            {`Extra usage is paid from your wallet: incoming minutes over your plan ${money(r.overagePerMin)}/min, SMS over your plan ${money(r.overagePerSms)} each, calls forwarded to a phone ${money(r.forwardingPerMin)}/min. Outgoing calls — browser phone, softphone, IVR and AI agent calls — are billed per minute from your wallet and show their price before you start. Extra numbers cost from ${usd(catalog?.extraNumber?.price || 25)}/month each and share the plan's minutes and SMS.`}"),
    ("  const ivr = andList((c?.plans || []).filter(p => p.access?.ivr).map(p => p.name)) || 'Business';\n",
     "  const ivr = andList((c?.plans || []).filter(p => p.access?.ivr).map(p => p.name)) || 'Business';\n  const ex = c?.extraNumber;\n"),
    ("`The ${ivr} plan. Pro includes Quick IVR calls and Bulk IVR campaigns; Starter covers call forwarding and SMS.`],",
     "`The ${ivr} plan. Pro adds voicemail, the browser phone and SIP, call recording, Quick IVR calls, Bulk IVR campaigns, AI voice agents and text calls; Starter covers call forwarding and the SMS inbox.`],"),
    ("r ? `Extra minutes cost ${money(r.overagePerMin)} each and extra SMS ${money(r.overagePerSms)} each, paid from your wallet.`",
     "r ? `Extra incoming minutes cost ${money(r.overagePerMin)} each and extra SMS ${money(r.overagePerSms)} each, paid from your wallet.`"),
    ("    ['Can I cancel?',",
     "    ['Are outgoing calls included in my minutes?', 'No. Plan minutes cover incoming calls you answer. Outgoing calls — browser phone, softphone, Quick IVR, campaigns and AI agent calls — and forwarded calls are billed per minute from your wallet, and the price shows before you call.'],\n"
     "    ...(ex ? [['Can I put several numbers on one plan?', `Yes. Add extra numbers to a main number from ${usd(ex.price)}/month each — up to ${ex.limits.starter} on Starter, ${ex.limits.pro} on Pro and ${ex.limits.business} on Business. They share its minutes and SMS and get the same features.`]] : []),\n"
     "    ['Can I cancel?',"),
    ("© {new Date().getFullYear()} CloudIVR · Virtual numbers, IVR and SIP</div>",
     "© {new Date().getFullYear()} CloudIVR · Virtual numbers, IVR, SIP and AI voice agents</div>"),
])

# ── Auth / app pages ──
patch(F + 'pages/AuthPages.js', [
    ("const NEXT_STEPS = ['Add funds with crypto', 'Pick a number and plan', 'Choose what callers hear'];",
     "const NEXT_STEPS = ['Pick a number and plan', 'Pay with crypto or your wallet', 'Choose what callers hear'];"),
    ("Your numbers, IVR and campaigns — one dashboard.", "Your numbers, IVR, campaigns and AI agents — one dashboard."),
    ("'Free to create. Next you add funds with crypto and pick a number.'", "'Free to create. Next you pick a number and pay with crypto or your wallet.'"),
])
patch(F + 'pages/Numbers.js', [("Pick a country, choose a number and a plan — it’s live in under a minute.",
                               "Pick a country, choose a number and a plan — most numbers are live in about a minute.")])
patch(F + 'pages/Wallet.js', [("Numbers, renewals, forwarded minutes and IVR calls are paid from here.",
                              "Numbers, renewals, extra minutes and SMS, forwarded calls, IVR calls, AI agent calls and text calls are paid from here.")])
patch(F + 'Softphone.js', [("Both calls bill about $${Number(d.rate).toFixed(2)}/min after your plan minutes.`",
                            "Both calls bill about $${Number(d.rate).toFixed(2)}/min from your wallet.`")])
patch(F + 'pages/number/BillingTab.js', [
    ("{quote && <div className=\"text-sm\" data-testid=\"billing-upgrade-quote\">Pay <span className=\"font-mono\">{money(quote.charge)}</span> now{quote.credit > 0 ? ` (includes ${money(quote.credit)} credit for unused days)` : ''}. Then {money(quote.newPrice)}/month.</div>}",
     "{quote && <div className=\"text-sm\" data-testid=\"billing-upgrade-quote\">{quote.credit > 0\n"
     "        ? `Pay ${money(quote.charge)} now — includes a ${money(quote.credit)} upgrade credit (25% of your current plan, for upgrading within 14 days of buying). Then ${money(quote.newPrice)}/month — your renewal date stays the same.`\n"
     "        : `Pay ${money(quote.charge)} now. Then ${money(quote.newPrice)}/month — your renewal date stays the same.`}</div>}"),
])
patch(F + 'ui.js', [("Upgrade this number in its Billing tab to unlock it — you only pay the difference for the days left.",
                     "Upgrade this number in its Billing tab to unlock it — your renewal date stays the same, and within 14 days of buying 25% of your current plan price comes off.")])
patch(F + 'pages/number/BillingExtras.js', [("They get the same ${num.planName} features.`}", "They get the same ${num.planName} features and share its minutes and SMS.`}")])
patch(F + 'pages/BuyNumber.js', [("/month, pay from your wallet or with crypto, same features.${extra ?", "/month, same features, and uses its minutes and SMS. Pay from your wallet or with crypto.${extra ?")])
patch(F + 'pages/buy/Checkout.js', [("Extra numbers are paid from the wallet. Short? Add funds with crypto first.",
                                    "Crypto isn’t available for this payment. Pay from your wallet — short? Add funds with crypto first.")])
patch(F + 'pages/number/SettingsTabs.js', [('sub="Record inbound calls. Recordings show up in the Logs tab."',
                                            'sub="Record incoming calls and calls you make from the browser phone or a softphone. Recordings show up in the Logs tab."')])

# ── French / Spanish dictionaries ──
DROP = [
    'Voicemail in 4 languages + transcripts', 'SMS inbox for your texts', 'Cloud numbers · IVR · SIP', 'Virtual numbers in',
    'countries with forwarding, voicemail, SMS, a press-1 auto-attendant and outbound IVR campaigns. Pay with crypto or your wallet, and run it all from the browser.',
    'Local numbers in {0} countries.', 'Local, toll-free and mobile numbers. Pick a country, pay, and your number is ready to route calls.',
    'Voice · SMS · SIP on one line', 'Paste leads, pick a message, watch answers and key presses live. Pause or cancel any time.',
    'Always, when busy or on no answer — to any phone worldwide.', 'Custom greetings, recordings in your inbox and email.',
    "Call and answer from your browser tab on your number's SIP line.", 'Inbound texts land in your inbox. Email and webhook delivery on Pro and up.',
    'Extra minutes cost {0} each and extra SMS {1} each, paid from your wallet.',
    'The {0} plan. Pro includes Quick IVR calls and Bulk IVR campaigns; Starter covers call forwarding and SMS.',
    'CloudIVR · Virtual numbers, IVR and SIP', 'Add funds with crypto first', 'Your numbers, IVR and campaigns — one dashboard.',
    'Free to create. Next you add funds with crypto and pick a number.', 'Pick a country, choose a number and a plan — it’s live in under a minute.',
    'Numbers, renewals, forwarded minutes and IVR calls are paid from here.',
    'Ringing your mobile now — answer and press 1 to connect. Both calls bill about ${0}/min after your plan minutes.',
    '(includes {0} credit for unused days)', 'Upgrade this number in its Billing tab to unlock it — you only pay the difference for the days left.',
    'Add more numbers to this plan for {0}/month each. They get the same {1} features.',
    'Shares the plan of {0} — {1}/month, pay from your wallet or with crypto, same features.{2}',
    'Extra numbers are paid from the wallet. Short? Add funds with crypto first.', 'Record inbound calls. Recordings show up in the Logs tab.',
]
DROP_PREFIX = ['Extra usage is paid from your wallet: minutes over your plan']

ADD = {
    'Voicemail in {0} languages + transcripts': ('Messagerie vocale en {0} langues + transcriptions', 'Buzón de voz en {0} idiomas + transcripciones'),
    'SMS inbox — read texts and reply': ('Boîte SMS — lisez vos SMS et répondez', 'Bandeja SMS — lee tus mensajes y responde'),
    'AI voice agent that answers and calls for you ({0}/min)': ('Agent vocal IA qui répond et appelle pour vous ({0}/min)', 'Agente de voz con IA que contesta y llama por ti ({0}/min)'),
    'Text calls for deaf & hard-of-hearing users (+{0}/min)': ('Appels texte pour les personnes sourdes et malentendantes (+{0}/min)', 'Llamadas de texto para personas sordas o con dificultades auditivas (+{0}/min)'),
    'Cloud numbers · IVR · AI agents': ('Numéros Cloud · SVI · Agents IA', 'Números Cloud · IVR · Agentes IA'),
    'AI agents': ('Agents IA', 'Agentes IA'),
    'Virtual numbers in {0} countries with call forwarding, voicemail, an SMS inbox, a press-1 auto-attendant, bulk IVR campaigns and AI voice agents. Call from your browser and pay with crypto or your wallet.': (
        'Des numéros virtuels dans {0} pays avec renvoi d’appel, messagerie vocale, boîte SMS, standard automatique « appuyez sur 1 », campagnes SVI en masse et agents vocaux IA. Appelez depuis votre navigateur et payez en crypto ou avec votre portefeuille.',
        'Números virtuales en {0} países con desvío de llamadas, buzón de voz, bandeja SMS, menú automático «pulse 1», campañas IVR masivas y agentes de voz con IA. Llama desde tu navegador y paga con cripto o tu billetera.'),
    'Phone numbers in {0} countries.': ('Des numéros dans {0} pays.', 'Números en {0} países.'),
    'Local, toll-free and mobile numbers. Pick a country and pay — most numbers are ready in about a minute; a few countries ask for ID details first.': (
        'Numéros locaux, gratuits et mobiles. Choisissez un pays et payez — la plupart des numéros sont prêts en une minute environ ; quelques pays demandent d’abord des informations d’identité.',
        'Números locales, gratuitos y móviles. Elige un país y paga — la mayoría está lista en un minuto; algunos países piden antes datos de identidad.'),
    'Voice and SIP on every number · SMS on most': ('Voix et SIP sur chaque numéro · SMS sur la plupart', 'Voz y SIP en cada número · SMS en la mayoría'),
    'Paste leads, pick a message or an AI agent, watch answers and key presses live. Schedule, pause or cancel any time.': (
        'Collez vos prospects, choisissez un message ou un agent IA, suivez les réponses et les touches en direct. Planifiez, mettez en pause ou annulez à tout moment.',
        'Pega tus contactos, elige un mensaje o un agente IA y sigue las respuestas y teclas en directo. Programa, pausa o cancela cuando quieras.'),
    'Always, when busy or on no answer — to any phone worldwide, with up to 4 backup numbers. Billed per minute from your wallet.': (
        'Toujours, si occupé ou sans réponse — vers n’importe quel téléphone dans le monde, avec jusqu’à 4 numéros de secours. Facturé à la minute depuis votre portefeuille.',
        'Siempre, si está ocupado o sin respuesta — a cualquier teléfono del mundo, con hasta 4 números de respaldo. Se cobra por minuto desde tu billetera.'),
    'Greetings in {0} languages or your own audio. Recordings and transcripts land in your inbox and email.': (
        'Annonces en {0} langues ou votre propre audio. Messages et transcriptions arrivent dans votre boîte de réception et par email.',
        'Saludos en {0} idiomas o tu propio audio. Grabaciones y transcripciones llegan a tu bandeja y a tu correo.'),
    'Call and answer in your browser tab — by voice or by typing — or log in from any SIP softphone.': (
        'Appelez et répondez dans votre onglet — à la voix ou par écrit — ou connectez n’importe quel softphone SIP.',
        'Llama y contesta en tu pestaña — con la voz o escribiendo — o conéctate desde cualquier softphone SIP.'),
    'Read and reply to texts in your inbox. Email and webhook delivery on Pro and up.': (
        'Lisez vos SMS et répondez depuis votre boîte de réception. Envoi par email et webhook dès Pro.',
        'Lee y responde tus mensajes en tu bandeja. Envío por email y webhook desde Pro.'),
    'An AI that answers your number or calls your leads in English, French or Spanish — it answers FAQs, books appointments, takes messages or transfers to you.': (
        'Une IA qui répond à votre numéro ou appelle vos prospects en anglais, français ou espagnol — elle répond aux questions, prend des rendez-vous, prend des messages ou vous transfère l’appel.',
        'Una IA que contesta tu número o llama a tus contactos en inglés, francés o español — responde preguntas, agenda citas, toma mensajes o te transfiere la llamada.'),
    '{0} incoming minutes · {1} SMS included each month': ('{0} minutes entrantes · {1} SMS inclus chaque mois', '{0} minutos entrantes · {1} SMS incluidos cada mes'),
    "Extra usage is paid from your wallet: incoming minutes over your plan {0}/min, SMS over your plan {1} each, calls forwarded to a phone {2}/min. Outgoing calls — browser phone, softphone, IVR and AI agent calls — are billed per minute from your wallet and show their price before you start. Extra numbers cost from {3}/month each and share the plan's minutes and SMS.": (
        'L’usage supplémentaire est payé depuis votre portefeuille : minutes entrantes au-delà du forfait {0}/min, SMS au-delà du forfait {1} chacun, appels renvoyés vers un téléphone {2}/min. Les appels sortants — téléphone navigateur, softphone, SVI et agents IA — sont facturés à la minute depuis votre portefeuille et affichent leur prix avant de commencer. Les numéros supplémentaires coûtent à partir de {3}/mois chacun et partagent les minutes et SMS du forfait.',
        'El uso extra se paga desde tu billetera: minutos entrantes por encima del plan {0}/min, SMS por encima del plan {1} cada uno, llamadas desviadas a un teléfono {2}/min. Las llamadas salientes — teléfono del navegador, softphone, IVR y agentes IA — se cobran por minuto desde tu billetera y muestran su precio antes de empezar. Los números adicionales cuestan desde {3}/mes cada uno y comparten los minutos y SMS del plan.'),
    'The {0} plan. Pro adds voicemail, the browser phone and SIP, call recording, Quick IVR calls, Bulk IVR campaigns, AI voice agents and text calls; Starter covers call forwarding and the SMS inbox.': (
        'Le forfait {0}. Pro ajoute la messagerie vocale, le téléphone navigateur et SIP, l’enregistrement des appels, les appels SVI rapides, les campagnes SVI en masse, les agents vocaux IA et les appels texte ; Starter couvre le renvoi d’appel et la boîte SMS.',
        'El plan {0}. Pro añade buzón de voz, teléfono en el navegador y SIP, grabación de llamadas, llamadas IVR rápidas, campañas IVR masivas, agentes de voz con IA y llamadas de texto; Starter cubre el desvío de llamadas y la bandeja SMS.'),
    'Extra incoming minutes cost {0} each and extra SMS {1} each, paid from your wallet.': (
        'Les minutes entrantes supplémentaires coûtent {0} chacune et les SMS supplémentaires {1} chacun, payés depuis votre portefeuille.',
        'Los minutos entrantes extra cuestan {0} cada uno y los SMS extra {1} cada uno, pagados desde tu billetera.'),
    'Are outgoing calls included in my minutes?': ('Les appels sortants sont-ils inclus dans mes minutes ?', '¿Las llamadas salientes están incluidas en mis minutos?'),
    'No. Plan minutes cover incoming calls you answer. Outgoing calls — browser phone, softphone, Quick IVR, campaigns and AI agent calls — and forwarded calls are billed per minute from your wallet, and the price shows before you call.': (
        'Non. Les minutes du forfait couvrent les appels entrants auxquels vous répondez. Les appels sortants — téléphone navigateur, softphone, SVI rapide, campagnes et agents IA — et les appels renvoyés sont facturés à la minute depuis votre portefeuille, et le prix s’affiche avant l’appel.',
        'No. Los minutos del plan cubren las llamadas entrantes que contestas. Las llamadas salientes — teléfono del navegador, softphone, IVR rápido, campañas y agentes IA — y las llamadas desviadas se cobran por minuto desde tu billetera, y el precio se muestra antes de llamar.'),
    'Can I put several numbers on one plan?': ('Puis-je mettre plusieurs numéros sur un forfait ?', '¿Puedo tener varios números en un plan?'),
    'Yes. Add extra numbers to a main number from {0}/month each — up to {1} on Starter, {2} on Pro and {3} on Business. They share its minutes and SMS and get the same features.': (
        'Oui. Ajoutez des numéros supplémentaires à un numéro principal à partir de {0}/mois chacun — jusqu’à {1} sur Starter, {2} sur Pro et {3} sur Business. Ils partagent ses minutes et SMS et ont les mêmes fonctionnalités.',
        'Sí. Añade números adicionales a un número principal desde {0}/mes cada uno — hasta {1} en Starter, {2} en Pro y {3} en Business. Comparten sus minutos y SMS y tienen las mismas funciones.'),
    'CloudIVR · Virtual numbers, IVR, SIP and AI voice agents': ('CloudIVR · Numéros virtuels, SVI, SIP et agents vocaux IA', 'CloudIVR · Números virtuales, IVR, SIP y agentes de voz con IA'),
    'Pay with crypto or your wallet': ('Payez en crypto ou avec votre portefeuille', 'Paga con cripto o tu billetera'),
    'Your numbers, IVR, campaigns and AI agents — one dashboard.': ('Vos numéros, SVI, campagnes et agents IA — un seul tableau de bord.', 'Tus números, IVR, campañas y agentes IA — un solo panel.'),
    'Free to create. Next you pick a number and pay with crypto or your wallet.': (
        'Création gratuite. Ensuite, vous choisissez un numéro et payez en crypto ou avec votre portefeuille.',
        'Gratis. Luego eliges un número y pagas con cripto o tu billetera.'),
    'Pick a country, choose a number and a plan — most numbers are live in about a minute.': (
        'Choisissez un pays, un numéro et un forfait — la plupart des numéros sont actifs en une minute environ.',
        'Elige un país, un número y un plan — la mayoría está activa en un minuto.'),
    'Numbers, renewals, extra minutes and SMS, forwarded calls, IVR calls, AI agent calls and text calls are paid from here.': (
        'Les numéros, renouvellements, minutes et SMS supplémentaires, appels renvoyés, appels SVI, appels d’agents IA et appels texte sont payés d’ici.',
        'Los números, renovaciones, minutos y SMS extra, llamadas desviadas, llamadas IVR, de agentes IA y de texto se pagan desde aquí.'),
    'Ringing your mobile now — answer and press 1 to connect. Both calls bill about ${0}/min from your wallet.': (
        'Votre mobile sonne — répondez et appuyez sur 1 pour vous connecter. Les deux appels sont facturés environ ${0}/min depuis votre portefeuille.',
        'Tu móvil está sonando — contesta y pulsa 1 para conectar. Ambas llamadas cuestan unos ${0}/min desde tu billetera.'),
    'Pay {0} now — includes a {1} upgrade credit (25% of your current plan, for upgrading within 14 days of buying). Then {2}/month — your renewal date stays the same.': (
        'Payez {0} maintenant — avec un crédit de mise à niveau de {1} (25 % de votre forfait actuel, pour une mise à niveau dans les 14 jours suivant l’achat). Ensuite {2}/mois — votre date de renouvellement ne change pas.',
        'Paga {0} ahora — incluye un crédito de mejora de {1} (25 % de tu plan actual, por mejorar en los 14 días siguientes a la compra). Luego {2}/mes — tu fecha de renovación no cambia.'),
    'Pay {0} now. Then {1}/month — your renewal date stays the same.': (
        'Payez {0} maintenant. Ensuite {1}/mois — votre date de renouvellement ne change pas.',
        'Paga {0} ahora. Luego {1}/mes — tu fecha de renovación no cambia.'),
    'Upgrade this number in its Billing tab to unlock it — your renewal date stays the same, and within 14 days of buying 25% of your current plan price comes off.': (
        'Améliorez ce numéro dans son onglet Facturation pour le débloquer — votre date de renouvellement ne change pas, et dans les 14 jours suivant l’achat, 25 % du prix de votre forfait actuel est déduit.',
        'Mejora este número en su pestaña Facturación para desbloquearlo — tu fecha de renovación no cambia y, en los 14 días siguientes a la compra, se descuenta el 25 % del precio de tu plan actual.'),
    'Add more numbers to this plan for {0}/month each. They get the same {1} features and share its minutes and SMS.': (
        'Ajoutez d’autres numéros à ce forfait pour {0}/mois chacun. Ils ont les mêmes fonctionnalités {1} et partagent ses minutes et SMS.',
        'Añade más números a este plan por {0}/mes cada uno. Tienen las mismas funciones {1} y comparten sus minutos y SMS.'),
    'Shares the plan of {0} — {1}/month, same features, and uses its minutes and SMS. Pay from your wallet or with crypto.{2}': (
        'Partage le forfait de {0} — {1}/mois, mêmes fonctionnalités, et utilise ses minutes et SMS. Payez depuis votre portefeuille ou en crypto.{2}',
        'Comparte el plan de {0} — {1}/mes, mismas funciones, y usa sus minutos y SMS. Paga desde tu billetera o con cripto.{2}'),
    'Crypto isn’t available for this payment. Pay from your wallet — short? Add funds with crypto first.': (
        'La crypto n’est pas disponible pour ce paiement. Payez depuis votre portefeuille — solde insuffisant ? Ajoutez d’abord des fonds en crypto.',
        'La cripto no está disponible para este pago. Paga desde tu billetera — ¿te falta saldo? Añade fondos con cripto primero.'),
    'Record incoming calls and calls you make from the browser phone or a softphone. Recordings show up in the Logs tab.': (
        'Enregistrez les appels entrants et ceux que vous passez depuis le téléphone navigateur ou un softphone. Les enregistrements apparaissent dans l’onglet Journaux.',
        'Graba las llamadas entrantes y las que haces desde el teléfono del navegador o un softphone. Las grabaciones aparecen en la pestaña Registros.'),
    # page titles
    'CloudIVR — Virtual phone numbers, IVR & AI voice agents': ('CloudIVR — Numéros virtuels, SVI et agents vocaux IA', 'CloudIVR — Números virtuales, IVR y agentes de voz con IA'),
    'Number settings': ('Réglages du numéro', 'Ajustes del número'),
    'Order status': ('Statut de la commande', 'Estado del pedido'),
    'Campaign report': ('Rapport de campagne', 'Informe de campaña'),
    'Edit agent': ('Modifier l’agent', 'Editar agente'),
    'Feature suggestions': ('Suggestions de fonctionnalités', 'Sugerencias de funciones'),
}

for i, lang in enumerate(('fr', 'es')):
    p = F + f'i18n/{lang}.json'
    d = json.load(open(p, encoding='utf-8'))
    before = len(d)
    was_sorted = list(d) == sorted(d)
    for k in DROP:
        d.pop(k, None)
    for k in [k for k in d if any(k.startswith(x) for x in DROP_PREFIX)]:
        d.pop(k)
    for k, v in ADD.items():
        d[k] = v[i]
    keys = list(d)
    keys = sorted(keys) if was_sorted else keys
    open(p, 'w', encoding='utf-8').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(d[k], ensure_ascii=False)}' for k in keys) + '\n}\n')
    print(lang, before, '->', len(d))
