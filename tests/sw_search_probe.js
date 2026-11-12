// Probe: SignalWire search logic directly (uses shell SIGNALWIRE_* env). No purchase.
const rest = require('../js/signalwire/rest')
;(async () => {
  console.log('enabled', rest.enabled())
  const cases = [['CA', 'local', null], ['CA', 'toll_free', null], ['US', 'local', '212'], ['US', 'toll_free', null], ['CA', 'local', '416'], ['US', 'local', null]]
  for (const [cc, t, ac] of cases) {
    const r = await rest.searchNumbers(cc, t, ac, 6)
    console.log(cc, t, ac, r.length, r.map(n => n.phone_number).join(' '), '| fb:', r[0]?._areaFallback, r[0]?._fallbackRegion, '| region:', (r[0]?.region_information || []).map(x => x.region_name).join(','), '| fax:', r[0]?._capabilities?.fax)
  }
  process.exit(0)
})()
