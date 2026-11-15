// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Test Suite: PhoneScheduler grace-period fast-path + Voice call.speak.started
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const fs = require('fs')
const path = require('path')

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed++
    console.log(`✅ ${message}`)
  } else {
    failed++
    console.error(`❌ ${message}`)
  }
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('PhoneScheduler grace-period fast-path + Voice call.speak.started')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// [A] STATIC-SOURCE CHECKS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

console.log('[A] STATIC-SOURCE CHECKS\n')

// [A.1] phone-scheduler.js — grace-period fast-path
console.log('[A.1] /app/js/phone-scheduler.js — grace-period fast-path\n')

const phoneSchedulerPath = path.join(__dirname, '..', 'phone-scheduler.js')
const phoneSchedulerCode = fs.readFileSync(phoneSchedulerPath, 'utf8')
const lines = phoneSchedulerCode.split('\n')

// Find the "Expired — attempt auto-renew" block
let expiredBlockStart = -1
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('// ── Expired — attempt auto-renew')) {
    expiredBlockStart = i
    break
  }
}

assert(expiredBlockStart > 0, 'Found "// ── Expired — attempt auto-renew" comment')

// Check that the grace-period fast-path block exists BEFORE attemptAutoRenew
let graceBlockStart = -1
let graceBlockEnd = -1
let attemptAutoRenewLine = -1

for (let i = expiredBlockStart; i < Math.min(expiredBlockStart + 100, lines.length); i++) {
  if (lines[i].includes('// ━━━ Grace-period fast-path')) {
    graceBlockStart = i
  }
  if (graceBlockStart > 0 && graceBlockEnd === -1 && lines[i].trim() === '}') {
    // Find the closing brace of the try/catch
    if (lines[i-1].includes('fall through') || lines[i-2].includes('fall through')) {
      graceBlockEnd = i
    }
  }
  if (lines[i].includes('const result = await attemptAutoRenew(')) {
    attemptAutoRenewLine = i
    break
  }
}

assert(graceBlockStart > 0, 'Found grace-period fast-path comment block')
assert(graceBlockEnd > 0, 'Found grace-period fast-path closing brace')
assert(attemptAutoRenewLine > 0, 'Found attemptAutoRenew call')
assert(graceBlockStart < attemptAutoRenewLine, 'Grace-period block is BEFORE attemptAutoRenew call')

// Check for key elements in the grace-period block
const graceBlock = lines.slice(graceBlockStart, graceBlockEnd + 1).join('\n')

assert(graceBlock.includes('num._graceUntil'), 'Grace block references num._graceUntil')
assert(graceBlock.includes('getBalance(_walletOf, chatId)'), 'Grace block calls getBalance')
assert(graceBlock.includes('Number(num.planPrice)'), 'Grace block uses Number(num.planPrice)')
assert(graceBlock.includes('usdBal < needed'), 'Grace block compares usdBal < needed')
assert(graceBlock.includes('continue'), 'Grace block has continue statement')
assert(graceBlock.includes('try {') && graceBlock.includes('catch'), 'Grace block wrapped in try/catch')

// Check that the block is inside if (num.autoRenew)
let autoRenewIfLine = -1
for (let i = expiredBlockStart; i < graceBlockStart; i++) {
  if (lines[i].includes('if (num.autoRenew !== false)')) {
    autoRenewIfLine = i
    break
  }
}

assert(autoRenewIfLine > 0 && autoRenewIfLine < graceBlockStart, 'Grace block is inside if (num.autoRenew) block')

console.log('\n[A.2] /app/js/voice-service.js — call.speak.started case\n')

const voiceServicePath = path.join(__dirname, '..', 'voice-service.js')
const voiceServiceCode = fs.readFileSync(voiceServicePath, 'utf8')
const voiceLines = voiceServiceCode.split('\n')

// Find the call.speak.started case
let speakStartedLine = -1
let playbackStartedLine = -1
let dtmfReceivedLine = -1
let breakLine = -1
let defaultLine = -1

for (let i = 0; i < voiceLines.length; i++) {
  if (voiceLines[i].includes("case 'call.playback.started':")) {
    playbackStartedLine = i
  }
  if (voiceLines[i].includes("case 'call.speak.started':")) {
    speakStartedLine = i
  }
  if (voiceLines[i].includes("case 'call.dtmf.received':")) {
    dtmfReceivedLine = i
  }
  if (speakStartedLine > 0 && voiceLines[i].trim() === 'break' && breakLine === -1) {
    breakLine = i
  }
  if (voiceLines[i].includes('default:') && voiceLines[i+1].includes('Unhandled event')) {
    defaultLine = i
  }
}

assert(speakStartedLine > 0, "Found case 'call.speak.started':")
assert(playbackStartedLine > 0, "Found case 'call.playback.started':")
assert(dtmfReceivedLine > 0, "Found case 'call.dtmf.received':")
assert(breakLine > 0, 'Found break statement after speak.started')
assert(defaultLine > 0, 'Found default: branch with Unhandled event log')

// Check that speak.started is adjacent to playback.started
assert(Math.abs(speakStartedLine - playbackStartedLine) <= 2, 'call.speak.started is adjacent to call.playback.started')
assert(Math.abs(speakStartedLine - dtmfReceivedLine) <= 2, 'call.speak.started is adjacent to call.dtmf.received')
assert(breakLine > speakStartedLine && breakLine < speakStartedLine + 10, 'break is within 10 lines after speak.started')

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// [D] REGRESSION SANITY (from previous fix)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

console.log('\n[D] REGRESSION SANITY (from previous DynoPay NaN fix)\n')

// [D.1] db.js atomicIncrement() — non-finite guard
console.log('[D.1] /app/js/db.js atomicIncrement() — non-finite guard\n')

const dbPath = path.join(__dirname, '..', 'db.js')
const dbCode = fs.readFileSync(dbPath, 'utf8')

assert(dbCode.includes('atomicIncrement'), 'db.js has atomicIncrement function')
assert(dbCode.includes('typeof amount !== \'number\' || !Number.isFinite(amount)'), 'atomicIncrement has non-finite guard')
assert(dbCode.includes('REFUSING non-finite amount'), 'atomicIncrement logs refusal message')
assert(dbCode.includes('return false'), 'atomicIncrement returns false on non-finite')

// Check that the guard is at the top of the function (before walletOf fork)
const atomicIncrementMatch = dbCode.match(/const atomicIncrement = async \(c, key, field, amount\) => \{([\s\S]*?)^}/m)
if (atomicIncrementMatch) {
  const funcBody = atomicIncrementMatch[1]
  const guardIndex = funcBody.indexOf('typeof amount !== \'number\'')
  const walletOfIndex = funcBody.indexOf('if (c.collectionName === \'walletOf\'')
  assert(guardIndex > 0 && guardIndex < walletOfIndex, 'Non-finite guard is BEFORE walletOf fork')
}

// [D.2] pay-blockbee.js convert() — returns null on error
console.log('\n[D.2] /app/js/pay-blockbee.js convert() — returns null on error\n')

const blockbeePath = path.join(__dirname, '..', 'pay-blockbee.js')
const blockbeeCode = fs.readFileSync(blockbeePath, 'utf8')

assert(blockbeeCode.includes('const convert = async'), 'pay-blockbee.js has convert function')
assert(blockbeeCode.includes('return null') && blockbeeCode.match(/return null/g).length >= 2, 'convert() has at least 2 "return null" statements')
assert(blockbeeCode.includes('!Number.isFinite(result)'), 'convert() has non-finite guard')
assert(blockbeeCode.includes('catch (error)'), 'convert() has catch block')

// Check that catch block returns null (simpler check - just verify it's there)
const catchBlockHasReturn = blockbeeCode.includes('catch (error)') && 
                            blockbeeCode.indexOf('return null', blockbeeCode.indexOf('catch (error)')) > 0
assert(catchBlockHasReturn, 'convert() catch block returns null')

// [D.3] _index.js addFundsTo() — refuses non-finite
console.log('\n[D.3] /app/js/_index.js addFundsTo() — refuses non-finite\n')

const indexPath = path.join(__dirname, '..', '_index.js')
const indexCode = fs.readFileSync(indexPath, 'utf8')

// Check for addFundsTo (it's defined as const addFundsTo = async)
assert(indexCode.includes('addFundsTo') && indexCode.includes('const addFundsTo = async'), '_index.js has addFundsTo function')
assert(indexCode.includes('REFUSING non-finite valueIn'), 'addFundsTo logs refusal message')

// Check for the guards (simpler check)
const addFundsToIndex = indexCode.indexOf('const addFundsTo = async')
const nextFunctionIndex = indexCode.indexOf('\nconst ', addFundsToIndex + 100)
const funcBody = indexCode.substring(addFundsToIndex, nextFunctionIndex > 0 ? nextFunctionIndex : addFundsToIndex + 5000)

assert(funcBody.includes('typeof valueIn') && funcBody.includes('Number.isFinite'), 'addFundsTo has non-finite guard')
assert(funcBody.includes('valueIn <= 0'), 'addFundsTo has non-positive guard')

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SUMMARY
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('TEST SUMMARY')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log(`📊 Total:  ${passed + failed}\n`)

if (failed === 0) {
  console.log('🎉 All tests passed!\n')
  process.exit(0)
} else {
  console.log('⚠️  Some tests failed. Review the output above.\n')
  process.exit(1)
}
