// Temporary company test line on the owner's account for live call-path checks.
// usage (in a release dir with backend.env loaded): node call_path_testline.js <voicemail|ivr|forward|remove> [forwardTo]
const { MongoClient } = require('mongodb')
const crypto = require('crypto')
const OWNER = String(process.env.TELEGRAM_ADMIN_CHAT_ID)
const NUM = '+18648308599', USER = 'cvtestline1'
const mode = process.argv[2], fwdTo = process.argv[3]
;(async () => {
  const c = await MongoClient.connect(process.env.MONGO_URL)
  const col = c.db(process.env.DB_NAME).collection('phoneNumbersOf')
  if (mode === 'remove') {
    await col.updateOne({ _id: OWNER }, { $pull: { 'val.numbers': { phoneNumber: NUM, _testLine: true } } })
    console.log('removed'); return process.exit(0)
  }
  const doc = await col.findOne({ _id: OWNER })
  const prev = (doc?.val?.numbers || []).find(n => n.phoneNumber === NUM)
  const pw = prev?.sipPassword || crypto.randomBytes(9).toString('base64url')
  const longText = 'Thank you for calling the CloudIVR test line. This greeting is intentionally long so that the media link is long enough to check that spoken prompts still play on every call. Please leave a message after the tone.'
  const num = {
    phoneNumber: NUM, provider: 'multitel', country: 'US', type: 'local', plan: 'business', planPrice: 0, status: 'active', _testLine: true,
    purchaseDate: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), autoRenew: false,
    sipUsername: USER, sipPassword: pw, telnyxSipUsername: USER, telnyxSipPassword: pw, telnyxCredentialId: `kam:${USER}`, sipDomain: 'sip.speechcue.com',
    capabilities: { voice: true, sms: false, mms: false, fax: false },
    features: {
      callForwarding: mode === 'forward' ? { enabled: true, mode: 'always', forwardTo: fwdTo, ringTimeout: 20, holdMusic: false } : { enabled: false, mode: 'disabled', forwardTo: null, ringTimeout: 25 },
      voicemail: { enabled: mode === 'voicemail', greetingType: 'default', customGreetingUrl: null, forwardToTelegram: true, ringTimeout: 5 },
      ivr: mode === 'ivr' ? { enabled: true, greeting: longText.replace('Please leave a message after the tone.', 'Press 1 for sales or press 2 for support.'), greetingType: 'tts', options: { 1: { action: 'message', message: 'You pressed one.' } } } : { enabled: false },
      recording: false,
    },
  }
  await col.updateOne({ _id: OWNER }, { $pull: { 'val.numbers': { phoneNumber: NUM } } }, { upsert: true })
  await col.updateOne({ _id: OWNER }, { $push: { 'val.numbers': num } }, { upsert: true })
  console.log('set', mode); process.stdout.write(`PW=${pw}\n`, () => process.exit(0))
})()
