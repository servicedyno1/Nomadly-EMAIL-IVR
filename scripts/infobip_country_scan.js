// Which countries Infobip sells voice numbers in with no extra paperwork (additionalSetupRequired=false). Read only.
// Usage: node scripts/infobip_country_scan.js > /tmp/infobip_countries.txt
require('dotenv').config({ path: require('path').join(__dirname, '../backend/.env') })
const axios = require('axios')
const base = `https://${String(process.env.INFOBIP_BASE_URL || 'api.infobip.com').replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
const COUNTRIES = 'US CA GB IE FR DE ES IT PT NL BE LU CH AT DK SE NO FI IS PL CZ SK HU RO BG GR HR SI RS EE LV LT UA TR IL AE SA QA KW BH OM JO EG MA TN ZA NG KE GH UG TZ CI SN CM IN PK BD LK SG MY TH VN PH ID HK TW JP KR AU NZ MX BR AR CL CO PE VE EC UY PY BO CR PA GT DO PR JM TT'.split(' ')
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

;(async () => {
  const rows = []
  for (const country of COUNTRIES) {
    let d = null
    for (let t = 0; t < 4 && !d; t++) {
      try { d = (await axios.get(`${base}/numbers/1/numbers/available`, { params: { country, limit: 50, capabilities: 'VOICE' }, headers: { Authorization: `App ${process.env.INFOBIP_API_KEY}` }, timeout: 20000 })).data }
      catch (e) { if (e.response?.status === 429) await sleep(4000 * (t + 1)); else { d = { numbers: [], err: e.response?.status } } }
    }
    const all = d?.numbers || []
    const easy = all.filter(n => n.additionalSetupRequired === false)
    const sms = easy.filter(n => (n.capabilities || []).includes('SMS'))
    const cheapest = easy.map(n => n.price?.pricePerMonth).filter(Number.isFinite).sort((a, b) => a - b)[0]
    const types = [...new Set(easy.map(n => n.type))].join('/')
    rows.push({ country, total: all.length, easy: easy.length, sms: sms.length, cheapest, types })
    console.log(`${country}\ttotal=${all.length}\tno-paperwork=${easy.length}\twith-sms=${sms.length}\tfrom=${cheapest ? cheapest.toFixed(2) + ' EUR/mo' : '-'}\t${types}${d?.err ? '\terr=' + d.err : ''}`)
    await sleep(1600)
  }
  const ok = rows.filter(r => r.easy > 0).map(r => r.country)
  console.log(`\nNO_PAPERWORK_COUNTRIES=${ok.join(',')}`)
})()
