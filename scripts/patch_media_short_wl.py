import sys, shutil, time
# usage: patch_media_short_wl.py <release dir>  — short media links + voicemail greeting through call router
d = sys.argv[1]; ts = time.strftime('%Y%m%dT%H%M%S')
def edit(rel, pairs):
    p = f'{d}/{rel}'; s = open(p).read()
    for old, new in pairs:
        if new in s: continue
        assert s.count(old) == 1, f'{rel}: anchor count {s.count(old)}'
        s = s.replace(old, new)
    shutil.copy(p, f'{p}.bak-media-{ts}'); open(p, 'w').write(s)

edit('js/callengine/index.js', [
  ("const conv = (audioUrl) => `sound:http://127.0.0.1:8090/c.wav?u=${b64u(audioUrl)}`",
   """// Asterisk drops media links over ~250 chars, so long links go through a short app link that redirects.
const shortMedia = new Map()
function shortUrl(url) {
  if (url.length < 120 || !self()) return url
  const id = crypto.createHash('sha1').update(url).digest('hex').slice(0, 20)
  shortMedia.set(id, { url, at: Date.now() })
  for (const [k, v] of shortMedia) if (Date.now() - v.at > 6 * 3600000) shortMedia.delete(k)
  return `${self()}/callengine/m/${id}`
}
const mediaUrl = (id) => shortMedia.get(String(id))?.url || null
const conv = (audioUrl) => `sound:http://127.0.0.1:8090/c.wav?u=${b64u(shortUrl(String(audioUrl)))}`"""),
  ("  activeBird, start, startExternalMedia,", "  mediaUrl, activeBird, start, startExternalMedia,"),
])
edit('js/_index.js', [
  ("app.get('/callengine/recording/:name',",
   "app.get('/callengine/m/:id', (req, res) => {\n  const u = require('./callengine').mediaUrl(req.params.id)\n  return u ? res.redirect(302, u) : res.sendStatus(404)\n})\napp.get('/callengine/recording/:name',"),
])
edit('js/voice-service.js', [
  ("""      const axios = require('axios')
      await axios.post(`https://api.telnyx.com/v2/calls/${callControlId}/actions/playback_start`, { audio_url: audioUrl }, {
        headers: { 'Authorization': `Bearer ${process.env.TELNYX_API_KEY}`, 'Content-Type': 'application/json' },
      })
      return""",
   """      // Through the call router: engine (ae:) calls play on our own engine, Telnyx calls on Telnyx.
      if (!(await _telnyxApi.playbackStart(callControlId, audioUrl))) throw new Error('playback not started')
      return"""),
])
print('patched', d)
