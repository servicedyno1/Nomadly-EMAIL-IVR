'use strict'
// One-click apps (WordPress) shared by the reseller API (/hosting/:user/apps) and the HostPanel Apps tab.
// State lives in `hostingApps`; installs run in the background (installing → ready | failed).
// One live app per (account, path) is enforced by a unique sparse `liveKey`.
const wpInstaller = require('./wordpress-installer')
const cpanelAuth = require('./cpanel-auth')
const activity = require('./reseller-activity')

const COLLECTION = 'hostingApps'
const CATALOG = [{ app: 'wordpress', name: 'WordPress', requires: 'mysql', description: 'The latest WordPress with its own MySQL database, a generated admin login and pretty permalinks.' }]
const STALE_INSTALL_MS = 30 * 60000
const _indexed = new WeakSet()

class AppRequestError extends Error {
  constructor(status, code, message, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra }
}

const iso = (d) => (d ? new Date(d).toISOString() : null)
const liveKeyOf = (username, path) => `${username}|${path || ''}`

// Validate the install body → { app, path, adminEmail, title }.
function parseInstallBody(body = {}) {
  const app = String(body.app || 'wordpress').toLowerCase()
  if (app !== 'wordpress') throw new AppRequestError(400, 'invalid_app', 'Only "wordpress" is available right now.')
  const rawPath = body.path == null ? '' : String(body.path)
  const path = wpInstaller.normPath(rawPath)
  if (path.length > 64) throw new AppRequestError(400, 'invalid_path', 'path is at most 64 characters.')
  if (path && (!/^[a-z0-9][a-z0-9/_-]*$/i.test(path) || /\/\//.test(path) || path.split('/').some((s) => s === '..' || s === 'cgi-bin' || s.startsWith('.')))) {
    throw new AppRequestError(400, 'invalid_path', 'path may contain letters, numbers, -, _ and / only (e.g. "blog").')
  }
  const adminEmail = body.admin_email ? String(body.admin_email).trim().slice(0, 120) : null
  if (adminEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) throw new AppRequestError(400, 'invalid_email', 'admin_email is not a valid email address.')
  const title = body.title ? String(body.title).trim().slice(0, 120) : null
  return { app, path, adminEmail, title }
}

function createHostingApps({ getDb, cp, antiRed, log = () => {}, installer }) {
  const col = () => {
    const db = getDb()
    if (!db) throw new Error('Database not ready')
    if (!_indexed.has(db)) {
      _indexed.add(db)
      db.collection(COLLECTION).createIndex({ liveKey: 1 }, { unique: true, sparse: true }).catch(() => _indexed.delete(db))
      db.collection(COLLECTION).createIndex({ username: 1, createdAt: -1 }).catch(() => {})
    }
    return db.collection(COLLECTION)
  }
  const wpi = installer || wpInstaller.makeInstaller({ cp, antiRed, log })

  function emit(acct, event, payload) {
    try { require('./reseller-webhooks').emit(getDb(), { chatId: acct.chatId, event, instanceId: acct._id, payload, log }).catch(() => {}) } catch (_) { /* best-effort */ }
  }
  // API-initiated starts/resets are logged by the reseller apiRecorder; completions are logged here.
  function record(acct, action, actor, details) {
    activity.record(getDb(), { ownerChatId: acct.chatId, resourceType: 'hosting', resourceId: acct._id, action, actor, details })
  }

  async function ctxFor(acct) {
    let cpPass = acct.cpPass || acct.password || null
    if (!cpPass && acct.cpPass_encrypted && acct.cpPass_iv && acct.cpPass_tag) {
      try { cpPass = cpanelAuth.decrypt({ encrypted: acct.cpPass_encrypted, iv: acct.cpPass_iv, tag: acct.cpPass_tag }) } catch (_) { cpPass = null }
    }
    let priorBypass = false
    try {
      const rd = await getDb().collection('registeredDomains').findOne({ _id: String(acct.domain || '').toLowerCase() }, { projection: { 'val.visitorCaptchaOff': 1 } })
      priorBypass = !!(rd && rd.val && rd.val.visitorCaptchaOff === true)
    } catch (_) { /* best-effort */ }
    return { cpUser: acct.cpUser || acct._id, cpPass, whmHost: acct.whmHost || null, domain: acct.domain || null, priorBypass }
  }

  function view(doc, { withSecret = false } = {}) {
    let adminPassword
    if (withSecret && doc.adminPassEnc) { try { adminPassword = cpanelAuth.decrypt(doc.adminPassEnc) } catch (_) { adminPassword = null } }
    return {
      id: doc._id, app: doc.app, state: doc.state, stage: doc.stage || null,
      username: doc.username, domain: doc.domain || null, path: doc.path || '',
      site_url: doc.siteUrl || null, admin_url: doc.adminUrl || null,
      admin_user: doc.adminUser || null, admin_email: doc.adminEmail || null, title: doc.title || null,
      version: doc.version || null, db_name: doc.dbName || null, db_user: doc.dbUser || null,
      created_at: iso(doc.createdAt), installed_at: iso(doc.installedAt), failed_at: iso(doc.failedAt),
      admin_password_reset_at: iso(doc.adminPassResetAt),
      error: doc.state === 'failed' ? (doc.error || 'install_failed') : null,
      ...(adminPassword !== undefined ? { admin_password: adminPassword } : {}),
    }
  }

  async function list(acct) {
    const docs = await col().find({ username: acct._id }).sort({ createdAt: -1 }).limit(100).toArray()
    return docs.map((d) => view(d))
  }

  async function getDoc(acct, appId) {
    const doc = await col().findOne({ _id: String(appId), username: acct._id })
    if (!doc) throw new AppRequestError(404, 'app_not_found', 'No such app on this hosting account.')
    return doc
  }

  async function runInstall(appId, acct, actor) {
    const doc = await col().findOne({ _id: appId })
    try {
      const ctx = await ctxFor(acct)
      const r = await wpi.installWordPress(ctx, {
        path: doc.path || '', adminEmail: doc.adminEmail || null, title: doc.title || null,
        onProgress: (stage) => { col().updateOne({ _id: appId }, { $set: { stage } }).catch(() => {}) },
      })
      await col().updateOne({ _id: appId }, { $set: {
        state: 'ready', stage: 'ready', installedAt: new Date(), version: r.version,
        siteUrl: r.site_url, adminUrl: r.admin_url, adminUser: r.admin_user, adminEmail: r.admin_email, title: r.title,
        dbName: r.db_name, dbUser: r.db_user, docRoot: r.doc_root, adminPassEnc: cpanelAuth.encrypt(r.admin_password),
      } })
      emit(acct, 'hosting.app_installed', { username: acct._id, domain: acct.domain, app: 'wordpress', app_id: appId, path: doc.path || '', site_url: r.site_url, admin_url: r.admin_url, admin_user: r.admin_user, version: r.version })
      record(acct, 'app.installed', actor, { app: 'wordpress', app_id: appId, site_url: r.site_url })
    } catch (e) {
      const code = (e && e.code) || 'install_failed'
      await col().updateOne({ _id: appId }, { $set: { state: 'failed', stage: 'failed', error: `${code}: ${e.message}`, failedAt: new Date() }, $unset: { liveKey: '' } })
      emit(acct, 'hosting.app_install_failed', { username: acct._id, domain: acct.domain, app: 'wordpress', app_id: appId, path: doc.path || '', reason: code, message: e.message })
      record(acct, 'app.install_failed', actor, { app: 'wordpress', app_id: appId, reason: code })
      log(`[HostingApps] WordPress install failed for ${acct._id}: ${code} ${e.message}`)
    }
  }

  // Validate + reserve an install. live=false → stored as state "dry_run" (nothing runs).
  async function start(acct, body, { actor, live }) {
    if (acct.deleted || acct.terminatedOnWhm) throw new AppRequestError(409, 'account_terminated', 'This hosting account is terminated — order a new plan first.')
    if (acct.provisionState === 'provisioning' || acct.provisionState === 'failed') throw new AppRequestError(409, 'not_ready', 'The hosting account is still provisioning.')
    if (acct.suspended === true) throw new AppRequestError(409, 'account_suspended', 'The hosting account is suspended — renew or unsuspend it first.')
    if (!acct.domain) throw new AppRequestError(409, 'no_domain', 'The hosting account has no primary domain.')
    const req = parseInstallBody(body)
    const liveKey = liveKeyOf(acct._id, req.path)
    await col().updateMany({ liveKey, state: 'installing', createdAt: { $lt: new Date(Date.now() - STALE_INSTALL_MS) } },
      { $set: { state: 'failed', stage: 'failed', error: 'install_interrupted: the install did not finish in time.', failedAt: new Date() }, $unset: { liveKey: '' } })
    const existing = await col().findOne({ liveKey })
    if (existing) throw new AppRequestError(409, 'app_exists', `WordPress is already ${existing.state} at /${req.path} on this account.`, { app: view(existing) })
    const { siteUrl, adminUrl } = wpInstaller.siteUrls(acct.domain, req.path)
    const doc = {
      _id: wpInstaller.newAppId(), username: acct._id, chatId: acct.chatId, domain: acct.domain, app: req.app, path: req.path,
      adminEmail: req.adminEmail, title: req.title, siteUrl, adminUrl, via: actor,
      state: live ? 'installing' : 'dry_run', stage: live ? 'queued' : 'dry_run', createdAt: new Date(),
      ...(live ? { liveKey } : {}),
    }
    try { await col().insertOne(doc) }
    catch (e) {
      if (e && e.code === 11000) throw new AppRequestError(409, 'app_exists', `An install is already running at /${req.path} on this account.`)
      throw e
    }
    if (live) {
      if (actor !== 'api') record(acct, `app.install.${req.app}`, actor, { app_id: doc._id, path: req.path })
      runInstall(doc._id, acct, actor).catch(() => {})
    }
    return view(doc)
  }

  async function get(acct, appId) {
    const doc = await getDoc(acct, appId)
    return view(doc, { withSecret: doc.state === 'ready' })
  }

  async function resetPassword(acct, appId, { actor, live }) {
    const doc = await getDoc(acct, appId)
    if (doc.state !== 'ready') throw new AppRequestError(409, 'app_not_ready', 'The app is not installed yet.')
    if (!live) return { dry_run: true, app: view(doc) }
    const ctx = await ctxFor(acct)
    let r
    try { r = await wpi.resetAdminPassword(ctx, { docRoot: doc.docRoot || wpInstaller.docRootFor(acct._id, doc.path || ''), siteUrl: doc.siteUrl, adminUser: doc.adminUser }) }
    catch (e) { throw new AppRequestError(502, e.code || 'reset_failed', e.message) }
    await col().updateOne({ _id: doc._id }, { $set: { adminUser: r.admin_user, adminPassEnc: cpanelAuth.encrypt(r.admin_password), adminPassResetAt: new Date() } })
    if (actor !== 'api') record(acct, 'app.admin_password_reset', actor, { app_id: doc._id })
    return { dry_run: false, app: view({ ...doc, adminUser: r.admin_user, adminPassResetAt: new Date() }), admin_user: r.admin_user, admin_password: r.admin_password }
  }

  return { CATALOG, list, start, get, resetPassword, runInstall, view }
}

module.exports = { createHostingApps, parseInstallBody, AppRequestError, CATALOG, COLLECTION }
