// French promo copy — same structure as en.js.
const { CLOUD_COUNTRY_COUNT: N } = require('../phone-config')
module.exports = {
  cloudphone: {
    hooks: ["Nomades : un numéro qui vous suit à chaque frontière", "Fondateurs : une ligne pro, sans contrat téléphonique", "Commerçants : ne perdez plus un client pour un appel manqué", "Équipe à distance ? Un numéro qui sonne chez tous", "Équipes de vente : un numéro local auquel on répond"],
    cross: ['Vous avez des leads ? Appelez-les', 'Vos leads ont besoin d\'un numéro qui sonne'],
    lines: p => [
      `Numéros virtuels dans ${N} pays — sans SIM, sans engagement`,
      'Menu IVR, messagerie, SMS vers Telegram, SIP pour softphones',
      `Starter : ${p.phoneStarterMin} min + ${p.phoneStarterSms} SMS par mois`,
    ],
    price: p => `À partir de ${p.phoneStarter}/mois · résiliable à tout moment`,
    button: 'Ouvrir Cloud IVR',
  },
  antired_hosting: {
    hooks: ["Nomades : hébergez offshore, gérez de partout", "Fondateurs : lancez-vous sur un hébergement qui tient", "Petites entreprises : votre site reste en ligne, quoi qu’il arrive", "Agences : des sites clients qui restent en ligne", "Marketeurs : des landing pages qui survivent à la campagne"],
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
    hooks: ["Nomades : trouvez des clients dans tout pays, depuis votre laptop", "Fondateurs : votre première liste de prospects aujourd’hui", "Commerce local : touchez les numéros de votre indicatif", "Agences : des leads vérifiés pour chaque client", "Équipes de vente : fini les numéros morts"],
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
    hooks: ["Nomades : un domaine qui reste à vous dans chaque pays", "Fondateurs : réservez votre nom de marque avant un autre", "Petites entreprises : un vrai domaine vaut mieux qu’une page sociale", "Agences : enregistrez les domaines clients en minutes", "Marketeurs : des liens courts sur votre propre domaine"],
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
    hooks: ["Nomades : une eSIM USA sans mettre le pied aux USA", "Fondateurs : sautez la file de vérification, construisez", "Petites entreprises : un compte Workspace ou Zoho prêt aujourd’hui", "Équipes dev : Twilio, Telnyx et AWS vérifiés, livrés ici", "Équipes de vente : comptes SMS et voix prêts à envoyer"],
    cross: ['Besoin de SMS ou de voix à grande échelle ? Prenez un compte vérifié', 'Associez votre numéro à un compte Twilio vérifié'],
    lines: _p => [
      'Twilio, Telnyx, AWS, Google Cloud, Workspace, Zoho, eSIM',
      'Entièrement vérifiés et prêts à l\'emploi, livrés dans votre chat',
      'Paiement par portefeuille, crypto ou virement',
    ],
    price: p => `eSIM USA T-Mobile ${p.dpEsim}/mois · sous-compte Twilio ${p.dpTwilioSub}`,
    button: 'Ouvrir Produits numériques',
  },
  cards_bundles: {
    hooks: ["Nomades : une carte quand votre banque dit non à l’étranger", "Fondateurs : payez outils et inscriptions avec une carte virtuelle", "Petites entreprises : vos dépenses en ligne sur une carte à part", "Équipes : une carte chargée par projet ou client", "Marketeurs : payez pubs et outils avec une carte virtuelle"],
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
    hooks: ["Freelances : nettoyez votre liste clients avant l’envoi", "Fondateurs : votre e-mail de lancement doit arriver en boîte", "Petites entreprises : fini la newsletter qui rebondit", "Agences : validez chaque liste client d’abord", "Équipes de vente : les rebonds tuent les campagnes. Validez"],
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
    hooks: ["Nomades : vendez vos produits numériques de partout", "Fondateurs : listez votre outil là où sont les acheteurs", "Petits vendeurs : soyez payé en sécurité avec l’escrow", "Agences : achetez des outils aux membres, sous escrow", "Équipes de vente : trouvez les outils de votre prochaine campagne"],
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
    hooks: ["Nomades : votre bureau dans le cloud, depuis tout laptop", "Fondateurs : déployez votre app sur un serveur à vous", "Petites entreprises : votre propre serveur, prêt en minutes", "Équipes à distance : un RDP Windows accessible à tous", "Équipes d’outreach : votre serveur, port 25 ouvert"],
    cross: ['Un serveur pour votre sender ? Déployez-le maintenant', 'Faites tourner vos outils sur un serveur à vous'],
    lines: _p => [
      'Accès root ou admin complet, installez ce que vous voulez',
      'DMCA-ignored, port 25 ouvert par défaut',
      'Payez 3, 6 ou 12 mois et économisez jusqu\'à 25 %',
    ],
    price: p => `VPS Linux dès ${p.vpsFrom}/mois · RDP Windows dès ${p.rdpFrom}/mois`,
    button: 'Ouvrir VPS / RDP',
  },
  bulksms_esim: {
    hooks: ["Nomades : textez vos clients US & Canada sans SIM US", "Fondateurs : annoncez votre lancement par SMS en minutes", "Boutiques : envoyez votre offre à tous vos clients d’un coup", "Agences : gérez les campagnes SMS clients depuis un chat", "Équipes de vente : transformez vos leads US en réponses par SMS"],
    cross: ["Des leads ? Envoyez-leur un SMS aujourd’hui — sans SIM", "Transformez vos leads US en réponses par SMS"],
    lines: () => ["Importez les numéros, écrivez une fois, envoyez en minutes", "Vrais numéros US, tous les grands opérateurs", "1er SMS de test offert · réponses ici même"],
    price: () => "50 $ / 500 SMS · −10 % réservé la veille",
    button: "Ouvrir BulkSMS",
  },
  email_blast: {
    hooks: ["Nomades : lancez vos campagnes e-mail depuis votre téléphone", "Fondateurs : annoncez le lancement à toute votre liste", "Petites entreprises : une newsletter sans rien configurer", "Agences : envoyez les campagnes clients, sans SMTP à gérer", "Équipes de vente : une liste, un message, des milliers touchés"],
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
    hooks: ["Nomades : gagnez de partout, un lien à la fois", "Fondateurs : vous connaissez des fondateurs ? Parrainez-les", "Petites entreprises : recommandez-nous, gagnez du crédit", "Agences : parrainez vos clients, gagnez quand ils achètent", "Pros de la vente : votre réseau vaut de l’argent ici"],
    cross: ['Quelqu\'un en a besoin ? Parrainez-le', 'Partagez une fois, soyez payé quand ils achètent'],
    lines: p => [
      'Partagez votre lien personnel où vous voulez',
      `${p.referReward} sur votre portefeuille dès que votre filleul dépense ${p.referSpend}`,
      'Valable sur tous les services du bot',
    ],
    price: _p => 'Gratuit · récompenses versées sur le portefeuille',
    button: 'Ouvrir Parrainage',
  },
  web_hosta: {
    hooks: ["Nomades : gérez sites et serveurs depuis tout navigateur", "Fondateurs : domaine, hébergement et serveur en une inscription", "Petites entreprises : votre site en ligne, SSL configuré pour vous", "Agences : tous les domaines et serveurs clients dans un onglet", "Marketeurs : un serveur de landing page en quelques minutes"],
    cross: ['Plutôt navigateur ? Votre prochain serveur sur jujucloud.com', 'Vos domaines et votre hébergement, à un onglet'],
    lines: _p => [
      'Domaines privés dans les TLD populaires, WHOIS privé inclus',
      'Hébergement cPanel, VPS Linux et RDP Windows en minutes',
      'SSL et DNS configurés pour vous, accès root ou admin complet',
    ],
    price: _p => 'jujucloud.com · inscription avec un simple e-mail · paiement en crypto',
    button: 'Ouvrir jujucloud.com',
  },
  web_cloudivr: {
    hooks: ["Fixe vers SMS : envoyez des SMS depuis le numéro que vos clients connaissent déjà", "Nomades : votre numéro pro dans un onglet", "Fondateurs : un accueil complet sur cloudivr.net", "Petites entreprises : gardez votre fixe, ajoutez les SMS", "Équipes à distance : numéros, menus et appels au même endroit", "Équipes de vente : suivez vos campagnes d’appels en direct"],
    cross: ['Vous préférez un grand écran ? Essayez CloudIVR sur le web', 'Suivez vos campagnes d\'appels en direct dans le navigateur'],
    lines: _p => [
      'Fixe vers SMS — gardez votre numéro et vos appels, envoyez et recevez des SMS sur cloudivr.net',
      'Numéros virtuels, menus à touches et messagerie avec transcription',
      'Campagnes Bulk IVR avec suivi des appels en direct et rapports CSV',
      'Téléphone navigateur, SIP et agents vocaux IA',
    ],
    price: _p => 'cloudivr.net · inscription gratuite par e-mail · recharge en crypto',
    button: 'Ouvrir cloudivr.net',
  },
}
