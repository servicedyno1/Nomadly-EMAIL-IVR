// AWS number validation mapping + router fallback after Bird. Run: cd /app && node js/tests/test_aws_lookup.js
process.env.AWS_ACCESS_KEY_ID = 'x'; process.env.AWS_SECRET_ACCESS_KEY = 'y'; process.env.SIGNALWIRE_PROJECT_ID = ''; process.env.BIRD_API_KEY = ''; process.env.INFOBIP_API_KEY = ''
const aws = require('/app/js/aws')
let pass = 0, fail = 0
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`) }
let resp = {}, sent
aws._send = async (cmd) => { sent = cmd.input; if (resp instanceof Error) throw resp; return { NumberValidateResponse: resp } }
;(async () => {
  resp = { PhoneType: 'LANDLINE', Carrier: 'Fibernetics', CountryCodeIso2: 'CA' }
  const r = await aws.lookup('1 (647) 945-7172')
  ok('landline mapped + E.164 sent', r.type === 'landline' && r.carrier === 'Fibernetics' && r.valid && sent.NumberValidateRequest.PhoneNumber === '+16479457172')
  resp = { PhoneType: 'INVALID' }; ok('invalid → valid:false', (await aws.lookup('+12025550123')).valid === false)
  resp = { PhoneType: 'PREPAID', Carrier: 'T-Mobile' }; ok('prepaid → mobile', (await aws.lookup('+14155550000')).type === 'mobile')
  resp = new Error('throttled'); ok('error → null', (await aws.lookup('+14155550000')) === null)
  resp = { PhoneType: 'VOIP', Carrier: 'Bandwidth' }
  ok('router lookup falls to AWS', (await require('/app/js/signalwire').lookup('+14155550000'))?.carrier === 'Bandwidth')
  ok('region falls back from "global"', (process.env.AWS_REGION = 'global', aws.region() === 'us-east-1'))
  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})()
