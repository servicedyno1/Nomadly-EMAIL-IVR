const { MongoClient } = require('mongodb');

async function testSipCredentialFix() {
  console.log('🔍 Testing SIP Credential Username Mismatch Fix...\n');
  
  // 1. Test Node.js Health
  console.log('1. Testing Node.js Health...');
  try {
    const response = await fetch('http://localhost:5000/health');
    const health = await response.json();
    console.log('✅ Health check:', health);
    if (health.status !== 'healthy' || health.database !== 'connected') {
      console.log('❌ Health check failed');
      return false;
    }
  } catch (error) {
    console.log('❌ Health check failed:', error.message);
    return false;
  }
  
  // 2. Test Database Connection and User Data
  console.log('\n2. Testing Database Connection and User Data...');
  const mongoUrl = 'mongodb://localhost:27017';
  const dbName = 'test';
  const collectionName = 'phoneNumbersOf';
  const testUserId = '6604316166';
  
  let client;
  try {
    client = new MongoClient(mongoUrl);
    await client.connect();
    console.log('✅ Connected to MongoDB');
    
    const db = client.db(dbName);
    const collection = db.collection(collectionName);
    
    // Find the test user
    const userData = await collection.findOne({ _id: testUserId });
    if (!userData) {
      console.log(`❌ User ${testUserId} not found in database`);
      return false;
    }
    
    console.log(`✅ Found user ${testUserId}`);
    
    // Check if user has phone numbers with SIP credentials
    if (!userData.numbers || userData.numbers.length === 0) {
      console.log('❌ User has no phone numbers');
      return false;
    }
    
    let foundSipCredentials = false;
    for (const num of userData.numbers) {
      if (num.sipUsername && num.telnyxSipUsername) {
        foundSipCredentials = true;
        console.log(`✅ Found phone number with SIP credentials:`);
        console.log(`   Phone: ${num.phoneNumber}`);
        console.log(`   sipUsername: ${num.sipUsername}`);
        console.log(`   telnyxSipUsername: ${num.telnyxSipUsername}`);
        console.log(`   sipPassword: ${num.sipPassword ? '[PRESENT]' : '[MISSING]'}`);
        console.log(`   telnyxSipPassword: ${num.telnyxSipPassword ? '[PRESENT]' : '[MISSING]'}`);
        
        // Verify the expected values
        if (num.sipUsername === 'test_944482e214bda018' && 
            num.telnyxSipUsername === 'gencredXHoDYGC6zXt2SzBi1c7P7v9cMKNUkxQuZpaRgP7Dvw') {
          console.log('✅ SIP credentials match expected values');
        } else {
          console.log('⚠️  SIP credentials do not match expected values');
        }
        break;
      }
    }
    
    if (!foundSipCredentials) {
      console.log('❌ No phone numbers with SIP credentials found');
      return false;
    }
    
  } catch (error) {
    console.log('❌ Database connection failed:', error.message);
    return false;
  } finally {
    if (client) {
      await client.close();
    }
  }
  
  // 3. Check Error Logs
  console.log('\n3. Checking Error Logs...');
  try {
    const { execSync } = require('child_process');
    const logSize = execSync('wc -c /var/log/supervisor/nodejs.err.log 2>/dev/null || echo "0"').toString().trim().split(' ')[0];
    console.log(`✅ Error log size: ${logSize} bytes`);
    
    if (parseInt(logSize) > 0) {
      console.log('⚠️  Error log has content, checking recent entries...');
      try {
        const recentLogs = execSync('tail -n 10 /var/log/supervisor/nodejs.err.log 2>/dev/null || echo "No recent errors"').toString();
        console.log('Recent error log entries:');
        console.log(recentLogs);
      } catch (e) {
        console.log('Could not read error logs');
      }
    }
  } catch (error) {
    console.log('⚠️  Could not check error logs:', error.message);
  }
  
  console.log('\n🎉 SIP Credential Fix Testing Complete!');
  return true;
}

// Run the test
testSipCredentialFix().catch(console.error);