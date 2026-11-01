import json, os
os.chdir('/app/frontend/src/cloudivr/i18n')
N = {
 "CloudIVR eSIM": ("eSIM de CloudIVR", "eSIM CloudIVR"),
 "A US mobile line, ready in minutes": ("Una línea móvil de EE. UU., lista en minutos", "Une ligne mobile américaine, prête en quelques minutes"),
 "Get an eSIM with a US number, calls, texts and data. It’s ready right after you pay: scan the QR code and it’s on your phone. Add as many lines as you need.": ("Consigue una eSIM con número de EE. UU., llamadas, mensajes y datos. Está lista al pagar: escanea el código QR y ya está en tu teléfono. Añade todas las líneas que necesites.", "Obtenez une eSIM avec un numéro américain, appels, SMS et données. Elle est prête dès le paiement : scannez le QR code et elle est sur votre téléphone. Ajoutez autant de lignes que nécessaire."),
 "Add another eSIM": ("Añadir otra eSIM", "Ajouter une autre eSIM"),
 "Available instantly": ("Disponible al instante", "Disponible immédiatement"),
 "CloudIVR eSIM: a US mobile line on your phone": ("eSIM de CloudIVR: una línea móvil de EE. UU. en tu teléfono", "eSIM CloudIVR : une ligne mobile américaine sur votre téléphone"),
 "Pay from your wallet, scan the QR code and your new number works in minutes, with calls, texts and data. Read and send its texts in CloudIVR too.": ("Paga con tu billetera, escanea el código QR y tu nuevo número funciona en minutos, con llamadas, mensajes y datos. Lee y envía sus mensajes también en CloudIVR.", "Payez avec votre portefeuille, scannez le QR code et votre nouveau numéro fonctionne en quelques minutes, avec appels, SMS et données. Lisez et envoyez ses SMS aussi dans CloudIVR."),
 "US phone number included": ("Número de EE. UU. incluido", "Numéro américain inclus"),
 "Order eSIM": ("Pedir eSIM", "Commander l’eSIM"),
 "US network": ("Red de EE. UU.", "Réseau américain"),
 "Plans are being added. Sign up and we’ll show them in your account.": ("Estamos añadiendo planes. Regístrate y los verás en tu cuenta.", "Les forfaits arrivent. Inscrivez-vous et vous les verrez dans votre compte."),
 "A US mobile line on your phone, ready instantly.": ("Una línea móvil de EE. UU. en tu teléfono, al instante.", "Une ligne mobile américaine sur votre téléphone, immédiatement."),
 "Texts can go to US numbers: enter +1 and the 10-digit number.": ("Los mensajes pueden ir a números de EE. UU.: escribe +1 y los 10 dígitos.", "Les SMS peuvent aller vers des numéros américains : saisissez +1 et les 10 chiffres."),
}
for lang, i in (('es', 0), ('fr', 1)):
    d = json.load(open(f'{lang}.json'))
    for k, v in N.items(): d[k] = v[i]
    open(f'{lang}.json', 'w').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(x, ensure_ascii=False)}' for k, x in d.items()) + '\n}')
print('ok')
