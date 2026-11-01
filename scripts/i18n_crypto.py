import json, os
os.chdir('/app/frontend/src/cloudivr/i18n')
N = {
 "Pay with crypto": ("Pagar con cripto", "Payer en crypto"),
 "Pay with crypto instead": ("Pagar con cripto", "Payer plutôt en crypto"),
 "Send ${0} in crypto. It goes to your wallet and pays for this right away.": ("Envía ${0} en cripto. Llega a tu billetera y paga esto al momento.", "Envoyez {0} $ en crypto. Ils arrivent sur votre portefeuille et paient cet achat tout de suite."),
 "Your wallet has {0}. Send ${1} in crypto and this is paid automatically once it confirms.": ("Tu billetera tiene {0}. Envía ${1} en cripto y se paga automáticamente al confirmarse.", "Votre portefeuille contient {0}. Envoyez {1} $ en crypto et ce sera payé automatiquement à la confirmation."),
 "Send ${0} in crypto and we’ll place the order as soon as it confirms.": ("Envía ${0} en cripto y haremos el pedido en cuanto se confirme.", "Envoyez {0} $ en crypto et nous passerons la commande dès la confirmation."),
 "We check every 15 seconds and finish this automatically once the payment confirms. If you leave, the money stays in your wallet.": ("Revisamos cada 15 segundos y lo terminamos automáticamente al confirmarse el pago. Si te vas, el dinero queda en tu billetera.", "Nous vérifions toutes les 15 secondes et terminons automatiquement dès la confirmation. Si vous partez, l’argent reste sur votre portefeuille."),
 "Auto-renew on": ("Renovación automática activada", "Renouvellement auto activé"),
 "Auto-renew off": ("Renovación automática desactivada", "Renouvellement auto désactivé"),
 "Auto-renew off: the line ends after this paid month": ("Renovación desactivada: la línea termina al acabar este mes pagado", "Renouvellement désactivé : la ligne s’arrête à la fin de ce mois payé"),
 "Renew ${0} from wallet": ("Renovar ${0} desde la billetera", "Renouveler {0} $ depuis le portefeuille"),
 "Texting is back on": ("Los mensajes vuelven a estar activos", "Les SMS sont réactivés"),
 "Only active eSIMs have auto-renew.": ("Solo las eSIM activas tienen renovación automática.", "Seules les eSIM actives ont le renouvellement auto."),
 "Nothing to renew.": ("No hay nada que renovar.", "Rien à renouveler."),
}
for lang, i in (('es', 0), ('fr', 1)):
    d = json.load(open(f'{lang}.json'))
    for k, v in N.items(): d[k] = v[i]
    open(f'{lang}.json', 'w').write('{\n' + ',\n'.join(f'{json.dumps(k, ensure_ascii=False)}: {json.dumps(x, ensure_ascii=False)}' for k, x in d.items()) + '\n}')
print('ok')
