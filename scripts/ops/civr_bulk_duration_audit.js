// Read-only: recent Bulk IVR campaigns and their lead durations (who / how long / why).
const db = db.getSiblingDB('test')
const since = new Date(Date.now() - 4 * 86400000)
db.bulkCallCampaigns.find({ createdAt: { $gte: since } }).sort({ createdAt: -1 }).limit(15).forEach(c => {
  const leads = c.leads || []
  const long = leads.filter(l => (l.duration || 0) > 60)
  print(JSON.stringify({
    id: c.id, chatId: c.chatId, at: c.createdAt, status: c.status, audioName: c.audioName, mode: c.mode, menu: !!c.menu,
    vm: c.voicemailAudioName || null, provider: c.provider, total: leads.length, stats: c.stats,
    durations: leads.filter(l => l.duration).map(l => l.duration).sort((a, b) => b - a).slice(0, 12),
    long: long.slice(0, 6).map(l => ({ st: l.status, d: l.duration, key: l.digitPressed, tr: l.transferred, trc: l.transferConnected, vm: l.voicemail || l.voicemailLeft || l.answeredBy || null, cause: l.hangupCause })),
  }))
})
