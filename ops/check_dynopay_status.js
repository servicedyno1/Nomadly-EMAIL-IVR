'use strict'
// READ-ONLY: ask DynoPay the live status of both pay addresses for this order.
require('dotenv').config({ path: '/app/backend/.env' })
const { getDynopayCryptoPaymentStatus } = require('/app/js/pay-dynopay')
;(async () => {
  const addrs = {
    'TRC20 (30d09e47)': 'TCdxnEjVNnf3SHFW1wgSwv3RqmzjM8Zqtp',
    'ERC20 (9fd5da6a)': '0xe8c0d38210490b7930f94cb3d5867a7850af7bfa',
  }
  for (const [label, addr] of Object.entries(addrs)) {
    try {
      const st = await getDynopayCryptoPaymentStatus(addr)
      console.log(`\n=== ${label} ${addr} ===`)
      console.log(JSON.stringify(st, null, 1))
      if (st && typeof st === 'object') {
        console.log('>> status field:', JSON.stringify(st.status))
        const ok = ['completed','confirmed','settled','paid'].includes(String(st.status||'').toLowerCase())
        console.log('>> passes current allowlist [completed,confirmed,settled,paid]?', ok)
      }
    } catch (e) {
      console.log(`\n=== ${label} ${addr} === ERROR:`, e.message)
    }
  }
  process.exit(0)
})()
