"""_index.js: SafeDeal escrow wiring + Reseller opens AI support. Idempotent-checked string patches."""
import sys

p = sys.argv[1] if len(sys.argv) > 1 else '/app/js/_index.js'
s = open(p).read()

R = []

# 1) imports
R.append(("const marketplaceService = require('./marketplace-service.js')\n",
          "const marketplaceService = require('./marketplace-service.js')\nconst mpSafeDeal = require('./mp-safedeal.js')\n"))
R.append(("clearHistory: clearAiHistory, isAiEnabled,", "clearHistory: clearAiHistory, addSupportContext, isAiEnabled,"))

# 2) seller-notify helper (shared by mp:chat and mp:escrow_product)
R.append(("""    const parts = data.split(':')
    const action = parts[1]
""", """    const parts = data.split(':')
    const action = parts[1]

    // Tells the seller a buyer opened a chat. Returns false when the seller hasn't paid the
    // one-time seller fee (they only get a locked alert and can't reply yet).
    const _mpNotifySeller = async (product, conv) => {
      // The buyer's identity is NEVER included in these alerts —
      // sellers only ever see product context, not the buyer's @username.
      const sellerInfo = await state.findOne({ _id: String(product.sellerId) })
      const sellerLang = sellerInfo?.userLanguage || 'en'
      const sellerT = translation('t', sellerLang)
      const sellerAction = sellerInfo?.action || 'none'
      const sellerIsIdle = sellerAction === 'none' || sellerAction === 'mpHome'

      // SELLER FEE GATE — if the seller has NOT paid the one-time $50 fee, they
      // get an ALERT that a buyer is interested, but CANNOT reply or see the
      // buyer until they pay. Tapping the button routes them into the paywall
      // (mp:reply detects no-access and shows the reply-keyboard payment menu).
      const sellerHasAccess = await marketplaceService.hasMarketplaceAccess(product.sellerId)
      if (!sellerHasAccess) {
        const sfee = marketplaceService.MARKETPLACE_ACCESS_FEE_USD
        const lockedMsg = ({
          en: `🔔 <b>New buyer interested in “${product.title}”!</b>\\n\\nA buyer wants to chat about your listing. 🔒 To reply and see the buyer's details, pay the one-time <b>$${sfee}</b> seller fee.`,
          fr: `🔔 <b>Un acheteur s'intéresse à « ${product.title} » !</b>\\n\\nUn acheteur veut discuter de votre annonce. 🔒 Pour répondre et voir les détails de l'acheteur, payez les frais vendeur uniques de <b>$${sfee}</b>.`,
          zh: `🔔 <b>有买家对“${product.title}”感兴趣！</b>\\n\\n一位买家想咨询您的商品。🔒 支付一次性 <b>$${sfee}</b> 卖家费后即可回复并查看买家信息。`,
          hi: `🔔 <b>“${product.title}” में एक खरीदार की रुचि है!</b>\\n\\nएक खरीदार आपकी लिस्टिंग पर बात करना चाहता है। 🔒 जवाब देने और खरीदार की जानकारी देखने के लिए एक-बार का <b>$${sfee}</b> विक्रेता शुल्क भरें।`,
        }[sellerLang] || `🔔 <b>New buyer interested in “${product.title}”!</b>\\n\\nA buyer wants to chat about your listing. 🔒 To reply and see the buyer's details, pay the one-time <b>$${sfee}</b> seller fee.`)
        const lockedBtns = {
          reply_markup: { inline_keyboard: [[{ text: `🔓 Pay $${sfee} to reply`, callback_data: `mp:reply:${conv._id}` }]] },
          parse_mode: 'HTML',
        }
        sendMsg(product.sellerId, lockedMsg, lockedBtns)
        log(`[Marketplace] Seller ${product.sellerId} has NO seller access — sent locked buyer-interest alert (conv ${conv._id})`)
        return false
      }

      if (sellerIsIdle) {
        // Seller is idle — safe to auto-set into chat mode
        await set(state, String(product.sellerId), 'mpActiveConversation', conv._id)
        await set(state, String(product.sellerId), 'action', 'mpChat')
        const sellerBtns = {
          reply_markup: { inline_keyboard: [[{ text: '🔒 Start Escrow', callback_data: `mp:escrow:${conv._id}` }]] },
          parse_mode: 'HTML',
        }
        sendMsg(product.sellerId, sellerT.mpChatStartSeller(product.title) + '\\n\\n' + sellerT.mpSellerChatReady(product.title), sellerBtns)
      } else {
        // Seller is busy in another flow — don't hijack, just notify with reply button
        const sellerBtns = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💬 Reply', callback_data: `mp:reply:${conv._id}` }],
              [{ text: '🔒 Start Escrow', callback_data: `mp:escrow:${conv._id}` }],
            ]
          },
          parse_mode: 'HTML',
        }
        sendMsg(product.sellerId, sellerT.mpSellerBusy(product.title), sellerBtns)
        log(`[Marketplace] Seller ${product.sellerId} busy (action=${sellerAction}), sent notification instead of auto-chat`)
      }
      return true
    }
"""))

# 3) mp:chat now uses the helper (old inline block removed)
a = s.index("      // Notify seller. The buyer's identity is NEVER included in these alerts —")
b = s.index("    // mp:reply:convId — seller enters chat mode to reply")
old_block = s[a:b]
assert 'sellerT.mpSellerBusy' in old_block and old_block.rstrip().endswith('}'), old_block[-80:]
R.append((old_block, "      await _mpNotifySeller(product, conv)\n      return\n    }\n\n"))

# 4) callback escrow handlers → SafeDeal
R.append(("""      const conv = await marketplaceService.getConversation(convId)
      if (!conv) return
      await marketplaceService.markEscrowStarted(convId)
      const product = await marketplaceService.getProduct(conv.productId)
      const sellerRef = product?.sellerUsername && product.sellerUsername !== 'anonymous' ? `@${product.sellerUsername}` : `Seller#${String(conv.sellerId).slice(-4)}`
      const price = conv.agreedPrice || conv.originalPrice
      const escrowMsg = t.mpEscrowMsg(conv.productTitle, price, sellerRef)
      const escrowOpts = { reply_markup: { inline_keyboard: [[{ text: '🔒 Open @Lockbaybot', url: 'https://t.me/Lockbaybot' }]] } }
      sendMsg(conv.buyerId, escrowMsg, escrowOpts)
      sendMsg(conv.sellerId, escrowMsg, escrowOpts)
      if (TELEGRAM_ADMIN_CHAT_ID) sendMsg(TELEGRAM_ADMIN_CHAT_ID, `🔒 [Marketplace] Escrow started""",
"""      const conv = await marketplaceService.getConversation(convId)
      if (!conv) return
      const price = conv.agreedPrice || conv.originalPrice
      const started = await mpSafeDeal.sendSafeDealSteps({ conv, state, translation, send: sendMsg, marketplaceService })
      if (started && TELEGRAM_ADMIN_CHAT_ID) sendMsg(TELEGRAM_ADMIN_CHAT_ID, `🔒 [Marketplace] SafeDeal escrow started"""))

R.append(("""      // Find or create conversation
      let conv = await marketplaceService.findConversation(productId, chatId)
      if (!conv) {
        conv = await marketplaceService.createConversation({
          productId,
          productTitle: product.title,
          originalPrice: product.price,
          buyerId: chatId,
          sellerId: product.sellerId,
        })
      }

      // Start escrow
      await marketplaceService.markEscrowStarted(conv._id)
      const sellerRef = product.sellerUsername && product.sellerUsername !== 'anonymous' ? `@${product.sellerUsername}` : `Seller#${String(conv.sellerId).slice(-4)}`
      const price = conv.agreedPrice || conv.originalPrice
      const escrowMsg = t.mpEscrowMsg(conv.productTitle, price, sellerRef)
      const escrowOpts = { reply_markup: { inline_keyboard: [[{ text: '🔒 Open @Lockbaybot', url: 'https://t.me/Lockbaybot' }]] } }
      sendMsg(conv.buyerId, escrowMsg, escrowOpts)
      sendMsg(conv.sellerId, escrowMsg, escrowOpts)
      if (TELEGRAM_ADMIN_CHAT_ID) sendMsg(TELEGRAM_ADMIN_CHAT_ID, `🔒 [Marketplace] Direct escrow started""",
"""      // Find or create conversation
      let conv = await marketplaceService.findConversation(productId, chatId)
      const isNewConv = !conv
      if (isNewConv) {
        conv = await marketplaceService.createConversation({
          productId,
          productTitle: product.title,
          originalPrice: product.price,
          buyerId: chatId,
          sellerId: product.sellerId,
        })
      }

      // Put the buyer in the chat so they can paste the SafeDeal invite link right away
      await set(state, chatId, 'mpActiveConversation', conv._id)
      await set(state, chatId, 'action', 'mpChat')
      const price = conv.agreedPrice || conv.originalPrice
      await sendMsg(chatId, t.mpEnteredChat(conv.productTitle, price))
      const sellerCanReply = isNewConv ? await _mpNotifySeller(product, conv) : true
      const started = await mpSafeDeal.sendSafeDealSteps({ conv, state, translation, send: sendMsg, marketplaceService, notifySeller: sellerCanReply })
      if (started && TELEGRAM_ADMIN_CHAT_ID) sendMsg(TELEGRAM_ADMIN_CHAT_ID, `🔒 [Marketplace] Direct SafeDeal escrow started"""))

# 5) /escrow inside the chat
R.append(("""      if (!conv) return goto.marketplace()
      await marketplaceService.markEscrowStarted(convId)
      const product = await marketplaceService.getProduct(conv.productId)
      const sellerRef = product?.sellerUsername && product.sellerUsername !== 'anonymous' ? `@${product.sellerUsername}` : `Seller#${String(conv.sellerId).slice(-4)}`
      const price = conv.agreedPrice || conv.originalPrice
      const escrowMsg = t.mpEscrowMsg(conv.productTitle, price, sellerRef)
      const escrowOpts = { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔒 Open @Lockbaybot', url: 'https://t.me/Lockbaybot' }]] } }
      send(conv.buyerId, escrowMsg, escrowOpts)
      send(conv.sellerId, escrowMsg, escrowOpts)
      if (TELEGRAM_ADMIN_CHAT_ID) send(TELEGRAM_ADMIN_CHAT_ID, `🔒 [Marketplace] Escrow started""",
"""      if (!conv) return goto.marketplace()
      const price = conv.agreedPrice || conv.originalPrice
      const started = await mpSafeDeal.sendSafeDealSteps({ conv, state, translation, send, marketplaceService })
      if (started && TELEGRAM_ADMIN_CHAT_ID) send(TELEGRAM_ADMIN_CHAT_ID, `🔒 [Marketplace] SafeDeal escrow started"""))

# 6) AI moderation ignores sanctioned safedeal.sh links
R.append(("""    } else if (isAiEnabled() && message.length > 15) {
      // AI-powered scam moderation for longer messages that bypass regex
      moderateMarketplaceChat(message).then(async (result) => {""",
"""    } else if (isAiEnabled() && message.replace(/https?:\\/\\/(?:www\\.)?safedeal\\.sh\\S*/gi, '').trim().length > 15) {
      // AI-powered scam moderation for longer messages that bypass regex (SafeDeal links are the sanctioned escrow)
      moderateMarketplaceChat(message).then(async (result) => {"""))

# 7) relay: explain SafeDeal invite links to the receiving party
R.append(("""    send(otherParty, relayMsg, { parse_mode: 'HTML' })
    // Confirm to sender that message was delivered
    send(chatId, t.mpMessageSent, { parse_mode: 'HTML' })
    return""",
"""    await send(otherParty, relayMsg, { parse_mode: 'HTML' })
    if (mpSafeDeal.hasSafeDealLink(message)) mpSafeDeal.sendSafeDealLinkNote({ toId: otherParty, state, translation, send })
    // Confirm to sender that message was delivered
    send(chatId, t.mpMessageSent, { parse_mode: 'HTML' })
    return"""))

# 8) Reseller opens an AI support session with reseller context
R.append(("""  if (message === user.becomeReseller) {
    return send(chatId, t.becomeReseller)
  }""",
"""  if (message === user.becomeReseller) {
    await set(supportSessions, chatId, Date.now())
    await saveInfo('action', a.supportChat)
    await set(state, chatId, 'adminTakeover', false)
    // Seed the AI with what the user just saw so its first answer is about reselling (50/50 split).
    await addSupportContext(chatId, `[User opened the 💼 Reseller page] ${t.becomeReseller.replace(/<[^>]+>/g, '')}`)
    send(chatId, t.becomeReseller, { parse_mode: 'HTML', reply_markup: { keyboard: [['/done', '🏠 Main Menu']], resize_keyboard: true } })
    const name = await get(nameOf, chatId)
    const userTag = name ? `@${name}` : (msg?.from?.username ? `@${msg.from.username}` : 'unknown')
    send(TELEGRAM_ADMIN_CHAT_ID, `💼 <b>Reseller enquiry</b> — support session opened\\nUser: <b>${userTag}</b> (${chatId})\\n\\n🤖 <i>AI will answer reseller questions first (50/50 profit share). You'll be notified if escalation is needed.</i>\\n\\nReply with: /reply ${chatId} <i>your message</i>\\nClose with: /close ${chatId}`, adminMsgOpts({ chatId, supportSession: true }))
    log(`[Support] Reseller enquiry session opened for ${chatId} ${name}`)
    scheduleSupportSlaNudge(chatId, name || msg?.from?.username || 'unknown', Date.now())
    return
  }"""))

for a, b in R:
    assert s.count(a) == 1, ('anchor count', s.count(a), a[:90])
    s = s.replace(a, b)
assert 'Lockbaybot' not in s.replace('Lockbay Market', '')
open(p, 'w').write(s)
print('patched', p)
