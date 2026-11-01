import json, os
os.chdir('/app/frontend/src/cloudivr/i18n')
N = {
 "Selected": ("Seleccionado", "Sélectionné"),
 "+1 US number": ("Número de EE. UU. (+1)", "Numéro américain (+1)"),
 "This cycle:": ("Este ciclo:", "Ce cycle :"),
 "Data {0} of {1} {2}": ("Datos {0} de {1} {2}", "Données {0} sur {1} {2}"),
 "Calls {0} of {1} min": ("Llamadas {0} de {1} min", "Appels {0} sur {1} min"),
 "Texts {0} (unlimited)": ("Mensajes {0} (ilimitados)", "SMS {0} (illimités)"),
 "Texts {0} of {1}": ("Mensajes {0} de {1}", "SMS {0} sur {1}"),
 "${0}/month": ("${0}/mes", "{0} $/mois"),
 "next {0}": ("próximo {0}", "prochain {0}"),
 "Renew ${0}": ("Renovar ${0}", "Renouveler {0} $"),
 "Keep eSIM": ("Conservar eSIM", "Garder l’eSIM"),
 "Cancel this eSIM?": ("¿Cancelar esta eSIM?", "Annuler cette eSIM ?"),
 "Cancel the eSIM {0}? The line stops working and its number can’t be recovered. Monthly fees already paid aren’t refunded.": ("¿Cancelar la eSIM {0}? La línea deja de funcionar y su número no se puede recuperar. Las cuotas mensuales ya pagadas no se reembolsan.", "Annuler l’eSIM {0} ? La ligne cesse de fonctionner et son numéro ne peut pas être récupéré. Les frais mensuels déjà payés ne sont pas remboursés."),
 "/ {0} days": ("/ {0} días", "/ {0} jours"),
 "{0} data": ("{0} de datos", "{0} de données"),
 "{0} minutes of calls": ("{0} minutos de llamadas", "{0} minutes d’appels"),
 "{0} texts": ("{0} mensajes", "{0} SMS"),
 "Unlimited texts": ("Mensajes ilimitados", "SMS illimités"),
 "renews monthly from your wallet": ("se renueva cada mes desde tu billetera", "renouvelé chaque mois depuis votre portefeuille"),
 "Pick an eSIM plan": ("Elige un plan eSIM", "Choisissez un forfait eSIM"),
 "Scan the QR code on your phone": ("Escanea el código QR con tu teléfono", "Scannez le QR code avec votre téléphone"),
 "Free to create. Next you pick your eSIM plan.": ("Crear la cuenta es gratis. Después eliges tu plan eSIM.", "Création gratuite. Ensuite, vous choisissez votre forfait eSIM."),
 "CloudIVR eSIM picked — you’ll choose your plan and scan the QR code next.": ("eSIM de CloudIVR elegida: después eliges tu plan y escaneas el código QR.", "eSIM CloudIVR choisie : ensuite, vous choisissez votre forfait et scannez le QR code."),
 "$0.05 from your wallet": ("$0.05 de tu billetera", "0,05 $ depuis votre portefeuille"),
 "The QR code didn’t load. Reload the page to try again.": ("El código QR no cargó. Recarga la página para intentarlo de nuevo.", "Le QR code ne s’est pas chargé. Rechargez la page pour réessayer."),
 "Renewed": ("Renovada", "Renouvelée"),
 "Saved. We’ll switch calls to CloudIVR once routing is connected": ("Guardado. Pasaremos las llamadas a CloudIVR cuando el enrutamiento esté conectado", "Enregistré. Nous basculerons les appels vers CloudIVR dès que le routage sera connecté"),
 "Paid ${0}. Creating your eSIM": ("Pagado ${0}. Creando tu eSIM", "{0} $ payés. Création de votre eSIM"),
 "We couldn’t create the eSIM right now. Your ${0} was refunded to your wallet.": ("No pudimos crear la eSIM ahora. Tus ${0} se devolvieron a tu billetera.", "Nous n’avons pas pu créer l’eSIM pour le moment. Vos {0} $ ont été remboursés sur votre portefeuille."),
 "The eSIM couldn’t be created. Your payment was refunded.": ("No se pudo crear la eSIM. Se te devolvió el pago.", "L’eSIM n’a pas pu être créée. Votre paiement a été remboursé."),
 "Texts from this eSIM aren’t switched on yet. We’ve let support know. You weren’t charged.": ("Los mensajes de esta eSIM aún no están activados. Avisamos a soporte. No se te cobró.", "Les SMS de cette eSIM ne sont pas encore activés. Nous avons prévenu le support. Vous n’avez pas été débité."),
 "The text couldn’t be sent. You weren’t charged. Try again in a minute.": ("No se pudo enviar el mensaje. No se te cobró. Inténtalo en un minuto.", "Le SMS n’a pas pu être envoyé. Vous n’avez pas été débité. Réessayez dans une minute."),
 "The eSIM service didn’t respond. Try again in a minute.": ("El servicio de eSIM no respondió. Inténtalo en un minuto.", "Le service eSIM n’a pas répondu. Réessayez dans une minute."),
 "Your wallet needs ${0} for this eSIM. Top up first.": ("Tu billetera necesita ${0} para esta eSIM. Recarga primero.", "Votre portefeuille doit contenir {0} $ pour cette eSIM. Rechargez d’abord."),
 "Enter your phone’s 15-digit IMEI (dial *#06# to see it).": ("Escribe el IMEI de 15 dígitos de tu teléfono (marca *#06# para verlo).", "Saisissez l’IMEI à 15 chiffres de votre téléphone (composez *#06# pour l’afficher)."),
}
for lang, i in (('es', 0), ('fr', 1)):
    d = json.load(open(f'{lang}.json'))
    for k, v in N.items(): d[k] = v[i]
    open(f'{lang}.json', 'w').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(x, ensure_ascii=False)}' for k, x in d.items()) + '\n}')
print('ok')
