'use strict'
// A number that was released and bought again sits twice in the account (old released copy + live copy).
// Writes must land on the live copy; only when there is none do they fall back to the plain match.
const liveQuery = (chatId, phone) => ({ _id: chatId, 'val.numbers': { $elemMatch: { phoneNumber: phone, status: { $ne: 'released' } } } })
async function updateLive(col, chatId, phone, update, opts) {
  const r = await col.updateOne(liveQuery(chatId, phone), update, opts)
  return r.matchedCount ? r : col.updateOne({ _id: chatId, 'val.numbers.phoneNumber': phone }, update, opts)
}
module.exports = { liveQuery, updateLive }
