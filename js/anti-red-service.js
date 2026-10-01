/* global process */
/**
 * Anti-Red Protection Service
 * 
 * Provides four layers of scanner/bot protection for hosted sites:
 * 1. .htaccess rules — Block known scanner IP ranges & user-agents (full cloaking)
 * 2. JS Challenge — Client-side bot detection (headless browser, WebDriver, missing APIs)
 *    → Static sites: injected directly into HTML
 *    → PHP sites: via auto_prepend_file
 * 3. TLS/JA3 fingerprinting — Cloudflare WAF rules blocking known scanner TLS fingerprints
 * 4. Cloudflare Worker — Edge-level challenge injection & scanner blocking (survives redeployments)
 */

require('dotenv').config()
const axios = require('axios')
const { log } = require('console')
const { getOrCreateCustomRulesEntrypoint } = require('./cf-service')
const scannerIPRefresh = require('./scanner-ip-refresh')

const WHM_HOST = process.env.WHM_HOST
const WHM_USERNAME = process.env.WHM_USERNAME || 'root'
const WHM_TOKEN = process.env.WHM_TOKEN
// ── Tunnel routing (origin-IP-hidden) ──
// When WHM_API_URL is set, every WHM JSON API call is routed through that
// URL instead of `https://<WHM_HOST>:2087`. Used to route through Cloudflare
// Tunnel so the origin IP and port 2087 can stay locked down.
// This MUST stay in sync with js/whm-service.js — otherwise AntiRed calls hit
// the firewalled origin and time out (root cause of 67 `[AntiRed] CF IP Fix
// deploy error` timeouts observed in Railway logs on 2026-05-01/02).
const _WHM_API_URL = (process.env.WHM_API_URL || '').replace(/\/+$/, '')
const _WHM_BASE = _WHM_API_URL
  ? `${_WHM_API_URL}/json-api`
  : (WHM_HOST ? `https://${WHM_HOST}:2087/json-api` : null)

const whmApi = _WHM_BASE && WHM_TOKEN ? axios.create({
  baseURL: _WHM_BASE,
  headers: {
    Authorization: `whm ${WHM_USERNAME}:${WHM_TOKEN}`,
    // Cloudflare Access service token (Zero Trust). Sent on every request;
    // ignored by direct WHM API but required when WHM_API_URL routes through
    // a CF Access-protected tunnel hostname.
    ...(process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET ? {
      'CF-Access-Client-Id': process.env.CF_ACCESS_CLIENT_ID,
      'CF-Access-Client-Secret': process.env.CF_ACCESS_CLIENT_SECRET,
    } : {}),
  },
  timeout: 30000,
  httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
}) : null

// ─── Known Scanner / Anti-Phishing IP Ranges ────────────
// Google Safe Browsing, VirusTotal, PhishTank, Norton, McAfee, etc.
// These crawlers flag/red-list websites. Cloaking = returning clean page or 403 to them.

const SCANNER_IP_RANGES = [
  // ═══════════════════════════════════════════════════════════════════════
  // Known scanner IPs + Google infrastructure ranges.
  // Google Safe Browsing now uses headless Chrome on GCP, so we include
  // Google-owned IP ranges. Other cloud ranges (AWS, Azure) kept minimal
  // to avoid blocking legitimate users.
  // ═══════════════════════════════════════════════════════════════════════

  // ─── Google infrastructure (crawlers + GCP where GSB headless Chrome runs) ───
  '66.249.64.0/19',     // Googlebot (dedicated crawler range)
  '66.249.79.0/24',     // Googlebot
  '72.14.199.0/24',     // Google Safe Browsing crawler
  '209.85.238.0/24',    // Google Safe Browsing crawler
  '216.239.32.0/19',    // Google infrastructure (crawlers)
  '74.125.0.0/16',      // Google services
  '172.217.0.0/16',     // Google services
  '142.250.0.0/15',     // Google services
  '34.64.0.0/10',       // Google Cloud Platform (GCP) — GSB headless Chrome fleet
  '35.184.0.0/13',      // GCP us-central1, us-east1, etc.
  '35.192.0.0/12',      // GCP compute
  '35.208.0.0/12',      // GCP compute
  '35.224.0.0/12',      // GCP compute
  '35.240.0.0/13',      // GCP asia, europe
  '104.196.0.0/14',     // GCP
  '108.170.192.0/18',   // Google backbone
  '199.36.153.0/24',    // Google Private Access

  // VirusTotal scanners
  '208.100.26.228',
  '5.189.183.72',
  // PhishTank
  '69.46.27.0/24',
  // Sucuri SiteCheck
  '192.232.249.0/24',
  // Norton/Symantec SafeWeb
  '199.16.156.0/24',
  // McAfee SiteAdvisor
  '208.65.144.0/21',
  // Yandex SafeBrowsing
  '5.255.253.0/24',
  '77.88.55.0/24',
  '87.250.250.0/24',
  '93.158.161.0/24',
  // URLScan.io (specific /24s only)
  '18.213.240.0/24',
  '3.220.57.0/24',
  // Microsoft SmartScreen (specific /24s only — removed broad 52.96.0.0/14)
  '13.107.21.0/24',
  '204.79.197.0/24',
  // Netcraft
  '194.72.238.0/24',
  '195.22.26.0/24',
  '46.183.103.0/24',
  '185.117.215.0/24',
  // Kaspersky
  '77.74.181.0/24',
  '93.159.230.0/24',
  // ESET
  '91.228.166.0/24',
  '91.228.167.0/24',
  // Avast/AVG
  '5.45.72.0/24',
  // Bitdefender
  '91.199.104.0/24',
  // Fortinet FortiGuard
  '208.91.112.0/20',
  // Comodo (Sectigo)
  '178.255.82.0/24',

  // ─── Port / Recon Scanners (dedicated scanner infrastructure) ───
  // Censys
  '162.142.125.0/24',
  '167.94.138.0/24',
  '167.94.145.0/24',
  '167.94.146.0/24',
  '167.248.133.0/24',
  // Shodan
  '71.6.135.0/24',
  '71.6.146.0/24',
  '71.6.158.0/24',
  '71.6.165.0/24',
  '66.240.192.0/24',
  '66.240.205.0/24',
  '66.240.236.0/24',
  '198.20.69.0/24',
  '198.20.70.0/24',
  '198.20.87.0/24',
  '198.20.99.0/24',
  // Qualys
  '64.39.96.0/20',
  // Rapid7
  '71.6.233.0/24',
  // GreyNoise
  '71.6.199.0/24',
  // Internet Census
  '74.82.47.0/24',
  // SSL Labs
  '64.41.200.0/24',

  // NOTE: Do NOT block Cloudflare proxy IPs — blocking them = blocking everyone
]

/**
 * Returns the combined scanner IP list: hardcoded base + dynamic IPs from
 * scanner-ip-refresh.js (fetched daily from public feeds + admin overrides).
 * Used by generateHardenedWorkerScript() and generateHtaccessRules().
 */
function getAllScannerIPs() {
  const dynamic = scannerIPRefresh.getDynamicIPs()
  if (!dynamic || dynamic.length === 0) return SCANNER_IP_RANGES
  return [...new Set([...SCANNER_IP_RANGES, ...dynamic])]
}

// ─── Chrome Version Ceiling (Auto-Calculated) ────────────
// Chrome 120 shipped ~Dec 2023. Releases every ~4 weeks, incrementing major by 1.
// Instead of hardcoding a ceiling that goes stale, we calculate it from the date.
// Adds a +15 buffer for canary/dev channels so only truly unreleased versions flag.
const CHROME_120_EPOCH_MS = Date.parse('2023-12-01')
const MS_PER_CHROME_RELEASE = 4 * 7 * 86400 * 1000 // ~4 weeks

function getChromeVersionCeiling() {
  const releasesElapsed = Math.floor((Date.now() - CHROME_120_EPOCH_MS) / MS_PER_CHROME_RELEASE)
  const estimatedStable = 120 + releasesElapsed
  return {
    stable: estimatedStable,           // approximate current stable
    suspicious: estimatedStable + 15,  // unreleased → likely headless/canary
    maybeDev: estimatedStable + 10,    // very new → possibly dev channel
    old: estimatedStable - 40,         // very old → likely automated
  }
}

// Known bot user agents used by security scanners (anti-phishing + recon)
const SCANNER_USER_AGENTS = [
  // Anti-Phishing / Safe Browsing
  'GoogleSafeBrowsing',
  'PhishTank',
  'Sucuri',
  'SiteAdvisor',
  'SafeBrowsing',
  'VirusTotal',
  'URLScan',
  'Netcraft',
  'Norton',
  'SmartScreen',
  'ClamAV',
  'Sophos',
  'Kaspersky',
  'ESET',
  'Avast',
  'Bitdefender',
  'FortiGuard',
  'Comodo',
  'MalwareBytes',
  'Palo Alto',
  // Recon / Port Scanners
  'Censys',
  'CensysInspect',
  'Shodan',
  'ShodanBot',
  'ZmEu',
  'Nmap',
  'nikto',
  'sqlmap',
  'masscan',
  'Zgrab',
  'gobuster',
  'dirbuster',
  'wpscan',
  'nuclei',
  'httpx',
  'BinaryEdge',
  'NetcraftSurveyAgent',
  'SecurityTrails',
  'Project.Discovery',
  'RustBot',
  'InternetMeasurement',
  'ScanWorld',
  'BuiltWith',
  'WhatWeb',
  'Harvester',
  'Scrapy',
  'python-requests',
  'Go-http-client',
  'Java/',
  'curl/',
  'Wget/',
]

// ─── 1. .htaccess Scanner IP Cloaking ──────────────────

/**
 * Convert a CIDR to an Apache 2.4 Require directive
 * or a mod_rewrite regex pattern for Apache 2.2 compatibility
 */
function cidrToApachePattern(cidr) {
  if (!cidr.includes('/')) {
    // Single IP
    return cidr
  }
  const [base, bits] = cidr.split('/')
  const mask = parseInt(bits)
  const parts = base.split('.')

  if (mask >= 24) {
    return `${parts[0]}.${parts[1]}.${parts[2]}.`
  } else if (mask >= 16) {
    return `${parts[0]}.${parts[1]}.`
  } else if (mask >= 8) {
    return `${parts[0]}.`
  }
  return base
}

/**
 * Generate .htaccess rules to fully cloak from scanners.
 * Combines anti-phishing scanner IPs + recon scanner IPs.
 * For Cloudflare-proxied sites: uses mod_rewrite UA blocking only (IP blocking useless behind CF).
 * For direct-IP sites: also includes Apache 2.4 Require not ip.
 * Blocks scanner user-agents, empty UAs, and direct access to challenge file.
 */
function generateHtaccessRules(cpUsername, options = {}) {
  const { behindCloudflare = true, staticSiteBuildPath = '' } = options

  let rules = `# ====== Anti-Red Protection — Scanner IP Cloaking & Bot Blocking ======
# Auto-generated by Nomadly Anti-Red Service
# DO NOT EDIT — changes will be overwritten on renewal
`

  // Only add IP blocking if NOT behind Cloudflare (behind CF, all IPs are CF's)
  const allIPs = getAllScannerIPs()
  if (!behindCloudflare) {
    rules += `
# --- Scanner IP Blocking (Apache 2.4+) ---
<IfModule mod_authz_core.c>
  <RequireAll>
    Require all granted
`
    for (const ip of allIPs) {
      rules += `    Require not ip ${ip.replace('/32', '')}\n`
    }
    rules += `  </RequireAll>
</IfModule>
`
  }

  rules += `
<IfModule mod_rewrite.c>
  RewriteEngine On

  # Deny direct access to hidden anti-red files
  RewriteRule ^\\.antired- - [F,L]

  # Block empty user-agents
  RewriteCond %{HTTP_USER_AGENT} ^$ [NC]
  RewriteRule ^(.*)$ - [F,L]

  # Block known scanner user-agents
`
  // Group UAs into batches for efficient matching
  const batchSize = 6
  for (let i = 0; i < SCANNER_USER_AGENTS.length; i += batchSize) {
    const batch = SCANNER_USER_AGENTS.slice(i, i + batchSize)
    // Escape regex-special chars for Apache .htaccess: spaces (break parsing), dots (wildcard)
    const pattern = batch.map(ua => ua.replace(/\s/g, '\\ ').replace(/\./g, '\\.')).join('|')
    const isLast = i + batchSize >= SCANNER_USER_AGENTS.length
    const flag = isLast ? '[NC]' : '[NC,OR]'
    rules += `  RewriteCond %{HTTP_USER_AGENT} (${pattern}) ${flag}\n`
  }
  rules += `  RewriteRule ^(.*)$ - [F,L]

  # Block dangerous HTTP methods
  RewriteCond %{REQUEST_METHOD} ^(TRACE|TRACK|DEBUG) [NC]
  RewriteRule ^(.*)$ - [F,L]
`

  // For static sites, add build directory rewrite inside the same mod_rewrite block
  if (staticSiteBuildPath) {
    rules += `
  # --- Serve static site from build directory ---
  # Root URL: serve build/index.html directly
  RewriteRule ^$ ${staticSiteBuildPath}/index.html [L]

  # Other paths: serve from build dir if the original file doesn't exist
  RewriteCond %{REQUEST_FILENAME} !-f
  RewriteCond %{REQUEST_FILENAME} !-d
  RewriteRule ^(.*)$ ${staticSiteBuildPath}/$1 [L]
`
  }

  rules += `</IfModule>

# --- Security Headers ---
<IfModule mod_headers.c>
  Header always set X-Content-Type-Options "nosniff"
  Header always set X-Frame-Options "SAMEORIGIN"
  Header always set X-XSS-Protection "1; mode=block"
  Header always set Referrer-Policy "strict-origin-when-cross-origin"
</IfModule>

# ====== End Anti-Red Protection ======
`
  return rules
}

/**
 * Deploy .htaccess rules to a cPanel account's public_html.
 * Detects whether the site is behind Cloudflare and whether it serves static files.
 * Preserves cPanel-generated PHP handler.
 */
async function deployHtaccess(cpUsername, domain) {
  if (!whmApi) {
    log('[AntiRed] WHM not configured, skipping .htaccess deployment')
    return { success: false, error: 'WHM not configured' }
  }

  try {
    // Detect if behind Cloudflare
    let behindCloudflare = false
    try {
      const cfService = require('./cf-service')
      const zone = await cfService.getZoneByName(domain)
      behindCloudflare = !!zone
    } catch (_) {}

    // Read existing .htaccess to detect static site build path & cPanel handler
    let existingContent = ''
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
      existingContent = readRes.data?.result?.data?.content || ''
    } catch (_) {}

    // Extract static site build path from existing rewrite rules
    let staticSiteBuildPath = ''
    const buildPathMatch = existingContent.match(/RewriteRule\s+\^\(.*\)\$\s+(\S+\/build)\//)
    if (buildPathMatch) {
      staticSiteBuildPath = buildPathMatch[1]
    }

    // Extract cPanel PHP handler (must be preserved)
    const cpanelHandlerMatch = existingContent.match(/# php -- BEGIN cPanel-generated handler[^\n]*\n[\s\S]*?# php -- END cPanel-generated handler[^\n]*/)
    const cpanelHandler = cpanelHandlerMatch ? cpanelHandlerMatch[0] : ''

    // Extract any CORS headers section
    const corsMatch = existingContent.match(/# --- CORS headers[\s\S]*?<\/IfModule>\s*$/m)
    const corsSection = corsMatch ? corsMatch[0] : ''

    // Generate new rules
    const rules = generateHtaccessRules(cpUsername, { behindCloudflare, staticSiteBuildPath })

    // Build final content
    let finalContent = ''
    if (cpanelHandler) {
      finalContent = cpanelHandler + '\n\n'
    }
    finalContent += rules
    if (corsSection && !finalContent.includes('cross-origin')) {
      finalContent += '\n' + corsSection
    }

    const writeRes = await whmApi.post('/cpanel', new URLSearchParams({
      'api.version': '1',
      cpanel_jsonapi_user: cpUsername,
      cpanel_jsonapi_apiversion: '3',
      cpanel_jsonapi_module: 'Fileman',
      cpanel_jsonapi_func: 'save_file_content',
      dir: '/public_html',
      file: '.htaccess',
      content: finalContent,
    }).toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const ok = writeRes.data?.result?.status === 1 || writeRes.data?.metadata?.result === 1
    const allIPs = getAllScannerIPs()
    log(`[AntiRed] .htaccess deployed for ${cpUsername}: ${ok ? 'OK' : 'FAIL'} (CF=${behindCloudflare}, IPs=${allIPs.length}, UAs=${SCANNER_USER_AGENTS.length}, staticBuild=${staticSiteBuildPath || 'none'})`)
    return { success: ok, ipRanges: allIPs.length, userAgents: SCANNER_USER_AGENTS.length, behindCloudflare, staticSiteBuildPath }
  } catch (err) {
    log(`[AntiRed] .htaccess deploy error for ${cpUsername}: ${err.message}`)
    return { success: false, error: err.message }
  }
}

// ─── 2. JS Challenge (Client-Side Bot Detection) ────────

/**
 * Generate the anti-bot JS challenge script.
 * Runs on client side, detects headless browsers / bots.
 */
function generateJSChallenge() {
  return `<!-- Anti-Red JS Challenge -->
<script>
(function(){
  'use strict';
  var s=0;
  var isMob=/Mobile|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  var isWV=/wv|WebView|FBAN|FBAV|Instagram|Telegram|WhatsApp|Line|KakaoTalk|Snapchat|Twitter|CriOS|FxiOS|OPiOS|GSA/i.test(navigator.userAgent);
  if(navigator.webdriver)s+=40;
  if(/HeadlessChrome/.test(navigator.userAgent))s+=50;
  if(navigator.plugins.length===0&&!isMob)s+=15;
  if(!navigator.languages||navigator.languages.length===0)s+=15;
  if(window._phantom||window.__nightmare||window.callPhantom)s+=50;
  if(document.__selenium_unwrapped||document.__webdriver_evaluate||document.__driver_evaluate)s+=50;
  if(window.chrome===undefined&&/Chrome/.test(navigator.userAgent)){if(!isMob&&!isWV)s+=30;}
  if(navigator.permissions){
    navigator.permissions.query({name:'notifications'}).then(function(p){
      if(Notification.permission==='denied'&&p.state==='prompt')s+=25;
    }).catch(function(){});
  }
  try{var c=document.createElement('canvas');var g=c.getContext('2d');g.fillText('test',10,10);if(c.toDataURL().length<1000)s+=20;}catch(e){}
  var conn=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  if(conn&&conn.rtt===0)s+=20;
  setTimeout(function(){
    if(s>=50){
      document.documentElement.innerHTML='<div style=\"display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;background:#f5f5f5\"><div style=\"text-align:center;padding:40px\"><h1>Access Denied</h1><p>Your browser failed our security check.</p><p style=\"color:#666;font-size:14px\">Error: 403 AR-'+(Math.random()*1e6|0)+'</p></div></div>';
    }
  },800);
})();
</script>`
}

/**
 * Generate the PHP challenge file content with recursion guard.
 * Prevents 503 when the file is accessed directly (auto_prepend self-inclusion loop).
 */
function generateChallengePhp(jsChallenge) {
  return `<?php
// Anti-Red JS Challenge — Auto-generated by Nomadly
// Recursion guard: prevent 503 when this file is accessed directly via auto_prepend
if (defined('ANTIRED_CHALLENGE_LOADED')) return;
define('ANTIRED_CHALLENGE_LOADED', true);

// Skip injection for static assets (images, css, js, fonts)
\$uri = \$_SERVER['REQUEST_URI'] ?? '';
if (preg_match('/\\.(css|js|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|json)$/i', \$uri)) return;

echo '${jsChallenge.replace(/'/g, "\\'")}';
?>`
}

/**
 * Generate a lightweight PHP prepend that restores real visitor IP behind Cloudflare.
 * 
 * IMPORTANT: This replaces the JS challenge prepend for CF Worker-protected domains.
 * When a CF Worker is active, the Worker handles bot detection at the edge,
 * making the PHP-level JS challenge redundant AND harmful:
 *   - JS challenge outputs <script> before <!DOCTYPE>, creating malformed HTML
 *   - It conflicts with user-uploaded PHP files that have their own anti-bot code
 *   - It causes blank pages when user's PHP exits early (only JS script visible)
 * 
 * This IP-fix prepend solves a critical issue: behind CF proxy, PHP sees CF's IP
 * as REMOTE_ADDR instead of the real visitor's IP. User-uploaded anti-bot scripts
 * that check REMOTE_ADDR would block ALL visitors (seeing datacenter IPs).
 * 
 * The fix is invisible — no HTML output, no interference with user content.
 */
function generateIPFixPhp() {
  return `<?php
// Anti-Red: Restore real visitor IP + session bootstrap
// Auto-generated by Nomadly — ensures user anti-bot scripts see real IPs
// and PHP sessions work correctly with CF Worker challenge flow
if (defined('ANTIRED_IP_FIXED')) return;
define('ANTIRED_IP_FIXED', true);

// ── 1. Restore real visitor IP behind Cloudflare proxy ──
if (!empty(\$_SERVER['HTTP_CF_CONNECTING_IP'])) {
    \$_SERVER['REMOTE_ADDR'] = \$_SERVER['HTTP_CF_CONNECTING_IP'];
}
elseif (!empty(\$_SERVER['HTTP_X_FORWARDED_FOR'])) {
    \$ips = explode(',', \$_SERVER['HTTP_X_FORWARDED_FOR']);
    \$_SERVER['REMOTE_ADDR'] = trim(\$ips[0]);
}

// ── 2. Auto-start session + set FIL212sD gate ──
// The CF Worker verifies visitors via JS challenge + proof-of-interaction
// BEFORE requests reach origin. Many panel kits check \$_SESSION['FIL212sD']
// which is normally set by root index.php. When visitors access deep URLs
// directly (e.g., /app/index.php?view=login&id=...), the root index.php is
// bypassed and the session gate blocks them → blank/white page.
// This auto-sets it since the Worker already verified the visitor.
if (session_status() === PHP_SESSION_NONE) {
    @session_start();
}
if (!isset(\$_SESSION['FIL212sD'])) {
    \$_SESSION['FIL212sD'] = true;
}
?>`
}

/**
 * Deploy the CF IP restoration prepend to a cPanel account.
 * This replaces the JS challenge for CF Worker-protected domains.
 *
 * Files stay in public_html (cPanel Fileman API cannot create dirs
 * outside public_html reliably). The heartbeat monitors & auto-repairs
 * if users accidentally delete them.
 *
 * Idempotent: skips the WHM writes if the same payload was successfully
 * deployed in the last `IDEMPOTENCY_WINDOW_MS`. Cuts re-deploy spam
 * (~800 redundant deploys in 21 days per the RCA) by ~95%.
 *
 * @param {string} cpUsername
 * @param {object} [opts]
 * @param {boolean} [opts.force=false] - Bypass the idempotency cache and
 *   always write to WHM. The protection-heartbeat MUST set this to true
 *   because it only calls us AFTER verifying the files are missing or
 *   corrupted on WHM — skipping there would create a stuck-repair loop.
 */
async function deployCFIPFix(cpUsername, opts = {}) {
  if (!whmApi) {
    return { success: false, error: 'WHM not configured' }
  }

  const force = opts && opts.force === true
  const phpContent = generateIPFixPhp()
  const userIniContent = `; Anti-Red: CF IP Restoration
auto_prepend_file = /home/${cpUsername}/public_html/.antired-challenge.php`

  // Idempotency: hash both payloads + the cpUsername (the .user.ini path is
  // user-specific) and skip if we already deployed this exact content recently.
  const crypto = require('crypto')
  const sig = crypto.createHash('sha256')
    .update(cpUsername + '|' + phpContent + '|' + userIniContent)
    .digest('hex').slice(0, 16)
  const IDEMPOTENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

  try {
    const { MongoClient } = require('mongodb')
    const client = new MongoClient(process.env.MONGO_URL)
    await client.connect()
    const db = client.db(process.env.DB_NAME || 'test')
    const cpAccts = db.collection('cpanelAccounts')

    const acct = await cpAccts.findOne({ cpUser: cpUsername })

    // ── Skip deleted / cancelled cPanel accounts ──
    if (acct && (acct.deleted === true || acct.cancelledByUser === true || acct.suspended === true)) {
      await client.close()
      const lastSkipAt = acct._lastCfIpFixSkipLog ? new Date(acct._lastCfIpFixSkipLog).getTime() : 0
      if (Date.now() - lastSkipAt > 60 * 60 * 1000) {
        log(`[AntiRed] CF IP Fix SKIPPED for ${cpUsername} — account ${acct.deleted ? 'deleted' : acct.cancelledByUser ? 'cancelled' : 'suspended'}`)
        try {
          const { MongoClient: MC2 } = require('mongodb')
          const c2 = new MC2(process.env.MONGO_URL)
          await c2.connect()
          await c2.db(process.env.DB_NAME || 'test').collection('cpanelAccounts').updateOne(
            { cpUser: cpUsername },
            { $set: { _lastCfIpFixSkipLog: new Date() } }
          )
          await c2.close()
        } catch { /* non-blocking */ }
      }
      return { success: true, method: 'cf_ip_fix', skipped: 'account_deleted_or_cancelled' }
    }

    if (!force && acct && acct.lastCfIpFixSig === sig && acct.lastCfIpFixAt
        && (Date.now() - new Date(acct.lastCfIpFixAt).getTime()) < IDEMPOTENCY_WINDOW_MS) {
      await client.close()
      return { success: true, method: 'cf_ip_fix', skipped: 'unchanged' }
    }
    await client.close()
  } catch (idemErr) {
    log(`[AntiRed] CF IP Fix idempotency check warning for ${cpUsername} (continuing): ${idemErr.message}`)
  }

  try {
    // Write the IP fix PHP file to public_html
    await whmApi.get('/cpanel', {
      params: {
        'api.version': 1,
        cpanel_jsonapi_user: cpUsername,
        cpanel_jsonapi_apiversion: 3,
        cpanel_jsonapi_module: 'Fileman',
        cpanel_jsonapi_func: 'save_file_content',
        dir: '/public_html',
        file: '.antired-challenge.php',
        content: phpContent,
      },
    })

    // Write .user.ini to public_html
    await whmApi.get('/cpanel', {
      params: {
        'api.version': 1,
        cpanel_jsonapi_user: cpUsername,
        cpanel_jsonapi_apiversion: 3,
        cpanel_jsonapi_module: 'Fileman',
        cpanel_jsonapi_func: 'save_file_content',
        dir: '/public_html',
        file: '.user.ini',
        content: userIniContent,
      },
    })

    // Stamp the successful deploy signature for idempotency
    try {
      const { MongoClient } = require('mongodb')
      const client = new MongoClient(process.env.MONGO_URL)
      await client.connect()
      const db = client.db(process.env.DB_NAME || 'test')
      await db.collection('cpanelAccounts').updateOne(
        { cpUser: cpUsername },
        { $set: { lastCfIpFixSig: sig, lastCfIpFixAt: new Date(), protectionFileLocation: 'public_html' } }
      )
      await client.close()
    } catch { /* non-blocking */ }

    log(`[AntiRed] CF IP Fix deployed for ${cpUsername} (replaces JS challenge, Worker handles bot detection)`)
    return { success: true, method: 'cf_ip_fix' }
  } catch (err) {
    log(`[AntiRed] CF IP Fix deploy error for ${cpUsername}: ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * Detect if a cPanel account serves static HTML (React build, etc.)
 * and create an index.php wrapper to enable JS challenge injection.
 */
async function ensurePhpEntrypoint(cpUsername) {
  if (!whmApi) return { hasPhp: false }

  try {
    // Check if index.php exists in public_html
    let hasIndexPhp = false
    try {
      const res = await whmApi.get('/cpanel', {
        params: {
          'api.version': 1,
          cpanel_jsonapi_user: cpUsername,
          cpanel_jsonapi_apiversion: 3,
          cpanel_jsonapi_module: 'Fileman',
          cpanel_jsonapi_func: 'get_file_content',
          dir: '/public_html',
          file: 'index.php',
        },
      })
      const content = res.data?.result?.data?.content || ''
      hasIndexPhp = content.length > 0
    } catch (_) {}

    if (hasIndexPhp) return { hasPhp: true, method: 'existing' }

    // Check if index.html exists (static site indicator)
    let indexHtmlContent = ''
    try {
      const res = await whmApi.get('/cpanel', {
        params: {
          'api.version': 1,
          cpanel_jsonapi_user: cpUsername,
          cpanel_jsonapi_apiversion: 3,
          cpanel_jsonapi_module: 'Fileman',
          cpanel_jsonapi_func: 'get_file_content',
          dir: '/public_html',
          file: 'index.html',
        },
      })
      indexHtmlContent = res.data?.result?.data?.content || ''
    } catch (_) {}

    if (!indexHtmlContent) return { hasPhp: false, note: 'No index.html found' }

    // Static site detected — create index.php wrapper that serves index.html through PHP
    // This allows auto_prepend_file to inject the JS challenge
    const wrapperPhp = `<?php
// Anti-Red: PHP wrapper for static HTML — enables JS challenge injection via auto_prepend
// Original index.html is served through PHP so the challenge script gets prepended
readfile(__DIR__ . '/index.html');
?>`

    await whmApi.get('/cpanel', {
      params: {
        'api.version': 1,
        cpanel_jsonapi_user: cpUsername,
        cpanel_jsonapi_apiversion: 3,
        cpanel_jsonapi_module: 'Fileman',
        cpanel_jsonapi_func: 'save_file_content',
        dir: '/public_html',
        file: 'index.php',
        content: wrapperPhp,
      },
    })

    log(`[AntiRed] Created index.php wrapper for static site (${cpUsername})`)
    return { hasPhp: true, method: 'wrapper_created' }
  } catch (err) {
    log(`[AntiRed] ensurePhpEntrypoint error for ${cpUsername}: ${err.message}`)
    return { hasPhp: false, error: err.message }
  }
}

/**
 * Deploy JS challenge to a cPanel account.
 * Strategy depends on the site type:
 * - PHP sites: Uses auto_prepend_file via .user.ini (best approach)
 * - Static sites (React builds, etc.): Injects JS challenge directly into index.html
 *   because auto_prepend only works with PHP-processed files
 */
async function deployJSChallenge(cpUsername) {
  if (!whmApi) {
    return { success: false, error: 'WHM not configured' }
  }

  const jsChallenge = generateJSChallenge()

  try {
    // Detect site type: check for static build paths in .htaccess
    let isStaticSite = false
    let buildDir = ''
    try {
      const htRes = await whmApi.get('/cpanel', {
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
      const htContent = htRes.data?.result?.data?.content || ''
      const buildMatch = htContent.match(/RewriteRule\s+\^\(.*\)\$\s+(\S+)\/\$1/)
      if (buildMatch) {
        buildDir = buildMatch[1]
        // Check if this path has an index.html (static site indicator)
        try {
          const checkRes = await whmApi.get('/cpanel', {
            params: {
              'api.version': 1,
              cpanel_jsonapi_user: cpUsername,
              cpanel_jsonapi_apiversion: 3,
              cpanel_jsonapi_module: 'Fileman',
              cpanel_jsonapi_func: 'get_file_content',
              dir: `/public_html/${buildDir}`,
              file: 'index.html',
            },
          })
          const buildHtml = checkRes.data?.result?.data?.content || ''
          if (buildHtml && !buildHtml.includes('<?php')) {
            isStaticSite = true
          }
        } catch (_) {}
      }
    } catch (_) {}

    if (isStaticSite && buildDir) {
      // STATIC SITE: Inject JS challenge directly into index.html
      const readRes = await whmApi.get('/cpanel', {
        params: {
          'api.version': 1,
          cpanel_jsonapi_user: cpUsername,
          cpanel_jsonapi_apiversion: 3,
          cpanel_jsonapi_module: 'Fileman',
          cpanel_jsonapi_func: 'get_file_content',
          dir: `/public_html/${buildDir}`,
          file: 'index.html',
        },
      })
      let html = readRes.data?.result?.data?.content || ''

      if (html.includes('Anti-Red JS Challenge')) {
        log(`[AntiRed] JS Challenge already in HTML for ${cpUsername}`)
        return { success: true, method: 'static_html_existing' }
      }

      // Inject after <head> tag
      if (html.includes('<head>')) {
        html = html.replace('<head>', '<head>' + jsChallenge)
      } else {
        html = jsChallenge + '\n' + html
      }

      await whmApi.get('/cpanel', {
        params: {
          'api.version': 1,
          cpanel_jsonapi_user: cpUsername,
          cpanel_jsonapi_apiversion: 3,
          cpanel_jsonapi_module: 'Fileman',
          cpanel_jsonapi_func: 'save_file_content',
          dir: `/public_html/${buildDir}`,
          file: 'index.html',
          content: html,
        },
      })

      log(`[AntiRed] JS Challenge injected directly into HTML for ${cpUsername} (static site: ${buildDir})`)
      return { success: true, method: 'static_html_injection', buildDir }
    }

    // PHP SITE: Use auto_prepend_file via .user.ini
    const phpContent = generateChallengePhp(jsChallenge)

    await whmApi.get('/cpanel', {
      params: {
        'api.version': 1,
        cpanel_jsonapi_user: cpUsername,
        cpanel_jsonapi_apiversion: 3,
        cpanel_jsonapi_module: 'Fileman',
        cpanel_jsonapi_func: 'save_file_content',
        dir: '/public_html',
        file: '.antired-challenge.php',
        content: phpContent,
      },
    })

    const userIniContent = `; Anti-Red JS Challenge
auto_prepend_file = /home/${cpUsername}/public_html/.antired-challenge.php`

    await whmApi.get('/cpanel', {
      params: {
        'api.version': 1,
        cpanel_jsonapi_user: cpUsername,
        cpanel_jsonapi_apiversion: 3,
        cpanel_jsonapi_module: 'Fileman',
        cpanel_jsonapi_func: 'save_file_content',
        dir: '/public_html',
        file: '.user.ini',
        content: userIniContent,
      },
    })

    log(`[AntiRed] JS Challenge deployed for ${cpUsername} (via .user.ini, PHP site)`)
    return { success: true, method: 'user.ini' }
  } catch (err) {
    log(`[AntiRed] JS Challenge deploy error for ${cpUsername}: ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * Disable JS challenge for a cPanel account.
 * 
 * IMPORTANT: This ONLY disables the JS challenge (bot detection script).
 * All other Anti-Red protections remain FULLY ACTIVE:
 * - .htaccess scanner IP cloaking (32+ scanner IP ranges)
 * - .htaccess scanner UA blocking (20 scanner user-agents)
 * - .htaccess empty UA blocking
 * - .htaccess TRACE/TRACK/DEBUG method blocking
 * - Cloudflare WAF rules (JA3 fingerprinting, anti-bot profile)
 */
async function removeJSChallenge(cpUsername) {
  if (!whmApi) {
    return { success: false, error: 'WHM not configured' }
  }

  try {
    // Disable the JS challenge by writing an empty PHP file
    await whmApi.get('/cpanel', {
      params: {
        'api.version': 1,
        cpanel_jsonapi_user: cpUsername,
        cpanel_jsonapi_apiversion: 3,
        cpanel_jsonapi_module: 'Fileman',
        cpanel_jsonapi_func: 'save_file_content',
        dir: '/public_html',
        file: '.antired-challenge.php',
        content: '<?php\n// JS Challenge is currently DISABLED for this domain.\n// All other Anti-Red protections (IP cloaking, UA blocking, TLS fingerprinting) remain ACTIVE.\n?>',
      },
    })

    // Clean up .user.ini (remove auto_prepend)
    try {
      const readRes = await whmApi.get('/cpanel', {
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
      let iniContent = readRes.data?.result?.data?.content || ''
      if (iniContent.includes('antired-challenge.php')) {
        iniContent = iniContent.replace(/; Anti-Red JS Challenge\n?/g, '')
        iniContent = iniContent.replace(/auto_prepend_file\s*=\s*[^\n]*antired-challenge\.php\n?/g, '')
        await whmApi.get('/cpanel', {
          params: {
            'api.version': 1,
            cpanel_jsonapi_user: cpUsername,
            cpanel_jsonapi_apiversion: 3,
            cpanel_jsonapi_module: 'Fileman',
            cpanel_jsonapi_func: 'save_file_content',
            dir: '/public_html',
            file: '.user.ini',
            content: iniContent.trim() || '; empty',
          },
        })
      }
    } catch (_) {}

    // Also clean legacy php_value from .htaccess (backwards compatibility)
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
      let htContent = readRes.data?.result?.data?.content || ''
      if (htContent.includes('antired-challenge.php') || htContent.includes('php_value auto_prepend_file')) {
        htContent = htContent.replace(/\n?# Anti-Red JS Challenge auto-prepend\n?php_value auto_prepend_file[^\n]*\n?/g, '\n')
        await whmApi.get('/cpanel', {
          params: {
            'api.version': 1,
            cpanel_jsonapi_user: cpUsername,
            cpanel_jsonapi_apiversion: 3,
            cpanel_jsonapi_module: 'Fileman',
            cpanel_jsonapi_func: 'save_file_content',
            dir: '/public_html',
            file: '.htaccess',
            content: htContent.trim(),
          },
        })
      }
    } catch (_) {}

    log(`[AntiRed] JS Challenge disabled for ${cpUsername} (all other protections remain active)`)
    return { success: true, note: 'JS challenge disabled. Scanner IP cloaking, UA blocking, and TLS fingerprinting remain active.' }
  } catch (err) {
    log(`[AntiRed] JS Challenge disable error for ${cpUsername}: ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * Check if JS challenge is currently enabled for a cPanel account
 */
async function isJSChallengeEnabled(cpUsername) {
  if (!whmApi) return false

  try {
    const readRes = await whmApi.get('/cpanel', {
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
    const content = readRes.data?.result?.data?.content || ''
    return content.includes('Anti-Red JS Challenge') && !content.includes('disabled')
  } catch (_) {
    return false
  }
}

// ─── 3. TLS/JA3 Fingerprinting (Cloudflare WAF) ────────

const SCANNER_JA3_HASHES = [
  'b32309a26951912be7dba376398abc3b', // Python requests
  'e7d705a3286e19ea42f587b344ee6865', // Python urllib
  'cd08e31494f9531f560d64c695473da9', // Go HTTP client
  '456523fc94726331a4d5a2e1d40b2cd7', // curl
  'b4f7bcb23b6b763e18e4b2e4bc2a2b91', // Headless Chrome
  'f5a90abb09e397ac90e0b48e4e75d221', // Node.js fetch/axios
  'a0e9f5d64349fb13191bc781f81f42e1', // Scrapy
  '05af1f5ca1b87cc9cc9b25185115607d', // Java HttpClient
]

/**
 * Create Cloudflare WAF Custom Rule for TLS/JA3 fingerprinting — migrated
 * 2026-06-19 from the deprecated Firewall Rules API to the Rulesets API
 * (phase: http_request_firewall_custom). Same entrypoint as the Geo +
 * Anti-Bot rules in cf-service.js.
 */
async function createJA3Rules(zoneId) {
  const CF_API_KEY = process.env.CLOUDFLARE_API_KEY
  const CF_EMAIL = process.env.CLOUDFLARE_EMAIL
  if (!CF_API_KEY || !CF_EMAIL) {
    return { success: false, error: 'Cloudflare not configured' }
  }

  const headers = {
    'X-Auth-Email': CF_EMAIL,
    'X-Auth-Key': CF_API_KEY,
    'Content-Type': 'application/json',
  }

  const ja3Conditions = SCANNER_JA3_HASHES
    .map(hash => `cf.bot_management.ja3_hash eq "${hash}"`)
    .join(' or ')

  const expression = `(${ja3Conditions})`
  const DESC = 'Anti-Red: Challenge scanner TLS fingerprints (JA3)'

  try {
    const ep = await getOrCreateCustomRulesEntrypoint(zoneId)
    if (!ep) return { success: false, error: 'Could not access WAF Custom Rules ruleset' }

    // De-dupe via the entrypoint's rules array (replaces the deprecated
    // GET /filters?description=Anti-Red duplicate check).
    const dup = (ep.rules || []).some(r => r.description?.includes('JA3'))
    if (dup) return { success: true, message: 'JA3 rule already exists', existing: true, hashCount: SCANNER_JA3_HASHES.length }

    const ruleRes = await axios.post(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/${ep.id}/rules`,
      { expression, action: 'js_challenge', description: DESC, enabled: true },
      { headers, timeout: 15000 }
    )
    const ok = ruleRes.data?.success || false
    log(`[AntiRed] JA3 WAF rule created for zone ${zoneId}: ${ok ? 'OK' : 'FAIL'}`)
    const added = (ruleRes.data?.result?.rules || []).find(r => r.description === DESC) || null
    return { success: ok, rule: added, hashCount: SCANNER_JA3_HASHES.length }
  } catch (err) {
    if (err.response?.data?.errors?.some(e => e.message?.includes('already exists'))) {
      return { success: true, message: 'JA3 rules already exist', existing: true }
    }
    // cf.bot_management.ja3_hash requires Enterprise Bot Management — skip gracefully.
    // The Rulesets API returns 400 with code 20009 ("Unknown field" or similar)
    // for non-Enterprise plans where the field is unsupported.
    const status = err.response?.status
    const body = err.response?.data
    const isPlanLimit =
      status === 400 ||
      status === 403 ||
      JSON.stringify(body || '').toLowerCase().includes('bot_management')
    if (isPlanLimit) {
      log(`[AntiRed] JA3 WAF skipped for zone ${zoneId} (requires Enterprise Bot Management)`)
      return { success: false, error: 'Requires Enterprise Bot Management', planLimitation: true }
    }
    log(`[AntiRed] JA3 WAF rule error: ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * Create Cloudflare WAF Custom Rule to block anti-phishing scanner UAs at the
 * edge — migrated 2026-06-19 from the deprecated Firewall Rules API to the
 * Rulesets API (phase: http_request_firewall_custom). Same entrypoint as
 * Geo + Anti-Bot + JA3 rules so all auto-managed rules live in one ruleset.
 *
 * This is critical when the origin is behind CF — .htaccess UA rules only see
 * CF's IP, but Cloudflare preserves the original User-Agent header for WAF
 * matching.
 */
async function createAntiPhishingScannerRules(zoneId) {
  const CF_API_KEY = process.env.CLOUDFLARE_API_KEY
  const CF_EMAIL = process.env.CLOUDFLARE_EMAIL
  if (!CF_API_KEY || !CF_EMAIL) {
    return { success: false, error: 'Cloudflare not configured' }
  }

  const headers = {
    'X-Auth-Email': CF_EMAIL,
    'X-Auth-Key': CF_API_KEY,
    'Content-Type': 'application/json',
  }

  // Anti-phishing scanner UAs — these MUST be blocked at Cloudflare edge
  const phishingScanners = [
    'GoogleSafeBrowsing', 'PhishTank', 'Sucuri', 'SiteAdvisor',
    'SafeBrowsing', 'VirusTotal', 'URLScan', 'Netcraft',
    'Norton', 'SmartScreen', 'Kaspersky', 'ESET',
    'Avast', 'Bitdefender', 'FortiGuard', 'Comodo',
    'MalwareBytes', 'ClamAV', 'Sophos',
  ]
  const expression = '(' + phishingScanners.map(ua => `http.user_agent contains "${ua}"`).join(' or ') + ')'
  const DESC = 'Anti-Red: Block anti-phishing scanners'

  try {
    const ep = await getOrCreateCustomRulesEntrypoint(zoneId)
    if (!ep) return { success: false, error: 'Could not access WAF Custom Rules ruleset' }

    // De-dupe via the entrypoint's rules array (replaces the deprecated
    // GET /firewall/rules duplicate check that was silently failing).
    const dup = (ep.rules || []).some(r => r.description?.includes('Block anti-phishing scanners'))
    if (dup) {
      return { success: true, message: 'Anti-phishing scanner rules already exist', existing: true, scannerCount: phishingScanners.length }
    }

    const ruleRes = await axios.post(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/rulesets/${ep.id}/rules`,
      { expression, action: 'block', description: DESC, enabled: true },
      { headers, timeout: 15000 }
    )

    const ok = ruleRes.data?.success || false
    log(`[AntiRed] Anti-phishing scanner CF rule created for zone ${zoneId}: ${ok ? 'OK' : 'FAIL'} (${phishingScanners.length} UAs)`)
    const added = (ruleRes.data?.result?.rules || []).find(r => r.description === DESC) || null
    return { success: ok, rule: added, scannerCount: phishingScanners.length }
  } catch (err) {
    if (err.response?.data?.errors?.some(e => e.message?.includes('already exists'))) {
      return { success: true, message: 'Rule already exists', existing: true }
    }
    const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 300) : ''
    log(`[AntiRed] Anti-phishing scanner CF rule error: ${err.message}${detail ? ' :: ' + detail : ''}`)
    return { success: false, error: err.message, detail }
  }
}

// ─── Full Protection Deployment ──────────────────────────

/**
 * Deploy Cloudflare Worker for edge-level challenge injection.
 * The Worker intercepts HTML responses and injects the JS challenge at the edge,
 * surviving site redeployments and covering all routes (not just index.html).
 * Also blocks scanner UAs at the edge before they reach origin.
 */

/**
 * Deploy the shared 'antired-challenge' Worker route to a Cloudflare zone.
 * This is the lightweight version used for auto-deployment on new domains.
 * It only creates the route — the shared worker script must already be uploaded.
 * Falls back to uploading the script if the route creation fails due to missing script.
 */
async function deploySharedWorkerRoute(domain, zoneId) {
  const CF_API_KEY = process.env.CLOUDFLARE_API_KEY
  const CF_EMAIL = process.env.CLOUDFLARE_EMAIL

  if (!CF_API_KEY || !CF_EMAIL || !zoneId) {
    log(`[AntiRed] Skipping Worker auto-deploy for ${domain}: missing CF creds or zoneId`)
    return { success: false, error: 'Missing Cloudflare credentials or zoneId' }
  }

  const cfHeaders = {
    'X-Auth-Email': CF_EMAIL,
    'X-Auth-Key': CF_API_KEY,
  }
  const workerName = 'antired-challenge'

  try {
    // Check if route already exists
    let routesRes
    try {
      routesRes = await axios.get(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`,
        { headers: cfHeaders, timeout: 10000 }
      )
    } catch (zerr) {
      // A 403/404 here almost always means the passed zoneId is STALE (the zone
      // was deleted & recreated in CF, so its ID changed). Re-resolve the zone
      // by name and retry once with the fresh ID instead of giving up. (2026-09)
      const st = zerr.response?.status
      const cfService = require('./cf-service')
      if ((st === 403 || st === 404) && cfService?.getZoneByName) {
        const fresh = await cfService.getZoneByName(domain)
        if (fresh?.id && fresh.id !== zoneId) {
          log(`[AntiRed] zoneId ${zoneId} was stale for ${domain} — refreshed to ${fresh.id}, retrying worker deploy`)
          zoneId = fresh.id
          routesRes = await axios.get(
            `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`,
            { headers: cfHeaders, timeout: 10000 }
          )
        } else {
          throw zerr
        }
      } else {
        throw zerr
      }
    }
    const routes = routesRes.data?.result || []
    const existingMain = routes.find(r => r.pattern === `${domain}/*`)
    const existingWww = routes.find(r => r.pattern === `www.${domain}/*`)

    const results = []

    // Deploy main domain route
    if (existingMain) {
      log(`[AntiRed] Worker route already exists for ${domain}`)
      results.push({ domain, status: 'already_deployed', routeId: existingMain.id })
    } else {
      try {
        const routeRes = await axios.post(
          `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`,
          { pattern: `${domain}/*`, script: workerName },
          { headers: { ...cfHeaders, 'Content-Type': 'application/json' }, timeout: 10000 }
        )
        if (routeRes.data?.success) {
          log(`[AntiRed] Worker route deployed for ${domain} -> ${workerName}`)
          results.push({ domain, status: 'deployed', routeId: routeRes.data.result?.id })
        }
      } catch (e) {
        if (e.response?.data?.errors?.some(err => err.message?.includes('duplicate'))) {
          results.push({ domain, status: 'already_deployed' })
        } else {
          log(`[AntiRed] Worker route error for ${domain}: ${e.message}`)
        }
      }
    }

    // Deploy bare domain route (domain without wildcard — catches root URL)
    const existingBare = routes.find(r => r.pattern === domain)
    if (existingBare) {
      log(`[AntiRed] Worker route already exists for bare ${domain}`)
      results.push({ domain, status: 'already_deployed', routeId: existingBare.id, bare: true })
    } else {
      try {
        const bareRes = await axios.post(
          `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`,
          { pattern: domain, script: workerName },
          { headers: { ...cfHeaders, 'Content-Type': 'application/json' }, timeout: 10000 }
        )
        if (bareRes.data?.success) {
          log(`[AntiRed] Worker route deployed for bare ${domain} -> ${workerName}`)
          results.push({ domain, status: 'deployed', routeId: bareRes.data.result?.id, bare: true })
        }
      } catch (e) {
        if (e.response?.data?.errors?.some(err => err.message?.includes('duplicate'))) {
          results.push({ domain, status: 'already_deployed', bare: true })
        } else {
          log(`[AntiRed] Worker route error for bare ${domain}: ${e.message}`)
        }
      }
    }

    // Deploy www variant route
    if (existingWww) {
      log(`[AntiRed] Worker route already exists for www.${domain}`)
      results.push({ domain: `www.${domain}`, status: 'already_deployed', routeId: existingWww.id })
    } else {
      try {
        const wwwRes = await axios.post(
          `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`,
          { pattern: `www.${domain}/*`, script: workerName },
          { headers: { ...cfHeaders, 'Content-Type': 'application/json' }, timeout: 10000 }
        )
        if (wwwRes.data?.success) {
          log(`[AntiRed] Worker route deployed for www.${domain} -> ${workerName}`)
          results.push({ domain: `www.${domain}`, status: 'deployed', routeId: wwwRes.data.result?.id })
        }
      } catch (e) {
        if (e.response?.data?.errors?.some(err => err.message?.includes('duplicate'))) {
          results.push({ domain: `www.${domain}`, status: 'already_deployed' })
        } else {
          log(`[AntiRed] Worker route error for www.${domain}: ${e.message}`)
        }
      }
    }

    return { success: true, status: results.length > 0 ? 'deployed' : 'no_changes', routes: results }
  } catch (err) {
    const status = err.response?.status
    if (status === 403 || status === 404) {
      log(`[AntiRed] Worker auto-deploy error for ${domain}: ${err.message} (HTTP ${status} — likely stale CF zone)`)
      return { success: false, error: err.message, staleZone: true, httpStatus: status }
    }
    log(`[AntiRed] Worker auto-deploy error for ${domain}: ${err.message}`)
    return { success: false, error: err.message }
  }
}

// ─── Generic Business Placeholder (Content Cloaking) ────
// Clean placeholder shown to scanners - prevents red flagging
function generateCleanPlaceholder() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Professional Business Solutions</title>
<meta name="description" content="Leading provider of business solutions and professional services">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;line-height:1.6;color:#333}
.header{background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:#fff;padding:60px 20px;text-align:center}
.header h1{font-size:2.5rem;margin-bottom:10px}
.header p{font-size:1.1rem;opacity:0.9}
.container{max-width:1200px;margin:0 auto;padding:40px 20px}
.features{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:30px;margin:40px 0}
.feature{background:#f8f9fa;padding:30px;border-radius:10px;text-align:center}
.feature h3{color:#667eea;margin-bottom:15px}
.footer{background:#2d3748;color:#fff;text-align:center;padding:30px 20px;margin-top:60px}
.btn{display:inline-block;background:#667eea;color:#fff;padding:12px 30px;border-radius:5px;text-decoration:none;margin-top:20px}
</style>
</head>
<body>
<div class="header">
<h1>Professional Business Solutions</h1>
<p>Delivering excellence in business services worldwide</p>
</div>
<div class="container">
<h2 style="text-align:center;margin-bottom:30px">Our Services</h2>
<div class="features">
<div class="feature">
<h3>Consulting</h3>
<p>Strategic business consulting and advisory services to help your organization grow</p>
</div>
<div class="feature">
<h3>Technology</h3>
<p>Cutting-edge technology solutions tailored to your business needs</p>
</div>
<div class="feature">
<h3>Support</h3>
<p>24/7 dedicated customer support and maintenance services</p>
</div>
</div>
<div style="text-align:center;margin-top:50px">
<h2>Why Choose Us</h2>
<p style="max-width:600px;margin:20px auto;color:#666">We are committed to providing exceptional service and innovative solutions that drive business success. Our team of experts works closely with clients to deliver results that exceed expectations.</p>
<a href="#contact" class="btn">Get in Touch</a>
</div>
</div>
<div class="footer">
<p>&copy; 2025 Professional Business Solutions. All rights reserved.</p>
<p style="margin-top:10px;font-size:0.9rem;opacity:0.8">Trusted by businesses worldwide</p>
</div>
</body>
</html>`
}

// ─── Hardened Shared Worker Script ──────────────────────
// Cookie-gated challenge + Scanner redirect cloaking.
// Flow: 
// - Bot/scanner detected (score >= 100) → 302 redirect to benign off-site page
//   (avoids GSB's HTML-cloak detection that compares placeholder vs real UI).
//   KV escape hatch: `placeholder:<domain>=1` falls back to legacy HTML placeholder.
// - Suspicious → Challenge page → JS checks → redirect to /__ar_verify → Set-Cookie → origin content
// - Legitimate → Origin content directly

function generateHardenedWorkerScript() {
  const allIPs = getAllScannerIPs()
  const blockedUAs = SCANNER_USER_AGENTS.map(ua => `'${ua}'`).join(',')
  const scannerIPs = allIPs.map(ip => `'${ip}'`).join(',')
  const secretSeed = require('crypto').randomBytes(16).toString('hex')
  const cleanPlaceholder = generateCleanPlaceholder().replace(/'/g, "\\'").replace(/\n/g, '\\n')
  const backendReportUrl = (process.env.SELF_URL_PROD || process.env.SELF_URL || '').replace(/\/+$/, '')
  const chromeCeil = getChromeVersionCeiling()

  // Warn if report URL looks like a dev/preview environment
  if (backendReportUrl.includes('preview.emergentagent') || backendReportUrl.includes('localhost')) {
    log(`[AntiRed] ⚠️ Worker BACKEND_REPORT_URL points to dev environment: ${backendReportUrl}`)
    log(`[AntiRed] ⚠️ Honeypot reports will go to this URL. Set SELF_URL_PROD to production URL before deploying to live domains.`)
  }

  return `
addEventListener('fetch', e => e.respondWith(handleRequest(e.request)));

const BLOCKED_UAS = [${blockedUAs}];
const SCANNER_IPS = [${scannerIPs}];
const COOKIE_NAME = '__ar_v';
const COOKIE_MAX_AGE = 86400;
const SECRET = '${secretSeed}';
const CLEAN_PLACEHOLDER = '${cleanPlaceholder}';
const BACKEND_REPORT_URL = '${backendReportUrl}/honeypot/report';

// Benign destinations used for the silent scanner / stealth-bot 302 redirect.
// Randomized so the redirect URL itself doesn't become a fingerprint.
const SCANNER_REDIRECT_TARGETS = [
  'https://en.wikipedia.org/wiki/Privacy_policy',
  'https://en.wikipedia.org/wiki/Domain_parking',
  'https://en.wikipedia.org/wiki/Terms_of_service',
  'https://www.iana.org/help/example-domains',
];
function pickRedirectTarget() {
  return SCANNER_REDIRECT_TARGETS[Math.floor(Math.random() * SCANNER_REDIRECT_TARGETS.length)];
}

// ─── IP Range Matching ──────────────────────────────────
function ipInRange(ip, cidr) {
  if (!cidr.includes('/')) return ip === cidr;
  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits)) - 1);
  const ipNum = ip.split('.').reduce((a, o) => (a << 8) + parseInt(o), 0);
  const rangeNum = range.split('.').reduce((a, o) => (a << 8) + parseInt(o), 0);
  return (ipNum & mask) === (rangeNum & mask);
}

// ─── HMAC Signing ───────────────────────────────────────
async function hmac(message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 32);
}

async function verifyCookie(cookieHeader) {
  if (!cookieHeader) return false;
  const match = cookieHeader.match(new RegExp(COOKIE_NAME + '=([^;]+)'));
  if (!match) return false;
  try {
    const decoded = decodeURIComponent(match[1]);
    const [ts, sig] = atob(decoded).split('|');
    const age = Math.floor(Date.now() / 1000) - parseInt(ts);
    if (isNaN(age) || age < 0 || age > COOKIE_MAX_AGE) return false;
    const expected = await hmac(ts);
    return sig === expected;
  } catch { return false; }
}

async function makeCookieValue() {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = await hmac(ts);
  return btoa(ts + '|' + sig);
}

// ─── Bot Score Calculator ───────────────────────────────
function calculateBotScore(ua, ip, request) {
  let score = 0;
  if (!ua || BLOCKED_UAS.some(b => ua.includes(b))) score += 100;
  if (ip && SCANNER_IPS.some(cidr => ipInRange(ip, cidr))) score += 100;
  if (ua && /bot|crawl|spider|scrape|fetch/i.test(ua)) score += 50;
  if (ua && /curl|wget|python|java|go-http/i.test(ua)) score += 60;
  if (!ua || ua.length < 20) score += 40;

  // ── Linux desktop visiting a phishing page = highly suspicious ──
  // Normal bank phishing victims use Windows/Mac/Android/iOS, not Linux.
  // Linux + Chrome = security scanner, GSB headless crawler, or researcher.
  if (ua && /X11;\\s*Linux\\s*x86_64/.test(ua) && /Chrome\\//.test(ua)) {
    // Exclude Android (which also reports Linux in UA but is a real mobile browser)
    if (!/Android/.test(ua)) score += 35;
  }
  // FreeBSD is even more suspicious
  if (ua && /FreeBSD/.test(ua)) score += 40;

  // ── Chrome version anomaly detection ──
  // Auto-calculated: stable ~${chromeCeil.stable} as of worker build date.
  // Anything >${chromeCeil.suspicious} is suspicious (canary/headless).
  const chromeMatch = ua && ua.match(/Chrome\\/([0-9]+)/);
  if (chromeMatch) {
    const ver = parseInt(chromeMatch[1]);
    if (ver > ${chromeCeil.suspicious}) score += 35;       // Unreleased version — likely headless/canary
    else if (ver > ${chromeCeil.maybeDev}) score += 15;  // Very new — possibly dev channel
    else if (ver < ${chromeCeil.old}) score += 25;   // Very old — likely automated
  }

  // ── Cloudflare Bot Management score (if available) ──
  // CF Bot Score: 1 = definitely bot, 99 = definitely human
  if (request) {
    const cfBotScore = parseInt(request.headers.get('cf-bot-management-verified-bot') || '');
    if (cfBotScore === 1) score += 80; // CF says it's a verified bot
    const cfThreatScore = parseInt(request.headers.get('cf-threat-score') || '0');
    if (cfThreatScore > 30) score += 30;
    else if (cfThreatScore > 10) score += 15;
  }

  // ── Sec-Fetch-* fetch-metadata headers ──
  // Real Chrome/Edge/Firefox/Safari (>=2020) always send Sec-Fetch-Site,
  // Sec-Fetch-Mode and Sec-Fetch-Dest for navigations. curl, Python,
  // Go-http, and most non-stealth headless setups never send any of them.
  // This is a CHEAP signal that catches script-class bots without UI.
  if (request) {
    const sfSite = request.headers.get('Sec-Fetch-Site');
    const sfMode = request.headers.get('Sec-Fetch-Mode');
    const sfDest = request.headers.get('Sec-Fetch-Dest');
    // None of them = almost certainly not a modern browser
    if (!sfSite && !sfMode && !sfDest) score += 40;
    // UA claims Chrome >= 90 but Sec-Fetch missing = impersonation
    const chromeM = ua && ua.match(/Chrome\\/([0-9]+)/);
    if (chromeM && parseInt(chromeM[1]) >= 90 && !sfSite) score += 30;
  }

  // ── IPv6 from known cloud/datacenter ranges (common for scanners) ──
  if (ip && ip.includes(':')) {
    // Google Cloud IPv6 ranges
    if (/^2600:1900:|^2607:f8b0:/.test(ip)) score += 60;
    // AWS IPv6
    if (/^2600:1f/.test(ip)) score += 30;
    // Azure IPv6
    if (/^2603:10/.test(ip)) score += 30;
  }

  return score;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HONEYPOT SYSTEM — 6 trap types with KV-based IP banning
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Ban an IP for 24 hours via KV
async function banIP(ip, reason, details) {
  try {
    if (typeof BANNED_IPS !== 'undefined') {
      await BANNED_IPS.put(ip, JSON.stringify({
        reason: reason,
        details: details || '',
        bannedAt: Date.now()
      }), { expirationTtl: 86400 });
    }
  } catch (e) { /* KV write failed, non-critical */ }
}

// Check if an IP is banned in KV
async function isIPBanned(ip) {
  try {
    if (typeof BANNED_IPS !== 'undefined') {
      const val = await BANNED_IPS.get(ip);
      return val !== null;
    }
  } catch (e) { /* KV read failed */ }
  return false;
}

// Fire-and-forget report to backend for MongoDB analytics
function reportToBackend(ip, type, path, domain, ua, details) {
  if (!BACKEND_REPORT_URL) return;
  try {
    fetch(BACKEND_REPORT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, type, path, domain, ua, details }),
    }).catch(() => {});
  } catch (e) { /* non-critical */ }
}

// Handle honeypot trigger — smart banning: only ban bots, not verified humans
async function handleHoneypotTrigger(request, path) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const ua = request.headers.get('User-Agent') || '';
  const cookies = request.headers.get('Cookie') || '';
  const domain = new URL(request.url).hostname;

  // Determine trap type from path
  let type = 'link';
  if (path.includes('form-trap')) type = 'form';
  else if (path.includes('mouse-trap')) type = 'mouse';
  else if (path.includes('cookie-trap')) type = 'cookie';
  else if (path.includes('js-trap')) type = 'js';
  else if (path.includes('robots-trap')) type = 'robots';

  // ── SMART CHECK: If visitor has valid challenge cookie, they're a verified human ──
  // Don't ban them — they probably found the URL in source code or typed it manually.
  // Just return a generic 404 to avoid confusion.
  const isVerifiedHuman = await verifyCookie(cookies);
  if (isVerifiedHuman) {
    // Still report for analytics (soft signal), but NO ban
    reportToBackend(ip, type + '_human_skip', path, domain, ua, 'verified_cookie_present');
    return new Response('<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1><p>The requested resource was not found on this server.</p></body></html>', {
      status: 404, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }
    });
  }

  // ── Calculate bot score to decide severity ──
  const botScore = calculateBotScore(ua, ip, request);

  if (botScore >= 50) {
    // HIGH confidence bot — ban IP (24h) + serve decoy to waste time
    await banIP(ip, 'honeypot_' + type, path);
    reportToBackend(ip, type, path, domain, ua, 'bot_score_' + botScore);
    return serveHoneypotDecoy(path);
  }

  // LOW score, no cookie — could be a curious human or a stealthy bot.
  // Don't ban (avoids false-positives on site owners), but report + serve 404.
  reportToBackend(ip, type + '_low_score', path, domain, ua, 'bot_score_' + botScore + '_no_cookie');
  return new Response('<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1><p>The requested resource was not found on this server.</p></body></html>', {
    status: 404, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }
  });
}

// ─── Decoy content for confirmed bots (wastes their time) ────
function serveHoneypotDecoy(path) {
  if (path.includes('admin') || path.includes('wp-admin')) {
    // Fake server maintenance page — looks like a real server response, not an admin panel
    return new Response(
      '<!DOCTYPE html><html><head><title>503 Service Unavailable</title>'
      + '<meta http-equiv="refresh" content="30">'
      + '<style>body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#f5f5f5;color:#333}'
      + 'h1{font-size:48px;color:#999}p{max-width:500px;margin:20px auto;line-height:1.6}'
      + '.spinner{border:4px solid #ddd;border-top:4px solid #999;border-radius:50%;width:30px;height:30px;'
      + 'animation:spin 1.5s linear infinite;margin:20px auto}@keyframes spin{to{transform:rotate(360deg)}}</style></head>'
      + '<body><h1>503</h1><div class="spinner"></div><p><b>Service Temporarily Unavailable</b></p>'
      + '<p>The server is currently undergoing scheduled maintenance. Please try again in a few minutes.</p>'
      + '<p style="font-size:12px;color:#aaa">Reference: ' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2,8) + '</p>'
      + '</body></html>',
      { status: 503, headers: { 'Content-Type': 'text/html', 'Retry-After': '300', 'Cache-Control': 'no-store' } }
    );
  }
  if (path.includes('api-keys') || path.includes('config') || path.includes('private')) {
    return new Response('API_KEY=fake_12345678abcdefgh\\nSECRET=fake_xxxxxxxxxxxxxxxx\\nDATABASE_URL=postgres://fake:fake@localhost/fake\\n', {
      status: 200, headers: { 'Content-Type': 'text/plain' }
    });
  }
  if (path.includes('backup')) {
    return new Response('# Backup file\\n# Created: 2025-01-01\\n# Nothing to see here\\n', {
      status: 200, headers: { 'Content-Type': 'text/plain' }
    });
  }
  // Generic: 404
  return new Response('Not Found', { status: 404 });
}

// ─── Type 6: robots.txt honeypot ────────────────────────
function honeypotRobotsTxt() {
  return 'User-agent: *\\nAllow: /\\n\\n# Protected directories\\nDisallow: /__honeypot/admin/\\nDisallow: /__honeypot/backup/\\nDisallow: /__honeypot/private/\\nDisallow: /__honeypot/config/\\nDisallow: /__honeypot/api-keys/\\n\\nCrawl-delay: 10\\n';
}

// ─── Honeypot HTML injection (Types 1,3,4,5) ────────────
// Injected into pass-through HTML responses for verified/passed users.
// Hidden elements that only bots interact with.
function injectHoneypots(html, domain) {
  // ── Safety guard: only inject into real HTML documents ──
  // Some origins (esp. PHP APIs) return JSON/text with a text/html Content-Type.
  // Blindly appending the trap markup corrupts those bodies and breaks client-side
  // JSON.parse (customer @scorch75 incident, 2026-06 — testingpagebig.com API).
  // If the body doesn't look like an HTML document, pass it through untouched.
  const _lower = (html || '').toLowerCase();
  if (!_lower.includes('<html') && !_lower.includes('<body')) {
    return html;
  }

  // Type 1: Link Honeypots — hidden links bots click, humans never see
  const linkTraps = '<a href="/__honeypot/admin-login" style="display:none" tabindex="-1" aria-hidden="true">Admin Login</a>'
    + '<a href="/__honeypot/wp-admin" style="opacity:0;position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden" tabindex="-1">WordPress Admin</a>'
    + '<a href="/__honeypot/private/api-keys.txt" style="visibility:hidden;position:absolute;top:-9999px" tabindex="-1">API Keys</a>'
    + '<a href="/__honeypot/robots-trap/backup" style="width:0;height:0;overflow:hidden;display:inline-block" tabindex="-1">Backup</a>'
    + '<div style="display:none"><h2>Exclusive Content</h2><a href="/__honeypot/exclusive-download">Download Premium</a></div>';

  // Type 3: Mouse tracking honeypot — detects no mouse movement (headless browsers)
  // IMPORTANT: Touch devices (phones/tablets) never fire mousemove — must track touch events too
  const mouseTracker = '<script>'
    + '(function(){'
    + 'var mc=0,tc=0,cc=0,sc=0,st=Date.now();'
    + 'document.addEventListener("mousemove",function(){mc++;});'
    + 'document.addEventListener("touchstart",function(){tc++;});'
    + 'document.addEventListener("touchmove",function(){tc++;});'
    + 'document.addEventListener("click",function(){cc++;});'
    + 'document.addEventListener("scroll",function(){sc++;});'
    + 'setTimeout(function(){'
    + 'var t=Date.now()-st;'
    + 'var isMob="ontouchstart" in window||navigator.maxTouchPoints>0;'
    + 'if(isMob)return;'
    + 'if(mc===0&&tc===0&&t>10000){'
    + 'fetch("/__honeypot/mouse-trap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({r:"no_mouse",t:t})}).catch(function(){});'
    + '}'
    + 'if(sc>5&&mc===0&&tc===0){'
    + 'fetch("/__honeypot/mouse-trap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({r:"scroll_no_mouse",t:t})}).catch(function(){});'
    + '}'
    + 'if(cc>0&&mc<10&&tc===0){'
    + 'fetch("/__honeypot/mouse-trap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({r:"click_no_mouse",t:t})}).catch(function(){});'
    + '}'
    + '},12000);'
    + '})();'
    + '</script>';

  // Type 4: Cookie honeypot — detects cookie tampering (skip on mobile to avoid false positives)
  const cookieTrap = '<script>'
    + '(function(){'
    + 'if("ontouchstart" in window||navigator.maxTouchPoints>0)return;'
    + 'document.cookie="_hp_trap=initial_value;path=/;SameSite=Lax";'
    + 'setTimeout(function(){'
    + 'var ck=document.cookie.split(";").map(function(c){return c.trim();});'
    + 'var hp=ck.find(function(c){return c.startsWith("_hp_trap=");});'
    + 'if(!hp||!hp.includes("initial_value")){'
    + 'fetch("/__honeypot/cookie-trap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({r:hp?"modified":"deleted"})}).catch(function(){});'
    + '}'
    + '},3000);'
    + '})();'
    + '</script>';

  // Type 5: JavaScript honeypots — fake APIs that bots probe
  const jsTrap = '<script>'
    + '(function(){'
    + 'function rp(trigger){'
    + 'fetch("/__honeypot/js-trap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({trigger:trigger})}).catch(function(){});'
    + '}'
    // Fake webdriver access trap — bots try to hide navigator.webdriver
    + 'try{'
    + 'var origWD=Object.getOwnPropertyDescriptor(Navigator.prototype,"webdriver");'
    + 'Object.defineProperty(Navigator.prototype,"webdriver",{'
    + 'get:function(){'
    + 'rp("webdriver_access");'
    + 'return origWD?origWD.get.call(this):false;'
    + '},'
    + 'configurable:true'
    + '});'
    + '}catch(e){}'
    // Fake admin API — bots may call window.adminAPI
    + 'window.adminAPI={'
    + 'login:function(){rp("admin_api_call");return{error:"Unauthorized"};},'
    + 'getUsers:function(){rp("admin_api_call");return[];}'
    + '};'
    // Fake Selenium properties — bots that delete them trigger this
    + 'Object.defineProperty(document,"__selenium_unwrapped",{'
    + 'set:function(){rp("selenium_prop_set");},'
    + 'get:function(){return undefined;},'
    + 'configurable:true'
    + '});'
    + '})();'
    + '</script>';

  // Inject all traps before </body>
  const allTraps = linkTraps + mouseTracker + cookieTrap + jsTrap;

  if (html.includes('</body>')) {
    return html.replace('</body>', allTraps + '</body>');
  }
  // Fallback: append if no </body> tag
  return html + allTraps;
}

// ─── Challenge Page with Proof-of-Interaction ────────────
function challengePage(originalUrl, nonce) {
  const safeUrl = encodeURIComponent(originalUrl);
  return \`<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>Security Check</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#e0e0e0;display:flex;justify-content:center;align-items:center;min-height:100vh}.c{text-align:center;padding:40px;max-width:420px}.s{width:40px;height:40px;border:3px solid #333;border-top-color:#4f8fff;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 24px}@keyframes spin{to{transform:rotate(360deg)}}.t{font-size:18px;margin-bottom:8px;color:#fff}.d{color:#888;font-size:14px}.p{margin-top:20px;height:4px;background:#222;border-radius:2px;overflow:hidden}.pb{height:100%;background:linear-gradient(90deg,#4f8fff,#7c5cff);width:0%;transition:width 0.3s;border-radius:2px}.f{margin-top:16px;color:#555;font-size:12px}.vb{display:none;margin-top:24px;padding:14px 40px;background:linear-gradient(135deg,#4f8fff,#7c5cff);color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;box-shadow:0 4px 15px rgba(79,143,255,0.3)}.vb:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(79,143,255,0.4)}.vb:active{transform:translateY(0)}.vb.show{display:inline-block;animation:fadeIn 0.4s ease}.fl{display:none;margin-top:16px;color:#f44;font-size:14px}@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}</style>
</head><body><div class="c"><div class="s" id="sp"></div><div class="t" id="tt">Verifying your browser</div><div class="d" id="dd">This is an automatic security check</div><div class="p"><div class="pb" id="pb"></div></div><div class="f" id="st">Please wait...</div><button class="vb" id="vb">Continue to site</button><div class="fl" id="fl">Verification failed. Please use a standard browser.</div></div>
<script>
(function(){
  var NONCE='\${nonce}';
  var sc=0,pb=document.getElementById('pb'),st=document.getElementById('st');
  var vb=document.getElementById('vb'),fl=document.getElementById('fl');
  var sp=document.getElementById('sp'),tt=document.getElementById('tt'),dd=document.getElementById('dd');
  var poiReady=false;
  function up(p,t){pb.style.width=p+'%';st.textContent=t;}

  // Phase 1: Automated bot detection
  up(10,'Checking browser environment...');
  var isMobile=/Mobile|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  var isWebView=/wv|WebView|FBAN|FBAV|Instagram|Telegram|WhatsApp|Line|KakaoTalk|Snapchat|Twitter|CriOS|FxiOS|OPiOS|GSA/i.test(navigator.userAgent);
  if(navigator.webdriver)sc+=40;
  if(/HeadlessChrome|PhantomJS|Nightmare/.test(navigator.userAgent))sc+=50;
  if(navigator.plugins.length===0&&!isMobile)sc+=15;
  if(!navigator.languages||navigator.languages.length===0)sc+=20;
  if(window._phantom||window.__nightmare||window.callPhantom)sc+=50;
  if(document.__selenium_unwrapped||document.__webdriver_evaluate||document.__driver_evaluate)sc+=50;
  if(window.chrome===undefined&&/Chrome/.test(navigator.userAgent)&&!/Edge|Edg|OPR/.test(navigator.userAgent)){if(!isMobile&&!isWebView)sc+=25;}
  try{var c=document.createElement('canvas'),g=c.getContext('2d');g.fillText('ar',2,2);if(c.toDataURL().length<500)sc+=20;}catch(e){sc+=10;}
  var cn=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  if(cn&&cn.rtt===0&&!/localhost/.test(location.hostname))sc+=15;
  if(!window.requestAnimationFrame)sc+=10;
  try{if(window.outerWidth===0||window.outerHeight===0)sc+=20;}catch(e){}
  // Puppeteer/Playwright/CDP detection
  if(window.__puppeteer_evaluation_script__)sc+=50;
  if(navigator.userAgent.includes('Headless'))sc+=50;
  try{if(Object.getOwnPropertyNames(navigator).includes('webdriver'))sc+=30;}catch(e){}
  try{if(window.cdc_adoQpoasnfa76pfcZLmcfl_Array||window.cdc_adoQpoasnfa76pfcZLmcfl_Promise)sc+=50;}catch(e){}
  if(screen.width===0||screen.height===0)sc+=30;
  if(screen.width===800&&screen.height===600)sc+=15;
  if(!navigator.permissions){if(isMobile||isWebView)sc+=5;else sc+=10;}
  // WebGL renderer check (headless uses SwiftShader)
  try{var cv=document.createElement('canvas');var gl=cv.getContext('webgl')||cv.getContext('experimental-webgl');if(gl){var dbg=gl.getExtension('WEBGL_debug_renderer_info');if(dbg){var rr=gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);if(/SwiftShader|llvmpipe|softpipe/i.test(rr))sc+=30;}}}catch(e){}

  // ── NEW: Linux desktop detection ──
  // Normal phishing victims use Windows/Mac/Android/iOS. Linux desktop + Chrome is
  // almost always a scanner, security researcher, or GSB headless browser.
  var isLinuxDesktop=/X11;\\\\s*Linux\\\\s*x86_64/.test(navigator.userAgent)&&!/Android/.test(navigator.userAgent);
  if(isLinuxDesktop&&/Chrome/.test(navigator.userAgent))sc+=30;

  // ── NEW: Chrome version anomaly ──
  // Auto-calculated ceiling — stable ~${chromeCeil.stable} at build time.
  var cvMatch=navigator.userAgent.match(/Chrome\\\\/([0-9]+)/);
  if(cvMatch){var cv2=parseInt(cvMatch[1]);if(cv2>${chromeCeil.suspicious})sc+=25;else if(cv2<${chromeCeil.old})sc+=20;}

  // ── NEW: Notification permission probe ──
  // Headless Chrome has Notification.permission='denied' but no prompt capability.
  try{if(typeof Notification!=='undefined'&&Notification.permission==='denied'&&isLinuxDesktop)sc+=10;}catch(e){}

  // ── NEW: Performance timing analysis ──
  // Automated browsers often have suspiciously fast or zero performance timings.
  try{var perf=performance.getEntriesByType('navigation')[0];if(perf&&perf.domInteractive>0&&perf.domInteractive<50)sc+=15;}catch(e){}

  // ── NEW: Detect CDP (Chrome DevTools Protocol) runtime ──
  try{if(window.Runtime||window.Emulation||window.Page)sc+=30;}catch(e){}
  try{var err=new Error();if(err.stack&&err.stack.includes('puppeteer'))sc+=50;}catch(e){}

  setTimeout(function(){up(40,'Verifying identity...');},600);
  setTimeout(function(){up(70,'Almost done...');},1800);

  // Phase 2: Decision at 3s
  setTimeout(function(){
    if(sc>=35){
      up(100,'Verification failed');
      fl.style.display='block';
      sp.style.borderTopColor='#f44';
      sp.style.animationPlayState='paused';
      st.style.color='#f44';
      return;
    }
    // Automated checks passed — require proof of interaction (click)
    up(100,'One more step...');
    sp.style.display='none';
    tt.textContent='Almost there';
    dd.textContent='Click the button below to continue';
    st.textContent='';
    vb.classList.add('show');
    poiReady=true;
  },3000);

  // Phase 3: Proof-of-Interaction — button click required
  vb.addEventListener('click',function(){
    if(!poiReady)return;
    vb.disabled=true;
    vb.textContent='Verifying...';
    var ts=Math.floor(Date.now()/1000);
    // Nonce was pre-computed by the Worker and embedded in this page
    window.location.href='/__ar_verify?r=\${safeUrl}&t='+ts+'&poi='+NONCE;
  });

  // Timeout after 30s
  setTimeout(function(){
    if(poiReady&&vb.classList.contains('show')&&!vb.disabled){
      st.textContent='Session timed out. Please refresh the page.';
      st.style.color='#f44';
      vb.style.display='none';
    }
  },33000);
})();
</script></body></html>\`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN REQUEST HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function handleRequest(request) {
  const ua = request.headers.get('User-Agent') || '';
  const url = new URL(request.url);
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const domain = url.hostname;

  // ── Step 0: Check KV ban list ──
  if (await isIPBanned(ip)) {
    return new Response('Forbidden', {
      status: 403,
      headers: { 'X-AntiRed': 'honeypot-banned' }
    });
  }

  // ── Step 0b: Read challenge-bypass flag (does NOT short-circuit other layers) ──
  // The domain-level bypass is stored in KV as 'bypass:{domain}'. When set, the
  // user has chosen to skip the "Verifying your browser" interstitial for human
  // visitors (UX preference). It does NOT disable scanner cloaking, honeypots,
  // IP bans, or any other anti-red layer. Those continue to run for everyone.
  // Bug history: previously the bypass branch did an early pass-through which
  // killed Step 4 scanner cloaking too. See verify-navy.com incident 2026-02.
  let challengeBypassed = false;
  try {
    if (typeof BANNED_IPS !== 'undefined') {
      const bypass = await BANNED_IPS.get('bypass:' + domain);
      if (bypass) challengeBypassed = true;
    }
  } catch (e) { /* KV read failed, default to challenge ON */ }

  // ── Step 0c: Read honeypot-off flag (does NOT short-circuit other layers) ──
  // Stored in KV as 'honeypot_off:{domain}'. When set, the Worker skips injecting
  // the hidden honeypot trap markup into pass-through HTML. Every other layer —
  // Captcha challenge, scanner cloaking, IP bans, WAF — keeps running for everyone.
  // Exists so customers whose pages emit inline JSON/API output (which the traps
  // could corrupt) can opt out of honeypots only. Monthly-plan self-service toggle.
  let honeypotOff = false;
  try {
    if (typeof BANNED_IPS !== 'undefined') {
      const hp = await BANNED_IPS.get('honeypot_off:' + domain);
      if (hp) honeypotOff = true;
    }
  } catch (e) { /* KV read failed, default to honeypot ON */ }

  // ── Step 1: Handle honeypot triggers ──
  if (url.pathname.startsWith('/__honeypot/')) {
    return handleHoneypotTrigger(request, url.pathname);
  }

  // ── Step 2: Serve honeypot-enhanced robots.txt ──
  if (url.pathname === '/robots.txt') {
    return new Response(honeypotRobotsTxt(), {
      status: 200,
      headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=3600' }
    });
  }

  // ── Step 3: Skip challenge for static assets ──
  const ext = url.pathname.split('.').pop().toLowerCase();
  const staticExts = ['css','js','png','jpg','jpeg','gif','svg','ico','woff','woff2','ttf','eot','map','xml','pdf','zip','mp4','mp3','webp','avif','webmanifest'];
  if (staticExts.includes(ext)) {
    return fetch(request);
  }

  // ── Step 4: Bot score calculation ──
  const botScore = calculateBotScore(ua, ip, request);

  // HIGH SCORE (100+) → Known scanner / GSB headless Chrome.
  // ────────────────────────────────────────────────────────────
  // GSB's socialEngineering classifier red-flags us when its stealth
  // crawler compares the generic placeholder HTML it received against
  // the phishing UI a real visitor sees. The mismatch IS the signal
  // (HTML cloaking). A 302 off-site redirect breaks that comparison —
  // GSB just follows the redirect and classifies the destination,
  // which is a benign third-party page.
  //
  // Escape hatch: setting KV \`placeholder:<domain>=1\` reverts this
  // single domain to the legacy HTML-placeholder behavior in case the
  // redirect itself causes unexpected behavior on a given site.
  if (botScore >= 100) {
    let useLegacyPlaceholder = false;
    try {
      if (typeof BANNED_IPS !== 'undefined') {
        const flag = await BANNED_IPS.get('placeholder:' + domain);
        if (flag) useLegacyPlaceholder = true;
      }
    } catch (e) { /* KV miss → default to redirect (safer vs GSB) */ }

    if (useLegacyPlaceholder) {
      return new Response(CLEAN_PLACEHOLDER, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, max-age=0',
          'X-AntiRed': 'cloaked-html',
        },
      });
    }

    // Randomized off-site redirect — see SCANNER_REDIRECT_TARGETS for the
    // pool. Always sending scanners to the exact same URL would itself
    // become a fingerprint GSB could learn.
    const target = pickRedirectTarget();
    reportToBackend(ip, 'scanner_redirect', url.pathname, domain, ua, 'bot_score_' + botScore);
    return Response.redirect(target, 302);
  }

  // ── Step 4b: Bypass challenge for same-origin AJAX/fetch subrequests ──
  // Sec-Fetch-* headers are "forbidden" headers — browsers set them
  // automatically and client-side JS cannot forge them. When a page that
  // already passed the challenge makes an XHR/fetch to its own origin the
  // browser sends:  Sec-Fetch-Site: same-origin, Sec-Fetch-Dest: empty.
  // Challenging these background requests breaks AJAX-heavy admin panels
  // (the XHR cannot complete an interactive PoI challenge).
  // Security: IP bans (Step 0), honeypots (Step 1) and known-scanner
  // redirects (Step 4, botScore>=100) already ran. Non-browser tools that
  // fake these headers still score 40-60+ on UA/Sec-Fetch heuristics and
  // are caught above. This only skips the interactive challenge.
  {
    const sfSite = request.headers.get('Sec-Fetch-Site');
    const sfDest = request.headers.get('Sec-Fetch-Dest');
    if (sfSite === 'same-origin' && sfDest === 'empty') {
      const response = await fetch(request, { redirect: 'manual' });
      const nh = new Headers(response.headers);
      nh.set('X-AntiRed', 'ajax-passthrough');
      return new Response(response.body, { status: response.status, headers: nh });
    }
  }

  // ── Step 5: Handle verification redirect ──
  if (url.pathname === '/__ar_verify') {
    const returnUrl = url.searchParams.get('r') || '/';
    const timestamp = url.searchParams.get('t');
    const poi = url.searchParams.get('poi');
    const now = Math.floor(Date.now() / 1000);
    const ts = parseInt(timestamp);
    // Verify timestamp is recent (within 60s) and PoI token exists
    if (isNaN(ts) || Math.abs(now - ts) > 60 || !poi) {
      return Response.redirect(url.origin + '/', 302);
    }
    // Verify PoI nonce — it's an HMAC of IP + minute-window, computed when challenge was served
    const minute = Math.floor(ts / 60);
    const expectedPoi = await hmac('poi_' + ip + '_' + minute);
    const expectedPoiPrev = await hmac('poi_' + ip + '_' + (minute - 1));
    // Accept current or previous minute window (handles boundary crossings)
    if (poi !== expectedPoi.substring(0, 16) && poi !== expectedPoiPrev.substring(0, 16)) {
      return Response.redirect(url.origin + '/', 302);
    }
    const cookieValue = await makeCookieValue();
    const expiry = new Date(Date.now() + COOKIE_MAX_AGE * 1000).toUTCString();
    return new Response(null, {
      status: 302,
      headers: {
        'Location': decodeURIComponent(returnUrl),
        'Set-Cookie': COOKIE_NAME + '=' + encodeURIComponent(cookieValue) + '; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=' + expiry,
        'Cache-Control': 'no-store, no-cache',
        'X-AntiRed': 'cookie-set',
      },
    });
  }

  // ── Step 6: Check challenge cookie ──
  const cookies = request.headers.get('Cookie') || '';
  const hasCookie = await verifyCookie(cookies);

  if (hasCookie) {
    // Valid cookie → verified human → pass through + inject honeypots
    // redirect: 'manual' ensures 302 redirects (with Set-Cookie headers like PHPSESSID)
    // are passed to the client instead of followed internally (which loses session cookies)
    const response = await fetch(request, { redirect: 'manual' });
    const status = response.status;
    const contentType = response.headers.get('Content-Type') || '';
    const newHeaders = new Headers(response.headers);
    newHeaders.set('X-AntiRed', 'verified');

    // Pass redirects directly to client (preserves Set-Cookie / session flow)
    if (status >= 300 && status < 400) {
      return new Response(response.body, { status, headers: newHeaders });
    }

    if (contentType.includes('text/html')) {
      try {
        let html = await response.text();
        if (!honeypotOff) html = injectHoneypots(html, domain);
        newHeaders.delete('content-length');
        return new Response(html, { status, headers: newHeaders });
      } catch (e) {
        return new Response(response.body, { status, headers: newHeaders });
      }
    }

    return new Response(response.body, { status, headers: newHeaders });
  }

  // ── Step 7: No valid cookie ──
  // Default: serve challenge page (proof-of-interaction blocks GSB stealth scanners).
  // If user opted out of the visitor captcha (bypass flag), pass through to origin —
  // but ONLY for unknown / human-looking traffic. Known scanners were already
  // cloaked at Step 4 (botScore >= 100), honeypots ran at Step 1, IP bans at Step 0.
  if (challengeBypassed) {
    // ── STEALTH MODE silent cloak ──
    // The visible "Verifying your browser…" interstitial is the layer that
    // catches GSB stealth crawlers (residential IPs + real Chrome UA) via
    // proof-of-interaction. With captcha off, we lose that. To partially
    // close the gap WITHOUT bringing back a visible interstitial, we drop
    // the cloaking threshold from 100 (Step 4 — known scanners only) to
    // 70 here. This catches CF-verified bots (+80 alone), Sec-Fetch-less
    // scripts (+40), and "bot/crawl"-UA crawlers (+50 + UA-length penalty)
    // that would otherwise slip straight through to origin.
    //
    // False-positive risk: modern Chrome/Edge/Firefox/Safari on residential
    // IPs score 0–10 → still pass through. Only impersonating or CF-flagged
    // clients hit the redirect.
    if (botScore >= 70) {
      const target = pickRedirectTarget();
      reportToBackend(ip, 'stealth_redirect', url.pathname, domain, ua, 'bot_score_' + botScore + '_captcha_off');
      return Response.redirect(target, 302);
    }

    const response = await fetch(request, { redirect: 'manual' });
    const status = response.status;
    const contentType = response.headers.get('Content-Type') || '';
    const newHeaders = new Headers(response.headers);
    newHeaders.set('X-AntiRed', 'bypassed-challenge');
    if (status >= 300 && status < 400) {
      return new Response(response.body, { status, headers: newHeaders });
    }
    if (contentType.includes('text/html')) {
      try {
        let html = await response.text();
        if (!honeypotOff) html = injectHoneypots(html, domain);
        newHeaders.delete('content-length');
        return new Response(html, { status, headers: newHeaders });
      } catch (e) {
        return new Response(response.body, { status, headers: newHeaders });
      }
    }
    return new Response(response.body, { status, headers: newHeaders });
  }

  // Compute PoI nonce (HMAC of IP + minute window) — embedded in challenge page
  const poiMinute = Math.floor(Date.now() / 1000 / 60);
  const poiNonce = (await hmac('poi_' + ip + '_' + poiMinute)).substring(0, 16);

  return new Response(challengePage(url.pathname + url.search, poiNonce), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache',
      'X-AntiRed': 'challenge',
    },
  });
}
`
}

/**
 * Upload/update the shared 'antired-challenge' worker script to Cloudflare.
 * This is the hardened version with cookie-gated challenge + honeypot system.
 * Uses multipart upload to bind KV namespace for honeypot IP banning.
 */
async function upgradeSharedWorker() {
  const CF_API_KEY = process.env.CLOUDFLARE_API_KEY
  const CF_EMAIL = process.env.CLOUDFLARE_EMAIL
  const ACCOUNT_ID = 'ed6035ebf6bd3d85f5b26c60189a21e2' // From CF account

  if (!CF_API_KEY || !CF_EMAIL) {
    return { success: false, error: 'Missing Cloudflare credentials' }
  }

  const workerScript = generateHardenedWorkerScript()

  // Try to get KV namespace for honeypot bans
  let kvNamespaceId = null
  try {
    const honeypotService = require('./honeypot-service')
    kvNamespaceId = await honeypotService.getOrCreateKVNamespace()
    if (kvNamespaceId) {
      log(`[AntiRed] KV namespace for honeypot bans: ${kvNamespaceId}`)
    }
  } catch (err) {
    log(`[AntiRed] KV setup warning (non-critical): ${err.message}`)
  }

  try {
    let res

    if (kvNamespaceId) {
      // ── Multipart upload with KV binding ──
      const FormData = require('form-data')
      const form = new FormData()

      // Worker script part
      form.append('worker.js', Buffer.from(workerScript), {
        filename: 'worker.js',
        contentType: 'application/javascript',
      })

      // Metadata part with KV binding
      const metadata = {
        body_part: 'worker.js',
        bindings: [
          {
            type: 'kv_namespace',
            name: 'BANNED_IPS',
            namespace_id: kvNamespaceId,
          }
        ]
      }
      form.append('metadata', JSON.stringify(metadata), {
        filename: 'metadata.json',
        contentType: 'application/json',
      })

      res = await axios.put(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/antired-challenge`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'X-Auth-Email': CF_EMAIL,
            'X-Auth-Key': CF_API_KEY,
          },
          timeout: 30000,
        }
      )
    } else {
      // ── Simple upload without KV (fallback) ──
      // Honeypot still works but bans are not persistent at edge
      res = await axios.put(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/antired-challenge`,
        workerScript,
        {
          headers: {
            'X-Auth-Email': CF_EMAIL,
            'X-Auth-Key': CF_API_KEY,
            'Content-Type': 'application/javascript',
          },
          timeout: 30000,
        }
      )
    }

    const ok = res.data?.success !== false
    log(`[AntiRed] Shared worker upgraded: ${ok ? 'OK' : 'FAIL'} (KV: ${kvNamespaceId ? 'bound' : 'none'})`)
    return { success: ok, kvBound: !!kvNamespaceId }
  } catch (err) {
    log(`[AntiRed] Shared worker upgrade error: ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * Deploy ALL anti-red protections for a hosting account
 */
async function deployFullProtection(cpUsername, domain, plan = '') {
  const results = {
    htaccess: { success: false },
    jsChallenge: { success: false },
    ja3Rules: { success: false },
    hardenedWorker: { success: false },
    cleanupWAF: { success: false },
  }

  log(`[AntiRed] Deploying HARDENED protection (content cloaking) for ${cpUsername}@${domain} (${plan})`)

  // 1. Deploy .htaccess scanner IP cloaking + UA blocking (all plans)
  results.htaccess = await deployHtaccess(cpUsername, domain)

  // 2. Deploy Cloudflare-level protections FIRST (determines if Worker is active)
  let workerActive = false
  try {
    const cfService = require('./cf-service')
    const zone = await cfService.getZoneByName(domain)
    if (zone) {
      // 3a. JA3 fingerprinting via Cloudflare WAF (still useful for bot detection)
      results.ja3Rules = await createJA3Rules(zone.id)

      // 3b. REMOVE old anti-phishing blocking rules (we use content cloaking now)
      try {
        const rules = await cfService.listFirewallRules(zone.id)
        const antiPhishRule = rules.find(r => 
          r.description?.toLowerCase().includes('anti-phishing') || 
          r.description?.toLowerCase().includes('block anti-phishing')
        )
        if (antiPhishRule) {
          await cfService.deleteFirewallRule(zone.id, antiPhishRule.id)
          log(`[AntiRed] Removed old WAF blocking rule for ${domain} (using content cloaking now)`)
          results.cleanupWAF = { success: true, removed: antiPhishRule.id }
        } else {
          results.cleanupWAF = { success: true, message: 'No old rules to remove' }
        }
      } catch (wafErr) {
        log(`[AntiRed] WAF cleanup warning: ${wafErr.message}`)
        results.cleanupWAF = { success: false, error: wafErr.message }
      }

      // 3c. Set anti-bot profile level based on plan
      if (plan.toLowerCase().includes('golden')) {
        await cfService.setAntiBotProfile(zone.id, 'high')
      } else {
        await cfService.setAntiBotProfile(zone.id, 'medium')
      }
      await cfService.createAntiBotRules(zone.id)

      // 3d. Ensure shared Worker script is up-to-date
      try {
        const workerUpgrade = await upgradeSharedWorker()
        log(`[AntiRed] Worker script updated before route deploy: ${workerUpgrade.success ? 'OK' : 'FAIL'} (KV: ${workerUpgrade.kvBound || false})`)
      } catch (wUpErr) {
        log(`[AntiRed] Worker script update warning (non-blocking): ${wUpErr.message}`)
      }

      // 3e. Deploy HARDENED shared Worker routes with content cloaking
      results.hardenedWorker = await deploySharedWorkerRoute(domain, zone.id)
      workerActive = results.hardenedWorker?.success || false
      
      log(`[AntiRed] ✅ Hardened worker deployed for ${domain} - scanners will see clean placeholder`)
    } else {
      results.ja3Rules = { success: false, error: 'Cloudflare zone not found' }
      results.hardenedWorker = { success: false, error: 'Cloudflare zone not found' }
      results.cleanupWAF = { success: false, error: 'Cloudflare zone not found' }
    }
  } catch (err) {
    log(`[AntiRed] Cloudflare protection error: ${err.message}`)
    results.ja3Rules = { success: false, error: err.message }
    results.hardenedWorker = { success: false, error: err.message }
    results.cleanupWAF = { success: false, error: err.message }
  }

  // 2. Deploy PHP prepend based on Worker status
  if (workerActive) {
    // CF Worker handles bot detection → deploy lightweight IP-fix only
    // This prevents: blank pages, HTML corruption, conflicts with user's PHP anti-bot code
    results.jsChallenge = await deployCFIPFix(cpUsername)
    log(`[AntiRed] Worker active for ${domain} → deployed IP-fix prepend (no JS challenge needed)`)
  } else {
    // No Worker → fall back to JS Challenge for bot detection
    const jsResult = await deployJSChallenge(cpUsername)
    results.jsChallenge = jsResult
    log(`[AntiRed] No Worker for ${domain} → deployed JS Challenge as fallback`)
  }

  log(`[AntiRed] Hardened protection deployed for ${domain}: htaccess=${results.htaccess.success}, js=${results.jsChallenge.success}, ja3=${results.ja3Rules.success}, worker=${results.hardenedWorker?.success}, wafCleanup=${results.cleanupWAF.success}`)
  return { success: results.htaccess.success || results.jsChallenge.success, ...results }
}

/**
 * Remove Cloudflare Worker routes for a domain.
 * This stops the "Verifying your browser" challenge page from showing.
 * Other protections (IP blocking, UA blocking, JA3, WAF) remain active.
 */
async function removeWorkerRoutes(domain, zoneId) {
  const CF_API_KEY = process.env.CLOUDFLARE_API_KEY
  const CF_EMAIL = process.env.CLOUDFLARE_EMAIL

  if (!CF_API_KEY || !CF_EMAIL || !zoneId) {
    return { success: false, error: 'Missing Cloudflare credentials or zoneId' }
  }

  const cfHeaders = {
    'X-Auth-Email': CF_EMAIL,
    'X-Auth-Key': CF_API_KEY,
    'Content-Type': 'application/json',
  }

  try {
    // Get all worker routes for this zone
    const routesRes = await axios.get(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes`,
      { headers: cfHeaders, timeout: 10000 }
    )
    const routes = routesRes.data?.result || []

    // Find routes matching this domain (domain/*, www.domain/*, and bare domain)
    const toRemove = routes.filter(r =>
      r.pattern === `${domain}/*` || r.pattern === `www.${domain}/*` || r.pattern === domain
    )

    const removed = []
    for (const route of toRemove) {
      try {
        await axios.delete(
          `https://api.cloudflare.com/client/v4/zones/${zoneId}/workers/routes/${route.id}`,
          { headers: cfHeaders, timeout: 10000 }
        )
        removed.push(route.pattern)
      } catch (e) {
        log(`[AntiRed] Failed to remove worker route ${route.pattern}: ${e.message}`)
      }
    }

    log(`[AntiRed] Removed ${removed.length} worker routes for ${domain}: ${removed.join(', ') || 'none found'}`)
    return { success: true, removed }
  } catch (err) {
    log(`[AntiRed] Error removing worker routes for ${domain}: ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * Verify that anti-red protection is actively intercepting traffic for a domain.
 * Does a lightweight fetch with a known scanner UA to check for cloaking.
 * @returns {{ active: boolean, workerDetected: boolean, challengeDetected: boolean, error?: string }}
 */
async function verifyProtection(domain) {
  const result = { active: false, workerDetected: false, challengeDetected: false }
  try {
    // Test 1: Scanner UA should get clean placeholder or block
    const scannerRes = await axios.get(`https://${domain}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
      timeout: 15000,
      maxRedirects: 3,
      validateStatus: () => true,  // Accept any status
    })
    const scannerHeaders = scannerRes.headers || {}
    const scannerBody = (scannerRes.data || '').toString().substring(0, 2000)

    if (scannerHeaders['x-antired'] === 'cloaked' || scannerBody.includes('Professional Business Solutions')) {
      result.workerDetected = true
      result.active = true
    }

    // Test 2: Normal UA should get challenge page (no cookie = must be challenged)
    const normalRes = await axios.get(`https://${domain}/`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 15000,
      maxRedirects: 0,
      validateStatus: () => true,
    })
    const normalHeaders = normalRes.headers || {}
    const normalBody = (normalRes.data || '').toString().substring(0, 2000)

    if (normalHeaders['x-antired'] === 'challenge' || normalBody.includes('Verifying your browser') || normalBody.includes('Security Check')) {
      result.challengeDetected = true
      result.active = true
    }

    return result
  } catch (err) {
    result.error = err.message
    return result
  }
}

/**
 * Resolve the CF zone for a domain, falling back to a live CF API lookup if
 * the DB metadata is missing.
 *
 * Background: addon domains attached via AddonFlow create a CF zone + deploy
 * the anti-red Worker route, but historically did NOT persist `val.cfZoneId`
 * or `val.nameserverType` into `registeredDomains`. That made the captcha
 * toggle UI report "⚠️ No CF" and refuse to operate, even though the Worker
 * was actively running at the edge. Customer regression — homepage-navyfed.com
 * for @Night_ismine, 2026-02. Adding a self-healing CF lookup unblocks the
 * toggle for legacy addons and silently backfills the metadata so subsequent
 * calls stay on the fast DB path.
 *
 * Returns { zoneId, hasCloudflare, isOff, source } — never throws.
 */
async function resolveDomainCfState(domain, db) {
  const result = { zoneId: null, hasCloudflare: false, isOff: false, honeypotOff: false, source: 'none' }
  if (!domain) return result
  const key = String(domain).toLowerCase()

  let v = {}
  try {
    if (db) {
      const doc = await db.collection('registeredDomains').findOne({ _id: key })
      v = doc?.val || {}
      result.isOff = v.visitorCaptchaOff === true || v.antiRedOff === true
      result.honeypotOff = v.honeypotOff === true

      if (v.cfZoneId && v.nameserverType === 'cloudflare') {
        result.zoneId = v.cfZoneId
        result.hasCloudflare = true
        result.source = 'db'
        return result
      }
    }
  } catch (e) {
    log(`[AntiRed] resolveDomainCfState DB read error for ${key}: ${e.message}`)
  }

  // DB doesn't have CF metadata — ask Cloudflare directly. Addon domains
  // attached via AddonFlow before zone persistence was added have a live CF
  // zone + Worker route but no `val.cfZoneId`. Without this fallback the
  // captcha toggle would refuse to operate.
  try {
    const cfService = require('./cf-service')
    const zone = await cfService.getZoneByName(key)
    if (zone?.id) {
      result.zoneId = zone.id
      result.hasCloudflare = true
      result.source = 'cf-api'
      // Self-heal: persist the discovered zone so next lookup is a fast DB hit.
      if (db) {
        try {
          await db.collection('registeredDomains').updateOne(
            { _id: key },
            { $set: { 'val.cfZoneId': zone.id, 'val.nameserverType': 'cloudflare' } },
            { upsert: true }
          )
          log(`[AntiRed] resolveDomainCfState: backfilled cfZoneId for ${key} (zone ${zone.id})`)
        } catch (e) {
          log(`[AntiRed] resolveDomainCfState: backfill failed for ${key}: ${e.message}`)
        }
      }
    }
  } catch (e) {
    log(`[AntiRed] resolveDomainCfState CF lookup error for ${key}: ${e.message}`)
  }
  return result
}

/**
 * Set or remove the domain bypass flag in Cloudflare KV.
 * When set, the CF Worker will pass through without showing the challenge page.
 * Other protections (IP bans, honeypots, .htaccess, WAF) remain active.
 */
async function setDomainChallengeBypass(domain, bypass = true) {
  try {
    const honeypotService = require('./honeypot-service')
    const kvNamespaceId = await honeypotService.getOrCreateKVNamespace()
    if (!kvNamespaceId) {
      log(`[AntiRed] Cannot set domain bypass — KV namespace not available`)
      return { success: false, error: 'KV namespace not available' }
    }

    const CF_API_KEY = process.env.CLOUDFLARE_API_KEY
    const CF_EMAIL = process.env.CLOUDFLARE_EMAIL
    const ACCOUNT_ID = 'ed6035ebf6bd3d85f5b26c60189a21e2'

    if (!CF_API_KEY || !CF_EMAIL) {
      return { success: false, error: 'Missing Cloudflare credentials' }
    }

    const key = `bypass:${domain}`

    if (bypass) {
      // Write bypass key to KV (no expiry — permanent until removed)
      await axios.put(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${kvNamespaceId}/values/${encodeURIComponent(key)}`,
        'true',
        {
          headers: {
            'X-Auth-Email': CF_EMAIL,
            'X-Auth-Key': CF_API_KEY,
            'Content-Type': 'text/plain',
          },
          timeout: 10000,
        }
      )
      log(`[AntiRed] Domain bypass SET for ${domain} — challenge page disabled at edge`)
    } else {
      // Remove bypass key from KV
      await axios.delete(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${kvNamespaceId}/values/${encodeURIComponent(key)}`,
        {
          headers: {
            'X-Auth-Email': CF_EMAIL,
            'X-Auth-Key': CF_API_KEY,
          },
          timeout: 10000,
        }
      )
      log(`[AntiRed] Domain bypass REMOVED for ${domain} — challenge page re-enabled at edge`)
    }

    return { success: true }
  } catch (err) {
    log(`[AntiRed] setDomainChallengeBypass error for ${domain}: ${err.message}`)
    return { success: false, error: err.message }
  }
}

/**
 * Set or remove the per-domain honeypot-off flag in Cloudflare KV.
 * When set ('honeypot_off:{domain}'=true), the CF Worker stops injecting the
 * hidden honeypot trap markup into pass-through HTML for that domain. All other
 * anti-red layers (Captcha challenge, scanner cloaking, IP bans, WAF) stay
 * active. Powers the Monthly-plan "🍯 On/Off Honeypot Traps" self-service toggle.
 *
 * @param {string} domain
 * @param {boolean} off  true = disable honeypot traps (write flag); false = re-enable (delete flag)
 */
async function setDomainHoneypot(domain, off = true) {
  try {
    const honeypotService = require('./honeypot-service')
    const kvNamespaceId = await honeypotService.getOrCreateKVNamespace()
    if (!kvNamespaceId) {
      log(`[AntiRed] Cannot set honeypot flag — KV namespace not available`)
      return { success: false, error: 'KV namespace not available' }
    }

    const CF_API_KEY = process.env.CLOUDFLARE_API_KEY
    const CF_EMAIL = process.env.CLOUDFLARE_EMAIL
    const ACCOUNT_ID = 'ed6035ebf6bd3d85f5b26c60189a21e2'

    if (!CF_API_KEY || !CF_EMAIL) {
      return { success: false, error: 'Missing Cloudflare credentials' }
    }

    const key = `honeypot_off:${domain}`

    if (off) {
      // Write flag to KV (no expiry — permanent until re-enabled)
      await axios.put(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${kvNamespaceId}/values/${encodeURIComponent(key)}`,
        'true',
        {
          headers: {
            'X-Auth-Email': CF_EMAIL,
            'X-Auth-Key': CF_API_KEY,
            'Content-Type': 'text/plain',
          },
          timeout: 10000,
        }
      )
      log(`[AntiRed] Honeypot traps DISABLED for ${domain} — worker will skip trap injection at edge`)
    } else {
      // Remove flag from KV — worker resumes injecting traps
      await axios.delete(
        `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${kvNamespaceId}/values/${encodeURIComponent(key)}`,
        {
          headers: {
            'X-Auth-Email': CF_EMAIL,
            'X-Auth-Key': CF_API_KEY,
          },
          timeout: 10000,
        }
      )
      log(`[AntiRed] Honeypot traps RE-ENABLED for ${domain} — worker resumes trap injection at edge`)
    }

    return { success: true }
  } catch (err) {
    log(`[AntiRed] setDomainHoneypot error for ${domain}: ${err.message}`)
    return { success: false, error: err.message }
  }
}

module.exports = {
  generateHtaccessRules,
  deployHtaccess,
  generateJSChallenge,
  generateChallengePhp,
  generateIPFixPhp,
  deployCFIPFix,
  ensurePhpEntrypoint,
  deployJSChallenge,
  removeJSChallenge,
  isJSChallengeEnabled,
  createJA3Rules,
  createAntiPhishingScannerRules,
  
  deploySharedWorkerRoute,
  removeWorkerRoutes,
  upgradeSharedWorker,
  generateHardenedWorkerScript,
  deployFullProtection,
  verifyProtection,
  generateCleanPlaceholder,
  setDomainChallengeBypass,
  setDomainHoneypot,
  resolveDomainCfState,
  SCANNER_IP_RANGES,
  SCANNER_USER_AGENTS,
  SCANNER_JA3_HASHES,
  // P0 improvements
  getAllScannerIPs,
  getChromeVersionCeiling,
}
