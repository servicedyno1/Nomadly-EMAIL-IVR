'use strict'
// Customer legal profile (individual or business + address): required before buying a number. Its details go to the
// number provider as the end user (Infobip: companyName / companyAddress + resale note) and are kept per number.
const axios = require('axios')
const crypto = require('crypto')

const PLACES = 'https://places.googleapis.com/v1'
const key = () => process.env.GOOGLE_MAPS_API_KEY
const ISO2 = /^[A-Z]{2}$/
// Places without postal codes (postcode optional there).
const NO_POSTCODE = new Set(['AE', 'AG', 'AO', 'AW', 'BF', 'BI', 'BJ', 'BO', 'BS', 'BW', 'BZ', 'CD', 'CF', 'CG', 'CI', 'CK', 'CM', 'DJ', 'DM', 'ER', 'FJ', 'GA', 'GD', 'GH', 'GM', 'GQ', 'GY', 'HK', 'IE', 'JM', 'KI', 'KM', 'KN', 'KP', 'LC', 'ML', 'MO', 'MR', 'MW', 'NR', 'NU', 'PA', 'QA', 'RW', 'SB', 'SC', 'SL', 'SO', 'SR', 'ST', 'SY', 'TD', 'TF', 'TG', 'TK', 'TL', 'TO', 'TT', 'TV', 'TZ', 'UG', 'VU', 'YE', 'ZW'])

const clean = (v, max = 120) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

function validate(body) {
  const b = body || {}, a = b.address || {}
  const type = b.type === 'business' ? 'business' : b.type === 'individual' ? 'individual' : null
  if (!type) return { error: 'Choose individual or business.' }
  const p = {
    type,
    fullName: clean(b.fullName, 100),
    companyName: type === 'business' ? clean(b.companyName, 120) : '',
    registrationNumber: type === 'business' ? clean(b.registrationNumber, 40) : '',
    vatNumber: type === 'business' ? clean(b.vatNumber, 40) : '',
    website: type === 'business' ? clean(b.website, 200) : '',
    address: {
      line1: clean(a.line1), line2: clean(a.line2), city: clean(a.city, 80), region: clean(a.region, 80),
      postalCode: clean(a.postalCode, 20), countryCode: clean(a.countryCode, 2).toUpperCase(), placeId: clean(a.placeId, 300) || null,
    },
  }
  if (p.fullName.length < 2) return { error: type === 'business' ? 'Enter the contact person’s full name.' : 'Enter your full legal name.' }
  if (type === 'business' && p.companyName.length < 2) return { error: 'Enter the registered business name.' }
  if (p.website && !/^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(p.website)) return { error: 'Enter a valid website, or leave it empty.' }
  if (p.address.line1.length < 3) return { error: 'Enter the street address.' }
  if (p.address.city.length < 2) return { error: 'Enter the city.' }
  if (!ISO2.test(p.address.countryCode)) return { error: 'Choose the country.' }
  if (!p.address.postalCode && !NO_POSTCODE.has(p.address.countryCode)) return { error: 'Enter the postal code.' }
  return { profile: p }
}

const isComplete = (acc) => !!acc?.legalProfile?.completedAt
const holderName = (p) => (p.type === 'business' ? p.companyName : p.fullName)
const addressLine = (a) => [a.line1, a.line2, [a.postalCode, a.city].filter(Boolean).join(' '), a.region, a.countryCode].filter(Boolean).join(', ')

// What a provider order carries for this customer.
function endUser(acc) {
  const p = acc?.legalProfile
  if (!isComplete(acc)) return null
  return { chatId: String(acc._id), type: p.type, name: holderName(p), contact: p.fullName, address: addressLine(p.address), countryCode: p.address.countryCode, registrationNumber: p.registrationNumber || null, vatNumber: p.vatNumber || null }
}
// Infobip Resource Request requirement values (companyName / companyAddress) for request-based countries.
const infobipRequirements = (eu) => [{ key: 'companyName', value: eu.name }, { key: 'companyAddress', value: eu.address }]
const resaleNote = (eu) => `Resold by CloudIVR to end user #${eu.chatId} (${eu.type}): ${eu.name}, ${eu.address}`.slice(0, 250)

function fromPlace(d) {
  const pa = d.postalAddress || {}
  const comp = (t) => (d.addressComponents || []).find(c => (c.types || []).includes(t))
  const street = [comp('route')?.longText, comp('street_number')?.longText].filter(Boolean).join(' ')
  return {
    line1: clean((pa.addressLines || [])[0] || street), line2: clean((pa.addressLines || []).slice(1).join(', ')),
    city: clean(pa.locality || pa.sublocality || comp('postal_town')?.longText || comp('locality')?.longText || ''), region: clean(pa.administrativeArea || comp('administrative_area_level_1')?.shortText || ''),
    postalCode: clean(pa.postalCode || comp('postal_code')?.longText || '', 20),
    countryCode: clean(pa.regionCode || comp('country')?.shortText || '', 2).toUpperCase(), placeId: d.id || null, formatted: clean(d.formattedAddress || '', 300),
  }
}

function createLegalProfile(db, { log = console.log } = {}) {
  const accounts = db.collection('webAccounts')
  const resale = db.collection('numberResaleRecords')
  resale.createIndex({ phoneNumber: 1 }).catch(() => {})
  const hits = new Map() // per-account address lookups per minute
  const limited = (id) => {
    const now = Date.now(), h = hits.get(id) || { at: now, n: 0 }
    if (now - h.at > 60000) { h.at = now; h.n = 0 }
    h.n += 1; hits.set(id, h)
    return h.n > 40
  }
  const bad = (res, status, error, message) => res.status(status).json({ error, message })

  // Express middleware for number checkouts.
  function gate(req, res, next) {
    if (isComplete(req.webUser)) return next()
    return bad(res, 428, 'profile_required', 'Add your personal or business details before buying a number. We register every number in your name.')
  }

  // Kept for every number we sell (provider notes alone are not our record).
  async function recordResale({ chatId, phoneNumber, provider, country }) {
    const acc = await accounts.findOne({ _id: Number(chatId) })
    const eu = endUser(acc)
    await resale.insertOne({ phoneNumber, chatId: String(chatId), provider: provider || null, country: country || null, resold: true, endUser: eu, note: eu ? resaleNote(eu) : null, at: new Date() })
      .catch(e => log(`[CloudIVR-Web] resale record failed for ${phoneNumber}: ${e.message}`))
    return eu
  }
  async function endUserOf(chatId) { return endUser(await accounts.findOne({ _id: Number(chatId) })) }

  function routes(router, h) {
    router.get('/profile/legal', h(async (req, res) => res.json({ profile: req.webUser.legalProfile || null, complete: isComplete(req.webUser) })))

    router.put('/profile/legal', h(async (req, res) => {
      const v = validate(req.body)
      if (v.error) return bad(res, 400, 'invalid_profile', v.error)
      const prev = req.webUser.legalProfile
      const profile = { ...v.profile, completedAt: prev?.completedAt || new Date(), updatedAt: new Date() }
      await accounts.updateOne({ _id: req.webUser._id }, { $set: { legalProfile: profile }, $unset: { profileDue: '' } })
      log(`[CloudIVR-Web] legal profile ${prev ? 'updated' : 'added'} for ${req.webUser._id} (${profile.type}, ${profile.address.countryCode})`)
      res.json({ profile, complete: true })
    }))

    // "Later" on the sign-up step: stop showing it right after sign-up (buying still needs the details).
    router.post('/profile/legal/later', h(async (req, res) => {
      await accounts.updateOne({ _id: req.webUser._id }, { $unset: { profileDue: '' } })
      res.json({ ok: true })
    }))

    router.get('/address/suggest', h(async (req, res) => {
      const q = clean(req.query.q, 200)
      if (!key()) return bad(res, 503, 'address_search_off', 'Address search is not available right now. Type the address instead.')
      if (q.length < 3) return res.json({ suggestions: [] })
      if (limited(String(req.webUser._id))) return bad(res, 429, 'slow_down', 'Too many searches. Wait a moment.')
      const body = { input: q, sessionToken: clean(req.query.session, 64) || crypto.randomUUID(), languageCode: clean(req.query.lang, 5) || 'en' }
      const cc = clean(req.query.country, 2).toLowerCase()
      if (/^[a-z]{2}$/.test(cc)) body.includedRegionCodes = [cc]
      try {
        const d = (await axios.post(`${PLACES}/places:autocomplete`, body, { headers: { 'X-Goog-Api-Key': key() }, timeout: 8000 })).data
        res.json({ suggestions: (d.suggestions || []).map(s => s.placePrediction).filter(Boolean).slice(0, 5).map(p => ({ id: p.placeId, main: p.structuredFormat?.mainText?.text || p.text?.text, secondary: p.structuredFormat?.secondaryText?.text || '' })) })
      } catch (e) {
        log(`[CloudIVR-Web] address suggest failed: ${e.response?.data?.error?.message || e.message}`)
        bad(res, 503, 'address_search_failed', 'Address search is not answering. Type the address instead.')
      }
    }))

    router.get('/address/place', h(async (req, res) => {
      const id = clean(req.query.id, 300)
      if (!key()) return bad(res, 503, 'address_search_off', 'Address search is not available right now. Type the address instead.')
      if (!/^[\w-]{10,300}$/.test(id)) return bad(res, 400, 'invalid_place', 'Pick an address from the list.')
      try {
        const d = (await axios.get(`${PLACES}/places/${id}`, { params: { sessionToken: clean(req.query.session, 64) || undefined, languageCode: 'en' }, headers: { 'X-Goog-Api-Key': key(), 'X-Goog-FieldMask': 'id,formattedAddress,postalAddress,addressComponents' }, timeout: 8000 })).data
        res.json({ address: fromPlace(d) })
      } catch (e) {
        log(`[CloudIVR-Web] address place failed: ${e.response?.data?.error?.message || e.message}`)
        bad(res, 503, 'address_search_failed', 'Could not load that address. Type it instead.')
      }
    }))
  }

  return { routes, gate, recordResale, endUserOf }
}

module.exports = { createLegalProfile, validate, isComplete, endUser, resaleNote, infobipRequirements, fromPlace }
