// One-off copy sweep: "USA mobile number" → "Texting Number" and no per-text / per-minute prices for it.
const fs = require('fs')
const F = '/app/frontend/src/cloudivr/'
const J = '/app/js/'
const R = {
  [F + 'pages/Sip.js']: [['USA mobile numbers use the browser phone', 'Texting Numbers use the browser phone'], ['USA mobile number · {m.status}', 'Texting Number · {m.status}']],
  [F + 'pages/messages/NewMessage.js']: [["'USA mobile number'", "'Texting Number'"]],
  [F + 'pages/messages/Thread.js']: [["'USA mobile number'", "'Texting Number'"]],
  [F + 'pages/dashboard/Widgets.js']: [["planName: 'USA mobile number'", "planName: 'Texting Number'"]],
  [F + 'pages/number/IvrSms.js']: [["'USA mobile number'", "'Texting Number'"], ['Get a USA mobile number', 'Order a Texting Number'], ['USA mobile numbers are temporarily unavailable.', 'Texting Numbers are temporarily unavailable.']],
  [F + 'pages/Numbers.js']: [['Your USA mobile and Landline to Texting numbers are listed below them.', 'Your Texting Numbers and Landline to Texting numbers are listed below them.']],
  [F + 'pages/Wallet.js']: [['Numbers, eSIMs, USA mobile numbers, renewals', 'Numbers, eSIMs, Texting Numbers, renewals']],
  [F + 'Softphone.js']: [["'USA mobile'", "'Texting Number'"]],
  [F + 'pages/landing/menu.js']: [["'USA mobile number', 'A virtual local number on a real USA carrier, used in your browser.'", "'Texting Number', 'Send and receive texts in your browser, on a real USA carrier number.'"]],
  [F + 'pages/landing/Nav.js']: [["'USA mobile number'", "'Texting Number'"]],
  [F + 'pages/landing/MobileCheckout.js']: [['Open Buy a number → USA mobile number in the app to finish the order.', 'Open Texting Number in the app menu to finish the order.'], ['`USA mobile number · $${price}/month`', '`Texting Number · $${price}/month`'], ['`USA mobile number · ZIP ${zip}`', '`Texting Number · ZIP ${zip}`']],
  [F + 'pages/landing/OnePage.js']: [["'A USA mobile number', 'Real carrier number in your browser'", "'A Texting Number', 'Send and receive texts in your browser'"], ['Cloud phone, IVR and USA mobile lines', 'Cloud phone, IVR and texting'], ['title="USA mobile number"', 'title="Texting Number"'], ['Want a number you use in your browser? <b>USA mobile number</b>.', 'Want to text from your browser? <b>Texting Number</b>.']],
  [F + 'pages/landing/HeroCard.js']: [["mobile: 'Mobile number'", "mobile: 'Texting Number'"], ["'A USA mobile number', 'Real carrier number in your browser'", "'A Texting Number', 'Send and receive texts in your browser'"], ['title="USA mobile number"', 'title="Texting Number"'], ['Want a number you use in your browser? <b>USA mobile number</b>.', 'Want to text from your browser? <b>Texting Number</b>.']],
  [F + 'pages/landing/ProductHero.js']: [['USA mobile lines on a real carrier', 'USA carrier lines and texting'], ['title="USA mobile number"', 'title="Texting Number"'], ['Want a number you use in your browser? <b>USA mobile number</b> (virtual, real carrier).', 'Want to text from your browser? <b>Texting Number</b> (real USA carrier).']],
  [F + 'pages/landing/PricingFaq.js']: [
    ['Is the USA mobile number or the USA eSIM VoIP?', 'Is the Texting Number or the USA eSIM VoIP?'],
    ['the USA mobile number lives in CloudIVR', 'the Texting Number lives in CloudIVR'],
    ['The USA mobile number sends and receives them', 'The Texting Number sends and receives them'],
    ['the USA mobile number appears in My numbers.', 'the Texting Number appears under Texting Number in the app.'],
    ["['Can the USA mobile number make calls?', 'Yes, outgoing calls from the browser phone: $0.15 a minute to the USA and Canada, other countries from $0.50 a minute, plus $0.03 per call, from your wallet. Texts cost $0.05 each, and the number is a free verified caller ID for your other CloudIVR calls.']", "['Can the Texting Number make calls?', 'Yes, outgoing calls from the browser phone, paid from your wallet. The number is also a free verified caller ID for your other CloudIVR calls.']"],
    ["'USA mobile number', 'mobile'", "'Texting Number', 'mobile'"]],
  [F + 'pages/landing/EsimPlans.js']: [['Want texting in the browser? Get a USA mobile number.', 'Want texting in the browser? Get a Texting Number.']],
  [F + 'pages/landing/Showcase.js']: [['Your USA mobile number, renewal and replacement in one place.', 'Your Texting Number, renewal and replacement in one place.']],
  [F + 'pages/messages/Composer.js']: [
    ['{`Each text costs ${money(t.cost.each)} from your wallet. Top up to send.`}', 'Your wallet is too low to send texts. Top up to keep texting.'],
    ["t.number.kind === 'esim' ? `${money(t.cost.each * parts)} from your wallet${parts > 1 ? ` · ${parts} parts × ${money(t.cost.each)}` : ''}` :", "t.number.kind === 'esim' ? (parts > 1 ? `Sends as ${parts} joined texts` : '') :"]],
  [F + 'pages/Inbox.js']: [[" {...(n.meta?.hosted || n.meta?.esim ? { costNote: '$0.05 from your wallet' } : {})}", " {...(n.meta?.hosted || n.meta?.esim ? { costNote: '' } : {})}"]],
  [F + 'QuickReply.js']: [['{`${text.length}/${max} · ${costNote}`}', '{`${text.length}/${max}${costNote ? ` · ${costNote}` : \'\'}`}']],
  [J + 'spenza.js']: [
    ["'USA mobile numbers are temporarily unavailable. Try again later.'", "'Texting Numbers are temporarily unavailable. Try again later.'"],
    ['`📱 Your USA mobile number is ready: ${phone || \'\'}. It has two-way SMS: send and receive texts in Messages.`', '`📱 Your Texting Number is ready: ${phone || \'\'}. Send and receive texts in Messages.`'],
    ['`⚠️ Your USA mobile number couldn’t be set up.', '`⚠️ Your Texting Number couldn’t be set up.'],
    ["`USA mobile number ${d.phoneNumber || ''}`", "`Texting Number ${d.phoneNumber || ''}`"],
    ["d.kind === 'mobile' ? 'USA mobile number' : 'USA eSIM'", "d.kind === 'mobile' ? 'Texting Number' : 'USA eSIM'"],
    ["line: d.kind === 'mobile' ? 'USA mobile number' : 'USA eSIM'", "line: d.kind === 'mobile' ? 'Texting Number' : 'USA eSIM'"],
    ["d.kind === 'mobile' ? 'mobile number' : 'eSIM'", "d.kind === 'mobile' ? 'Texting Number' : 'eSIM'"]],
  [J + 'cloudivr-web/offers.js']: [['not the eSIM or USA mobile number.', 'not the eSIM or Texting Number.']],
  [J + 'cloudivr-web/statement.js']: [["'USA mobile number purchase'", "'Texting Number purchase'"], ["'eSIM / mobile number renewal'", "'eSIM / Texting Number renewal'"], ["'Mobile number replacement'", "'eSIM / Texting Number replacement'"]],
  [J + 'cloudivr-web/support.js']: [['(USA mobile number with two-way SMS,', '(Texting Number: two-way SMS in Messages,']],
}
let bad = 0
for (const [file, list] of Object.entries(R)) {
  let s = fs.readFileSync(file, 'utf8')
  for (const [a, b] of list) {
    if (!s.includes(a)) { console.log('MISS', file, a.slice(0, 80)); bad++; continue }
    s = s.split(a).join(b)
  }
  fs.writeFileSync(file, s)
}
console.log('done, misses:', bad)
