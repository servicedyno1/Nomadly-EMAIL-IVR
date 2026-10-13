// French promo copy — same structure as en.js.
module.exports = {
  cloudphone: {
    hooks: ['Donnez une vraie ligne téléphonique à votre activité', 'Un numéro local dans 30+ pays, actif en 60 secondes'],
    cross: ['Vous avez des leads ? Appelez-les', 'Vos leads ont besoin d\'un numéro qui sonne'],
    lines: p => [
      'Numéros virtuels dans 30+ pays — sans SIM, sans engagement',
      'Menu IVR, messagerie, SMS vers Telegram, SIP pour softphones',
      `Starter : ${p.phoneStarterMin} min + ${p.phoneStarterSms} SMS par mois`,
    ],
    price: p => `À partir de ${p.phoneStarter}/mois · résiliable à tout moment`,
    button: 'Ouvrir Cloud IVR',
  },
  antired_hosting: {
    hooks: ['Un hébergement qui reste en ligne malgré les signalements', 'Anti-Red Hosting : offshore, DMCA-ignored, cPanel inclus'],
    cross: ['Un domaine ? Hébergez-le en bulletproof', 'Votre site mérite un hébergement offshore'],
    lines: _p => [
      'Serveurs offshore DMCA-ignored',
      'Le scanner Anti-Red bloque bots et signaleurs à l\'entrée',
      'cPanel complet, SSL gratuit, facturation hebdo ou mensuelle',
    ],
    price: p => `${p.hostingWeekly}/semaine ou ${p.hostingMonthly}/mois`,
    button: 'Ouvrir Anti-Red Hosting',
  },
  leads_validation: {
    hooks: ['Des leads téléphoniques avec le vrai nom du propriétaire', 'Arrêtez d\'appeler des numéros morts'],
    cross: ['Un numéro ? Trouvez maintenant qui appeler', 'Remplissez votre dialer de numéros vérifiés'],
    lines: _p => [
      'Filtrez par pays, État, indicatif et opérateur',
      'Validation ligne active — seuls les numéros actifs sont livrés',
      'Le lookup CNAM révèle le nom derrière chaque numéro',
    ],
    price: p => `Leads ${p.leadRate} l'unité · CNAM ${p.cnamRate} par recherche`,
    button: 'Ouvrir SMS Leads',
  },
  domains_shortener: {
    hooks: ['Domaines bulletproof, enregistrés en quelques minutes', 'Un domaine que personne ne peut vous retirer'],
    cross: ['Hébergement prêt ? Ajoutez un domaine bulletproof', 'Vos liens courts sur votre propre domaine'],
    lines: p => [
      '400+ extensions · enregistrement offshore DMCA-ignored',
      'DNS Cloudflare et gestion des nameservers intégrés',
      `${p.freeLinks} liens courts personnalisés offerts pour démarrer`,
    ],
    price: p => `Domaines à partir de ${p.domainFrom}/an`,
    button: 'Ouvrir Bulletproof Domains',
  },
  digital_products: {
    hooks: ['Comptes Twilio, Telnyx et AWS vérifiés, livrés dans Telegram', 'Sautez la file de vérification'],
    cross: ['Besoin de SMS ou de voix à grande échelle ? Prenez un compte vérifié', 'Associez votre numéro à un compte Twilio vérifié'],
    lines: _p => [
      'Twilio, Telnyx, AWS, Google Cloud, Workspace, Zoho, eSIM',
      'Entièrement vérifiés et prêts à l\'emploi, livrés dans votre chat',
      'Paiement par portefeuille, crypto ou virement',
    ],
    price: p => `eSIM dès ${p.dpEsim} · sous-compte Twilio ${p.dpTwilioSub}`,
    button: 'Ouvrir Produits numériques',
  },
  cards_bundles: {
    hooks: ['Une carte virtuelle pour les paiements qui en exigent une', 'Chargez une carte en une minute, utilisez-la partout en ligne'],
    cross: ['Payez vos pubs et outils avec une carte virtuelle', 'Besoin d\'une carte pour vos inscriptions ? Chargez-en une'],
    lines: _p => [
      'Carte de débit virtuelle chargée du montant de votre choix',
      'Paiements et vérifications en ligne dans le monde entier',
      'Livraison instantanée, de 50 $ à 1 000 $ par carte',
    ],
    price: _p => 'Payez depuis votre portefeuille · recharge crypto ou virement',
    button: 'Ouvrir Carte virtuelle',
  },
  email_validation: {
    hooks: ['Nettoyez votre liste email avant d\'envoyer', 'Les rebonds tuent vos campagnes. Validez d\'abord'],
    cross: ['Vous envoyez des emails ? Validez la liste d\'abord', 'Protégez la réputation de votre SMTP'],
    lines: p => [
      'Contrôle en 7 couches : syntaxe, MX, SMTP, catch-all, jetable',
      'Gmail, Yahoo, Outlook et domaines privés',
      `Essai gratuit de ${p.evFreeTrial} emails, listes jusqu'à 100K`,
    ],
    price: p => `De ${p.evRateBulk} à ${p.evRate} par email`,
    button: 'Ouvrir Validation Email',
  },
  marketplace: {
    hooks: ['Achetez et vendez des biens numériques avec séquestre', 'Vos outils, listés là où sont déjà les acheteurs'],
    cross: ['Quelque chose à vendre ? Listez-le ici', 'Parcourez les outils des autres membres'],
    lines: _p => [
      'Fonds bloqués en séquestre jusqu\'à confirmation de livraison',
      'Discutez avec acheteurs et vendeurs dans Telegram',
      'Jusqu\'à 10 annonces actives, diffusées à tous les utilisateurs',
    ],
    price: _p => 'Navigation gratuite · paiement depuis le portefeuille',
    button: 'Ouvrir Marketplace',
  },
  vps_rdp: {
    hooks: ['VPS Linux ou RDP Windows, prêt en quelques minutes', 'Votre propre serveur, port 25 ouvert'],
    cross: ['Un serveur pour votre sender ? Déployez-le maintenant', 'Faites tourner vos outils sur un serveur à vous'],
    lines: _p => [
      'Accès root ou admin complet, installez ce que vous voulez',
      'DMCA-ignored, port 25 ouvert par défaut',
      'Payez 3, 6 ou 12 mois et économisez jusqu\'à 25 %',
    ],
    price: p => `VPS Linux dès ${p.vpsFrom}/mois · RDP Windows dès ${p.rdpFrom}/mois`,
    button: 'Ouvrir VPS / RDP',
  },
  bulksms_app: {
    hooks: ['Envoyez des SMS en masse depuis votre propre numéro', 'Campagnes BulkSMS depuis votre Android, pilotées ici'],
    cross: ['Des leads ? Envoyez-leur un SMS depuis votre numéro', 'Associez vos leads à l\'app BulkSMS'],
    lines: p => [
      'Votre SIM, votre expéditeur — aucune passerelle partagée',
      'Programmez les envois, réglez les délais, suivez la livraison',
      `Essai gratuit : ${p.smsTrial} SMS, sans abonnement`,
    ],
    price: p => `Jour ${p.smsDaily} · Semaine ${p.smsWeekly} · Mois ${p.smsMonthly}`,
    button: 'Ouvrir BulkSMS',
  },
  email_blast: {
    hooks: ['Des campagnes email sans quitter Telegram', 'Importez une liste, écrivez une fois, envoyez à des milliers'],
    cross: ['Liste validée ? Lancez la campagne', 'Touchez aussi vos leads par email'],
    lines: _p => [
      'Objet personnalisé, corps HTML complet, import CSV',
      'Progression en direct : envoyés, échoués, en attente',
      'SMTP intégré, rien à configurer',
    ],
    price: _p => 'Paiement par campagne depuis votre portefeuille',
    button: 'Ouvrir Email Blast',
  },
  refer_earn: {
    hooks: ['Gagnez à chaque ami que vous amenez', 'Votre lien, leur achat, votre récompense'],
    cross: ['Quelqu\'un en a besoin ? Parrainez-le', 'Partagez une fois, soyez payé quand ils achètent'],
    lines: p => [
      'Partagez votre lien personnel où vous voulez',
      `${p.referReward} sur votre portefeuille dès que votre filleul dépense ${p.referSpend}`,
      'Valable sur tous les services du bot',
    ],
    price: _p => 'Gratuit · récompenses versées sur le portefeuille',
    button: 'Ouvrir Parrainage',
  },
}
