/**
 * addon-domain-flow.js
 * --------------------
 * Single source of truth for "attach addon domain to existing hosting plan".
 * Used by:
 *   - js/cpanel-routes.js POST /domains/add (HostPanel web UI)
 *   - js/_index.js Telegram bot "➕ Add Domain to Plan" flow
 *
 * Responsibilities:
 *   1. Pre-flight validation (blocklist, plan addon-limit, duplicate-on-plan)
 *   2. cPanel `addaddondomain` call via cpanel-proxy
 *   3. Persist the addon to `cpanelAccounts.addonDomains[]`
 *   4. Cloudflare zone setup (find/create) + DNS conflict cleanup
 *   5. Hosting DNS records (root + www CNAME → CF Tunnel) + SSL + AOP
 *   6. Anti-red protection deployment with 3-retry back-off
 *   7. 30s post-deploy verification probe (best-effort, async)
 *   8. Health check schedule (5-min reachability probe)
 *
 * The function is idempotent within a hosting account: if the addon already
 * exists in `cpanelAccounts.addonDomains[]`, it returns `{ ok: true,
 * alreadyAttached: true }` without re-running WHM/CF/anti-red.
 */

const { log } = require('console')

// Folder path users will need to upload their site files to.
function getAddonDocRoot(domain) {
  return `public_html/${(domain || '').toLowerCase()}`
}

/**
 * @param {object} opts
 * @param {object} opts.account     - cpanelAccounts document (must include
 *                                    cpUser, cpPass_encrypted/iv/tag,
 *                                    domain (primary), plan, addonDomains[],
 *                                    optionally whmHost, chatId)
 * @param {string} opts.cpPass      - decrypted cPanel password (caller must decrypt)
 * @param {string} opts.domain      - addon domain to attach (lowercased internally)
 * @param {string} [opts.subDomain] - optional addon subdomain alias; defaults to
 *                                    domain.replace(/\./g,'')
 * @param {string} [opts.dir]       - optional document root; defaults to
 *                                    `public_html/<domain>` (relative to /home/<cpUser>)
 * @param {object} opts.db          - MongoDB db handle (for persistence + blocklist)
 * @param {object} [opts.bot]       - optional Telegram bot instance (for verify-fail DM)
 * @param {string} [opts.lang='en'] - user language for verify-fail DM
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   errorKind?: 'blocked'|'limit'|'duplicate'|'cpanel_down'|'whm_failed'|'no_credentials'|'unknown',
 *   error?: string,
 *   alreadyAttached?: boolean,
 *   docRoot?: string,
 *   limit?: number,
 *   currentAddons?: number,
 * }>}
 */
async function attachAddonDomain(opts) {
  const cpProxy = require('./cpanel-proxy')
  const cfService = require('./cf-service')
  const whmService = require('./whm-service')
  const antiRedService = require('./anti-red-service')

  const account = opts.account
  if (!account || !account.cpUser) {
    return { ok: false, errorKind: 'unknown', error: 'missing account' }
  }
  if (!opts.cpPass) {
    return { ok: false, errorKind: 'no_credentials', error: 'missing cPanel password' }
  }

  const domainRaw = (opts.domain || '').trim()
  const domain = domainRaw.toLowerCase()
  if (!domain || !domain.includes('.')) {
    return { ok: false, errorKind: 'unknown', error: 'invalid domain' }
  }
  const cpUser = account.cpUser
  const cpUserId = String(account._id || cpUser).toLowerCase()
  const whmHost = opts.account.whmHost || process.env.WHM_HOST
  const docRoot = opts.dir || getAddonDocRoot(domain)
  const subDomain = opts.subDomain || domain.replace(/\./g, '')

  const cpanelAccountsCol = opts.db.collection('cpanelAccounts')

  // ── Idempotency: already attached? ──
  const existingAddons = (account.addonDomains || []).map(d => (d || '').toLowerCase())
  if (existingAddons.includes(domain)) {
    log(`[AddonFlow] ${domain} already on ${cpUser} — returning idempotent success`)
    return { ok: true, alreadyAttached: true, docRoot }
  }
  // Reject if the requested domain is the primary (already served by main plan)
  if ((account.domain || '').toLowerCase() === domain) {
    return { ok: false, errorKind: 'duplicate', error: 'domain is already the primary on this plan' }
  }

  // ── Blocklist check ──
  try {
    const blocked = await opts.db.collection('blockedDomains').findOne({ domain })
    if (blocked) {
      log(`[AddonFlow] BLOCKED domain rejected: ${domain} (reason: ${blocked.reason})`)
      return { ok: false, errorKind: 'blocked', error: blocked.reason || 'domain is blocked' }
    }
  } catch (e) {
    log(`[AddonFlow] blocklist check warning: ${e.message}`)
  }

  // ── Plan addon-limit ──
  try {
    const limit = whmService.getAddonLimit(account.plan)
    const currentAddons = (account.addonDomains || []).length
    if (limit !== -1 && currentAddons >= limit) {
      return {
        ok: false,
        errorKind: 'limit',
        error: 'addon limit reached',
        limit,
        currentAddons,
      }
    }
  } catch (e) {
    log(`[AddonFlow] limit check warning (non-blocking): ${e.message}`)
  }

  // ── Duplicate check across all hosting accounts ──
  try {
    const dupe = await cpanelAccountsCol.findOne({
      $or: [{ domain }, { addonDomains: domain }],
      deleted: { $ne: true },
      _id: { $ne: cpUserId },
    })
    if (dupe) {
      return {
        ok: false,
        errorKind: 'duplicate',
        error: 'domain is already attached to a different hosting plan',
      }
    }
  } catch (e) {
    log(`[AddonFlow] duplicate-domain check warning: ${e.message}`)
  }

  // ── Shortener conflict: auto-deactivate so hosting DNS isn't fighting it ──
  // Before this guard, attaching an addon whose domain was already linked to the
  // URL shortener left the Railway custom-domain registration orphaned. The
  // hosting DNS would overwrite the shortener CNAME, so the shortener silently
  // broke ("needs_reactivation"). We now actively deactivate the shortener as
  // part of the addon flow so the user ends up in a single, consistent state.
  try {
    const shortenerCol = opts.db.collection('shortenerActivations')
    const activeShortener = await shortenerCol.findOne({
      _id: domain,
      status: { $nin: ['deactivated', 'failed'] },
    })
    if (activeShortener) {
      log(`[AddonFlow] ${domain} has active shortener (status=${activeShortener.status}) — deactivating before addon attach`)
      try {
        const { removeDomainFromRailway } = require('./rl-save-domain-in-server.js')
        const r = await removeDomainFromRailway(domain)
        log(`[AddonFlow] Railway custom-domain removal: ${JSON.stringify(r)}`)
      } catch (e) {
        log(`[AddonFlow] Railway removal warning: ${e.message}`)
      }
      await shortenerCol.updateOne(
        { _id: domain },
        {
          $set: {
            status: 'deactivated',
            deactivatedAt: new Date().toISOString(),
            deactivatedBy: 'addon-attach',
          },
        }
      )
      log(`[AddonFlow] shortenerActivations.${domain} marked deactivated`)
    }
  } catch (e) {
    log(`[AddonFlow] shortener auto-deactivate warning: ${e.message}`)
  }

  // ── cPanel addaddondomain ──
  let result
  try {
    result = await cpProxy.addAddonDomain(cpUser, opts.cpPass, domain, subDomain, docRoot, whmHost)
  } catch (e) {
    log(`[AddonFlow] addAddonDomain threw: ${e.message}`)
    return { ok: false, errorKind: 'whm_failed', error: e.message }
  }

  // CPANEL_DOWN response → caller can re-queue
  if (result && result.code === 'CPANEL_DOWN') {
    return { ok: false, errorKind: 'cpanel_down', error: 'WHM unreachable' }
  }

  // ── Self-heal: "domain already exists in the userdata" ──
  //   If a prior deleted account (SAME chatId) is still holding this
  //   domain in WHM userdata because /removeacct silently failed at
  //   grace-period termination, our own cross-plan duplicate check
  //   (which excludes deleted rows) passed, but cPanel's userdata
  //   layer still rejects. Retry `/removeacct` on the stale row + one
  //   retry of addAddon. NEVER cross-user (heal helper enforces).
  if (result && result.status !== 1) {
    const errMsg = (result.errors || []).join(', ') || ''
    const heal = require('./whm-userdata-heal')
    if (heal.isStaleUserdataError(errMsg) && account.chatId) {
      try {
        const release = await heal.attemptUserdataRelease({
          db: opts.db,
          whmService: require('./whm-service'),
          domain,
          chatId: account.chatId,
        })
        if (release.released) {
          log(`[AddonFlow] userdata self-heal released ${domain} from stale ${release.staleCpUser} — retrying addAddon`)
          try {
            result = await cpProxy.addAddonDomain(cpUser, opts.cpPass, domain, subDomain, docRoot, whmHost)
          } catch (e2) {
            log(`[AddonFlow] retry addAddonDomain threw: ${e2.message}`)
            return { ok: false, errorKind: 'whm_failed', error: e2.message }
          }
        } else {
          log(`[AddonFlow] userdata self-heal did NOT release ${domain}: ${release.reason}`)
        }
      } catch (healErr) {
        log(`[AddonFlow] userdata self-heal error (non-blocking): ${healErr.message}`)
      }
    }
  }

  if (!result || result.status !== 1) {
    const errMsg = (result?.errors || []).join(', ') || 'cPanel rejected the addon'
    return { ok: false, errorKind: 'whm_failed', error: errMsg }
  }

  // ── Persist to cpanelAccounts.addonDomains[] ──
  try {
    await cpanelAccountsCol.updateOne(
      { _id: cpUserId },
      { $addToSet: { addonDomains: domain } }
    )
    log(`[AddonFlow] Persisted addon ${domain} on ${cpUser}`)
  } catch (e) {
    log(`[AddonFlow] persist warning: ${e.message}`)
  }

  // ── Cloudflare zone + DNS + SSL + anti-red (fire-and-forget) ──
  // We intentionally do NOT await this. Anti-red deployment + retries can take
  // up to ~65 seconds in the worst case (5s + 15s + 45s back-off), and the
  // user would otherwise see a hung spinner. The helper returns success right
  // after the WHM addaddondomain + DB persist (which is the authoritative
  // attach), and the DNS/protection runs in the background. The 30-second
  // verification probe DMs the user if anti-red didn't go live.
  ;(async () => {
    try {
      await runDnsAndProtection({
        domain,
        cpUser,
        whmHost,
        account,
        db: opts.db,
        bot: opts.bot,
        lang: opts.lang || 'en',
      })
    } catch (e) {
      log(`[AddonFlow] DNS/protection background pipeline error for ${domain}: ${e.message}`)
    }
  })()

  // ── Schedule 5-min health check (matches primary-domain provisioning) ──
  try {
    const healthCheck = require('./hosting-health-check')
    healthCheck.scheduleHealthCheck(domain, cpUser, account.chatId || '')
    log(`[AddonFlow] health check scheduled for addon ${domain}`)
  } catch (_) {}

  return { ok: true, docRoot }
}

/**
 * Internal: Cloudflare + anti-red pipeline shared with the panel route.
 * Mirrors cpanel-routes.js:594-688 exactly so behavior is identical.
 */
async function runDnsAndProtection({ domain, cpUser, whmHost, account, db, bot, lang }) {
  const cfService = require('./cf-service')
  const antiRedService = require('./anti-red-service')
  const { translation } = require('./translation')

  const MAX_RETRIES = 3
  const RETRY_DELAYS = [5000, 15000, 45000]

  let zoneId = null
  let cfNameservers = []

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      let zone = await cfService.getZoneByName(domain)
      if (!zone) {
        const newZone = await cfService.createZone(domain)
        if (newZone.success) {
          zone = { id: newZone.zoneId, name_servers: newZone.nameservers || [] }
        }
      }
      if (!zone) throw new Error('Cloudflare zone could not be created or found')
      zoneId = zone.id
      cfNameservers = (zone.name_servers || []).filter(Boolean)

      // Persist CF metadata so downstream features (captcha toggle, status
      // panel, anti-red cron) can find the zone via DB without re-hitting CF.
      // Customer regression homepage-navyfed.com (2026-02) traced to this
      // metadata never being written for addon domains.
      if (db && zoneId) {
        try {
          await db.collection('registeredDomains').updateOne(
            { _id: domain },
            { $set: { 'val.cfZoneId': zoneId, 'val.nameserverType': 'cloudflare' } },
            { upsert: true }
          )
        } catch (persistErr) {
          log(`[AddonFlow] failed to persist cfZoneId for ${domain}: ${persistErr.message}`)
        }
      }

      // ── Delegate addon domain at the registrar to Cloudflare ──
      // Without this the registrar keeps its default NS (e.g. OpenProvider's
      // ns1/ns2/ns3.openprovider.{nl,be,eu}) and the CF zone — even though
      // created + populated with hosting CNAMEs — stays in `pending`
      // status (`activation_failure_reason: ns_delegated_from_provider`)
      // forever. Live DNS queries hit the registrar's empty NS, the cPanel
      // addon page reports "domain not pointed to this server", SSL can't
      // issue, and the user files a support ticket.
      //
      // Real incident: HHR2009 (chatId 1960615421) bought
      // `inviolivepaperless.com` as an addon at 2026-06-18 11:30 UTC. CF zone
      // was created with anderson/leanna.ns.cloudflare.com but OP delegation
      // was never updated → hosting panel error → manual rescue via
      // /app/js/scripts/fix_inviolivepaperless_ns.js. The same gap was
      // observed earlier for `rsvpeviteopen.org` (rescued by
      // `heal_rsvpeviteopen_org_2026-02`). Closing the gap permanently here.
      //
      // We only attempt the NS update if (a) the domain registrar is
      // OpenProvider in our records, and (b) CF returned ≥2 nameservers.
      // updateNameservers() already handles DNSSEC cleanup + a ≤30s
      // registry-propagation probe; we log the probe result for audit.
      if (db && cfNameservers.length >= 2) {
        try {
          const regRow = await db.collection('registeredDomains').findOne({ _id: domain })
          const registrar = (regRow?.val?.registrar || regRow?.val?.provider || '').toLowerCase()
          const currentNs = (regRow?.val?.nameservers || []).map(n => String(n).toLowerCase())
          const targetNs = cfNameservers.map(n => String(n).toLowerCase())
          const alreadyDelegated = targetNs.every(t => currentNs.includes(t))

          if (registrar === 'openprovider' && !alreadyDelegated) {
            const opService = require('./op-service')
            log(`[AddonFlow] ${domain}: registrar=OpenProvider, delegating NS to CF (${cfNameservers.join(', ')})`)
            const nsRes = await opService.updateNameservers(domain, cfNameservers)
            if (nsRes?.success) {
              log(`[AddonFlow] ${domain}: NS delegation OK (propagation: ${JSON.stringify(nsRes.propagation)})`)
              await db.collection('registeredDomains').updateOne(
                { _id: domain },
                { $set: { 'val.nameservers': cfNameservers, 'val.nameserverType': 'cloudflare' } }
              ).catch(() => {})
              try {
                await db.collection('nsAuditLog').insertOne({
                  domain,
                  chatId: account.chatId || null,
                  action: 'addon_ns_delegation',
                  before: currentNs,
                  after: cfNameservers,
                  propagationProbe: nsRes.propagation,
                  ts: new Date().toISOString(),
                  appliedBy: 'addon-domain-flow',
                })
              } catch (_) {
                // audit-log row is best-effort; never block the NS delegation success path
              }
            } else {
              log(`[AddonFlow] ${domain}: OP NS update failed: ${nsRes?.error || 'unknown'}`)
            }
          } else if (registrar && registrar !== 'openprovider') {
            // Other registrars: only log — caller is responsible.
            log(`[AddonFlow] ${domain}: skipping NS delegation (registrar=${registrar})`)
          } else if (!registrar) {
            log(`[AddonFlow] ${domain}: registrar unknown in registeredDomains — skipping NS delegation (safe default)`)
          }
        } catch (nsErr) {
          // NS delegation failure must not abort the addon attach — the
          // domain is still owned by the user; the protection pipeline
          // continues. DnsHealer will retry on its next cron pass.
          log(`[AddonFlow] ${domain}: NS delegation warning (non-fatal): ${nsErr.message}`)
        }
      }

      await cfService.cleanupConflictingDNS(zoneId, domain)
      await cfService.createHostingDNSRecords(zoneId, domain, whmHost || process.env.WHM_HOST)
      await cfService.setSSLMode(zoneId, 'flexible')
      await cfService.enforceHTTPS(zoneId)
      try { await cfService.enableAuthenticatedOriginPulls(zoneId) } catch (_) {}

      // ── Origin Hardening (parity with cpanel-routes.js add-enhanced flow) ──
      //    The bot's automated provisioning historically only ran AOP and left
      //    SSL at Flexible mode (CF↔origin = plain HTTP). The full hardening
      //    flow — already implemented in the panel UI's /domains/add-enhanced
      //    route — generates a CF Origin CA cert, installs it on cPanel,
      //    excludes the domain from AutoSSL (so LE can't overwrite it), and
      //    upgrades SSL mode to Full (strict). Without these steps the
      //    CF→origin leg is unencrypted and anyone with the origin IP can
      //    bypass Cloudflare. Audit on 2026-06-08 found 0 of 13 in-CF cPanel
      //    domains had Origin CA certs. This block closes that gap.
      //    Runs after the retry loop succeeds; never throws (defensive).
      try {
        const whmServiceLocal = require('./whm-service')
        const certResult = await cfService.generateOriginCACert([domain, `*.${domain}`])
        if (certResult.success) {
          const installRes = await whmServiceLocal.installDomainSSL(
            cpUser, domain, certResult.certificate, certResult.privateKey
          )
          if (installRes.success) {
            await whmServiceLocal.excludeDomainsFromAutoSSL(cpUser, [domain, `www.${domain}`])
            await cfService.setSSLMode(zoneId, 'strict')
            log(`[AddonFlow] origin hardened for ${domain} (Origin CA + AOP + AutoSSL exclude + Full(strict))`)
          } else {
            log(`[AddonFlow] origin CA generated but installssl failed for ${domain}: ${installRes.error}`)
          }
        } else {
          log(`[AddonFlow] origin CA cert skipped for ${domain}: ${certResult.error || 'unknown'}`)
        }
      } catch (hardenErr) {
        log(`[AddonFlow] origin hardening warning for ${domain}: ${hardenErr.message}`)
      }

      await antiRedService.deployFullProtection(cpUser, domain, account.plan || '')
      log(`[AddonFlow] anti-red + DNS deployed for ${domain} (attempt ${attempt})`)
      break
    } catch (e) {
      log(`[AddonFlow] DNS/protection attempt ${attempt}/${MAX_RETRIES} for ${domain} failed: ${e.message}`)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAYS[attempt - 1]))
      } else {
        log(`[AddonFlow] all ${MAX_RETRIES} protection attempts failed for ${domain}`)
        if (account?.chatId && bot) {
          try {
            bot.sendMessage(
              account.chatId,
              translation('t.antiRedFailedTitle', lang) + '\n\n' +
              translation('t.antiRedFailedBodyShort', lang, domain, MAX_RETRIES),
              { parse_mode: 'HTML' }
            ).catch(() => {})
          } catch (_) {}
        }
      }
    }
  }

  // 30s verification probe — runs in the background, may DM user if protection
  // didn't go live.
  if (zoneId && account?.chatId && bot) {
    setTimeout(async () => {
      try {
        const verification = await antiRedService.verifyProtection(domain)
        if (!verification?.active) {
          log(`[AddonFlow] verify: ⚠️ protection not live for ${domain}: ${verification?.error || 'no worker/challenge'}`)
          try {
            bot.sendMessage(
              account.chatId,
              translation('t.antiRedWarningTitle', lang) + '\n\n' +
              translation('t.antiRedWarningBodyShort', lang, domain),
              { parse_mode: 'HTML' }
            ).catch(() => {})
          } catch (_) {}
        } else {
          log(`[AddonFlow] verify: ✅ protection live for ${domain}`)
        }
      } catch (e) {
        log(`[AddonFlow] verify error for ${domain}: ${e.message}`)
      }
    }, 30000)
  }
}

module.exports = {
  attachAddonDomain,
  getAddonDocRoot,
  runDnsAndProtection,
}
