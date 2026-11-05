#!/usr/bin/env python3
"""FR/ES strings for the 2026 landing page upgrade (Hear it, use cases, trust, proof, plan tables, new FAQs, cookie bar).
Adds only keys that are missing; keys with {0}/{1} slots are patterns the i18n engine fills in.  Run: python3 scripts/civr_i18n_landing_2026.py"""
import json, os

ROOT = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'src', 'cloudivr', 'i18n')

S = {
 # Hear it
 "Hear a 30-second call": ("Écoutez un appel de 30 secondes", "Escucha una llamada de 30 segundos"),
 "Playing a sample call": ("Lecture d’un appel d’exemple", "Reproduciendo una llamada de ejemplo"),
 "That was 30 seconds of CloudIVR": ("C’était 30 secondes de CloudIVR", "Eso fueron 30 segundos de CloudIVR"),
 "Keypad menu · key press · AI agent books a slot · handover to a person. Made with CloudIVR’s own voices.": ("Menu à touches · appui sur une touche · l’agent IA réserve un créneau · passage à une personne. Réalisé avec les voix de CloudIVR.", "Menú de teclado · pulsación de tecla · el agente IA reserva una cita · paso a una persona. Hecho con las voces de CloudIVR."),
 "Read the transcript": ("Lire la transcription", "Leer la transcripción"),
 "Playback was blocked — tap play again.": ("La lecture a été bloquée — appuyez de nouveau sur lecture.", "La reproducción fue bloqueada — pulsa reproducir otra vez."),
 "Play a sample call": ("Écouter un appel d’exemple", "Reproducir una llamada de ejemplo"),
 "Pause the sample call": ("Mettre l’appel d’exemple en pause", "Pausar la llamada de ejemplo"),
 "Sample call position": ("Position dans l’appel d’exemple", "Posición en la llamada de ejemplo"),
 "Pay with crypto or your wallet (cards coming soon)": ("Payez en crypto ou depuis votre portefeuille (cartes bientôt)", "Paga con cripto o desde tu monedero (tarjetas próximamente)"),
 # Proof strip
 "Live from the platform": ("En direct de la plateforme", "En directo desde la plataforma"),
 "Real figures": ("Chiffres réels", "Cifras reales"),
 "updated daily": ("mis à jour chaque jour", "actualizado a diario"),
 "last {0}": ("dernière mise à jour {0}", "última {0}"),
 "Calls handled on the platform": ("Appels traités sur la plateforme", "Llamadas gestionadas en la plataforma"),
 "Campaign calls placed by Bulk IVR and AI agents": ("Appels de campagne passés par Bulk IVR et les agents IA", "Llamadas de campaña realizadas por Bulk IVR y agentes IA"),
 "Numbers live right now": ("Numéros actifs en ce moment", "Números activos ahora mismo"),
 "Countries with numbers": ("Pays avec des numéros", "Países con números"),
 # Use cases
 "Who it’s for": ("Pour qui", "Para quién"),
 "Pick your situation. We’ll show you the feature.": ("Choisissez votre situation. On vous montre la fonction.", "Elige tu situación. Te mostramos la función."),
 "Six ways people run their phone line on CloudIVR — each one points at the part of the platform that does the work.": ("Six façons de gérer sa ligne téléphonique sur CloudIVR — chacune renvoie à la partie de la plateforme qui fait le travail.", "Seis formas de llevar tu línea telefónica en CloudIVR — cada una apunta a la parte de la plataforma que hace el trabajo."),
 "Sales team calling a list": ("Équipe commerciale qui appelle une liste", "Equipo de ventas que llama a una lista"),
 "Call 500 leads before lunch — and talk only to the ones who press 1.": ("Appelez 500 prospects avant midi — et ne parlez qu’à ceux qui appuient sur 1.", "Llama a 500 prospectos antes de comer — y habla solo con los que pulsan 1."),
 "Bulk IVR plays your pitch, connects the interested, collects codes and shows every call live on a map.": ("Bulk IVR joue votre argumentaire, met en relation les intéressés, collecte des codes et affiche chaque appel en direct sur une carte.", "Bulk IVR reproduce tu mensaje, conecta a los interesados, recoge códigos y muestra cada llamada en directo en un mapa."),
 "Support line with a menu": ("Ligne support avec un menu", "Línea de soporte con menú"),
 "Press 1 for sales, 2 for support. Every caller lands with the right person in under a second.": ("Tapez 1 pour les ventes, 2 pour le support. Chaque appelant arrive chez la bonne personne en moins d’une seconde.", "Pulsa 1 para ventas, 2 para soporte. Cada llamante llega a la persona correcta en menos de un segundo."),
 "Solo founder sounding like a company": ("Fondateur solo qui sonne comme une entreprise", "Fundador en solitario que suena como una empresa"),
 "A greeting, a menu and voicemail that reads itself to you — one number, your mobile, no desk.": ("Une annonce, un menu et une messagerie qui se lit toute seule — un numéro, votre mobile, pas de bureau.", "Un saludo, un menú y un buzón de voz que se lee solo — un número, tu móvil, sin oficina."),
 "Agency managing numbers in several countries": ("Agence qui gère des numéros dans plusieurs pays", "Agencia que gestiona números en varios países"),
 "A local number in each market, every client in one account.": ("Un numéro local sur chaque marché, tous les clients dans un seul compte.", "Un número local en cada mercado, todos los clientes en una sola cuenta."),
 "Crypto-native business paying in USDT": ("Entreprise crypto qui paie en USDT", "Negocio cripto que paga en USDT"),
 "Top up a wallet in USDT, BTC or ETH. Every call shows its price before you start it.": ("Rechargez un portefeuille en USDT, BTC ou ETH. Chaque appel affiche son prix avant de démarrer.", "Recarga un monedero en USDT, BTC o ETH. Cada llamada muestra su precio antes de empezar."),
 "Telegram user moving to the web": ("Utilisateur Telegram qui passe au web", "Usuario de Telegram que pasa a la web"),
 "Same calling engine as the bot, now with a dashboard, live map, contacts and campaign history. It’s a separate web account — sign up with your email.": ("Le même moteur d’appels que le bot, avec en plus un tableau de bord, une carte en direct, des contacts et l’historique des campagnes. C’est un compte web séparé — inscrivez-vous avec votre e-mail.", "El mismo motor de llamadas que el bot, ahora con panel, mapa en directo, contactos e historial de campañas. Es una cuenta web independiente — regístrate con tu correo."),
 "See how it works": ("Voir comment ça marche", "Ver cómo funciona"),
 "Create your web account": ("Créer votre compte web", "Crea tu cuenta web"),
 # Trust
 "Trust & compliance": ("Confiance et conformité", "Confianza y cumplimiento"),
 "Built for calling you can stand behind.": ("Conçu pour des appels que vous pouvez assumer.", "Hecho para llamadas que puedes defender."),
 "Outbound campaigns, recordings and AI agents come with rules. Here is what CloudIVR does about them — today, not someday.": ("Campagnes sortantes, enregistrements et agents IA obéissent à des règles. Voici ce que CloudIVR fait pour les respecter — aujourd’hui, pas un jour.", "Las campañas salientes, las grabaciones y los agentes IA tienen reglas. Esto es lo que CloudIVR hace al respecto — hoy, no algún día."),
 "We don’t sell your data. Logs, recordings and transcripts stay in your account.": ("Nous ne vendons pas vos données. Journaux, enregistrements et transcriptions restent dans votre compte.", "No vendemos tus datos. Registros, grabaciones y transcripciones se quedan en tu cuenta."),
 "Consent is yours to hold": ("Le consentement, c’est vous qui le détenez", "El consentimiento lo tienes tú"),
 "Automated, pre-recorded and AI calls need the consent the law requires. Before any campaign runs you confirm you have it — and that you may contact everyone on your list. It’s in our terms, and we enforce them.": ("Les appels automatisés, préenregistrés et IA exigent le consentement prévu par la loi. Avant toute campagne, vous confirmez l’avoir — et pouvoir contacter chaque personne de votre liste. C’est dans nos conditions, et nous les faisons respecter.", "Las llamadas automatizadas, pregrabadas y con IA necesitan el consentimiento que exige la ley. Antes de lanzar una campaña confirmas que lo tienes — y que puedes contactar a todos los de tu lista. Está en nuestros términos, y los hacemos cumplir."),
 "Opt-outs are honoured everywhere": ("Les désinscriptions sont respectées partout", "Las bajas se respetan en todas partes"),
 "Your do-not-call list applies to every campaign — Bulk IVR and AI, web and Telegram bot. Numbers on it are never dialled and never billed. Tell the AI agent “don’t call me again” and it apologises, removes you and ends the call.": ("Votre liste « ne pas appeler » s’applique à chaque campagne — Bulk IVR et IA, web et bot Telegram. Les numéros qui y figurent ne sont jamais composés ni facturés. Dites à l’agent IA « ne me rappelez plus » : il s’excuse, vous retire et raccroche.", "Tu lista de no llamar se aplica a todas las campañas — Bulk IVR e IA, web y bot de Telegram. Los números que contiene nunca se marcan ni se cobran. Dile al agente IA «no me llames más» y se disculpa, te elimina y termina la llamada."),
 "An AI that says it’s an AI": ("Une IA qui dit qu’elle est une IA", "Una IA que dice que es una IA"),
 "The agent never claims to be human — ask, and it says so. It never asks for card numbers, passwords or one-time codes, and it passes callers to a person on request or takes a message.": ("L’agent ne prétend jamais être humain — demandez-lui, il le dit. Il ne demande jamais de numéro de carte, de mot de passe ni de code à usage unique, et il passe l’appelant à une personne sur demande ou prend un message.", "El agente nunca dice ser humano — pregúntale y lo reconoce. Nunca pide números de tarjeta, contraseñas ni códigos de un solo uso, y pasa la llamada a una persona si se lo piden o toma un mensaje."),
 "Recording stays your call": ("L’enregistrement reste votre décision", "Grabar sigue siendo tu decisión"),
 "Some places need everyone on a call to agree before it’s recorded. Recording, voicemail, transcripts and AI summaries are off until you switch them on — and when you do, telling callers is on you. Our terms spell it out.": ("Dans certains endroits, tous les participants doivent accepter avant qu’un appel soit enregistré. Enregistrement, messagerie, transcriptions et résumés IA sont désactivés tant que vous ne les activez pas — et si vous le faites, c’est à vous d’en informer les appelants. Nos conditions le précisent.", "En algunos lugares todos los participantes deben aceptar antes de grabar una llamada. Grabación, buzón de voz, transcripciones y resúmenes IA están desactivados hasta que los actives — y cuando lo hagas, avisar a quien llama es cosa tuya. Nuestros términos lo detallan."),
 "Verified accounts, verified numbers": ("Comptes vérifiés, numéros vérifiés", "Cuentas verificadas, números verificados"),
 "Email confirmation and optional two-step sign-in on every account. Where a country’s regulator requires it, contact details, an address or an ID are collected before the number goes live — and the carrier can say no.": ("Confirmation par e-mail et connexion en deux étapes en option sur chaque compte. Quand le régulateur d’un pays l’exige, coordonnées, adresse ou pièce d’identité sont recueillies avant l’activation du numéro — et l’opérateur peut refuser.", "Confirmación por correo e inicio de sesión en dos pasos opcional en cada cuenta. Donde el regulador de un país lo exige, se recogen datos de contacto, dirección o documento de identidad antes de activar el número — y el operador puede decir que no."),
 "Your caller ID is yours": ("Votre identifiant d’appelant est le vôtre", "Tu identificador de llamada es tuyo"),
 "Campaigns dial from your own CloudIVR number, never a spoofed one. Code collection is only for verifying your own customers, and accounts that break the rules are stopped — campaigns included.": ("Les campagnes appellent depuis votre propre numéro CloudIVR, jamais depuis un numéro usurpé. La collecte de codes sert uniquement à vérifier vos propres clients, et les comptes qui enfreignent les règles sont arrêtés — campagnes comprises.", "Las campañas llaman desde tu propio número CloudIVR, nunca desde uno falsificado. La recogida de códigos es solo para verificar a tus propios clientes, y las cuentas que rompen las reglas se detienen — campañas incluidas."),
 "Acceptable use": ("Usage acceptable", "Uso aceptable"),
 "Recordings & AI": ("Enregistrements et IA", "Grabaciones e IA"),
 "Your data": ("Vos données", "Tus datos"),
 "This describes what CloudIVR does today. It is not legal advice — the rules for calling depend on where you and your callers are.": ("Ceci décrit ce que CloudIVR fait aujourd’hui. Ce n’est pas un conseil juridique — les règles d’appel dépendent de l’endroit où vous et vos appelants vous trouvez.", "Esto describe lo que CloudIVR hace hoy. No es asesoramiento legal — las reglas para llamar dependen de dónde estéis tú y tus llamantes."),
 # Plan compare + usage rates
 "Compare plans": ("Comparer les forfaits", "Comparar planes"),
 "Everything each plan includes.": ("Tout ce que chaque forfait inclut.", "Todo lo que incluye cada plan."),
 "All plans: browser phone, SMS inbox, call forwarding, call notes and on/off hours. One monthly price per number.": ("Tous les forfaits : téléphone navigateur, boîte SMS, renvoi d’appel, notes d’appel et horaires. Un prix mensuel par numéro.", "Todos los planes: teléfono en el navegador, bandeja de SMS, desvío de llamadas, notas de llamada y horarios. Un precio mensual por número."),
 "Swipe the table sideways to see every plan.": ("Faites glisser le tableau pour voir tous les forfaits.", "Desliza la tabla hacia los lados para ver todos los planes."),
 "Feature": ("Fonction", "Función"),
 "Most popular": ("Le plus populaire", "El más popular"),
 "Incoming minutes included": ("Minutes entrantes incluses", "Minutos entrantes incluidos"),
 "SMS included": ("SMS inclus", "SMS incluidos"),
 "Extra numbers on the plan": ("Numéros supplémentaires sur le forfait", "Números extra en el plan"),
 "up to {0}": ("jusqu’à {0}", "hasta {0}"),
 "Included": ("Inclus", "Incluido"),
 "Not included": ("Non inclus", "No incluido"),
 "Show fewer features": ("Afficher moins de fonctions", "Mostrar menos funciones"),
 "Show all {0} features": ("Afficher les {0} fonctions", "Mostrar las {0} funciones"),
 "Usage rates": ("Tarifs à l’usage", "Tarifas por uso"),
 "No surprises. Every per-use price, up front.": ("Pas de surprise. Chaque prix à l’usage, affiché d’avance.", "Sin sorpresas. Cada precio por uso, por adelantado."),
 "Plan minutes cover the incoming calls you answer. Everything else is paid from your wallet at these rates — and the app shows the exact price of a call before you start it. High-cost destinations are priced individually and shown the same way.": ("Les minutes du forfait couvrent les appels entrants auxquels vous répondez. Tout le reste est payé depuis votre portefeuille à ces tarifs — et l’application affiche le prix exact d’un appel avant de le lancer. Les destinations coûteuses sont tarifées individuellement et affichées de la même façon.", "Los minutos del plan cubren las llamadas entrantes que atiendes. Todo lo demás se paga desde tu monedero a estas tarifas — y la app muestra el precio exacto de una llamada antes de iniciarla. Los destinos de alto coste tienen precio individual y se muestran igual."),
 "What": ("Quoi", "Qué"),
 "Price": ("Prix", "Precio"),
 "Paid from": ("Payé depuis", "Se paga desde"),
 "Outgoing calls — browser phone, softphone, Quick IVR, Bulk IVR campaigns": ("Appels sortants — téléphone navigateur, softphone, Quick IVR, campagnes Bulk IVR", "Llamadas salientes — teléfono en el navegador, softphone, Quick IVR, campañas Bulk IVR"),
 "AI voice agent (inbound or outbound)": ("Agent vocal IA (entrant ou sortant)", "Agente de voz IA (entrante o saliente)"),
 "Calls forwarded to a phone": ("Appels renvoyés vers un téléphone", "Llamadas desviadas a un teléfono"),
 "Incoming minutes over your plan": ("Minutes entrantes au-delà du forfait", "Minutos entrantes por encima del plan"),
 "SMS over your plan": ("SMS au-delà du forfait", "SMS por encima del plan"),
 "AI summaries & caller mood (recorded calls, voicemails)": ("Résumés IA et humeur de l’appelant (appels enregistrés, messages vocaux)", "Resúmenes IA y estado de ánimo del llamante (llamadas grabadas, buzones)"),
 "Extra numbers on a plan": ("Numéros supplémentaires sur un forfait", "Números extra en un plan"),
 "Wallet top-up minimum": ("Recharge minimale du portefeuille", "Recarga mínima del monedero"),
 "Wallet or crypto": ("Portefeuille ou crypto", "Monedero o cripto"),
 "Crypto": ("Crypto", "Cripto"),
 "Pay with": ("Payer avec", "Paga con"),
 "Cards": ("Cartes", "Tarjetas"),
 "CloudIVR wallet": ("Portefeuille CloudIVR", "Monedero CloudIVR"),
 "{0}/min US & Canada · from {1}/min elsewhere": ("{0}/min États-Unis et Canada · dès {1}/min ailleurs", "{0}/min EE. UU. y Canadá · desde {1}/min en otros países"),
 "{0} each": ("{0} l’unité", "{0} cada uno"),
 "from {0}/month each": ("à partir de {0}/mois chacun", "desde {0}/mes cada uno"),
 "Numbers from {0}/month": ("Numéros à partir de {0}/mois", "Números desde {0}/mes"),
 # Coverage
 "Instant": ("Immédiat", "Inmediato"),
 "ID check": ("Vérif. d’identité", "Verif. de identidad"),
 "Local, mobile and toll-free numbers your customers recognise — and pick up. {0} countries go live in about a minute; the rest ask for contact details or an ID first (carrier review: usually hours, up to 3 business days, full refund if declined).": ("Des numéros locaux, mobiles et gratuits que vos clients reconnaissent — et décrochent. {0} pays sont actifs en une minute environ ; les autres demandent d’abord des coordonnées ou une pièce d’identité (examen par l’opérateur : généralement quelques heures, jusqu’à 3 jours ouvrés, remboursement intégral en cas de refus).", "Números locales, móviles y gratuitos que tus clientes reconocen — y atienden. {0} países se activan en un minuto aproximadamente; el resto piden antes datos de contacto o un documento de identidad (revisión del operador: normalmente horas, hasta 3 días hábiles, reembolso completo si se rechaza)."),
 # FAQ
 "With crypto ({0}) or from your CloudIVR wallet (top-ups from {1}). Renewals and calls are paid from the wallet. Card payments are coming soon — until they are switched on, cards show as “coming soon” here and at checkout.": ("En crypto ({0}) ou depuis votre portefeuille CloudIVR (recharges à partir de {1}). Les renouvellements et les appels sont payés depuis le portefeuille. Le paiement par carte arrive bientôt — d’ici là, les cartes apparaissent comme « bientôt disponibles » ici et au paiement.", "Con cripto ({0}) o desde tu monedero CloudIVR (recargas desde {1}). Las renovaciones y las llamadas se pagan desde el monedero. El pago con tarjeta llegará pronto — hasta que se active, las tarjetas aparecen como «próximamente» aquí y en el pago."),
 "What happens if the AI agent can’t help?": ("Que se passe-t-il si l’agent IA ne peut pas aider ?", "¿Qué pasa si el agente IA no puede ayudar?"),
 "It never pretends to be human and never asks for card numbers, passwords or one-time codes. When a caller wants a person, the agent transfers the call to the number you set — or, if you haven’t set one, offers to take a message with a name, callback number and the message, which lands in your inbox. On a keypad menu, callers can always reach voicemail. Anyone who asks not to be called again is removed from the list and the call ends politely.": ("Il ne se fait jamais passer pour un humain et ne demande jamais de numéro de carte, de mot de passe ni de code à usage unique. Quand un appelant veut parler à une personne, l’agent transfère l’appel vers le numéro que vous avez défini — ou, si vous n’en avez pas défini, propose de prendre un message avec un nom, un numéro de rappel et le message, qui arrive dans votre boîte de réception. Sur un menu à touches, les appelants peuvent toujours atteindre la messagerie. Toute personne qui demande à ne plus être appelée est retirée de la liste et l’appel se termine poliment.", "Nunca finge ser humano y nunca pide números de tarjeta, contraseñas ni códigos de un solo uso. Cuando quien llama quiere hablar con una persona, el agente transfiere la llamada al número que hayas configurado — o, si no has configurado ninguno, ofrece tomar un mensaje con nombre, número de devolución y el mensaje, que llega a tu bandeja de entrada. En un menú de teclado, quien llama siempre puede llegar al buzón de voz. Quien pide que no le llamen más se elimina de la lista y la llamada termina con cortesía."),
 "Which countries need an ID check and how long does it take?": ("Quels pays exigent une vérification d’identité et combien de temps cela prend-il ?", "¿Qué países requieren verificación de identidad y cuánto tarda?"),
 "{0} numbers go live in about a minute. {1} ask for contact details, an address and sometimes an ID before the number activates — telecom regulation, not us. You pay first and the number is held for you while you fill in the details (about 2 minutes); the carrier then reviews them, usually within a few hours and up to 3 business days. Your plan starts when the number is active, and you get a full refund if it isn’t approved.": ("Les numéros {0} sont actifs en une minute environ. {1} demandent des coordonnées, une adresse et parfois une pièce d’identité avant l’activation du numéro — c’est la réglementation télécom, pas nous. Vous payez d’abord et le numéro est réservé pendant que vous remplissez les informations (2 minutes environ) ; l’opérateur les examine ensuite, généralement en quelques heures et jusqu’à 3 jours ouvrés. Votre forfait démarre quand le numéro est actif, et vous êtes intégralement remboursé s’il n’est pas approuvé.", "Los números de {0} se activan en un minuto aproximadamente. {1} piden datos de contacto, una dirección y a veces un documento de identidad antes de activar el número — es regulación de telecomunicaciones, no nosotros. Pagas primero y el número queda reservado mientras rellenas los datos (unos 2 minutos); después el operador los revisa, normalmente en unas horas y hasta 3 días hábiles. Tu plan empieza cuando el número está activo, y recibes un reembolso completo si no se aprueba."),
 "Do you scrub numbers or enforce quiet hours?": ("Filtrez-vous les numéros ou imposez-vous des heures de silence ?", "¿Filtráis números o imponéis horas de silencio?"),
 "Your do-not-call list is enforced on every campaign — Bulk IVR and AI agent, web and Telegram bot: numbers on it are never dialed and never billed. We don’t check public Do-Not-Call registries for you and we don’t enforce quiet hours automatically: you schedule each campaign, set a daily call limit and repeat it daily or weekly, and you’re responsible for calling only people who have agreed to hear from you, at reasonable hours where they live.": ("Votre liste « ne pas appeler » est appliquée à chaque campagne — Bulk IVR et agent IA, web et bot Telegram : les numéros qui y figurent ne sont jamais composés ni facturés. Nous ne consultons pas les registres publics d’opposition pour vous et nous n’imposons pas d’heures de silence automatiquement : vous planifiez chaque campagne, fixez une limite d’appels par jour et la répétez chaque jour ou chaque semaine, et il vous revient de n’appeler que des personnes qui ont accepté d’être contactées, à des heures raisonnables là où elles vivent.", "Tu lista de no llamar se aplica en todas las campañas — Bulk IVR y agente IA, web y bot de Telegram: los números que contiene nunca se marcan ni se cobran. No consultamos registros públicos de exclusión por ti ni imponemos horas de silencio automáticamente: tú programas cada campaña, fijas un límite diario de llamadas y la repites a diario o cada semana, y eres responsable de llamar solo a personas que han aceptado saber de ti, en horas razonables donde viven."),
}

def main():
    for i, lang in enumerate(('fr', 'es')):
        p = os.path.join(ROOT, f'{lang}.json')
        s = open(p, encoding='utf-8').read()
        cur = json.loads(s)
        new = {k: v[i] for k, v in S.items() if k not in cur}
        if not new:
            print(lang, 'nothing to add'); continue
        lines = ''.join(json.dumps(k, ensure_ascii=False) + ': ' + json.dumps(v, ensure_ascii=False) + ',\n' for k, v in new.items())
        assert s.startswith('{\n')
        s = '{\n' + lines + s[2:]
        json.loads(s)
        open(p, 'w', encoding='utf-8').write(s)
        print(lang, 'added', len(new))

if __name__ == '__main__':
    main()
