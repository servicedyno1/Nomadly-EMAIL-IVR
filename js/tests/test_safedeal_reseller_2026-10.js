// SafeDeal escrow (replaces @Lockbaybot) + Reseller 50/50 with in-page AI support — 2026-10
const fs = require('fs')
const path = require('path')
let pass = 0, fail = 0
const it = (name, ok) => { ok ? pass++ : fail++; console.log(`  ${ok ? '✅' : '❌'} ${name}`) }
const J = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8')

process.env.CHAT_BOT_BRAND = 'Voodoo Land'
const mp = require('../marketplace-service.js')
const sd = require('../mp-safedeal.js')

console.log('\n=== marketplace price range = SafeDeal range ===')
it('MIN_PRICE 30', mp.MIN_PRICE === 30)
it('MAX_PRICE 3000', mp.MAX_PRICE === 3000)
it('isEscrowPriceOk bounds', !mp.isEscrowPriceOk(29.99) && mp.isEscrowPriceOk(30) && mp.isEscrowPriceOk(3000) && !mp.isEscrowPriceOk(3000.01) && !mp.isEscrowPriceOk('x'))

console.log('\n=== scam detection ===')
const D = mp.detectPaymentPattern
it('safedeal invite link alone is allowed', !D('here is the deal https://safedeal.sh/deal/ac2f9b'))
it('"send me the link" is allowed', !D('send me the link') && !D('send me the safedeal invite'))
it('payment request with safedeal link still flagged', D('pay me directly https://safedeal.sh/deal/x'))
it('@Lockbaybot flagged', D('lets use @Lockbaybot'))
it('other escrow bot flagged', D('use @FastEscrowBot instead') && D('t.me/myescrow123'))
it('wallet send still flagged', D('send to my wallet') && D('send me $50'))
it('hasSafeDealLink', sd.hasSafeDealLink('x https://safedeal.sh/deal/1') && !sd.hasSafeDealLink('https://safe-deal.co/x'))

console.log('\n=== sendSafeDealSteps ===')
const langs = { 1: 'en', 2: 'fr' }
const state = { findOne: async ({ _id }) => ({ userLanguage: langs[_id] }) }
const { translation } = require('../translation.js')
const run = async (conv, notifySeller = true) => {
  const sent = []; let marked = 0
  const svc = { ...mp, markEscrowStarted: async () => { marked++ } }
  const ok = await sd.sendSafeDealSteps({ conv, state, translation, send: (id, text, opts) => sent.push({ id, text, opts }), marketplaceService: svc, notifySeller })
  return { ok, sent, marked }
}
;(async () => {
  const conv = { _id: 'c1', buyerId: 1, sellerId: 2, productTitle: 'Twilio acct', originalPrice: 120 }
  let r = await run(conv)
  it('starts escrow + marks it', r.ok && r.marked === 1 && r.sent.length === 2)
  const b = r.sent.find(m => m.id === 1), s = r.sent.find(m => m.id === 2)
  it('buyer gets EN buyer steps (I\'m buying, paste link, fee)', /I'm buying/.test(b.text) && /Paste the invite link here/.test(b.text) && /5% \(min \$10\)/.test(b.text) && /<code>Twilio acct<\/code>/.test(b.text) && /<code>120\.00<\/code>/.test(b.text))
  it('seller gets FR seller steps', /L'acheteur lance l'escrow SafeDeal/.test(s.text) && /Funded/.test(s.text))
  const url = (m) => m.opts.reply_markup.inline_keyboard[0][0]
  it('buttons open safedeal.sh in each language', url(b).url === sd.SAFEDEAL_START_URL && url(b).text === '🔒 Open SafeDeal' && url(s).text === '🔒 Ouvrir SafeDeal')
  it('no Lockbay in steps', !/lockbay/i.test(b.text + s.text))
  r = await run({ ...conv, originalPrice: 25 })
  it('price below $30 → out-of-range note, escrow NOT started', !r.ok && r.marked === 0 && r.sent.length === 2 && /\$30 to \$3,000/.test(r.sent[0].text))
  r = await run({ ...conv, agreedPrice: 4000 })
  it('agreed price above $3,000 → out-of-range', !r.ok && r.marked === 0)
  r = await run(conv, false)
  it('notifySeller=false → buyer only', r.ok && r.sent.length === 1 && r.sent[0].id === 1)

  console.log('\n=== copy: no Lockbay, brand title, reseller 50/50 ===')
  for (const l of ['en', 'fr', 'hi', 'zh']) {
    const src = J(`lang/${l}.js`)
    const T = require(`../lang/${l}.js`)[l].t
    it(`[${l}] no Lockbay`, !/lockbay/i.test(src))
    it(`[${l}] mpHome shows brand, not NOMADLY`, T.mpHome.includes('VOODOO LAND') && !T.mpHome.includes('NOMADLY'))
    it(`[${l}] reseller 50/50 + /done, no 65/35`, T.becomeReseller.includes('50/50') && T.becomeReseller.includes('/done') && !src.includes('65/35'))
    it(`[${l}] SafeDeal keys`, ['mpEscrowBuyer', 'mpEscrowSeller', 'mpEscrowOutOfRange', 'mpOpenSafeDeal', 'mpSafeDealLinkNote'].every(k => T[k]) && !T.mpEscrowMsg)
    it(`[${l}] price prompts $30/$3,000`, /30/.test(T.mpEnterPrice) && /3[ ,.]?000/.test(T.mpEnterPrice) && !/5[ ,.]?000/.test(T.mpPriceInvalid))
  }
  const AI = J('ai-support.js'), IDX = J('_index.js'), CFG = J('config.js')
  it('AI KB: SafeDeal + 50/50, Lockbay only as discontinued/scam', AI.includes('safedeal.sh') && AI.includes('50/50') && !AI.includes('65/35') && !/via @Lockbaybot|@Lockbaybot escrow/.test(AI))
  it('config.js reseller 50/50', CFG.includes('50/50') && !CFG.includes('65/35'))
  it('_index: no t.me/Lockbaybot buttons', !IDX.includes('t.me/Lockbaybot') && !IDX.includes('mpEscrowMsg'))

  console.log('\n=== _index wiring ===')
  const rs = IDX.slice(IDX.indexOf('if (message === user.becomeReseller) {'), IDX.indexOf('if (message === user.becomeReseller) {') + 1500)
  it('Reseller opens AI support session', rs.includes("saveInfo('action', a.supportChat)") && rs.includes('addSupportContext(') && rs.includes('Reseller enquiry') && rs.includes("['/done', '🏠 Main Menu']"))
  const ep = IDX.slice(IDX.indexOf("if (action === 'escrow_product') {"), IDX.indexOf("if (action === 'escrow_product') {") + 2500)
  it('Start Escrow from product card puts buyer in chat', ep.includes("set(state, chatId, 'action', 'mpChat')") && ep.includes('_mpNotifySeller(product, conv)') && ep.includes('sendSafeDealSteps'))
  it('/escrow in chat uses SafeDeal steps', /message === '\/escrow'[\s\S]{0,300}sendSafeDealSteps/.test(IDX))
  it('relay adds SafeDeal link note', IDX.includes('mpSafeDeal.sendSafeDealLinkNote({ toId: otherParty'))
  it('ai-support exports addSupportContext', typeof require('../ai-support.js').addSupportContext === 'function')

  console.log(`\n═══ ${pass} passed, ${fail} failed ═══`)
  process.exit(fail ? 1 : 0)
})()
