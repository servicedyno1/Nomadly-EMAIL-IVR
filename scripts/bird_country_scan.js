// Read-only scan: which Bird countries/number types sell voice numbers with no ownership paperwork.
// Run: cd /app && node scripts/bird_country_scan.js
const b = require('../js/bird')
const C = 'US CA MX BR AR CL CO PE GB IE FR DE NL BE LU ES PT IT AT CH DK SE NO FI PL CZ SK HU RO BG GR HR SI EE LV LT IS MT CY TR IL ZA NG KE GH EG MA AE SA AU NZ JP KR SG HK TW MY TH PH ID IN VN PK PR DO CR PA GT SV JM UA RS GE'.split(' ')
const T = ['local', 'mobile', 'toll_free', 'national']
;(async () => {
  const out = []
  for (const c of C) for (const t of T) {
    try {
      const r = (await b.http().get(`/numbers/available?country_code=${c}&number_type=${t}&capabilities=voice&limit=50`)).data.data || []
      if (!r.length) continue
      const free = r.filter(x => !x.ownership_registration_required)
      const p = (free[0] || r[0]).pricing?.recurring_price
      out.push({ c, t, total: r.length, free: free.length, price: p ? `${p.amount} ${p.currency_code}` : '?', sms: (free[0] || r[0]).capabilities?.includes('sms') })
    } catch (e) { if (e.response?.status === 429) { await new Promise(r => setTimeout(r, 3000)) } }
    await new Promise(r => setTimeout(r, 150))
  }
  console.log('NO PAPERWORK:'); out.filter(x => x.free).forEach(x => console.log(` ${x.c} ${x.t} ${x.free}/${x.total} ${x.price}/mo sms:${x.sms}`))
  console.log('PAPERWORK NEEDED:'); out.filter(x => !x.free).forEach(x => console.log(` ${x.c} ${x.t} ${x.total} ${x.price}/mo`))
})()
