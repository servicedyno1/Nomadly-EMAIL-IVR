/*global process */
require('dotenv').config()
const axios = require('axios')
const { log } = require('console')
const API_TOKEN = process.env.API_KEY_RAILWAY

const RENDER_AUTH_TOKEN = process.env.RENDER_AUTH_TOKEN
const DOMAINS_CONNECT_TO_RENDER_SERVICE_ID = process.env.DOMAINS_CONNECT_TO_RENDER_SERVICE_ID
const RENDER_APP_IP_ADDRESS = process.env.RENDER_APP_IP_ADDRESS
const ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID
const PROJECT_ID = process.env.RAILWAY_PROJECT_ID
const SERVICE_ID = process.env.RAILWAY_SERVICE_ID
const GRAPHQL_ENDPOINT = 'https://backboard.railway.app/graphql/v2'

// Railway supports two token types:
//   • Account/Personal API Tokens → header: `Authorization: Bearer <token>`
//   • Project Access Tokens        → header: `Project-Access-Token: <token>`
// Nomadly uses a Project Access Token (scoped to one project + environment).
// We send BOTH headers so either token type works — Railway reads whichever matches.
const railwayHeaders = () => ({
  Authorization: `Bearer ${API_TOKEN}`,
  'Project-Access-Token': API_TOKEN,
  'Content-Type': 'application/json',
})

/**
 * Query Railway for an existing custom domain's CNAME target and TXT verification record.
 * Returns { server, recordType, txtHost, txtValue } if found, or null.
 */
async function getExistingRailwayDNS(domain) {
  try {
    const query = `query {
      domains(projectId: "${PROJECT_ID}", serviceId: "${SERVICE_ID}", environmentId: "${ENVIRONMENT_ID}") {
        customDomains {
          domain
          status {
            dnsRecords {
              requiredValue
              recordType
            }
            verificationDnsHost
            verificationToken
          }
        }
      }
    }`
    const res = await axios.post(GRAPHQL_ENDPOINT, { query }, {
      headers: railwayHeaders(),
      timeout: 15000,
    })
    const customDomains = res.data?.data?.domains?.customDomains || []
    const match = customDomains.find(d => d.domain === domain)
    if (match) {
      const cname = match.status?.dnsRecords?.[0]?.requiredValue
      const txtHost = match.status?.verificationDnsHost
      const txtValue = match.status?.verificationToken
      if (cname) return { server: cname, recordType: 'CNAME', txtHost, txtValue }
    }
    return null
  } catch (err) {
    log(`[Railway] getExistingRailwayDNS error for ${domain}: ${err.message}`)
    return null
  }
}

// Keep old function name for backward compatibility
const getExistingRailwayCNAME = getExistingRailwayDNS

const saveDomainInServerRender = async domain => {
  const url = `https://api.render.com/v1/services/${DOMAINS_CONNECT_TO_RENDER_SERVICE_ID}/custom-domains`
  const payload = { name: domain }
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
    authorization: `Bearer ${RENDER_AUTH_TOKEN}`,
  }

  try {
    await axios.post(url, payload, { headers })
    return { server: RENDER_APP_IP_ADDRESS, recordType: 'A' }
  } catch (err) {
    const error = err?.message + ' ' + JSON.stringify(err?.response?.data, 0, 2)
    log('err saveDomainInServerRender', { url, payload, headers }, error)
    return { error }
  }
}
async function saveDomainInServerRailway(domain) {
  const GRAPHQL_QUERY = `
  mutation customDomainCreate {
      customDomainCreate(
          input: { domain: "${domain}", environmentId: "${ENVIRONMENT_ID}", projectId: "${PROJECT_ID}", serviceId: "${SERVICE_ID}"}
      ) {
          id
          status {
            dnsRecords {
              requiredValue
            }
            verificationDnsHost
            verificationToken
          }
      }
  }`
  const response = await axios.post(
    GRAPHQL_ENDPOINT,
    { query: GRAPHQL_QUERY },
    { headers: railwayHeaders() },
  )
  const error = response?.data?.errors?.[0]?.message

  if (error) {
    // Domain already exists on Railway — remove and re-create for clean state
    const isAlreadyExists = error.toLowerCase().includes('already') ||
      error.toLowerCase().includes('exists') ||
      error.toLowerCase().includes('duplicate') ||
      error.toLowerCase().includes('failed to create custom domain')
    if (isAlreadyExists) {
      log(`[Railway] Domain ${domain} already exists — querying existing CNAME target + TXT verification`)
      // ── Try to get the existing CNAME target first (domain is already on Railway = success) ──
      const existing = await getExistingRailwayDNS(domain)
      if (existing) {
        log(`[Railway] Domain ${domain} already on Railway → ${existing.server} (reusing)`)
        return existing
      }
      // ── Couldn't fetch CNAME — try remove + re-create as fallback ──
      log(`[Railway] Could not fetch DNS for ${domain} — attempting remove + re-create`)
      const removeResult = await removeDomainFromRailway(domain)
      if (removeResult.error) {
        log(`[Railway] Remove failed for ${domain}: ${removeResult.error}`)
        return { error: `Domain exists on Railway but could not be removed: ${removeResult.error}` }
      }
      // Wait briefly for Railway to process the deletion
      await new Promise(r => setTimeout(r, 3000))
      // Re-create
      const retryResponse = await axios.post(
        GRAPHQL_ENDPOINT,
        { query: GRAPHQL_QUERY },
        { headers: railwayHeaders() },
      )
      const retryError = retryResponse?.data?.errors?.[0]?.message
      if (retryError) {
        log(`[Railway] Re-create failed for ${domain}: ${retryError}`)
        return { error: retryError }
      }
      const result = retryResponse?.data?.data?.customDomainCreate
      const server = result?.status?.dnsRecords[0]?.requiredValue
      const txtHost = result?.status?.verificationDnsHost
      const txtValue = result?.status?.verificationToken
      log(`[Railway] Re-created ${domain} → ${server}`)
      return { server, recordType: 'CNAME', txtHost, txtValue }
    }
    log('Error saveDomainInServerRailway', error)
    log('domain', domain, 'GraphQL Response:', JSON.stringify(response.data, null, 2))
    return { error }
  }

  const result = response?.data?.data?.customDomainCreate
  const server = result?.status?.dnsRecords[0]?.requiredValue
  const txtHost = result?.status?.verificationDnsHost
  const txtValue = result?.status?.verificationToken

  return { server, recordType: 'CNAME', txtHost, txtValue }
}
async function isRailwayAPIWorking() {
  const GRAPHQL_QUERY = `
  query me {
  me {
    projects {
      edges {
        node {
          id
          name
        }
      }
    }
  }
}`
  const response = await axios.post(
    GRAPHQL_ENDPOINT,
    { query: GRAPHQL_QUERY },
    { headers: railwayHeaders() },
  )
  const error = response?.data?.errors?.[0]?.message

  log('isRailwayAPIWorking')

  if (error) {
    log('Error query me', error)
    return { error }
  }

  return response.data
}

// isRailwayAPIWorking();
// saveDomainInServerRailway('blockbee.com').then(log);
// saveDomainInServerRender('ehtesham.sbs').then(log);

// Classify an axios/network error as transient (caller-safe to retry).
// Transient = 5xx, network errors, timeouts. Anything else is treated as
// a hard failure that the caller should surface explicitly.
function _classifyRailwayError(err) {
  const statusCode = err?.response?.status
  const code = err?.code // ECONNRESET, ETIMEDOUT, ENOTFOUND…
  const transientCodes = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN'])
  if (statusCode && statusCode >= 500 && statusCode < 600) return { transient: true, statusCode }
  if (!statusCode && (transientCodes.has(code) || /timeout|network/i.test(err?.message || ''))) {
    return { transient: true, statusCode: null }
  }
  return { transient: false, statusCode: statusCode || null }
}

// List all custom domains currently claimed by this Railway service.
// Used by the reconciler to detect "orphan" state where the upstream
// still has the domain but the Cloudflare CNAME has been deleted.
// Returns Promise<string[]> on success, or [] on any error (fail-safe).
async function listRailwayCustomDomains() {
  const query = `query {
    domains(projectId: "${PROJECT_ID}", serviceId: "${SERVICE_ID}", environmentId: "${ENVIRONMENT_ID}") {
      customDomains { domain }
    }
  }`
  // Bumped from 15s → 30s and added a single retry with 500ms backoff.
  // Railway's control plane occasionally takes >15s during peak load,
  // producing spurious "listRailwayCustomDomains failed: timeout" logs
  // that the reconciler then treats as an empty list (fail-safe).
  const TIMEOUT_MS = 30000
  const MAX_ATTEMPTS = 2
  let lastErr = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await axios.post(
        GRAPHQL_ENDPOINT,
        { query },
        { headers: railwayHeaders(), timeout: TIMEOUT_MS },
      )
      const customDomains = resp?.data?.data?.domains?.customDomains || []
      return customDomains.map(d => d.domain).filter(Boolean)
    } catch (err) {
      lastErr = err
      const isTransient = err.code === 'ECONNABORTED' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT' || /timeout/i.test(err.message || '')
      if (attempt < MAX_ATTEMPTS && isTransient) {
        await new Promise(r => setTimeout(r, 500 * attempt))
        continue
      }
      break
    }
  }
  log(`[Railway] listRailwayCustomDomains failed after ${MAX_ATTEMPTS} attempts: ${lastErr && lastErr.message} — returning empty list`)
  return []
}

async function removeDomainFromRailway(domain) {
  try {
    // Step 1: Look up the domain's Railway ID
    const listQuery = `query {
      domains(projectId: "${PROJECT_ID}", serviceId: "${SERVICE_ID}", environmentId: "${ENVIRONMENT_ID}") {
        customDomains { id domain }
      }
    }`
    const listResp = await axios.post(
      GRAPHQL_ENDPOINT,
      { query: listQuery },
      { headers: railwayHeaders() },
    )
    const customDomains = listResp?.data?.data?.domains?.customDomains || []
    const match = customDomains.find(d => d.domain === domain)
    if (!match) {
      log(`[Railway] Domain ${domain} not found in Railway custom domains — nothing to remove`)
      return { success: true, note: 'domain_not_found' }
    }

    // Step 2: Delete by ID
    const deleteQuery = `mutation { customDomainDelete(id: "${match.id}") }`
    const deleteResp = await axios.post(
      GRAPHQL_ENDPOINT,
      { query: deleteQuery },
      { headers: railwayHeaders() },
    )
    const error = deleteResp?.data?.errors?.[0]?.message
    if (error) {
      log(`[Railway] Error deleting domain ${domain} (id=${match.id}):`, error)
      // GraphQL-level errors are application errors → not transient
      return { error, transient: false, statusCode: null }
    }
    log(`[Railway] Domain ${domain} removed successfully (id=${match.id})`)
    return { success: true }
  } catch (err) {
    const cls = _classifyRailwayError(err)
    log(`Error removeDomainFromRailway ${err.message} (transient=${cls.transient}, status=${cls.statusCode || 'n/a'})`)
    return { error: err.message, transient: cls.transient, statusCode: cls.statusCode }
  }
}

// HOSTED_ON=droplet routes every "upstream" call to the droplet-native implementation
// (nginx + Cloudflare A record) while keeping the historical function names for all callers.
const droplet = require('./droplet-domain-server.js')
const pick = (dropletFn, railwayFn) => (...args) => (droplet.isDroplet() ? dropletFn(...args) : railwayFn(...args))

// Shortener-origin host operations. On this platform HOSTED_ON=droplet, so these
// route to the DigitalOcean droplet server; the Railway implementations remain
// only as a fallback for isDroplet()===false. The `*Host`/`*Server` names are the
// current terminology; the `*Railway` keys are kept as deprecated aliases.
const saveShortenerHost = pick(droplet.saveDomainInServer, saveDomainInServerRailway)
const removeShortenerHost = pick(droplet.removeDomainFromServer, removeDomainFromRailway)
const getExistingHostDNS = pick(droplet.getExistingServerDNS, getExistingRailwayDNS)
const listShortenerHostDomains = pick(droplet.listServerDomains, listRailwayCustomDomains)

module.exports = {
  // Current (host/droplet) terminology:
  saveShortenerHost,
  removeShortenerHost,
  getExistingHostDNS,
  listShortenerHostDomains,
  // Deprecated aliases (kept so older callers / ops scripts keep working):
  saveDomainInServerRailway: saveShortenerHost,
  removeDomainFromRailway: removeShortenerHost,
  getExistingRailwayDNS: getExistingHostDNS,
  listRailwayCustomDomains: listShortenerHostDomains,
  isRailwayAPIWorking,
  saveDomainInServerRender,
  isShortenerDnsRecord: droplet.isShortenerDnsRecord,
}
