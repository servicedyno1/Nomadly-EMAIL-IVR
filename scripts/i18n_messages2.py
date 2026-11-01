import json, os
os.chdir('/app/frontend/src/cloudivr/i18n')
N = {
 "Notes": ("Notas", "Notes"), "Notes and tags": ("Notas y etiquetas", "Notes et étiquettes"), "Close notes": ("Cerrar notas", "Fermer les notes"),
 "What should you remember about this person?": ("¿Qué debes recordar de esta persona?", "Que devez-vous retenir sur cette personne ?"),
 "Add a tag": ("Añadir etiqueta", "Ajouter une étiquette"), "Your tags:": ("Tus etiquetas:", "Vos étiquettes :"), "Notes saved": ("Notas guardadas", "Notes enregistrées"),
 "Save": ("Guardar", "Enregistrer"), "All tags": ("Todas las etiquetas", "Toutes les étiquettes"), "Filter by tag": ("Filtrar por etiqueta", "Filtrer par étiquette"),
 "AI summary": ("Resumen IA", "Résumé IA"), "Summarizing this conversation…": ("Resumiendo esta conversación…", "Résumé de la conversation en cours…"),
 "Suggested replies": ("Respuestas sugeridas", "Réponses suggérées"), "Updating": ("Actualizando", "Mise à jour"),
 "Send later": ("Enviar más tarde", "Envoyer plus tard"), "Send now instead": ("Enviar ahora", "Envoyer maintenant"), "Schedule": ("Programar", "Programmer"),
 "Pick a day and time to send it.": ("Elige el día y la hora de envío.", "Choisissez le jour et l’heure d’envoi."),
 "Scheduled for {0}": ("Programado para {0}", "Programmé pour {0}"), "Scheduled · {0} {1}": ("Programado · {0} {1}", "Programmé · {0} {1}"),
 "Not sent": ("No enviado", "Non envoyé"), "Cancel scheduled text": ("Cancelar mensaje programado", "Annuler le SMS programmé"),
 "Scheduled text cancelled": ("Mensaje programado cancelado", "SMS programmé annulé"),
}
for lang, i in (('es', 0), ('fr', 1)):
    d = json.load(open(f'{lang}.json'))
    for k, v in N.items(): d.setdefault(k, v[i])
    open(f'{lang}.json', 'w').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(x, ensure_ascii=False)}' for k, x in d.items()) + '\n}')
print('ok')
