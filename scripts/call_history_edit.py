B = '/app/'
def rep(p, a, b):
    s = open(B + p).read(); assert a in s, (p, a[:60]); open(B + p, 'w').write(s.replace(a, b, 1))
p = 'js/voice-service.js'
rep(p, """function logEvent(to, from, type, duration, recordingUrl, forwardTo) {
  if (!_phoneLogs) return
  _phoneLogs.insertOne({
    phoneNumber: to,
    from,
    type,
    duration: duration || 0,
    recordingUrl: recordingUrl || null,
    ...(forwardTo ? { forwardTo } : {}),""", """function logEvent(to, from, type, duration, recordingUrl, forwardTo, extra) {
  if (!_phoneLogs) return
  _phoneLogs.insertOne({
    phoneNumber: to,
    from,
    type,
    duration: duration || 0,
    recordingUrl: recordingUrl || null,
    ...(forwardTo ? { forwardTo } : {}),
    ...(extra || {}),""")
rep(p, "    logEvent(from, to, 'outbound_sip', duration)\n", "    logEvent(from, to, 'outbound_sip', duration, null, null, { charge: session.isTestCall ? 0 : Math.round(((billingInfo.overageCharge || 0) + (duration > 0 ? CALL_CONNECTION_FEE : 0)) * 100) / 100, ...(num.mobileLine ? { esim: num.mobileLine } : {}) })\n")
p = 'js/cloudivr-web/messages.js'
rep(p, ": { duration: l.duration || 0 }),", ": { duration: l.duration || 0, ...(l.charge ? { charge: l.charge } : {}) }),")
p = 'frontend/src/cloudivr/pages/messages/Events.js'
rep(p, "<span>{label}{!missed && e.duration ? ` · ${secs(e.duration)}` : ''} · {timeOf(e.at)}</span>", "<span>{label}{!missed && e.duration ? ` · ${secs(e.duration)}` : ''}{e.out && e.charge ? ` · $${e.charge.toFixed(2)}` : ''} · {timeOf(e.at)}</span>")
print('ok')
