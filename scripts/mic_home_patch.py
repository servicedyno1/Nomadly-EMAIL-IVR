import json, os
os.chdir('/app')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a); s = s.replace(a, b)
    open(p, 'w').write(s)

# rtc: ask for the mic on a manual Connect and before answering; share mic state
edit('frontend/src/cloudivr/rtc.js', [
 ("import { api, enc } from './api';", "import { api, enc } from './api';\nimport { useMic, MIC_TEXT } from './mic';"),
 ("  const [phone, setPhone] = useState('');\n  useEffect(() => () => client.current?.disconnect(), []);", "  const [phone, setPhone] = useState('');\n  const mic = useMic();\n  useEffect(() => () => client.current?.disconnect(), []);"),
 ("""    setMsg(''); setStatus('connecting'); setPhone(p); line.current = p;
    try {""", """    setMsg(''); setStatus('connecting'); setPhone(p); line.current = p;
    // A manual Connect asks for the microphone now, so a ringing call never waits on the prompt.
    if (!quiet) {
      const m = await mic.ask();
      if (m !== 'granted') { setStatus('error'); setMsg(MIC_TEXT[m]); return; }
    }
    try {"""),
 ("  }, []);\n\n  // Numbers with \"Ring me in the browser\"", "  }, [mic.ask]);\n\n  // Numbers with \"Ring me in the browser\""),
 ("""  const dial = async (dest, from, showAs) => {""", """  // Answer only once the mic is allowed; otherwise say why.
  const answer = async (ref) => {
    const m = await mic.ask();
    if (m !== 'granted') { setMsg(MIC_TEXT[m]); return false; }
    ref.answer();
    return true;
  };
  const dial = async (dest, from, showAs) => {
    const m = await mic.ask();
    if (m !== 'granted') { setMsg(MIC_TEXT[m]); return null; }"""),
 ("value={{ status, call, msg, phone, connect, dial, autoConnect }}", "value={{ status, call, msg, phone, connect, dial, answer, autoConnect, mic }}"),
])
edit('frontend/src/cloudivr/Softphone.js', [
 ("import { ShowAsSelect } from './CallerIdPick';", "import { ShowAsSelect } from './CallerIdPick';\nimport { MicStatus } from './MicStatus';"),
 ("const { status: rtcStatus, call, msg: rtcMsg, connect, dial, phone: rtcPhone } = useRtc();", "const { status: rtcStatus, call, msg: rtcMsg, connect, dial, answer, phone: rtcPhone, mic } = useRtc();"),
 ("""            {!viaMobile && msg && <span className="block text-[#a1a1aa] mt-1">{msg}</span>}""", """            {!viaMobile && msg && <span className="block text-[#a1a1aa] mt-1" data-testid="softphone-message">{msg}</span>}"""),
 ("""          <div className="flex items-center gap-2 mb-3"><input className={`civr-input font-mono ${pv.input}`}""", """          {!viaMobile && <MicStatus mic={mic} />}
          <div className="flex items-center gap-2 mb-3"><input className={`civr-input font-mono ${pv.input}`}"""),
 ("onClick={() => call.ref.answer()} data-testid=\"softphone-answer-button\"", "onClick={() => answer(call.ref)} data-testid=\"softphone-answer-button\""),
])
edit('frontend/src/cloudivr/Incoming.js', [
 ("  const answerRtc = useCallback((r) => { r.ref.answer(); drop(c.id); openPhone(); }, [c.id, drop, openPhone]);", "  const answerRtc = useCallback(async (r) => { const ok = await rtc.answer(r.ref); if (!ok) { setWaitVoice(false); setErr('Allow the microphone to answer in the browser. Open the browser phone for help.'); openPhone(); return; } drop(c.id); openPhone(); }, [c.id, drop, openPhone, rtc]);"),
])

# Texting-only home: backend recent texts across hosted numbers
edit('js/hosted-sms.js', [("const api = { init, check, start,", """async function recent(chatId, limit = 10) {
  return S.db.collection('phoneLogs').find({ chatId: String(chatId), hosted: true, direction: 'inbound' }).sort({ timestamp: -1 }).limit(Math.min(50, limit)).toArray()
}

const api = { init, check, start, recent,""")])
edit('js/cloudivr-web/hosted.js', [("  router.get('/hosted-sms/:id/messages'", """  router.get('/hosted-sms/recent', h(async (req, res) => {
    const rows = await HS.recent(req.webChatId, Number(req.query.limit) || 10)
    res.json({ messages: rows.map(m => ({ id: String(m._id), phoneNumber: m.phoneNumber, from: m.from, body: m.body, at: m.timestamp })) })
  }))
  router.get('/hosted-sms/:id/messages'""")])

edit('frontend/src/cloudivr/pages/Dashboard.js', [
 ("import { ForYou, ReviewPrompt } from './dashboard/ForYou';", "import { ForYou, ReviewPrompt } from './dashboard/ForYou';\nimport { TextingHome } from './dashboard/TextingHome';\nimport { useApi as useApi2 } from '../api';"),
 ("  const { data: nums } = useApi(s && !fresh ? '/numbers' : null);", "  const { data: nums } = useApi(s && !fresh ? '/numbers' : null);\n  const { data: hosted } = useApi2(fresh ? '/hosted-sms' : null);\n  const textingOnly = fresh && hosted?.items?.some(x => !['rejected', 'cancelled'].includes(x.status));"),
 ("sub={fresh ? 'Three quick steps and your number is live.' : 'Your numbers, wallet and live activity at a glance.'}", "sub={textingOnly ? 'Your texting numbers and the latest texts from your customers.' : fresh ? 'Three quick steps and your number is live.' : 'Your numbers, wallet and live activity at a glance.'}"),
 ("{!s ? <SkeletonPage header={false} cards={3} rows={3} /> : fresh ? <GetStarted balance={s.balance} /> : (", "{!s || (fresh && !hosted) ? <SkeletonPage header={false} cards={3} rows={3} /> : textingOnly ? <TextingHome items={hosted.items} balance={s.balance} /> : fresh ? <GetStarted balance={s.balance} /> : ("),
])
s = open('frontend/src/cloudivr/pages/Dashboard.js').read().replace("import { useApi as useApi2 } from '../api';\n", "").replace("useApi2(", "useApi(")
open('frontend/src/cloudivr/pages/Dashboard.js', 'w').write(s)

# Landing: Texting plan · Landline to Texting
edit('frontend/src/cloudivr/pages/landing/PricingFaq.js', [
 ("""      <div className="flex items-center justify-between gap-2"><div className="text-lg font-semibold text-slate-900">Texting plan</div>""", """      <div className="text-xs font-semibold uppercase tracking-[.14em] text-slate-500" data-testid="pricing-texting-eyebrow">Landline to Texting</div>
      <div className="flex items-center justify-between gap-2 mt-1"><div className="text-lg font-semibold text-slate-900">Texting plan</div>"""),
 ("""      <ul className="mt-6 pt-6 border-t civr-l-rule flex-1 space-y-2.5 text-sm text-slate-700">{pts.map""", """      <p className="text-sm text-slate-700 mt-4" data-testid="pricing-texting-explainer">Landline to Texting lets customers text the office number they already call. Calls stay with your carrier.</p>
      <ul className="mt-6 pt-6 border-t civr-l-rule flex-1 space-y-2.5 text-sm text-slate-700">{pts.map"""),
])

NEW = {
 "Microphone allowed": ("Micrófono permitido", "Micro autorisé"),
 "Microphone not allowed yet": ("Micrófono aún no permitido", "Micro pas encore autorisé"),
 "Microphone blocked. Click the lock icon next to the web address, set Microphone to Allow, then reload this page.": ("Micrófono bloqueado. Haz clic en el candado junto a la dirección web, pon Micrófono en Permitir y recarga esta página.", "Micro bloqué. Cliquez sur le cadenas à côté de l’adresse web, réglez Micro sur Autoriser, puis rechargez la page."),
 "No microphone found. Plug one in or pick one in your computer’s sound settings.": ("No se encontró micrófono. Conecta uno o elígelo en los ajustes de sonido del equipo.", "Aucun micro trouvé. Branchez-en un ou choisissez-le dans les réglages son de l’ordinateur."),
 "This browser can’t use a microphone here. Try Chrome, Edge, Safari or Firefox.": ("Este navegador no puede usar el micrófono aquí. Prueba Chrome, Edge, Safari o Firefox.", "Ce navigateur ne peut pas utiliser de micro ici. Essayez Chrome, Edge, Safari ou Firefox."),
 "Allow microphone": ("Permitir micrófono", "Autoriser le micro"),
 "Check again": ("Comprobar otra vez", "Vérifier à nouveau"),
 "Allow the microphone to answer in the browser. Open the browser phone for help.": ("Permite el micrófono para contestar en el navegador. Abre el teléfono del navegador para ver cómo.", "Autorisez le micro pour répondre dans le navigateur. Ouvrez le téléphone du navigateur pour de l’aide."),
 "Your texting numbers and the latest texts from your customers.": ("Tus números de mensajes y los últimos mensajes de tus clientes.", "Vos numéros SMS et les derniers SMS de vos clients."),
 "Your texting numbers": ("Tus números de mensajes", "Vos numéros SMS"),
 "Latest texts": ("Últimos mensajes", "Derniers SMS"),
 "No texts yet. When a customer texts one of your numbers, it shows up here.": ("Aún no hay mensajes. Cuando un cliente escriba a uno de tus números, aparecerá aquí.", "Pas encore de SMS. Quand un client écrit à l’un de vos numéros, il apparaît ici."),
 "Open texting": ("Abrir mensajes", "Ouvrir les SMS"),
 "Want calls too?": ("¿También quieres llamadas?", "Vous voulez aussi les appels ?"),
 "Get a CloudIVR number for menus, forwarding and AI agents.": ("Consigue un número CloudIVR para menús, desvíos y agentes IA.", "Obtenez un numéro CloudIVR pour les menus, renvois et agents IA."),
 "Get a number": ("Conseguir un número", "Obtenir un numéro"),
 "Landline to Texting": ("Mensajes desde tu fijo", "SMS sur votre fixe"),
 "Landline to Texting lets customers text the office number they already call. Calls stay with your carrier.": ("Mensajes desde tu fijo permite a tus clientes escribir al número de oficina al que ya llaman. Las llamadas siguen con tu operador.", "SMS sur votre fixe permet à vos clients d’écrire au numéro de bureau qu’ils appellent déjà. Les appels restent chez votre opérateur."),
 "from {0}": ("de {0}", "de {0}"),
 "Wallet": ("Billetera", "Portefeuille"),
}
for lang, i in (('es', 0), ('fr', 1)):
    p = f'frontend/src/cloudivr/i18n/{lang}.json'
    d = json.load(open(p))
    for k, v in NEW.items(): d.setdefault(k, v[i]) if k in ('Landline to Texting', 'Wallet', 'Get a number') else d.__setitem__(k, v[i])
    open(p, 'w').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in d.items()) + '\n}')
print('ok')
