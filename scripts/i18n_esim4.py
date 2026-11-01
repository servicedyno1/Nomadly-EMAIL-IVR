import json, os
os.chdir('/app/frontend/src/cloudivr/i18n')
N = {
 "Ready in minutes": ("Lista en minutos", "Prête en quelques minutes"),
 "A US mobile line on your phone, ready in minutes.": ("Una línea móvil de EE. UU. en tu teléfono, lista en minutos.", "Une ligne mobile américaine sur votre téléphone, prête en quelques minutes."),
 "Creating your eSIM… usually ready in minutes": ("Creando tu eSIM… suele estar lista en minutos", "Création de votre eSIM… prête en général en quelques minutes"),
 "Paid ${0}. Creating your eSIM — usually ready in minutes": ("Pagado ${0}. Creando tu eSIM: suele estar lista en minutos", "{0} $ payés. Création de votre eSIM : prête en général en quelques minutes"),
 "Get an eSIM with a US number, calls, texts and data. It’s usually ready a few minutes after you pay: scan the QR code and it’s on your phone. Add as many lines as you need.": ("Consigue una eSIM con número de EE. UU., llamadas, mensajes y datos. Suele estar lista pocos minutos después de pagar: escanea el código QR y ya está en tu teléfono. Añade todas las líneas que necesites.", "Obtenez une eSIM avec un numéro américain, appels, SMS et données. Elle est en général prête quelques minutes après le paiement : scannez le QR code et elle est sur votre téléphone. Ajoutez autant de lignes que nécessaire."),
 "ZIP code for your number (optional)": ("Código postal para tu número (opcional)", "Code ZIP pour votre numéro (facultatif)"),
 "We’ll ask for a number near this US ZIP code. The exact area code can’t be guaranteed.": ("Pediremos un número cercano a este código postal de EE. UU. No se puede garantizar el código de área exacto.", "Nous demanderons un numéro proche de ce code ZIP américain. L’indicatif exact ne peut pas être garanti."),
 "e.g. 10011": ("p. ej. 10011", "ex. 10011"),
 "Enter a 5-digit US ZIP code, or leave it empty.": ("Escribe un código postal de EE. UU. de 5 dígitos o déjalo vacío.", "Saisissez un code ZIP américain à 5 chiffres, ou laissez vide."),
 "eSIMs are temporarily unavailable. Try again later.": ("Las eSIM no están disponibles por ahora. Inténtalo más tarde.", "Les eSIM sont momentanément indisponibles. Réessayez plus tard."),
}
for lang, i in (('es', 0), ('fr', 1)):
    d = json.load(open(f'{lang}.json'))
    for k, v in N.items(): d[k] = v[i]
    open(f'{lang}.json', 'w').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(x, ensure_ascii=False)}' for k, x in d.items()) + '\n}')
print('ok')
