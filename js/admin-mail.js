'use strict'
// Admin alert email (Bird failures, provider balance/health). Sender: CLOUDIVR_MAIL_SENDER, else MAIL_SENDER.
const to = () => process.env.BIRD_ALERT_EMAIL || 'moxxcompany@gmail.com'

function adminMail(subject, html) {
  const address = process.env.CLOUDIVR_MAIL_SENDER || process.env.MAIL_SENDER
  if (!address) { console.log(`[AdminMail] no sender configured (CLOUDIVR_MAIL_SENDER / MAIL_SENDER) — skipped "${subject}"`); return Promise.resolve(false) }
  return require('./mailer').send({ from: { name: process.env.MAIL_SENDER_NAME || 'CloudIVR', email: address }, to: to(), subject, html: `${html}<p>Time: ${new Date().toISOString()}</p>` })
    .then(() => true, e => { console.log(`[AdminMail] "${subject}" failed: ${e.message}`); return false })
}

module.exports = { adminMail }
