// CloudIVR web Google sign-in: verification, new account, linking to an existing password account (throwaway local DB).
// Run: node js/tests/test_cloudivr_google_signin_2026-10.js
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', 'backend', '.env') })
const axios = require('axios')
const express = require('express')
const bcrypt = require('bcryptjs')
const { MongoClient } = require('mongodb')

const CID = 'test-client.apps.googleusercontent.com'
process.env.GOOGLE_OAUTH_CLIENT_ID = CID
const tokens = {
  newUser: { aud: CID, iss: 'https://accounts.google.com', sub: 'g-111', email: 'New.Person@Gmail.com', email_verified: 'true', name: 'New Person' },
  linkUser: { aud: CID, iss: 'accounts.google.com', sub: 'g-222', email: 'pw.owner@example.com', email_verified: 'true', name: 'PW Owner' },
  wrongAud: { aud: 'someone-else', iss: 'https://accounts.google.com', sub: 'g-333', email: 'x@example.com', email_verified: 'true' },
  unverified: { aud: CID, iss: 'https://accounts.google.com', sub: 'g-444', email: 'y@example.com', email_verified: 'false' },
  badIss: { aud: CID, iss: 'https://evil.example', sub: 'g-555', email: 'z@example.com', email_verified: 'true' },
}
axios.get = async (url, { params }) => {
  if (!url.includes('oauth2.googleapis.com/tokeninfo') || !tokens[params.id_token]) throw new Error('invalid_token')
  return { data: tokens[params.id_token] }
}
const { createAuth } = require('../cloudivr-web/auth')

let pass = 0, fail = 0
const ok = (c, m) => { if (c) { pass++; console.log(`  PASS ${m}`) } else { fail++; console.log(`  FAIL ${m}`) } }

;(async () => {
  const client = await MongoClient.connect(process.env.MONGO_URL)
  const db = client.db(`civr_google_test_${Date.now()}`)
  const server = express().use(express.json())
  const router = express.Router()
  createAuth(db, { log: () => {} }).routes(router, (fn) => (req, res, next) => fn(req, res).catch(next))
  server.use(router)
  const srv = server.listen(0)
  const base = `http://127.0.0.1:${srv.address().port}`
  const post = async (p, body) => { const r = await fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, cookie: r.headers.get('set-cookie') || '', body: await r.json() } }
  try {
    await new Promise(r => setTimeout(r, 300))
    const cfg = await (await fetch(base + '/auth/config')).json()
    ok(cfg.googleClientId === CID, '/auth/config exposes the client id')

    const a = await post('/auth/google', { credential: 'newUser' })
    ok(a.status === 200 && a.body.account.google === true && a.body.account.hasPassword === false, 'new Google user gets an account (no password)')
    ok(a.body.account.email === 'new.person@gmail.com', 'email is normalised to lower case')
    ok(/civr_session=.+HttpOnly/.test(a.cookie), 'session cookie is set (HttpOnly)')
    const a2 = await post('/auth/google', { credential: 'newUser' })
    ok(a2.body.account.id === a.body.account.id, 'second Google sign-in reuses the same account')

    await db.collection('webAccounts').insertOne({ _id: 5000000000009001, email: 'pw.owner@example.com', name: 'PW', passwordHash: await bcrypt.hash('Secret#2026', 4), tokenVersion: 0, createdAt: new Date() })
    const l = await post('/auth/google', { credential: 'linkUser' })
    ok(l.status === 200 && l.body.account.id === '5000000000009001', 'Google email matching a password account signs into THAT account')
    ok(l.body.account.google === true && l.body.account.hasPassword === true, 'linked account keeps its password and shows Google linked')
    const pw = await post('/auth/login', { email: 'pw.owner@example.com', password: 'Secret#2026' })
    ok(pw.status === 200 && pw.body.account.id === '5000000000009001', 'password login still works after linking')
    ok((await db.collection('webAccounts').countDocuments({ email: 'pw.owner@example.com' })) === 1, 'no duplicate account created when linking')

    ok((await post('/auth/google', { credential: 'wrongAud' })).status === 401, 'token for another client id is rejected')
    ok((await post('/auth/google', { credential: 'unverified' })).status === 401, 'unverified Google email is rejected')
    ok((await post('/auth/google', { credential: 'badIss' })).status === 401, 'wrong issuer is rejected')
    ok((await post('/auth/google', { credential: 'garbage' })).status === 401, 'garbage credential is rejected')

    const g = await post('/auth/login', { email: 'new.person@gmail.com', password: 'whatever123' })
    ok(g.status === 401 && /Google/.test(g.body.message), 'password login on a Google-only account explains to use Google')

    delete process.env.GOOGLE_OAUTH_CLIENT_ID
    ok((await post('/auth/google', { credential: 'newUser' })).status === 503, 'Google sign-in off when no client id is set')
  } catch (e) { fail++; console.log('  ERROR', e) } finally {
    srv.close(); await db.dropDatabase(); await client.close()
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  }
})()
