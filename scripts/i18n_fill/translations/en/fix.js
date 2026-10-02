// Fix: cp_331/cp_335 leaked a raw `({ en: ... }[lang] || ...)` expression into the user-visible text.
module.exports = {
  t: {
    cp_331: (icon, name, text) => `📋 <b>${icon} ${name}</b>\n\n<code>${text}</code>\n\n✏️ Type your modified version, or tap <b>✅ Use As-Is</b>:`,
    cp_335: (text) => `📋 <b>Message</b>\n\n<code>${text}</code>\n\n✏️ Type your modified version, or tap <b>✅ Use As-Is</b>:`,
  },
}
