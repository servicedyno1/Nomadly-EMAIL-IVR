"""Adds French + Spanish entries for the SIP sales page (cloudivr.net/sip) to frontend/src/cloudivr/i18n/{es,fr}.json.
Only missing keys are added — existing translations are never overwritten. Keeps the files' one-key-per-line format.
Run: python3 scripts/civr_i18n_sip_page.py"""
import json, os

BASE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'frontend', 'src', 'cloudivr', 'i18n')

# English → (Spanish, French)
T = {
    'Windows, Mac, Linux, iPhone and Android': ('Windows, Mac, Linux, iPhone y Android', 'Windows, Mac, Linux, iPhone et Android'),
    'Desk phones': ('Teléfonos de escritorio', 'Téléphones de bureau'),
    'Any phone that takes a SIP account': ('Cualquier teléfono que acepte una cuenta SIP', 'Tout téléphone qui accepte un compte SIP'),
    'In the phone’s settings, add a SIP account with the server, username and password, then save.': (
        'En la configuración del teléfono, añade una cuenta SIP con el servidor, el usuario y la contraseña, y guarda.',
        'Dans les réglages du téléphone, ajoutez un compte SIP avec le serveur, l’identifiant et le mot de passe, puis enregistrez.'),
    'On call': ('En llamada', 'En appel'),
    'Ready to call': ('Listo para llamar', 'Prêt à appeler'),
    'Saved to your call history': ('Guardada en tu historial de llamadas', 'Enregistré dans votre historique d’appels'),
    'Dial out or wait for a call': ('Marca un número o espera una llamada', 'Composez un numéro ou attendez un appel'),
    'SIP account': ('Cuenta SIP', 'Compte SIP'),
    'Registered': ('Registrado', 'Enregistré'),
    'Server': ('Servidor', 'Serveur'),
    'SIP port · 5061 for TLS': ('Puerto SIP · 5061 para TLS', 'Port SIP · 5061 pour TLS'),
    'SIP from / month': ('SIP desde / mes', 'SIP dès / mois'),
    'Calls ring your apps': ('Las llamadas suenan en tus apps', 'Les appels sonnent dans vos applis'),
    'SIP numbers · Softphones · Desk phones': ('Números SIP · Softphones · Teléfonos de escritorio', 'Numéros SIP · Softphones · Téléphones de bureau'),
    'Get a real number in {0} countries and sign in from Zoiper, MicroSIP, Linphone or the desk phone you already own. Calls ring wherever you are, with voicemail, a keypad menu, call recording and an SMS inbox built in.': (
        'Obtén un número real en {0} países e inicia sesión desde Zoiper, MicroSIP, Linphone o el teléfono de escritorio que ya tienes. Las llamadas suenan donde estés, con buzón de voz, menú de teclas, grabación de llamadas y bandeja de SMS incluidos.',
        'Obtenez un vrai numéro dans {0} pays et connectez-vous depuis Zoiper, MicroSIP, Linphone ou le téléphone de bureau que vous avez déjà. Les appels sonnent où que vous soyez, avec messagerie vocale, menu à touches, enregistrement des appels et boîte de réception SMS inclus.'),
    'Choose your plan': ('Elige tu plan', 'Choisissez votre forfait'),
    'See how setup works': ('Mira cómo se configura', 'Voir la configuration'),
    'Works with free apps': ('Funciona con apps gratuitas', 'Fonctionne avec des applis gratuites'),
    'UDP, TCP & TLS': ('UDP, TCP y TLS', 'UDP, TCP et TLS'),
    'SIP logins from {0}/month on {1} · Free to sign up': ('Accesos SIP desde {0}/mes con {1} · Registro gratis', 'Connexions SIP dès {0}/mois avec {1} · Inscription gratuite'),
    'Use the app you already like': ('Usa la app que ya te gusta', 'Gardez l’appli que vous aimez'),
    'Zoiper, MicroSIP, Linphone or the desk phone on your desk. Enter three details and you’re registered.': (
        'Zoiper, MicroSIP, Linphone o el teléfono de tu escritorio. Ingresa tres datos y quedas registrado.',
        'Zoiper, MicroSIP, Linphone ou le téléphone posé sur votre bureau. Saisissez trois informations et vous êtes enregistré.'),
    'Local numbers in {0} countries': ('Números locales en {0} países', 'Numéros locaux dans {0} pays'),
    'Local, mobile and toll-free numbers your customers recognise — and pick up.': (
        'Números locales, móviles y gratuitos que tus clientes reconocen — y contestan.',
        'Numéros locaux, mobiles et gratuits que vos clients reconnaissent — et décrochent.'),
    'A full phone system included': ('Un sistema telefónico completo incluido', 'Un standard téléphonique complet inclus'),
    'Voicemail with transcripts, a keypad menu, call recording, ring groups and an SMS inbox come with every SIP plan.': (
        'Buzón de voz con transcripciones, menú de teclas, grabación de llamadas, grupos de timbrado y bandeja de SMS vienen con cada plan SIP.',
        'Messagerie vocale avec transcriptions, menu à touches, enregistrement des appels, groupes d’appel et boîte de réception SMS sont inclus dans chaque forfait SIP.'),
    'No PBX, no contract': ('Sin centralita, sin contrato', 'Sans PBX, sans contrat'),
    'Month to month, per number. Incoming calls use your plan minutes; outgoing calls are billed per minute from your wallet.': (
        'Mes a mes, por número. Las llamadas entrantes usan los minutos de tu plan; las salientes se cobran por minuto desde tu billetera.',
        'Au mois, par numéro. Les appels entrants utilisent les minutes de votre forfait ; les appels sortants sont facturés à la minute depuis votre portefeuille.'),
    'Why CloudIVR SIP': ('Por qué CloudIVR SIP', 'Pourquoi CloudIVR SIP'),
    'Keep your phone app. Get a better number behind it.': ('Conserva tu app de teléfono. Ponle un número mejor detrás.', 'Gardez votre appli téléphone. Offrez-lui un meilleur numéro.'),
    'A real number, a simple SIP login and a full phone system — without a PBX to run.': (
        'Un número real, un acceso SIP sencillo y un sistema telefónico completo — sin centralita que mantener.',
        'Un vrai numéro, une connexion SIP simple et un standard complet — sans PBX à gérer.'),
    'Server copied': ('Servidor copiado', 'Serveur copié'),
    'Couldn’t copy — select the address instead.': ('No se pudo copiar — selecciona la dirección.', 'Copie impossible — sélectionnez l’adresse à la place.'),
    'On your number’s SIP tab': ('En la pestaña SIP de tu número', 'Dans l’onglet SIP de votre numéro'),
    'Your connection details': ('Tus datos de conexión', 'Vos informations de connexion'),
    'Server / domain': ('Servidor / dominio', 'Serveur / domaine'),
    'Copy server address': ('Copiar la dirección del servidor', 'Copier l’adresse du serveur'),
    '{0} is a server address for phone apps, not a web page — that’s why it doesn’t open in a browser. Type it into your app as the SIP server.': (
        '{0} es una dirección de servidor para apps de teléfono, no una página web — por eso no se abre en el navegador. Escríbela en tu app como servidor SIP.',
        '{0} est une adresse de serveur pour les applis téléphone, pas une page web — c’est pourquoi elle ne s’ouvre pas dans un navigateur. Saisissez-la dans votre appli comme serveur SIP.'),
    'Get your SIP login': ('Obtén tu acceso SIP', 'Obtenez votre connexion SIP'),
    'Works with your phone app': ('Funciona con tu app de teléfono', 'Compatible avec votre appli téléphone'),
    'Three details. Any SIP app.': ('Tres datos. Cualquier app SIP.', 'Trois informations. N’importe quelle appli SIP.'),
    'Pick a free softphone or use the desk phone you already have. Your login is on the number’s SIP tab as soon as the number is live.': (
        'Elige un softphone gratuito o usa el teléfono de escritorio que ya tienes. Tu acceso aparece en la pestaña SIP del número en cuanto está activo.',
        'Choisissez un softphone gratuit ou utilisez le téléphone de bureau que vous avez déjà. Votre connexion apparaît dans l’onglet SIP du numéro dès qu’il est actif.'),
    'Choose a plan and sign up': ('Elige un plan y regístrate', 'Choisissez un forfait et inscrivez-vous'),
    'Create your free account with your email. No card, no contract, no setup fee.': (
        'Crea tu cuenta gratis con tu email. Sin tarjeta, sin contrato, sin cuota de alta.',
        'Créez votre compte gratuit avec votre e-mail. Sans carte, sans contrat, sans frais de mise en service.'),
    'Pick your number': ('Elige tu número', 'Choisissez votre numéro'),
    'Choose a country and a local, mobile or toll-free number. Most numbers go live in about a minute.': (
        'Elige un país y un número local, móvil o gratuito. La mayoría de los números se activan en un minuto aproximadamente.',
        'Choisissez un pays et un numéro local, mobile ou gratuit. La plupart des numéros sont actifs en une minute environ.'),
    'Paste your SIP login': ('Pega tu acceso SIP', 'Collez votre connexion SIP'),
    'Copy the username and password into your app. When it shows “Registered”, you can call out and answer.': (
        'Copia el usuario y la contraseña en tu app. Cuando muestre “Registrado”, ya puedes llamar y contestar.',
        'Copiez l’identifiant et le mot de passe dans votre appli. Quand elle affiche « Enregistré », vous pouvez appeler et répondre.'),
    'Ringing on your softphone in three steps.': ('Sonando en tu softphone en tres pasos.', 'Votre softphone sonne en trois étapes.'),
    'Browser phone in any tab': ('Teléfono en navegador en cualquier pestaña', 'Téléphone navigateur dans n’importe quel onglet'),
    'Voicemail with transcripts': ('Buzón de voz con transcripciones', 'Messagerie vocale avec transcriptions'),
    'Included': ('Incluido', 'Inclus'),
    'Not included': ('No incluido', 'Non inclus'),
    'Best for SIP': ('Ideal para SIP', 'Idéal pour le SIP'),
    'SIP logins for softphones and desk phones': ('Accesos SIP para softphones y teléfonos de escritorio', 'Connexions SIP pour softphones et téléphones de bureau'),
    'No SIP logins — browser phone only': ('Sin accesos SIP — solo teléfono en navegador', 'Pas de connexion SIP — téléphone navigateur uniquement'),
    'Up to {0} extra numbers': ('Hasta {0} números adicionales', 'Jusqu’à {0} numéros supplémentaires'),
    'Compare every feature': ('Compara todas las funciones', 'Comparer toutes les fonctionnalités'),
    'Feature': ('Función', 'Fonctionnalité'),
    'Monthly price': ('Precio mensual', 'Prix mensuel'),
    'Incoming minutes': ('Minutos entrantes', 'Minutes entrantes'),
    'Plans': ('Planes', 'Forfaits'),
    'Pick your plan.': ('Elige tu plan.', 'Choisissez votre forfait.'),
    'SIP logins come with {0}. Every plan is month to month, per number, with no contracts.': (
        'Los accesos SIP vienen con {0}. Cada plan es mes a mes, por número, sin contratos.',
        'Les connexions SIP sont incluses avec {0}. Chaque forfait est au mois, par numéro, sans contrat.'),
    'Every plan is month to month, per number, with no contracts.': ('Cada plan es mes a mes, por número, sin contratos.', 'Chaque forfait est au mois, par numéro, sans contrat.'),
    'Incoming minutes over your plan cost {0} each and extra SMS {1} each. Outgoing calls from a softphone are billed per minute from your wallet. Extra numbers cost from {2}/month each.': (
        'Los minutos entrantes por encima de tu plan cuestan {0} cada uno y los SMS extra {1} cada uno. Las llamadas salientes desde un softphone se cobran por minuto desde tu billetera. Los números adicionales cuestan desde {2}/mes cada uno.',
        'Les minutes entrantes au-delà de votre forfait coûtent {0} chacune et les SMS supplémentaires {1} chacun. Les appels sortants depuis un softphone sont facturés à la minute depuis votre portefeuille. Les numéros supplémentaires coûtent à partir de {2}/mois chacun.'),
    'Why doesn’t {0} open in my browser?': ('¿Por qué {0} no se abre en mi navegador?', 'Pourquoi {0} ne s’ouvre pas dans mon navigateur ?'),
    'Because it isn’t a website. {0} is the server address your phone app connects to, so a browser has nothing to show there. Type it into your softphone or desk phone as the SIP server or domain.': (
        'Porque no es un sitio web. {0} es la dirección del servidor al que se conecta tu app de teléfono, así que un navegador no tiene nada que mostrar ahí. Escríbela en tu softphone o teléfono de escritorio como servidor o dominio SIP.',
        'Parce que ce n’est pas un site web. {0} est l’adresse du serveur auquel votre appli téléphone se connecte : un navigateur n’a donc rien à y afficher. Saisissez-la dans votre softphone ou votre téléphone de bureau comme serveur ou domaine SIP.'),
    'Which plan do I need for SIP?': ('¿Qué plan necesito para SIP?', 'Quel forfait me faut-il pour le SIP ?'),
    'SIP logins come with {0}, from {1}/month. {2} includes the browser phone and call forwarding, but no SIP logins.': (
        'Los accesos SIP vienen con {0}, desde {1}/mes. {2} incluye el teléfono en navegador y el desvío de llamadas, pero no accesos SIP.',
        'Les connexions SIP sont incluses avec {0}, dès {1}/mois. {2} inclut le téléphone navigateur et le renvoi d’appel, mais pas de connexion SIP.'),
    'SIP logins come with the Pro plan and up.': ('Los accesos SIP vienen con el plan Pro en adelante.', 'Les connexions SIP sont incluses à partir du forfait Pro.'),
    'Which apps and phones work?': ('¿Qué apps y teléfonos funcionan?', 'Quelles applis et quels téléphones fonctionnent ?'),
    'Any softphone or desk phone that takes a standard SIP account. Zoiper, MicroSIP and Linphone are free and take a minute to set up.': (
        'Cualquier softphone o teléfono de escritorio que acepte una cuenta SIP estándar. Zoiper, MicroSIP y Linphone son gratuitos y se configuran en un minuto.',
        'Tout softphone ou téléphone de bureau qui accepte un compte SIP standard. Zoiper, MicroSIP et Linphone sont gratuits et se configurent en une minute.'),
    'What do I enter in my app?': ('¿Qué pongo en mi app?', 'Que dois-je saisir dans mon appli ?'),
    'Server or domain: {0}. Port 5060 over UDP or TCP, or 5061 for TLS. Your username and password are on the number’s SIP tab in your dashboard.': (
        'Servidor o dominio: {0}. Puerto 5060 por UDP o TCP, o 5061 para TLS. Tu usuario y contraseña están en la pestaña SIP del número en tu panel.',
        'Serveur ou domaine : {0}. Port 5060 en UDP ou TCP, ou 5061 pour TLS. Votre identifiant et votre mot de passe sont dans l’onglet SIP du numéro, dans votre tableau de bord.'),
    'Can I still use the browser phone?': ('¿Puedo seguir usando el teléfono en navegador?', 'Puis-je toujours utiliser le téléphone navigateur ?'),
    'Yes. Every plan includes the browser phone, so you can also make and take calls from any browser tab.': (
        'Sí. Cada plan incluye el teléfono en navegador, así que también puedes hacer y recibir llamadas desde cualquier pestaña.',
        'Oui. Chaque forfait inclut le téléphone navigateur : vous pouvez aussi passer et recevoir des appels depuis n’importe quel onglet.'),
    'What do calls cost?': ('¿Cuánto cuestan las llamadas?', 'Combien coûtent les appels ?'),
    'Incoming calls use your plan minutes ({0} a month on {1}); extra incoming minutes cost {2} each. Outgoing calls from a softphone are billed per minute from your wallet.': (
        'Las llamadas entrantes usan los minutos de tu plan ({0} al mes con {1}); los minutos entrantes extra cuestan {2} cada uno. Las llamadas salientes desde un softphone se cobran por minuto desde tu billetera.',
        'Les appels entrants utilisent les minutes de votre forfait ({0} par mois avec {1}) ; les minutes entrantes supplémentaires coûtent {2} chacune. Les appels sortants depuis un softphone sont facturés à la minute depuis votre portefeuille.'),
    'Can I try before I pay?': ('¿Puedo probar antes de pagar?', 'Puis-je essayer avant de payer ?'),
    'Yes. Creating an account is free, and the home page has a free test call you can take before you buy a number.': (
        'Sí. Crear una cuenta es gratis, y la página de inicio tiene una llamada de prueba gratis que puedes hacer antes de comprar un número.',
        'Oui. La création de compte est gratuite, et la page d’accueil propose un appel test gratuit à faire avant d’acheter un numéro.'),
    'SIP questions, answered.': ('Preguntas sobre SIP, respondidas.', 'Vos questions SIP, nos réponses.'),
    'Your number, ringing on your softphone today.': ('Tu número, sonando en tu softphone hoy mismo.', 'Votre numéro, qui sonne sur votre softphone dès aujourd’hui.'),
    'Free to sign up · SIP from {0}/month · No contracts': ('Registro gratis · SIP desde {0}/mes · Sin contratos', 'Inscription gratuite · SIP dès {0}/mois · Sans contrat'),
    'Compare plans': ('Comparar planes', 'Comparer les forfaits'),
    'Phone apps': ('Apps de teléfono', 'Applis téléphone'),
    'SIP logins included': ('Accesos SIP incluidos', 'Connexions SIP incluses'),
    'SIP phone numbers': ('Números de teléfono SIP', 'Numéros de téléphone SIP'),
}


def dump(d):
    return '{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in d.items()) + '\n}\n'


def main():
    for i, lang in enumerate(('es', 'fr')):
        path = os.path.join(BASE, f'{lang}.json')
        raw = open(path, encoding='utf-8').read()
        d = json.loads(raw)
        added = 0
        for en, pair in T.items():
            if en not in d:
                d[en] = pair[i]
                added += 1
        if added:
            out = dump(d)
            if not raw.endswith('\n'):
                out = out.rstrip('\n')
            open(path, 'w', encoding='utf-8').write(out)
        print(f'{lang}: +{added} (total {len(d)})')


if __name__ == '__main__':
    main()
