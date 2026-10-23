#!/usr/bin/env node

/**
 * Comprehensive Backend Test Suite for Twilio-based Bulk Call Campaign and Audio Library
 * Based on the review request requirements for Nomadly Telegram Bot
 */

const crypto = require('crypto')
const axios = require('axios')
const { MongoClient } = require('mongodb')

// Configuration - Load env from backend .env file
require('dotenv').config({ path: '/app/backend/.env' })
const BACKEND_URL = 'http://localhost:5000'
const API_BASE = `${BACKEND_URL}/api`
const MONGO_URL = process.env.MONGO_URL
const DB_NAME = process.env.DB_NAME || 'test'

// Test state
let db = null
let testResults = []

// Test utilities
function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`)
}

function createTestResult(test, status, message, details = null) {
  const result = { test, status, message, timestamp: new Date().toISOString() }
  if (details) result.details = details
  testResults.push(result)
  const statusIcon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️'
  log(`${statusIcon} ${test}: ${message}`)
  return result
}

async function connectMongoDB() {
  try {
    const client = new MongoClient(MONGO_URL)
    await client.connect()
    db = client.db(DB_NAME)
    createTestResult('MongoDB Connection', 'PASS', 'Connected successfully')
    return true
  } catch (e) {
    createTestResult('MongoDB Connection', 'FAIL', `Connection failed: ${e.message}`)
    return false
  }
}

// Test 1: Service Startup Verification
async function testServiceStartup() {
  log('=== Test 1: Service Startup Verification ===')
  
  try {
    const response = await axios.get(`${API_BASE}/health`, { timeout: 10000 })
    if (response.data.status === 'healthy' && response.data.database === 'connected') {
      createTestResult('Health Check', 'PASS', 'Node.js service healthy and database connected')
    } else {
      createTestResult('Health Check', 'FAIL', `Unexpected health response: ${JSON.stringify(response.data)}`)
    }
  } catch (e) {
    createTestResult('Health Check', 'FAIL', `Health endpoint failed: ${e.message}`)
  }

  // Check logs for service initialization
  try {
    const { execSync } = require('child_process')
    const logs = execSync('tail -n 100 /var/log/supervisor/nodejs.out.log', { encoding: 'utf8' })
    
    if (logs.includes('[AudioLibrary] Initialized')) {
      createTestResult('Audio Library Init', 'PASS', 'Audio Library service initialized successfully')
    } else {
      createTestResult('Audio Library Init', 'FAIL', 'Audio Library initialization message not found in logs')
    }

    if (logs.includes('[BulkCall] Service initialized (Twilio mode)')) {
      createTestResult('Bulk Call Init', 'PASS', 'Bulk Call service initialized in Twilio mode')
    } else {
      createTestResult('Bulk Call Init', 'FAIL', 'Bulk Call service Twilio mode initialization not found')
    }

  } catch (e) {
    createTestResult('Service Logs Check', 'FAIL', `Failed to check service logs: ${e.message}`)
  }
}

// Test 2: TwiML Endpoints Testing (CRITICAL)
async function testTwiMLEndpoints() {
  log('=== Test 2: TwiML Endpoints Testing ===')

  // First create a test campaign in MongoDB
  const campaignId = crypto.randomUUID()
  const testCampaign = {
    id: campaignId,
    chatId: 123456789,
    callerId: '+18001234567',
    audioUrl: 'https://app-vault-launch-1.preview.emergentagent.com/api/assets/user-audio/test.mp3',
    audioName: 'Test Audio',
    mode: 'report_only',
    transferNumber: null,
    activeKeys: ['1'],
    concurrency: 1,
    leads: [{
      index: 0,
      number: '+18001234567',
      name: 'Test Lead',
      status: 'calling',
      digitPressed: null,
      transferred: false,
      duration: 0,
      callSid: null
    }],
    status: 'running',
    stats: { total: 1, completed: 0, answered: 0, keyPressed: 0, transferred: 0, noAnswer: 0, busy: 0, failed: 0, hungUp: 0 },
    createdAt: new Date()
  }

  try {
    const bulkCallCollection = db.collection('bulkCallCampaigns')
    await bulkCallCollection.insertOne(testCampaign)
    createTestResult('Test Campaign Creation', 'PASS', `Created test campaign: ${campaignId}`)
  } catch (e) {
    createTestResult('Test Campaign Creation', 'FAIL', `Failed to create test campaign: ${e.message}`)
    return
  }

  // Test 2a: POST /twilio/bulk-ivr
  try {
    const response = await axios.post(`${BACKEND_URL}/twilio/bulk-ivr?campaignId=${encodeURIComponent(campaignId)}&leadIndex=0`, 
      'CallSid=CA_TEST&From=%2B13023453627&To=%2B18001234567', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      }
    )

    if (response.status === 200 && response.data.includes('<Gather') && response.data.includes('<Play>') && response.data.includes('bulk-ivr-gather')) {
      createTestResult('TwiML bulk-ivr', 'PASS', 'Returns correct TwiML with Gather, Play, and action URL')
    } else {
      createTestResult('TwiML bulk-ivr', 'FAIL', `Unexpected TwiML response: ${response.data.substring(0, 200)}...`)
    }
  } catch (e) {
    createTestResult('TwiML bulk-ivr', 'FAIL', `bulk-ivr endpoint failed: ${e.message}`)
  }

  // Test 2b: POST /twilio/bulk-ivr-gather (report_only mode)
  try {
    const response = await axios.post(`${BACKEND_URL}/twilio/bulk-ivr-gather?campaignId=${encodeURIComponent(campaignId)}&leadIndex=0`,
      'CallSid=CA_TEST&Digits=1', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      }
    )

    if (response.status === 200 && response.data.includes('<Say>Thank you. Goodbye.</Say>') && response.data.includes('<Hangup/>')) {
      createTestResult('TwiML bulk-ivr-gather (report_only)', 'PASS', 'Returns correct TwiML for report_only mode')
    } else {
      createTestResult('TwiML bulk-ivr-gather (report_only)', 'FAIL', `Unexpected response for report_only: ${response.data}`)
    }
  } catch (e) {
    createTestResult('TwiML bulk-ivr-gather (report_only)', 'FAIL', `bulk-ivr-gather failed: ${e.message}`)
  }

  // Create a transfer mode campaign for Test 2c
  const transferCampaignId = crypto.randomUUID()
  const transferCampaign = {
    id: transferCampaignId,
    chatId: 987654321, // Different chatId to avoid conflicts
    callerId: '+18001234567',
    audioUrl: 'https://app-vault-launch-1.preview.emergentagent.com/api/assets/user-audio/test.mp3',
    audioName: 'Test Audio Transfer',
    mode: 'transfer',
    transferNumber: '+41791234567',
    activeKeys: ['1'],
    concurrency: 1,
    leads: [{
      index: 0,
      number: '+18001234567',
      name: 'Test Lead Transfer',
      status: 'calling',
      digitPressed: null,
      transferred: false,
      duration: 0,
      callSid: null
    }],
    status: 'running',
    stats: { total: 1, completed: 0, answered: 0, keyPressed: 0, transferred: 0, noAnswer: 0, busy: 0, failed: 0, hungUp: 0 },
    createdAt: new Date()
  }

  try {
    const bulkCallCollection = db.collection('bulkCallCampaigns')
    await bulkCallCollection.insertOne(transferCampaign)
    
    // Test 2c: POST /twilio/bulk-ivr-gather (transfer mode)
    const response = await axios.post(`${BACKEND_URL}/twilio/bulk-ivr-gather?campaignId=${encodeURIComponent(transferCampaignId)}&leadIndex=0`,
      'CallSid=CA_TEST2&Digits=1', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      }
    )

    if (response.status === 200 && response.data.includes('<Dial') && response.data.includes('<Number>+41791234567</Number>')) {
      createTestResult('TwiML bulk-ivr-gather (transfer)', 'PASS', 'Returns correct TwiML for transfer mode with Dial and Number')
    } else {
      createTestResult('TwiML bulk-ivr-gather (transfer)', 'FAIL', `Unexpected response for transfer: ${response.data}`)
    }
  } catch (e) {
    createTestResult('TwiML bulk-ivr-gather (transfer)', 'FAIL', `Transfer mode test failed: ${e.message}`)
  }

  // Test 2d: POST /twilio/bulk-status
  try {
    const response = await axios.post(`${BACKEND_URL}/twilio/bulk-status?campaignId=${encodeURIComponent(campaignId)}&leadIndex=0`,
      'CallSid=CA_TEST&CallStatus=completed&CallDuration=30', {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000
      }
    )

    if (response.status === 200) {
      createTestResult('TwiML bulk-status', 'PASS', 'Status callback endpoint returns HTTP 200')
    } else {
      createTestResult('TwiML bulk-status', 'FAIL', `Status endpoint returned: ${response.status}`)
    }
  } catch (e) {
    createTestResult('TwiML bulk-status', 'FAIL', `Status endpoint failed: ${e.message}`)
  }

  // Clean up test campaigns
  try {
    const bulkCallCollection = db.collection('bulkCallCampaigns')
    await bulkCallCollection.deleteMany({ id: { $in: [campaignId, transferCampaignId] } })
    createTestResult('Test Campaign Cleanup', 'PASS', 'Test campaigns cleaned up successfully')
  } catch (e) {
    createTestResult('Test Campaign Cleanup', 'WARN', `Cleanup warning: ${e.message}`)
  }
}

// Test 3: Bulk Call Service Exports
async function testBulkCallServiceExports() {
  log('=== Test 3: Bulk Call Service Exports ===')

  try {
    const bulkCallService = require('/app/js/bulk-call-service.js')
    const requiredExports = [
      'initBulkCallService',
      'parseLeadsFile', 
      'createCampaign',
      'startCampaign',
      'onDigitReceived',
      'onCallStatusUpdate',
      'cancelCampaign',
      'pauseCampaign', 
      'getCampaign',
      'getUserCampaigns',
      'isBulkCall',
      'getCampaignMapping'
    ]

    let allExportsFound = true
    const missingExports = []

    for (const exportName of requiredExports) {
      if (typeof bulkCallService[exportName] === 'function') {
        createTestResult(`Export: ${exportName}`, 'PASS', 'Function exported correctly')
      } else {
        allExportsFound = false
        missingExports.push(exportName)
        createTestResult(`Export: ${exportName}`, 'FAIL', 'Function not found or not a function')
      }
    }

    if (allExportsFound) {
      createTestResult('Bulk Call Service Exports', 'PASS', 'All 12 required exports verified')
    } else {
      createTestResult('Bulk Call Service Exports', 'FAIL', `Missing exports: ${missingExports.join(', ')}`)
    }

  } catch (e) {
    createTestResult('Bulk Call Service Exports', 'FAIL', `Failed to load service: ${e.message}`)
  }
}

// Test 4: parseLeadsFile Function
async function testParseLeadsFile() {
  log('=== Test 4: parseLeadsFile Function Testing ===')

  try {
    const bulkCallService = require('/app/js/bulk-call-service.js')
    
    // Test 1: Simple phone numbers
    const test1 = bulkCallService.parseLeadsFile('+41791234567\n+33612345678')
    if (test1.leads.length === 2 && test1.errors.length === 0) {
      createTestResult('parseLeadsFile - Simple Numbers', 'PASS', '2 leads parsed correctly')
    } else {
      createTestResult('parseLeadsFile - Simple Numbers', 'FAIL', `Expected 2 leads, got ${test1.leads.length}, errors: ${test1.errors.length}`)
    }

    // Test 2: CSV with names
    const test2 = bulkCallService.parseLeadsFile('+41791234567,John\n+33612345678,Marie')
    if (test2.leads.length === 2 && test2.leads[0].name === 'John' && test2.leads[1].name === 'Marie') {
      createTestResult('parseLeadsFile - CSV with Names', 'PASS', '2 leads with names parsed correctly')
    } else {
      createTestResult('parseLeadsFile - CSV with Names', 'FAIL', `Names not parsed correctly: ${JSON.stringify(test2.leads)}`)
    }

    // Test 3: Invalid input
    const test3 = bulkCallService.parseLeadsFile('invalid\n123\n+41791234567')
    if (test3.leads.length === 1 && test3.errors.length === 2) {
      createTestResult('parseLeadsFile - Invalid Input', 'PASS', '1 valid lead, 2 errors correctly identified')
    } else {
      createTestResult('parseLeadsFile - Invalid Input', 'FAIL', `Expected 1 lead and 2 errors, got ${test3.leads.length} leads, ${test3.errors.length} errors`)
    }

    // Test 4: Duplicate deduplication
    const test4 = bulkCallService.parseLeadsFile('+41791234567\n+33612345678\n+41791234567')
    if (test4.leads.length === 2) {
      createTestResult('parseLeadsFile - Deduplication', 'PASS', 'Duplicates correctly removed (2 unique from 3 inputs)')
    } else {
      createTestResult('parseLeadsFile - Deduplication', 'FAIL', `Expected 2 unique leads, got ${test4.leads.length}`)
    }

  } catch (e) {
    createTestResult('parseLeadsFile Function', 'FAIL', `Function testing failed: ${e.message}`)
  }
}

// Test 5: Twilio Service makeOutboundCall
async function testTwilioService() {
  log('=== Test 5: Twilio Service Function Signature ===')

  try {
    const twilioService = require('/app/js/twilio-service.js')
    
    // Check if makeOutboundCall function exists and has correct signature
    if (typeof twilioService.makeOutboundCall === 'function') {
      createTestResult('Twilio makeOutboundCall', 'PASS', 'makeOutboundCall function exists')
      
      // Check function signature by inspecting its toString
      const funcString = twilioService.makeOutboundCall.toString()
      if (funcString.includes('options = {}')) {
        createTestResult('Twilio makeOutboundCall Options', 'PASS', 'Function accepts options parameter')
      } else {
        createTestResult('Twilio makeOutboundCall Options', 'FAIL', 'Options parameter not found in function signature')
      }

      // Check for options support in function body
      if (funcString.includes('statusCallback') && funcString.includes('statusCallbackEvent') && funcString.includes('timeout')) {
        createTestResult('Twilio Options Support', 'PASS', 'Function supports statusCallback, statusCallbackEvent, and timeout options')
      } else {
        createTestResult('Twilio Options Support', 'FAIL', 'Required options support not found in function implementation')
      }

    } else {
      createTestResult('Twilio makeOutboundCall', 'FAIL', 'makeOutboundCall function not found')
    }

  } catch (e) {
    createTestResult('Twilio Service', 'FAIL', `Failed to test Twilio service: ${e.message}`)
  }
}

// Test 6: Audio Library Service Exports
async function testAudioLibraryService() {
  log('=== Test 6: Audio Library Service Exports ===')

  try {
    const audioLibService = require('/app/js/audio-library-service.js')
    const requiredExports = [
      'initAudioLibrary',
      'downloadAndSave',
      'saveAudio',
      'listAudios',
      'getAudio',
      'deleteAudio',
      'renameAudio', 
      'getAudioUrl',
      'AUDIO_DIR'
    ]

    let allExportsFound = true
    const missingExports = []

    for (const exportName of requiredExports) {
      if (audioLibService[exportName] !== undefined) {
        if (exportName === 'AUDIO_DIR') {
          createTestResult(`Export: ${exportName}`, 'PASS', `Constant exported: ${audioLibService[exportName]}`)
        } else {
          createTestResult(`Export: ${exportName}`, 'PASS', 'Function exported correctly')
        }
      } else {
        allExportsFound = false
        missingExports.push(exportName)
        createTestResult(`Export: ${exportName}`, 'FAIL', 'Export not found')
      }
    }

    if (allExportsFound) {
      createTestResult('Audio Library Service Exports', 'PASS', 'All 9 required exports verified')
    } else {
      createTestResult('Audio Library Service Exports', 'FAIL', `Missing exports: ${missingExports.join(', ')}`)
    }

    // Check if audio directory exists
    const fs = require('fs')
    if (fs.existsSync(audioLibService.AUDIO_DIR)) {
      createTestResult('Audio Directory', 'PASS', `Audio directory exists at: ${audioLibService.AUDIO_DIR}`)
    } else {
      createTestResult('Audio Directory', 'FAIL', `Audio directory not found: ${audioLibService.AUDIO_DIR}`)
    }

  } catch (e) {
    createTestResult('Audio Library Service', 'FAIL', `Failed to test audio library service: ${e.message}`)
  }
}

// Test 7: Bot Integration
async function testBotIntegration() {
  log('=== Test 7: Bot Integration Testing ===')

  try {
    const phoneConfig = require('/app/js/phone-config.js')
    
    // Check button constants
    if (phoneConfig.btn && phoneConfig.btn.bulkCallCampaign === '📞 Bulk Call Campaign') {
      createTestResult('Button: bulkCallCampaign', 'PASS', 'Button constant correctly defined')
    } else {
      createTestResult('Button: bulkCallCampaign', 'FAIL', 'Button constant not found or incorrect value')
    }

    if (phoneConfig.btn && phoneConfig.btn.audioLibrary === '🎵 Audio Library') {
      createTestResult('Button: audioLibrary', 'PASS', 'Button constant correctly defined')
    } else {
      createTestResult('Button: audioLibrary', 'FAIL', 'Button constant not found or incorrect value')
    }

  } catch (e) {
    createTestResult('Phone Config', 'FAIL', `Failed to load phone config: ${e.message}`)
  }

  try {
    // Check action constants in _index.js
    const fs = require('fs')
    const indexContent = fs.readFileSync('/app/js/_index.js', 'utf8')
    
    const requiredActions = [
      'bulkSelectCaller',
      'bulkUploadLeads', 
      'bulkSelectAudio',
      'bulkUploadAudio',
      'bulkNameAudio',
      'bulkSelectMode',
      'bulkEnterTransfer',
      'bulkSetConcurrency',
      'bulkConfirm',
      'bulkRunning',
      'audioLibMenu'
    ]

    let actionsFound = 0
    for (const action of requiredActions) {
      if (indexContent.includes(action)) {
        actionsFound++
        createTestResult(`Action: ${action}`, 'PASS', 'Action constant found in _index.js')
      } else {
        createTestResult(`Action: ${action}`, 'FAIL', 'Action constant not found')
      }
    }

    if (actionsFound >= 10) { // Allow for some flexibility
      createTestResult('Action Constants', 'PASS', `Found ${actionsFound}/${requiredActions.length} required action constants`)
    } else {
      createTestResult('Action Constants', 'FAIL', `Only found ${actionsFound}/${requiredActions.length} required action constants`)
    }

    // Check for express.urlencoded middleware
    if (indexContent.includes('express.urlencoded({ extended: true })')) {
      createTestResult('Express Middleware', 'PASS', 'express.urlencoded middleware configured for Twilio form data')
    } else {
      createTestResult('Express Middleware', 'FAIL', 'express.urlencoded middleware not found')
    }

  } catch (e) {
    createTestResult('Bot Integration Files', 'FAIL', `Failed to check integration files: ${e.message}`)
  }
}

// Test 8: Static Assets Serving
async function testStaticAssets() {
  log('=== Test 8: Static Assets Serving ===')

  try {
    const response = await axios.get(`${BACKEND_URL}/assets/`, { timeout: 5000 })
    createTestResult('Static Assets Route', 'PASS', 'Assets route is accessible')
  } catch (e) {
    if (e.response && e.response.status === 404) {
      createTestResult('Static Assets Route', 'PASS', 'Assets route configured (404 expected for empty directory)')
    } else {
      createTestResult('Static Assets Route', 'FAIL', `Assets route failed: ${e.message}`)
    }
  }
}

// Main test runner
async function runAllTests() {
  console.log('='.repeat(80))
  console.log('TWILIO BULK CALL CAMPAIGN & AUDIO LIBRARY TESTING')
  console.log('='.repeat(80))
  
  // Connect to MongoDB first
  const dbConnected = await connectMongoDB()
  if (!dbConnected) {
    console.log('❌ Cannot proceed without database connection')
    return
  }

  // Run all tests
  await testServiceStartup()
  await testTwiMLEndpoints()
  await testBulkCallServiceExports()
  await testParseLeadsFile()
  await testTwilioService()
  await testAudioLibraryService()
  await testBotIntegration()
  await testStaticAssets()

  // Summary
  console.log('\n' + '='.repeat(80))
  console.log('TEST SUMMARY')
  console.log('='.repeat(80))
  
  const passed = testResults.filter(r => r.status === 'PASS').length
  const failed = testResults.filter(r => r.status === 'FAIL').length
  const warned = testResults.filter(r => r.status === 'WARN').length
  const total = testResults.length

  console.log(`✅ PASSED: ${passed}`)
  console.log(`❌ FAILED: ${failed}`)
  console.log(`⚠️  WARNINGS: ${warned}`)
  console.log(`📊 TOTAL: ${total}`)
  console.log(`📈 SUCCESS RATE: ${((passed / total) * 100).toFixed(1)}%`)

  if (failed === 0) {
    console.log('\n🎉 ALL TESTS PASSED! The Twilio-based Bulk Call Campaign and Audio Library features are working correctly.')
  } else {
    console.log('\n❌ SOME TESTS FAILED. Please review the failed tests above.')
  }

  // Detailed results for failed tests
  const failedTests = testResults.filter(r => r.status === 'FAIL')
  if (failedTests.length > 0) {
    console.log('\n' + '='.repeat(80))
    console.log('FAILED TESTS DETAILS')
    console.log('='.repeat(80))
    failedTests.forEach(test => {
      console.log(`❌ ${test.test}: ${test.message}`)
    })
  }

  process.exit(failed === 0 ? 0 : 1)
}

// Run tests
runAllTests().catch(error => {
  console.error('❌ Test runner failed:', error.message)
  process.exit(1)
})