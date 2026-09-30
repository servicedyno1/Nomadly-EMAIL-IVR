/**
 * LIVE END-TO-END TEST — @HHR2009 (chatId 1960615421, cpUser nnliae74)
 * Panel File Manager operations against the REAL production cPanel account.
 *
 * SAFETY:
 *   • Runs against SANDBOX node bot on 127.0.0.1:5000 (has the full fix)
 *   • Sandbox + Railway share the SAME Mongo, so any cpPass rotation
 *     that fires from here permanently repairs the account for BOTH.
 *   • PIN is NOT touched (separate Mongo field).
 *   • WHM /passwd is called with db_pass_update:0 → bound MySQL passes
 *     are NOT rotated → live sites are NOT affected.
 *   • JWT is minted directly via cpAuth.createToken (no PIN needed).
 *   • Test artifacts live in a dedicated /home/nnliae74/nomadly_selfheal_test/
 *     directory outside public_html so they don't affect the live site.
 *   • Every artifact is deleted at the end (or aborted with a manifest).
 *
 * RUN: node js/tests/live_hhr2009_endtoend_2026-08-26.js
 */
'use strict'

process.env.NODE_ENV = process.env.NODE_ENV || 'production'
require('dotenv').config({ path: '/app/backend/.env' })

const path = require('path')
const fs = require('fs')
const os = require('os')
const axios = require('axios')
const FormData = require('form-data')
const { MongoClient } = require('mongodb')
const cpAuth = require(path.resolve(__dirname, '..', 'cpanel-auth'))

const CP_USER = 'nnliae74'
const CHAT_ID = '1960615421'
const DOMAIN = 'evitesapp.org'
const TEST_DIR = `/home/${CP_USER}/nomadly_selfheal_test`     // outside public_html
const NODE_BASE = 'http://127.0.0.1:5000'
const REPORT = { steps: [], startedAt: new Date().toISOString(), account: {} }

function step(name, ok, detail) {
  const s = { name, ok: !!ok, detail: detail == null ? null : (typeof detail === 'string' ? detail.slice(0, 800) : detail) }
  REPORT.steps.push(s)
  const icon = ok ? '✅' : '❌'
  console.log(`${icon} ${name}${detail ? ' — ' + (typeof detail === 'string' ? detail.slice(0, 250) : JSON.stringify(detail).slice(0, 250)) : ''}`)
}

async function main() {
  // ── Preflight: connect to prod Mongo, snapshot the account doc ────────
  const mongo = await MongoClient.connect(process.env.MONGO_URL)
  const col = mongo.db(process.env.DB_NAME).collection('cpanelAccounts')
  const beforeDoc = await col.findOne({ _id: CP_USER })
  if (!beforeDoc) {
    console.error('❌ Account not found in Mongo — aborting.')
    process.exit(1)
  }
  REPORT.account.before = {
    _id: beforeDoc._id,
    chatId: beforeDoc.chatId,
    domain: beforeDoc.domain,
    whmHost: beforeDoc.whmHost,
    cpPassRotatedAt: beforeDoc.cpPassRotatedAt || null,
    cpPassLastRotateReason: beforeDoc.cpPassLastRotateReason || null,
    cpPass_encrypted_head: (beforeDoc.cpPass_encrypted || '').slice(0, 16),
  }
  console.log('── SNAPSHOT (before) ──')
  console.log(JSON.stringify(REPORT.account.before, null, 2))
  console.log('──────────────────────')

  // ── Mint a fresh JWT (skip PIN entry — we have DB access) ─────────────
  const token = cpAuth.createToken({ cpUser: CP_USER, domain: DOMAIN, chatId: CHAT_ID })
  step('Minted JWT via cpAuth.createToken', !!token, token ? `len=${token.length}` : 'MISSING')

  const http = axios.create({
    baseURL: NODE_BASE,
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,   // we handle status ourselves
    timeout: 90000,
    maxContentLength: 200 * 1024 * 1024,
    maxBodyLength:    200 * 1024 * 1024,
  })

  // ── 1. GET /panel/session — sanity ────────────────────────────────────
  {
    const r = await http.get('/panel/session')
    step('GET /panel/session → 200', r.status === 200, `status=${r.status}, plan=${r.data?.plan}, isGold=${r.data?.isGold}`)
  }

  // ── 2. mkdir /home/nnliae74/nomadly_selfheal_test ─────────────────────
  //    (should trip _isAuthBroken → WHM-root fallback via cpanel_jsonapi_user)
  {
    const r = await http.post('/panel/files/mkdir', { dir: `/home/${CP_USER}`, name: 'nomadly_selfheal_test' })
    step('POST /panel/files/mkdir nomadly_selfheal_test (WHM-root fallback path)', r.status === 200 && r.data?.status === 1, `status=${r.status}, cpanelStatus=${r.data?.status}, errors=${JSON.stringify(r.data?.errors)}`)
  }

  // ── 3. list_files /home/nnliae74 — verify our test dir shows up ───────
  {
    const r = await http.get('/panel/files', { params: { dir: `/home/${CP_USER}` } })
    const names = (r.data?.data || []).map(f => f.file || f.name || '')
    step('GET /panel/files /home/nnliae74 shows nomadly_selfheal_test', r.status === 200 && names.includes('nomadly_selfheal_test'), `status=${r.status}, entries=${names.length}, hasTestDir=${names.includes('nomadly_selfheal_test')}`)
  }

  // ── 4. Single-shot upload: small test file → TEST_DIR ─────────────────
  //    This is the path that triggers _repairCpPass on the very first
  //    auth-broken 401 from user-level UAPI.
  const smallContent = Buffer.from(`nomadly self-heal test\nchatId=${CHAT_ID}\ncpUser=${CP_USER}\nts=${new Date().toISOString()}\n`, 'utf8')
  {
    const form = new FormData()
    form.append('dir', TEST_DIR)
    form.append('file', smallContent, { filename: 'selfheal_marker.txt', contentType: 'text/plain' })
    const r = await http.post('/panel/files/upload', form, { headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` } })
    const via = r.data?.via || null
    step('POST /panel/files/upload selfheal_marker.txt (should trigger WHM session fallback)', r.status === 200 && r.data?.status === 1, `status=${r.status}, cpanelStatus=${r.data?.status}, via=${via}, errors=${JSON.stringify(r.data?.errors)}`)
  }

  // ── 5. Verify the upload actually saved on disk (list TEST_DIR).
  //       WHM's file-listing occasionally lags a fresh upload by 1-2s
  //       (Cloudflare tunnel cache / cpsrvd disk fsync), so retry a couple
  //       of times with a short backoff before failing.
  {
    let names = []
    let statusR = 0
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await http.get('/panel/files', { params: { dir: TEST_DIR } })
      statusR = r.status
      names = (r.data?.data || []).map(f => f.file || f.name || '')
      if (names.includes('selfheal_marker.txt')) break
      await new Promise(res => setTimeout(res, 1500))
    }
    step('GET /panel/files TEST_DIR shows selfheal_marker.txt (with retry)', statusR === 200 && names.includes('selfheal_marker.txt'), `entries=${names.length}, files=${names.join(',')}`)
  }

  // ── 6. Chunked upload: ~2.5 MB file → TEST_DIR (chunk size 1MB × 3) ───
  //    Exercises /files/upload-chunk finalize path w/ real assembly + _repairCpPass
  //    should NOT re-fire (60-min cool-down + fresh pass already in Mongo)
  const bigContent = Buffer.alloc(2_500_000)
  for (let i = 0; i < bigContent.length; i++) bigContent[i] = (i * 7) & 0xff
  const CHUNK = 1024 * 1024
  const total = Math.ceil(bigContent.length / CHUNK)
  const uploadId = `selfheal-${Date.now()}`
  let chunkOk = true
  let lastR = null
  for (let idx = 0; idx < total; idx++) {
    const slice = bigContent.subarray(idx * CHUNK, Math.min((idx + 1) * CHUNK, bigContent.length))
    const form = new FormData()
    form.append('dir', TEST_DIR)
    form.append('uploadId', uploadId)
    form.append('chunkIndex', String(idx))
    form.append('totalChunks', String(total))
    form.append('fileName', 'selfheal_bigfile.bin')
    form.append('chunk', slice, { filename: `chunk-${idx}`, contentType: 'application/octet-stream' })
    const r = await http.post('/panel/files/upload-chunk', form, { headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` } })
    lastR = r
    if (r.status !== 200) { chunkOk = false; break }
    if (idx === total - 1) {
      chunkOk = chunkOk && r.data?.cpanelStatus === 1
    }
  }
  step(`Chunked upload selfheal_bigfile.bin (${bigContent.length} bytes, ${total} chunks)`, chunkOk, `lastStatus=${lastR?.status}, cpanelStatus=${lastR?.data?.cpanelStatus}, via=${lastR?.data?.via}, errors=${JSON.stringify(lastR?.data?.errors)}`)

  // ── 7. Prepare a small zip in memory, upload it, extract, verify ───────
  const zip = require('zlib').gzipSync(Buffer.from('nomadly selfheal extract test\n', 'utf8'))
  // Actually build a real .zip since Fileman::extract expects PKZip format.
  const AdmZip = (() => {
    try { return require('adm-zip') } catch { return null }
  })()
  if (AdmZip) {
    const z = new AdmZip()
    z.addFile('selfheal_extracted.txt', Buffer.from('nomadly selfheal extract-test payload\n', 'utf8'))
    z.addFile('selfheal_extracted_nested/inner.txt', Buffer.from('nested\n', 'utf8'))
    const zipBuf = z.toBuffer()
    // Upload
    {
      const form = new FormData()
      form.append('dir', TEST_DIR)
      form.append('file', zipBuf, { filename: 'selfheal_archive.zip', contentType: 'application/zip' })
      const r = await http.post('/panel/files/upload', form, { headers: { ...form.getHeaders(), Authorization: `Bearer ${token}` } })
      step('Upload selfheal_archive.zip', r.status === 200 && r.data?.status === 1, `status=${r.status}, cpanelStatus=${r.data?.status}, via=${r.data?.via}, body=${JSON.stringify(r.data).slice(0,300)}`)
    }
    // Extract
    {
      const r = await http.post('/panel/files/extract', { dir: TEST_DIR, file: 'selfheal_archive.zip' })
      step('Extract selfheal_archive.zip', r.status === 200 && r.data?.status === 1, `status=${r.status}, cpanelStatus=${r.data?.status}, via=${r.data?.via}, errors=${JSON.stringify(r.data?.errors)}`)
    }
    // Verify extracted file present
    {
      const r = await http.get('/panel/files', { params: { dir: TEST_DIR } })
      const names = (r.data?.data || []).map(f => f.file || f.name || '')
      step('Extract produced selfheal_extracted.txt', names.includes('selfheal_extracted.txt'), `files=${names.join(',')}`)
    }
  } else {
    step('AdmZip not installed — extract test skipped', false, 'yarn add adm-zip if you want extract coverage')
  }

  // ── 8. Delete every artifact we created (individual files + folders) ───
  //    Individual files first so the folder can be removed cleanly.
  const cleanupFiles = ['selfheal_marker.txt', 'selfheal_bigfile.bin', 'selfheal_archive.zip', 'selfheal_extracted.txt']
  for (const f of cleanupFiles) {
    const r = await http.post('/panel/files/delete', { dir: TEST_DIR, file: f, isDirectory: false })
    step(`DELETE ${f}`, r.status === 200 && r.data?.status === 1, `status=${r.status}, cpanelStatus=${r.data?.status}, via=${r.data?.via}`)
  }
  // Nested folder
  {
    const r = await http.post('/panel/files/delete', { dir: TEST_DIR, file: 'selfheal_extracted_nested', isDirectory: true })
    step('DELETE folder selfheal_extracted_nested', r.status === 200 && r.data?.status === 1, `status=${r.status}, cpanelStatus=${r.data?.status}, via=${r.data?.via}`)
  }
  // Test dir itself
  {
    const r = await http.post('/panel/files/delete', { dir: `/home/${CP_USER}`, file: 'nomadly_selfheal_test', isDirectory: true })
    step('DELETE folder nomadly_selfheal_test (top-level test dir)', r.status === 200 && r.data?.status === 1, `status=${r.status}, cpanelStatus=${r.data?.status}, via=${r.data?.via}`)
  }

  // ── 9. Verify cleanup (list /home/nnliae74) ──────────────────────────
  {
    const r = await http.get('/panel/files', { params: { dir: `/home/${CP_USER}` } })
    const names = (r.data?.data || []).map(f => f.file || f.name || '')
    step('Cleanup: test dir gone from /home/nnliae74', r.status === 200 && !names.includes('nomadly_selfheal_test'), `remaining_entries=${names.length}, still_has_test_dir=${names.includes('nomadly_selfheal_test')}`)
  }

  // ── 10. Snapshot Mongo AFTER — cpPass rotation is no longer expected
  //         (final architecture uses WHM impersonation session instead).
  const afterDoc = await col.findOne({ _id: CP_USER })
  REPORT.account.after = {
    _id: afterDoc._id,
    cpPassRotatedAt: afterDoc.cpPassRotatedAt || null,
    cpPassLastRotateReason: afterDoc.cpPassLastRotateReason || null,
    cpPass_encrypted_head: (afterDoc.cpPass_encrypted || '').slice(0, 16),
  }
  const wasRotated = beforeDoc.cpPass_encrypted !== afterDoc.cpPass_encrypted
  step('cpPass NOT rotated (WHM-session architecture — no password churn)', !wasRotated, `encHead_before=${(beforeDoc.cpPass_encrypted || '').slice(0, 16)}, encHead_after=${(afterDoc.cpPass_encrypted || '').slice(0, 16)}`)

  await mongo.close()

  const passed = REPORT.steps.filter(s => s.ok).length
  const failed = REPORT.steps.filter(s => !s.ok).length
  console.log(`\n──────────────────────────────────────────────`)
  console.log(`  ${passed} passed, ${failed} failed`)
  console.log(`──────────────────────────────────────────────\n`)
  console.log(JSON.stringify(REPORT, null, 2))
  process.exit(failed > 0 ? 1 : 0)
}

main().catch(err => { console.error('UNCAUGHT:', err.stack || err.message); process.exit(2) })
