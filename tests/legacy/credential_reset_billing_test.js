// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Nomadly Telegram Bot - Credential Storage Fix + Reset + Bulk IVR Billing Testing
// Based on review request specifications
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const axios = require('axios')
const { MongoClient } = require('mongodb')
const crypto = require('crypto')
require('dotenv').config()

// Test Configuration from review request
const BASE_URL = 'http://localhost:5000'
const DB_URL = 'mongodb://localhost:27017'
const DB_NAME = 'test'

// Test User Context from review request
const TEST_CONTEXT = {
  chatId: 1005284399,
  phoneNumber: '+18669834855',
  twilioSubAccountSid: 'ACc5889c54b04c6505f1509325122fa7f1',
  twilioSubAccountToken: 'ca1565c21e62df769b87ccdb4db89949'
}

// Test Results Storage
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: []
}

// MongoDB Collections
let db = null
let phoneNumbersCol = null
let bulkCallCampaignsCol = null

// Utility Functions
function log(message) {
  console.log(`[CRED-TEST] ${message}`)
}

function logError(message) {
  console.log(`[ERROR] ${message}`)
  testResults.errors.push(message)
}

async function logTest(testName, passed, details = '') {
  testResults.total++
  if (passed) {
    testResults.passed++
    log(`✅ ${testName} - PASSED ${details}`)
  } else {
    testResults.failed++
    logError(`❌ ${testName} - FAILED ${details}`)
  }
}

// HTTP Request Helper
async function makeRequest(method, url, data = null, params = {}) {
  try {
    const config = {
      method,
      url,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    }
    
    if (data) {
      if (url.includes('/twilio/') && method.toUpperCase() === 'POST') {
        // For Twilio webhooks, send as form data
        config.headers['Content-Type'] = 'application/x-www-form-urlencoded'
        config.data = new URLSearchParams(data).toString()
      } else {
        // For other endpoints, send as JSON
        config.data = data
      }
    }
    
    if (Object.keys(params).length > 0) {
      const searchParams = new URLSearchParams(params)
      config.url += '?' + searchParams.toString()
    }
    
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

// MongoDB Connection
async function connectToDatabase() {
  try {
    const client = new MongoClient(DB_URL)
    await client.connect()
    db = client.db(DB_NAME)
    phoneNumbersCol = db.collection('phoneNumbersOf')
    bulkCallCampaignsCol = db.collection('bulkCallCampaigns')
    log('Connected to MongoDB successfully')
    return true
  } catch (error) {
    logError(`MongoDB connection failed: ${error.message}`)
    return false
  }
}

// TEST 1: Verify telnyxSipUsername stored in DB after reset
async function testTelnyxCredentialStorage() {
  log('=== TEST 1: Verify telnyxSipUsername stored in DB after reset ===')
  
  try {
    // Query database for the test user
    const phoneDoc = await phoneNumbersCol.findOne({ _id: TEST_CONTEXT.chatId })
    
    await logTest('User exists in database', phoneDoc !== null, 
      `Found user ${TEST_CONTEXT.chatId}`)
    
    if (!phoneDoc) {
      await logTest('Phone number document structure', false, 'No phone document found')
      return
    }
    
    // Find the specific phone number
    const phoneNumbers = phoneDoc.val?.numbers || []
    const phoneEntry = phoneNumbers.find(n => n.phoneNumber === TEST_CONTEXT.phoneNumber)
    
    await logTest('Phone number entry exists', phoneEntry !== null,
      `Found phone number ${TEST_CONTEXT.phoneNumber}`)
    
    if (!phoneEntry) {
      await logTest('Phone entry structure', false, 'Phone number not found in user numbers')
      return
    }
    
    // Check for all required credential fields
    const requiredFields = ['sipUsername', 'sipPassword', 'telnyxSipUsername', 'telnyxSipPassword', 'telnyxCredentialId']
    const fieldResults = {}
    
    requiredFields.forEach(field => {
      fieldResults[field] = phoneEntry.hasOwnProperty(field) && phoneEntry[field] != null
    })
    
    await logTest('All 5 credential fields exist', 
      Object.values(fieldResults).every(v => v),
      `Fields: ${JSON.stringify(fieldResults)}`)
    
    // Verify telnyxSipUsername starts with 'gencred'
    if (phoneEntry.telnyxSipUsername) {
      await logTest('telnyxSipUsername starts with gencred', 
        phoneEntry.telnyxSipUsername.startsWith('gencred'),
        `Value: ${phoneEntry.telnyxSipUsername}`)
    } else {
      await logTest('telnyxSipUsername starts with gencred', false, 'Field missing')
    }
    
    // Verify sipUsername starts with 'test_'
    if (phoneEntry.sipUsername) {
      await logTest('sipUsername starts with test_', 
        phoneEntry.sipUsername.startsWith('test_'),
        `Value: ${phoneEntry.sipUsername}`)
    } else {
      await logTest('sipUsername starts with test_', false, 'Field missing')
    }
    
    // Verify telnyxCredentialId is UUID format
    if (phoneEntry.telnyxCredentialId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      await logTest('telnyxCredentialId is UUID format', 
        uuidRegex.test(phoneEntry.telnyxCredentialId),
        `Value: ${phoneEntry.telnyxCredentialId}`)
    } else {
      await logTest('telnyxCredentialId is UUID format', false, 'Field missing')
    }
    
    log(`Current credentials in DB:`)
    log(`  sipUsername: ${phoneEntry.sipUsername}`)
    log(`  telnyxSipUsername: ${phoneEntry.telnyxSipUsername}`)
    log(`  telnyxCredentialId: ${phoneEntry.telnyxCredentialId}`)
    
  } catch (error) {
    await logTest('Database credential verification', false, `Error: ${error.message}`)
  }
}

// TEST 2: Credential Reset Endpoint
async function testCredentialResetEndpoint() {
  log('=== TEST 2: Credential Reset Endpoint ===')
  
  try {
    // Store old credential ID for comparison
    const beforeDoc = await phoneNumbersCol.findOne({ _id: TEST_CONTEXT.chatId })
    const beforePhone = beforeDoc?.val?.numbers?.find(n => n.phoneNumber === TEST_CONTEXT.phoneNumber)
    const oldCredentialId = beforePhone?.telnyxCredentialId
    
    // Test credential reset endpoint
    const resetResponse = await makeRequest('POST', `${BASE_URL}/phone/reset-credentials`, {
      chatId: TEST_CONTEXT.chatId,
      phoneNumber: TEST_CONTEXT.phoneNumber
    })
    
    await logTest('Reset credentials endpoint response', 
      resetResponse.success && resetResponse.status === 200,
      `Status: ${resetResponse.status}`)
    
    if (resetResponse.success && resetResponse.data) {
      const data = resetResponse.data
      
      // Verify response structure
      await logTest('Response has success: true', 
        data.success === true,
        `success: ${data.success}`)
      
      await logTest('Response has sipUsername (starts with test_)', 
        data.sipUsername && data.sipUsername.startsWith('test_'),
        `sipUsername: ${data.sipUsername}`)
      
      await logTest('Response has telnyxSipUsername (starts with gencred)', 
        data.telnyxSipUsername && data.telnyxSipUsername.startsWith('gencred'),
        `telnyxSipUsername: ${data.telnyxSipUsername}`)
      
      await logTest('Response has sipDomain: "sip.speechcue.com"', 
        data.sipDomain === 'sip.speechcue.com',
        `sipDomain: ${data.sipDomain}`)
    }
    
    // Wait a moment for DB update
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // Query DB again to verify all credential fields are updated
    const afterDoc = await phoneNumbersCol.findOne({ _id: TEST_CONTEXT.chatId })
    const afterPhone = afterDoc?.val?.numbers?.find(n => n.phoneNumber === TEST_CONTEXT.phoneNumber)
    
    if (afterPhone) {
      const requiredFields = ['sipUsername', 'sipPassword', 'telnyxSipUsername', 'telnyxSipPassword', 'telnyxCredentialId']
      const allUpdated = requiredFields.every(field => 
        afterPhone.hasOwnProperty(field) && afterPhone[field] != null
      )
      
      await logTest('ALL 5 credential fields updated in DB', allUpdated,
        `Updated fields: ${requiredFields.filter(f => afterPhone[f]).join(', ')}`)
      
      // Verify credential ID changed
      if (oldCredentialId && afterPhone.telnyxCredentialId) {
        await logTest('Credential ID changed after reset', 
          oldCredentialId !== afterPhone.telnyxCredentialId,
          `Old: ${oldCredentialId} → New: ${afterPhone.telnyxCredentialId}`)
      } else {
        await logTest('Credential ID changed after reset', false, 
          'Could not compare credential IDs')
      }
    }
    
    // Test error cases
    // Missing chatId
    const errorResponse1 = await makeRequest('POST', `${BASE_URL}/phone/reset-credentials`, {
      phoneNumber: TEST_CONTEXT.phoneNumber
    })
    
    await logTest('Error case - missing chatId returns 400', 
      errorResponse1.status === 400,
      `Status: ${errorResponse1.status}`)
    
    // Wrong phone number
    const errorResponse2 = await makeRequest('POST', `${BASE_URL}/phone/reset-credentials`, {
      chatId: TEST_CONTEXT.chatId,
      phoneNumber: '+19999999999'
    })
    
    await logTest('Error case - wrong number returns 404', 
      errorResponse2.status === 404,
      `Status: ${errorResponse2.status}`)
    
  } catch (error) {
    await logTest('Credential reset endpoint', false, `Error: ${error.message}`)
  }
}

// TEST 3: Voice Webhook uses telnyxSipUsername for SIP routing
async function testVoiceWebhookSipRouting() {
  log('=== TEST 3: Voice Webhook uses telnyxSipUsername for SIP routing ===')
  
  try {
    // Get current telnyxSipUsername from DB
    const phoneDoc = await phoneNumbersCol.findOne({ _id: TEST_CONTEXT.chatId })
    const phoneEntry = phoneDoc?.val?.numbers?.find(n => n.phoneNumber === TEST_CONTEXT.phoneNumber)
    const telnyxSipUsername = phoneEntry?.telnyxSipUsername
    
    log(`Expected telnyxSipUsername from DB: ${telnyxSipUsername}`)
    
    // Call voice webhook endpoint
    const webhookResponse = await makeRequest('POST', `${BASE_URL}/twilio/voice-webhook`, {
      To: TEST_CONTEXT.phoneNumber,
      From: '+12025551234',
      CallSid: 'testSIProuting123'
    })
    
    await logTest('Voice webhook endpoint responds', 
      webhookResponse.success,
      `Status: ${webhookResponse.status}`)
    
    if (webhookResponse.success && typeof webhookResponse.data === 'string') {
      const twimlXml = webhookResponse.data
      log('TwiML Response:')
      log(twimlXml)
      
      // Parse TwiML to verify it contains Sip element
      await logTest('TwiML contains <Sip> element', 
        twimlXml.includes('<Sip>'),
        'Found SIP routing in TwiML')
      
      // Verify the SIP URI contains telnyxSipUsername (NOT sipUsername)
      if (telnyxSipUsername) {
        await logTest('SIP URI contains telnyxSipUsername (starts with gencred)', 
          twimlXml.includes(telnyxSipUsername),
          `Found ${telnyxSipUsername} in TwiML`)
        
        // Verify it does NOT contain the sipUsername (starts with test_)
        const sipUsername = phoneEntry?.sipUsername
        if (sipUsername) {
          await logTest('SIP URI does NOT contain sipUsername (test_ prefix)', 
            !twimlXml.includes(sipUsername),
            `sipUsername ${sipUsername} correctly not used`)
        }
        
        // Verify SIP URI format
        const expectedSipUri = `sip:${telnyxSipUsername}@sip.speechcue.com`
        await logTest('SIP URI format is correct', 
          twimlXml.includes(expectedSipUri),
          `Expected: ${expectedSipUri}`)
      } else {
        await logTest('TelnyxSipUsername available for verification', false, 
          'No telnyxSipUsername found in database')
      }
    } else {
      await logTest('Voice webhook returns TwiML', false, 
        `Response type: ${typeof webhookResponse.data}`)
    }
    
  } catch (error) {
    await logTest('Voice webhook SIP routing', false, `Error: ${error.message}`)
  }
}

// TEST 4: SIP Ring Fallback still works
async function testSipRingFallback() {
  log('=== TEST 4: SIP Ring Fallback still works ===')
  
  try {
    const sipRingResponse = await makeRequest('POST', `${BASE_URL}/twilio/sip-ring-result`, {
      DialCallStatus: 'no-answer',
      DialCallDuration: '0'
    }, {
      chatId: TEST_CONTEXT.chatId,
      from: encodeURIComponent('+12025551234'),
      to: encodeURIComponent(TEST_CONTEXT.phoneNumber)
    })
    
    await logTest('SIP ring result endpoint responds', 
      sipRingResponse.success && sipRingResponse.status === 200,
      `Status: ${sipRingResponse.status}`)
    
    if (sipRingResponse.success && typeof sipRingResponse.data === 'string') {
      await logTest('SIP ring result returns TwiML', 
        sipRingResponse.data.includes('<Response>'),
        'Valid TwiML response for fallback')
    }
    
  } catch (error) {
    await logTest('SIP ring fallback', false, `Error: ${error.message}`)
  }
}

// TEST 5: Bulk IVR Billing Integration
async function testBulkIvrBilling() {
  log('=== TEST 5: Bulk IVR Billing Integration ===')
  
  try {
    // Get initial minutesUsed for the phone number
    const beforeDoc = await phoneNumbersCol.findOne({ _id: TEST_CONTEXT.chatId })
    const beforePhone = beforeDoc?.val?.numbers?.find(n => n.phoneNumber === TEST_CONTEXT.phoneNumber)
    const initialMinutesUsed = beforePhone?.minutesUsed || 0
    
    log(`Initial minutesUsed: ${initialMinutesUsed}`)
    
    // Create test campaign in MongoDB
    const testCampaign = {
      id: 'billing-test-campaign',
      chatId: TEST_CONTEXT.chatId,
      callerId: TEST_CONTEXT.phoneNumber,
      audioUrl: 'https://api.twilio.com/cowbell.mp3',
      mode: 'report_only',
      activeKeys: ['1'],
      concurrency: 1,
      leads: [{
        index: 0,
        number: '+12025551234',
        name: 'Billing Test',
        status: 'calling',
        callSid: 'CAtest_billing',
        startedAt: new Date()
      }],
      status: 'running',
      stats: {
        total: 1,
        completed: 0,
        answered: 0,
        keyPressed: 0,
        transferred: 0,
        noAnswer: 0,
        busy: 0,
        failed: 0,
        hungUp: 0
      },
      twilioSubAccountSid: TEST_CONTEXT.twilioSubAccountSid,
      twilioSubAccountToken: TEST_CONTEXT.twilioSubAccountToken
    }
    
    // Insert campaign
    await bulkCallCampaignsCol.insertOne(testCampaign)
    await logTest('Test campaign created in MongoDB', true, 
      `Campaign ID: ${testCampaign.id}`)
    
    // Call bulk status endpoint with billing data
    const bulkStatusResponse = await makeRequest('POST', `${BASE_URL}/twilio/bulk-status`, {
      CallSid: 'CAtest_billing',
      CallStatus: 'completed',
      CallDuration: '120' // 2 minutes
    }, {
      campaignId: 'billing-test-campaign',
      leadIndex: 0
    })
    
    await logTest('Bulk status endpoint responds', 
      bulkStatusResponse.success && bulkStatusResponse.status === 200,
      `Status: ${bulkStatusResponse.status}`)
    
    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    // Check server logs for billing message
    try {
      const { execSync } = require('child_process')
      const logOutput = execSync('tail -n 50 /var/log/supervisor/nodejs.out.log', { encoding: 'utf8' })
      
      const hasBilledMessage = logOutput.includes('[BulkCall] Billed')
      await logTest('Server logs show billing message', hasBilledMessage,
        '[BulkCall] Billed message found in logs')
      
      if (hasBilledMessage) {
        log('Recent billing log entries:')
        const billingLines = logOutput.split('\n').filter(line => line.includes('[BulkCall] Billed'))
        billingLines.forEach(line => log(`  ${line}`))
      }
      
    } catch (error) {
      await logTest('Server logs check', false, `Error reading logs: ${error.message}`)
    }
    
    // Check if minutesUsed increased by 2 (120 seconds = 2 minutes)
    const afterDoc = await phoneNumbersCol.findOne({ _id: TEST_CONTEXT.chatId })
    const afterPhone = afterDoc?.val?.numbers?.find(n => n.phoneNumber === TEST_CONTEXT.phoneNumber)
    const finalMinutesUsed = afterPhone?.minutesUsed || 0
    
    log(`Final minutesUsed: ${finalMinutesUsed}`)
    
    const expectedIncrease = 2 // 120 seconds = 2 minutes
    const actualIncrease = finalMinutesUsed - initialMinutesUsed
    
    await logTest('minutesUsed increased by 2 (120 seconds)', 
      actualIncrease >= expectedIncrease,
      `Increased by ${actualIncrease} minutes (expected: ${expectedIncrease})`)
    
  } catch (error) {
    await logTest('Bulk IVR billing integration', false, `Error: ${error.message}`)
  }
}

// TEST 6: Twilio removeSipCredential module export
async function testTwilioModuleExport() {
  log('=== TEST 6: Twilio removeSipCredential module export ===')
  
  try {
    const twilioService = require('/app/js/twilio-service.js')
    
    await logTest('Twilio service module loads', 
      typeof twilioService === 'object',
      'Module loaded successfully')
    
    await logTest('removeSipCredential function exists', 
      typeof twilioService.removeSipCredential === 'function',
      'Function is exported and is callable')
    
  } catch (error) {
    await logTest('Twilio module export', false, `Error: ${error.message}`)
  }
}

// TEST 7: Telnyx deleteSIPCredential module export
async function testTelnyxModuleExport() {
  log('=== TEST 7: Telnyx deleteSIPCredential module export ===')
  
  try {
    const telnyxService = require('/app/js/telnyx-service.js')
    
    await logTest('Telnyx service module loads', 
      typeof telnyxService === 'object',
      'Module loaded successfully')
    
    await logTest('deleteSIPCredential function exists', 
      typeof telnyxService.deleteSIPCredential === 'function',
      'Function is exported and is callable')
    
  } catch (error) {
    await logTest('Telnyx module export', false, `Error: ${error.message}`)
  }
}

// TEST 8: Telnyx purchase stores telnyxSipUsername
async function testTelnyxPurchaseFlow() {
  log('=== TEST 8: Telnyx purchase stores telnyxSipUsername ===')
  
  try {
    const indexJs = require('fs').readFileSync('/app/js/_index.js', 'utf8')
    
    // Search for telnyxSipUsernameLocal in the purchase flow
    const hasTelnyxSipUsernameLocal = indexJs.includes('telnyxSipUsernameLocal')
    await logTest('Code contains telnyxSipUsernameLocal variable', hasTelnyxSipUsernameLocal,
      'Found reference to telnyxSipUsernameLocal')
    
    // Check if numberDoc includes required fields
    const hasTelnyxSipUsername = indexJs.includes('telnyxSipUsername')
    const hasTelnyxSipPassword = indexJs.includes('telnyxSipPassword')
    const hasTelnyxCredentialId = indexJs.includes('telnyxCredentialId')
    
    await logTest('Code includes telnyxSipUsername field', hasTelnyxSipUsername,
      'Field referenced in code')
    
    await logTest('Code includes telnyxSipPassword field', hasTelnyxSipPassword,
      'Field referenced in code')
    
    await logTest('Code includes telnyxCredentialId field', hasTelnyxCredentialId,
      'Field referenced in code')
    
    // Look for the specific purchase flow pattern
    const telnyxPurchasePattern = /numberDoc.*=.*{[\s\S]*telnyxSipUsername[\s\S]*telnyxSipPassword[\s\S]*telnyxCredentialId/
    const hasPurchaseFlow = telnyxPurchasePattern.test(indexJs)
    
    await logTest('Telnyx purchase flow stores all 3 credential fields', hasPurchaseFlow,
      'Purchase flow includes telnyxSipUsername, telnyxSipPassword, telnyxCredentialId')
    
  } catch (error) {
    await logTest('Telnyx purchase flow verification', false, `Error: ${error.message}`)
  }
}

// Main Test Runner
async function runCredentialTests() {
  log('🚀 Starting Credential Storage Fix + Reset + Bulk IVR Billing Testing')
  log('=' .repeat(80))
  
  // Connect to database
  if (!(await connectToDatabase())) {
    logError('Cannot proceed without database connection')
    return
  }
  
  // Run all tests according to review request
  await testTelnyxCredentialStorage()        // TEST 1
  await testCredentialResetEndpoint()        // TEST 2
  await testVoiceWebhookSipRouting()         // TEST 3
  await testSipRingFallback()                // TEST 4
  await testBulkIvrBilling()                 // TEST 5
  await testTwilioModuleExport()             // TEST 6
  await testTelnyxModuleExport()             // TEST 7
  await testTelnyxPurchaseFlow()             // TEST 8
  
  // Print summary
  log('=' .repeat(80))
  log('🏁 CREDENTIAL TESTING SUMMARY')
  log(`Total Tests: ${testResults.total}`)
  log(`✅ Passed: ${testResults.passed}`)
  log(`❌ Failed: ${testResults.failed}`)
  log(`Success Rate: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`)
  
  if (testResults.errors.length > 0) {
    log('\n🔍 ERRORS ENCOUNTERED:')
    testResults.errors.forEach((error, index) => {
      log(`${index + 1}. ${error}`)
    })
  }
  
  log('Credential testing completed!')
  
  return testResults
}

// Run tests if called directly
if (require.main === module) {
  runCredentialTests().catch(error => {
    logError(`Test execution failed: ${error.message}`)
    console.error(error)
    process.exit(1)
  })
}

module.exports = {
  runCredentialTests,
  testResults
}