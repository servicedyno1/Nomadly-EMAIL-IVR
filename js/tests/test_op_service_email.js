/*global require, process, console */
// ============================================================
// Regression: OpenProvider registrant email must be the MONITORED
// gidineter@gmail.com (not the unmonitored cloakhost@tutamail.com), so TLDs
// that require registrant/contact validation (.it, etc.) can be confirmed and
// don't end up orphaned/suspended at the registry.
// (Root cause of @ricodeljalisco's nationalbcverifservicesonetimelink.ch —
//  OpenProvider reported it "not in your account" and it never delegated.)
// ============================================================
require('dotenv').config({ path: '/app/backend/.env' })
const assert = require('assert')
const fs = require('fs')
const op = require('../op-service')

let passed = 0
const ok = (n) => { console.log(`\u2705 ${n}`); passed++ }

// 1. op-service resolves the registrant email from env.
assert.strictEqual(op.SERVICE_EMAIL, 'gidineter@gmail.com', 'op-service SERVICE_EMAIL must be gidineter@gmail.com')
ok('op-service.SERVICE_EMAIL === gidineter@gmail.com (used for OP contact handles)')

// 2. backend/.env carries the new monitored email, not the old one.
const env = fs.readFileSync('/app/backend/.env', 'utf8')
assert.ok(/NOMADLY_SERVICE_EMAIL="?gidineter@gmail\.com"?/.test(env), 'backend/.env must set NOMADLY_SERVICE_EMAIL=gidineter@gmail.com')
assert.ok(!/NOMADLY_SERVICE_EMAIL="?cloakhost@tutamail\.com/.test(env), 'backend/.env must not keep cloakhost@tutamail.com for the OP email')
ok('backend/.env NOMADLY_SERVICE_EMAIL = gidineter@gmail.com (cloakhost removed)')

// 3. Source default is also the new email, and no hardcoded cloakhost remains.
const src = fs.readFileSync(require.resolve('../op-service'), 'utf8')
assert.ok(/'gidineter@gmail\.com'/.test(src), 'op-service.js default must be gidineter@gmail.com')
assert.ok(!/cloakhost@tutamail\.com/.test(src), 'op-service.js must not hardcode cloakhost@tutamail.com anywhere')
ok('op-service.js default = gidineter@gmail.com and no cloakhost literal remains')

console.log(`\n\u2705 ALL ${passed} assertions passed`)
process.exit(0)
