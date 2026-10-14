import json, os

D = '/app/frontend/src/locales'

LP = {
 'en': {
  'cmpTitle': 'Compare plans', 'cmpFeature': 'Feature', 'cmpUnlimited': 'Unlimited',
  'cmpIncluded': 'Included', 'cmpNotIncluded': 'Not included',
  'cmpRow_price': 'Price', 'cmpRow_billing': 'Billing', 'cmpRow_addons': 'Addon domains', 'cmpRow_mysql': 'MySQL databases',
  'cmpRow_antired': 'Anti-Red protection', 'cmpRow_panel': 'HostPanel + File Manager', 'cmpRow_email': 'Email accounts',
  'cmpRow_apps': 'One-click apps', 'cmpRow_captcha': 'Visitor captcha', 'cmpRow_geo': 'Geo controls', 'cmpRow_guarantee': 'Replacement guarantee',
  'faq6A': 'The weekly plan includes 1 addon domain and 2 MySQL databases. The monthly plan raises that to 5 addon domains and 5 databases. Golden adds unlimited addon domains and databases, plus visitor captcha and geo controls.',
 },
 'fr': {
  'cmpTitle': 'Comparer les offres', 'cmpFeature': 'Fonctionnalité', 'cmpUnlimited': 'Illimité',
  'cmpIncluded': 'Inclus', 'cmpNotIncluded': 'Non inclus',
  'cmpRow_price': 'Prix', 'cmpRow_billing': 'Facturation', 'cmpRow_addons': 'Domaines additionnels', 'cmpRow_mysql': 'Bases MySQL',
  'cmpRow_antired': 'Protection Anti-Red', 'cmpRow_panel': 'HostPanel + gestionnaire de fichiers', 'cmpRow_email': 'Comptes e-mail',
  'cmpRow_apps': 'Applications en un clic', 'cmpRow_captcha': 'Captcha visiteurs', 'cmpRow_geo': 'Contrôle géographique', 'cmpRow_guarantee': 'Garantie de remplacement',
  'faq6A': "L'offre hebdomadaire inclut 1 domaine additionnel et 2 bases MySQL. L'offre mensuelle passe à 5 domaines additionnels et 5 bases. Golden offre des domaines additionnels et des bases illimités, plus le captcha visiteurs et le contrôle géographique.",
 },
 'hi': {
  'cmpTitle': 'प्लान की तुलना करें', 'cmpFeature': 'फ़ीचर', 'cmpUnlimited': 'असीमित',
  'cmpIncluded': 'शामिल', 'cmpNotIncluded': 'शामिल नहीं',
  'cmpRow_price': 'कीमत', 'cmpRow_billing': 'बिलिंग', 'cmpRow_addons': 'ऐडऑन डोमेन', 'cmpRow_mysql': 'MySQL डेटाबेस',
  'cmpRow_antired': 'Anti-Red सुरक्षा', 'cmpRow_panel': 'HostPanel + फ़ाइल मैनेजर', 'cmpRow_email': 'ईमेल अकाउंट',
  'cmpRow_apps': 'वन-क्लिक ऐप्स', 'cmpRow_captcha': 'विज़िटर कैप्चा', 'cmpRow_geo': 'जियो कंट्रोल', 'cmpRow_guarantee': 'रिप्लेसमेंट गारंटी',
  'faq6A': 'साप्ताहिक प्लान में 1 ऐडऑन डोमेन और 2 MySQL डेटाबेस हैं। मासिक प्लान में यह बढ़कर 5 ऐडऑन डोमेन और 5 डेटाबेस हो जाते हैं। Golden में असीमित ऐडऑन डोमेन और डेटाबेस के साथ विज़िटर कैप्चा और जियो कंट्रोल मिलते हैं।',
 },
 'zh': {
  'cmpTitle': '套餐对比', 'cmpFeature': '功能', 'cmpUnlimited': '无限',
  'cmpIncluded': '包含', 'cmpNotIncluded': '不包含',
  'cmpRow_price': '价格', 'cmpRow_billing': '计费周期', 'cmpRow_addons': '附加域名', 'cmpRow_mysql': 'MySQL 数据库',
  'cmpRow_antired': 'Anti-Red 防护', 'cmpRow_panel': 'HostPanel + 文件管理', 'cmpRow_email': '邮箱账户',
  'cmpRow_apps': '一键应用', 'cmpRow_captcha': '访客验证码', 'cmpRow_geo': '地区控制', 'cmpRow_guarantee': '更换保障',
  'faq6A': '周套餐包含 1 个附加域名和 2 个 MySQL 数据库。月套餐提升到 5 个附加域名和 5 个数据库。Golden 套餐提供无限附加域名和数据库，以及访客验证码和地区控制。',
 },
}

OV = {
 'en': {
  'daysLeft_one': '{{count}} day left', 'daysLeft_other': '{{count}} days left', 'expiresToday': 'Less than a day left',
  'expBannerSoon_one': 'Your plan expires in {{count}} day', 'expBannerSoon_other': 'Your plan expires in {{count}} days',
  'expBannerToday': 'Your plan expires in less than a day', 'expBannerExpired': 'Your plan has expired',
  'expAutoOn': "Auto-renew is on. We'll renew from your wallet, so make sure it has enough balance.",
  'expAutoOff': 'Auto-renew is off. Renew now so your site stays online.',
  'expExpiredBody': 'Renew now to keep your site online and your files safe.',
  'expRenewNow': 'Renew now',
 },
 'fr': {
  'daysLeft_one': '{{count}} jour restant', 'daysLeft_other': '{{count}} jours restants', 'expiresToday': "Moins d'un jour restant",
  'expBannerSoon_one': 'Votre offre expire dans {{count}} jour', 'expBannerSoon_other': 'Votre offre expire dans {{count}} jours',
  'expBannerToday': "Votre offre expire dans moins d'un jour", 'expBannerExpired': 'Votre offre a expiré',
  'expAutoOn': 'Le renouvellement auto est activé. Nous renouvellerons depuis votre portefeuille : vérifiez que le solde suffit.',
  'expAutoOff': 'Le renouvellement auto est désactivé. Renouvelez maintenant pour garder votre site en ligne.',
  'expExpiredBody': 'Renouvelez maintenant pour garder votre site en ligne et vos fichiers en sécurité.',
  'expRenewNow': 'Renouveler',
 },
 'hi': {
  'daysLeft_one': '{{count}} दिन बाकी', 'daysLeft_other': '{{count}} दिन बाकी', 'expiresToday': 'एक दिन से कम बाकी',
  'expBannerSoon_one': 'आपका प्लान {{count}} दिन में समाप्त होगा', 'expBannerSoon_other': 'आपका प्लान {{count}} दिनों में समाप्त होगा',
  'expBannerToday': 'आपका प्लान एक दिन से कम समय में समाप्त होगा', 'expBannerExpired': 'आपका प्लान समाप्त हो गया है',
  'expAutoOn': 'ऑटो-रिन्यू चालू है। हम आपके वॉलेट से रिन्यू करेंगे, इसलिए पर्याप्त बैलेंस रखें।',
  'expAutoOff': 'ऑटो-रिन्यू बंद है। अपनी साइट ऑनलाइन रखने के लिए अभी रिन्यू करें।',
  'expExpiredBody': 'अपनी साइट ऑनलाइन और फ़ाइलें सुरक्षित रखने के लिए अभी रिन्यू करें।',
  'expRenewNow': 'अभी रिन्यू करें',
 },
 'zh': {
  'daysLeft_one': '剩余 {{count}} 天', 'daysLeft_other': '剩余 {{count}} 天', 'expiresToday': '剩余不到一天',
  'expBannerSoon_one': '您的套餐将在 {{count}} 天后到期', 'expBannerSoon_other': '您的套餐将在 {{count}} 天后到期',
  'expBannerToday': '您的套餐将在一天内到期', 'expBannerExpired': '您的套餐已到期',
  'expAutoOn': '自动续费已开启。我们将从您的钱包续费，请确保余额充足。',
  'expAutoOff': '自动续费已关闭。请立即续费，保持网站在线。',
  'expExpiredBody': '请立即续费，保持网站在线并确保文件安全。',
  'expRenewNow': '立即续费',
 },
}

for lang in ['en', 'fr', 'hi', 'zh']:
    p = os.path.join(D, f'{lang}.json')
    d = json.load(open(p, encoding='utf-8'))
    d['store']['lp'].update(LP[lang])
    ov = d['dashboard']['ov']
    ov.pop('daysLeft', None)
    ov.update(OV[lang])
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=2)
        f.write('\n')
print('ok')
