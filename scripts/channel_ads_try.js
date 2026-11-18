// Dev check: make one visual per kind without posting. Usage: node scripts/channel_ads_try.js [screen|art|clip] [screenId|clipId]
require('../js/config-setup')
const fs = require('fs')
const studio = require('../js/channel-ads-studio')
;(async () => {
  const kind = process.argv[2] || 'screen', id = process.argv[3]
  const screen = studio.SCREENS.find(s => s.id === id) || studio.SCREENS[0]
  const clip = studio.CLIPS.find(c => c.id === id) || studio.CLIPS[0]
  const t = Date.now()
  const m = await studio.make({ kind, screen, clip, headline: 'Your front desk, now on autopilot', scene: 'a calm dentist receptionist smiling while a glowing phone handles calls' })
  const out = `/tmp/try-${kind}.${m.type === 'video' ? 'mp4' : 'jpg'}`
  fs.copyFileSync(m.file, out); fs.writeFileSync(`/tmp/try-${kind}-thumb.jpg`, m.thumb)
  console.log('RESULT', JSON.stringify({ out, type: m.type, v: m.v, live: m.live, secs: (Date.now() - t) / 1000 }))
  process.exit(0)
})().catch(e => { console.error('FAIL', e); process.exit(1) })
