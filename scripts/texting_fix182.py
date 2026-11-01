import json, os
os.chdir('/app')
NEW = {
 "Can’t answer at that number? You can sign an authorization letter and upload a recent phone bill instead.": ("¿No puedes contestar en ese número? Puedes firmar una carta de autorización y subir una factura telefónica reciente.", "Impossible de répondre à ce numéro ? Vous pouvez signer une lettre d’autorisation et téléverser une facture téléphonique récente."),
 "Cancel and refund ${0} to your wallet?": ("¿Cancelar y reembolsar ${0} a tu billetera?", "Annuler et rembourser {0} $ sur votre portefeuille ?"),
 "Cancel & refund": ("Cancelar y reembolsar", "Annuler et rembourser"),
 "Keep it": ("Mantenerlo", "Le garder"),
 "Cancelled — ${0} refunded": ("Cancelado: ${0} reembolsados", "Annulé — {0} $ remboursés"),
 "This number couldn’t be text-enabled. ${0} was refunded to your wallet.": ("No se pudieron activar los mensajes en este número. Se reembolsaron ${0} a tu billetera.", "Les SMS n’ont pas pu être activés sur ce numéro. {0} $ ont été remboursés sur votre portefeuille."),
 "Texting is paused because the plan on {0} isn’t active. Renew that plan and texting turns back on by itself.": ("Los mensajes están en pausa porque el plan de {0} no está activo. Renueva ese plan y se reactivan solos.", "Les SMS sont en pause car le forfait de {0} n’est pas actif. Renouvelez ce forfait et ils se réactivent tout seuls."),
 "Texting is paused because the ${0} monthly fee couldn’t be paid. Top up your wallet and it turns back on within a day.": ("Los mensajes están en pausa porque no se pudo cobrar la cuota mensual de ${0}. Recarga tu billetera y se reactivan en un día.", "Les SMS sont en pause car les frais mensuels de {0} $ n’ont pas pu être payés. Rechargez votre portefeuille et ils se réactivent sous un jour."),
 "Couldn’t build the preview.": ("No se pudo crear la vista previa.", "Impossible de créer l’aperçu."),
 "{0} couldn’t be read.": ("No se pudo leer {0}.", "Impossible de lire {0}."),
 "{0} isn’t a PDF, JPG or PNG.": ("{0} no es un PDF, JPG ni PNG.", "{0} n’est pas un PDF, JPG ou PNG."),
 "{0} couldn’t be read — save it again as JPG or PNG.": ("No se pudo leer {0}: guárdala de nuevo como JPG o PNG.", "Impossible de lire {0} — enregistrez-la à nouveau en JPG ou PNG."),
 "Together the files must be under 5 MB — use smaller photos.": ("Entre todos los archivos deben pesar menos de 5 MB: usa fotos más pequeñas.", "L’ensemble des fichiers doit faire moins de 5 Mo — utilisez des photos plus petites."),
 "Add the phone bill (PDF, JPG or PNG).": ("Añade la factura telefónica (PDF, JPG o PNG).", "Ajoutez la facture téléphonique (PDF, JPG ou PNG)."),
 "Type the account holder’s full name exactly to sign.": ("Escribe exactamente el nombre completo del titular para firmar.", "Tapez exactement le nom complet du titulaire pour signer."),
 "Tick the box to sign the authorization letter.": ("Marca la casilla para firmar la carta de autorización.", "Cochez la case pour signer la lettre d’autorisation."),
 "This number receives texts only. Your customers text it and you read them here.": ("Este número solo recibe mensajes. Tus clientes le escriben y tú los lees aquí.", "Ce numéro reçoit uniquement des SMS. Vos clients lui écrivent et vous les lisez ici."),
}
for lang, i in (('es', 0), ('fr', 1)):
    p = f'frontend/src/cloudivr/i18n/{lang}.json'
    d = json.load(open(p))
    for k, v in NEW.items(): d[k] = v[i]
    open(p, 'w').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in d.items()) + '\n}')
print('ok')
