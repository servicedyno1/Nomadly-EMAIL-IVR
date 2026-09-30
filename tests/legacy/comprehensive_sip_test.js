const fs = require('fs');

async function verifySipCredentialFix() {
  console.log('🔍 Comprehensive SIP Credential Username Mismatch Fix Verification\n');
  
  const results = {
    healthCheck: false,
    sipCredentialsDisplayFix: false,
    revealPasswordFix: false,
    initialPurchaseFlowFix: false,
    autoRenewalResetFix: false,
    databaseVerification: false,
    errorLogCheck: false
  };
  
  // 1. Node.js Health Check
  console.log('1. ✅ Node.js Health Check');
  try {
    const response = await fetch('http://localhost:5000/health');
    const health = await response.json();
    console.log(`   Status: ${health.status}, Database: ${health.database}`);
    results.healthCheck = health.status === 'healthy' && health.database === 'connected';
  } catch (error) {
    console.log(`   ❌ Failed: ${error.message}`);
  }
  
  // 2. SIP Credentials Display Fix (line ~14015)
  console.log('\n2. ✅ SIP Credentials Display Fix (line ~14015)');
  try {
    const indexJs = fs.readFileSync('/app/js/_index.js', 'utf8');
    const lines = indexJs.split('\n');
    
    // Find the line with displaySipUser
    let foundDisplaySipUser = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('const displaySipUser = num.telnyxSipUsername || num.sipUsername')) {
        foundDisplaySipUser = true;
        console.log(`   ✅ Found correct fix at line ${i + 1}: ${lines[i].trim()}`);
        break;
      }
    }
    
    if (!foundDisplaySipUser) {
      console.log('   ❌ displaySipUser fix not found');
    }
    results.sipCredentialsDisplayFix = foundDisplaySipUser;
  } catch (error) {
    console.log(`   ❌ Failed to verify: ${error.message}`);
  }
  
  // 3. Reveal Password Fix (line ~15987)
  console.log('\n3. ✅ Reveal Password Fix (line ~15987)');
  try {
    const indexJs = fs.readFileSync('/app/js/_index.js', 'utf8');
    const lines = indexJs.split('\n');
    
    // Find the line with displayPassword
    let foundDisplayPassword = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('const displayPassword = num.telnyxSipPassword || num.sipPassword')) {
        foundDisplayPassword = true;
        console.log(`   ✅ Found correct fix at line ${i + 1}: ${lines[i].trim()}`);
        break;
      }
    }
    
    if (!foundDisplayPassword) {
      console.log('   ❌ displayPassword fix not found');
    }
    results.revealPasswordFix = foundDisplayPassword;
  } catch (error) {
    console.log(`   ❌ Failed to verify: ${error.message}`);
  }
  
  // 4. Initial Twilio Purchase Flow Fix (around line 655-676)
  console.log('\n4. ✅ Initial Twilio Purchase Flow Fix (around line 655-676)');
  try {
    const indexJs = fs.readFileSync('/app/js/_index.js', 'utf8');
    
    // Check for twilioSeedUsername variable
    const hasTwilioSeedUsername = indexJs.includes('let twilioSeedUsername = seedUser');
    
    // Check for sipUsername assignment to Telnyx
    const hasSipUsernameAssignment = indexJs.includes('sipUsername = telnyxSipUsername');
    const hasSipPasswordAssignment = indexJs.includes('sipPassword = telnyxSipPassword');
    
    // Check for Twilio credential using twilioSeedUsername
    const usesTwilioSeedForCredential = indexJs.includes('twilioSeedUsername, seedPass');
    
    console.log(`   ✅ twilioSeedUsername variable: ${hasTwilioSeedUsername}`);
    console.log(`   ✅ sipUsername = telnyxSipUsername: ${hasSipUsernameAssignment}`);
    console.log(`   ✅ sipPassword = telnyxSipPassword: ${hasSipPasswordAssignment}`);
    console.log(`   ✅ Twilio uses twilioSeedUsername: ${usesTwilioSeedForCredential}`);
    
    results.initialPurchaseFlowFix = hasTwilioSeedUsername && hasSipUsernameAssignment && 
                                    hasSipPasswordAssignment && usesTwilioSeedForCredential;
  } catch (error) {
    console.log(`   ❌ Failed to verify: ${error.message}`);
  }
  
  // 5. Auto-Renewal Reset Fix (around line 21250)
  console.log('\n5. ✅ Auto-Renewal Reset Fix (around line 21250)');
  try {
    const indexJs = fs.readFileSync('/app/js/_index.js', 'utf8');
    
    // Check for the specific lines
    const hasAutoRenewalSipUsername = indexJs.includes('userData.numbers[numIdx].sipUsername = newTelnyxSipUsername || newSeedUser');
    const hasAutoRenewalSipPassword = indexJs.includes('userData.numbers[numIdx].sipPassword = newTelnyxSipPassword || newSeedPass');
    
    console.log(`   ✅ Auto-renewal sipUsername fix: ${hasAutoRenewalSipUsername}`);
    console.log(`   ✅ Auto-renewal sipPassword fix: ${hasAutoRenewalSipPassword}`);
    
    results.autoRenewalResetFix = hasAutoRenewalSipUsername && hasAutoRenewalSipPassword;
  } catch (error) {
    console.log(`   ❌ Failed to verify: ${error.message}`);
  }
  
  // 6. Database Verification
  console.log('\n6. ✅ Database Verification');
  try {
    const { MongoClient } = require('mongodb');
    const mongoUrl = 'mongodb://localhost:27017';
    const client = new MongoClient(mongoUrl);
    await client.connect();
    
    const db = client.db('test');
    const collection = db.collection('phoneNumbersOf');
    const userData = await client.db('test').collection('phoneNumbersOf').findOne({ _id: 6604316166 });
    
    if (userData && userData.val && userData.val.numbers && userData.val.numbers.length > 0) {
      const num = userData.val.numbers[0];
      const hasExpectedSipUsername = num.sipUsername === 'test_944482e214bda018';
      const hasExpectedTelnyxUsername = num.telnyxSipUsername === 'gencredXHoDYGC6zXt2SzBi1c7P7v9cMKNUkxQuZpaRgP7Dvw';
      const hasBothPasswords = num.sipPassword && num.telnyxSipPassword;
      
      console.log(`   ✅ User 6604316166 found: ${!!userData}`);
      console.log(`   ✅ sipUsername (Twilio): ${num.sipUsername}`);
      console.log(`   ✅ telnyxSipUsername (Telnyx): ${num.telnyxSipUsername}`);
      console.log(`   ✅ Both passwords present: ${hasBothPasswords}`);
      
      results.databaseVerification = hasExpectedSipUsername && hasExpectedTelnyxUsername && hasBothPasswords;
    } else {
      console.log('   ❌ User data not found or incomplete');
    }
    
    await client.close();
  } catch (error) {
    console.log(`   ❌ Database verification failed: ${error.message}`);
  }
  
  // 7. Error Log Check
  console.log('\n7. ✅ Error Log Check');
  try {
    const { execSync } = require('child_process');
    const logSize = execSync('wc -c /var/log/supervisor/nodejs.err.log 2>/dev/null || echo "0"').toString().trim().split(' ')[0];
    const hasNoErrors = parseInt(logSize) === 0;
    
    console.log(`   ✅ Error log size: ${logSize} bytes`);
    results.errorLogCheck = hasNoErrors;
  } catch (error) {
    console.log(`   ❌ Failed to check error logs: ${error.message}`);
  }
  
  // Summary
  console.log('\n📊 VERIFICATION SUMMARY:');
  console.log('========================');
  const allPassed = Object.values(results).every(result => result === true);
  
  for (const [test, passed] of Object.entries(results)) {
    console.log(`${passed ? '✅' : '❌'} ${test}: ${passed ? 'PASS' : 'FAIL'}`);
  }
  
  console.log(`\n🎯 Overall Result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  
  if (allPassed) {
    console.log('\n🎉 SIP Credential Username Mismatch Fix is correctly implemented!');
    console.log('   - Display now shows Telnyx username (gencredXXX) instead of Twilio username (test_XXX)');
    console.log('   - Password reveal shows Telnyx password');
    console.log('   - Purchase flow correctly sets Telnyx as primary credentials');
    console.log('   - Auto-renewal preserves Telnyx credentials');
    console.log('   - Database contains expected credential structure');
    console.log('   - No errors in Node.js logs');
  }
  
  return allPassed;
}

// Run the verification
verifySipCredentialFix().catch(console.error);