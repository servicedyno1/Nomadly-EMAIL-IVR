'use strict'
// One-tap top-up keyboard for renewal warnings; the bot's "💵 Deposit $N" handler pre-fills the amount.
const depositAmount = (shortfall) => Math.max(10, Math.ceil(Number(shortfall) || 0))
const depositKeyboard = (shortfall) => ({ keyboard: [[`💵 Deposit $${depositAmount(shortfall)}`], ['🏠 Main Menu']], resize_keyboard: true })
const topUpLine = (shortfall) => `\n\n💵 <b>Top up $${depositAmount(shortfall)}</b> so it renews on time — tap the button below.`

module.exports = { depositAmount, depositKeyboard, topUpLine }
