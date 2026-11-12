// Bulk IVR maintenance gate + US/CA-only number search. Run: cd /app && node js/tests/test_bulk_maintenance_uscaonly.js
process.env.BULK_IVR_MAINTENANCE = undefined; delete process.env.BULK_IVR_MAINTENANCE
process.env.NUMBER_SEARCH_US_CA_ONLY = undefined; delete process.env.NUMBER_SEARCH_US_CA_ONLY
const pc = require('/app/js/phone-config')
let pass = 0, fail = 0
const ok = (n, c) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${n}`) }

;(async () => {
  ok('maintenance ON by default', pc.bulkIvrMaintenance() === true)
  ok('US/CA-only ON by default', pc.numberSearchUsCaOnly() === true)
  ok('country picker = US + CA only', pc.allCountries.map(c => c.code).join(',') === 'US,CA')
  ok('no "more countries"', pc.moreCountries.length === 0)
  ok('maintenance message localized (fr)', /maintenance/i.test(pc.bulkMaintenanceMsg('fr')))

  const bcs = require('/app/js/bulk-call-service')
  const c1 = await bcs.createCampaign({ chatId: '1', leads: [{ number: '+15551112222' }], callerId: '+12074892004' })
  ok('createCampaign blocked in maintenance', c1.maintenance === true && c1.error === 'maintenance')
  const c2 = await bcs.createSeries({ chatId: '1', leads: Array(600).fill({ number: '+15551112222' }), callerId: '+12074892004' })
  ok('createSeries blocked in maintenance', c2.maintenance === true)

  // Env override lifts both
  process.env.BULK_IVR_MAINTENANCE = 'false'
  process.env.NUMBER_SEARCH_US_CA_ONLY = 'false'
  ok('env can lift maintenance', pc.bulkIvrMaintenance() === false)
  ok('env can lift US/CA restriction', pc.numberSearchUsCaOnly() === false)
  // allCountries is computed at load; re-require fresh module to confirm the lift expands it
  delete require.cache[require.resolve('/app/js/phone-config')]
  const pc2 = require('/app/js/phone-config')
  ok('lifting restriction expands country list', pc2.allCountries.length > 2)

  console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
})().catch(e => { console.log('ERR', e.stack); process.exit(1) })
