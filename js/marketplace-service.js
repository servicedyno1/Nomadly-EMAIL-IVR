// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Marketplace Service — P2P product listings, chat relay, escrow
// Collections: marketplaceProducts, marketplaceConversations, marketplaceMessages,
//              marketplaceAccess (one-time entry-fee gating)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const crypto = require('crypto')
const { log } = require('console')

let _db = null
let _products = null
let _conversations = null
let _messages = null
let _bans = null
let _access = null

const CATEGORIES = ['💻 Digital Goods', '🏦 Bnk Logs', '🏧 Bnk Opening', '🔧 Tools']
// Matches SafeDeal's accepted deal range ($30 min, ~€2,999 max) so every listing can be escrowed.
const MIN_PRICE = 30
const MAX_PRICE = 3000
const MAX_LISTINGS = 10
const MAX_TITLE = 100
const MAX_DESC = 500

const MSG_RATE_LIMIT = 30 // per conversation per hour
const INACTIVITY_CLOSE_HOURS = 72

// ── One-time marketplace access fee ──────────────────────────────────────
// Charged from the user's wallet the first time they try to USE the
// marketplace (browse, list, chat). All users — existing AND new — must pay
// this once. Configurable via MARKETPLACE_ACCESS_FEE_USD (default $50).
//
// Bypass: admin chat IDs from MARKETPLACE_ACCESS_ADMIN_IDS (CSV) or the
// hardcoded TELEGRAM_ADMIN_CHAT_ID / TELEGRAM_DEV_CHAT_ID.
//
// Persistence: marketplaceAccess collection
//   _id (chatId), paid:true, paidAt, amountUsd, mode, txnId, walletBalAfter
const _parseAccessFee = () => {
  const raw = process.env.MARKETPLACE_ACCESS_FEE_USD
  if (raw === undefined || raw === null || raw === '') return 50
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`[Marketplace] Invalid MARKETPLACE_ACCESS_FEE_USD="${raw}" — falling back to default $50`)
    return 50
  }
  return n
}
const MARKETPLACE_ACCESS_FEE_USD = _parseAccessFee()
const MARKETPLACE_ACCESS_ADMIN_IDS = String(process.env.MARKETPLACE_ACCESS_ADMIN_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean)

// Payment pattern detection (anti-scam)
const PAYMENT_PATTERNS = [
  /paypal|cashapp|cash\s*app|venmo|zelle|western\s*union|moneygram/i,
  /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/,     // Bitcoin
  /\b0x[a-fA-F0-9]{40}\b/,                      // Ethereum
  /\bT[A-Za-z1-9]{33}\b/,                       // USDT/TRC20
  /send\s*(payment|money|funds)/i,
  /send\s*(to|me)\s+(?!(?:the\s+|your\s+|a\s+|my\s+)?(?:safedeal\s+)?(?:escrow\s+)?(?:link|invite|deal)\b)/i, // "send me the link" is fine
  /pay\s*(me|directly|outside|first)/i,
  /no\s*escrow/i,
  /wire\s*transfer/i,
  /lockbay/i,                                   // discontinued escrow bot — impersonation risk
  /@\w*escrow\w*/i,                             // any other "escrow" bot/handle
  /t\.me\/\w*escrow/i,
  /escrow\s*bot/i,
]
const SAFEDEAL_LINK_RE = /https?:\/\/(?:www\.)?safedeal\.sh\S*/gi

/**
 * Initialize marketplace service
 */
async function initMarketplace(db) {
  _db = db
  _products = db.collection('marketplaceProducts')
  _conversations = db.collection('marketplaceConversations')
  _messages = db.collection('marketplaceMessages')
  _bans = db.collection('marketplaceBans')
  _access = db.collection('marketplaceAccess')

  // Create indexes
  await _products.createIndex({ sellerId: 1, status: 1 })
  await _products.createIndex({ category: 1, status: 1 })
  await _products.createIndex({ status: 1, createdAt: -1 })
  await _conversations.createIndex({ buyerId: 1, status: 1 })
  await _conversations.createIndex({ sellerId: 1, status: 1 })
  await _conversations.createIndex({ productId: 1, buyerId: 1 })
  await _conversations.createIndex({ lastMessageAt: 1 })
  await _messages.createIndex({ conversationId: 1, timestamp: 1 })
  await _bans.createIndex({ oduserId: 1 }, { unique: true })
  await _access.createIndex({ paidAt: -1 })

  log(`[Marketplace] Initialized (access fee: $${MARKETPLACE_ACCESS_FEE_USD})`)
}

// ── One-time access fee gating ───────────────────────────────────────────

function _isAccessAdmin(chatId) {
  const id = String(chatId)
  if (id === String(process.env.TELEGRAM_ADMIN_CHAT_ID || '')) return true
  if (id === String(process.env.TELEGRAM_DEV_CHAT_ID || '')) return true
  if (MARKETPLACE_ACCESS_ADMIN_IDS.includes(id)) return true
  return false
}

/**
 * Returns the access doc if the user has paid (or is admin), null otherwise.
 * Admins are auto-granted a virtual access doc (mode: 'admin') for symmetry —
 * downstream code can treat the return value uniformly.
 */
async function hasMarketplaceAccess(chatId) {
  if (!_access) return null
  if (_isAccessAdmin(chatId)) {
    return { _id: chatId, paid: true, mode: 'admin', amountUsd: 0 }
  }
  const numId = Number(chatId)
  const strId = String(chatId)
  // chatId is stored as both number and string across the bot — match both
  const doc = await _access.findOne({ _id: { $in: [numId, strId] }, paid: true })
  return doc || null
}

/**
 * Mark the user as having paid the one-time marketplace access fee. Idempotent:
 * if a paid doc already exists, returns the existing doc unchanged.
 *
 * @param {number|string} chatId
 * @param {Object} opts
 * @param {number} opts.amountUsd     amount actually charged ($)
 * @param {string} opts.mode          'wallet' | 'admin_grant' | 'grandfathered'
 * @param {string} opts.txnId         transaction reference (for ledger lookup)
 * @param {number} [opts.walletBalAfter]  wallet balance after the deduction
 */
async function grantMarketplaceAccess(chatId, opts = {}) {
  if (!_access) throw new Error('marketplaceAccess collection not initialised')
  const numId = Number(chatId)
  const id = Number.isFinite(numId) && String(numId) === String(chatId) ? numId : String(chatId)
  const existing = await _access.findOne({ _id: { $in: [Number(chatId), String(chatId)] }, paid: true })
  if (existing) {
    log(`[Marketplace] grantMarketplaceAccess: ${chatId} already paid (mode=${existing.mode}, paidAt=${existing.paidAt})`)
    return existing
  }
  const doc = {
    _id: id,
    paid: true,
    paidAt: new Date(),
    amountUsd: Number(opts.amountUsd || 0),
    mode: opts.mode || 'wallet',
    txnId: opts.txnId || null,
    walletBalAfter: typeof opts.walletBalAfter === 'number' ? opts.walletBalAfter : null,
  }
  await _access.updateOne({ _id: id }, { $set: doc }, { upsert: true })
  log(`[Marketplace] GRANTED access to ${chatId} (mode=${doc.mode}, $${doc.amountUsd})`)
  return doc
}

/**
 * Admin tool: revoke marketplace access (e.g., after refund). User will be
 * gated again on next entry.
 */
async function revokeMarketplaceAccess(chatId) {
  if (!_access) return { revoked: false }
  const result = await _access.deleteOne({ _id: { $in: [Number(chatId), String(chatId)] } })
  log(`[Marketplace] REVOKED access for ${chatId} — deleted=${result.deletedCount}`)
  return { revoked: result.deletedCount > 0 }
}

// ── Product CRUD ──

async function createProduct({ sellerId, sellerUsername, title, description, price, category, images }) {
  const product = {
    _id: crypto.randomUUID(),
    sellerId,
    sellerUsername: sellerUsername || 'anonymous',
    title: (title || '').slice(0, MAX_TITLE),
    description: (description || '').slice(0, MAX_DESC),
    price: Number(price),
    currency: 'USD',
    category,
    images: images || [],
    status: 'active',
    views: 0,
    inquiries: 0,
    escrowsStarted: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await _products.insertOne(product)
  log(`[Marketplace] Product created: ${product._id} by ${sellerId}`)
  return product
}

async function getProduct(productId) {
  return _products.findOne({ _id: productId })
}

async function updateProduct(productId, updates) {
  updates.updatedAt = new Date().toISOString()
  await _products.updateOne({ _id: productId }, { $set: updates })
  return _products.findOne({ _id: productId })
}

async function deleteProduct(productId) {
  await _products.updateOne({ _id: productId }, { $set: { status: 'removed', updatedAt: new Date().toISOString() } })
}

async function markProductSold(productId) {
  await _products.updateOne({ _id: productId }, { $set: { status: 'sold', updatedAt: new Date().toISOString() } })
}

async function getUserProducts(sellerId) {
  return _products.find({ sellerId, status: { $in: ['active', 'sold'] } }).sort({ createdAt: -1 }).toArray()
}

async function getActiveProductCount(sellerId) {
  return _products.countDocuments({ sellerId, status: 'active' })
}

async function browseProducts({ category, page = 0, limit = 5 }) {
  const filter = { status: 'active' }
  if (category && category !== 'all') filter.category = category
  const total = await _products.countDocuments(filter)
  const products = await _products.find(filter).sort({ createdAt: -1 }).skip(page * limit).limit(limit).toArray()
  return { products, total, page, totalPages: Math.ceil(total / limit) }
}

async function incrementProductViews(productId) {
  await _products.updateOne({ _id: productId }, { $inc: { views: 1 } })
}

async function incrementProductInquiries(productId) {
  await _products.updateOne({ _id: productId }, { $inc: { inquiries: 1 } })
}

async function incrementProductEscrows(productId) {
  await _products.updateOne({ _id: productId }, { $inc: { escrowsStarted: 1 } })
}

// ── Conversation CRUD ──

async function createConversation({ productId, productTitle, originalPrice, buyerId, sellerId }) {
  const conv = {
    _id: crypto.randomUUID(),
    productId,
    productTitle: productTitle || '',
    originalPrice: Number(originalPrice) || 0,
    agreedPrice: Number(originalPrice) || 0,
    buyerId,
    sellerId,
    status: 'active',
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    messageCount: 0,
    escrowStartedAt: null,
  }
  await _conversations.insertOne(conv)
  await incrementProductInquiries(productId)
  log(`[Marketplace] Conversation created: ${conv._id} (buyer: ${buyerId}, seller: ${sellerId})`)
  return conv
}

async function getConversation(conversationId) {
  return _conversations.findOne({ _id: conversationId })
}

async function findConversation(productId, buyerId) {
  return _conversations.findOne({ productId, buyerId, status: { $in: ['active', 'escrow_started'] } })
}

async function getUserConversations(userId) {
  return _conversations.find({
    $or: [{ buyerId: userId }, { sellerId: userId }],
    status: { $in: ['active', 'escrow_started'] },
  }).sort({ lastMessageAt: -1 }).toArray()
}

async function updateConversation(conversationId, updates) {
  await _conversations.updateOne({ _id: conversationId }, { $set: updates })
  return _conversations.findOne({ _id: conversationId })
}

async function closeConversation(conversationId) {
  await _conversations.updateOne({ _id: conversationId }, { $set: { status: 'closed', closedAt: new Date().toISOString() } })
}

async function markEscrowStarted(conversationId) {
  await _conversations.updateOne({ _id: conversationId }, {
    $set: { status: 'escrow_started', escrowStartedAt: new Date().toISOString() }
  })
  const conv = await getConversation(conversationId)
  if (conv) await incrementProductEscrows(conv.productId)
  return conv
}

// ── Messages ──

async function addMessage({ conversationId, senderId, senderRole, text, type = 'text' }) {
  const msg = {
    _id: crypto.randomUUID(),
    conversationId,
    senderId,
    senderRole,
    type,
    text: text || '',
    timestamp: new Date().toISOString(),
  }
  await _messages.insertOne(msg)
  await _conversations.updateOne({ _id: conversationId }, {
    $set: { lastMessageAt: msg.timestamp },
    $inc: { messageCount: 1 },
  })
  return msg
}

async function getRecentMessageCount(conversationId, withinHours = 1) {
  const since = new Date(Date.now() - withinHours * 60 * 60 * 1000).toISOString()
  return _messages.countDocuments({ conversationId, timestamp: { $gte: since } })
}

// ── Anti-Scam ──

// SafeDeal (safedeal.sh) invite links are the sanctioned escrow — strip them before scanning.
function detectPaymentPattern(text) {
  if (!text || typeof text !== 'string') return false
  const scan = text.replace(SAFEDEAL_LINK_RE, ' ')
  return PAYMENT_PATTERNS.some(pattern => pattern.test(scan))
}

function isEscrowPriceOk(price) {
  const n = Number(price)
  return Number.isFinite(n) && n >= MIN_PRICE && n <= MAX_PRICE
}

// ── Auto-close stale conversations ──

async function closeStaleConversations() {
  const cutoff = new Date(Date.now() - INACTIVITY_CLOSE_HOURS * 60 * 60 * 1000).toISOString()
  const stale = await _conversations.find({
    status: 'active',
    lastMessageAt: { $lt: cutoff },
  }).toArray()
  for (const conv of stale) {
    await closeConversation(conv._id)
  }
  return stale
}

// ── Seller stats ──

async function getSellerStats(sellerId) {
  const sold = await _products.countDocuments({ sellerId, status: 'sold' })
  const firstProduct = await _products.findOne({ sellerId }, { sort: { createdAt: 1 }, projection: { createdAt: 1 } })
  return {
    salesCount: sold,
    memberSince: firstProduct?.createdAt || new Date().toISOString(),
  }
}

// ── Marketplace Ban/Unban ──

async function banUser(userId, reason, bannedBy) {
  const uid = String(userId)
  const numUid = Number(userId)
  // Remove all active/sold listings (handle both string and number sellerId)
  const result = await _products.updateMany(
    { sellerId: { $in: [uid, numUid] }, status: { $in: ['active', 'sold'] } },
    { $set: { status: 'admin_removed', removedAt: new Date().toISOString(), removedReason: reason || 'marketplace_ban' } }
  )
  // Close all active conversations where this user is seller or buyer
  await _conversations.updateMany(
    { $or: [{ sellerId: { $in: [uid, numUid] } }, { buyerId: { $in: [uid, numUid] } }], status: { $in: ['active', 'escrow_started'] } },
    { $set: { status: 'closed', closedAt: new Date().toISOString() } }
  )
  // Insert/update ban record
  await _bans.updateOne(
    { userId: uid },
    { $set: { userId: uid, reason: reason || 'admin_ban', bannedBy: String(bannedBy), bannedAt: new Date().toISOString() } },
    { upsert: true }
  )
  log(`[Marketplace] BANNED user ${uid} — ${result.modifiedCount} listings removed, reason: ${reason || 'admin_ban'}`)
  return { listingsRemoved: result.modifiedCount }
}

async function unbanUser(userId) {
  const uid = String(userId)
  const result = await _bans.deleteOne({ userId: uid })
  log(`[Marketplace] UNBANNED user ${uid} — deleted: ${result.deletedCount}`)
  return { unbanned: result.deletedCount > 0 }
}

async function isUserBanned(userId) {
  if (!_bans) return false
  const ban = await _bans.findOne({ userId: { $in: [String(userId), Number(userId)] } })
  return ban ? ban : null
}

module.exports = {
  initMarketplace,
  // Products
  createProduct,
  getProduct,
  updateProduct,
  deleteProduct,
  markProductSold,
  getUserProducts,
  getActiveProductCount,
  browseProducts,
  incrementProductViews,
  // Conversations
  createConversation,
  getConversation,
  findConversation,
  getUserConversations,
  updateConversation,
  closeConversation,
  markEscrowStarted,
  // Messages
  addMessage,
  getRecentMessageCount,
  // Anti-scam
  detectPaymentPattern,
  isEscrowPriceOk,
  // Maintenance
  closeStaleConversations,
  getSellerStats,
  // Bans
  banUser,
  unbanUser,
  isUserBanned,
  // Access fee
  hasMarketplaceAccess,
  grantMarketplaceAccess,
  revokeMarketplaceAccess,
  // Constants
  CATEGORIES,
  MIN_PRICE,
  MAX_PRICE,
  MAX_LISTINGS,
  MAX_TITLE,
  MAX_DESC,
  
  MSG_RATE_LIMIT,
  
  MARKETPLACE_ACCESS_FEE_USD,
}
