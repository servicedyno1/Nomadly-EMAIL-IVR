import json, os
os.chdir('/app')
NEW = {
 "How do you want to add texting?": ("¿Cómo quieres añadir mensajes?", "Comment voulez-vous ajouter les SMS ?"),
 "Start a Texting plan": ("Empezar un plan de mensajes", "Démarrer un forfait SMS"),
 "Then ${0}/month · {1} incoming texts a month included": ("Luego ${0}/mes · {1} mensajes entrantes al mes incluidos", "Puis {0} $/mois · {1} SMS reçus par mois inclus"),
 "Add texting to one of my plans": ("Añadir mensajes a uno de mis planes", "Ajouter les SMS à l’un de mes forfaits"),
 "One-time fee per number, no monthly fee": ("Pago único por número, sin cuota mensual", "Frais uniques par numéro, sans frais mensuels"),
 "Extra number on your Texting plan": ("Número extra en tu plan de mensajes", "Numéro supplémentaire sur votre forfait SMS"),
 "Texting add-on on your {0} plan": ("Complemento de mensajes en tu plan {0}", "Option SMS sur votre forfait {0}"),
 "{0} added": ("{0} añadidos", "{0} ajoutés"),
 "Plan not active, renew it first": ("Plan no activo, renuévalo primero", "Forfait inactif, renouvelez-le d’abord"),
 "Full: {0} of {1} used": ("Completo: {0} de {1} usados", "Complet : {0} sur {1} utilisés"),
 "Texting add-on per number on Starter, Pro or Business · no monthly fee": ("Complemento de mensajes por número en Starter, Pro o Business · sin cuota mensual", "Option SMS par numéro sur Starter, Pro ou Business · sans frais mensuels"),
 "Already have a business number?": ("¿Ya tienes un número de empresa?", "Vous avez déjà un numéro professionnel ?"),
 "Add texting to it": ("Añádele mensajes", "Activez-y les SMS"),
 "Texting plan": ("Plan de mensajes", "Forfait SMS"),
 "to start": ("para empezar", "pour commencer"),
 "then ${0}/month · for the business number you already have": ("luego ${0}/mes · para el número de empresa que ya tienes", "puis {0} $/mois · pour le numéro professionnel que vous avez déjà"),
 "{0} incoming texts/month included": ("{0} mensajes entrantes/mes incluidos", "{0} SMS reçus/mois inclus"),
 "Keep your number and your calls": ("Conserva tu número y tus llamadas", "Gardez votre numéro et vos appels"),
 "Read every text in the app": ("Lee cada mensaje en la app", "Lisez chaque SMS dans l’app"),
 "Extra numbers ${0} each": ("Números extra a ${0} cada uno", "Numéros supplémentaires {0} $ chacun"),
 "Already on Starter, Pro or Business? Add texting from ${0} per number, no monthly fee.": ("¿Ya tienes Starter, Pro o Business? Añade mensajes desde ${0} por número, sin cuota mensual.", "Déjà sur Starter, Pro ou Business ? Ajoutez les SMS dès {0} $ par numéro, sans frais mensuels."),
 "Start texting": ("Empezar con mensajes", "Commencer les SMS"),
 "Enter your business number": ("Introduce tu número de empresa", "Saisissez votre numéro professionnel"),
 "Pay from your wallet": ("Paga con tu monedero", "Payez avec votre portefeuille"),
 "Read your customers’ texts": ("Lee los mensajes de tus clientes", "Lisez les SMS de vos clients"),
 "Free to create. Next you add your business number.": ("Gratis. Después añades tu número de empresa.", "Gratuit. Ensuite, vous ajoutez votre numéro professionnel."),
 "Texting plan picked — you’ll add your business number next.": ("Plan de mensajes elegido: después añadirás tu número de empresa.", "Forfait SMS choisi — vous ajouterez ensuite votre numéro professionnel."),
 "We turn on texting for your existing US or Canada landline — calls keep working as before. See the Texting plan in Pricing.": ("Activamos los mensajes en tu fijo de EE. UU. o Canadá; las llamadas siguen igual. Mira el plan de mensajes en Precios.", "Nous activons les SMS sur votre fixe des États-Unis ou du Canada — les appels fonctionnent comme avant. Voir le forfait SMS dans Tarifs."),
 "Your customers already know your office or landline number — now they can text it. We switch on texting for your existing US or Canada number while your calls stay with your current carrier. Read every text in the CloudIVR app. Start with the Texting plan, or add texting to a Starter, Pro or Business number.": ("Tus clientes ya conocen tu número de oficina o fijo: ahora también pueden escribirle. Activamos los mensajes en tu número de EE. UU. o Canadá y tus llamadas siguen con tu operador. Lee cada mensaje en la app de CloudIVR. Empieza con el plan de mensajes o añádelos a un número Starter, Pro o Business.", "Vos clients connaissent déjà votre numéro de bureau ou fixe — désormais ils peuvent lui écrire. Nous activons les SMS sur votre numéro des États-Unis ou du Canada, vos appels restent chez votre opérateur. Lisez chaque SMS dans l’app CloudIVR. Commencez avec le forfait SMS, ou ajoutez les SMS à un numéro Starter, Pro ou Business."),
 "Get texts on the business number you already have, on the Texting plan or as an add-on.": ("Recibe mensajes en el número de empresa que ya tienes, con el plan de mensajes o como complemento.", "Recevez des SMS sur votre numéro professionnel actuel, avec le forfait SMS ou en option."),
 "Texting plan · next ${0} on {1}": ("Plan de mensajes · próximo cobro ${0} el {1}", "Forfait SMS · prochain {0} $ le {1}"),
}
for lang, i in (('es', 0), ('fr', 1)):
    p = f'frontend/src/cloudivr/i18n/{lang}.json'
    d = json.load(open(p))
    for k, v in NEW.items(): d[k] = v[i]
    open(p, 'w').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in d.items()) + '\n}')
print('ok')
