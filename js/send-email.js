const nodemailer = require('nodemailer')
require('dotenv').config()

// NOTE: DigitalOcean blocks outbound SMTP ports 25/465/587 on droplets; Brevo's
// port 2525 (STARTTLS) is left open and must be used there. Default to 2525 when
// MAIL_PORT is unset. Explicit timeouts prevent a dead SMTP port from hanging the
// whole provisioning flow for ~2 min (2026-09 incident: 587 blocked).
const MAIL_PORT = Number(process.env.MAIL_PORT) || 2525
const transporter = nodemailer.createTransport({
  host: process.env.MAIL_DOMAIN,
  port: MAIL_PORT,
  secure: MAIL_PORT === 465,
  requireTLS: MAIL_PORT !== 465,
  connectionTimeout: 15000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
  auth: {
    user: process.env.MAIL_AUTH_USER,
    pass: process.env.MAIL_AUTH_PASSWORD,
  },
})

// ─── Localized email copy (en / fr / zh / hi) ────────────────────────────
const T = {
  en: {
    headerTitle: 'Your Hosting is Live!',
    headerSubtitle: (plan, w) => `${plan} activated for <strong>${w}</strong>`,
    greetingHello: (u) => `Hello <strong>${u}</strong>,`,
    greetingBody: 'Your hosting account is ready. Here are your login details — please save them securely.',
    loginDetailsTitle: '🔐 Login Details',
    labelDomain: 'Domain',
    labelPlan: 'Plan',
    labelDuration: 'Duration',
    labelUsername: 'Username',
    labelPin: 'PIN',
    labelPanel: 'Hosting Panel',
    cta: 'Login to Panel →',
    security: '🔒 <strong>Keep these credentials safe.</strong> Do not share your PIN with anyone. We will never ask for it.',
    needHelp: 'Need help?',
    contactSupport: 'Contact Support',
    sentBy: 'Sent by',
    footerAutomated: 'This is an automated message. Please do not reply to this email.',
    subject: (plan) => `🚀 Your ${plan} is Live — Login Details Inside`,
    durations: { week: '1 Week', month: '1 Month', m3: '3 Months', m6: '6 Months', year: '1 Year', other: 'See your plan details' },
  },
  fr: {
    headerTitle: 'Votre hébergement est en ligne !',
    headerSubtitle: (plan, w) => `${plan} activé pour <strong>${w}</strong>`,
    greetingHello: (u) => `Bonjour <strong>${u}</strong>,`,
    greetingBody: "Votre compte d'hébergement est prêt. Voici vos identifiants de connexion — veuillez les conserver en lieu sûr.",
    loginDetailsTitle: '🔐 Identifiants de connexion',
    labelDomain: 'Domaine',
    labelPlan: 'Forfait',
    labelDuration: 'Durée',
    labelUsername: "Nom d'utilisateur",
    labelPin: 'Code PIN',
    labelPanel: "Panneau d'hébergement",
    cta: 'Se connecter au panneau →',
    security: "🔒 <strong>Conservez ces identifiants en sécurité.</strong> Ne partagez votre code PIN avec personne. Nous ne vous le demanderons jamais.",
    needHelp: "Besoin d'aide ?",
    contactSupport: 'Contacter le support',
    sentBy: 'Envoyé par',
    footerAutomated: 'Ceci est un message automatique. Merci de ne pas y répondre.',
    subject: (plan) => `🚀 Votre ${plan} est en ligne — Identifiants à l'intérieur`,
    durations: { week: '1 semaine', month: '1 mois', m3: '3 mois', m6: '6 mois', year: '1 an', other: 'Voir les détails de votre forfait' },
  },
  zh: {
    headerTitle: '您的主机已上线！',
    headerSubtitle: (plan, w) => `${plan} 已为 <strong>${w}</strong> 激活`,
    greetingHello: (u) => `您好 <strong>${u}</strong>，`,
    greetingBody: '您的主机账户已准备就绪。以下是您的登录信息 — 请妥善保管。',
    loginDetailsTitle: '🔐 登录信息',
    labelDomain: '域名',
    labelPlan: '套餐',
    labelDuration: '时长',
    labelUsername: '用户名',
    labelPin: 'PIN 码',
    labelPanel: '主机面板',
    cta: '登录面板 →',
    security: '🔒 <strong>请妥善保管这些凭据。</strong> 请勿与任何人分享您的 PIN 码。我们绝不会向您索取。',
    needHelp: '需要帮助？',
    contactSupport: '联系支持',
    sentBy: '发送方',
    footerAutomated: '这是一封自动发送的邮件，请勿回复。',
    subject: (plan) => `🚀 您的${plan}已上线 — 登录信息在邮件内`,
    durations: { week: '1 周', month: '1 个月', m3: '3 个月', m6: '6 个月', year: '1 年', other: '查看您的套餐详情' },
  },
  hi: {
    headerTitle: 'आपकी होस्टिंग लाइव है!',
    headerSubtitle: (plan, w) => `${plan} <strong>${w}</strong> के लिए सक्रिय किया गया`,
    greetingHello: (u) => `नमस्ते <strong>${u}</strong>,`,
    greetingBody: 'आपका होस्टिंग खाता तैयार है। यहाँ आपके लॉगिन विवरण हैं — कृपया इन्हें सुरक्षित रूप से सहेजें।',
    loginDetailsTitle: '🔐 लॉगिन विवरण',
    labelDomain: 'डोमेन',
    labelPlan: 'प्लान',
    labelDuration: 'अवधि',
    labelUsername: 'उपयोगकर्ता नाम',
    labelPin: 'पिन',
    labelPanel: 'होस्टिंग पैनल',
    cta: 'पैनल में लॉगिन करें →',
    security: '🔒 <strong>इन क्रेडेंशियल्स को सुरक्षित रखें।</strong> अपना पिन किसी के साथ साझा न करें। हम इसे कभी नहीं मांगेंगे।',
    needHelp: 'मदद चाहिए?',
    contactSupport: 'सहायता से संपर्क करें',
    sentBy: 'द्वारा भेजा गया',
    footerAutomated: 'यह एक स्वचालित संदेश है। कृपया इस ईमेल का उत्तर न दें।',
    subject: (plan) => `🚀 आपका ${plan} लाइव है — लॉगिन विवरण अंदर`,
    durations: { week: '1 सप्ताह', month: '1 महीना', m3: '3 महीने', m6: '6 महीने', year: '1 वर्ष', other: 'अपने प्लान का विवरण देखें' },
  },
}

function langOf(info) {
  return T[info && info.userLanguage] ? info.userLanguage : 'en'
}

function durationOf(plan, t) {
  if (plan.includes('1-Week') || plan.includes('Weekly')) return t.durations.week
  if (plan.includes('1-Month') || plan.includes('Monthly')) return t.durations.month
  if (plan.includes('3-Month')) return t.durations.m3
  if (plan.includes('6-Month')) return t.durations.m6
  if (plan.includes('1-Year') || plan.includes('Yearly')) return t.durations.year
  return t.durations.other
}

// Localized copy for the "update your nameservers" card (external domains only).
const NS_COPY = {
  en: {
    title: '🌐 Action Required — Update Your Nameservers',
    intro: (domain) => `Your domain <strong>${domain}</strong> is connected as an external domain. Update the nameservers at your domain registrar to the values below so your site goes live:`,
    steps: `Go to your domain registrar's control panel → DNS / Nameserver settings → replace the existing nameservers with the two above.`,
    note: `⏳ Your site won't be live until the nameservers are updated and fully propagate (up to 24 hours).`,
  },
  fr: {
    title: '🌐 Action requise — Mettez à jour vos serveurs de noms',
    intro: (domain) => `Votre domaine <strong>${domain}</strong> est connecté en tant que domaine externe. Mettez à jour les serveurs de noms chez votre registraire avec les valeurs ci-dessous pour que votre site soit en ligne :`,
    steps: `Accédez au panneau de votre registraire → Paramètres DNS / Serveurs de noms → remplacez les serveurs de noms existants par les deux ci-dessus.`,
    note: `⏳ Votre site ne sera pas en ligne tant que les serveurs de noms ne seront pas mis à jour et entièrement propagés (jusqu'à 24 heures).`,
  },
  zh: {
    title: '🌐 需要操作 — 更新您的域名服务器',
    intro: (domain) => `您的域名 <strong>${domain}</strong> 已作为外部域名连接。请在您的域名注册商处将域名服务器更新为以下值，以使您的网站上线：`,
    steps: `前往您的域名注册商控制面板 → DNS / 域名服务器设置 → 将现有的域名服务器替换为以上两个。`,
    note: `⏳ 在域名服务器更新并完全传播之前（最多24小时），您的网站将无法上线。`,
  },
  hi: {
    title: '🌐 कार्रवाई आवश्यक — अपने नेमसर्वर अपडेट करें',
    intro: (domain) => `आपका डोमेन <strong>${domain}</strong> एक बाहरी डोमेन के रूप में कनेक्ट किया गया है। अपनी साइट को लाइव करने के लिए अपने डोमेन रजिस्ट्रार पर नेमसर्वर को नीचे दिए गए मानों में अपडेट करें:`,
    steps: `अपने डोमेन रजिस्ट्रार के कंट्रोल पैनल पर जाएं → DNS / नेमसर्वर सेटिंग्स → मौजूदा नेमसर्वर को ऊपर दिए गए दोनों से बदलें।`,
    note: `⏳ जब तक नेमसर्वर अपडेट और पूरी तरह प्रसारित नहीं हो जाते (24 घंटे तक), आपकी साइट लाइव नहीं होगी।`,
  },
}

function buildNameserverCard(info) {
  const isExternal = info._isExternalDomain || info.connectExternalDomain
  const ns = Array.isArray(info.cfNameservers) ? info.cfNameservers : []
  if (!isExternal || ns.length < 2) return ''

  const lang = langOf(info)
  const c = NS_COPY[lang] || NS_COPY.en

  return `
              <!-- Nameserver Action (external domain) -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%); border-radius: 12px; border: 1px solid #fcd34d; margin-bottom: 25px;">
                <tr>
                  <td style="padding: 25px;">
                    <h2 style="margin: 0 0 12px; font-size: 16px; color: #92400e; text-transform: uppercase; letter-spacing: 1px;">${c.title}</h2>
                    <p style="margin: 0 0 16px; font-size: 14px; color: #78350f; line-height: 1.6;">${c.intro(info.website_name)}</p>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(146,64,14,0.15);">
                          <span style="color: #92400e; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">NS1</span><br>
                          <span style="color: #1a1a2e; font-size: 16px; font-weight: 600; font-family: 'Courier New', monospace; background: #fff; padding: 2px 8px; border-radius: 4px;">${ns[0]}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0;">
                          <span style="color: #92400e; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">NS2</span><br>
                          <span style="color: #1a1a2e; font-size: 16px; font-weight: 600; font-family: 'Courier New', monospace; background: #fff; padding: 2px 8px; border-radius: 4px;">${ns[1]}</span>
                        </td>
                      </tr>
                    </table>

                    <p style="margin: 16px 0 8px; font-size: 13px; color: #78350f; line-height: 1.6;">${c.steps}</p>
                    <p style="margin: 0; font-size: 13px; color: #b45309; line-height: 1.6; font-weight: 600;">${c.note}</p>
                  </td>
                </tr>
              </table>
`
}

function emailSubject(info) {
  const t = T[langOf(info)]
  return t.subject(info.plan || 'Hosting Plan')
}

function buildEmailHtml(info, response, pin) {
  const plan = info.plan || 'Hosting Plan'
  const t = T[langOf(info)]
  const panelDomain = process.env.PANEL_DOMAIN
  const panelUrl = panelDomain
    ? (panelDomain.startsWith('http') ? panelDomain : `https://${panelDomain}`)
    : `${(process.env.SELF_URL_PROD || '').replace('/api', '')}/panel`
  const brandName = process.env.CHAT_BOT_BRAND || 'Nomadly'
  const supportLink = process.env.APP_SUPPORT_LINK || '#'

  const duration = durationOf(plan, t)
  const nameserverCard = buildNameserverCard(info)

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f0f2f5; font-family: 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f0f2f5; padding: 30px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">

          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px 30px; text-align: center; border-radius: 16px 16px 0 0;">
              <div style="font-size: 48px; margin-bottom: 10px;">🚀</div>
              <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700; letter-spacing: -0.5px;">${t.headerTitle}</h1>
              <p style="margin: 8px 0 0; color: rgba(255,255,255,0.85); font-size: 15px;">${t.headerSubtitle(plan, info.website_name)}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="background-color: #ffffff; padding: 35px 30px;">

              <p style="font-size: 16px; color: #333; line-height: 1.6; margin: 0 0 25px;">
                ${t.greetingHello(info.username || 'there')}<br>
                ${t.greetingBody}
              </p>

              <!-- Credentials Card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #f5f7ff 0%, #ede9fe 100%); border-radius: 12px; border: 1px solid #e0d4fd; margin-bottom: 25px;">
                <tr>
                  <td style="padding: 25px;">
                    <h2 style="margin: 0 0 18px; font-size: 16px; color: #764ba2; text-transform: uppercase; letter-spacing: 1px;">${t.loginDetailsTitle}</h2>

                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(118,75,162,0.15);">
                          <span style="color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">${t.labelDomain}</span><br>
                          <span style="color: #1a1a2e; font-size: 16px; font-weight: 600;">${info.website_name}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(118,75,162,0.15);">
                          <span style="color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">${t.labelPlan}</span><br>
                          <span style="color: #1a1a2e; font-size: 16px; font-weight: 600;">${plan}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(118,75,162,0.15);">
                          <span style="color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">${t.labelDuration}</span><br>
                          <span style="color: #1a1a2e; font-size: 16px; font-weight: 600;">${duration}</span>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(118,75,162,0.15);">
                          <span style="color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">${t.labelUsername}</span><br>
                          <span style="color: #1a1a2e; font-size: 16px; font-weight: 600; font-family: 'Courier New', monospace; background: #fff; padding: 2px 8px; border-radius: 4px;">${response.username}</span>
                        </td>
                      </tr>${pin ? `
                      <tr>
                        <td style="padding: 10px 0; border-bottom: 1px solid rgba(118,75,162,0.15);">
                          <span style="color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">${t.labelPin}</span><br>
                          <span style="color: #764ba2; font-size: 20px; font-weight: 700; font-family: 'Courier New', monospace; background: #fff; padding: 2px 10px; border-radius: 4px; letter-spacing: 3px;">${pin}</span>
                        </td>
                      </tr>` : ''}
                      <tr>
                        <td style="padding: 10px 0;">
                          <span style="color: #666; font-size: 13px; text-transform: uppercase; letter-spacing: 0.5px;">${t.labelPanel}</span><br>
                          <a href="${panelUrl}" style="color: #667eea; font-size: 16px; font-weight: 600; text-decoration: none;">${panelUrl}</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
${nameserverCard}
              <!-- CTA Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 25px;">
                <tr>
                  <td align="center">
                    <a href="${panelUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 8px; font-size: 16px; font-weight: 600; letter-spacing: 0.3px;">${t.cta}</a>
                  </td>
                </tr>
              </table>

              <!-- Security Notice -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #fff7ed; border-radius: 10px; border: 1px solid #fed7aa; margin-bottom: 20px;">
                <tr>
                  <td style="padding: 18px 20px;">
                    <p style="margin: 0; font-size: 14px; color: #9a3412; line-height: 1.6;">
                      ${t.security}
                    </p>
                  </td>
                </tr>
              </table>

              <p style="font-size: 14px; color: #666; line-height: 1.6; margin: 0;">
                ${t.needHelp} <a href="${supportLink}" style="color: #667eea; text-decoration: none; font-weight: 600;">${t.contactSupport}</a>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #1a1a2e; padding: 25px 30px; text-align: center; border-radius: 0 0 16px 16px;">
              <p style="margin: 0 0 5px; color: rgba(255,255,255,0.7); font-size: 13px;">
                ${t.sentBy} <strong style="color: #fff;">${brandName}</strong>
              </p>
              <p style="margin: 0; color: rgba(255,255,255,0.4); font-size: 12px;">
                ${t.footerAutomated}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`
}

async function sendEmail(info, response, pin) {
  const brandName = process.env.CHAT_BOT_BRAND || 'Nomadly'
  const emailHtml = buildEmailHtml(info, response, pin)

  try {
    const mailResponse = await transporter.sendMail({
      from: `${brandName} <${process.env.MAIL_SENDER}>`,
      to: info.email,
      subject: emailSubject(info),
      html: emailHtml,
    })

    console.log('[Email] Hosting credentials sent to %s (messageId: %s)', info.email, mailResponse.messageId)
    return true
  } catch (error) {
    console.error('[Email] Error sending hosting credentials:', error)
    return false
  }
}

module.exports = sendEmail
module.exports.buildEmailHtml = buildEmailHtml
module.exports.buildNameserverCard = buildNameserverCard
module.exports.emailSubject = emailSubject
