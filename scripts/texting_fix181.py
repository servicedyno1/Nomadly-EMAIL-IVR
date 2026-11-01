import json, os
os.chdir('/app')
def edit(p, pairs):
    s = open(p).read()
    for a, b in pairs:
        assert a in s, (p, a); s = s.replace(a, b)
    open(p, 'w').write(s)

edit('js/cloudivr-web/hosted.js', [("    if (r.error) return bad(res, r.error)\n    res.json({ message: { direction: 'outbound'", "    if (r.error) return out(res, r)\n    res.json({ message: { direction: 'outbound'")])
edit('js/hosted-sms.js', [
 ("""  const plans = await plansFor(chatId)
  // Standalone only: every number is its own Texting plan.
  const parent = { phoneNumber: null, plan: 'texting', status: 'active', limit: null, used: 0, price: TEXTING.setup }
  if (!parent) return { error: 'Pick the plan this number goes on.', code: 'pick_plan' }
  if (parent.status !== 'active') return { error: parent.plan === 'texting' ? (parent.status === 'paused' ? `The Texting plan on ${parent.phoneNumber} is paused: its $${TEXTING.monthly} monthly fee is due. Top up your wallet first.` : `The Texting plan on ${parent.phoneNumber} isn’t active yet. Add more numbers once it is.`) : `The plan on ${parent.phoneNumber} isn’t active. Renew it first.`, code: 'plan_inactive' }
  if (parent.limit != null && parent.used >= parent.limit) return { error: `Your ${parent.plan[0].toUpperCase()}${parent.plan.slice(1)} plan on ${parent.phoneNumber} already has ${parent.limit} texting numbers. Upgrade or pick another plan.`, code: 'plan_limit' }
""", """  // Standalone only: every number is its own Texting plan.
  const parent = { phoneNumber: null, plan: 'texting', limit: null, price: TEXTING.setup }
"""),
 ("""  // Texting plans: the first number is the plan; more numbers join it at TEXTING.extra each.
  for (const t of await S.col.find({ chatId: String(chatId), live: true, plan: 'texting', planNumber: null }).toArray()) {
    out.push({ phoneNumber: t.phoneNumber, plan: 'texting', status: t.status === 'active' ? 'active' : t.status === 'paused' ? 'paused' : 'pending', expiresAt: t.nextBillAt || null, price: TEXTING.extra, limit: null, used: 1 + (await S.col.countDocuments({ chatId: String(chatId), live: true, planNumber: t.phoneNumber })) })
  }
""", ""),
])
edit('frontend/src/cloudivr/Onboarding.js', [
 ("""  const open = !!data && !data.onboarded;
  useEffect(() => { if (open) { setPick(data.purposes || []); setStep(0); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps""",
  """  // Arriving from "Start texting" already says what they want: save it and don't cover the setup.
  const texting = /[?&]start=texting\\b/.test(window.location.search);
  const open = !!data && !data.onboarded && !texting;
  useEffect(() => { if (open) { setPick(data.purposes || []); setStep(0); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (data && !data.onboarded && texting) api('/prefs/onboarding', { method: 'PUT', body: { purposes: ['texting'] } }).then(d => setData({ ...data, ...d, onboarded: true })).catch(() => {}); }, [data?.onboarded, texting]); // eslint-disable-line react-hooks/exhaustive-deps"""),
])

NEW = {
 # status labels / panel
 "Active for texting": ("Activo para mensajes", "Actif pour les SMS"),
 "Under review · 1–3 business days": ("En revisión · 1–3 días hábiles", "En vérification · 1 à 3 jours ouvrés"),
 "Not approved · refunded": ("No aprobado · reembolsado", "Non approuvé · remboursé"),
 "Paused": ("En pausa", "En pause"),
 "Cancel & refund ${0}": ("Cancelar y reembolsar ${0}", "Annuler et rembourser {0} $"),
 "No texts yet.": ("Aún no hay mensajes.", "Pas encore de SMS."),
 "Ownership confirmed. No letter or bill needed": ("Propiedad confirmada. No hace falta carta ni factura", "Propriété confirmée. Ni lettre ni facture nécessaires"),
 "Letter signed. Last step: your phone bill": ("Carta firmada. Último paso: tu factura telefónica", "Lettre signée. Dernière étape : votre facture téléphonique"),
 "Support has your request — we also emailed the team": ("Soporte tiene tu solicitud; también avisamos al equipo por correo", "Le support a votre demande — l’équipe a aussi été prévenue par e-mail"),
 "Sent to the carrier for review": ("Enviado al operador para revisión", "Envoyé à l’opérateur pour vérification"),
 "Use PDF, JPG or PNG files under 5 MB.": ("Usa archivos PDF, JPG o PNG de menos de 5 MB.", "Utilisez des fichiers PDF, JPG ou PNG de moins de 5 Mo."),
 "Paid ${0}. Let’s finish setting up {1}": ("Pagado ${0}. Terminemos de configurar {1}", "{0} $ payés. Finissons la configuration de {1}"),
 # LOA
 "Enter the details exactly as on your phone bill. We fill in the Letter of Authorization (LOA) and you sign it below.": ("Escribe los datos tal como aparecen en tu factura telefónica. Rellenamos la carta de autorización (LOA) y tú la firmas abajo.", "Saisissez les informations exactement comme sur votre facture téléphonique. Nous remplissons la lettre d’autorisation (LOA) et vous la signez ci-dessous."),
 "Account holder’s full name": ("Nombre completo del titular", "Nom complet du titulaire"),
 "As on the phone bill": ("Como en la factura telefónica", "Comme sur la facture téléphonique"),
 "Business name (optional)": ("Nombre de la empresa (opcional)", "Nom de l’entreprise (facultatif)"),
 "Street address": ("Dirección", "Adresse"),
 "Service address on the bill": ("Dirección del servicio en la factura", "Adresse du service sur la facture"),
 "City": ("Ciudad", "Ville"),
 "State / province": ("Estado / provincia", "État / province"),
 "ZIP / postal code": ("Código postal", "Code postal"),
 "Current phone provider": ("Proveedor telefónico actual", "Opérateur téléphonique actuel"),
 "e.g. AT&T, Comcast, RingCentral": ("p. ej. AT&T, Comcast, RingCentral", "ex. AT&T, Comcast, RingCentral"),
 "Account number (optional)": ("Número de cuenta (opcional)", "Numéro de compte (facultatif)"),
 "From the bill": ("De la factura", "Sur la facture"),
 "Full name": ("Nombre completo", "Nom complet"),
 # bill
 "Upload a recent phone bill for": ("Sube una factura telefónica reciente de", "Téléversez une facture téléphonique récente pour"),
 "showing the holder name and service address. Photos or screenshots of your carrier account work too.": ("que muestre el nombre del titular y la dirección del servicio. También valen fotos o capturas de tu cuenta del operador.", "indiquant le nom du titulaire et l’adresse du service. Les photos ou captures de votre compte opérateur conviennent aussi."),
 "After the bill is sent, approval usually takes 1–3 business days (the carrier reviews Mon–Fri).": ("Tras enviar la factura, la aprobación suele tardar 1–3 días hábiles (el operador revisa de lunes a viernes).", "Après l’envoi de la facture, l’approbation prend généralement 1 à 3 jours ouvrés (l’opérateur vérifie du lundi au vendredi)."),
 "Remove {0}": ("Quitar {0}", "Retirer {0}"),
 # review text
 "Ownership confirmed with the code. Your number is with the carrier for approval. This usually takes {0}, expected by {1}. We’ll message you the moment texting is on.": ("Propiedad confirmada con el código. Tu número está con el operador para su aprobación. Suele tardar {0}; previsto para el {1}. Te avisaremos en cuanto los mensajes estén activos.", "Propriété confirmée par le code. Votre numéro est chez l’opérateur pour approbation. Cela prend généralement {0}, prévu le {1}. Nous vous préviendrons dès que les SMS seront actifs."),
 "Your documents are with the carrier for approval. This usually takes {0}, expected by {1}. We’ll message you the moment texting is on.": ("Tus documentos están con el operador para su aprobación. Suele tardar {0}; previsto para el {1}. Te avisaremos en cuanto los mensajes estén activos.", "Vos documents sont chez l’opérateur pour approbation. Cela prend généralement {0}, prévu le {1}. Nous vous préviendrons dès que les SMS seront actifs."),
}
for lang, i in (('es', 0), ('fr', 1)):
    p = f'frontend/src/cloudivr/i18n/{lang}.json'
    d = json.load(open(p))
    for k, v in NEW.items(): d[k] = v[i]
    if lang == 'es':
        for k in list(d):
            if 'monedero' in d[k]: d[k] = d[k].replace('monedero', 'billetera').replace('tu billetera', 'tu billetera')
    open(p, 'w').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in d.items()) + '\n}')
print('ok')
