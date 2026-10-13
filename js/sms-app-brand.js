// Brand + APK resolution for the BulkSMS app — single source of truth for
// "which APK / version / name does THIS bot serve". Driven by CHAT_BOT_BRAND.
const fs = require('fs')
const path = require('path')

const STATIC_DIRS = [path.join(__dirname, '..', 'static'), path.join(__dirname, '..', 'backend', 'static')]

function brandName() { return String(process.env.CHAT_BOT_BRAND || 'Nomadly').trim() || 'Nomadly' }
function brandSlug() { return brandName().toLowerCase().replace(/[^a-z0-9]+/g, '') || 'nomadly' }
function appName() { return `${brandName()} SMS` }

let _botUsername = process.env.TELEGRAM_BOT_USERNAME || process.env.BOT_USERNAME || 'NomadlyBot'
function setBotUsername(u) { if (u) _botUsername = String(u).replace(/^@/, '') }
function botUsername() { return _botUsername }
function botUrl() { return `https://t.me/${botUsername()}` }

function packageVersion() {
  try { return require(path.join(__dirname, '..', 'sms-app', 'package.json')).version } catch { return null }
}

// static/<slug>-sms.apk (+ optional <file>.json manifest written by scripts/build_apk.sh)
function resolveApk() {
  const slug = brandSlug()
  const file = `${slug}-sms.apk`
  let found = null
  for (const dir of STATIC_DIRS) {
    const p = path.join(dir, file)
    if (fs.existsSync(p)) { found = p; break }
  }
  let manifest = null
  if (found) { try { manifest = JSON.parse(fs.readFileSync(`${found}.json`, 'utf8')) } catch { manifest = null } }
  const size = found ? fs.statSync(found).size : 0
  return {
    slug, brandName: brandName(), appName: appName(), file,
    path: found, exists: !!found, size,
    version: manifest?.version || packageVersion() || '0.0.0',
    builtAt: manifest?.builtAt || null,
    downloadName: `${brandName().replace(/\s+/g, '')}SMS.apk`,
  }
}

function latestVersion() { return resolveApk().version }

module.exports = { brandName, brandSlug, appName, botUsername, botUrl, setBotUsername, resolveApk, latestVersion, packageVersion }
