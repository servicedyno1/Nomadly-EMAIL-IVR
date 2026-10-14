/* global process */
/**
 * Hosting Health Check Service
 * 
 * Multi-stage automated health checks for hosting plans.
 * 
 * STAGES:
 *   Stage 1 (5 min)  — Infrastructure: no 500, Anti-Red deployed, SSL started
 *   Stage 2 (30 min) — Content: detect uploads, find correct path, add redirect
 *   Stage 3 (2 hr)   — Full E2E: verify through CF, auto-fix remaining issues
 * 
 * HANDLES:
 *   - Users WITH their own antibot code (antibots/, antibot_ip.php, etc.)
 *   - Users WITHOUT antibot code (plain PHP/HTML sites)
 *   - Content in subdirectories (smart path detection + auto-redirect)
 *   - Broken .htaccess (syntax errors, HTML entities, etc.)
 *   - CF Worker + prepend conflicts (JS challenge → IP-fix migration)
 */

require('dotenv').config()
const axios = require('axios')
const https = require('https')
const { log } = require('console')

const WHM_HOST = process.env.WHM_HOST
const WHM_USERNAME = process.env.WHM_USERNAME || 'root'
const WHM_TOKEN = process.env.WHM_TOKEN
const TELEGRAM_DEV_CHAT_ID = process.env.TELEGRAM_DEV_CHAT_ID
// ── Tunnel routing (2026-10-14 RCA) ──
// Production keeps the WHM box firewalled: WHM :2087 is only reachable through the Cloudflare
// Tunnel at WHM_API_URL, and websites only through Cloudflare (CF_TUNNEL_CNAME). This module used to
// call https://<WHM_HOST>:2087 and https://<WHM_HOST>:443 directly, so EVERY call timed out and was
// swallowed → every report said "Content: empty", "Prepend: none", "Origin: HTTP N/A" and re-deployed
// the IP-fix prepend, even when the user had uploaded their site. Same routing as whm-service.js and
// anti-red-service.js now; failures are reported as "could not check", never as "empty"/"missing".
const WHM_API_URL = (process.env.WHM_API_URL || '').replace(/\/+$/, '')
const WHM_BASE = WHM_API_URL ? `${WHM_API_URL}/json-api` : (WHM_HOST ? `https://${WHM_HOST}:2087/json-api` : null)
// Direct-to-origin HTTP probes only work when the origin is NOT tunnel-only; otherwise probe via Cloudflare.
const ORIGIN_DIRECT_IP = WHM_API_URL ? null : (WHM_HOST || null)
const ORIGIN_LABEL = ORIGIN_DIRECT_IP ? 'Origin' : 'Site (via Cloudflare tunnel)'

const whmApi = WHM_BASE && WHM_TOKEN ? axios.create({
  baseURL: WHM_BASE,
  headers: {
    Authorization: `whm ${WHM_USERNAME}:${WHM_TOKEN}`,
    // Cloudflare Access service token — required when WHM_API_URL is a CF Access-protected tunnel host.
    ...(process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET ? {
      'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
    } : {}),
  },
  timeout: 30000,
  httpsAgent: new https.Agent({ rejectUnauthorized: false }),
}) : null

// Track scheduled health checks to avoid duplicates per stage
const scheduledChecks = new Map()

// Common antibot signatures to detect in user files
const ANTIBOT_SIGNATURES = [
  'antibots/', 'antibot_ip', 'antibot_host', 'antibot_userAgent',
  'antibot_phishtank', '$BotSp0x', '$badBots', 'isBot(', 'botDetect',
  'blockBots', 'anti-bot', 'crawlerDetect', 'BotSp0x',
]

// ─── SCHEDULING ─────────────────────────────────────────────────────

/**
 * Schedule the full 3-stage health check pipeline.
 * 
 * Stage 1 (5 min):  Infrastructure — verify hosting is up, no 500, Anti-Red OK
 * Stage 2 (30 min): Content — detect user uploads, auto-redirect if needed
 * Stage 3 (2 hr):   Full — end-to-end through CF, fix remaining issues
 */
function scheduleHealthCheck(domain, cpUsername, chatId) {
  const key = `${domain}:${cpUsername}`

  // Cancel any existing checks for this domain
  if (scheduledChecks.has(key)) {
    for (const timer of scheduledChecks.get(key)) {
      clearTimeout(timer)
    }
  }

  const timers = []
  const stages = [
    { stage: 1, delay: 5 * 60 * 1000, name: 'infra' },       // 5 min
    { stage: 2, delay: 30 * 60 * 1000, name: 'content' },     // 30 min
    { stage: 3, delay: 2 * 60 * 60 * 1000, name: 'full' },    // 2 hr
  ]

  for (const { stage, delay, name } of stages) {
    const timer = setTimeout(async () => {
      try {
        log(`[HealthCheck] Stage ${stage} (${name}) starting for ${domain}...`)
        const results = await runHealthCheck(domain, cpUsername, stage)
        await reportResults(domain, cpUsername, chatId, results, stage)
      } catch (err) {
        log(`[HealthCheck] Stage ${stage} error for ${domain}: ${err.message}`)
      }
    }, delay)
    timers.push(timer)
  }

  scheduledChecks.set(key, timers)
  log(`[HealthCheck] 3-stage pipeline scheduled for ${domain} (${cpUsername}): 5min/30min/2hr`)
}

/**
 * Schedule a single-stage health check (for renewals or manual triggers)
 */
function scheduleSingleCheck(domain, cpUsername, chatId, delayMs = 2 * 60 * 1000) {
  const key = `${domain}:${cpUsername}:single`

  if (scheduledChecks.has(key)) {
    clearTimeout(scheduledChecks.get(key))
  }

  const timer = setTimeout(async () => {
    scheduledChecks.delete(key)
    try {
      const results = await runHealthCheck(domain, cpUsername, 3) // full check
      await reportResults(domain, cpUsername, chatId, results, 3)
    } catch (err) {
      log(`[HealthCheck] Single check error for ${domain}: ${err.message}`)
    }
  }, delayMs)

  scheduledChecks.set(key, timer)
  log(`[HealthCheck] Single check scheduled for ${domain} in ${delayMs / 1000}s`)
}


// ─── CORE HEALTH CHECK ──────────────────────────────────────────────

/**
 * Run health check for a specific stage
 * 
 * @param {string} domain 
 * @param {string} cpUsername 
 * @param {number} stage - 1=infra, 2=content, 3=full
 */
async function runHealthCheck(domain, cpUsername, stage = 3) {
  const results = {
    timestamp: new Date().toISOString(),
    domain,
    cpUsername,
    stage,
    checks: {},
    autoFixes: [],
    issues: [],
    warnings: [],
  }

  // ── Stage 1: Infrastructure (always runs) ──
  if (stage >= 1) {
    // 1a. Direct origin check (root)
    try {
      results.checks.originRoot = await httpCheck(domain, '/', ORIGIN_DIRECT_IP, { followRedirects: false })
      log(`[HealthCheck] ${domain} origin root: HTTP ${results.checks.originRoot.status}`)
    } catch (err) {
      results.checks.originRoot = { error: err.code || err.message }
      log(`[HealthCheck] ${domain} origin root: not reachable (${err.code || err.message})`)
    }

    // 1b. Check .htaccess integrity
    try {
      results.checks.htaccess = await checkHtaccessIntegrity(cpUsername)
    } catch (err) {
      results.checks.htaccess = { error: err.message }
    }

    // 1c. Check prepend config
    try {
      results.checks.prepend = await checkPrependConfig(cpUsername)
    } catch (err) {
      results.checks.prepend = { error: err.message }
    }

    // 1d. Auto-fix infrastructure issues
    await fixInfraIssues(results)
  }

  // ── Stage 2: Content detection (30 min — user had time to upload) ──
  if (stage >= 2) {
    // 2a. Detect user content location (recursive, up to 3 levels)
    try {
      results.checks.content = await detectUserContent(cpUsername)
      log(`[HealthCheck] ${domain} content: ${results.checks.content.location || 'not found'}`)
    } catch (err) {
      results.checks.content = { error: err.message }
    }

    // 2b. Detect antibot presence
    try {
      results.checks.antibot = await detectAntibot(cpUsername, results.checks.content)
      if (results.checks.antibot.detected) {
        log(`[HealthCheck] ${domain} has user antibot in: ${results.checks.antibot.locations.join(', ')}`)
      }
    } catch (err) {
      results.checks.antibot = { error: err.message }
    }

    // 2c. Handle redirect needs
    await fixContentIssues(results)
  }

  // ── Stage 3: Full E2E (2 hr — DNS + SSL should be fully propagated) ──
  if (stage >= 3) {
    // 3a. Check through Cloudflare
    try {
      results.checks.throughCF = await httpCheck(domain, '/', null, { followRedirects: true })
      log(`[HealthCheck] ${domain} through CF: HTTP ${results.checks.throughCF.status}`)
    } catch (err) {
      results.checks.throughCF = { error: err.message }
    }

    // 3b. If there's a redirect, test the target with a simulated real user
    const redirectUrl = results.checks.originRoot?.redirectUrl
    if (redirectUrl) {
      try {
        const path = new URL(redirectUrl, `https://${domain}`).pathname
        results.checks.redirectTarget = await httpCheck(domain, path, ORIGIN_DIRECT_IP, {
          headers: { 'CF-Connecting-IP': '98.45.123.67' }, // Simulate real visitor IP
        })
        log(`[HealthCheck] ${domain} redirect target: HTTP ${results.checks.redirectTarget.status}`)
      } catch (err) {
        results.checks.redirectTarget = { error: err.message }
      }
    }

    // 3c. Verify antibot + IP fix interaction
    if (results.checks.antibot?.detected) {
      await verifyAntibotIPFix(results)
    }

    // 3d. Final fixes
    await fixE2EIssues(results)

    // 3e. Post-fix recheck
    if (results.autoFixes.length > 0) {
      await sleep(5000)
      try {
        results.checks.postFix = await httpCheck(domain, '/', ORIGIN_DIRECT_IP, {
          followRedirects: true,
          headers: { 'CF-Connecting-IP': '98.45.123.67' },
        })
        log(`[HealthCheck] ${domain} post-fix: HTTP ${results.checks.postFix.status}`)
      } catch (err) {
        results.checks.postFix = { error: err.message }
      }
    }
  }

  log(`[HealthCheck] Stage ${stage} complete for ${domain}: ${results.issues.length} issues, ${results.autoFixes.length} fixes, ${results.warnings.length} warnings`)
  return results
}


// ─── CONTENT DETECTION (SMART PATH FINDING) ─────────────────────────

/**
 * Recursively detect where user uploaded their content.
 * Scans up to 3 levels deep, finds index.php/index.html, detects content folders.
 * 
 * Returns:
 *   location: 'public_html' | 'public_html/SubDir/...' | 'empty'
 *   needsRedirect: true if content is in subdirectory and root has no index
 *   redirectTarget: '/SubDir/path/' — the deepest path with an index file
 *   contentPaths: all paths where index files were found
 *   userHtaccessRedirect: existing redirect in user's .htaccess (if any)
 */
async function detectUserContent(cpUsername) {
  if (!whmApi) return { error: 'WHM not configured' }

  const result = {
    location: 'empty',
    needsRedirect: false,
    redirectTarget: null,
    contentPaths: [],       // all paths with index files
    hasRootIndex: false,
    userHtaccessRedirect: null,
    totalFiles: 0,
  }

  try {
    // Scan root level (throws when WHM can't be reached → reported as "could not check", never "empty")
    const rootScan = await scanDirectory(cpUsername, '/public_html')
    result.hasRootIndex = rootScan.hasIndex
    result.totalFiles = rootScan.fileCount

    if (rootScan.hasIndex) {
      result.contentPaths.push({ path: '/', files: rootScan.files, indexFile: rootScan.indexFile })
      result.location = 'public_html'
    }

    // Check if user already has a redirect in their sub-.htaccess
    if (rootScan.files.includes('.htaccess')) {
      result.userHtaccessRedirect = await detectExistingRedirect(cpUsername, '/public_html')
    }

    // Scan subdirectories (level 1)
    const userDirs = rootScan.dirs.filter(d => d !== 'cgi-bin')
    for (const dir of userDirs) {
      const l1Path = `/public_html/${dir}`
      const l1Scan = await scanDirectory(cpUsername, l1Path).catch(e => { result.scanErrors = (result.scanErrors || 0) + 1; log(`[HealthCheck] scan ${l1Path} failed: ${e.message}`); return EMPTY_SCAN() })

      if (l1Scan.hasIndex) {
        result.contentPaths.push({ path: `/${dir}/`, files: l1Scan.files, indexFile: l1Scan.indexFile })
      }

      // Scan level 2
      for (const subDir of l1Scan.dirs) {
        const l2Path = `${l1Path}/${subDir}`
        const l2Scan = await scanDirectory(cpUsername, l2Path).catch(e => { result.scanErrors = (result.scanErrors || 0) + 1; log(`[HealthCheck] scan ${l2Path} failed: ${e.message}`); return EMPTY_SCAN() })

        if (l2Scan.hasIndex) {
          result.contentPaths.push({ path: `/${dir}/${subDir}/`, files: l2Scan.files, indexFile: l2Scan.indexFile })
        }

        // Scan level 3
        for (const subSubDir of l2Scan.dirs) {
          const l3Path = `${l2Path}/${subSubDir}`
          const l3Scan = await scanDirectory(cpUsername, l3Path).catch(e => { result.scanErrors = (result.scanErrors || 0) + 1; log(`[HealthCheck] scan ${l3Path} failed: ${e.message}`); return EMPTY_SCAN() })

          if (l3Scan.hasIndex) {
            result.contentPaths.push({ path: `/${dir}/${subDir}/${subSubDir}/`, files: l3Scan.files, indexFile: l3Scan.indexFile })
          }
        }
      }
    }

    // Determine redirect needs
    if (!result.hasRootIndex && result.contentPaths.length === 1) {
      // Content in exactly ONE subdirectory — safe to auto-redirect
      result.needsRedirect = true
      result.redirectTarget = result.contentPaths[0].path
      result.location = `public_html${result.contentPaths[0].path}`
    } else if (!result.hasRootIndex && result.contentPaths.length > 1) {
      // Content in MULTIPLE subdirectories — can't auto-decide
      result.needsRedirect = false
      result.redirectTarget = null
      result.location = 'multiple_paths'
      result.ambiguousPaths = result.contentPaths.map(p => p.path)
    } else if (!result.hasRootIndex && result.contentPaths.length === 0) {
      result.location = 'empty'
    }

    // If user already has their own redirect, respect it
    if (result.userHtaccessRedirect) {
      result.needsRedirect = false
      result.location = `user_redirect:${result.userHtaccessRedirect}`
    }

    return result
  } catch (err) {
    return { error: err.message }
  }
}

/**
 * Scan a single directory for files, subdirectories, and index presence.
 * THROWS when WHM can't be asked (timeout / auth / API error) — the caller must not mistake an
 * unreachable WHM for an empty folder.
 */
const EMPTY_SCAN = () => ({ files: [], dirs: [], hasIndex: false, indexFile: null, fileCount: 0 })
function _listfilesData(res, what) {
  const cr = res && res.data && res.data.cpanelresult
  if (!cr) throw new Error(`listfiles ${what}: unexpected WHM response`)
  if (cr.error || (cr.event && cr.event.result === 0)) throw new Error(`listfiles ${what}: ${cr.error || cr.event.reason || 'failed'}`)
  return Array.isArray(cr.data) ? cr.data : []
}
async function scanDirectory(cpUsername, dirPath) {
  const result = EMPTY_SCAN()

  // List files
  const fileRes = await whmApi.get('/cpanel', {
    params: {
      cpanel_jsonapi_user: cpUsername,
      cpanel_jsonapi_apiversion: 2,
      cpanel_jsonapi_module: 'Fileman',
      cpanel_jsonapi_func: 'listfiles',
      dir: `/home/${cpUsername}${dirPath}`,
      types: 'file',
      showdotfiles: 1,
    },
  })
  result.files = _listfilesData(fileRes, 'files')
    .map(f => f.file || f.name)
    .filter(Boolean)
  result.fileCount = result.files.length

  // Check for index files (priority: index.php > index.html > default.php)
  for (const idx of ['index.php', 'index.html', 'index.htm', 'default.php', 'home.php', 'main.php']) {
    if (result.files.includes(idx)) {
      result.hasIndex = true
      result.indexFile = idx
      break
    }
  }

  // List directories
  const dirRes = await whmApi.get('/cpanel', {
    params: {
      cpanel_jsonapi_user: cpUsername,
      cpanel_jsonapi_apiversion: 2,
      cpanel_jsonapi_module: 'Fileman',
      cpanel_jsonapi_func: 'listfiles',
      dir: `/home/${cpUsername}${dirPath}`,
      types: 'dir',
      showdotfiles: 0,
    },
  })
  result.dirs = _listfilesData(dirRes, 'dirs')
    .map(d => d.file || d.name)
    .filter(Boolean)

  return result
}

/**
 * Detect if the user already has a redirect rule in their .htaccess
 * (e.g., RewriteRule ^$ /something/ [R=301,L])
 */
async function detectExistingRedirect(cpUsername, dirPath) {
  try {
    const res = await whmApi.get('/cpanel', {
      params: {
        'api.version': 1,
        cpanel_jsonapi_user: cpUsername,
        cpanel_jsonapi_apiversion: 3,
        cpanel_jsonapi_module: 'Fileman',
        cpanel_jsonapi_func: 'get_file_content',
        dir: dirPath.replace(`/home/${cpUsername}`, ''),
        file: '.htaccess',
      },
    })
    const content = res.data?.result?.data?.content || ''

    // Look for redirect rules (not our Anti-Red ones)
    const lines = content.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      // Skip comments and our own rules
      if (trimmed.startsWith('#') || trimmed.includes('Anti-Red')) continue
      // Detect RewriteRule with [R] or [R=30x] or Redirect directive
      const redirectMatch = trimmed.match(/RewriteRule\s+\^\$?\s+(\S+)\s+\[.*R.*\]/i)
        || trimmed.match(/Redirect\s+\d+\s+\/\s+(\S+)/i)
      if (redirectMatch) {
        return redirectMatch[1]
      }
    }
    return null
  } catch (_) {
    return null
  }
}


// ─── ANTIBOT DETECTION ──────────────────────────────────────────────

/**
 * Detect if user uploaded files contain their own anti-bot protection.
 * This affects how we test the site and what fixes we apply.
 */
async function detectAntibot(cpUsername, contentInfo) {
  if (!whmApi || !contentInfo?.contentPaths?.length) {
    return { detected: false, locations: [], signatures: [] }
  }

  const result = { detected: false, locations: [], signatures: [] }

  for (const cp of contentInfo.contentPaths) {
    const dirPath = `/public_html${cp.path}`.replace(/\/$/, '')

    try {
      // Check if there's an antibots/ directory
      const scan = await scanDirectory(cpUsername, dirPath)
      if (scan.dirs.some(d => d.toLowerCase().includes('antibot') || d.toLowerCase().includes('anti-bot'))) {
        result.detected = true
        result.locations.push(cp.path)
        result.signatures.push('antibots_directory')
      }

      // Check the index file for antibot signatures
      if (cp.indexFile) {
        try {
          const fileRes = await whmApi.get('/cpanel', {
            params: {
              'api.version': 1,
              cpanel_jsonapi_user: cpUsername,
              cpanel_jsonapi_apiversion: 3,
              cpanel_jsonapi_module: 'Fileman',
              cpanel_jsonapi_func: 'get_file_content',
              dir: dirPath,
              file: cp.indexFile,
            },
          })
          const content = fileRes.data?.result?.data?.content || ''
          const contentLower = content.toLowerCase()

          for (const sig of ANTIBOT_SIGNATURES) {
            if (contentLower.includes(sig.toLowerCase())) {
              if (!result.signatures.includes(sig)) result.signatures.push(sig)
              result.detected = true
              if (!result.locations.includes(cp.path)) result.locations.push(cp.path)
            }
          }
        } catch (_) {}
      }

      // Check for user's .htaccess with deny rules
      if (scan.files.includes('.htaccess')) {
        try {
          const htRes = await whmApi.get('/cpanel', {
            params: {
              'api.version': 1,
              cpanel_jsonapi_user: cpUsername,
              cpanel_jsonapi_apiversion: 3,
              cpanel_jsonapi_module: 'Fileman',
              cpanel_jsonapi_func: 'get_file_content',
              dir: dirPath,
              file: '.htaccess',
            },
          })
          const htContent = htRes.data?.result?.data?.content || ''

          // Check for extensive deny rules (more than 10 deny lines = user has antibot)
          const denyCount = (htContent.match(/deny from/gi) || []).length
          if (denyCount > 10) {
            result.detected = true
            if (!result.signatures.includes('htaccess_deny_rules')) result.signatures.push('htaccess_deny_rules')
            if (!result.locations.includes(cp.path)) result.locations.push(cp.path)
          }

          // Check for .htaccess syntax errors
          const syntaxIssues = detectHtaccessSyntaxErrors(htContent)
          if (syntaxIssues.length > 0) {
            result.htaccessIssues = result.htaccessIssues || []
            result.htaccessIssues.push({ path: cp.path, issues: syntaxIssues })
          }
        } catch (_) {}
      }
    } catch (_) {}
  }

  return result
}

/**
 * Detect common .htaccess syntax errors that cause 500s
 */
function detectHtaccessSyntaxErrors(content) {
  const issues = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const lineNum = i + 1

    // "deny from deny from ..." — duplicate keyword
    if (/^deny\s+from\s+deny\s+from/i.test(line)) {
      issues.push({ line: lineNum, type: 'duplicate_deny', text: line.substring(0, 80) })
    }

    // "deny from [non-IP text]" — invalid value
    if (/^deny\s+from\s+/i.test(line)) {
      const value = line.replace(/^deny\s+from\s+/i, '').trim()
      if (value && !/^[\d\.\/]+$/.test(value) && !/^env=/.test(value) && !/^all$/i.test(value)) {
        // Value is not an IP, CIDR, env=, or 'all'
        issues.push({ line: lineNum, type: 'invalid_deny_value', text: line.substring(0, 80) })
      }
    }

    // HTML entities in directives
    if (/&lt;|&gt;|&amp;/.test(line)) {
      issues.push({ line: lineNum, type: 'html_entities', text: line.substring(0, 80) })
    }
  }

  return issues
}


// ─── FIX FUNCTIONS ──────────────────────────────────────────────────

/**
 * Stage 1 fixes: Infrastructure issues (500 errors, broken .htaccess, wrong prepend)
 */
async function fixInfraIssues(results) {
  const { checks, domain, cpUsername } = results

  // Fix HTTP 500 from origin
  if (checks.originRoot?.status === 500) {
    results.issues.push('Origin returns HTTP 500')

    // Redeploy .htaccess if it has issues
    const htIssues = checks.htaccess?.issues || []
    if (htIssues.some(i => i.type === 'html_entities' || i.type === 'remoteip_in_htaccess' || i.type === 'missing_antired')) {
      try {
        const antiRedService = require('./anti-red-service')
        await antiRedService.deployHtaccess(cpUsername, domain)
        results.autoFixes.push(`Redeployed .htaccess (${htIssues.map(i => i.type).join(', ')})`)
      } catch (err) {
        results.issues.push(`Failed to redeploy .htaccess: ${err.message}`)
      }
    }
  }

  // Fix JS challenge when CF Worker is active
  if (checks.prepend?.hasJsChallenge) {
    try {
      const antiRedService = require('./anti-red-service')
      // force: health-check just verified the prepend is the JS challenge
      // (not the IP-fix) — we MUST overwrite, bypass the idempotency cache.
      await antiRedService.deployCFIPFix(cpUsername, { force: true })
      results.autoFixes.push('Replaced JS challenge with IP-fix prepend (CF Worker handles bot detection)')
    } catch (err) {
      results.issues.push(`Failed to replace JS challenge: ${err.message}`)
    }
  }

  // Couldn't read the prepend config → don't guess, don't redeploy
  if (checks.prepend?.error) {
    results.warnings.push(`Could not read the prepend config (${checks.prepend.error}) — IP-fix check skipped.`)
  }

  // Ensure IP fix is deployed
  if (checks.prepend && !checks.prepend.error && !checks.prepend.hasIPFix && !checks.prepend.hasJsChallenge) {
    try {
      const antiRedService = require('./anti-red-service')
      // force: health-check confirmed the IP-fix prepend is MISSING on WHM —
      // the idempotency cache must NOT skip the write here.
      await antiRedService.deployCFIPFix(cpUsername, { force: true })
      results.autoFixes.push('Deployed IP-fix prepend (was missing)')
    } catch (err) {
      results.issues.push(`Failed to deploy IP fix: ${err.message}`)
    }
  }
}

/**
 * Stage 2 fixes: Content issues (redirects, missing uploads)
 */
async function fixContentIssues(results) {
  const { checks, domain, cpUsername } = results
  const content = checks.content

  if (!content) return

  // Couldn't list the files → say so; never claim the user uploaded nothing
  if (content.error) {
    results.warnings.push(`Could not check uploaded files (${content.error}) — content check skipped.`)
    return
  }

  // Auto-redirect when content is in exactly one subdirectory
  if (content.needsRedirect && content.redirectTarget) {
    try {
      await addRootRedirect(cpUsername, content.redirectTarget)
      results.autoFixes.push(`Added root redirect → ${content.redirectTarget} (content in subdirectory)`)
    } catch (err) {
      results.issues.push(`Failed to add redirect to ${content.redirectTarget}: ${err.message}`)
    }
  }

  // Multiple content paths — can't auto-decide, notify admin
  if (content.location === 'multiple_paths') {
    results.warnings.push(
      `Content found in multiple paths: ${content.ambiguousPaths.join(', ')}. `
      + `Cannot auto-redirect — user should be asked which is their main page.`
    )
  }

  // No content uploaded
  if (content.location === 'empty') {
    results.warnings.push(
      'No user content found in public_html. User needs to upload files via HostPanel File Manager. '
      + 'Files should be uploaded to the public_html folder (or a subfolder like /site/).'
    )
  }

  // User's .htaccess in subdirectory has syntax errors
  if (checks.antibot?.htaccessIssues?.length > 0) {
    for (const { path, issues } of checks.antibot.htaccessIssues) {
      const fixable = issues.filter(i => i.type === 'duplicate_deny' || i.type === 'invalid_deny_value')
      if (fixable.length > 0) {
        try {
          await fixUserHtaccessSyntax(cpUsername, path, fixable)
          results.autoFixes.push(`Fixed ${fixable.length} .htaccess syntax errors in ${path}`)
        } catch (err) {
          results.warnings.push(`Could not auto-fix .htaccess in ${path}: ${err.message}`)
        }
      }
    }
  }
}

/**
 * Stage 3 fixes: E2E issues (CF worker, SSL, final verification)
 */
async function fixE2EIssues(results) {
  const { checks } = results

  // CF Worker showing Access Denied too aggressively
  if (checks.throughCF?.hasAccessDenied) {
    results.warnings.push('CF Worker blocking automated browsers — real users with standard browsers should pass through.')
  }

  // Redirect target returning 404 (user's antibot blocking)
  if (checks.redirectTarget?.has404Content) {
    if (results.checks.antibot?.detected) {
      results.warnings.push(
        'User\'s antibot code returns 404 for datacenter IPs. '
        + 'IP-fix prepend restores real visitor IP from CF-Connecting-IP — real users should see the page.'
      )
    } else {
      results.issues.push('Redirect target returns 404 but no antibot detected — content may be missing or broken')
    }
  }
}

/**
 * Verify that the IP fix works correctly with the user's antibot code.
 * Tests: request with CF-Connecting-IP header should get through (not 404).
 */
async function verifyAntibotIPFix(results) {
  const { domain, checks } = results
  const redirectUrl = checks.originRoot?.redirectUrl
  const path = redirectUrl
    ? new URL(redirectUrl, `https://${domain}`).pathname
    : '/'

  try {
    // Test WITHOUT CF-Connecting-IP (should be blocked by antibot)
    const withoutIP = await httpCheck(domain, path, ORIGIN_DIRECT_IP, {})
    
    // Test WITH CF-Connecting-IP (should pass through)
    const withIP = await httpCheck(domain, path, ORIGIN_DIRECT_IP, {
      headers: { 'CF-Connecting-IP': '76.187.45.123' },
    })

    results.checks.antibotIPTest = {
      withoutCFIP: { status: withIP.status, blocked: withoutIP.has404Content || withoutIP.status === 403 },
      withCFIP: { status: withIP.status, blocked: withIP.has404Content || withIP.status === 403 },
      ipFixWorking: !withIP.has404Content && !withIP.has500Content && withIP.status !== 403,
    }

    if (results.checks.antibotIPTest.ipFixWorking) {
      log(`[HealthCheck] ✅ IP fix working for ${domain}: real users pass antibot with CF-Connecting-IP`)
    } else {
      results.warnings.push(
        'IP-fix test inconclusive — user\'s antibot may check more than just IP (referrer, cookies, etc.)'
      )
    }
  } catch (err) {
    results.checks.antibotIPTest = { error: err.message }
  }
}


// ─── HTACCESS FIXES ─────────────────────────────────────────────────

/**
 * Add a root redirect to .htaccess (only when we're sure about the target)
 */
async function addRootRedirect(cpUsername, targetPath) {
  if (!whmApi) throw new Error('WHM not configured')

  // Read current .htaccess
  const readRes = await whmApi.get('/cpanel', {
    params: {
      'api.version': 1,
      cpanel_jsonapi_user: cpUsername,
      cpanel_jsonapi_apiversion: 3,
      cpanel_jsonapi_module: 'Fileman',
      cpanel_jsonapi_func: 'get_file_content',
      dir: '/public_html',
      file: '.htaccess',
    },
  })
  let content = readRes.data?.result?.data?.content || ''

  // Don't add if redirect already exists
  if (content.includes('Redirect root to website content') || content.includes(`RewriteRule ^$ ${targetPath}`)) {
    return
  }

  // Don't add if user has their own redirect
  if (content.match(/RewriteRule\s+\^\$?\s+\S+\s+\[.*R.*\]/i)) {
    return
  }

  // Insert redirect AFTER UA blocking rules (so scanners get blocked before redirect)
  // Look for the last RewriteRule that returns [F,L] and insert after it
  const lines = content.split('\n')
  let insertAfter = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('[F,L]') && lines[i].includes('RewriteRule')) {
      insertAfter = i
    }
  }

  const redirectLine = `\n  # Redirect root to website content (auto-detected by Health Check)\n  RewriteRule ^$ ${targetPath} [L,R=302]\n`

  if (insertAfter >= 0) {
    lines.splice(insertAfter + 1, 0, redirectLine)
    content = lines.join('\n')
  } else if (content.includes('RewriteEngine On')) {
    // Fallback: insert after RewriteEngine On
    content = content.replace('RewriteEngine On', 'RewriteEngine On\n' + redirectLine)
  }

  // Write back
  await whmApi.get('/cpanel', {
    params: {
      'api.version': 1,
      cpanel_jsonapi_user: cpUsername,
      cpanel_jsonapi_apiversion: 3,
      cpanel_jsonapi_module: 'Fileman',
      cpanel_jsonapi_func: 'save_file_content',
      dir: '/public_html',
      file: '.htaccess',
      content,
    },
  })

  log(`[HealthCheck] Added root redirect → ${targetPath} for ${cpUsername}`)
}

/**
 * Fix syntax errors in user's .htaccess (comment out bad lines)
 */
async function fixUserHtaccessSyntax(cpUsername, contentPath, issues) {
  if (!whmApi) throw new Error('WHM not configured')

  const dirPath = `/public_html${contentPath}`.replace(/\/$/, '')

  const readRes = await whmApi.get('/cpanel', {
    params: {
      'api.version': 1,
      cpanel_jsonapi_user: cpUsername,
      cpanel_jsonapi_apiversion: 3,
      cpanel_jsonapi_module: 'Fileman',
      cpanel_jsonapi_func: 'get_file_content',
      dir: dirPath,
      file: '.htaccess',
    },
  })
  let content = readRes.data?.result?.data?.content || ''
  if (!content) return

  const lines = content.split('\n')
  let fixed = 0

  for (const issue of issues) {
    const lineIdx = issue.line - 1
    if (lineIdx >= 0 && lineIdx < lines.length) {
      const originalLine = lines[lineIdx]
      // Comment out the broken line with explanation
      lines[lineIdx] = `# [Auto-fixed by Nomadly Health Check] ${originalLine}`
      fixed++
    }
  }

  if (fixed > 0) {
    // Create backup first
    await whmApi.get('/cpanel', {
      params: {
        'api.version': 1,
        cpanel_jsonapi_user: cpUsername,
        cpanel_jsonapi_apiversion: 3,
        cpanel_jsonapi_module: 'Fileman',
        cpanel_jsonapi_func: 'save_file_content',
        dir: dirPath,
        file: '.htaccess.bak',
        content,
      },
    })

    // Write fixed version
    await whmApi.get('/cpanel', {
      params: {
        'api.version': 1,
        cpanel_jsonapi_user: cpUsername,
        cpanel_jsonapi_apiversion: 3,
        cpanel_jsonapi_module: 'Fileman',
        cpanel_jsonapi_func: 'save_file_content',
        dir: dirPath,
        file: '.htaccess',
        content: lines.join('\n'),
      },
    })

    log(`[HealthCheck] Fixed ${fixed} syntax errors in ${dirPath}/.htaccess`)
  }
}


// ─── HTTP CHECK HELPER ──────────────────────────────────────────────

async function httpCheck(domain, path, directIP, options = {}) {
  const { followRedirects = false, headers = {} } = options
  const url = `https://${domain}${path}`

  const requestConfig = {
    url,
    method: 'GET',
    timeout: 15000,
    maxRedirects: followRedirects ? 5 : 0,
    validateStatus: () => true,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ...headers,
    },
  }

  if (directIP) {
    requestConfig.httpsAgent = new https.Agent({
      rejectUnauthorized: false,
      lookup: (_hostname, _opts, callback) => {
        callback(null, directIP, 4)
      },
    })
  }

  try {
    const response = await axios(requestConfig)
    const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data || '')

    return {
      status: response.status,
      bodySize: body.length,
      redirectUrl: response.headers?.location || null,
      hasAntiRedChallenge: body.includes('Anti-Red JS Challenge'),
      hasAccessDenied: body.includes('Access Denied') || body.includes('AR-'),
      has404Content: body.includes('404 Not Found') || body.includes('not be found'),
      has500Content: body.includes('Internal Server Error'),
      hasActualContent: body.length > 500 && !body.includes('404 Not Found') && !body.includes('Internal Server Error'),
      contentSnippet: body.substring(0, 200),
      xAntiRed: response.headers?.['x-antired'] || null,
    }
  } catch (err) {
    if (err.response) {
      return {
        status: err.response.status,
        error: err.message,
        redirectUrl: err.response.headers?.location || null,
      }
    }
    throw err
  }
}


// ─── HTACCESS INTEGRITY CHECK ───────────────────────────────────────

async function checkHtaccessIntegrity(cpUsername) {
  if (!whmApi) return { error: 'WHM not configured' }

  const issues = []
  try {
    const readRes = await whmApi.get('/cpanel', {
      params: {
        'api.version': 1,
        cpanel_jsonapi_user: cpUsername,
        cpanel_jsonapi_apiversion: 3,
        cpanel_jsonapi_module: 'Fileman',
        cpanel_jsonapi_func: 'get_file_content',
        dir: '/public_html',
        file: '.htaccess',
      },
    })
    if (!readRes.data?.result) throw new Error('get_file_content .htaccess: unexpected WHM response')
    const content = readRes.data.result.data?.content || ''

    if (content.includes('&lt;') || content.includes('&gt;')) {
      issues.push({ type: 'html_entities', desc: 'Contains HTML entities instead of < >' })
    }
    if (!content.includes('Anti-Red')) {
      issues.push({ type: 'missing_antired', desc: 'Anti-Red rules not present' })
    }
    if (content.includes('RemoteIPHeader')) {
      issues.push({ type: 'remoteip_in_htaccess', desc: 'mod_remoteip in .htaccess (causes 500)' })
    }

    return { issues, rootHtaccessLength: content.length }
  } catch (err) {
    return { error: err.code || err.message, issues }
  }
}


// ─── PREPEND CONFIG CHECK ───────────────────────────────────────────

async function checkPrependConfig(cpUsername) {
  if (!whmApi) return { error: 'WHM not configured' }

  try {
    // A network/auth failure must surface as { error } (→ "could not check", no redeploy). A missing
    // file is a normal UAPI answer (status 0 / errors) → empty content → genuinely "none".
    let userIniContent = ''
    {
      const iniRes = await whmApi.get('/cpanel', {
        params: {
          'api.version': 1,
          cpanel_jsonapi_user: cpUsername,
          cpanel_jsonapi_apiversion: 3,
          cpanel_jsonapi_module: 'Fileman',
          cpanel_jsonapi_func: 'get_file_content',
          dir: '/public_html',
          file: '.user.ini',
        },
      })
      if (!iniRes.data?.result) throw new Error('get_file_content .user.ini: unexpected WHM response')
      userIniContent = iniRes.data.result.data?.content || ''
    }

    let challengeContent = ''
    {
      const phpRes = await whmApi.get('/cpanel', {
        params: {
          'api.version': 1,
          cpanel_jsonapi_user: cpUsername,
          cpanel_jsonapi_apiversion: 3,
          cpanel_jsonapi_module: 'Fileman',
          cpanel_jsonapi_func: 'get_file_content',
          dir: '/public_html',
          file: '.antired-challenge.php',
        },
      })
      if (!phpRes.data?.result) throw new Error('get_file_content .antired-challenge.php: unexpected WHM response')
      challengeContent = phpRes.data.result.data?.content || ''
    }

    const hasJsChallenge = challengeContent.includes('JS Challenge') && challengeContent.includes('echo')
    const hasIPFix = challengeContent.includes('ANTIRED_IP_FIXED') || challengeContent.includes('CF_CONNECTING_IP')
    const hasPrepend = userIniContent.includes('auto_prepend_file')

    return {
      hasPrepend,
      hasJsChallenge,
      hasIPFix,
      type: hasIPFix ? 'ip_fix' : hasJsChallenge ? 'js_challenge' : hasPrepend ? 'unknown' : 'none',
    }
  } catch (err) {
    return { error: err.code || err.message }
  }
}


// ─── TELEGRAM REPORTING ─────────────────────────────────────────────

async function reportResults(domain, cpUsername, chatId, results, stage) {
  const { issues, autoFixes, warnings, checks } = results

  const stageNames = { 1: '🔧 Infra', 2: '📁 Content', 3: '🌐 Full E2E' }
  let status = '✅'
  if (issues.length > 0) status = '❌'
  else if (warnings.length > 0) status = '⚠️'

  let msg = `${status} <b>Health Check Stage ${stage} (${stageNames[stage]}): ${domain}</b>\n`
  msg += `User: <code>${cpUsername}</code>\n\n`

  // Origin status
  if (checks.originRoot) {
    msg += checks.originRoot.status
      ? `<b>${ORIGIN_LABEL}:</b> HTTP ${checks.originRoot.status}`
      : `<b>${ORIGIN_LABEL}:</b> not reachable yet (${_esc(checks.originRoot.error || 'no response')})`
    if (checks.originRoot.redirectUrl) msg += ` → ${_esc(checks.originRoot.redirectUrl)}`
    msg += '\n'
  }

  // CF status (Stage 3 only)
  if (checks.throughCF) {
    msg += `<b>Through CF:</b> HTTP ${checks.throughCF.status || 'N/A'}`
    if (checks.throughCF.xAntiRed) msg += ` (${checks.throughCF.xAntiRed})`
    msg += '\n'
  }

  // Content info
  if (checks.content) {
    msg += checks.content.error ? `<b>Content:</b> could not check (${_esc(checks.content.error)})` : `<b>Content:</b> ${checks.content.location || 'unknown'}`
    if (checks.content.contentPaths?.length > 0) {
      msg += ` (${checks.content.contentPaths.map(p => p.path).join(', ')})`
    }
    msg += '\n'
  }

  // Antibot info
  if (checks.antibot?.detected) {
    msg += `<b>Antibot:</b> Detected (${checks.antibot.signatures.join(', ')})\n`
  }

  // IP fix test (Stage 3)
  if (checks.antibotIPTest) {
    const ipTest = checks.antibotIPTest
    msg += `<b>IP Fix:</b> ${ipTest.ipFixWorking ? '✅ Working' : '⚠️ Inconclusive'}\n`
  }

  // Prepend type
  if (checks.prepend) {
    msg += `<b>Prepend:</b> ${checks.prepend.error ? `could not check (${_esc(checks.prepend.error)})` : checks.prepend.type}\n`
  }

  // Auto-fixes
  if (autoFixes.length > 0) {
    msg += '\n<b>🔧 Auto-Fixes:</b>\n'
    for (const fix of autoFixes) msg += `• ${fix}\n`
  }

  // Issues
  if (issues.length > 0) {
    msg += '\n<b>❌ Issues:</b>\n'
    for (const issue of issues) msg += `• ${issue}\n`
  }

  // Warnings
  if (warnings.length > 0) {
    msg += '\n<b>⚠️ Warnings:</b>\n'
    for (const warn of warnings) msg += `• ${warn}\n`
  }

  // Post-fix status
  if (checks.postFix) {
    msg += `\n<b>Post-Fix:</b> HTTP ${checks.postFix.status}${checks.postFix.hasActualContent ? ' ✅' : ''}\n`
  }

  // Send to admin
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN_PROD || process.env.TELEGRAM_BOT_TOKEN_DEV
    const adminChatId = TELEGRAM_DEV_CHAT_ID || chatId
    if (botToken && adminChatId) {
      await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        chat_id: adminChatId,
        text: msg,
        parse_mode: 'HTML',
      }, { timeout: 10000 })
    }
  } catch (err) {
    log(`[HealthCheck] Telegram report failed for ${domain}: ${err.message}`)
  }

  return msg
}


// ─── UTILITIES ──────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function _esc(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 120)
}


// ─── EXPORTS ────────────────────────────────────────────────────────

module.exports = {
  scheduleHealthCheck,
  scheduleSingleCheck,
  runHealthCheck,
  detectUserContent,
  detectAntibot,
  checkHtaccessIntegrity,
  checkPrependConfig,
  // exported for tests
  scanDirectory, reportResults, httpCheck, _routing: { WHM_BASE, ORIGIN_DIRECT_IP, ORIGIN_LABEL },
}
