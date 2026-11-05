import json, os
os.chdir('/app')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a); s = s.replace(a, b)
    open(p, 'w').write(s)

edit('frontend/src/cloudivr/pages/texting/NumberPanel.js', [(
"""<p className="text-xs text-[#a1a1aa]" data-testid="texting-billing">{item.planNumber ? <>Renews with your {item.plan[0].toUpperCase() + item.plan.slice(1)} plan on <span className="font-mono" data-no-translate>{item.planNumber}</span>, no monthly fee</> : <>Texting plan · next ${item.monthly} on {String(item.nextBillAt || '').slice(0, 10)}{item.inboundIncluded ? <> · <span data-testid="texting-inbound-used">{item.inboundUsed} of {item.inboundIncluded}</span> incoming texts used this month</> : null}</>} · then ${meta.textPrice.toFixed(2)} per text · incoming texts also land in your Inbox.</p>""",
"""<div className="text-xs text-[#a1a1aa] space-y-1" data-testid="texting-billing">
        <p>{item.planNumber ? `Texting add-on · renews with your ${item.plan[0].toUpperCase() + item.plan.slice(1)} plan on ${item.planNumber}, no monthly fee` : `Texting plan · next $${item.monthly} on ${String(item.nextBillAt || '').slice(0, 10)}`}</p>
        {item.inboundIncluded ? <p data-testid="texting-inbound-used">{`${item.inboundUsed} of ${item.inboundIncluded} included incoming texts used this month`}</p> : null}
        <p>{`Then $${meta.textPrice.toFixed(2)} per text. Incoming texts also land in your Inbox.`}</p>
      </div>""")])
edit('frontend/src/cloudivr/pages/BuyNumber.js', [("""<Link to={cp('/app/texting?add=1')} className="text-[#818cf8] underline underline-offset-2">Add texting to it</Link>""", """<Link to={cp('/app/texting?add=1')} className="inline-block py-2 text-[#818cf8] underline underline-offset-2" data-testid="buy-texting-link-button">Add texting to it</Link>""")])

NEW = {
 "Texting add-on · renews with your {0} plan on {1}, no monthly fee": ("Complemento de mensajes · se renueva con tu plan {0} en {1}, sin cuota mensual", "Option SMS · se renouvelle avec votre forfait {0} sur {1}, sans frais mensuels"),
 "{0} of {1} included incoming texts used this month": ("{0} de {1} mensajes entrantes incluidos usados este mes", "{0} sur {1} SMS reçus inclus utilisés ce mois-ci"),
 "Then ${0} per text. Incoming texts also land in your Inbox.": ("Luego ${0} por mensaje. Los mensajes entrantes también llegan a tu bandeja.", "Puis {0} $ par SMS. Les SMS reçus arrivent aussi dans votre boîte de réception."),
 "can text {0} countries": ("puede escribir a {0} países", "peut écrire vers {0} pays"),
 "can text {0} country": ("puede escribir a {0} país", "peut écrire vers {0} pays"),
 "receiving only": ("solo recepción", "réception uniquement"),
 "Texting US mobiles from this number needs business texting registration (10DLC) first. Receiving works now.": ("Para escribir a móviles de EE. UU. desde este número hace falta primero el registro de mensajes de empresa (10DLC). La recepción ya funciona.", "Pour écrire aux mobiles américains depuis ce numéro, l’enregistrement SMS professionnel (10DLC) est d’abord nécessaire. La réception fonctionne déjà."),
}
for lang, i in (('es', 0), ('fr', 1)):
    p = f'frontend/src/cloudivr/i18n/{lang}.json'
    d = json.load(open(p))
    for k, v in NEW.items(): d[k] = v[i]
    open(p, 'w').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in d.items()) + '\n}')
print('ok')
