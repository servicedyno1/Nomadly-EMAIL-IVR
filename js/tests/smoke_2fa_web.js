const { totpStep, hotp, b32decode } = require('/app/js/cloudivr-web/twofa')
const API = process.argv[2]
let jar = {}
const cookieHdr = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
async function call(path, body, method) {
  const r = await fetch(API + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', Cookie: cookieHdr() }, body: body ? JSON.stringify(body) : undefined })
  for (const c of r.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar[kv.slice(0, i)] = v; else delete jar[kv.slice(0, i)] }
  return [r.status, await r.json().catch(() => ({}))]
}
const code = (s) => hotp(b32decode(s), Math.floor(Date.now() / 30000))
;(async () => {
  const email = `qa.2fa${Date.now()}@example.com`
  console.log('register', (await call('/auth/register', { email, password: 'QaTest#2026x' }))[0])
  const [, setup] = await call('/auth/2fa/setup', { method: 'totp' })
  console.log('setup', !!setup.secret, setup.otpauthUrl?.slice(0, 40))
  console.log('enable bad', (await call('/auth/2fa/enable', { method: 'totp', code: '000000' }))[0])
  const [st, en] = await call('/auth/2fa/enable', { method: 'totp', code: code(setup.secret) })
  console.log('enable', st, en.backupCodes?.length)
  await call('/auth/logout', {})
  jar = {}
  const [, l1] = await call('/auth/login', { email, password: 'QaTest#2026x', remember: true })
  console.log('login → 2fa', l1.twoFactor?.method, !!l1.account, 'cookies', Object.keys(jar))
  console.log('me before verify', (await call('/auth/me'))[0])
  console.log('verify reuse-step', (await call('/auth/2fa/verify', { challenge: l1.twoFactor.challenge, code: code(setup.secret) }))[0], '(400 expected: same step reused)')
  const [vs] = await call('/auth/2fa/verify', { challenge: l1.twoFactor.challenge, code: en.backupCodes[0], remember: true })
  console.log('verify backup', vs, 'cookies', Object.keys(jar))
  console.log('me after', (await call('/auth/me'))[0])
  const trust = jar.civr_trust; await call('/auth/logout', {}); jar = { civr_trust: trust }
  const [, l2] = await call('/auth/login', { email, password: 'QaTest#2026x' })
  console.log('login trusted → direct', !!l2.account, !l2.twoFactor)
  console.log('backup reuse', (await (async () => { jar = {}; const [, l3] = await call('/auth/login', { email, password: 'QaTest#2026x' }); return call('/auth/2fa/verify', { challenge: l3.twoFactor.challenge, code: en.backupCodes[0] }) })())[0], '(400 expected)')
})()
