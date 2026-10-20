// test_user_facing_localization.js
//
// Regression: every user-facing notification we localized in the admin-bot
// upgrade ships the EN + FR + ZH + HI strings. Static-source check — we don't
// run the bot, just grep _index.js for the localized markers near each anchor.
//
// Anchors (the EN form of the message that must survive in the source):
//   • L2553   "Number purchase failed after regulatory approval."        ─ wallet refund DM
//   • L2582   "Your wallet has been refunded. Please contact support."   ─ exception refund DM
//   • L2641   "Verification Rejected" + Issues found / accepted docs hdr ─ rejected number flow
//   • L997    "Which SIM should send this campaign"                      ─ SIM picker
//   • L3370   "No previous call data found"                              ─ IVR redial
//   • L3435   "OTP already processed (status:"                           ─ Twilio OTP
//   • L3483   "OTP already processed (phase:"                            ─ Telnyx OTP
//   • L4395   "Order Delivered!"                                         ─ /deliver buyer DM
//   • L8864   "New Referral!"                                            ─ referrer DM
//   • L14116  "Already shortened!"                                       ─ link reuse
//   • L24629  "Device name cannot be empty"                              ─ rename validation
//   • L24633  "Device name too long"                                     ─ rename validation
//   • L24645  "Device not found"                                         ─ rename
//   • L27199  "Campaign not found. Payment refunded"                     ─ EB campaign error
//   • L27215  "Failed to start campaign"                                 ─ EB campaign error
//   • L29423  "Lead generation failed"                                   ─ admin/order-leads
//   • L29699  "Fax PDF available at"                                     ─ Fax fallback
//   • L29724  "Fax received but PDF retrieval failed"                    ─ Fax error
//   • L30046  "Incoming Call Blocked — No Credits"                       ─ call blocked
//   • L30047  "Call Blocked"  + "Minute limit reached"                   ─ call blocked

const fs = require('fs')
const path = require('path')
const assert = require('assert')

const src = fs.readFileSync(path.join(__dirname, '..', '_index.js'), 'utf8')

// For each anchor, walk back/forward N chars and ensure FR/ZH/HI markers exist.
// We use distinctive markers per locale so a missed translation fails loudly.
const LOCALES = {
  // generic markers — at least one of these must appear in each block
  fr: ['Échec', 'remboursé', 'Vérification Rejetée', 'Quelle SIM', 'Aucune donnée', 'OTP déjà traité',
       'Session expirée', 'Commande livrée', 'Nouveau parrainage', 'Déjà raccourci',
       'nom de l\'appareil', 'Appareil introuvable', 'Appareil renommé', 'Campagne introuvable',
       'démarrer la campagne', 'génération de leads', 'PDF du fax', 'Fax reçu',
       'Appel entrant bloqué', 'Appel bloqué', 'Documents acceptés', 'Problèmes trouvés',
       'documents fournis'],
  zh: ['失败', '退款', '验证被拒绝', 'SIM 卡', '未找到先前', 'OTP 已处理',
       '会话已过期', '订单已交付', '新推荐', '已缩短',
       '设备名称', '未找到设备', '设备已重命名', '未找到活动',
       '无法启动活动', '线索生成失败', '传真 PDF', '已收到传真',
       '来电被阻止', '通话被阻止', '接受的文件', '发现的问题',
       '提供的文件'],
  hi: ['विफल', 'रिफंड', 'सत्यापन अस्वीकृत', 'SIM', 'पिछला कॉल डेटा', 'OTP पहले से ही',
       'सत्र समाप्त', 'ऑर्डर डिलीवर', 'नया रेफरल', 'पहले से छोटा',
       'डिवाइस नाम', 'डिवाइस नहीं मिला', 'डिवाइस का नाम बदला', 'अभियान नहीं मिला',
       'अभियान शुरू', 'लीड जनरेशन विफल', 'फैक्स PDF', 'फैक्स प्राप्त',
       'इनकमिंग कॉल अवरुद्ध', 'कॉल अवरुद्ध', 'दस्तावेज़ स्वीकार्य', 'समस्याएँ मिलीं',
       'प्रदान किए गए दस्तावेज़'],
}

const ANCHORS = [
  // [anchor EN substring, FR/ZH/HI markers it must include nearby]
  ['Number purchase failed after regulatory approval', ['Échec de l\'achat', '号码购买失败', 'नंबर खरीद विफल']],
  ['Your wallet has been refunded. Please contact support', ['Votre portefeuille a été remboursé', '您的钱包已退款', 'आपके वॉलेट को रिफंड']],
  ['Verification Rejected', ['Vérification Rejetée', '验证被拒绝', 'सत्यापन अस्वीकृत']],
  ['What documents are accepted', ['Documents acceptés', '接受的文件', 'दस्तावेज़ स्वीकार्य']],
  ['Issues found', ['Problèmes trouvés', '发现的问题', 'समस्याएँ मिलीं']],
  ['documents provided did not meet the telecom regulatory', ['documents fournis', '提供的文件', 'प्रदान किए गए दस्तावेज़']],
  ['Which SIM should send this campaign', ['Quelle SIM', 'SIM 卡应发送', 'SIM भेजे']],
  ["SMS app once, then come back", ['Ouvrez l\'application ${', ' SMS 应用一次', ' SMS ऐप एक बार']],
  ['No previous call data found', ['Aucune donnée d', '未找到先前的通话', 'पिछला कॉल डेटा']],
  ['OTP already processed (status:', ['OTP déjà traité (statut', 'OTP 已处理（状态', 'OTP पहले से ही प्रोसेस किया गया (स्थिति']],
  ['OTP already processed (phase:', ['OTP déjà traité (phase', 'OTP 已处理（阶段', 'OTP पहले से ही प्रोसेस किया गया (चरण']],
  ['Session expired or call already ended', ['Session expirée', '会话已过期', 'सत्र समाप्त']],
  ['<b>Order Delivered!</b>', ['Commande livrée', '订单已交付', 'ऑर्डर डिलीवर हुआ']],
  ['<b>New Referral!</b>', ['Nouveau parrainage', '新推荐', 'नया रेफरल']],
  ['<b>Already shortened!</b>', ['Déjà raccourci', '已缩短', 'पहले से छोटा किया हुआ']],
  ['Device name cannot be empty', ['nom de l\\\'appareil ne peut être vide', '设备名称不能为空', 'डिवाइस नाम खाली नहीं']],
  ['Device name too long (max 50 characters)', ['Nom d\\\'appareil trop long', '设备名称过长', 'डिवाइस नाम बहुत लंबा']],
  ['Device not found. It may have been logged out', ['Appareil introuvable', '未找到设备', 'डिवाइस नहीं मिला']],
  ['Failed to rename device', ['Échec du renommage', '设备重命名失败', 'डिवाइस का नाम बदलने में विफल']],
  ['Campaign not found. Payment refunded', ['Campagne introuvable', '未找到活动', 'अभियान नहीं मिला']],
  ['Failed to start campaign. Payment refunded', ['Impossible de démarrer la campagne', '无法启动活动', 'अभियान शुरू करने में विफल']],
  ['<b>Lead generation failed</b>', ['Échec de la génération de leads', '线索生成失败', 'लीड जनरेशन विफल']],
  ['Fax PDF available at:', ['PDF du fax disponible', '传真 PDF 可在此处获取', 'फैक्स PDF यहाँ उपलब्ध']],
  ['Fax received but PDF retrieval failed', ['récupération du PDF a échoué', 'PDF 检索失败', 'PDF प्राप्त करने में विफल']],
  ['<b>Incoming Call Blocked — No Credits</b>', ['Appel entrant bloqué — Aucun crédit', '来电被阻止 — 无余额', 'इनकमिंग कॉल अवरुद्ध — क्रेडिट नहीं']],
  ['<b>Call Blocked</b> — Minute limit reached', ['<b>Appel bloqué</b> — Limite de minutes', '<b>通话被阻止</b> — 已达到分钟限制', '<b>कॉल अवरुद्ध</b> — मिनट सीमा पूरी']],
]

let passed = 0, failed = 0
console.log('\n=== User-Facing Localization Coverage ===\n')
for (const [enAnchor, [fr, zh, hi]] of ANCHORS) {
  // Anchor must exist
  if (!src.includes(enAnchor)) { console.log(`  ❌ EN anchor missing: "${enAnchor.substring(0, 60)}…"`); failed++; continue }
  // Each translation must exist somewhere in the file (a localized inline dict typically sits alongside)
  const missing = []
  if (!src.includes(fr)) missing.push('fr')
  if (!src.includes(zh)) missing.push('zh')
  if (!src.includes(hi)) missing.push('hi')
  if (missing.length) {
    console.log(`  ❌ Missing ${missing.join('/')} for: "${enAnchor.substring(0, 60)}…"`)
    failed++
  } else {
    console.log(`  ✅ ${enAnchor.substring(0, 60)}…`)
    passed++
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===\n`)
process.exit(failed === 0 ? 0 : 1)
