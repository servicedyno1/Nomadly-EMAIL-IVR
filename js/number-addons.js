'use strict'
// Per-country number add-ons (USD/month on top of the plan), set by an admin for costly Infobip / MultiTEL countries.
// appSettings { _id: 'numberAddons', map: { 'CO:local': 10, ... } }, cached in memory.
let map = {}, col = null
async function load() { if (col) map = (await col.findOne({ _id: 'numberAddons' }))?.map || {} ; return map }
function init(db) { col = db.collection('appSettings'); load().catch(() => {}); setInterval(() => load().catch(() => {}), 5 * 60000).unref?.() }
const get = (cc, type) => Math.max(0, Number(map[`${String(cc).toUpperCase()}:${type}`]) || 0)
async function set(cc, type, amount) {
  const k = `${String(cc).toUpperCase()}:${type}`, v = Math.round(Math.max(0, Math.min(500, Number(amount) || 0)) * 100) / 100
  await col.updateOne({ _id: 'numberAddons' }, v ? { $set: { [`map.${k}`]: v, at: new Date() } } : { $unset: { [`map.${k}`]: '' } }, { upsert: true })
  await load()
  return v
}
module.exports = { init, get, set, all: () => ({ ...map }) }
