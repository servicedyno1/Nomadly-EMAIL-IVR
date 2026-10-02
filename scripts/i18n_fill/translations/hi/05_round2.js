// Round 2 (2026-10): admin strings back to English, new compact hP.plans/generatePlanText,
// user-facing leftovers (vps_10, billing-cycle names, Support button label).
const { en } = require('../../../../js/lang/en.js')
const { ADMIN_KEYS, pick } = require('../../admin_keys.js')

const cycle = `({ Hourly: 'प्रति घंटा', Monthly: 'मासिक' })[item.type] || item.type.replace(/(\\d+) Months/, '$1 महीने')`

module.exports = {
  t: {
    ...pick(en.t, ADMIN_KEYS.t),
    vps_10: '✏️ नई <b>विषय</b> पंक्ति दर्ज करें:',
    dustDepositNotice: { __src: `(receivedUsd, minUsd, tickerView) =>
 \`⚠️ <b>जमा न्यूनतम से कम — क्रेडिट नहीं हुआ</b>\\n\\nहमने आपसे \${tickerView} में <b>≈ $\${Number(receivedUsd).toFixed(2)} USD</b> प्राप्त किया, लेकिन इस सिक्के के लिए वॉलेट जमा की न्यूनतम राशि <b>$\${Number(minUsd).toFixed(0)} USD</b> है।\\n\\nइतनी छोटी जमा राशि को स्वीप करने का नेटवर्क शुल्क जमा से अधिक है, इसलिए आपके धन को क्रेडिट नहीं किया गया।\\n\\nयदि सहायता चाहिए, तो 💬 सहायता पर टैप करें — हमारी टीम आपकी सहायता करेगी।\\n\\n— \${CHAT_BOT_NAME}\`` },
  },
  vs: { ...pick(en.vs, ADMIN_KEYS.vs) },
  admin: { ...pick(en.admin, ADMIN_KEYS.admin) },
  vp: {
    askPlanType: { __src: `plans => \`💳 बिलिंग चक्र चुनें:

\${plans
 .map(
 item =>
 \`<strong>• \${item.type === 'Hourly' ? '⏳' : '📅'} \${${cycle}} –</strong> $\${item.originalPrice} \${
 item.discount === 0 ? '(कोई छूट नहीं)' : \`(\${item.discount}% छूट शामिल है)\`
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
 duration: '7 दिन',
 storage: '10 GB SSD',
 bandwidth: '100 GB',
 domains: '2 डोमेन तक',
 ssl: 'मुफ़्त SSL',
 protection: 'IP क्लोकिंग · बॉट पहचान · UA ब्लॉकिंग',
 panel: 'HostPanel — फ़ाइल, DB और ईमेल प्रबंधन',
 },
 premiumCpanel: {
 name: 'Premium Anti-Red HostPanel (30 Days)',
 price: PREMIUM_ANTIRED_CPANEL_PRICE,
 duration: '30 दिन',
 storage: '50 GB SSD',
 bandwidth: '500 GB',
 domains: '6 डोमेन तक',
 ssl: 'मुफ़्त SSL',
 protection: 'IP क्लोकिंग · JS चैलेंज · UA और TLS ब्लॉकिंग',
 panel: 'HostPanel — बैकअप, माइग्रेशन और उन्नत टूल',
 },
 goldenCpanel: {
 name: 'Golden Anti-Red HostPanel (30 Days)',
 price: GOLDEN_ANTIRED_CPANEL_PRICE,
 duration: '30 दिन',
 storage: '100 GB SSD',
 bandwidth: 'असीमित',
 domains: 'असीमित डोमेन',
 ssl: 'मुफ़्त SSL + वाइल्डकार्ड',
 protection: 'पूर्ण Anti-Red: IP क्लोकिंग · JS चैलेंज · TLS/JA3 · WAF नियम · प्राथमिकता सहायता',
 panel: 'HostPanel — स्टेजिंग, सुरक्षा और सभी उन्नत टूल',
 },
 }
}`,
  },
}
