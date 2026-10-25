// Unit check of js/safe-url.js (iteration 136)
const s = require('/app/js/safe-url.js')
const blocked = ['https://[::ffff:127.0.0.1]/x', 'https://[::ffff:a9fe:a9fe]/latest', 'https://[::]/x', 'https://100.64.0.1/x',
  'https://localtest.me/x', 'https://127.0.0.1.nip.io/x', 'https://[64:ff9b::7f00:1]/x', 'https://[fd00::1]/x',
  'https://[::ffff:0:7f00:1]/x', 'https://2130706433/x', 'https://0x7f.1/x', 'https://mongodb/x', 'https://metadata.google.internal/x',
  'http://httpbin.org/post', 'https://169.254.169.254/latest', 'https://10.0.0.1/', 'https://[::1]/', 'https://localhost/', 'https://[fe80::1]/']
const allowed = ['https://httpbin.org/post', 'https://8.8.8.8/', 'https://[2606:4700:4700::1111]/', 'https://hooks.zapier.com/hooks/catch/1/abc/']
;(async () => {
  let pass = 0, fail = 0
  for (const u of blocked) { const r = await s.checkUrl(u); if (!r.ok) pass++; else { fail++; console.log('NOT BLOCKED', u, r) } }
  for (const u of allowed) { const r = await s.checkUrl(u); if (r.ok) pass++; else { fail++; console.log('WRONGLY BLOCKED', u, r) } }
  try { s.assertSendable('https://127.0.0.1/x'); fail++; console.log('assertSendable did not throw') } catch (e) { if (e.code === 'EBLOCKED') pass++; else { fail++; console.log('code', e.code) } }
  console.log(`safe-url unit: ${pass} pass, ${fail} fail`)
})()
