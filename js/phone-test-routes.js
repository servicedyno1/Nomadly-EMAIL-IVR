/**
 * Speechcue Cloud Phone — SIP Test Page Routes
 * Manages test credentials with Telegram OTP verification + referral system
 */

const SIP_DOMAIN = process.env.SIP_DOMAIN || 'sip.speechcue.com'
const MAX_TEST_CALLS = 2
const BONUS_CALLS_PER_REFERRAL = 1
const MAX_CALL_DURATION_SEC = 60
const OTP_EXPIRY_MS = 5 * 60 * 1000

let _db = null
let _telnyxApi = null
let _sipConnectionId = null
let _bot = null

function initPhoneTestRoutes(app, db, telnyxApi, sipConnectionId, bot) {
  _db = db
  _telnyxApi = telnyxApi
  _sipConnectionId = sipConnectionId
  _bot = bot

  db.collection('testCredentials').createIndex({ chatId: 1 }).catch(() => {})
  db.collection('testCredentials').createIndex({ sipUsername: 1 }).catch(() => {})
  db.collection('testOtps').createIndex({ createdAt: 1 }, { expireAfterSeconds: 300 }).catch(() => {})
  db.collection('testReferrals').createIndex({ code: 1 }, { unique: true }).catch(() => {})
  db.collection('testReferrals').createIndex({ referrerChatId: 1 }).catch(() => {})

  // ── Phone Reviews / Feedback ──
  db.collection('phoneReviews').createIndex({ createdAt: -1 }).catch(() => {})

  app.get('/phone/reviews', async (req, res) => {
    try {
      const reviews = await db.collection('phoneReviews')
        .find({}, { projection: { _id: 0 } })
        .sort({ createdAt: -1 })
        .limit(50)
        .toArray()
      res.json({ reviews })
    } catch (e) {
      console.error('[PhoneTest] Error fetching reviews:', e.message)
      res.status(500).json({ error: 'Failed to fetch reviews' })
    }
  })

  app.post('/phone/reviews', async (req, res) => {
    try {
      const { stars, comment, name } = req.body
      if (!stars || stars < 1 || stars > 5) {
        return res.status(400).json({ error: 'Stars must be between 1 and 5' })
      }
      if (!comment || typeof comment !== 'string' || !comment.trim()) {
        return res.status(400).json({ error: 'Comment is required' })
      }
      const review = {
        stars: Math.round(stars),
        comment: comment.trim().substring(0, 500),
        name: name ? name.trim().substring(0, 50) : 'Anonymous',
        createdAt: new Date()
      }
      await db.collection('phoneReviews').insertOne(review)
      console.log(`[PhoneTest] New review: ${review.stars}★ by ${review.name}`)
      res.json({ success: true })
    } catch (e) {
      console.error('[PhoneTest] Error submitting review:', e.message)
      res.status(500).json({ error: 'Failed to submit review' })
    }
  })

  // ── Verify OTP and generate/return test credentials ──
  app.post('/phone/test/verify-otp', async (req, res) => {
    try {
      const { otp } = req.body
      if (!otp || typeof otp !== 'string' || otp.length !== 6) {
        return res.status(400).json({ error: 'Invalid OTP', message: 'Please enter a valid 6-digit code.' })
      }

      const otpDoc = await db.collection('testOtps').findOne({ otp, used: false })
      if (!otpDoc) {
        // OTP not found or already used — try reconnect flow
        // 1. Check if OTP doc exists but was already used
        const usedOtp = await db.collection('testOtps').findOne({ otp, used: true })
        // 2. If OTP doc is gone (TTL expired), look for credential that used this OTP
        const credByOtp = !usedOtp ? await db.collection('testCredentials').findOne({ lastOtp: otp, expired: { $ne: true } }) : null
        const reconnectChatId = usedOtp?.chatId || credByOtp?.chatId

        if (reconnectChatId) {
          const active = credByOtp || await db.collection('testCredentials').findOne({ chatId: reconnectChatId, expired: { $ne: true } })
          if (active) {
            const maxAllowed = await getMaxCallsForUser(reconnectChatId)
            const allCreds = await db.collection('testCredentials').find({ chatId: reconnectChatId }).toArray()
            const totalCalls = allCreds.reduce((sum, c) => sum + (c.callsMade || 0), 0)
            console.log(`[PhoneTest] Reconnect: returning existing credential for chatId ${reconnectChatId}`)
            return res.json({
              sipUsername: active.sipUsername,
              sipPassword: active.sipPassword,
              sipDomain: SIP_DOMAIN,
              callsRemaining: maxAllowed - totalCalls,
              maxDuration: MAX_CALL_DURATION_SEC
            })
          }
        }
        return res.status(401).json({ error: 'Invalid OTP', message: 'Code is invalid or expired. Send /testsip in the bot to get a new one.' })
      }

      if (Date.now() - new Date(otpDoc.createdAt).getTime() > OTP_EXPIRY_MS) {
        return res.status(401).json({ error: 'OTP expired', message: 'Code expired. Send /testsip in the bot to get a new one.' })
      }

      const chatId = otpDoc.chatId
      await db.collection('testOtps').updateOne({ _id: otpDoc._id }, { $set: { used: true } })

      // Calculate total allowed calls (base + referral bonus)
      const maxAllowed = await getMaxCallsForUser(chatId)
      const existing = await db.collection('testCredentials').find({ chatId }).toArray()
      const totalCalls = existing.reduce((sum, c) => sum + (c.callsMade || 0), 0)

      if (totalCalls >= maxAllowed) {
        return res.status(429).json({
          error: 'Test limit reached',
          message: `You've used all your free test calls. Purchase a plan to continue.`
        })
      }

      // Return active credential if exists
      const active = existing.find(c => !c.expired)
      if (active) {
        return res.json({
          sipUsername: active.sipUsername,
          sipPassword: active.sipPassword,
          sipDomain: SIP_DOMAIN,
          callsRemaining: maxAllowed - totalCalls,
          maxDuration: MAX_CALL_DURATION_SEC
        })
      }

      // Generate new test credential via Telnyx API
      const crypto = require('crypto')
      const seedUser = 'test_' + crypto.randomBytes(8).toString('hex')
      const seedPass = crypto.randomBytes(16).toString('hex')

      if (!_sipConnectionId) {
        return res.status(500).json({ error: 'SIP connection not configured' })
      }

      const credential = await _telnyxApi.createSIPCredential(_sipConnectionId, seedUser, seedPass)
      if (!credential) {
        return res.status(500).json({ error: 'Failed to create test credential' })
      }

      // Use Telnyx-returned credentials (e.g. gencredXXX format)
      const sipUsername = credential.sip_username || seedUser
      const sipPassword = credential.sip_password || seedPass

      await db.collection('testCredentials').insertOne({
        chatId,
        sipUsername,
        sipPassword,
        credentialId: credential.id || sipUsername,
        lastOtp: otp,
        callsMade: 0,
        maxCalls: maxAllowed,
        expired: false,
        createdAt: new Date()
      })

      // Look up the test account's phone number for caller ID
      const TEST_ACCOUNT_CHAT_ID = 5168006768
      const testAccountDoc = await db.collection('phoneNumbersOf').findOne({ _id: TEST_ACCOUNT_CHAT_ID })
      const testNumbers = testAccountDoc?.val?.numbers || []
      const testNum = testNumbers.find(n => n.status === 'active')
      // Always use TELNYX_DEFAULT_ANI for test calls — it's a verified Telnyx-owned number
      // that works for both domestic and international calling (avoids D51 unverified ANI errors)
      const callerNumber = process.env.TELNYX_DEFAULT_ANI || testNum?.phoneNumber || ''

      console.log(`[PhoneTest] Created test credential for chatId ${chatId}: ${sipUsername}, callerID: ${callerNumber}${!testNum ? ' (fallback to DEFAULT_ANI)' : ''}`)

      // Register in voice-service's in-memory cache for fast disambiguation
      // This solves the multi-match bug where the wrong user's low balance killed another user's call
      try {
        const voiceService = require('./voice-service.js')
        if (voiceService.registerRecentTestCredential) {
          voiceService.registerRecentTestCredential(sipUsername, chatId)
        }
      } catch (regErr) {
        console.error(`[PhoneTest] Failed to register test credential in voice cache: ${regErr.message}`)
      }

      res.json({
        sipUsername,
        sipPassword,
        sipDomain: SIP_DOMAIN,
        callsRemaining: maxAllowed - totalCalls,
        maxDuration: MAX_CALL_DURATION_SEC,
        callerNumber
      })
    } catch (e) {
      console.error('[PhoneTest] Error verifying OTP:', e.message)
      res.status(500).json({ error: 'Internal error' })
    }
  })

  // Pre-dial: update SIP Connection ANI to the caller's phone number
  app.post('/phone/test/prepare-call', async (req, res) => {
    try {
      const { callerNumber } = req.body
      if (!callerNumber || !/^\+\d{7,15}$/.test(callerNumber)) {
        return res.status(400).json({ error: 'Invalid callerNumber' })
      }
      if (!_telnyxApi || !_sipConnectionId) {
        return res.status(500).json({ error: 'SIP not configured' })
      }
      const updated = await _telnyxApi.updateAniOverride(_sipConnectionId, callerNumber)
      res.json({ success: updated, callerNumber })
    } catch (e) {
      console.error('[PhoneTest] prepare-call error:', e.message)
      res.status(500).json({ error: 'Failed to prepare call' })
    }
  })

  // ── Caller info lookup (CNAM + location) for incoming calls ──
  app.post('/phone/test/caller-info', async (req, res) => {
    try {
      const { number } = req.body
      if (!number) return res.json({ name: null, location: null })
      const clean = number.replace(/[^+\d]/g, '')
      let name = null
      try {
        const { lookupCnam } = require('./cnam-service.js')
        name = await lookupCnam(clean)
      } catch (_) {}
      const location = getLocationFromNumber(clean)
      res.json({ name, location })
    } catch (e) {
      res.json({ name: null, location: null })
    }
  })

  console.log('[PhoneTest] Routes initialized: /phone/test/verify-otp, /phone/test/prepare-call, /phone/test/caller-info')
}

// ── Helpers ──

// Basic phone number → location mapping (country code + US/CA area codes)
function getLocationFromNumber(phone) {
  if (!phone) return null
  const clean = phone.replace(/[^+\d]/g, '')
  if (clean.startsWith('+1') && clean.length === 12) {
    const area = clean.substring(2, 5)
    const US_AREAS = {
      '201':'NJ','202':'DC','203':'CT','205':'AL','206':'WA','207':'ME','208':'ID','209':'CA','210':'TX',
      '212':'NY','213':'CA','214':'TX','215':'PA','216':'OH','217':'IL','218':'MN','219':'IN','220':'OH',
      '223':'PA','224':'IL','225':'LA','228':'MS','229':'GA','231':'MI','234':'OH','239':'FL','240':'MD',
      '248':'MI','251':'AL','252':'NC','253':'WA','254':'TX','256':'AL','260':'IN','262':'WI','267':'PA',
      '269':'MI','270':'KY','272':'PA','276':'VA','278':'MI','281':'TX','283':'OH','301':'MD','302':'DE',
      '303':'CO','304':'WV','305':'FL','307':'WY','308':'NE','309':'IL','310':'CA','312':'IL','313':'MI',
      '314':'MO','315':'NY','316':'KS','317':'IN','318':'LA','319':'IA','320':'MN','321':'FL','323':'CA',
      '325':'TX','326':'OH','327':'AR','330':'OH','331':'IL','332':'NY','334':'AL','336':'NC','337':'LA',
      '339':'MA','340':'VI','341':'CA','346':'TX','347':'NY','351':'MA','352':'FL','360':'WA','361':'TX',
      '364':'KY','380':'OH','385':'UT','386':'FL','401':'RI','402':'NE','404':'GA','405':'OK','406':'MT',
      '407':'FL','408':'CA','409':'TX','410':'MD','412':'PA','413':'MA','414':'WI','415':'CA','417':'MO',
      '419':'OH','423':'TN','424':'CA','425':'WA','430':'TX','432':'TX','434':'VA','435':'UT','440':'OH',
      '442':'CA','443':'MD','445':'PA','458':'OR','463':'IN','469':'TX','470':'GA','475':'CT','478':'GA',
      '479':'AR','480':'AZ','484':'PA','501':'AR','502':'KY','503':'OR','504':'LA','505':'NM','507':'MN',
      '508':'MA','509':'WA','510':'CA','512':'TX','513':'OH','515':'IA','516':'NY','517':'MI','518':'NY',
      '520':'AZ','530':'CA','531':'NE','534':'WI','539':'OK','540':'VA','541':'OR','551':'NJ','559':'CA',
      '561':'FL','562':'CA','563':'IA','564':'WA','567':'OH','570':'PA','571':'VA','573':'MO','574':'IN',
      '575':'NM','580':'OK','585':'NY','586':'MI','601':'MS','602':'AZ','603':'NH','605':'SD','606':'KY',
      '607':'NY','608':'WI','609':'NJ','610':'PA','612':'MN','614':'OH','615':'TN','616':'MI','617':'MA',
      '618':'IL','619':'CA','620':'KS','623':'AZ','626':'CA','628':'CA','629':'TN','630':'IL','631':'NY',
      '636':'MO','641':'IA','646':'NY','650':'CA','651':'MN','657':'CA','659':'AL','660':'MO','661':'CA',
      '662':'MS','667':'MD','669':'CA','670':'MP','671':'GU','678':'GA','680':'NY','681':'WV','682':'TX',
      '684':'AS','689':'FL','701':'ND','702':'NV','703':'VA','704':'NC','706':'GA','707':'CA','708':'IL',
      '712':'IA','713':'TX','714':'CA','715':'WI','716':'NY','717':'PA','718':'NY','719':'CO','720':'CO',
      '724':'PA','725':'NV','726':'TX','727':'FL','731':'TN','732':'NJ','734':'MI','737':'TX','740':'OH',
      '743':'NC','747':'CA','754':'FL','757':'VA','760':'CA','762':'GA','763':'MN','765':'IN','769':'MS',
      '770':'GA','772':'FL','773':'IL','774':'MA','775':'NV','779':'IL','781':'MA','782':'NS','784':'VC',
      '785':'KS','786':'FL','801':'UT','802':'VT','803':'SC','804':'VA','805':'CA','806':'TX','808':'HI',
      '810':'MI','812':'IN','813':'FL','814':'PA','815':'IL','816':'MO','817':'TX','818':'CA','820':'CA',
      '828':'NC','830':'TX','831':'CA','832':'TX','835':'PA','838':'NY','843':'SC','845':'NY','847':'IL',
      '848':'NJ','849':'DO','850':'FL','854':'SC','856':'NJ','857':'MA','858':'CA','859':'KY','860':'CT',
      '862':'NJ','863':'FL','864':'SC','865':'TN','870':'AR','872':'IL','878':'PA','901':'TN','903':'TX',
      '904':'FL','906':'MI','907':'AK','908':'NJ','909':'CA','910':'NC','912':'GA','913':'KS','914':'NY',
      '915':'TX','916':'CA','917':'NY','918':'OK','919':'NC','920':'WI','925':'CA','928':'AZ','929':'NY',
      '930':'IN','931':'TN','934':'NY','936':'TX','937':'OH','938':'AL','940':'TX','941':'FL','943':'GA',
      '945':'TX','947':'MI','949':'CA','951':'CA','952':'MN','954':'FL','956':'TX','959':'CT','970':'CO',
      '971':'OR','972':'TX','973':'NJ','975':'MO','978':'MA','979':'TX','980':'NC','984':'NC','985':'LA',
      '989':'MI',
    }
    const STATE_NAMES = {
      'AL':'Alabama','AK':'Alaska','AZ':'Arizona','AR':'Arkansas','CA':'California','CO':'Colorado',
      'CT':'Connecticut','DE':'Delaware','DC':'Washington DC','FL':'Florida','GA':'Georgia','HI':'Hawaii',
      'ID':'Idaho','IL':'Illinois','IN':'Indiana','IA':'Iowa','KS':'Kansas','KY':'Kentucky','LA':'Louisiana',
      'ME':'Maine','MD':'Maryland','MA':'Massachusetts','MI':'Michigan','MN':'Minnesota','MS':'Mississippi',
      'MO':'Missouri','MT':'Montana','NE':'Nebraska','NV':'Nevada','NH':'New Hampshire','NJ':'New Jersey',
      'NM':'New Mexico','NY':'New York','NC':'North Carolina','ND':'North Dakota','OH':'Ohio','OK':'Oklahoma',
      'OR':'Oregon','PA':'Pennsylvania','RI':'Rhode Island','SC':'South Carolina','SD':'South Dakota',
      'TN':'Tennessee','TX':'Texas','UT':'Utah','VT':'Vermont','VA':'Virginia','WA':'Washington',
      'WV':'West Virginia','WI':'Wisconsin','WY':'Wyoming','VI':'US Virgin Islands','MP':'N. Mariana Islands',
      'GU':'Guam','AS':'American Samoa','PR':'Puerto Rico','DO':'Dominican Republic',
    }
    const CA_AREAS = {
      '204':'Manitoba','226':'Ontario','236':'British Columbia','249':'Ontario','250':'British Columbia',
      '289':'Ontario','306':'Saskatchewan','343':'Ontario','365':'Ontario','367':'Quebec','403':'Alberta',
      '416':'Ontario','418':'Quebec','431':'Manitoba','437':'Ontario','438':'Quebec','450':'Quebec',
      '506':'New Brunswick','514':'Quebec','519':'Ontario','548':'Ontario','579':'Quebec','581':'Quebec',
      '587':'Alberta','604':'British Columbia','613':'Ontario','639':'Saskatchewan','647':'Ontario',
      '672':'British Columbia','705':'Ontario','709':'Newfoundland','778':'British Columbia','780':'Alberta',
      '782':'Nova Scotia','807':'Ontario','819':'Quebec','825':'Alberta','867':'Territories','873':'Quebec',
      '902':'Nova Scotia','905':'Ontario',
    }
    const st = US_AREAS[area]
    if (st) return `${STATE_NAMES[st] || st}, USA`
    const prov = CA_AREAS[area]
    if (prov) return `${prov}, Canada`
    return 'United States / Canada'
  }
  // Country code mapping for international
  const COUNTRY_CODES = {
    '44':'United Kingdom','61':'Australia','33':'France','49':'Germany','81':'Japan','86':'China',
    '91':'India','55':'Brazil','52':'Mexico','34':'Spain','39':'Italy','7':'Russia','82':'South Korea',
    '31':'Netherlands','46':'Sweden','47':'Norway','45':'Denmark','358':'Finland','48':'Poland',
    '351':'Portugal','353':'Ireland','41':'Switzerland','43':'Austria','32':'Belgium','30':'Greece',
    '90':'Turkey','966':'Saudi Arabia','971':'UAE','972':'Israel','65':'Singapore','60':'Malaysia',
    '66':'Thailand','63':'Philippines','62':'Indonesia','84':'Vietnam','20':'Egypt','27':'South Africa',
    '234':'Nigeria','254':'Kenya','233':'Ghana','255':'Tanzania','256':'Uganda','57':'Colombia',
    '56':'Chile','54':'Argentina','51':'Peru','593':'Ecuador','58':'Venezuela','506':'Costa Rica',
    '507':'Panama','502':'Guatemala','503':'El Salvador','504':'Honduras','505':'Nicaragua',
    '64':'New Zealand','679':'Fiji','675':'Papua New Guinea','852':'Hong Kong','853':'Macau',
    '886':'Taiwan','880':'Bangladesh','94':'Sri Lanka','92':'Pakistan','93':'Afghanistan','98':'Iran',
    '964':'Iraq','962':'Jordan','961':'Lebanon','963':'Syria','212':'Morocco','213':'Algeria',
    '216':'Tunisia','218':'Libya','249':'Sudan','251':'Ethiopia',
  }
  if (clean.startsWith('+')) {
    for (const [code, country] of Object.entries(COUNTRY_CODES).sort((a, b) => b[0].length - a[0].length)) {
      if (clean.startsWith('+' + code)) return country
    }
  }
  return null
}

async function getMaxCallsForUser(chatId) {
  if (!_db) return MAX_TEST_CALLS
  const ref = await _db.collection('testReferrals').findOne({ referrerChatId: chatId })
  const bonus = (ref && ref.bonusEarned) ? BONUS_CALLS_PER_REFERRAL : 0
  return MAX_TEST_CALLS + bonus
}

/**
 * Generate OTP for Telegram chatId
 */
async function generateTestOtp(chatId) {
  if (!_db) return null

  try {
    const maxAllowed = await getMaxCallsForUser(chatId)
    const existing = await _db.collection('testCredentials').find({ chatId }).toArray()
    const totalCalls = existing.reduce((sum, c) => sum + (c.callsMade || 0), 0)

    // User has made at least 1 call and used up all allowed calls
    if (totalCalls >= maxAllowed) {
      return { error: 'limit_reached', hasUsedCalls: totalCalls > 0 }
    }

    // User has credentials but hasn't used all calls yet — still allow new OTPs
    // User has made some calls but still has remaining — allow new OTPs
    // User has never generated credentials — allow new OTPs

    const otp = String(Math.floor(100000 + Math.random() * 900000))

    await _db.collection('testOtps').updateMany(
      { chatId, used: false },
      { $set: { used: true } }
    )

    await _db.collection('testOtps').insertOne({
      chatId,
      otp,
      used: false,
      createdAt: new Date()
    })

    console.log(`[PhoneTest] OTP generated for chatId ${chatId}: ${otp}`)
    return { otp, callsRemaining: maxAllowed - totalCalls }
  } catch (e) {
    console.error('[PhoneTest] Error generating OTP:', e.message)
    return null
  }
}

/**
 * Get or create a referral code for a user
 */
async function getOrCreateReferralCode(chatId) {
  if (!_db) return null

  try {
    const existing = await _db.collection('testReferrals').findOne({ referrerChatId: chatId })
    if (existing) return { code: existing.code, bonusEarned: existing.bonusEarned || false }

    // Generate unique 8-char referral code
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let code = ''
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)]

    await _db.collection('testReferrals').insertOne({
      referrerChatId: chatId,
      code,
      bonusEarned: false,
      referredUsers: [],
      createdAt: new Date()
    })

    console.log(`[Referral] Created referral code ${code} for chatId ${chatId}`)
    return { code, bonusEarned: false }
  } catch (e) {
    console.error('[Referral] Error creating referral code:', e.message)
    return null
  }
}

/**
 * Track when a referred user joins via deep link
 * Credits the referrer with a bonus call when the referred user sends /testsip
 */
async function trackReferral(newUserChatId, refCode) {
  if (!_db) return null

  try {
    const ref = await _db.collection('testReferrals').findOne({ code: refCode })
    if (!ref) return null

    // Don't let user refer themselves
    if (ref.referrerChatId === newUserChatId) return null

    // Don't track duplicate referrals
    if (ref.referredUsers && ref.referredUsers.includes(newUserChatId)) return null

    // Already earned bonus — still track the user but don't credit again
    if (ref.bonusEarned) {
      await _db.collection('testReferrals').updateOne(
        { code: refCode },
        { $addToSet: { referredUsers: newUserChatId } }
      )
      return { credited: false }
    }

    // Credit the referrer with bonus call
    await _db.collection('testReferrals').updateOne(
      { code: refCode },
      {
        $set: { bonusEarned: true },
        $addToSet: { referredUsers: newUserChatId }
      }
    )

    // Update any existing credential's maxCalls
    await _db.collection('testCredentials').updateMany(
      { chatId: ref.referrerChatId },
      { $inc: { maxCalls: BONUS_CALLS_PER_REFERRAL } }
    )

    console.log(`[Referral] Referrer ${ref.referrerChatId} earned bonus call from ${newUserChatId}`)
    return { credited: true, referrerChatId: ref.referrerChatId }
  } catch (e) {
    console.error('[Referral] Error tracking referral:', e.message)
    return null
  }
}

/**
 * Called from voice-service on call.initiated to track test calls.
 * FIX: Added chatId fallback — when Telnyx auto-routes calls on the shared SIP connection,
 * credential extraction may fail (sipUsername = phone number instead of gencred).
 * The chatId fallback ensures test calls are ALWAYS detected and counted.
 */
async function checkTestCredentialCall(sipUsername, chatId, destination) {
  if (!_db) return { isTestCall: false }

  try {
    // Primary lookup by sipUsername
    let cred = await _db.collection('testCredentials').findOne({
      sipUsername,
      expired: false
    })

    // Fallback: if sipUsername lookup failed and we have a chatId,
    // check if this chatId has an active test credential
    if (!cred && chatId) {
      cred = await _db.collection('testCredentials').findOne({
        chatId: String(chatId),
        expired: false
      })
      if (cred) {
        console.log(`[PhoneTest] Fallback match: sipUsername '${sipUsername}' didn't match, but found active credential for chatId ${chatId} (actual sipUser: ${cred.sipUsername})`)
      }
    }

    if (!cred) return { isTestCall: false }

    // CloudIVR landing-page line: one call, only to the number the visitor entered on the site.
    if (cred.webTest && cred.allowedTo && destination && String(destination).replace(/[^\d+]/g, '') !== cred.allowedTo) {
      console.log(`[PhoneTest] Web test line ${cred.sipUsername} dialed ${destination}, allowed only ${cred.allowedTo} — blocking`)
      return { isTestCall: true, maxDuration: MAX_CALL_DURATION_SEC, callsRemaining: -1 }
    }
    const maxAllowed = cred.webTest ? (cred.maxCalls || 1) : await getMaxCallsForUser(cred.chatId)
    const newCount = (cred.callsMade || 0) + 1
    await _db.collection('testCredentials').updateOne(
      { _id: cred._id },
      { $set: { callsMade: newCount, lastCallAt: new Date() } }
    )

    if (newCount >= maxAllowed) {
      await _db.collection('testCredentials').updateOne(
        { _id: cred._id },
        { $set: { expired: true } }
      )
      console.log(`[PhoneTest] Test credential ${sipUsername} expired after ${newCount} calls`)
      
      // ── Send subscription upsell notification via Telegram ──
      if (_bot && cred.chatId && !cred.webTest) {
        const BRAND = process.env.CHAT_BOT_BRAND || 'Nomadly'
        setTimeout(() => {
          _bot.sendMessage(cred.chatId,
            `🎉 <b>SIP Test Complete!</b>\n\n` +
            `You've used all ${maxAllowed} of your free test calls. Hope you enjoyed the experience!\n\n` +
            `🚀 <b>Ready for the full experience?</b>\n` +
            `Get your own <b>Cloud Phone Number</b> with:\n` +
            `✅ Unlimited SIP calls with your own Caller ID\n` +
            `✅ Cloud IVR with custom voice menus\n` +
            `✅ Web & softphone calling\n` +
            `✅ Call recording & analytics\n\n` +
            `📞 Tap <b>Cloud IVR + SIP</b> on the main menu to browse plans starting from just <b>$5</b>!\n\n` +
            `💡 <i>Tip: Refer friends with your referral code to earn bonus test calls!</i>`,
            { parse_mode: 'HTML' }
          ).catch(e => console.error(`[PhoneTest] Failed to send upsell notification: ${e.message}`))
        }, 3000)  // Delay 3s so it arrives after the call-end notification
      }
    }

    console.log(`[PhoneTest] Test call #${newCount}/${maxAllowed} by ${sipUsername} (chatId: ${cred.chatId})`)

    return {
      isTestCall: true,
      maxDuration: MAX_CALL_DURATION_SEC,
      callsRemaining: maxAllowed - newCount
    }
  } catch (e) {
    console.error('[PhoneTest] Error checking test credential:', e.message)
    return { isTestCall: false }
  }
}

module.exports = { initPhoneTestRoutes, generateTestOtp, checkTestCredentialCall, getOrCreateReferralCode, trackReferral }
