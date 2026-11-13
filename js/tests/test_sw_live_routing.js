// Numbers / SIP endpoints bought from preview must point at the live app.
'use strict'
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${m}`) }
const fresh = (env) => { Object.assign(process.env, env); delete require.cache[require.resolve('../signalwire/rest')]; return require('../signalwire/rest') }
const base = { CHAT_BOT_BRAND: 'Nomadly', SIGNALWIRE_TOPIC: '', SIGNALWIRE_NUMBER_TOPIC: '' }
delete process.env.SIGNALWIRE_TOPIC; delete process.env.SIGNALWIRE_NUMBER_TOPIC
let r = fresh({ ...base, BOT_ENVIRONMENT: 'development', SELF_URL: 'https://preview.example/api', SIGNALWIRE_LIVE_URL: 'https://2.speechcue.com' })
delete process.env.SIGNALWIRE_TOPIC; delete process.env.SIGNALWIRE_NUMBER_TOPIC
ok(r.topic() === 'nomadly-dev', 'preview still listens on its own topic')
ok(r.handlerBody().call_relay_topic === 'nomadly', 'preview-bought number calls → live topic')
ok(r.handlerBody().message_request_url === 'https://2.speechcue.com/signalwire/sms-webhook', 'preview-bought number texts → live app')
delete process.env.SIGNALWIRE_LIVE_URL
r = fresh({ BOT_ENVIRONMENT: 'production', CHAT_BOT_BRAND: 'Voodoo Land', SELF_URL: 'https://voodooivr.xyz' })
ok(r.handlerBody().call_relay_topic === 'voodooland' && r.topic() === 'voodooland', 'live brand: topic unchanged')
ok(r.handlerBody().message_request_url === 'https://voodooivr.xyz/signalwire/sms-webhook', 'live brand: texts → own SELF_URL')
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
