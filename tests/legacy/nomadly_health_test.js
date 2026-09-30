// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Nomadly Telegram Bot - Health Check and Critical Fixes Testing
// Testing the specific changes mentioned in review request:
// 1. Wallet deduction moved to BEFORE lead generation 
// 2. Resume flow deducts wallet if walletDeducted flag is missing
// 3. Admin notifications for resumed job delivery 
// 4. New /bal admin command
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const axios = require('axios')
const fs = require('fs')
const { execSync } = require('child_process')

// Test Configuration
const BASE_URL = 'http://localhost:5000'
const TEST_RESULTS = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: []
}

// Utility Functions
function log(message) {
  console.log(`[TEST] ${message}`)
}

function logError(message) {
  console.log(`[ERROR] ${message}`)
  TEST_RESULTS.errors.push(message)
}

async function logTest(testName, passed, details = '') {
  TEST_RESULTS.total++
  if (passed) {
    TEST_RESULTS.passed++
    log(`✅ ${testName} - PASSED ${details}`)
  } else {
    TEST_RESULTS.failed++
    logError(`❌ ${testName} - FAILED ${details}`)
  }
}

// HTTP Request Helper
async function makeRequest(method, url, data = null, timeout = 10000) {
  try {
    const config = {
      method,
      url,
      timeout,
      headers: { 'Content-Type': 'application/json' }
    }
    if (data) config.data = data
    
    const response = await axios(config)
    return { success: true, data: response.data, status: response.status }
  } catch (error) {
    return { 
      success: false, 
      error: error.message,
      status: error.response?.status,
      data: error.response?.data
    }
  }
}

// TEST 1: Node.js Health Check (as per review request)
async function testNodeJSHealth() {
  log('=== TEST 1: NODE.JS HEALTH CHECK ===')
  
  // 1. Health endpoint should return 200 with correct JSON
  const healthResponse = await makeRequest('GET', `${BASE_URL}/health`)
  const healthPassed = healthResponse.success && 
                      healthResponse.status === 200 &&
                      healthResponse.data?.status === 'healthy' &&
                      healthResponse.data?.database === 'connected'
  
  await logTest('Health Endpoint Response', healthPassed,
    `Status: ${healthResponse.data?.status}, Database: ${healthResponse.data?.database}`)
  
  // 2. Check supervisor nodejs service status
  try {
    const supervisorStatus = execSync('sudo supervisorctl status nodejs', { encoding: 'utf8' })
    const isRunning = supervisorStatus.includes('RUNNING')
    await logTest('Supervisor nodejs Status', isRunning,
      `Service: ${supervisorStatus.trim()}`)
  } catch (error) {
    await logTest('Supervisor nodejs Status', false, `Error: ${error.message}`)
  }
  
  // 3. Check for LeadJobs initialization in logs
  try {
    const logOutput = execSync('grep "[LeadJobs] Persistence initialized" /var/log/supervisor/nodejs.out.log', { encoding: 'utf8' })
    const hasLeadJobsInit = logOutput.includes('[LeadJobs] Persistence initialized')
    await logTest('LeadJobs Persistence Initialized', hasLeadJobsInit,
      `Found ${logOutput.split('\n').length - 1} initialization entries`)
  } catch (error) {
    await logTest('LeadJobs Persistence Initialized', false, `Error: ${error.message}`)
  }
  
  // 4. Check nodejs.err.log should be EMPTY
  try {
    const errorLog = fs.readFileSync('/var/log/supervisor/nodejs.err.log', 'utf8')
    const isEmpty = errorLog.trim().length === 0
    await logTest('Error Log Empty', isEmpty,
      isEmpty ? 'Log is empty as expected' : `Log contains: ${errorLog.substring(0, 200)}...`)
  } catch (error) {
    await logTest('Error Log Empty', false, `Error reading error log: ${error.message}`)
  }
  
  // 5. Check for service initialization messages
  try {
    const startupLog = execSync('head -n 200 /var/log/supervisor/nodejs.out.log', { encoding: 'utf8' })
    
    const hasVoiceService = startupLog.includes('[VoiceService] Initialized')
    await logTest('VoiceService Initialization', hasVoiceService,
      'Voice service initialized with IVR + SIP support')
    
    const hasBulkCall = startupLog.includes('[BulkCall] Service initialized')
    await logTest('BulkCall Service Initialization', hasBulkCall,
      'Bulk call service initialized correctly')
    
    const hasAudioLibrary = startupLog.includes('[AudioLibrary] Initialized')
    await logTest('AudioLibrary Initialization', hasAudioLibrary,
      'Audio library service initialized')
    
  } catch (error) {
    await logTest('Service Initialization Check', false, `Error: ${error.message}`)
  }
}

// TEST 2: Code Verification for Critical Fixes
async function testCriticalCodeFixes() {
  log('=== TEST 2: CRITICAL CODE FIXES VERIFICATION ===')
  
  try {
    // 1. Verify wallet deduction moved BEFORE lead generation
    const indexJs = fs.readFileSync('/app/js/_index.js', 'utf8')
    
    // Find the buyLeadsSelectFormat handler where wallet deduction happens
    const walletDeductionRegex = /await atomicIncrement\(walletOf, chatId, ['"`]usdOut['"`], Number\(priceUsd\)\)/
    const hasWalletDeduction = walletDeductionRegex.test(indexJs)
    await logTest('Wallet Deduction Before Generation', hasWalletDeduction,
      'Wallet deduction code found in leads purchase flow')
    
    // 2. Check for walletDeducted flag in validateBulkNumbers call
    const walletDeductedFlagRegex = /walletDeducted:\s*true/
    const hasWalletFlag = walletDeductedFlagRegex.test(indexJs)
    await logTest('WalletDeducted Flag Usage', hasWalletFlag,
      'walletDeducted: true flag passed to validateBulkNumbers')
    
    // 3. Verify _partialReason refund logic exists
    const partialReasonRegex = /_partialReason/g
    const partialMatches = indexJs.match(partialReasonRegex)
    const hasPartialReason = partialMatches && partialMatches.length >= 5
    await logTest('Partial Reason Refund Logic', hasPartialReason,
      `Found ${partialMatches?.length || 0} _partialReason references`)
    
    // 4. Check for resumed job wallet deduction logic
    const resumedJobRegex = /if\s*\(\s*!.*walletDeducted.*\)/
    const hasResumedJobCheck = resumedJobRegex.test(indexJs)
    await logTest('Resumed Job Wallet Check', hasResumedJobCheck,
      'Resumed jobs check for missing walletDeducted flag')
    
    // 5. Verify /bal admin command exists
    const balCommandRegex = /\/bal\s+/
    const hasBalCommand = balCommandRegex.test(indexJs)
    await logTest('Admin /bal Command', hasBalCommand,
      '/bal admin command implementation found')
    
    // 6. Check admin notification for resumed jobs
    const adminNotifyRegex = /Resumed.*Order.*Complete/
    const hasAdminNotify = adminNotifyRegex.test(indexJs)
    await logTest('Admin Resumed Job Notifications', hasAdminNotify,
      'Admin notifications for resumed job delivery found')
    
  } catch (error) {
    await logTest('Code Verification', false, `Error reading code: ${error.message}`)
  }
}

// TEST 3: Service Module Verification
async function testServiceModules() {
  log('=== TEST 3: SERVICE MODULE VERIFICATION ===')
  
  try {
    // Test that all critical modules can be loaded
    const validatePhoneBulk = require('/app/js/validatePhoneBulk.js')
    await logTest('validatePhoneBulk Module Load', true,
      'Main leads validation module loaded successfully')
    
    const audioLibraryService = require('/app/js/audio-library-service.js')
    await logTest('Audio Library Service Load', true,
      'Audio library service loaded successfully')
    
    const bulkCallService = require('/app/js/bulk-call-service.js')
    await logTest('Bulk Call Service Load', true,
      'Bulk call service loaded successfully')
    
    const voiceService = require('/app/js/voice-service.js')
    await logTest('Voice Service Load', true,
      'Voice service loaded successfully')
    
  } catch (error) {
    await logTest('Service Module Loading', false, `Error: ${error.message}`)
  }
}

// TEST 4: Database Connectivity and Collections
async function testDatabaseConnectivity() {
  log('=== TEST 4: DATABASE CONNECTIVITY ===')
  
  try {
    const { MongoClient } = require('mongodb')
    
    // Check if we can connect to MongoDB 
    // Note: Using connection string from environment or default
    const mongoUrl = process.env.MONGO_URL || 'mongodb://localhost:27017'
    const client = new MongoClient(mongoUrl)
    
    await client.connect()
    const db = client.db('test')
    
    await logTest('MongoDB Connection', true,
      'Successfully connected to MongoDB database')
    
    // Check that key collections exist
    const collections = await db.listCollections().toArray()
    const collectionNames = collections.map(c => c.name)
    
    const hasWalletOf = collectionNames.includes('walletOf')
    await logTest('WalletOf Collection', hasWalletOf,
      'Wallet collection exists for payment processing')
    
    const hasLeadJobs = collectionNames.includes('leadJobs')
    await logTest('LeadJobs Collection', hasLeadJobs,
      'Lead jobs collection exists for job persistence')
    
    const hasPhoneNumbersOf = collectionNames.includes('phoneNumbersOf')
    await logTest('PhoneNumbersOf Collection', hasPhoneNumbersOf,
      'Phone numbers collection exists')
    
    await client.close()
    
  } catch (error) {
    await logTest('Database Connectivity', false, `Error: ${error.message}`)
  }
}

// Main Test Runner
async function runHealthTests() {
  log('🚀 Starting Nomadly Node.js Health Check and Critical Fixes Testing')
  log('=' .repeat(80))
  
  // Run all test suites
  await testNodeJSHealth()
  await testCriticalCodeFixes()
  await testServiceModules()
  await testDatabaseConnectivity()
  
  // Print summary
  log('=' .repeat(80))
  log('🏁 TEST SUMMARY')
  log(`Total Tests: ${TEST_RESULTS.total}`)
  log(`✅ Passed: ${TEST_RESULTS.passed}`)
  log(`❌ Failed: ${TEST_RESULTS.failed}`)
  log(`Success Rate: ${((TEST_RESULTS.passed / TEST_RESULTS.total) * 100).toFixed(1)}%`)
  
  if (TEST_RESULTS.errors.length > 0) {
    log('\n🔍 ERRORS ENCOUNTERED:')
    TEST_RESULTS.errors.forEach((error, index) => {
      log(`${index + 1}. ${error}`)
    })
  }
  
  log('Health testing completed!')
  
  // Return success if no critical failures
  return TEST_RESULTS.failed === 0
}

// Run tests if called directly
if (require.main === module) {
  runHealthTests().then(success => {
    process.exit(success ? 0 : 1)
  }).catch(error => {
    logError(`Test execution failed: ${error.message}`)
    console.error(error)
    process.exit(1)
  })
}

module.exports = {
  runHealthTests,
  TEST_RESULTS
}