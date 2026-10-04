/* global describe, test, expect */
/**
 * Runs the standalone regression scripts in tests/scripts/ under Jest.
 *
 * Those files are plain `node tests/scripts/<name>.test.js` harnesses (they print ✅/❌ and
 * end with process.exit(code)). Jest's testMatch is `tests/*.test.js` (single level), so they
 * are NOT collected directly — loading them in-process would hit process.exit. Each is spawned
 * as a child process and its exit code is the assertion.
 */
'use strict'
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const DIR = path.join(__dirname, 'scripts')
const SCRIPTS = fs.readdirSync(DIR).filter(f => f.endsWith('.test.js')).sort()
const TIMEOUT_MS = 120_000

describe('standalone regression scripts (tests/scripts/*.test.js)', () => {
  test('directory has scripts', () => expect(SCRIPTS.length).toBeGreaterThan(0))

  test.each(SCRIPTS)('node tests/scripts/%s exits 0', (file) => {
    const env = { ...process.env }
    delete env.JEST_WORKER_ID
    const r = spawnSync(process.execPath, [path.join(DIR, file)], {
      cwd: path.join(__dirname, '..'), encoding: 'utf8', env, timeout: TIMEOUT_MS,
    })
    if (r.status !== 0) {
      // Surface the harness output only on failure to keep the Jest log readable.
      console.log(`--- ${file} stdout ---\n${r.stdout}\n--- stderr ---\n${r.stderr}`)
    }
    expect(r.error).toBeUndefined()
    expect(r.status).toBe(0)
  }, TIMEOUT_MS + 5_000)
})
