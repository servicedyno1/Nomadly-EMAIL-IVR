// Adds fr/es translations for the Texting Number copy (English-keyed UI dictionary).
const fs = require('fs')
const T = [
  ['Texting Number', 'Numéro SMS', 'Número SMS'],
  ['Texting Numbers', 'Numéros SMS', 'Números SMS'],
  ['USA eSIM', 'eSIM USA', 'eSIM de EE. UU.'],
  ['Phone numbers · USA eSIM', 'Numéros · eSIM USA', 'Números · eSIM de EE. UU.'],
  ['A USA number for sending and receiving texts right here in CloudIVR.', 'Un numéro USA pour envoyer et recevoir des SMS directement dans CloudIVR.', 'Un número de EE. UU. para enviar y recibir SMS aquí mismo en CloudIVR.'],
  ['Send and receive texts', 'Envoyez et recevez des SMS', 'Envía y recibe SMS'],
  ['Every text shows up in Messages, right next to your calls and voicemails.', 'Chaque SMS arrive dans Messages, à côté de vos appels et messages vocaux.', 'Cada SMS aparece en Mensajes, junto a tus llamadas y buzones de voz.'],
  ['Gets verification codes', 'Reçoit les codes de vérification', 'Recibe códigos de verificación'],
  ['A real USA carrier number, not VoIP, so most banks and apps accept it.', 'Un vrai numéro d’opérateur USA, pas VoIP : la plupart des banques et applis l’acceptent.', 'Un número real de operador de EE. UU., no VoIP: la mayoría de bancos y apps lo aceptan.'],
  ['Works in your browser', 'Fonctionne dans votre navigateur', 'Funciona en tu navegador'],
  ['No phone or SIM needed. You can also call out from the browser phone.', 'Ni téléphone ni SIM. Vous pouvez aussi appeler depuis le téléphone du navigateur.', 'Sin teléfono ni SIM. También puedes llamar desde el teléfono del navegador.'],
  ['Want the texts on your own phone?', 'Vous voulez les SMS sur votre propre téléphone ?', '¿Quieres los SMS en tu propio teléfono?'],
  ['Get a USA eSIM instead.', 'Prenez plutôt une eSIM USA.', 'Mejor consigue una eSIM de EE. UU.'],
  ['Keep the number you already have?', 'Garder le numéro que vous avez déjà ?', '¿Conservar el número que ya tienes?'],
  ['Add texting to your landline instead.', 'Ajoutez plutôt les SMS à votre ligne fixe.', 'Mejor añade SMS a tu línea fija.'],
  ['Texting Numbers are temporarily unavailable. Try again later.', 'Les numéros SMS sont temporairement indisponibles. Réessayez plus tard.', 'Los números SMS no están disponibles por ahora. Inténtalo más tarde.'],
  ['Send and receive texts in CloudIVR', 'Envoyez et recevez des SMS dans CloudIVR', 'Envía y recibe SMS en CloudIVR'],
  ['Get a Texting Number: a USA number for texts and verification codes, right in Messages. {0}/month.', 'Prenez un numéro SMS : un numéro USA pour les SMS et les codes de vérification, directement dans Messages. {0}/mois.', 'Consigue un número SMS: un número de EE. UU. para SMS y códigos de verificación, directamente en Mensajes. {0}/mes.'],
  ['Order a Texting Number', 'Commander un numéro SMS', 'Pedir un número SMS'],
  ['A USA number for sending and receiving texts right here in Messages, including verification codes. Works in your browser: no phone or SIM needed.', 'Un numéro USA pour envoyer et recevoir des SMS directement dans Messages, codes de vérification compris. Fonctionne dans votre navigateur : ni téléphone ni SIM.', 'Un número de EE. UU. para enviar y recibir SMS aquí mismo en Mensajes, incluidos códigos de verificación. Funciona en tu navegador: sin teléfono ni SIM.'],
  ['Manage it under', 'Gérez-le dans', 'Adminístralo en'],
  ['Outgoing calls from the browser phone already work.', 'Les appels sortants depuis le téléphone du navigateur fonctionnent déjà.', 'Las llamadas salientes desde el teléfono del navegador ya funcionan.'],
  ['Your Texting Numbers', 'Vos numéros SMS', 'Tus números SMS'],
  ['· texts in Messages, calls from the browser phone', '· SMS dans Messages, appels depuis le téléphone du navigateur', '· SMS en Mensajes, llamadas desde el teléfono del navegador'],
  ['Order a Texting Number to send and receive texts right here. Already have a business number? Add texting to it.', 'Commandez un numéro SMS pour envoyer et recevoir des SMS ici même. Vous avez déjà un numéro professionnel ? Ajoutez-y les SMS.', 'Pide un número SMS para enviar y recibir SMS aquí mismo. ¿Ya tienes un número de empresa? Añádele SMS.'],
  ['Add texting to my number', 'Ajouter les SMS à mon numéro', 'Añadir SMS a mi número'],
  ['A real USA carrier line on your own phone, installed with a QR code: texts, calls and data happen on the phone. Want to send and receive texts inside CloudIVR instead? Get a Texting Number.', 'Une vraie ligne d’opérateur USA sur votre propre téléphone, installée avec un QR code : SMS, appels et données se passent sur le téléphone. Vous voulez plutôt envoyer et recevoir des SMS dans CloudIVR ? Prenez un numéro SMS.', 'Una línea real de operador de EE. UU. en tu propio teléfono, instalada con un código QR: SMS, llamadas y datos ocurren en el teléfono. ¿Prefieres enviar y recibir SMS dentro de CloudIVR? Consigue un número SMS.'],
  ['Text customers from CloudIVR.', 'Écrivez à vos clients depuis CloudIVR.', 'Escribe a tus clientes desde CloudIVR.'],
  ['Order a Texting Number — send and receive texts right here', 'Commander un numéro SMS — envoyez et recevez des SMS ici même', 'Pedir un número SMS — envía y recibe SMS aquí mismo'],
  ['…or add texting to a number you already have', '…ou ajoutez les SMS à un numéro que vous avez déjà', '…o añade SMS a un número que ya tienes'],
  ['Texting Numbers use the browser phone', 'Les numéros SMS utilisent le téléphone du navigateur', 'Los números SMS usan el teléfono del navegador'],
  ['Your CloudIVR VoIP numbers answer your callers: switch forwarding, the keypad menu or hours here, or open a number for everything else. Your Texting Numbers and Landline to Texting numbers are listed below them.', 'Vos numéros VoIP CloudIVR répondent à vos appelants : changez le renvoi, le menu clavier ou les horaires ici, ou ouvrez un numéro pour tout le reste. Vos numéros SMS et numéros Fixe vers SMS sont listés en dessous.', 'Tus números VoIP de CloudIVR atienden a quienes llaman: cambia el desvío, el menú de teclado o el horario aquí, o abre un número para todo lo demás. Tus números SMS y de Fijo a SMS aparecen debajo.'],
  ['Numbers, eSIMs, Texting Numbers, renewals, texts, calls, campaigns and AI agent calls are all paid from here.', 'Numéros, eSIM, numéros SMS, renouvellements, SMS, appels, campagnes et appels d’agents IA sont tous payés d’ici.', 'Números, eSIM, números SMS, renovaciones, SMS, llamadas, campañas y llamadas de agentes IA se pagan desde aquí.'],
  ['Order a Texting Number', 'Commander un numéro SMS', 'Pedir un número SMS'],
  ['Your wallet is too low to send texts. Top up to keep texting.', 'Votre portefeuille est trop bas pour envoyer des SMS. Rechargez pour continuer.', 'Tu billetera no alcanza para enviar SMS. Recarga para seguir enviando.'],
  ['Sends as {0} joined texts', 'Envoyé en {0} SMS liés', 'Se envía como {0} SMS unidos'],
  ['Send and receive texts in your browser, on a real USA carrier number.', 'Envoyez et recevez des SMS dans votre navigateur, sur un vrai numéro d’opérateur USA.', 'Envía y recibe SMS en tu navegador, con un número real de operador de EE. UU.'],
  ['Open Texting Number in the app menu to finish the order.', 'Ouvrez Numéro SMS dans le menu de l’appli pour finir la commande.', 'Abre Número SMS en el menú de la app para terminar el pedido.'],
  ['A Texting Number', 'Un numéro SMS', 'Un número SMS'],
  ['Send and receive texts in your browser', 'Envoyez et recevez des SMS dans votre navigateur', 'Envía y recibe SMS en tu navegador'],
  ['Cloud phone, IVR and texting', 'Téléphonie cloud, IVR et SMS', 'Telefonía en la nube, IVR y SMS'],
  ['USA carrier lines and texting', 'Lignes d’opérateur USA et SMS', 'Líneas de operador de EE. UU. y SMS'],
  ['Want to text from your browser?', 'Envie d’envoyer des SMS depuis votre navigateur ?', '¿Quieres enviar SMS desde tu navegador?'],
  ['Is the Texting Number or the USA eSIM VoIP?', 'Le numéro SMS ou l’eSIM USA sont-ils en VoIP ?', '¿El número SMS o la eSIM de EE. UU. son VoIP?'],
  ['Can the Texting Number make calls?', 'Le numéro SMS peut-il passer des appels ?', '¿El número SMS puede hacer llamadas?'],
  ['Yes, outgoing calls from the browser phone, paid from your wallet. The number is also a free verified caller ID for your other CloudIVR calls.', 'Oui, des appels sortants depuis le téléphone du navigateur, payés depuis votre portefeuille. Le numéro est aussi une identification d’appelant vérifiée gratuite pour vos autres appels CloudIVR.', 'Sí, llamadas salientes desde el teléfono del navegador, pagadas desde tu billetera. El número también es un identificador de llamadas verificado gratuito para tus otras llamadas CloudIVR.'],
  ['Want texting in the browser? Get a Texting Number.', 'Envie de SMS dans le navigateur ? Prenez un numéro SMS.', '¿Quieres SMS en el navegador? Consigue un número SMS.'],
  ['Your Texting Number, renewal and replacement in one place.', 'Votre numéro SMS, son renouvellement et son remplacement au même endroit.', 'Tu número SMS, su renovación y su reemplazo en un solo lugar.'],
  ['Texting Number · {0}/month', 'Numéro SMS · {0}/mois', 'Número SMS · {0}/mes'],
  ['Texting Number · ZIP {0}', 'Numéro SMS · code ZIP {0}', 'Número SMS · ZIP {0}'],
]
for (const [file, i] of [['fr.json', 1], ['es.json', 2]]) {
  const p = `/app/frontend/src/cloudivr/i18n/${file}`, d = JSON.parse(fs.readFileSync(p, 'utf8'))
  for (const row of T) d[row[0]] = row[i]
  // Sentences that only swapped the product name: carry the old translation over with the new term.
  const term = i === 1 ? [[/num[ée]ros? mobiles? (virtuels? )?USA/gi, 'numéro SMS']] : [[/n[úu]meros? m[óo]vil(es)? (virtual(es)? )?(de EE\. ?UU\.|USA)/gi, 'número SMS']]
  for (const k of Object.keys(d)) if (/USA mobile number/.test(k)) {
    const nk = k.replace(/USA mobile numbers/g, 'Texting Numbers').replace(/the USA mobile number/g, 'the Texting Number').replace(/The USA mobile number/g, 'The Texting Number').replace(/USA mobile number/g, 'Texting Number')
    if (d[nk] == null) d[nk] = term.reduce((v, [re, to]) => v.replace(re, to), d[k])
  }
  fs.writeFileSync(p, '{\n' + Object.entries(d).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n') + '\n}\n')
}
console.log('ok')
