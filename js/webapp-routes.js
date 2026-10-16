// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AI App Hosting — HostPanel routes (mounted under /panel → /api/panel)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Registered from cpanel-routes.js so it shares the panel's auth chain
// (authMiddleware + resolveCpPass → req.cpUser / req.cpPass / req.whmHost),
// the EPERM/auth self-heal wrapper, and the control-plane-down UX.
//
// Routes (all require a logged-in HostPanel session):
//   GET    /webapps                      capacity + feature + app list
//   POST   /webapps/git                  create + deploy from a Git repo
//   POST   /webapps/zip                  create + deploy from an uploaded .zip
//   GET    /webapps/:name                one app (status)
//   GET    /webapps/:name/logs           app | build logs
//   POST   /webapps/:name/configure      env / build / startup / mode / runtime / db
//   POST   /webapps/:name/redeploy       rebuild (git: pull first)
//   POST   /webapps/:name/lifecycle      { action: start|stop|restart }
//   POST   /webapps/:name/mode           { mode: production|development }
//   DELETE /webapps/:name                remove (optionally its database)

const wa = require('./webapp-service')

function registerWebAppRoutes(router, deps) {
  const { auth, userCall, userWriteCall, upload, cpProxy, log } = deps

  // Normalize a service result → HTTP response. Keeps provider names out of
  // user-facing text and maps known categories to friendly messages + status.
  function reply(res, result, okPayload) {
    if (result.ok) return res.json(okPayload !== undefined ? okPayload : { ok: true, data: result.data })
    if (result.cpanelDown) {
      return res.status(503).json({ error: 'Hosting is briefly unavailable while the server catches up. Please try again in a moment.', retriable: true })
    }
    if (result.authFailure) return res.status(401).json({ error: 'Your session could not be verified. Please sign in again.' })
    const friendly = friendlyCategory(result.error_category) || sanitizeMsg(result.reason) || 'The request could not be completed.'
    const code = result.error_category === 'limit_exceeded' ? 409 : 400
    return res.status(code).json({ error: friendly, error_category: result.error_category || null })
  }

  function friendlyCategory(cat) {
    switch (cat) {
      case 'limit_exceeded': return `You have reached the limit of ${wa.LIMITS.maxAppsPerAccount} apps for this account. Delete one to deploy another.`
      case 'source_invalid': return 'We could not read that source. Check the repository URL or the uploaded file and try again.'
      case 'source_auth_failed': return 'We could not access that repository. Check the SSH key has access and try again.'
      case 'source_host_key_failed': return 'The Git host could not be verified. Re-check the repository host and try again.'
      case 'source_credentials_required': return 'That repository needs credentials. Use an SSH URL with a deploy key for private repositories.'
      case 'source_passphrase_required': return 'The selected SSH key needs its passphrase to deploy. Enter the passphrase and try again.'
      case 'build_failed': return 'The build failed. Open the build log to see what went wrong.'
      case 'missing_output': return 'The build finished but produced nothing to serve. Set the correct build output directory and redeploy.'
      case 'requires_build': return 'This app needs a successful build before it can start.'
      case 'start_failed': return 'The app was built but failed to start. Check the app log.'
      case 'port_conflict': return 'The app could not bind to its port. Try a redeploy.'
      case 'invalid_category': return 'This action does not apply to this type of app.'
      case 'not_deployed': return 'Deploy the app first, then try this action.'
      case 'domain_unavailable': return 'That address is already in use. Choose a different app name or domain.'
      default: return null
    }
  }

  function sanitizeMsg(msg) {
    if (!msg || typeof msg !== 'string') return null
    // Keep the wording generic; never leak the WHM hostname/paths (cpProxy already strips host).
    return msg.replace(/\s+/g, ' ').trim().slice(0, 300)
  }

  const H = (req) => req.whmHost || null

  // ── GET /webapps — capacity + feature + apps ──────────────────────────────
  router.get('/webapps', ...auth, async (req, res) => {
    try {
      const host = H(req)
      const cap = await userCall(req, (pass) => wa.capacity(req.cpUser, pass, host))
      if (!cap.ok) return reply(res, cap)
      const ls = await userCall(req, (pass) => wa.list(req.cpUser, pass, host))
      if (!ls.ok) return reply(res, ls)
      const apps = (Array.isArray(ls.data) ? ls.data : []).map(publicApp)
      res.json({
        feature: true,
        capacity: cap.data && cap.data.account ? cap.data.account.apps : null,
        runtimes: (cap.data && cap.data.runtimes) || {},
        limits: wa.LIMITS,
        apps,
      })
    } catch (err) {
      log(`[Panel/WebApp] list error: ${err.message}`)
      res.status(500).json({ error: 'Could not load your apps. Please try again.' })
    }
  })

  // ── POST /webapps/git — create + deploy from a Git repository ──────────────
  router.post('/webapps/git', ...auth, async (req, res) => {
    try {
      const host = H(req)
      const b = req.body || {}
      const nameErr = wa.validateAppName(b.name)
      if (nameErr) return res.status(400).json({ error: nameErr })
      if (!b.source) return res.status(400).json({ error: 'Enter the repository clone URL.' })

      const staged = await userWriteCall(req, (pass) => wa.stage(req.cpUser, pass, host, {
        name: b.name, source_type: 'git', source: b.source, branch: b.branch,
        ssh_key_name: b.ssh_key_name, mode: b.mode, runtime: b.runtime, appdir: b.appdir, passphrase: b.passphrase,
      }))
      if (!staged.ok) return reply(res, staged)
      const appName = (staged.data && staged.data.name) || b.name

      const cfgRes = await applyConfigure(req, host, appName, b)
      if (cfgRes && !cfgRes.ok) return reply(res, cfgRes)

      const dep = await userWriteCall(req, (pass) => wa.deploy(req.cpUser, pass, host, appName, { sshkeypass: b.passphrase }))
      if (!dep.ok) return reply(res, dep)
      res.json({ ok: true, name: appName, deploy: dep.data })
    } catch (err) {
      log(`[Panel/WebApp] git deploy error: ${err.message}`)
      res.status(500).json({ error: 'Could not start the deployment. Please try again.' })
    }
  })

  // ── POST /webapps/zip — create + deploy from an uploaded .zip ──────────────
  router.post('/webapps/zip', ...auth, upload.single('file'), async (req, res) => {
    try {
      const host = H(req)
      const b = req.body || {}
      const nameErr = wa.validateAppName(b.name)
      if (nameErr) return res.status(400).json({ error: nameErr })
      if (!req.file || !req.file.buffer) return res.status(400).json({ error: 'Attach a .zip file of your app.' })
      if (!/\.zip$/i.test(req.file.originalname || '')) return res.status(400).json({ error: 'The uploaded file must be a .zip archive.' })

      // Place the archive in a dedicated staging dir inside the account's home.
      const dir = `/home/${req.cpUser}/webapp_src`
      await userWriteCall(req, (pass) => cpProxy.createDirectory(req.cpUser, pass, `/home/${req.cpUser}`, 'webapp_src', host)).catch(() => {})
      const zipName = `${b.name}-${Date.now()}.zip`
      const up = await userWriteCall(req, (pass) => cpProxy.uploadFile(req.cpUser, pass, dir, zipName, req.file.buffer, host))
      if (!up || up.status !== 1) {
        const upn = wa.normalize(up)
        return reply(res, upn.ok ? upn : { ok: false, reason: (upn.reason || 'We could not upload the archive to your account.') })
      }
      const archivePath = `${dir}/${zipName}`

      const staged = await userWriteCall(req, (pass) => wa.stage(req.cpUser, pass, host, {
        name: b.name, source_type: 'zip', source: archivePath, mode: b.mode, runtime: b.runtime, appdir: b.appdir,
      }))
      if (!staged.ok) return reply(res, staged)
      const appName = (staged.data && staged.data.name) || b.name

      const cfgRes = await applyConfigure(req, host, appName, b)
      if (cfgRes && !cfgRes.ok) return reply(res, cfgRes)

      const dep = await userWriteCall(req, (pass) => wa.deploy(req.cpUser, pass, host, appName))
      if (!dep.ok) return reply(res, dep)
      res.json({ ok: true, name: appName, deploy: dep.data })
    } catch (err) {
      log(`[Panel/WebApp] zip deploy error: ${err.message}`)
      res.status(500).json({ error: 'Could not start the deployment. Please try again.' })
    }
  })

  // ── GET /webapps/:name — one app ──────────────────────────────────────────
  router.get('/webapps/:name', ...auth, async (req, res) => {
    try {
      const r = await userCall(req, (pass) => wa.get(req.cpUser, pass, H(req), req.params.name))
      if (r.notFound) return res.status(404).json({ error: 'App not found.' })
      if (!r.ok) return reply(res, r)
      res.json({ ok: true, app: publicApp(r.data) })
    } catch (err) {
      log(`[Panel/WebApp] get error: ${err.message}`)
      res.status(500).json({ error: 'Could not load the app.' })
    }
  })

  // ── GET /webapps/:name/logs ───────────────────────────────────────────────
  router.get('/webapps/:name/logs', ...auth, async (req, res) => {
    try {
      const type = req.query.type === 'build' ? 'build' : 'app'
      const lines = Math.min(Math.max(parseInt(req.query.lines, 10) || 200, 1), 1000)
      const r = await userCall(req, (pass) => wa.logs(req.cpUser, pass, H(req), req.params.name, { log_type: type, lines, deploy_id: req.query.deploy_id || null }))
      if (!r.ok) return reply(res, r)
      res.json({ ok: true, type, lines: (r.data && r.data.lines) || [] })
    } catch (err) {
      log(`[Panel/WebApp] logs error: ${err.message}`)
      res.status(500).json({ error: 'Could not load the logs.' })
    }
  })

  // ── POST /webapps/:name/configure ─────────────────────────────────────────
  router.post('/webapps/:name/configure', ...auth, async (req, res) => {
    try {
      const r = await applyConfigure(req, H(req), req.params.name, req.body || {}, true)
      if (!r) return res.status(400).json({ error: 'Nothing to update.' })
      if (!r.ok) return reply(res, r)
      res.json({ ok: true, data: r.data })
    } catch (err) {
      log(`[Panel/WebApp] configure error: ${err.message}`)
      res.status(500).json({ error: 'Could not save the settings.' })
    }
  })

  // ── POST /webapps/:name/redeploy ──────────────────────────────────────────
  router.post('/webapps/:name/redeploy', ...auth, async (req, res) => {
    try {
      const r = await userWriteCall(req, (pass) => wa.redeploy(req.cpUser, pass, H(req), req.params.name, { sshkeypass: (req.body || {}).passphrase }))
      if (!r.ok) return reply(res, r)
      res.json({ ok: true, deploy: r.data })
    } catch (err) {
      log(`[Panel/WebApp] redeploy error: ${err.message}`)
      res.status(500).json({ error: 'Could not start the redeploy.' })
    }
  })

  // ── POST /webapps/:name/lifecycle ─────────────────────────────────────────
  router.post('/webapps/:name/lifecycle', ...auth, async (req, res) => {
    try {
      const action = (req.body || {}).action
      if (!['start', 'stop', 'restart'].includes(action)) return res.status(400).json({ error: 'Choose start, stop or restart.' })
      const r = await userWriteCall(req, (pass) => wa.lifecycle(req.cpUser, pass, H(req), req.params.name, action))
      if (!r.ok) return reply(res, r)
      res.json({ ok: true, data: r.data })
    } catch (err) {
      log(`[Panel/WebApp] lifecycle error: ${err.message}`)
      res.status(500).json({ error: 'Could not change the app state.' })
    }
  })

  // ── POST /webapps/:name/mode ──────────────────────────────────────────────
  router.post('/webapps/:name/mode', ...auth, async (req, res) => {
    try {
      const mode = (req.body || {}).mode
      if (!['production', 'development'].includes(mode)) return res.status(400).json({ error: 'Mode must be production or development.' })
      const r = await userWriteCall(req, (pass) => wa.setMode(req.cpUser, pass, H(req), req.params.name, mode))
      if (!r.ok) return reply(res, r)
      res.json({ ok: true, data: r.data })
    } catch (err) {
      log(`[Panel/WebApp] mode error: ${err.message}`)
      res.status(500).json({ error: 'Could not change the run mode.' })
    }
  })

  // ── DELETE /webapps/:name ─────────────────────────────────────────────────
  router.delete('/webapps/:name', ...auth, async (req, res) => {
    try {
      const delDb = req.query.delete_database === '1' || req.query.delete_database === 'true'
      const r = await userWriteCall(req, (pass) => wa.remove(req.cpUser, pass, H(req), req.params.name, { delete_database: delDb }))
      if (!r.ok) return reply(res, r)
      res.json({ ok: true, data: r.data })
    } catch (err) {
      log(`[Panel/WebApp] delete error: ${err.message}`)
      res.status(500).json({ error: 'Could not delete the app.' })
    }
  })

  // ── Shared: apply configure from a create/update body ─────────────────────
  // Returns null when there is nothing to configure (so create can skip it),
  // otherwise the service result.
  async function applyConfigure(req, host, name, b, isUpdate = false) {
    const opts = {}
    // Env: accept either a key/value object (env) or pasted text (env_text).
    if (b.env_text !== undefined && b.env_text !== null && String(b.env_text).trim() !== '') {
      const parsed = wa.parseEnvText(b.env_text)
      if (!parsed.ok) return { ok: false, reason: parsed.error, error_category: 'invalid_env' }
      opts.env = parsed.env
    } else if (b.env && typeof b.env === 'object') {
      const v = wa.validateEnv(b.env)
      if (!v.ok) return { ok: false, reason: v.error, error_category: 'invalid_env' }
      opts.env = b.env
    } else if (isUpdate && (b.env === null || (b.env && typeof b.env === 'object' && Object.keys(b.env).length === 0))) {
      opts.env = {} // explicit clear on update
    }
    for (const k of ['build_command', 'startup_command', 'output_dir', 'runtime_tag', 'mode', 'db', 'db_name', 'appdir', 'domain', 'use_existing_domain']) {
      if (b[k] !== undefined && b[k] !== null && b[k] !== '') opts[k] = b[k]
    }
    if (Object.keys(opts).length === 0) return isUpdate ? { ok: false, reason: 'Nothing to update.' } : null
    return userWriteCall(req, (pass) => wa.configure(req.cpUser, pass, host, name, opts))
  }

  // Shape an app for the client. Env values are masked for display; names kept.
  function publicApp(app) {
    if (!app || typeof app !== 'object') return app
    const out = { ...app }
    if (out.env && typeof out.env === 'object') {
      out.env_keys = Object.keys(out.env)
      out.env_masked = Object.fromEntries(Object.keys(out.env).map(k => [k, maskValue(String(out.env[k] ?? ''))]))
      delete out.env // never ship raw secret values to the browser
    }
    return out
  }

  function maskValue(v) {
    if (!v) return ''
    if (v.length <= 4) return '••••'
    return `${v.slice(0, 2)}••••${v.slice(-2)}`
  }
}

module.exports = { registerWebAppRoutes }
