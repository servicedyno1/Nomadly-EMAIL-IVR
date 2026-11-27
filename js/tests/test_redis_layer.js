'use strict'
// Redis layer (js/redis.js, active-slot jobs, Bird lane) against a real Redis, in a throwaway key scope.
// Needs REDIS_URL; run: node js/tests/test_redis_layer.js
const path = require('path')
const { spawn } = require('child_process')
const SCOPE = `ci_redis_${process.pid}`
process.env.DB_NAME = SCOPE
process.env.REDIS_ENABLED = 'true'
if (!process.env.REDIS_URL) { console.log('SKIP: no REDIS_URL'); process.exit(0) }
const R = require('../redis')
let pass = 0, fail = 0
const ok = (c, m) => { c ? pass++ : fail++; console.log(`${c ? '✅' : '❌'} ${m}`) }
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
const ready = async () => { for (let i = 0; i < 50 && !R.client(); i++) await sleep(100); return !!R.client() }
const child = (code) => new Promise((res) => { const p = spawn(process.execPath, ['-e', code], { env: { ...process.env, DB_NAME: SCOPE }, cwd: path.join(__dirname, '..', '..') }); let out = ''; p.stdout.on('data', d => { out += d }); p.on('exit', () => res(out.trim().split('\n').filter(l => !l.startsWith('[Redis]')).pop() || '')) })

;(async () => {
  ok(await ready(), 'connects')
  const lane = `ci:${process.pid}:lane`
  const w = [await R.gate(lane, 400, 700), await R.gate(lane, 400, 700), await R.gate(lane, 400, 700), await R.gate(lane, 400, 700)]
  ok(w[0] === 0 && w[1] > 150 && w[1] <= 400 && w[2] > 300 && w[3] === -1, `lane spaces turns and refuses past maxWait (${w})`)
  const lane2 = `ci:${process.pid}:lane2`
  await R.pushBack(lane2, 2000)
  ok((await R.gate(lane2, 100, 500)) === -1 && (await R.gate(lane2, 100, 5000)) > 1500, 'pushBack holds everyone back')
  const t = []; for (let i = 0; i < 3; i++) t.push(await R.take(`ci:${process.pid}:rate`, 2, 60000))
  ok(t.join() === 'true,true,false', `take allows 2 per window (${t})`)
  ok((await R.once('x', 5000)) === true && (await R.once('x', 5000)) === false, 'once: first caller only')
  await R.forget('x'); ok((await R.once('x', 5000)) === true, 'forget re-arms once')
  const a = await R.lock('l', 5000), b = await R.lock('l', 5000)
  ok(a && b === false, 'lock is exclusive')
  await R.unlock('l', a); ok(!!(await R.lock('l', 5000)), 'unlock frees it')

  // Shared map: another process sees writes live and after a "restart".
  const m = R.sharedMap('ci:searched'); await sleep(300)
  const peer = child(`const R=require('./js/redis');const m=R.sharedMap('ci:searched');setTimeout(()=>{console.log(JSON.stringify(m.get('+15550001')||null));R.close()},3000)`)
  await sleep(2000); m.set('+15550001', { cc: 'US', type: 'toll_free' })
  ok(JSON.parse(await peer)?.type === 'toll_free', 'shared map: live write reaches the other slot')
  const late = await child(`const R=require('./js/redis');const m=R.sharedMap('ci:searched');setTimeout(()=>{console.log(String(m.has('+15550001')));R.close()},1200)`)
  ok(late === 'true', 'shared map: a restarted process reloads it')
  m.delete('+15550001'); await sleep(200)
  ok((await child(`const R=require('./js/redis');const m=R.sharedMap('ci:searched');setTimeout(()=>{console.log(String(m.has('+15550001')));R.close()},1200)`)) === 'false', 'shared map: delete is shared')

  // Jobs: no overlap, heartbeat, wake, stuck detection.
  const S = require('../active-slot')
  let runs = 0, live = 0, maxLive = 0
  const job = async () => { runs++; live++; maxLive = Math.max(maxLive, live); await sleep(250); live-- }
  const timer = S.singletonInterval('ci-job', job, 100)
  await sleep(1100); clearInterval(timer)
  ok(runs >= 2 && maxLive === 1, `job never overlaps itself (${runs} runs, max ${maxLive} at once)`)
  await sleep(400)
  const hb = (await R.jobs())['ci-job']
  ok(hb && hb.running === false && hb.end >= hb.start && hb.every === 100, 'heartbeat recorded')
  let woke = 0
  const t2 = S.singletonInterval('ci-wake', async () => { woke++ }, 3600000)
  await sleep(300); await R.wake('ci-wake'); await sleep(600); clearInterval(t2)
  ok(woke === 1, 'wake runs the job right away')
  await R.beat('ci-stuck', { start: Date.now() - 40 * 60000, every: 60000, running: true })
  const st = await S.stuckJobs()
  ok(st.some(j => j.label === 'ci-stuck') && !st.some(j => j.label === 'ci-job'), 'stuck job detected, healthy one not')
  // node-schedule crons: one run per fire even when two registrations share a label.
  const fake = { scheduleJob: (spec, fn) => fake.fns.push(fn), fns: [] }
  S.patchNodeSchedule(fake); let cron = 0
  fake.scheduleJob('* * * * *', () => { cron++ }); fake.scheduleJob('* * * * *', () => { cron += 10 })
  await fake.fns[0](); await fake.fns[0](); await fake.fns[1]()
  ok(cron === 11, `cron: a duplicate fire is skipped, a different job with the same spec still runs (${cron})`)

  // Bird lane: a full lane means no HTTP call and a quiet null; single lookups use their own allowance first.
  const bird = require('../bird')
  const gateCalls = []
  const realGate = R.gate, realTake = R.take
  R.gate = async (...x) => { gateCalls.push(x); return -1 }
  R.take = async () => false
  process.env.BIRD_API_KEY = process.env.BIRD_API_KEY || 'x'
  const r1 = await bird.lookup('+14155550100', { bulk: true, maxWait: 0 })
  ok(r1 === null && gateCalls.length === 1 && gateCalls[0][2] === 0, 'Bird: full lane → null without calling Bird')
  R.take = async () => true; gateCalls.length = 0
  await bird.lookup('+14155550100').catch(() => {})
  ok(gateCalls.length === 0, 'Bird: single lookup inside its 2/min allowance skips the lane')
  R.gate = realGate; R.take = realTake

  // Off unless REDIS_ENABLED=true.
  ok((await child(`process.env.REDIS_ENABLED='';const R=require('./js/redis');R.once('y',1000).then(v=>{console.log(String(v));R.close()})`)) === 'null', 'disabled without REDIS_ENABLED (fails open)')

  const c = R.client(), keys = await c.keys(`nomadly:${SCOPE}:*`)
  if (keys.length) await c.del(...keys)
  const g = await c.keys(`nomadly:g:*ci:${process.pid}*`); if (g.length) await c.del(...g)
  await R.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
