/* global describe, test, expect, beforeEach, afterEach, jest */
/**
 * active-slot: during a blue/green deploy both PM2 slots are alive; only the one nginx routes
 * to may run singleton work (crons, renewals, reconcilers). Everything else fails OPEN.
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')

const ENV_KEYS = ['ACTIVE_SLOT_UPSTREAMS_FILE', 'ACTIVE_SLOT_NAME', 'name', 'PORT']
const saved = {}
let upstreamsFile

function load({ name, port, upstreams }) {
  jest.resetModules()
  if (upstreams != null) fs.writeFileSync(upstreamsFile, upstreams)
  process.env.ACTIVE_SLOT_UPSTREAMS_FILE = upstreamsFile
  if (name == null) delete process.env.ACTIVE_SLOT_NAME; else process.env.ACTIVE_SLOT_NAME = name
  if (port == null) delete process.env.PORT; else process.env.PORT = String(port)
  return require('../js/active-slot')
}

const UPSTREAMS = 'upstream app_main { server 127.0.0.1:5000; }\nupstream app_wl { server 127.0.0.1:5101; }\n'

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  upstreamsFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'as-')), 'nomadly-upstreams.conf')
})
afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
  try { fs.rmSync(path.dirname(upstreamsFile), { recursive: true, force: true }) } catch (_) {}
})

describe('isActiveSlot — who is the writer', () => {
  test('slot that nginx routes to is active', () => {
    const as = load({ name: 'app-main-a', port: 5000, upstreams: UPSTREAMS })
    expect(as.isActiveSlot()).toBe(true)
    expect(as.describe()).toEqual({ name: 'app-main-a', upstream: 'app_main', port: '5000', active: true })
  })
  test('standby slot (other port) is NOT active', () => {
    const as = load({ name: 'app-main-b', port: 5100, upstreams: UPSTREAMS })
    expect(as.isActiveSlot()).toBe(false)
  })
  test('each app is judged against its OWN upstream line', () => {
    expect(load({ name: 'app-wl-b', port: 5101, upstreams: UPSTREAMS }).isActiveSlot()).toBe(true)
    expect(load({ name: 'app-wl-a', port: 5001, upstreams: UPSTREAMS }).isActiveSlot()).toBe(false)
  })
  test('nginx flip is observed live (no caching)', () => {
    const as = load({ name: 'app-main-b', port: 5100, upstreams: UPSTREAMS })
    expect(as.isActiveSlot()).toBe(false)
    fs.writeFileSync(upstreamsFile, UPSTREAMS.replace(':5000', ':5100'))
    expect(as.isActiveSlot()).toBe(true)
  })
  test('fails OPEN: not a slot name / no PORT / no upstream file / app missing from file', () => {
    expect(load({ name: '', port: 5000, upstreams: UPSTREAMS }).isActiveSlot()).toBe(true)
    expect(load({ name: 'app-main-a', port: null, upstreams: UPSTREAMS }).isActiveSlot()).toBe(true)
    const noFile = load({ name: 'app-main-b', port: 5100 }); fs.rmSync(upstreamsFile, { force: true })
    expect(noFile.isActiveSlot()).toBe(true)
    expect(load({ name: 'app-other-b', port: 5300, upstreams: UPSTREAMS }).isActiveSlot()).toBe(true)
  })
})

describe('singleton / singletonInterval', () => {
  test('runs the callback (with args + this) on the active slot', async () => {
    const as = load({ name: 'app-main-a', port: 5000, upstreams: UPSTREAMS })
    const calls = []
    const wrapped = as.singleton('renewals', function (a, b) { calls.push([this && this.tag, a, b]); return 'ran' })
    expect(wrapped.call({ tag: 't' }, 1, 2)).toBe('ran')
    expect(calls).toEqual([['t', 1, 2]])
  })
  test('skips the callback on the standby slot', () => {
    const as = load({ name: 'app-main-b', port: 5100, upstreams: UPSTREAMS })
    const fn = jest.fn(() => 'ran')
    expect(as.singleton('renewals', fn)()).toBeUndefined()
    expect(fn).not.toHaveBeenCalled()
  })
  test('singletonInterval is a drop-in for setInterval', () => {
    jest.useFakeTimers()
    try {
      const as = load({ name: 'app-main-b', port: 5100, upstreams: UPSTREAMS })
      const fn = jest.fn()
      const h = as.singletonInterval('tick', fn, 1000)
      jest.advanceTimersByTime(3500)
      expect(fn).not.toHaveBeenCalled()           // standby → skipped
      fs.writeFileSync(upstreamsFile, UPSTREAMS.replace(':5000', ':5100')) // flip → becomes active
      jest.advanceTimersByTime(2000)
      expect(fn).toHaveBeenCalledTimes(2)
      clearInterval(h)
    } finally { jest.useRealTimers() }
  })
})

describe('patchNodeSchedule — every cron becomes singleton', () => {
  function fakeSchedule() {
    const jobs = []
    return { jobs, scheduleJob: (...a) => { jobs.push(a); return { cancel() {} } } }
  }
  test('(spec, fn) and (name, spec, fn) signatures are wrapped; non-function args pass through', () => {
    const as = load({ name: 'app-main-b', port: 5100, upstreams: UPSTREAMS })
    const sched = fakeSchedule()
    as.patchNodeSchedule(sched)
    const f1 = jest.fn(), f2 = jest.fn()
    sched.scheduleJob('*/5 * * * *', f1)
    sched.scheduleJob('vps-renewals', '*/5 * * * *', f2)
    sched.scheduleJob('*/5 * * * *', 'not-a-function')
    expect(sched.jobs).toHaveLength(3)
    // standby: wrapped fns do not call through
    sched.jobs[0][1](new Date()); sched.jobs[1][2](new Date())
    expect(f1).not.toHaveBeenCalled(); expect(f2).not.toHaveBeenCalled()
    // become active → fireDate is passed through to the original
    fs.writeFileSync(upstreamsFile, UPSTREAMS.replace(':5000', ':5100'))
    const d = new Date()
    sched.jobs[0][1](d); sched.jobs[1][2](d)
    expect(f1).toHaveBeenCalledWith(d); expect(f2).toHaveBeenCalledWith(d)
    expect(sched.jobs[2][1]).toBe('not-a-function')
  })
  test('idempotent — patching twice does not double-wrap', () => {
    const as = load({ name: 'app-main-a', port: 5000, upstreams: UPSTREAMS })
    const sched = fakeSchedule()
    as.patchNodeSchedule(sched); const once = sched.scheduleJob
    as.patchNodeSchedule(sched)
    expect(sched.scheduleJob).toBe(once)
  })
  test('the REAL node-schedule module is patched by _index.js wiring (static check)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', '_index.js'), 'utf8')
    expect(src).toMatch(/const schedule = require\('node-schedule'\)\s*\n[^\n]*patchNodeSchedule\(schedule\)/)
  })
})
