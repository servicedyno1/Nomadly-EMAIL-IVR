'use strict'
// Admin: move a Telegram bot user's Cloud IVR plan (numbers + their extra numbers) into a CloudIVR web account.
// Only the Nomadly bot today (same database); the other bots run on separate systems.
const notify = require('./notify')

const BOTS = [
  { key: 'nomadly', name: 'Nomadly bot', ready: true },
  { key: 'wl', name: 'WL bot (@smadavv_bot)', ready: false },
  { key: 'voodoo', name: 'Voodoo bot (@Voodoo_landbot)', ready: false },
  { key: 'proshop', name: 'ProShop bot (@ProshopHQ_bot)', ready: false },
]
const LIVE = ['active', 'suspended']
const bad = (res, status, error, message) => res.status(status).json({ error, message })
const view = (n) => ({ phoneNumber: n.phoneNumber, status: n.status, plan: n.plan || null, provider: n.provider || null, expiresAt: n.expiresAt || null, isSubNumber: !!n.isSubNumber, parentNumber: n.parentNumber || null })

function createAdminMove(db, { log = console.log, adminAuth, sendBot = null }) {
  const nums = db.collection('phoneNumbersOf'), moves = db.collection('planMoves')

  async function find(botKey, username, email) {
    const bot = BOTS.find(b => b.key === botKey)
    if (!bot) return { error: [400, 'unknown_bot', 'Pick a bot.'] }
    if (!bot.ready) return { error: [400, 'bot_not_ready', `${bot.name} runs on its own system — moving its users is coming later.`] }
    const uname = String(username || '').trim().replace(/^@/, '')
    if (!uname) return { error: [400, 'username_required', 'Enter the Telegram username.'] }
    const ref = await db.collection('chatIdOf').findOne({ _id: uname }) || await db.collection('chatIdOf').findOne({ _id: uname.toLowerCase() })
    if (!ref?.val) return { error: [404, 'user_not_found', `No ${bot.name} user @${uname}.`] }
    const acc = await db.collection('webAccounts').findOne({ email: String(email || '').trim().toLowerCase() })
    if (!acc) return { error: [404, 'web_not_found', `No CloudIVR web account with ${email || 'that email'}.`] }
    const from = String(ref.val), to = String(acc._id)
    if (from === to) return { error: [400, 'same_account', 'That Telegram user is already this web account.'] }
    const fromNums = ((await nums.findOne({ _id: from }))?.val?.numbers || []).filter(n => LIVE.includes(n.status))
    const toNums = ((await nums.findOne({ _id: to }))?.val?.numbers || []).filter(n => LIVE.includes(n.status))
    const w = async (id) => { const x = await db.collection('walletOf').findOne({ _id: id }); return x ? +((x.usdIn || 0) - (x.usdOut || 0)).toFixed(2) : 0 }
    return { bot, username: uname, from, to, email: acc.email, fromNums, toNums, fromWallet: await w(from), toWallet: await w(to) }
  }

  async function move(f, phones, by) {
    const want = new Set(phones)
    const doc = await nums.findOne({ _id: f.from })
    const all = doc?.val?.numbers || []
    // The chosen numbers plus their extra (sub) numbers, which belong to the same plan.
    const moving = all.filter(n => LIVE.includes(n.status) && (want.has(n.phoneNumber) || want.has(n.parentNumber)))
    if (!moving.length) return { error: [400, 'nothing_to_move', 'None of those numbers are active on that bot account.'] }
    const at = new Date()
    const taken = new Set(((await nums.findOne({ _id: f.to }))?.val?.numbers || []).map(n => n.phoneNumber))
    const fresh = moving.filter(n => !taken.has(n.phoneNumber)).map(n => ({ ...n, movedFrom: { chatId: f.from, bot: f.bot.key, username: f.username, at } }))
    const moveId = `mv_${at.getTime()}_${f.from}`
    await moves.insertOne({ _id: moveId, bot: f.bot.key, username: f.username, from: f.from, to: f.to, email: f.email, numbers: moving.map(n => n.phoneNumber), snapshot: moving, by, at })
    await nums.updateOne({ _id: f.to }, { $push: { 'val.numbers': { $each: fresh } } }, { upsert: true })
    await nums.updateOne({ _id: f.from }, { $pull: { 'val.numbers': { phoneNumber: { $in: moving.map(n => n.phoneNumber) } } } })
    await db.collection('sipPresence').updateMany({ chatId: { $in: [f.from, Number(f.from)] }, phoneNumber: { $in: moving.map(n => n.phoneNumber) } }, { $set: { chatId: f.to } }).catch(() => {})
    const list = moving.map(n => n.phoneNumber).join(', ')
    log(`[PlanMove] ${by}: @${f.username} (${f.from}) → ${f.email} (${f.to}): ${list}`)
    notify.push(f.to, `📦 Your Cloud IVR plan (${list}) moved here from the Telegram bot. Settings, SIP login and renewal date stay the same — calls and renewals now use this web wallet.`, null, { kind: 'number' }).catch(() => {})
    if (sendBot) sendBot(f.from, `📦 Your Cloud IVR plan <b>${list}</b> moved to your CloudIVR web account <b>${f.email}</b>.\nSign in at cloudivr.net to manage it — settings, SIP login and renewal date stay the same. Calls and renewals now use your web wallet; your bot wallet balance stays here.`).catch(() => {})
    return { moveId, moved: moving.map(view) }
  }

  function routes(r, h) {
    const A = adminAuth.require
    r.get('/admin/plan-move/bots', A, h(async (req, res) => res.json({ bots: BOTS })))
    r.get('/admin/plan-move/lookup', A, h(async (req, res) => {
      const f = await find(req.query.bot, req.query.username, req.query.email)
      if (f.error) return bad(res, ...f.error)
      res.json({ bot: f.bot, username: f.username, botChatId: f.from, webAccountId: f.to, email: f.email, botNumbers: f.fromNums.map(view), webNumbers: f.toNums.map(view), botWallet: f.fromWallet, webWallet: f.toWallet })
    }))
    r.post('/admin/plan-move', A, h(async (req, res) => {
      const b = req.body || {}
      const f = await find(b.bot, b.username, b.email)
      if (f.error) return bad(res, ...f.error)
      const phones = (Array.isArray(b.numbers) ? b.numbers : []).map(String)
      if (!phones.length) return bad(res, 400, 'pick_numbers', 'Pick at least one number to move.')
      const out = await move(f, phones, req.admin?.email || 'admin')
      if (out.error) return bad(res, ...out.error)
      res.json(out)
    }))
    r.get('/admin/plan-move/history', A, h(async (req, res) => res.json({ items: (await moves.find({}, { projection: { snapshot: 0 } }).sort({ at: -1 }).limit(30).toArray()) })))
  }
  return { routes, find, move, BOTS }
}

module.exports = { createAdminMove }
