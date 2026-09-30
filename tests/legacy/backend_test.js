#!/usr/bin/env node

// Nomadly Telegram Bot Platform Testing Script
// Tests the recent changes as specified in the review request

const { MongoClient } = require('mongodb')
const axios = require('axios')
const fs = require('fs')

// Test configuration
const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017'
const DB_NAME = process.env.DB_NAME || 'test'
const HEALTH_URL = 'http://localhost:5000/health'

console.log('🧪 Starting Nomadly Telegram Bot Platform Tests...\n')

// Test results tracking
let testResults = {
  passed: 0,
  failed: 0,
  details: []
}

function logTest(name, passed, details = '') {
  const status = passed ? '✅ PASS' : '❌ FAIL'
  console.log(`${status}: ${name}${details ? ' - ' + details : ''}`)
  testResults[passed ? 'passed' : 'failed']++
  testResults.details.push({ name, passed, details })
}

async function runTests() {
  console.log('='.repeat(80))
  console.log('1. HEALTH & STABILITY CHECKS')
  console.log('='.repeat(80))

  // Test 1: Health endpoint
  try {
    const response = await axios.get(HEALTH_URL, { timeout: 5000 })
    const isHealthy = response.status === 200 && response.data.status === 'healthy' && response.data.database === 'connected'
    logTest('Health endpoint responds correctly', isHealthy, `Status: ${response.data.status}, DB: ${response.data.database}`)
  } catch (error) {
    logTest('Health endpoint responds correctly', false, `Error: ${error.message}`)
  }

  // Test 2: Node.js error log size
  try {
    const stats = fs.statSync('/var/log/supervisor/nodejs.err.log')
    const isClean = stats.size === 0
    logTest('Node.js error log is 0 bytes', isClean, `Size: ${stats.size} bytes`)
  } catch (error) {
    logTest('Node.js error log is 0 bytes', false, `Error: ${error.message}`)
  }

  console.log('\n' + '='.repeat(80))
  console.log('2. AUTO-PROMO SYSTEM VERIFICATION')
  console.log('='.repeat(80))

  // Test 3: Auto-promo.js syntax check
  try {
    const { execSync } = require('child_process')
    execSync('node -c /app/js/auto-promo.js', { stdio: 'pipe' })
    logTest('auto-promo.js syntax check', true)
  } catch (error) {
    logTest('auto-promo.js syntax check', false, error.message)
  }

  // Test 4: Check PROMO_SEND_RETRIES = 2
  try {
    const autoPromoContent = fs.readFileSync('/app/js/auto-promo.js', 'utf8')
    const hasRetries = autoPromoContent.includes('PROMO_SEND_RETRIES = 2')
    logTest('PROMO_SEND_RETRIES = 2 exists', hasRetries)
  } catch (error) {
    logTest('PROMO_SEND_RETRIES = 2 exists', false, error.message)
  }

  // Test 5: Check DEAD_THRESHOLD = 3
  try {
    const autoPromoContent = fs.readFileSync('/app/js/auto-promo.js', 'utf8')
    const hasThreshold = autoPromoContent.includes('DEAD_THRESHOLD = 3')
    logTest('DEAD_THRESHOLD = 3 exists', hasThreshold)
  } catch (error) {
    logTest('DEAD_THRESHOLD = 3 exists', false, error.message)
  }

  // Test 6: Check PERMANENT_OPTOUT_REASONS only contains 'user_deactivated'
  try {
    const autoPromoContent = fs.readFileSync('/app/js/auto-promo.js', 'utf8')
    const hasCorrectReasons = autoPromoContent.includes("PERMANENT_OPTOUT_REASONS = ['user_deactivated']")
    logTest('PERMANENT_OPTOUT_REASONS only contains user_deactivated', hasCorrectReasons)
  } catch (error) {
    logTest('PERMANENT_OPTOUT_REASONS only contains user_deactivated', false, error.message)
  }

  // Test 7: Check chat_not_found gets 14-day TTL
  try {
    const autoPromoContent = fs.readFileSync('/app/js/auto-promo.js', 'utf8')
    const hasTTL = autoPromoContent.includes("record.reason === 'chat_not_found' ? 14")
    logTest('chat_not_found gets 14-day TTL', hasTTL)
  } catch (error) {
    logTest('chat_not_found gets 14-day TTL', false, error.message)
  }

  // Test 8: Check rate_limited users are not penalized
  try {
    const autoPromoContent = fs.readFileSync('/app/js/auto-promo.js', 'utf8')
    const hasRateLimited = autoPromoContent.includes("return { success: false, error: 'rate_limited', rateLimited: true }")
    logTest('Rate-limited users are not penalized', hasRateLimited)
  } catch (error) {
    logTest('Rate-limited users are not penalized', false, error.message)
  }

  // Test 9: Check resurrection scan scheduling
  try {
    const autoPromoContent = fs.readFileSync('/app/js/auto-promo.js', 'utf8')
    const hasResurrection = autoPromoContent.includes('[AutoPromo] Resurrection scan enabled')
    logTest('Resurrection scan is scheduled', hasResurrection)
  } catch (error) {
    logTest('Resurrection scan is scheduled', false, error.message)
  }

  // Test 10: Check Sunday promo schedule
  try {
    const autoPromoContent = fs.readFileSync('/app/js/auto-promo.js', 'utf8')
    const hasSundayPromo = autoPromoContent.includes('0: [7, 3]') // Sunday has promos now
    logTest('Sunday (day 0) has promos in DAY_SCHEDULE', hasSundayPromo)
  } catch (error) {
    logTest('Sunday (day 0) has promos in DAY_SCHEDULE', false, error.message)
  }

  console.log('\n' + '='.repeat(80))
  console.log('3. CART ABANDONMENT SYSTEM VERIFICATION')
  console.log('='.repeat(80))

  // Test 11: Cart-abandonment.js exists and syntax check
  try {
    const { execSync } = require('child_process')
    execSync('node -c /app/js/cart-abandonment.js', { stdio: 'pipe' })
    logTest('cart-abandonment.js exists and syntax is valid', true)
  } catch (error) {
    logTest('cart-abandonment.js exists and syntax is valid', false, error.message)
  }

  // Test 12: Check PAYMENT_ACTIONS contains key payment states
  try {
    const cartContent = fs.readFileSync('/app/js/cart-abandonment.js', 'utf8')
    const hasPaymentActions = cartContent.includes('domainPay') && 
                             cartContent.includes('virtualCardPay') && 
                             cartContent.includes('cloudPhonePay')
    logTest('PAYMENT_ACTIONS contains key payment states', hasPaymentActions)
  } catch (error) {
    logTest('PAYMENT_ACTIONS contains key payment states', false, error.message)
  }

  // Test 13: Check NUDGE_DELAY_MS = 45 minutes
  try {
    const cartContent = fs.readFileSync('/app/js/cart-abandonment.js', 'utf8')
    const hasCorrectDelay = cartContent.includes('NUDGE_DELAY_MS = 45 * 60 * 1000')
    logTest('NUDGE_DELAY_MS = 45 minutes', hasCorrectDelay)
  } catch (error) {
    logTest('NUDGE_DELAY_MS = 45 minutes', false, error.message)
  }

  // Test 14: Check NUDGE_COOLDOWN_MS = 24h
  try {
    const cartContent = fs.readFileSync('/app/js/cart-abandonment.js', 'utf8')
    const hasCorrectCooldown = cartContent.includes('NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000')
    logTest('NUDGE_COOLDOWN_MS = 24 hours', hasCorrectCooldown)
  } catch (error) {
    logTest('NUDGE_COOLDOWN_MS = 24 hours', false, error.message)
  }

  // Test 15: Check cart abandonment is loaded in _index.js
  try {
    const indexContent = fs.readFileSync('/app/js/_index.js', 'utf8')
    const isLoaded = indexContent.includes('[CartRecovery] Initialized') || indexContent.includes('initCartAbandonment')
    logTest('Cart abandonment is loaded in _index.js', isLoaded)
  } catch (error) {
    logTest('Cart abandonment is loaded in _index.js', false, error.message)
  }

  console.log('\n' + '='.repeat(80))
  console.log('4. NEW USER ONBOARDING VERIFICATION')
  console.log('='.repeat(80))

  // Test 16: Check Quick Start Guide messages exist
  try {
    const indexContent = fs.readFileSync('/app/js/_index.js', 'utf8')
    const hasQuickStart = indexContent.includes('Quick Start Guide')
    logTest('Quick Start Guide messages exist in _index.js', hasQuickStart)
  } catch (error) {
    logTest('Quick Start Guide messages exist in _index.js', false, error.message)
  }

  // Test 17: Check isNewUser flag is set
  try {
    const indexContent = fs.readFileSync('/app/js/_index.js', 'utf8')
    const hasNewUserFlag = indexContent.includes("isNewUser', true")
    logTest('isNewUser flag is set after language selection', hasNewUserFlag)
  } catch (error) {
    logTest('isNewUser flag is set after language selection', false, error.message)
  }

  // Test 18: Check enhanced fallback for new users
  try {
    const indexContent = fs.readFileSync('/app/js/_index.js', 'utf8')
    const hasEnhancedFallback = indexContent.includes('info?.isNewUser')
    logTest('Enhanced fallback for new users exists', hasEnhancedFallback)
  } catch (error) {
    logTest('Enhanced fallback for new users exists', false, error.message)
  }

  // Test 19: _index.js syntax check
  try {
    const { execSync } = require('child_process')
    execSync('node -c /app/js/_index.js', { stdio: 'pipe' })
    logTest('_index.js syntax check', true)
  } catch (error) {
    logTest('_index.js syntax check', false, error.message)
  }

  console.log('\n' + '='.repeat(80))
  console.log('5. SYSTEM INITIALIZATION CHECKS')
  console.log('='.repeat(80))

  // Test 20: Check nodejs.out.log for key system initializations
  try {
    const logContent = fs.readFileSync('/var/log/supervisor/nodejs.out.log', 'utf8')
    const hasAutoPromo = logContent.includes('[AutoPromo]')
    const hasCartRecovery = logContent.includes('[CartRecovery]')
    const hasMarketplace = logContent.includes('Marketplace')
    
    logTest('AutoPromo system initialized', hasAutoPromo)
    logTest('CartRecovery system initialized', hasCartRecovery)
    logTest('Marketplace system initialized', hasMarketplace)
  } catch (error) {
    logTest('System initialization logs check', false, error.message)
  }

  console.log('\n' + '='.repeat(80))
  console.log('6. DATABASE CONNECTIVITY & CLEANUP VERIFICATION')
  console.log('='.repeat(80))

  // Test 21: MongoDB connection and basic queries
  let client
  try {
    client = new MongoClient(MONGO_URL)
    await client.connect()
    const db = client.db(DB_NAME)
    
    // Test basic connectivity
    const collections = await db.listCollections().toArray()
    logTest('MongoDB connection successful', collections.length > 0, `Found ${collections.length} collections`)

    // Test 22: Check promoOptOut collection exists and has data
    try {
      const promoOptOut = db.collection('promoOptOut')
      const count = await promoOptOut.countDocuments()
      const hasData = count > 0
      logTest('promoOptOut collection has data', hasData, `${count} documents`)

      // Test 23: Check for users with optedOut=false (restored users)
      const restoredCount = await promoOptOut.countDocuments({ optedOut: false })
      const hasRestored = restoredCount > 0
      logTest('Users with optedOut=false exist (restored users)', hasRestored, `${restoredCount} restored users`)

      // Test 24: Check for reOptInReason='bug_fix_cleanup_2026_03_26'
      const cleanupCount = await promoOptOut.countDocuments({ reOptInReason: 'bug_fix_cleanup_2026_03_26' })
      const hasCleanupReason = cleanupCount > 0
      logTest('Users with reOptInReason=bug_fix_cleanup_2026_03_26 exist', hasCleanupReason, `${cleanupCount} users`)

    } catch (error) {
      logTest('promoOptOut collection verification', false, error.message)
    }

    // Test 25: Check specific previously active users
    try {
      const promoOptOut = db.collection('promoOptOut')
      const testUsers = ['5370557924', '8092105106']
      let activeUsersRestored = 0
      
      for (const chatId of testUsers) {
        const user = await promoOptOut.findOne({ chatId: parseInt(chatId) })
        if (user && user.optedOut === false) {
          activeUsersRestored++
        }
      }
      
      logTest('Previously active users now have optedOut=false', activeUsersRestored > 0, `${activeUsersRestored}/${testUsers.length} users restored`)
    } catch (error) {
      logTest('Previously active users verification', false, error.message)
    }

  } catch (error) {
    logTest('MongoDB connection', false, error.message)
  } finally {
    if (client) {
      await client.close()
    }
  }

  console.log('\n' + '='.repeat(80))
  console.log('TEST SUMMARY')
  console.log('='.repeat(80))

  const total = testResults.passed + testResults.failed
  const successRate = total > 0 ? ((testResults.passed / total) * 100).toFixed(1) : 0

  console.log(`\n📊 RESULTS: ${testResults.passed}/${total} tests passed (${successRate}% success rate)`)
  
  if (testResults.failed > 0) {
    console.log('\n❌ FAILED TESTS:')
    testResults.details
      .filter(t => !t.passed)
      .forEach(t => console.log(`   • ${t.name}${t.details ? ': ' + t.details : ''}`))
  }

  if (testResults.passed === total) {
    console.log('\n🎉 ALL TESTS PASSED! The Nomadly Telegram Bot platform changes are working correctly.')
  } else {
    console.log(`\n⚠️  ${testResults.failed} test(s) failed. Please review the issues above.`)
  }

  console.log('\n' + '='.repeat(80))
  console.log('CRITICAL VERIFICATION COMPLETE')
  console.log('='.repeat(80))

  return {
    success: testResults.failed === 0,
    passed: testResults.passed,
    failed: testResults.failed,
    total: total,
    successRate: successRate
  }
}

// Run the tests
runTests().then(results => {
  process.exit(results.success ? 0 : 1)
}).catch(error => {
  console.error('❌ Test execution failed:', error.message)
  process.exit(1)
})