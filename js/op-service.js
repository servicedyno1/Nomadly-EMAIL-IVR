/* global process */
require('dotenv').config()
const axios = require('axios')
const { log } = require('console')

const OP_BASE_URL = 'https://api.openprovider.eu'
const OP_USERNAME = process.env.OPENPROVIDER_USERNAME
const OP_PASSWORD = process.env.OPENPROVIDER_PASSWORD
// Registrant/contact email used for OpenProvider contact handles. Must be a
// MONITORED inbox — several TLDs (.it, and OP's own registrant/contact
// validation flow) email a confirmation link that must be actioned, or the
// registration is suspended/removed by the registry. Overridable via env.
const SERVICE_EMAIL = process.env.NOMADLY_SERVICE_EMAIL || 'gidineter@gmail.com'
const PERCENT_INCREASE_DOMAIN = 1 + Number(process.env.PERCENT_INCREASE_DOMAIN || 0)
const MIN_DOMAIN_PRICE = Number(process.env.MIN_DOMAIN_PRICE || 30)

// OpenProvider built-in DNS hosting nameservers — used when provider_default is selected
const OP_DEFAULT_NS = ['ns1.openprovider.nl', 'ns2.openprovider.be', 'ns3.openprovider.eu']

let cachedToken = null
let tokenExpiry = 0

// ─── Auth ───────────────────────────────────────────────

const authenticate = async () => {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken
  try {
    const res = await axios.post(`${OP_BASE_URL}/v1beta/auth/login`, {
      username: OP_USERNAME,
      password: OP_PASSWORD,
    }, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 })

    if (res.data?.code === 0 && res.data?.data?.token) {
      cachedToken = res.data.data.token
      tokenExpiry = Date.now() + 3500 * 1000
      log('OpenProvider auth success')
      return cachedToken
    }
    log('OpenProvider auth failed:', res.data)
    return null
  } catch (err) {
    log('OpenProvider auth error:', err.message)
    return null
  }
}

const authHeaders = async () => {
  const token = await authenticate()
  if (!token) throw new Error('OpenProvider authentication failed')
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
}

// ─── Helpers ────────────────────────────────────────────

// .au-family TLDs that follow the auDA registry's registrant-eligibility rules.
// .org.au is intentionally excluded — it requires a non-profit registrant
// (Charity / Club / Non-profit Organisation) and a different policy_reason,
// which the generic _buildAuAdditionalData() helper does not encode.
const AU_TLDS = new Set(['au', 'com.au', 'net.au', 'id.au'])

const parseDomain = (domainName) => {
  const parts = domainName.split('.')
  const name = parts[0]
  const extension = parts.slice(1).join('.')
  return { name, extension }
}

/**
 * Country-specific TLD additional_data for .au-family registrations.
 *
 * The CORRECT schema per OpenProvider's own wiki
 * (https://doc.openprovider.eu/API_Format_Additional_Data) is just 4 fields,
 * not the 8 fields a previous web search hallucinated. Source of truth:
 *   eligibility_type              (e.g. "Company", "SoleTrader", "Charity", …)
 *   eligibility_type_relationship ("1" = exact-match/acronym/trademark,
 *                                  "2" = closely & substantially connected)
 *   id_type                       "ABN" | "ACN" | "ARBN" | "OTHER" | "TM" | …
 *   id_number                     the actual ID, digits only
 *
 * .id.au does NOT require id_type / id_number ("Required for all .AU
 * registrations except .ID.AU") — only the eligibility_* pair.
 *
 * Per OpenProvider's KB common-errors note, for `eligibility_type=Company`
 * the registry blocks ABN values and expects ACN. Hence we default to ACN
 * for Company and fall back to ABN for anything else (override with
 * AU_REGISTRANT_ID_TYPE if needed).
 *
 * Env vars (set in /app/backend/.env):
 *   AU_REGISTRANT_NAME       e.g. "APPLE PTY LTD"   (only used for logging,
 *                                                    OP infers from owner handle)
 *   AU_REGISTRANT_ABN        11-digit ABN, digits only
 *   AU_REGISTRANT_ACN        9-digit ACN, digits only
 *   AU_REGISTRANT_ID_TYPE    "ACN" (default for Company) | "ABN" | "TM" | "OTHER"
 *   AU_ELIGIBILITY_TYPE      "Company" (default) | "SoleTrader" | "TrademarkOwner" | …
 *   AU_ELIGIBILITY_RELATIONSHIP   "1" (exact match) | "2" (closely connected, default)
 *
 * Returns null when credentials are missing → caller fails fast.
 */
const _buildAuAdditionalData = (tld) => {
  const eligibilityType         = process.env.AU_ELIGIBILITY_TYPE || 'Company'
  const eligibilityRelationship = process.env.AU_ELIGIBILITY_RELATIONSHIP || '2'
  // For .id.au only the eligibility pair is needed.
  if ((tld || '').toLowerCase() === 'id.au') {
    return {
      eligibility_type:              eligibilityType,
      eligibility_type_relationship: eligibilityRelationship,
    }
  }
  // For Company, OP's registry blocks ABN and requires ACN — switch the default.
  const defaultIdType = eligibilityType.toLowerCase() === 'company' ? 'ACN' : 'ABN'
  const idType = (process.env.AU_REGISTRANT_ID_TYPE || defaultIdType).toUpperCase()
  const rawId  = idType === 'ACN'
    ? (process.env.AU_REGISTRANT_ACN || '')
    : (process.env.AU_REGISTRANT_ABN || '')
  const id     = String(rawId).replace(/\D+/g, '')   // strip any spaces / prefixes
  if (!id) return null                                // credentials missing → caller fails fast
  return {
    eligibility_type:              eligibilityType,
    eligibility_type_relationship: eligibilityRelationship,
    id_type:                       idType,
    id_number:                     id,
  }
}

const getCountryTLDData = (tld) => {
  // IMPORTANT: OpenProvider v1beta REST API expects additional_data as a FLAT object
  // e.g. { legal_type: 'CCT' } — NOT nested under TLD key like { ca: { legal_type: 'CCT' } }
  const map = {
    us: { application_purpose: 'P1', nexus_category: 'C12' },
    ca: { legal_type: 'CCT' },
    it: { entity_type: 2, nationality: 'IT', reg_code: 'IT04126990961' },
    sg: {
      registrant_type: 'organization',
      company_registration_number: process.env.SINGAPORE_COMPANY_UEN || '201688888A',
      organization_name: process.env.SINGAPORE_COMPANY_NAME || 'Hostbay PLC',
      admin_singpass_id: process.env.SINGAPORE_ADMIN_SINGPASS_ID || '201688888A',
    },
    eu: { registrant_citizenship: 'FR' },
    fr: {},
    es: { registrant_type: 1, id_number: 'X0000000T' },
    de: {},
    nl: {},
    be: { registrant_lang: 'en' },
    uk: { registrant_type: 'IND' },
    'co.uk': { registrant_type: 'IND' },
    nz: {},
    in: {},
    br: { registrant_type: 'individual', cpf: '000.000.000-00' },
    cl: {},
    mx: {},
  }
  if (map[tld] !== undefined) return map[tld]
  // .au family — all share the same registrant additional_data schema (with .id.au exception)
  if (AU_TLDS.has(tld)) return _buildAuAdditionalData(tld)
  return null
}

// ─── Domain availability & pricing ──────────────────────

const checkDomainAvailability = async (domainName) => {
  try {
    const headers = await authHeaders()
    const { name, extension } = parseDomain(domainName)

    // Pre-purchase guard — refuse .au-family TLDs when registrant ABN/ACN is unset.
    // Without this we would let the user pay and then fail at registration with
    // OpenProvider error 374 (Domain `additionalData` parameter is missing).
    const tldLower = extension.toLowerCase()
    if (AU_TLDS.has(tldLower) && !_buildAuAdditionalData(tldLower)) {
      log(`[OP] Skipping ${domainName} — AU_REGISTRANT_ABN / AU_REGISTRANT_ACN not configured`)
      return { available: false, message: 'AU domains temporarily unavailable. Contact support.' }
    }

    const res = await axios.post(`${OP_BASE_URL}/v1beta/domains/check`, {
      domains: [{ name, extension }],
      with_price: true,
    }, { headers, timeout: 15000 })

    if (res.data?.code !== 0) {
      return { available: false, message: res.data?.desc || 'OpenProvider check failed' }
    }

    const results = res.data?.data?.results
    if (!results || results.length === 0) {
      return { available: false, message: 'No results from OpenProvider' }
    }

    const result = results[0]
    const status = (result.status || '').toLowerCase()

    if (status === 'free' || status === 'available') {
      const priceObj = result.price || {}
      const createPrice = parseFloat(priceObj.create?.price || priceObj.product?.price || 0)
      const originalPrice = createPrice < 1 ? 1 : createPrice
      let price = Math.ceil(originalPrice * PERCENT_INCREASE_DOMAIN)
      price = Math.max(price, MIN_DOMAIN_PRICE)

      return { available: true, originalPrice, price, registrar: 'OpenProvider' }
    }

    return { available: false, message: 'Domain not available on OpenProvider' }
  } catch (err) {
    log('OP checkDomainAvailability error:', err.message)
    return { available: false, message: `OpenProvider error: ${err.message}` }
  }
}

// ─── Contact handle ─────────────────────────────────────

// TLD → required contact country suffix mapping
// Based on ACTUAL OpenProvider data analysis:
// .fr → VS062711-IT works (Italian company with VAT + verified email)
// .it → Must use Italian contacts with VAT
// .ca → Canadian contact preferred (BK921363-CA)
// .eu → Needs EU-based contact
// .sg → Needs Singapore contact with UEN
const TLD_CONTACT_COUNTRY = {
  fr: ['IT'],
  it: ['IT'],
  ca: ['CA'],
  eu: ['FR', 'IT', 'DE', 'NL'],
  sg: ['SG'],
  us: ['US'],  // .us requires US-based contact with extension_additional_data (nexus)
  // .au-family TLDs require an Australian local-presence contact with company_name set
  // (OP code 160 "Empty companyname field" otherwise).
  au:       ['AU'],
  'com.au': ['AU'],
  'net.au': ['AU'],
  'id.au':  ['AU'],
}

// Known working contact handles (verified in OpenProvider account)
// These are used as preferred handles before falling back to search/create
const PREFERRED_HANDLES = {
  IT: 'MR971932-IT',
  CA: 'BK921363-CA',
  US: 'JC961841-US',  // John CloakHost — has .us extension_additional_data (nexus_category: C21, applicant_purpose: P1)
  AU: 'AP1015591-AU', // APPLE PTY LTD — created 2026-02 for .au-family registrations (company_name + country=AU)
}

// Handles that must NEVER be used for domain registration
const EXCLUDED_HANDLES = new Set([
  'RA1083275-US',  // Richard Adebayo — do not use per owner request
])

// EU contact details for creating new handles when none exist
const EU_CONTACT_TEMPLATES = {
  FR: {
    name: { first_name: 'Paul', last_name: 'Gaulle' },
    phone: { country_code: '+33', area_code: '1', subscriber_number: '44556677' },
    address: { street: '15 Rue de la Paix', number: '15', zipcode: '75002', city: 'Paris', state: 'IDF', country: 'FR' },
  },
  DE: {
    name: { first_name: 'Paul', last_name: 'Gaulle' },
    phone: { country_code: '+49', area_code: '30', subscriber_number: '12345678' },
    address: { street: 'Friedrichstrasse 100', number: '100', zipcode: '10117', city: 'Berlin', state: 'BE', country: 'DE' },
  },
  NL: {
    name: { first_name: 'Carsten', last_name: 'van Noort' },
    phone: { country_code: '+31', area_code: '20', subscriber_number: '1234567' },
    address: { street: 'Keizersgracht 100', number: '100', zipcode: '1015 AA', city: 'Amsterdam', state: 'NH', country: 'NL' },
  },
  IT: {
    name: { first_name: 'Marco', last_name: 'Rossi' },
    phone: { country_code: '+39', area_code: '0522', subscriber_number: '274411' },
    address: { street: 'Via Giovanni Bovio', number: '2A', zipcode: '42124', city: 'Reggio nell Emilia', state: 'RE', country: 'IT' },
    organization: 'Nomadly Services SRL',
    vat: 'IT04081310965',
  },
  CA: {
    name: { first_name: 'Brian', last_name: 'Kaitn' },
    phone: { country_code: '+1', area_code: '416', subscriber_number: '5551234' },
    address: { street: '100 King Street West', number: '100', zipcode: 'M5X 1A9', city: 'Toronto', state: 'ON', country: 'CA' },
  },
  SG: {
    name: { first_name: 'Hostbay', last_name: 'PLC' },
    phone: { country_code: '+65', area_code: '', subscriber_number: '61234567' },
    address: {
      street: process.env.SINGAPORE_COMPANY_ADDRESS || '123 Orchard Road #05-123',
      number: '123',
      zipcode: process.env.SINGAPORE_COMPANY_POSTAL_CODE || '238823',
      city: 'Singapore', state: 'SG', country: 'SG',
    },
    organization: process.env.SINGAPORE_COMPANY_NAME || 'Hostbay PLC',
  },
  AU: {
    name: { first_name: 'Apple', last_name: 'Pty Ltd' },
    phone: { country_code: '+61', area_code: '1300', subscriber_number: '321456' },
    address: {
      street: '20 Martin Place', number: '20', zipcode: '2000',
      city: 'Sydney', state: 'NSW', country: 'AU',
    },
    organization: process.env.AU_REGISTRANT_NAME || 'APPLE PTY LTD',
  },
}

/**
 * Get or create a contact handle appropriate for a specific TLD.
 * Strategy (based on OpenProvider account analysis):
 * 1. Check PREFERRED_HANDLES for known working handles - verify they exist via direct API call
 * 2. Search all contacts by email to find matching country handles (avoids pagination issues)
 * 3. Create new handle from template as last resort
 */
const getContactHandleForTLD = async (tld) => {
  const requiredCountries = TLD_CONTACT_COUNTRY[tld]
  if (!requiredCountries) return getContactHandle()

  try {
    const headers = await authHeaders()

    // Strategy 1: Try preferred/known-working handles first via direct lookup
    for (const country of requiredCountries) {
      const preferredHandle = PREFERRED_HANDLES[country]
      if (preferredHandle) {
        try {
          const checkRes = await axios.get(`${OP_BASE_URL}/v1beta/customers/${preferredHandle}`, {
            headers, timeout: 10000,
          })
          if (checkRes.data?.code === 0 && !checkRes.data?.data?.is_deleted) {
            log(`Using preferred ${country} handle for .${tld}: ${preferredHandle}`)
            return preferredHandle
          }
        } catch (e) {
          log(`Preferred handle ${preferredHandle} not found or error: ${e.message}`)
        }
      }
    }

    // Strategy 2: Search contacts filtered by service email to reduce result set
    const res = await axios.get(`${OP_BASE_URL}/v1beta/customers`, {
      headers, params: { limit: 500, email_pattern: SERVICE_EMAIL }, timeout: 15000,
    })

    if (res.data?.code === 0) {
      const contacts = res.data?.data?.results || []

      for (const country of requiredCountries) {
        const suffix = `-${country}`
        const match = contacts.find(c => c.handle && c.handle.endsWith(suffix) && !EXCLUDED_HANDLES.has(c.handle))
        if (match) {
          log(`Found existing ${country} contact handle for .${tld}: ${match.handle}`)
          return match.handle
        }
      }
    }

    // Strategy 3: Broader search without email filter, with higher limit
    const res2 = await axios.get(`${OP_BASE_URL}/v1beta/customers`, {
      headers, params: { limit: 500 }, timeout: 15000,
    })

    if (res2.data?.code === 0) {
      const contacts = res2.data?.data?.results || []

      for (const country of requiredCountries) {
        const suffix = `-${country}`
        const match = contacts.find(c => c.handle && c.handle.endsWith(suffix) && !EXCLUDED_HANDLES.has(c.handle))
        if (match) {
          log(`Found ${country} contact handle via broad search for .${tld}: ${match.handle}`)
          return match.handle
        }
      }
    }

    // Strategy 4: Create new handle from template
    const targetCountry = requiredCountries[0]
    const template = EU_CONTACT_TEMPLATES[targetCountry]
    if (!template) {
      log(`No contact template for country ${targetCountry}, falling back to default`)
      return getContactHandle()
    }

    log(`Creating new ${targetCountry} contact handle for .${tld} TLD registration`)
    const contactData = {
      name: template.name,
      phone: template.phone,
      email: SERVICE_EMAIL,
      address: template.address,
    }
    if (template.organization) contactData.organization = template.organization
    if (template.vat) contactData.vat = template.vat
    if (template.social_security_number) contactData.social_security_number = template.social_security_number

    const createRes = await axios.post(`${OP_BASE_URL}/v1beta/customers`, contactData, {
      headers, timeout: 15000,
    })

    if (createRes.data?.code === 0) {
      const newHandle = createRes.data?.data?.handle
      log(`Created ${targetCountry} contact handle: ${newHandle}`)
      return newHandle
    }

    log(`Failed to create ${targetCountry} contact:`, createRes.data)
    return getContactHandle() // fallback
  } catch (err) {
    log(`getContactHandleForTLD error for .${tld}:`, err.message)
    return getContactHandle()
  }
}

const getContactHandle = async (attempt = 1) => {
  try {
    const headers = await authHeaders()

    const res = await axios.get(`${OP_BASE_URL}/v1beta/customers`, {
      headers, params: { limit: 50 }, timeout: 15000,
    })

    if (res.data?.code === 0) {
      const contacts = res.data?.data?.results || []
      // Prefer US-based contacts, skip excluded handles
      const usContacts = contacts.filter(c => c.handle && c.handle.endsWith('-US') && !EXCLUDED_HANDLES.has(c.handle))
      if (usContacts.length > 0) return usContacts[0].handle
      const validContacts = contacts.filter(c => c.handle && !EXCLUDED_HANDLES.has(c.handle))
      if (validContacts.length > 0) return validContacts[0].handle
    }

    const createRes = await axios.post(`${OP_BASE_URL}/v1beta/customers`, {
      name: { first_name: 'Hostbay', last_name: 'Support' },
      phone: { country_code: '+1', area_code: '555', subscriber_number: '1234567' },
      email: SERVICE_EMAIL,
      address: {
        street: '123 Business Ave', number: '1',
        zipcode: '10001', city: 'New York', state: 'NY', country: 'US',
      },
      organization: 'Hostbay Domain Services',
    }, { headers, timeout: 15000 })

    if (createRes.data?.code === 0) return createRes.data?.data?.handle
    log('Failed to create OP contact handle:', createRes.data)
    return null
  } catch (err) {
    log(`OP getContactHandle error (attempt ${attempt}): ${err.message}`)
    // Retry once with forced re-auth (handles expired/stale token)
    if (attempt < 2) {
      log('[OP] getContactHandle retrying with fresh auth in 2s...')
      cachedToken = null
      tokenExpiry = 0
      await new Promise(r => setTimeout(r, 2000))
      return getContactHandle(attempt + 1)
    }
    return null
  }
}

// ─── Domain registration ────────────────────────────────

const registerDomain = async (domainName, nameservers = []) => {
  try {
    const headers = await authHeaders()
    const { name, extension } = parseDomain(domainName)
    const tld = extension.toLowerCase()

    // Fail-fast for .au-family if registrant credentials are not configured.
    // (checkDomainAvailability already filters these out, but the bot's CR-fallback
    // path can still reach here; we must never POST a malformed registration.)
    if (AU_TLDS.has(tld) && !_buildAuAdditionalData(tld)) {
      log(`[OP] Refusing to register ${domainName} — AU_REGISTRANT_ABN / AU_REGISTRANT_ACN not set`)
      return { error: 'AU domain registration is not configured. Please contact support.' }
    }

    // Use TLD-specific contact handle (IT for .fr/.it, CA for .ca, EU for .eu, default US for others)
    let contactHandle = await getContactHandleForTLD(tld)
    if (!contactHandle) {
      // Retry once with forced re-auth (handles transient auth/network failures)
      log(`[OP] Contact handle lookup failed for .${tld} — retrying with fresh auth in 2s...`)
      cachedToken = null
      tokenExpiry = 0
      await new Promise(r => setTimeout(r, 2000))
      contactHandle = await getContactHandleForTLD(tld)
    }
    if (!contactHandle) return { error: 'Failed to prepare domain registration. Please try again or contact support.' }

    // Final safety: reject excluded handles before proceeding
    if (EXCLUDED_HANDLES.has(contactHandle)) {
      log(`[OP] BLOCKED: excluded handle ${contactHandle} was selected for ${domainName} — aborting`)
      return { error: 'Domain registration configuration error. Please contact support.' }
    }

    // Resolve effective nameservers:
    // 1. Use provided NS (cloudflare or custom) if available
    // 2. For NS-required TLDs without NS, fall back to Cloudflare defaults
    // 3. For all other cases with no NS, use OP built-in DNS hosting nameservers
    const NS_REQUIRED_TLDS = ['fr', 're', 'pm', 'tf', 'wf', 'yt']
    let effectiveNS = nameservers
    if (effectiveNS.length < 2 && NS_REQUIRED_TLDS.includes(tld)) {
      log(`[registerDomain] .${tld} requires 2+ nameservers, adding Cloudflare defaults`)
      effectiveNS = ['hank.ns.cloudflare.com', 'nova.ns.cloudflare.com']
    } else if (effectiveNS.length === 0) {
      log(`[registerDomain] No nameservers provided for ${domainName}, using OP built-in: ${OP_DEFAULT_NS.join(', ')}`)
      effectiveNS = OP_DEFAULT_NS
    }

    const nsPayload = effectiveNS.map((ns, i) => ({ name: ns, seq_nr: i + 1 }))

    const regData = {
      domain: { name, extension },
      period: 1,
      owner_handle: contactHandle,
      admin_handle: contactHandle,
      tech_handle: contactHandle,
      billing_handle: contactHandle,
      name_servers: nsPayload,
      autorenew: 'off',
    }

    // Country-specific TLD data
    const tldData = getCountryTLDData(tld)
    if (tldData && Object.keys(tldData).length > 0) {
      regData.additional_data = tldData
    }

    log(`[registerDomain] Registering ${domainName} | contact: ${contactHandle} | NS: ${effectiveNS.join(', ') || 'none'} | additional_data: ${JSON.stringify(tldData || {})}`)

    // For .us domains: ensure the customer handle has extension_additional_data with nexus fields
    // OpenProvider requires nexus_category and applicant_purpose on the CUSTOMER HANDLE, not domain additional_data
    if (tld === 'us') {
      try {
        const custRes = await axios.get(`${OP_BASE_URL}/v1beta/customers/${contactHandle}`, {
          headers, params: { with_additional_data: true }, timeout: 10000,
        })
        const extData = custRes.data?.data?.extension_additional_data || []
        const hasUsData = extData.some(e => e.name === 'us' && e.data?.nexus_category && e.data?.applicant_purpose)
        if (!hasUsData) {
          log(`[OP] .us handle ${contactHandle} missing extension_additional_data — adding nexus fields`)
          await axios.put(`${OP_BASE_URL}/v1beta/customers/${contactHandle}`, {
            extension_additional_data: [
              { name: 'us', data: { nexus_category: 'C21', applicant_purpose: 'P1' } }
            ]
          }, { headers, timeout: 10000 })
          log(`[OP] Updated ${contactHandle} with .us extension_additional_data`)
        } else {
          log(`[OP] .us handle ${contactHandle} already has extension_additional_data`)
        }
      } catch (extErr) {
        log(`[OP] Warning: failed to verify/set .us extension data on ${contactHandle}: ${extErr.message}`)
      }
    }

    const res = await axios.post(`${OP_BASE_URL}/v1beta/domains`, regData, {
      headers, timeout: 45000,
    })

    if (res.data?.code === 0) {
      const domainId = res.data?.data?.id
      log(`[OP] Domain registered: ${domainName}, ID: ${domainId}`)
      return { success: true, domainId, registrar: 'OpenProvider' }
    }

    // Non-zero code but not an HTTP error — check if domain was actually registered (false-negative)
    const errMsg = res.data?.desc || 'Unknown registration error'
    log(`[OP] registerDomain non-zero code (${res.data?.code}): ${errMsg}`)
    const verifyResult = await _verifyRegistration(domainName)
    if (verifyResult) {
      log(`[OP] FALSE NEGATIVE: ${domainName} actually registered despite error code ${res.data?.code}. ID: ${verifyResult.domainId}`)
      return { success: true, domainId: verifyResult.domainId, registrar: 'OpenProvider' }
    }
    return { error: `Registration failed: ${errMsg}` }
  } catch (err) {
    const opDesc = err?.response?.data?.desc || ''
    const opCode = err?.response?.data?.code || ''
    const statusCode = err?.response?.status || ''
    log(`[OP] registerDomain error: ${err.message} | HTTP ${statusCode} | OP code: ${opCode} | desc: ${opDesc}`)

    // For 5xx server errors OR timeouts, the registrar may have processed the request
    // despite the client-side error. Wait briefly and verify if the domain was actually
    // registered (false-negative protection).
    const isTimeout = !statusCode && (err.code === 'ECONNABORTED' || err.message?.includes('timeout'))
    if (statusCode >= 500 || isTimeout) {
      const reason = isTimeout ? `timeout (${err.message})` : `HTTP ${statusCode}`
      log(`[OP] ${reason} for ${domainName} — waiting 8s then verifying registration...`)
      await new Promise(r => setTimeout(r, 8000))
      const verifyResult = await _verifyRegistration(domainName)
      if (verifyResult) {
        log(`[OP] FALSE NEGATIVE CONFIRMED: ${domainName} registered despite ${reason}. ID: ${verifyResult.domainId}`)
        return { success: true, domainId: verifyResult.domainId, registrar: 'OpenProvider' }
      }
      log(`[OP] Verification negative — ${domainName} NOT registered after ${reason}`)
    }

    return { error: opDesc || 'Domain registration failed due to a server error. Please try again.' }
  }
}

/**
 * Verify if a domain was actually registered on OP (handles false-negative API errors).
 * Returns { domainId } if found, null otherwise.
 */
const _verifyRegistration = async (domainName) => {
  try {
    const headers = await authHeaders()
    const { name, extension } = parseDomain(domainName)
    const searchRes = await axios.get(`${OP_BASE_URL}/v1beta/domains`, {
      headers, params: { domain_name_pattern: name, extension, limit: 1 }, timeout: 15000,
    })
    if (searchRes.data?.code === 0 && searchRes.data?.data?.results?.length > 0) {
      const found = searchRes.data.data.results[0]
      if (found.status === 'ACT' || found.status === 'REQ') {
        return { domainId: found.id }
      }
    }
    return null
  } catch (verifyErr) {
    log(`[OP] _verifyRegistration error for ${domainName}: ${verifyErr.message}`)
    return null
  }
}

// ─── Domain info ────────────────────────────────────────

const getDomainInfo = async (domainName) => {
  try {
    const headers = await authHeaders()
    const { name, extension } = parseDomain(domainName)

    const searchRes = await axios.get(`${OP_BASE_URL}/v1beta/domains`, {
      headers, params: { domain_name_pattern: name, extension, limit: 1 }, timeout: 15000,
    })

    if (searchRes.data?.code !== 0 || !searchRes.data?.data?.results?.length) return null

    const domainId = searchRes.data.data.results[0].id
    const res = await axios.get(`${OP_BASE_URL}/v1beta/domains/${domainId}`, {
      headers, timeout: 15000,
    })

    if (res.data?.code === 0) {
      const data = res.data.data
      const nameservers = (data.name_servers || []).map(ns => ns.name).filter(Boolean)
      return { domainId, nameservers, status: data.status, expiresAt: data.renewal_date, domainData: data }
    }
    return null
  } catch (err) {
    log('OP getDomainInfo error:', err.message)
    return null
  }
}

// ─── DNSSEC management ──────────────────────────────────

/**
 * Disable DNSSEC for a domain at OpenProvider.
 * Required before changing nameservers on DNSSEC-strict TLDs (.de, .nl, .se, etc.)
 * where the registry validates DNSKEY records at the new nameservers.
 */
const disableDnssec = async (domainName) => {
  try {
    const info = await getDomainInfo(domainName)
    if (!info || !info.domainId) return { error: 'Domain not found at registrar' }

    // Check if DNSSEC is actually enabled via domainData
    const isDnssecEnabled = info.domainData?.is_dnssec_enabled
    const hasDnssecKeys = (info.domainData?.dnssec_keys || []).length > 0
    if (!isDnssecEnabled && !hasDnssecKeys) {
      log(`[DNSSEC] ${domainName}: DNSSEC already disabled (is_dnssec_enabled=${isDnssecEnabled}, keys=${hasDnssecKeys ? 'yes' : 'none'})`)
      return { success: true, alreadyDisabled: true }
    }

    log(`[DNSSEC] Disabling DNSSEC for ${domainName} (is_dnssec_enabled=${isDnssecEnabled}, keys=${hasDnssecKeys ? 'yes' : 'none'})`)
    const headers = await authHeaders()
    const res = await axios.put(`${OP_BASE_URL}/v1beta/domains/${info.domainId}`, {
      is_dnssec_enabled: false,
      dnssec_keys: [],
    }, { headers, timeout: 30000 })

    if (res.data?.code === 0) {
      log(`[DNSSEC] ✅ DNSSEC disabled for ${domainName}`)
      return { success: true }
    }
    log(`[DNSSEC] ⚠️ Unexpected response disabling DNSSEC for ${domainName}:`, res.data?.desc || res.data)
    return { error: res.data?.desc || 'Failed to disable DNSSEC' }
  } catch (err) {
    const opDesc = err.response?.data?.desc || ''
    log(`[DNSSEC] ❌ Error disabling DNSSEC for ${domainName}:`, err.message, opDesc ? `| ${opDesc}` : '')
    return { error: opDesc || err.message }
  }
}

// ─── Nameserver management ──────────────────────────────

/**
 * Internal helper: send NS update to OpenProvider API.
 * Handles timeout + retry logic, including transient 5xx errors.
 *
 * ── ns_group: '' (registry chprov force) ──
 * For TLDs where OP holds a separate "nameserver group" (notably .de via DENIC),
 * sending only `name_servers` updates OP's internal state but DOES NOT always
 * trigger a registry re-publication. The domain can stay stuck on the old
 * delegation (e.g. an Nsentry A-record for .de) even though OP shows the new
 * NS. Sending `ns_group: ''` alongside `name_servers` resets the group binding
 * and forces OP to push a fresh `domain:update` to the registry.
 *
 * Real prod incident: @HHR2009 / rsvpeviteopen.de — OP showed CF nameservers
 * for hours, but DENIC kept `Nsentry: rsvpeviteopen.de IN A 93.180.69.101`
 * until we sent `ns_group: ''` in the PUT payload. After the chprov push,
 * DENIC immediately switched to `Nserver: anderson.ns.cloudflare.com /
 * leanna.ns.cloudflare.com` and the CF zone activated.
 */
const _sendNsUpdate = async (domainId, domainName, nsPayload, headers) => {
  let res
  const _put = (timeoutMs) => axios.put(`${OP_BASE_URL}/v1beta/domains/${domainId}`, {
    name_servers: nsPayload,
    ns_group: '',
  }, { headers, timeout: timeoutMs })

  try {
    res = await _put(30000)
  } catch (firstErr) {
    const isTimeout = firstErr.code === 'ECONNABORTED' || firstErr.message?.includes('timeout') || firstErr.code === 'ETIMEDOUT'
    const status = firstErr.response?.status
    const is5xx = status >= 500 && status <= 599

    if (isTimeout) {
      log(`OP updateNameservers timeout for ${domainName}, retrying with 45s…`)
      res = await _put(45000)
    } else if (is5xx) {
      // ── 5xx transient — back off and retry up to 2 more times (exponential) ──
      // Real-prod Railway log: itsonlytravel.com got 500 once; retrying would
      // have succeeded. We now retry with 1.5s then 4s backoff.
      let lastErr = firstErr
      for (const backoff of [1500, 4000]) {
        log(`OP updateNameservers ${status} for ${domainName}, retrying in ${backoff}ms…`)
        await new Promise(r => setTimeout(r, backoff))
        try {
          res = await _put(30000)
          lastErr = null
          break
        } catch (retryErr) {
          lastErr = retryErr
          const retryStatus = retryErr.response?.status
          if (!(retryStatus >= 500 && retryStatus <= 599)) break // non-5xx — stop retrying
        }
      }
      if (lastErr) throw lastErr
    } else {
      throw firstErr
    }
  }
  return res
}

/**
 * Probe Cloudflare's DoH resolver to verify the registry has published the
 * given nameservers for `domainName`. Polls up to `maxWaitMs` with linear
 * backoff. Returns { verified, matched, lastNs, attempts, elapsedMs, reason }.
 *
 * Verified = at least 2 of the target nameservers appear in the public NS
 *            RRset (matches the same "≥2 NS" threshold the DnsHealer uses).
 *
 * Note: this queries a recursive resolver, not the authoritative TLD NS
 * directly, so a small fraction of "not verified" results are simply the
 * resolver still serving its cached parent-zone NS hint. The 30 s budget is
 * chosen to balance catching genuine silent rejections fast vs. avoiding
 * false alarms from resolver caching — anything that doesn't propagate in
 * 30 s is either a silent registry rejection or a TLD with a strict pre-
 * delegation policy, both of which the DnsHealer should pick up next.
 */
const _verifyRegistryPropagation = async (domainName, expectedNs, maxWaitMs = 30000) => {
  const dnsChecker = require('./dns-checker')
  const wantSet = new Set(expectedNs.map(n => String(n).toLowerCase().replace(/\.$/, '')))
  const start = Date.now()
  // Linear-ish schedule: 3s, 6s, 9s, 12s → 30s total
  const sleepSchedule = [3000, 6000, 9000, 12000]
  let lastNs = []
  let attempts = 0

  for (const sleepMs of sleepSchedule) {
    if (Date.now() - start > maxWaitMs) break
    await new Promise(r => setTimeout(r, sleepMs))
    attempts++
    try {
      const r = await dnsChecker.resolve(domainName, 'NS')
      lastNs = (r.answers || []).map(a => String(a.data || '').toLowerCase().replace(/\.$/, ''))
      const matched = lastNs.filter(n => wantSet.has(n)).length
      if (matched >= 2) {
        return { verified: true, matched, lastNs, attempts, elapsedMs: Date.now() - start, reason: 'ok' }
      }
    } catch (e) {
      // swallow; next loop iteration retries
    }
  }
  const matched = lastNs.filter(n => wantSet.has(n)).length
  let reason = 'timeout'
  if (lastNs.length === 0) reason = 'no NS in public DNS yet'
  else if (matched === 0) reason = `registry still serving stale NS: ${lastNs.join(', ')}`
  else reason = `only ${matched}/${expectedNs.length} target NS visible (need ≥2): ${lastNs.join(', ')}`
  return { verified: false, matched, lastNs, attempts, elapsedMs: Date.now() - start, reason }
}

const updateNameservers = async (domainName, nameservers, _dnssecRetried = false) => {
  try {
    const info = await getDomainInfo(domainName)
    if (!info || !info.domainId) return { error: 'Domain not found at registrar' }

    const headers = await authHeaders()
    const nsPayload = nameservers.map((ns, i) => ({ name: ns, seq_nr: i + 1 }))

    const res = await _sendNsUpdate(info.domainId, domainName, nsPayload, headers)

    if (res.data?.code === 0) {
      // ── Post-success DNSSEC cleanup ──
      // OP enables DNSSEC ("signedDelegation") on some new registrations by default.
      // When the user moves NS off OP (e.g. to Cloudflare) the OP-published DS at the
      // TLD becomes stale → public resolvers return SERVFAIL because the new NS
      // doesn't sign with the old key. OP does NOT auto-clear DNSSEC on NS change,
      // so we must do it ourselves whenever the new NS are not OP nameservers.
      try {
        const isOpNs = nameservers.some(ns => /\.openprovider\.(nl|be|eu)$/i.test(ns || ''))
        const dnssecOn = info.domainData?.is_dnssec_enabled || (info.domainData?.dnssec_keys || []).length > 0
        if (!isOpNs && dnssecOn) {
          log(`[DNSSEC-PostNS] ${domainName}: NS moved off OP — clearing stale DNSSEC delegation`)
          const r = await disableDnssec(domainName)
          if (!r.success) {
            log(`[DNSSEC-PostNS] ${domainName}: failed to disable DNSSEC: ${r.error}`)
          }
        }
      } catch (dsErr) {
        // Best-effort — never break NS-update success because of DNSSEC cleanup
        log(`[DNSSEC-PostNS] ${domainName}: cleanup error (non-fatal): ${dsErr.message}`)
      }

      // ── Post-write registry-propagation probe (≤30 s) ──────────────────────
      // OP returning code:0 means OP **accepted** the NS update, NOT that the
      // registry has published it. Historically there have been silent
      // registry-side rejections / queue drops where OP's DB shows the new NS
      // but the registry keeps the old delegation — only surfaced 24 h+ later
      // when a customer noticed their domain showing "red" (see 2026-06-17
      // HHR2009 / strivepartypaperless.com incident).
      //
      // The probe queries Cloudflare's DoH for the domain's NS RRset and
      // confirms ≥2 of the submitted nameservers appear. Polls 4 times over
      // ~30 s with linear backoff (3 s, 6 s, 9 s, 12 s).
      //
      // Important nuance: a `verified: false` result is reliable for FRESH
      // registrations (no cached parent-zone NS hint) but can be a false
      // positive when re-pushing on an *existing* domain, because recursive
      // resolvers cache the parent NS RRset for the TLD's NS TTL
      // (typically 24-48 h for .com / .de). Either way the right reaction is
      // the same: hand off to DnsHealer, which has the patience to wait out
      // legitimate propagation and only escalates on persistent failures.
      //
      // Returns informational fields on `propagation`; never breaks success.
      const propagation = await _verifyRegistryPropagation(domainName, nameservers, 30000)
      if (!propagation.verified) {
        log(`[NS-Verify] ${domainName}: not yet confirmed at recursive resolver after ${propagation.elapsedMs}ms (${propagation.reason}). Could be registry-side silent failure OR normal parent-zone cache — DnsHealer will resolve.`)
      } else {
        log(`[NS-Verify] ${domainName}: registry confirmed ${propagation.matched} of ${nameservers.length} target NS in ${propagation.elapsedMs}ms (attempt ${propagation.attempts}).`)
      }
      return { success: true, propagation }
    }
    return { error: res.data?.desc || 'Failed to update nameservers' }
  } catch (err) {
    // Extract the actual error from OP API response (e.g. DENIC rejection for .de domains)
    const opData = err.response?.data
    const opDesc = opData?.desc || opData?.data?.desc || ''
    const opWarnings = opData?.warnings || opData?.data?.warnings || []
    const opCode = opData?.code ?? err.response?.status ?? ''
    const opFullData = opData?.data || ''

    // Build detailed log for debugging — keep full payload (no 500-char clamp) so
    // the actual registry message is visible for post-mortem (real prod hit:
    // @Mrdoitright53 / itsonlytravel.com — the underlying registry rejection
    // was truncated out of the 500-char window and we lost the root cause).
    log(`OP updateNameservers error for ${domainName}:`, err.message,
      opDesc ? `| desc: ${opDesc}` : '',
      opWarnings.length ? `| warnings: ${JSON.stringify(opWarnings)}` : '',
      opData ? `| full: ${JSON.stringify(opData).substring(0, 2000)}` : '')

    // ── DNSSEC auto-fix: detect DNSKEY / DNSSEC errors and retry after disabling ──
    // Common patterns:
    //   code 524 + "DNSKEY" in data (DENIC .de)
    //   code 524 + "DNSSEC" in data
    //   "Unable to retrieve DNSKEY RR" (ERROR 219)
    const fullStr = JSON.stringify(opData || '').toLowerCase()
    const isDnssecError = !_dnssecRetried && (
      (opCode === 524 && (fullStr.includes('dnskey') || fullStr.includes('dnssec'))) ||
      fullStr.includes('unable to retrieve dnskey') ||
      fullStr.includes('dnssec validation') ||
      fullStr.includes('dnskey rr')
    )

    if (isDnssecError) {
      log(`[DNSSEC-AutoFix] Detected DNSSEC/DNSKEY error for ${domainName} — disabling DNSSEC and retrying NS update…`)
      const dnssecResult = await disableDnssec(domainName)
      if (dnssecResult.success) {
        // Brief pause to let registry process the DNSSEC disable
        await new Promise(r => setTimeout(r, 3000))
        log(`[DNSSEC-AutoFix] Retrying NS update for ${domainName} after DNSSEC disable…`)
        return updateNameservers(domainName, nameservers, true) // recursive call with retry flag
      } else {
        log(`[DNSSEC-AutoFix] Failed to disable DNSSEC for ${domainName}: ${dnssecResult.error}`)
        // Fall through to normal error handling
      }
    }

    // Build user-friendly error
    let userMsg = ''
    // ── Detect OP's generic "An error has occurred / registry message below" pattern ──
    // Real prod incident (@Mrdoitright53 / itsonlytravel.com): the URL inside this desc
    // gets scrubbed by the provider-URL sanitizer, leaving a useless "For more information please "
    // dangling at the end. When we see this template, replace it with an actionable message.
    const isRegistryGenericReject = opDesc && /An\s+error\s+has\s+occurred[\s\S]*registry\s+message/i.test(opDesc)
    if (isRegistryGenericReject) {
      userMsg = 'The registry rejected these nameservers. Common causes: the hostnames are misspelled, not yet registered, or do not resolve to an IP address. Please double-check each nameserver against your DNS provider\'s control panel and try again.'
    } else if (opDesc) {
      userMsg = opDesc
    } else if (opWarnings.length) {
      userMsg = opWarnings.map(w => w.message || w).join('; ')
    } else if (err.response?.status === 500) {
      // OP 500 on .de domains usually means DENIC rejected the NS (unresolvable or invalid)
      const isDe = domainName.endsWith('.de')
      userMsg = isDe
        ? 'Registry rejected the nameservers — .de domains require nameservers that are resolvable. Please verify the nameservers are correct and active.'
        : 'Registrar rejected the request (500). Please verify the nameservers are valid and resolvable.'
    } else {
      userMsg = err.message
    }

    return { error: userMsg }
  }
}

// ─── DNS zone management ────────────────────────────────

/**
 * Ensure DNS zone exists at OpenProvider. Creates it via POST if missing.
 * Returns { exists: true } or { created: true } or { error }
 */
const ensureDnsZone = async (domainName) => {
  try {
    const headers = await authHeaders()

    // Check if zone exists
    try {
      const zoneRes = await axios.get(`${OP_BASE_URL}/v1beta/dns/zones/${domainName}`, {
        headers, timeout: 15000,
      })
      if (zoneRes.data?.code === 0) return { exists: true }
    } catch (e) {
      if (e.response?.status !== 404 && e.response?.status !== 500) {
        log(`[OP] ensureDnsZone GET error for ${domainName}: ${e.message}`)
      }
    }

    // Zone doesn't exist — create via POST
    log(`[OP] DNS zone not found for ${domainName}, creating...`)
    const { name, extension } = parseDomain(domainName)
    const createRes = await axios.post(`${OP_BASE_URL}/v1beta/dns/zones`, {
      domain: { name, extension },
      type: 'master',
      active: true,
    }, { headers, timeout: 15000 })

    if (createRes.data?.code === 0) {
      log(`[OP] DNS zone created for ${domainName}`)
      return { created: true }
    }
    // Zone may already exist (race condition or error desc says so)
    const desc = createRes.data?.desc || ''
    if (desc.toLowerCase().includes('already exists') || desc.toLowerCase().includes('zone for domain')) {
      log(`[OP] DNS zone already exists for ${domainName} (create returned: ${desc})`)
      return { exists: true }
    }
    return { error: desc || 'Failed to create DNS zone' }
  } catch (err) {
    // OP sometimes returns 500 with "Zone for domain already exists" — treat as exists
    const errMsg = err.response?.data?.desc || err.message || ''
    if (errMsg.toLowerCase().includes('already exists') || errMsg.toLowerCase().includes('zone for domain')) {
      log(`[OP] DNS zone already exists for ${domainName} (from error: ${errMsg})`)
      return { exists: true }
    }
    log(`[OP] ensureDnsZone error for ${domainName}: ${errMsg}`)
    return { error: errMsg }
  }
}

/**
 * Get DNS zone records for a domain from OpenProvider's DNS zone API
 * IMPORTANT: Must pass with_records=true param, otherwise OP returns no records
 */
const listDNSRecords = async (domainName) => {
  try {
    const headers = await authHeaders()

    const res = await axios.get(`${OP_BASE_URL}/v1beta/dns/zones/${domainName}`, {
      headers, timeout: 15000,
      params: { with_records: true },
    })

    if (res.data?.code === 0 && res.data?.data?.records) {
      // Filter out SOA/NS records (infrastructure records managed by OP) for cleaner display
      const userRecords = (res.data.data.records || []).filter(r =>
        !['SOA'].includes(r.type)
      )
      return {
        records: userRecords.map(r => ({
          recordType: r.type,
          recordContent: r.value,
          // OP returns full FQDN in name — normalize: strip trailing zone name for display
          recordName: r.name || domainName,
          ttl: r.ttl,
          priority: r.prio,
        })),
      }
    }
    return { records: [] }
  } catch (err) {
    // Zone may not exist yet (404) or domain has custom NS so no zone on OP (500) — that's OK
    if (err.response?.status === 404 || err.response?.status === 500) return { records: [] }
    log('OP listDNSRecords error:', err.message)
    return { records: [] }
  }
}

/**
 * Add a DNS record to OpenProvider zone.
 * Uses records.add (not records.update) for NEW records.
 * Auto-creates DNS zone via POST if it doesn't exist.
 */
const addDNSRecord = async (domainName, recordType, recordValue, hostName, priority, extraData) => {
  try {
    const headers = await authHeaders()

    // ── 1. Ensure DNS zone exists (create if needed) ──
    const zoneCheck = await ensureDnsZone(domainName)
    if (zoneCheck.error) {
      log(`[OP] addDNSRecord: zone ensure failed for ${domainName}: ${zoneCheck.error}`)
      // Still try to add — PUT may create zone implicitly in some OP versions
    }

    const type = recordType.toUpperCase()
    // OP auto-appends zone name to record name.
    // Root records: name must be '' (empty), NOT the domain name.
    // Subdomains: name should be just the subdomain part (e.g. 'www', 'api').
    let opName = hostName || ''
    // If caller passed the full domain as hostname, treat as root → empty
    if (opName === domainName) opName = ''
    // Strip the zone suffix if present (e.g. 'www.example.com' → 'www')
    if (opName.endsWith('.' + domainName)) opName = opName.slice(0, -(domainName.length + 1))

    const newRecord = {
      type,
      name: opName,
      value: recordValue,
      ttl: 600,
    }
    if (type === 'MX' && priority !== undefined) newRecord.prio = Number(priority)
    // SRV record fields for OpenProvider
    if (type === 'SRV' && extraData) {
      newRecord.name = `${extraData.service}.${extraData.proto}.${opName}`
      newRecord.value = recordValue
      newRecord.prio = Number(extraData.priority || 10)
      // OP uses weight and port embedded in the value or as separate fields
      // Format: "weight port target" for standard SRV
      newRecord.value = `${extraData.weight || 100} ${extraData.port || 0} ${recordValue}`
    }
    // CAA record fields for OpenProvider
    if (type === 'CAA' && extraData) {
      // OP CAA value format: "flags tag value"
      newRecord.value = `${extraData.flags || 0} ${extraData.tag || 'issue'} "${recordValue}"`
    }

    // ── 2. Add record using records.add (NOT records.update) ──
    log(`[OP] Adding ${type} record to ${domainName}: ${newRecord.name} → ${newRecord.value}`)
    const res = await axios.put(`${OP_BASE_URL}/v1beta/dns/zones/${domainName}`, {
      records: { add: [newRecord] },
    }, { headers, timeout: 15000 })

    if (res.data?.code === 0) {
      log(`[OP] ✅ ${type} record added to ${domainName}: ${newRecord.name} → ${newRecord.value}`)
      return { success: true }
    }
    log(`[OP] addDNSRecord API returned code ${res.data?.code}: ${res.data?.desc}`)
    return { error: res.data?.desc || 'Failed to add DNS record' }
  } catch (err) {
    log(`[OP] addDNSRecord error for ${domainName}: ${err.response?.data?.desc || err.message}`)
    return { error: err.response?.data?.desc || err.message }
  }
}

/**
 * Update a DNS record in OpenProvider zone.
 * Uses the record's name as-is from listDNSRecords (already in OP format).
 */
const updateDNSRecord = async (domainName, originalRecord, newValue, newType) => {
  try {
    const headers = await authHeaders()

    // The recordName from listDNSRecords is already in OP's FQDN format
    // For the update/remove, pass the name as OP returned it
    const origName = originalRecord.recordName || domainName
    // Normalize: if name equals the full domain, OP may expect empty for root
    const opOrigName = origName === domainName ? '' : (origName.endsWith('.' + domainName) ? origName.slice(0, -(domainName.length + 1)) : origName)

    const newType_ = (newType || originalRecord.recordType).toUpperCase()
    const origType_ = originalRecord.recordType.toUpperCase()

    const updateEntry = {
      type: newType_,
      name: opOrigName,
      value: newValue,
      ttl: originalRecord.ttl || 600,
    }
    const removeEntry = {
      type: origType_,
      name: opOrigName,
      value: originalRecord.recordContent,
    }
    // MX and SRV records require prio for OP to match the record correctly
    if (originalRecord.priority !== undefined && originalRecord.priority !== null) {
      removeEntry.prio = Number(originalRecord.priority)
      // Preserve priority for the updated record if type stays MX/SRV
      if (['MX', 'SRV'].includes(newType_)) {
        updateEntry.prio = Number(originalRecord.priority)
      }
    }

    const res = await axios.put(`${OP_BASE_URL}/v1beta/dns/zones/${domainName}`, {
      records: {
        update: [updateEntry],
        remove: [removeEntry],
      },
    }, { headers, timeout: 15000 })

    if (res.data?.code === 0) return { success: true }
    return { error: res.data?.desc || 'Failed to update DNS record' }
  } catch (err) {
    log('OP updateDNSRecord error:', err.message)
    return { error: err.message }
  }
}

/**
 * Delete a DNS record from OpenProvider zone.
 * recordName comes from listDNSRecords — pass as-is in OP FQDN format.
 */
const deleteDNSRecord = async (domainName, record) => {
  try {
    const headers = await authHeaders()

    // Normalize name for OP: strip domain suffix, root = ''
    const origName = record.recordName || domainName
    const opName = origName === domainName ? '' : (origName.endsWith('.' + domainName) ? origName.slice(0, -(domainName.length + 1)) : origName)

    const removeEntry = {
      type: record.recordType.toUpperCase(),
      name: opName,
      value: record.recordContent,
    }
    // MX and SRV records require prio for OP to match the record correctly
    if (record.priority !== undefined && record.priority !== null) {
      removeEntry.prio = Number(record.priority)
    }

    log(`[OP] deleteDNSRecord: domain=${domainName}, remove=`, JSON.stringify(removeEntry))

    const res = await axios.put(`${OP_BASE_URL}/v1beta/dns/zones/${domainName}`, {
      records: {
        remove: [removeEntry],
      },
    }, { headers, timeout: 15000 })

    log(`[OP] deleteDNSRecord response: code=${res.data?.code}, desc=${res.data?.desc || ''}`)

    if (res.data?.code === 0) return { success: true }
    return { error: res.data?.desc || 'Failed to delete DNS record' }
  } catch (err) {
    log('OP deleteDNSRecord error:', err.message)
    return { error: err.message }
  }
}

// ─── Registry-sync helper (no-op PUT to force re-push) ─────────────────
//
// Why this exists: OP's RCP "Synchronize" button is internally just a PUT to
// /v1beta/domains/{id} that re-pushes the current ns_group + name_servers to
// the registry. There's no dedicated REST sync endpoint. This helper makes
// that same call programmatically so the bot can rescue stuck domains where
// OP's API code:0 NS-update accepted the change but the registry never
// republished (real prod case: rsvpcrumelbell.de, rsvpeviteguestview.de,
// inviowelcoparty.de — DENIC kept serving ina*.registrar.eu while OP showed
// Cloudflare NS on the domain record).
//
// Returns { success: true } | { error }. Best-effort: does NOT verify
// registry propagation here — the caller (rescue script / DnsHealer) probes
// public DNS afterwards.
const syncDomain = async (domainName) => {
  try {
    const info = await getDomainInfo(domainName)
    if (!info || !info.domainId) return { error: 'Domain not found at registrar' }

    const headers = await authHeaders()
    // Re-send the CURRENT NS list with ns_group:'' to force OP→registry chprov.
    // Without ns_group:'' the registry binding can stay stuck on whatever the
    // domain was last registered with (commonly the OP parking ns_group for
    // pre-delegation TLDs whose NAST check failed at registration time).
    const nsPayload = (info.nameservers || []).map((n, i) => ({ name: n, seq_nr: i + 1 }))
    const body = { ns_group: '' }
    if (nsPayload.length >= 2) body.name_servers = nsPayload

    log(`[OP-Sync] ${domainName} (id=${info.domainId}, status=${info.domainData?.status}): PUT with current NS=[${(info.nameservers || []).join(', ')}] + ns_group:''`)
    const res = await axios.put(`${OP_BASE_URL}/v1beta/domains/${info.domainId}`, body, {
      headers, timeout: 45000,
    })

    if (res.data?.code === 0) {
      log(`[OP-Sync] ${domainName}: OP accepted (code:0). Registry chprov queued.`)
      return { success: true, domainId: info.domainId, opStatus: info.domainData?.status }
    }
    return { error: res.data?.desc || `OP sync returned code ${res.data?.code}` }
  } catch (err) {
    const opData = err.response?.data
    const opDesc = opData?.desc || opData?.data?.desc || ''
    const status = err.response?.status
    log(`[OP-Sync] ${domainName} error: HTTP ${status} | ${err.message} | desc: ${opDesc}`)
    return { error: opDesc || err.message || `HTTP ${status}` }
  }
}

/**
 * NAST-style pre-flight check — verifies the given nameservers actually serve
 * an authoritative response for `domainName` BEFORE we send it to OP for
 * registration / NS-update on a pre-delegation TLD (.de, .nl, .se, .fi, .be,
 * .ch, .ie, .it, .eu, .at, .li, .dk, .cz, .no). DENIC's NAST and equivalent
 * registries reject delegations whose NS don't return AA=1 with answers.
 *
 * Polls direct UDP/53 SOA queries against each NS (resolved by getaddrinfo).
 * Returns { ready, perNs:[{ns, ip, aa, ancount, error}], reason, elapsedMs }.
 *
 * ready = true iff ≥2 distinct NS each return Authoritative=1 with ≥1 answer.
 *
 * Defensive: catches all errors so this is safe to call in the registration
 * hot path. timeoutMs is the total wall-clock budget (not per-NS).
 */
const checkNsAuthoritative = async (domainName, nsList, timeoutMs = 60000) => {
  const dns = require('dns').promises
  const dgram = require('dgram')

  const start = Date.now()

  // Build a DNS SOA query packet for the domain (type=6)
  const buildSoaQuery = (qname) => {
    const tid = Math.floor(Math.random() * 0xffff)
    const flags = 0x0000 // standard query, recursion DESIRED off
    const head = Buffer.alloc(12)
    head.writeUInt16BE(tid, 0); head.writeUInt16BE(flags, 2)
    head.writeUInt16BE(1, 4); head.writeUInt16BE(0, 6)
    head.writeUInt16BE(0, 8); head.writeUInt16BE(0, 10)
    const labels = qname.split('.').filter(Boolean)
    let q = Buffer.alloc(0)
    for (const lab of labels) {
      const b = Buffer.from(lab, 'ascii')
      q = Buffer.concat([q, Buffer.from([b.length]), b])
    }
    q = Buffer.concat([q, Buffer.from([0]), Buffer.from([0, 6, 0, 1])])
    return Buffer.concat([head, q])
  }

  const queryUdp = (ip, qname, perNsTimeoutMs = 5000) => new Promise((resolve) => {
    const sock = dgram.createSocket('udp4')
    const pkt = buildSoaQuery(qname)
    const timer = setTimeout(() => {
      try { sock.close() } catch (_) { /* ignore */ }
      resolve({ aa: false, ancount: 0, error: 'timeout' })
    }, perNsTimeoutMs)
    sock.on('message', (msg) => {
      clearTimeout(timer)
      try { sock.close() } catch (_) { /* ignore */ }
      try {
        const flags = msg.readUInt16BE(2)
        const aa = (flags >> 10) & 1
        const rcode = flags & 0xf
        const ancount = msg.readUInt16BE(6)
        resolve({ aa: !!aa, ancount, rcode, error: rcode === 0 ? null : `rcode=${rcode}` })
      } catch (e) {
        resolve({ aa: false, ancount: 0, error: `parse: ${e.message}` })
      }
    })
    sock.on('error', (e) => {
      clearTimeout(timer)
      try { sock.close() } catch (_) { /* ignore */ }
      resolve({ aa: false, ancount: 0, error: e.message })
    })
    try { sock.send(pkt, 53, ip) } catch (e) {
      clearTimeout(timer); try { sock.close() } catch (_) {}
      resolve({ aa: false, ancount: 0, error: e.message })
    }
  })

  const checkOnce = async () => {
    const perNs = []
    for (const ns of nsList) {
      const nsClean = String(ns || '').replace(/\.$/, '').toLowerCase()
      let ip = null
      try {
        const rec = await dns.lookup(nsClean, { family: 4 })
        ip = rec.address
      } catch (e) {
        perNs.push({ ns: nsClean, ip: null, aa: false, ancount: 0, error: `resolve: ${e.message}` })
        continue
      }
      const r = await queryUdp(ip, domainName)
      perNs.push({ ns: nsClean, ip, aa: r.aa, ancount: r.ancount, error: r.error || null })
    }
    const authoritative = perNs.filter((x) => x.aa && x.ancount > 0)
    return { perNs, authoritativeCount: authoritative.length }
  }

  let last = { perNs: [], authoritativeCount: 0 }
  while (Date.now() - start < timeoutMs) {
    try {
      last = await checkOnce()
    } catch (e) {
      log(`[NAST] ${domainName}: probe error (non-fatal): ${e.message}`)
    }
    if (last.authoritativeCount >= 2) {
      return {
        ready: true,
        perNs: last.perNs,
        authoritativeCount: last.authoritativeCount,
        reason: 'ok',
        elapsedMs: Date.now() - start,
      }
    }
    // Polling backoff: 4s
    await new Promise((r) => setTimeout(r, 4000))
  }
  return {
    ready: false,
    perNs: last.perNs,
    authoritativeCount: last.authoritativeCount,
    reason: `only ${last.authoritativeCount}/${nsList.length} NS returned AA=1 with answers within ${timeoutMs}ms`,
    elapsedMs: Date.now() - start,
  }
}

// ─── Activation-state helper (Domain Status Check feature) ───────────────────
// Map a raw OpenProvider domain status into a normalized activation state so the
// bot can surface "activating / stuck" nudges. OP statuses: ACT=active,
// REQ=requested, SCH=scheduled, PEN=pending, FAI=failed, DEL=deleted.
const mapOpStatusToState = (status, ageHours = 0) => {
  const s = String(status || '').toUpperCase()
  if (s === 'ACT' || s === 'ACTIVE') return 'active'
  if (['FAI', 'DEL', 'FAILED', 'DELETED'].includes(s)) return 'failed'
  if (['REQ', 'SCH', 'PEN', 'PENDING', 'REQUESTED', 'SCHEDULED'].includes(s) || !s) {
    // Pending is normal for a short window after purchase; flag as "stuck" once
    // it's dragged on unusually long so support/nudge can act.
    return ageHours >= 24 ? 'stuck' : 'activating'
  }
  return 'unknown'
}

// Live activation state for a domain (best-effort; never throws).
const getActivationState = async (domainName, ageHours = 0) => {
  try {
    const info = await getDomainInfo(domainName)
    if (!info) return { state: 'unknown', opStatus: null }
    const opStatus = info.status || info.domainData?.status || null
    return { state: mapOpStatusToState(opStatus, ageHours), opStatus, domainId: info.domainId || null }
  } catch (e) {
    return { state: 'unknown', opStatus: null, error: e.message }
  }
}

module.exports = {
  SERVICE_EMAIL,
  authenticate,
  checkDomainAvailability,
  registerDomain,
  getDomainInfo,
  updateNameservers,
  disableDnssec,
  syncDomain,
  checkNsAuthoritative,
  getContactHandle,
  getContactHandleForTLD,
  parseDomain,
  getCountryTLDData,
  AU_TLDS,
  ensureDnsZone,
  listDNSRecords,
  addDNSRecord,
  updateDNSRecord,
  deleteDNSRecord,
  mapOpStatusToState,
  getActivationState,
}
