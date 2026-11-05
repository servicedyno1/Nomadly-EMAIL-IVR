import json, os
os.chdir('/app/frontend/src/cloudivr/i18n')
N = {
 "Mobile eSIM": ("eSIM móvil", "eSIM mobile"),
 "A mobile line on your phone": ("Una línea móvil en tu teléfono", "Une ligne mobile sur votre téléphone"),
 "Get an eSIM with calls, texts and data. Install it by scanning a QR code; no store visit or physical SIM.": ("Consigue una eSIM con llamadas, mensajes y datos. Se instala escaneando un código QR, sin tienda ni SIM física.", "Obtenez une eSIM avec appels, SMS et données. Installez-la en scannant un QR code, sans boutique ni SIM physique."),
 "Get this eSIM": ("Conseguir esta eSIM", "Obtenir cette eSIM"),
 "Your phone’s IMEI": ("IMEI de tu teléfono", "IMEI de votre téléphone"),
 "Dial *#06# on the phone that will use the eSIM. Use the first IMEI if it shows two.": ("Marca *#06# en el teléfono que usará la eSIM. Si aparecen dos, usa el primer IMEI.", "Composez *#06# sur le téléphone qui utilisera l’eSIM. S’il en affiche deux, utilisez le premier IMEI."),
 "15 digits": ("15 dígitos", "15 chiffres"),
 "Creating your eSIM…": ("Creando tu eSIM…", "Création de votre eSIM…"),
 "Active": ("Activa", "Active"),
 "Paused · monthly fee due": ("En pausa · cuota mensual pendiente", "En pause · frais mensuels dus"),
 "Couldn’t be created · refunded": ("No se pudo crear · reembolsado", "Création impossible · remboursé"),
 "Number coming": ("Número en camino", "Numéro à venir"),
 "Linked by CloudIVR": ("Vinculada por CloudIVR", "Liée par CloudIVR"),
 "Show install QR": ("Mostrar QR de instalación", "Afficher le QR d’installation"),
 "Hide install QR": ("Ocultar QR de instalación", "Masquer le QR d’installation"),
 "On your phone open Settings → Mobile data (or Cellular) → Add eSIM → Use QR code, and scan this. Keep this page private: the code installs your line.": ("En tu teléfono abre Ajustes → Datos móviles → Añadir eSIM → Usar código QR y escanéalo. Mantén esta página privada: el código instala tu línea.", "Sur votre téléphone, ouvrez Réglages → Données cellulaires → Ajouter une eSIM → Utiliser un QR code, puis scannez-le. Gardez cette page privée : le code installe votre ligne."),
 "The QR code isn’t ready yet.": ("El código QR aún no está listo.", "Le QR code n’est pas encore prêt."),
 "Where should calls ring?": ("¿Dónde deben sonar las llamadas?", "Où les appels doivent-ils sonner ?"),
 "Ring on my phone": ("Sonar en mi teléfono", "Sonner sur mon téléphone"),
 "Calls go to the eSIM on your phone.": ("Las llamadas van a la eSIM de tu teléfono.", "Les appels arrivent sur l’eSIM de votre téléphone."),
 "Ring in CloudIVR": ("Sonar en CloudIVR", "Sonner dans CloudIVR"),
 "Calls go to the browser phone and your IVR menus.": ("Las llamadas van al teléfono del navegador y a tus menús IVR.", "Les appels arrivent sur le téléphone navigateur et vos menus SVI."),
 "Texts": ("Mensajes", "SMS"),
 "No texts yet. Texts sent to this number also land in your Inbox.": ("Aún no hay mensajes. Los mensajes a este número también llegan a tu bandeja.", "Pas encore de SMS. Les SMS envoyés à ce numéro arrivent aussi dans votre boîte de réception."),
 "Cancel eSIM": ("Cancelar eSIM", "Annuler l’eSIM"),
 "eSIM plans are coming soon": ("Los planes eSIM llegan pronto", "Les forfaits eSIM arrivent bientôt"),
 "We’re adding mobile plans. Check back shortly.": ("Estamos añadiendo planes móviles. Vuelve pronto.", "Nous ajoutons des forfaits mobiles. Revenez bientôt."),
 "Enter your phone’s 15-digit IMEI (dial *#06# to see it).": ("Introduce el IMEI de 15 dígitos de tu teléfono (marca *#06# para verlo).", "Saisissez l’IMEI à 15 chiffres de votre téléphone (composez *#06# pour le voir)."),
}
for lang, i in (('es', 0), ('fr', 1)):
    d = json.load(open(f'{lang}.json'))
    for k, v in N.items(): d.setdefault(k, v[i])
    open(f'{lang}.json', 'w').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(x, ensure_ascii=False)}' for k, x in d.items()) + '\n}')
print('ok')
