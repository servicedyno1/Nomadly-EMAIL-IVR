// Read-only live probe: MultiTEL fax inbox/outbox shape + fax number search (no purchases, no sends)
require('dotenv').config({ path: '/app/backend/.env', quiet: true })
const mt = require('/app/js/multitel/index.js')
const mtFax = require('/app/js/multitel/fax.js')
;(async () => {
  console.log('enabled', mt.enabled(), 'blocked', mt.isBlocked(), 'faxEnabled', mtFax.enabled())
  const d = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  for (const box of ['fax_inbox', 'fax_outbox']) {
    try {
      const r = await mt.api('get', `${box}?limit=3&date_from=${d}`)
      console.log(box, JSON.stringify(r).slice(0, 800))
    } catch (e) { console.log(box, 'ERR', e.message) }
  }
  try { const s = await mtFax.searchFax('US', '212', 5); console.log('search US 212', JSON.stringify(s)) } catch (e) { console.log('search ERR', e.message) }
  try { const s = await mtFax.searchFax('CA', '416', 3); console.log('search CA 416', JSON.stringify(s)) } catch (e) { console.log('search CA ERR', e.message) }
  process.exit(0)
})()
