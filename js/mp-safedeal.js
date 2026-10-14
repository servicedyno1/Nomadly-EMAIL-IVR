// SafeDeal (https://safedeal.sh) web escrow — replaces the discontinued @Lockbaybot for marketplace deals.
const SAFEDEAL_START_URL = 'https://safedeal.sh/#sd-start'

const hasSafeDealLink = (text) => /https?:\/\/(?:www\.)?safedeal\.sh\b/i.test(String(text || ''))

async function tFor(state, translation, chatId) {
  const info = await state.findOne({ _id: String(chatId) })
  return translation('t', info?.userLanguage || 'en')
}

const openBtn = (T) => ({
  parse_mode: 'HTML',
  reply_markup: { inline_keyboard: [[{ text: T.mpOpenSafeDeal, url: SAFEDEAL_START_URL }]] },
})

// Sends role-specific SafeDeal steps in each party's own language. Returns false when the
// agreed price is outside SafeDeal's range (no escrow is marked as started in that case).
async function sendSafeDealSteps({ conv, state, translation, send, marketplaceService, notifySeller = true }) {
  const price = Number(conv.agreedPrice || conv.originalPrice)
  const bT = await tFor(state, translation, conv.buyerId)
  const sT = await tFor(state, translation, conv.sellerId)
  if (!marketplaceService.isEscrowPriceOk(price)) {
    send(conv.buyerId, bT.mpEscrowOutOfRange(price), { parse_mode: 'HTML' })
    if (notifySeller) send(conv.sellerId, sT.mpEscrowOutOfRange(price), { parse_mode: 'HTML' })
    return false
  }
  await marketplaceService.markEscrowStarted(conv._id)
  send(conv.buyerId, bT.mpEscrowBuyer(conv.productTitle, price), openBtn(bT))
  if (notifySeller) send(conv.sellerId, sT.mpEscrowSeller(conv.productTitle, price), openBtn(sT))
  return true
}

// Tells the receiving party that a relayed message carries a SafeDeal invite link.
async function sendSafeDealLinkNote({ toId, state, translation, send }) {
  const T = await tFor(state, translation, toId)
  send(toId, T.mpSafeDealLinkNote, { parse_mode: 'HTML', disable_web_page_preview: true })
}

module.exports = { SAFEDEAL_START_URL, hasSafeDealLink, sendSafeDealSteps, sendSafeDealLinkNote }
