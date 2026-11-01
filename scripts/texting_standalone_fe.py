import json, os
os.chdir('/app')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a); s = s.replace(a, b)
    open(p, 'w').write(s)

edit('frontend/src/cloudivr/pages/texting/Thread.js', [
 ("// Texts on a hosted number (newest last) + compose.", "// Texts on a hosted number (newest last). Texting-plan numbers are receive-only; older add-on numbers can compose."),
 ("  const dest = useDestCheck(item.status === 'active' ? item.phoneNumber : null, to);", "  const canSend = item.status === 'active' && item.plan !== 'texting';\n  const dest = useDestCheck(canSend ? item.phoneNumber : null, to);"),
 ("      {item.status === 'active' && <ReachChip phone={item.phoneNumber} testid=\"texting-reach\" />}", "      {canSend && <ReachChip phone={item.phoneNumber} testid=\"texting-reach\" />}"),
 ("        {!rows.length && <p className=\"text-sm text-[#a1a1aa]\">No texts yet.</p>}", "        {!rows.length && <p className=\"text-sm text-[#a1a1aa]\" data-testid=\"texting-no-messages\">{item.status === 'active' ? 'No texts yet. Ask someone to text this number to see it arrive here.' : 'No texts yet.'}</p>}"),
 ("<button type=\"button\" onClick={() => m.direction === 'inbound' && setTo(m.from)}", "<button type=\"button\" onClick={() => canSend && m.direction === 'inbound' && setTo(m.from)}"),
 ("""      {item.status === 'active' && (
        <div className="grid sm:grid-cols-[200px_1fr_auto] gap-2">""", """      {canSend && (
        <div className="grid sm:grid-cols-[200px_1fr_auto] gap-2">"""),
 ("      {item.status === 'active' && <DestNote check={dest} testid=\"texting-dest-note\" />}", "      {canSend && <DestNote check={dest} testid=\"texting-dest-note\" />}"),
])

p = 'frontend/src/cloudivr/pages/texting/NumberPanel.js'; s = open(p).read()
a = s.index('<div className="text-xs text-[#a1a1aa] space-y-1" data-testid="texting-billing">'); b = s.index('</div>', a) + len('</div>')
s = s[:a] + """<p className="text-xs text-[#a1a1aa]" data-testid="texting-billing">{item.planNumber ? `Texting add-on · renews with your ${item.plan[0].toUpperCase() + item.plan.slice(1)} plan on ${item.planNumber}, no monthly fee` : `Texting plan · next $${item.monthly} on ${String(item.nextBillAt || '').slice(0, 10)} · incoming texts are free`}</p>""" + s[b:]
open(p, 'w').write(s)

edit('frontend/src/cloudivr/pages/Texting.js', [
 ("  const preset = params.get('start') === 'texting' ? 'new' : null;\n  const [adding, setAdding] = useState(!!preset || params.get('add') === '1');", "  const [adding, setAdding] = useState(params.get('start') === 'texting' || params.get('add') === '1');"),
 ("{adding && data && <NewSetup data={data} initialKind={preset} onDone={done} onCancel={() => setAdding(false)} />}", "{adding && data && <NewSetup data={data} onDone={done} onCancel={() => setAdding(false)} />}"),
])
s = open('frontend/src/cloudivr/pages/Texting.js').read()
a = s.index("  const pp = data.planPrices || {};"); b = s.index("\n", s.index("const cells = ", a))
s = s[:a] + """  const t = data.texting || {};
  const cells = [[`$${t.setup}`, 'once per number · includes the first month'], [`$${t.monthly}`, 'per month after that'], ['Free', 'incoming texts, as many as you get']];""" + s[b:]
open('frontend/src/cloudivr/pages/Texting.js', 'w').write(s)

p = 'frontend/src/cloudivr/pages/landing/PricingFaq.js'; s = open(p).read()
a = s.index("function TextingCard({ t, start, delay }) {"); b = s.index("export function Pricing({ catalog }) {")
s = s[:a] + """function TextingCard({ t, start, delay }) {
  const pts = ['Incoming texts are free', 'Keep your number and your calls', 'Read every text in the app', 'US & Canada landline or toll-free'];
  return (
    <Reveal delay={delay} className="civr-l-card-cream p-8 flex flex-col" data-testid="civr-plan-card-texting">
      <div className="flex items-center justify-between gap-2"><div className="text-lg font-semibold text-slate-900">Texting plan</div><span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-900 grid place-items-center"><MessageSquareText className="w-4 h-4" /></span></div>
      <div className="civr-l-h text-5xl text-slate-900 mt-6" data-testid="pricing-price-texting">{usd(t.setup)}<span className="text-base font-medium tracking-normal text-slate-500"> to start</span></div>
      <div className="text-sm text-slate-500 mt-2" data-testid="pricing-allowance-texting">{`first month included, then ${usd(t.monthly)}/month · receive texts on the number you already have`}</div>
      <ul className="mt-6 pt-6 border-t civr-l-rule flex-1 space-y-2.5 text-sm text-slate-700">{pts.map(x => <li key={x} className="flex gap-2"><Check className="w-4 h-4 mt-0.5 text-emerald-600 shrink-0" />{x}</li>)}</ul>
      <Link to={start('texting')} className="civr-l-btn civr-l-btn-ghost mt-8 w-full" data-testid="pricing-choose-texting"><Slide>Start texting</Slide></Link>
    </Reveal>
  );
}

""" + s[b:]
open(p, 'w').write(s)

edit('frontend/src/cloudivr/pages/landing/Platform.js', [("Your customers already know your office or landline number — now they can text it. We switch on texting for your existing US or Canada number while your calls stay with your current carrier. Read every text in the CloudIVR app. Start with the Texting plan, or add texting to a Starter, Pro or Business number.", "Your customers already know your office or landline number — now they can text it. We switch on incoming texts for your existing US or Canada number while your calls stay with your current carrier. Read every text in the CloudIVR app. $200 to start, then $50/month, incoming texts free.")])
edit('frontend/src/cloudivr/pages/dashboard/NewProducts.js', [("'Get texts on the business number you already have, on the Texting plan or as an add-on.'", "'Get texts on the business number you already have. Incoming texts are free.'")])
edit('frontend/src/cloudivr/pages/admin/Texting.js', [("{x.plan === 'texting' ? (x.planNumber ? `Texting plan of ${x.planNumber}` : 'Texting plan')", "{x.plan === 'texting' ? 'Texting plan'")])

NEW = {
 "Texting plan": ("Plan de mensajes", "Forfait SMS"),
 "${0} once, includes your first month. Then ${1}/month from your wallet. Incoming texts are free.": ("${0} una vez, incluye tu primer mes. Luego ${1}/mes desde tu monedero. Los mensajes entrantes son gratis.", "{0} $ une fois, premier mois inclus. Puis {1} $/mois depuis votre portefeuille. Les SMS reçus sont gratuits."),
 "Your business number, with country code": ("Tu número de empresa, con prefijo del país", "Votre numéro professionnel, avec indicatif"),
 "Receives texts only. Your customers text this number and you read every message here. Usually live within {0}.": ("Solo recibe mensajes. Tus clientes escriben a este número y tú lees cada mensaje aquí. Normalmente activo en {0}.", "Réception de SMS uniquement. Vos clients écrivent à ce numéro et vous lisez chaque message ici. Généralement actif sous {0}."),
 "Pay ${0} from wallet": ("Pagar ${0} con el monedero", "Payer {0} $ avec le portefeuille"),
 "Texting plan · next ${0} on {1} · incoming texts are free": ("Plan de mensajes · próximo cobro ${0} el {1} · los mensajes entrantes son gratis", "Forfait SMS · prochain {0} $ le {1} · SMS reçus gratuits"),
 "No texts yet. Ask someone to text this number to see it arrive here.": ("Aún no hay mensajes. Pide a alguien que escriba a este número para verlo llegar aquí.", "Pas encore de SMS. Demandez à quelqu’un d’écrire à ce numéro pour le voir arriver ici."),
 "once per number · includes the first month": ("una vez por número · incluye el primer mes", "une fois par numéro · premier mois inclus"),
 "per month after that": ("al mes después", "par mois ensuite"),
 "Free": ("Gratis", "Gratuit"),
 "incoming texts, as many as you get": ("mensajes entrantes, todos los que recibas", "SMS reçus, autant que vous en recevez"),
 "Incoming texts are free": ("Los mensajes entrantes son gratis", "Les SMS reçus sont gratuits"),
 "US & Canada landline or toll-free": ("Fijo o gratuito de EE. UU. y Canadá", "Fixe ou gratuit États-Unis et Canada"),
 "first month included, then ${0}/month · receive texts on the number you already have": ("primer mes incluido, luego ${0}/mes · recibe mensajes en el número que ya tienes", "premier mois inclus, puis {0} $/mois · recevez des SMS sur votre numéro actuel"),
 "Your customers already know your office or landline number — now they can text it. We switch on incoming texts for your existing US or Canada number while your calls stay with your current carrier. Read every text in the CloudIVR app. $200 to start, then $50/month, incoming texts free.": ("Tus clientes ya conocen tu número de oficina o fijo: ahora también pueden escribirle. Activamos los mensajes entrantes en tu número de EE. UU. o Canadá y tus llamadas siguen con tu operador. Lee cada mensaje en la app de CloudIVR. $200 para empezar, luego $50/mes, mensajes entrantes gratis.", "Vos clients connaissent déjà votre numéro de bureau ou fixe — désormais ils peuvent lui écrire. Nous activons la réception de SMS sur votre numéro des États-Unis ou du Canada, vos appels restent chez votre opérateur. Lisez chaque SMS dans l’app CloudIVR. 200 $ pour commencer, puis 50 $/mois, SMS reçus gratuits."),
 "Get texts on the business number you already have. Incoming texts are free.": ("Recibe mensajes en el número de empresa que ya tienes. Los mensajes entrantes son gratis.", "Recevez des SMS sur votre numéro professionnel actuel. Les SMS reçus sont gratuits."),
 "This number receives texts only.": ("Este número solo recibe mensajes.", "Ce numéro reçoit uniquement des SMS."),
}
for lang, i in (('es', 0), ('fr', 1)):
    p = f'frontend/src/cloudivr/i18n/{lang}.json'
    d = json.load(open(p))
    for k, v in NEW.items(): d[k] = v[i]
    open(p, 'w').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in d.items()) + '\n}')
print('ok')
