'use strict'
// Express middleware: records successful, state-changing reseller API calls in the activity log
// (actor "api"). Dry-runs, errors and unmapped routes (file manager, reads …) are not recorded.
const activity = require('./reseller-activity')

const SAFE_FIELDS = ['action', 'mode', 'periods', 'months', 'term_months', 'plan_id', 'plan', 'to_plan', 'from_plan', 'direction', 'reason', 'enabled', 'auto_renew',
  'charged_usd', 'expires_at', 'status', 'domain', 'addon_domain', 'new_domain', 'os', 'type', 'name', 'countries', 'low_balance_usd', 'webhook_url']

const byParam = (p) => (req) => req.params[p]
const spec = (type, action, id) => ({ type, action, id })
const hosting = (action) => spec('hosting', action, byParam('user'))
const server = (type, action) => spec(type, action, byParam('id'))
const domain = (action) => spec('domain', action, byParam('domain'))
const account = (action) => spec('account', action, () => null)
const siteStatus = hosting((req) => `site.${req.body && req.body.action === 'take_offline' ? 'take_offline' : 'bring_online'}`)

const ROUTES = {
  'POST /hosting': spec('hosting', 'create', (req, b) => b && b.username),
  'POST /hosting/:user/suspend': hosting('suspend'),
  'POST /hosting/:user/unsuspend': hosting('unsuspend'),
  'POST /hosting/:user/site-status': siteStatus,
  'POST /hosting/:user/account/site-status': siteStatus,
  'POST /hosting/:user/auto-renew': hosting((req, b) => (b && b.auto_renew ? 'auto_renew.enabled' : 'auto_renew.disabled')),
  'POST /hosting/:user/renew': hosting('renew'),
  'DELETE /hosting/:user': hosting('delete'),
  'POST /hosting/:user/dns/repair': hosting('dns.repair'),
  'POST /hosting/:user/upgrade': hosting('plan_change'),
  'POST /hosting/:user/change-plan': hosting('plan_change'),
  'POST /hosting/:user/addons': hosting('addon.add'),
  'DELETE /hosting/:user/domains/addon': hosting('addon.remove'),
  'POST /hosting/:user/change-primary': hosting('primary_domain.change'),
  'POST /hosting/:user/domains/set-primary': hosting('primary_domain.change'),
  'POST /hosting/:user/security/anti-red/deploy': hosting('anti_red.deploy'),
  'POST /hosting/:user/security/anti-bot': hosting('security.anti_bot'),
  'POST /hosting/:user/security/visitor-captcha': hosting('security.visitor_captcha'),
  'POST /hosting/:user/security/js-challenge': hosting('security.js_challenge'),
  'POST /hosting/:user/geo': hosting('geo.update'),
  'DELETE /hosting/:user/geo': hosting('geo.clear'),
  'POST /hosting/:user/ssl/autossl': hosting('ssl.autossl'),
  'GET /hosting/:user/credentials': hosting('credentials.reveal'),
  'POST /hosting/captcha/:domain': domain('security.visitor_captcha'),
  'POST /hosting/honeypot/:domain': domain('security.honeypot'),
  'POST /domains/register': spec('domain', 'register', (req) => req.body && req.body.domain),
  'POST /domains/:domain/auto-renew': domain((req, b) => (b && b.auto_renew ? 'auto_renew.enabled' : 'auto_renew.disabled')),
  'PUT /dns/:domain/nameservers': domain('nameservers.update'),
  'POST /dns/:domain/records': domain('dns_record.add'),
  'PUT /dns/:domain/records': domain('dns_record.update'),
  'DELETE /dns/:domain/records': domain('dns_record.delete'),
  'PUT /account/webhook': account('webhook.update'),
  'PUT /account/alerts': account('alerts.update'),
}
for (const t of ['vps', 'rdp']) {
  Object.assign(ROUTES, {
    [`POST /${t}`]: spec(t, 'create', (req, b) => b && b.id),
    [`POST /${t}/:id/action`]: server(t, (req) => `power.${String((req.body && req.body.action) || '').toLowerCase()}`),
    [`DELETE /${t}/:id`]: server(t, 'delete'),
    [`POST /${t}/:id/renew`]: server(t, 'renew'),
    [`POST /${t}/:id/password-reset`]: server(t, 'password_reset'),
    [`POST /${t}/:id/reinstall`]: server(t, 'reinstall'),
    [`POST /${t}/:id/upgrade`]: server(t, 'plan_change'),
    [`POST /${t}/:id/change-plan`]: server(t, 'plan_change'),
  })
}
Object.assign(ROUTES, { 'POST /vps/:id/ssh-key': server('vps', 'ssh_keys.update'), 'POST /vps/:id/ssh-keys': server('vps', 'ssh_keys.update') })

function pick(src) {
  const out = {}
  if (!src || typeof src !== 'object') return out
  for (const k of SAFE_FIELDS) if (src[k] !== undefined && typeof src[k] !== 'object') out[k] = src[k]
  return out
}
const isDryRun = (b) => !!b && (b.mode === 'dry_run' || b.dry_run === true)

function apiRecorder(getDb) {
  return function activityRecorder(req, res, next) {
    let body = null
    const json = res.json.bind(res)
    res.json = (b) => { body = b; return json(b) }
    res.on('finish', () => {
      if (res.statusCode >= 400 || !req.route || !req.reseller || isDryRun(body) || (req.body && req.body.dry_run === true)) return
      const s = ROUTES[`${req.method} ${req.route.path}`]
      if (!s) return
      const result = { ...pick(body), ...pick(body && body.result) }
      activity.record(getDb(), {
        ownerChatId: req.reseller.ownerChatId,
        resourceType: s.type,
        resourceId: s.id(req, body),
        action: typeof s.action === 'function' ? s.action(req, body) : s.action,
        actor: 'api',
        details: { request: pick(req.body), result, http_status: res.statusCode },
      })
    })
    next()
  }
}

module.exports = { apiRecorder, ROUTES }
