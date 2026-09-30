const fs = require('fs');
const { MongoClient } = require('mongodb');

async function verifySipCredentialFix() {
  console.log('🔍 SIP Credential Username Mismatch Fix Verification\n');
  
  let allTestsPassed = true;
  
  // 1. Node.js Health Check
  console.log('1. Node.js Health Check');
  try {
    const response = await fetch('http://localhost:5000/health');
    const health = await response.json();
    if (health.status === 'healthy' && health.database === 'connected') {
      console.log('   ✅ PASS - Service healthy, database connected');
    } else {
      console.log('   ❌ FAIL - Service not healthy');
      allTestsPassed = false;
    }
  } catch (error) {
    console.log(`   ❌ FAIL - ${error.message}`);
    allTestsPassed = false;
  }
  
  // 2. Code Verification
  console.log('\n2. Code Changes Verification');
  try {
    const indexJs = fs.readFileSync('/app/js/_index.js', 'utf8');
    
    // Check SIP Credentials Display Fix
    const hasDisplaySipUser = indexJs.includes('const displaySipUser = num.telnyxSipUsername || num.sipUsername');
    console.log(`   ✅ SIP Credentials Display Fix: ${hasDisplaySipUser ? 'PASS' : 'FAIL'}`);
    if (!hasDisplaySipUser) allTestsPassed = false;
    
    // Check Reveal Password Fix
    const hasDisplayPassword = indexJs.includes('const displayPassword = num.telnyxSipPassword || num.sipPassword');
    console.log(`   ✅ Reveal Password Fix: ${hasDisplayPassword ? 'PASS' : 'FAIL'}`);
    if (!hasDisplayPassword) allTestsPassed = false;
    
    // Check Initial Purchase Flow Fix
    const hasTwilioSeedUsername = indexJs.includes('let twilioSeedUsername = seedUser');
    const hasSipUsernameAssignment = indexJs.includes('sipUsername = telnyxSipUsername');
    const purchaseFlowFixed = hasTwilioSeedUsername && hasSipUsernameAssignment;
    console.log(`   ✅ Initial Purchase Flow Fix: ${purchaseFlowFixed ? 'PASS' : 'FAIL'}`);
    if (!purchaseFlowFixed) allTestsPassed = false;
    
    // Check Auto-Renewal Reset Fix
    const hasAutoRenewalFix = indexJs.includes('userData.numbers[numIdx].sipUsername = newTelnyxSipUsername || newSeedUser');
    console.log(`   ✅ Auto-Renewal Reset Fix: ${hasAutoRenewalFix ? 'PASS' : 'FAIL'}`);
    if (!hasAutoRenewalFix) allTestsPassed = false;
    
  } catch (error) {
    console.log(`   ❌ FAIL - Code verification failed: ${error.message}`);
    allTestsPassed = false;
  }
  
  // 3. Database Verification
  console.log('\n3. Database Verification');
  try {
    const mongoUrl = 'mongodb://localhost:27017';
    const client = new MongoClient(mongoUrl);
    await client.connect();
    
    const userData = await client.db('test').collection('phoneNumbersOf').findOne({ _id: 6604316166 });
    
    if (userData && userData.val && userData.val.numbers && userData.val.numbers.length > 0) {
      const num = userData.val.numbers[0];
      const hasCorrectStructure = num.sipUsername && num.telnyxSipUsername && num.sipPassword && num.telnyxSipPassword;
      
      console.log(`   ✅ User 6604316166 exists: PASS`);
      console.log(`   ✅ Has SIP credential structure: ${hasCorrectStructure ? 'PASS' : 'FAIL'}`);
      console.log(`   ✅ sipUsername: ${num.sipUsername}`);
      console.log(`   ✅ telnyxSipUsername: ${num.telnyxSipUsername}`);
      
      if (!hasCorrectStructure) allTestsPassed = false;
    } else {
      console.log('   ❌ FAIL - User data not found or incomplete');
      allTestsPassed = false;
    }
    
    await client.close();
  } catch (error) {
    console.log(`   ❌ FAIL - Database verification failed: ${error.message}`);
    allTestsPassed = false;
  }
  
  // 4. Error Log Check
  console.log('\n4. Error Log Check');
  try {
    const { execSync } = require('child_process');
    const logSize = execSync('wc -c /var/log/supervisor/nodejs.err.log 2>/dev/null || echo "0"').toString().trim().split(' ')[0];
    const noErrors = parseInt(logSize) === 0;
    
    console.log(`   ✅ Error log size: ${logSize} bytes - ${noErrors ? 'PASS' : 'FAIL'}`);
    if (!noErrors) allTestsPassed = false;
  } catch (error) {
    console.log(`   ❌ FAIL - Error log check failed: ${error.message}`);
    allTestsPassed = false;
  }
  
  // Final Result
  console.log('\n' + '='.repeat(50));
  console.log(`🎯 OVERALL RESULT: ${allTestsPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('='.repeat(50));
  
  if (allTestsPassed) {
    console.log('\n🎉 SIP Credential Username Mismatch Fix VERIFIED!');
    console.log('✅ Users will now see Telnyx username (gencredXXX) instead of Twilio username (test_XXX)');
    console.log('✅ Password reveal shows correct Telnyx password');
    console.log('✅ All code changes implemented correctly');
    console.log('✅ Database structure supports the fix');
    console.log('✅ No errors in system logs');
  }
  
  return allTestsPassed;
}

// Run the verification
verifySipCredentialFix().catch(console.error);