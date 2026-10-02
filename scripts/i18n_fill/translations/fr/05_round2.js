// Round 2 (2026-10): admin strings back to English, new compact hP.plans/generatePlanText,
// user-facing leftovers (vps_10, billing-cycle names, Support button label).
const { en } = require('../../../../js/lang/en.js')
const { ADMIN_KEYS, pick } = require('../../admin_keys.js')

const cycle = `({ Hourly: 'Horaire', Monthly: 'Mensuel' })[item.type] || item.type.replace(/(\\d+) Months/, '$1 mois')`

module.exports = {
  t: {
    ...pick(en.t, ADMIN_KEYS.t),
    vps_10: '✏️ Entrez la nouvelle ligne <b>Objet</b> :',
  },
  vs: { ...pick(en.vs, ADMIN_KEYS.vs) },
  admin: { ...pick(en.admin, ADMIN_KEYS.admin) },
  vp: {
    askPlanType: { __src: `plans => \`💳 Choisissez un cycle de facturation :

\${plans
 .map(
 item =>
 \`<strong>• \${item.type === 'Hourly' ? '⏳' : '📅'} \${${cycle}} –</strong> $\${item.originalPrice} \${
 item.discount === 0 ? '(Aucune réduction)' : \`(Inclut \${item.discount}% de réduction)\`
 }\`,
 )
 .join('\\n')}\`` },
  },
  hostingPlansText: {
    generatePlanText: { __src: `(hostingType, planKey) => {
 const plan = plans(hostingType)[planKey]
 return \`<b>\${plan.name} — $\${plan.price}</b>

\${plan.storage} · \${plan.bandwidth} · \${plan.domains}
\${plan.ssl} · \${plan.protection}
\${plan.panel}\`
 }` },
  },
  __topLevel: {
    plans: `hostingType => {
 return {
 premiumWeekly: {
 name: 'Premium Anti-Red (1-Week)',
 price: PREMIUM_ANTIRED_WEEKLY_PRICE,
 duration: '7 jours',
 storage: '10 Go SSD',
 bandwidth: '100 Go',
 domains: "Jusqu'à 2 domaines",
 ssl: 'SSL gratuit',
 protection: 'Masquage IP · Détection de bots · Blocage UA',
 panel: 'HostPanel — gestion des fichiers, BDD & e-mails',
 },
 premiumCpanel: {
 name: 'Premium Anti-Red HostPanel (30 Days)',
 price: PREMIUM_ANTIRED_CPANEL_PRICE,
 duration: '30 jours',
 storage: '50 Go SSD',
 bandwidth: '500 Go',
 domains: "Jusqu'à 6 domaines",
 ssl: 'SSL gratuit',
 protection: 'Masquage IP · Défi JS · Blocage UA & TLS',
 panel: 'HostPanel — sauvegardes, migration & outils avancés',
 },
 goldenCpanel: {
 name: 'Golden Anti-Red HostPanel (30 Days)',
 price: GOLDEN_ANTIRED_CPANEL_PRICE,
 duration: '30 jours',
 storage: '100 Go SSD',
 bandwidth: 'Illimitée',
 domains: 'Domaines illimités',
 ssl: 'SSL gratuit + Wildcard',
 protection: 'Anti-Red complet : masquage IP · défi JS · TLS/JA3 · règles WAF · support prioritaire',
 panel: 'HostPanel — staging, sécurité & tous les outils avancés',
 },
 }
}`,
  },
}
