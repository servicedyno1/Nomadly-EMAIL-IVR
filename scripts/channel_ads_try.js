// Dev check: make one visual without posting. Usage: node scripts/channel_ads_try.js [screen|art|clip|demo|series] [id]
require('../js/config-setup')
const fs = require('fs')
const studio = require('../js/channel-ads-studio')
;(async () => {
  const kind = process.argv[2] || 'screen', id = process.argv[3]
  const screen = studio.SCREENS.find(s => s.id === id) || studio.SCREENS[0]
  const clip = studio.CLIPS.find(c => c.id === id) || studio.CLIPS[0]
  const demo = studio.DEMOS.find(c => c.id === id) || studio.DEMOS[0]
  const t = Date.now()
  const m = await studio.make({ kind, screen, clip, demo, headline: 'Your front desk, now on autopilot', scene: 'a calm dentist receptionist smiling while a glowing phone handles calls' })
  const out = `/tmp/try-${kind}.${m.type === 'video' ? 'mp4' : 'jpg'}`
  for (const [i, f] of (m.files || []).entries()) fs.copyFileSync(f, `/tmp/try-${kind}-${i + 1}.jpg`)
  if (m.file) fs.copyFileSync(m.file, out); fs.writeFileSync(`/tmp/try-${kind}-thumb.jpg`, m.thumb)
  console.log('RESULT', JSON.stringify({ out, type: m.type, v: m.v, live: m.live, secs: (Date.now() - t) / 1000 }))
  process.exit(0)
})().catch(e => { console.error('FAIL', e); process.exit(1) })
