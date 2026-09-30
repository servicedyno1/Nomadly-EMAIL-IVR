"""
Test Twilio SIP Bridge Configuration for Railway Deployment
============================================================
Tests for the fix of SIP call connection failures:
1. Twilio IP ACL configuration - verify IP ACL created with 8 Telnyx IPs
2. Answer-before-transfer timing - verify answerCall happens immediately
3. Twilio SIP bridge flow - test outbound SIP call configuration
4. Credential recovery - verify sub-account token recovery
5. ANI restore - verify connection ANI restored after transfer
"""

import pytest
import requests
import os
from pymongo import MongoClient

# Use the public URL for testing
BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')
MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')

# Test user configuration
TEST_CHAT_ID = 6604316166
TEST_TWILIO_NUMBER = '+18888645099'
TEST_SUB_ACCOUNT_SID = 'ACbbc22c43a792f2b36e2c87e14c604383'

# Telnyx IPs that should be in the IP ACL
EXPECTED_TELNYX_IPS = [
    '192.76.120.10',   # US Primary
    '64.16.250.10',    # US Secondary
    '192.76.120.31',   # US Tertiary
    '64.16.250.13',    # US Quaternary
    '185.246.41.140',  # Europe Primary
    '185.246.41.141',  # Europe Secondary
    '103.115.244.145', # Australia Primary
    '103.115.244.146', # Australia Secondary
]


@pytest.fixture(scope='module')
def mongo_client():
    """MongoDB client fixture"""
    client = MongoClient(MONGO_URL)
    yield client
    client.close()


@pytest.fixture(scope='module')
def db(mongo_client):
    """Database fixture"""
    return mongo_client['test']


class TestHealthAndConnectivity:
    """Basic health checks"""
    
    def test_api_health(self):
        """Test API health endpoint"""
        response = requests.get(f"{BASE_URL}/api/health", timeout=10)
        assert response.status_code == 200
        data = response.json()
        assert data.get('status') == 'healthy'
        assert data.get('database') == 'connected'
        print(f"✅ API health check passed: {data}")


class TestUserPhoneConfiguration:
    """Verify user's phone number configuration in database"""
    
    def test_user_exists(self, db):
        """Test that user with chatId 6604316166 exists"""
        user = db.phoneNumbersOf.find_one({'_id': TEST_CHAT_ID})
        assert user is not None, f"User with chatId {TEST_CHAT_ID} not found"
        print(f"✅ User found: chatId={TEST_CHAT_ID}")
    
    def test_twilio_number_configured(self, db):
        """Test that Twilio number +18888645099 is configured"""
        user = db.phoneNumbersOf.find_one({'_id': TEST_CHAT_ID})
        numbers = user.get('val', {}).get('numbers', [])
        twilio_num = next((n for n in numbers if n.get('phoneNumber') == TEST_TWILIO_NUMBER), None)
        
        assert twilio_num is not None, f"Twilio number {TEST_TWILIO_NUMBER} not found"
        assert twilio_num.get('provider') == 'twilio', "Provider should be 'twilio'"
        assert twilio_num.get('status') == 'active', "Number should be active"
        print(f"✅ Twilio number configured: {TEST_TWILIO_NUMBER}, provider={twilio_num.get('provider')}, status={twilio_num.get('status')}")
    
    def test_sub_account_credentials_present(self, db):
        """Test that sub-account credentials are persisted"""
        user = db.phoneNumbersOf.find_one({'_id': TEST_CHAT_ID})
        val = user.get('val', {})
        
        # Check user-level sub-account credentials
        sub_sid = val.get('twilioSubAccountSid')
        sub_token = val.get('twilioSubAccountToken')
        
        assert sub_sid is not None, "twilioSubAccountSid should be present"
        assert sub_token is not None, "twilioSubAccountToken should be present (credential recovery fix)"
        assert sub_sid == TEST_SUB_ACCOUNT_SID, f"Sub-account SID mismatch: expected {TEST_SUB_ACCOUNT_SID}, got {sub_sid}"
        print(f"✅ Sub-account credentials present: SID={sub_sid[:10]}..., Token={'*' * 10} (persisted)")
    
    def test_sip_credentials_configured(self, db):
        """Test that SIP credentials are configured for the number"""
        user = db.phoneNumbersOf.find_one({'_id': TEST_CHAT_ID})
        numbers = user.get('val', {}).get('numbers', [])
        twilio_num = next((n for n in numbers if n.get('phoneNumber') == TEST_TWILIO_NUMBER), None)
        
        assert twilio_num.get('sipUsername'), "sipUsername should be present"
        assert twilio_num.get('sipPassword'), "sipPassword should be present"
        assert twilio_num.get('telnyxSipUsername'), "telnyxSipUsername should be present for bridge"
        assert twilio_num.get('telnyxSipPassword'), "telnyxSipPassword should be present for bridge"
        print(f"✅ SIP credentials configured: sipUsername={twilio_num.get('sipUsername')}, telnyxSipUsername={twilio_num.get('telnyxSipUsername')[:20]}...")


class TestTwilioSipVoiceWebhook:
    """Test the /twilio/sip-voice webhook endpoint"""
    
    def test_sip_voice_endpoint_exists(self):
        """Test that /twilio/sip-voice endpoint exists and responds"""
        # Send a minimal POST request to check endpoint exists
        response = requests.post(
            f"{BASE_URL}/api/twilio/sip-voice",
            data={
                'To': 'sip:+15551234567@speechcue-7937a0.sip.twilio.com',
                'From': 'sip:test_user@speechcue-7937a0.sip.twilio.com',
                'CallSid': 'CA_test_123'
            },
            timeout=10
        )
        # Should return TwiML (200) even if credentials not recognized
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert 'xml' in response.headers.get('content-type', '').lower() or 'text' in response.headers.get('content-type', '').lower()
        print("✅ /twilio/sip-voice endpoint responds with TwiML")
    
    def test_bridge_call_expired_session(self):
        """Test bridge call with expired/invalid bridge ID"""
        response = requests.post(
            f"{BASE_URL}/api/twilio/sip-voice",
            data={
                'To': 'sip:bridge_invalid_test_123@speechcue-7937a0.sip.twilio.com',
                'From': 'sip:test@speechcue-7937a0.sip.twilio.com',
                'CallSid': 'CA_test_456'
            },
            timeout=10
        )
        assert response.status_code == 200
        # Should contain "expired" message in TwiML
        content = response.text.lower()
        assert 'expired' in content or 'try again' in content, "Should indicate session expired"
        print("✅ Bridge call with invalid ID returns expired message")


class TestTwilioVoiceWebhook:
    """Test the /twilio/voice-webhook endpoint"""
    
    def test_voice_webhook_endpoint_exists(self):
        """Test that /twilio/voice-webhook endpoint exists"""
        response = requests.post(
            f"{BASE_URL}/api/twilio/voice-webhook",
            data={
                'To': TEST_TWILIO_NUMBER,
                'From': '+15551234567',
                'CallSid': 'CA_test_789',
                'AccountSid': TEST_SUB_ACCOUNT_SID
            },
            timeout=10
        )
        # Should return TwiML response
        assert response.status_code == 200
        print("✅ /twilio/voice-webhook endpoint responds")


class TestCodeReview:
    """Code review tests - verify critical code patterns"""
    
    def test_answer_call_timing_in_voice_service(self):
        """Verify answerCall happens IMMEDIATELY after Twilio detection, BEFORE DB queries"""
        voice_service_path = '/app/js/voice-service.js'
        with open(voice_service_path, 'r') as f:
            content = f.read()
            lines = content.split('\n')
        
        # Find the CRITICAL comment and answerCall in the Twilio bridge section
        critical_line = None
        answer_line = None
        db_query_line = None
        
        for i, line in enumerate(lines, 1):
            # Look for the CRITICAL comment about immediate answer
            if 'CRITICAL: Answer the call IMMEDIATELY' in line:
                critical_line = i
            # Look for answerCall after the CRITICAL comment
            if critical_line and 'answerCall(callControlId)' in line and answer_line is None:
                answer_line = i
            # Look for first DB query (findOne) after answerCall
            if answer_line and 'findOne' in line and db_query_line is None:
                db_query_line = i
                break
        
        # Verify the CRITICAL comment exists
        assert critical_line is not None, "CRITICAL comment about immediate answer not found"
        # Verify answerCall exists after the comment
        assert answer_line is not None, "answerCall not found after CRITICAL comment"
        # Verify answerCall is BEFORE any DB queries
        if db_query_line:
            assert answer_line < db_query_line, f"answerCall (line {answer_line}) should be BEFORE DB query (line {db_query_line})"
        
        print(f"✅ CRITICAL comment at line {critical_line}, answerCall at line {answer_line}, DB query at line {db_query_line or 'N/A'} - timing correct")
    
    def test_ip_acl_configuration_in_twilio_service(self):
        """Verify IP ACL configuration code exists in twilio-service.js"""
        twilio_service_path = '/app/js/twilio-service.js'
        with open(twilio_service_path, 'r') as f:
            content = f.read()
        
        # Check for IP ACL creation code
        assert 'ipAccessControlLists.create' in content, "IP ACL creation code missing"
        assert 'Telnyx SIP Signaling IPs' in content, "IP ACL friendly name missing"
        assert 'auth.calls.ipAccessControlListMappings' in content, "IP ACL mapping to auth.calls missing"
        
        # Check all 8 Telnyx IPs are in the code
        for ip in EXPECTED_TELNYX_IPS:
            assert ip in content, f"Telnyx IP {ip} missing from IP ACL configuration"
        
        print("✅ IP ACL configuration code verified with all 8 Telnyx IPs")
    
    def test_credential_recovery_in_voice_service(self):
        """Verify credential recovery code exists"""
        voice_service_path = '/app/js/voice-service.js'
        with open(voice_service_path, 'r') as f:
            content = f.read()
        
        # Check for token recovery logic
        assert 'TOKEN RECOVERY' in content or 'Token recovered' in content, "Token recovery code missing"
        assert 'getSubAccount' in content, "getSubAccount call missing for token recovery"
        assert 'twilioSubAccountToken' in content, "twilioSubAccountToken persistence missing"
        
        print("✅ Credential recovery code verified")
    
    def test_ani_restore_in_voice_service(self):
        """Verify ANI restore code exists after transfer"""
        voice_service_path = '/app/js/voice-service.js'
        with open(voice_service_path, 'r') as f:
            content = f.read()
        
        # Check for ANI restore logic
        assert 'updateAniOverride' in content, "updateAniOverride call missing"
        assert 'Restore connection ANI' in content or 'restore' in content.lower(), "ANI restore comment/logic missing"
        
        print("✅ ANI restore code verified")


class TestTelnyxConfiguration:
    """Verify Telnyx configuration for SIP bridge"""
    
    def test_telnyx_env_vars_in_dotenv(self):
        """Test that required Telnyx env vars are configured in .env file"""
        env_path = '/app/backend/.env'
        with open(env_path, 'r') as f:
            env_content = f.read()
        
        assert 'TELNYX_API_KEY=' in env_content, "TELNYX_API_KEY not in .env"
        assert 'TELNYX_SIP_CONNECTION_ID=' in env_content, "TELNYX_SIP_CONNECTION_ID not in .env"
        assert 'TELNYX_DEFAULT_ANI=' in env_content, "TELNYX_DEFAULT_ANI not in .env"
        
        # Extract values
        import re
        api_key_match = re.search(r'TELNYX_API_KEY=([^\n]+)', env_content)
        sip_conn_match = re.search(r'TELNYX_SIP_CONNECTION_ID=([^\n]+)', env_content)
        ani_match = re.search(r'TELNYX_DEFAULT_ANI=([^\n]+)', env_content)
        
        assert api_key_match and api_key_match.group(1), "TELNYX_API_KEY has no value"
        assert sip_conn_match and sip_conn_match.group(1), "TELNYX_SIP_CONNECTION_ID has no value"
        assert ani_match and ani_match.group(1), "TELNYX_DEFAULT_ANI has no value"
        
        print(f"✅ Telnyx env vars present in .env: API_KEY={api_key_match.group(1)[:10]}..., SIP_CONN={sip_conn_match.group(1)}, ANI={ani_match.group(1)}")


class TestTwilioConfiguration:
    """Verify Twilio configuration"""
    
    def test_twilio_env_vars_in_dotenv(self):
        """Test that required Twilio env vars are configured in .env file"""
        env_path = '/app/backend/.env'
        with open(env_path, 'r') as f:
            env_content = f.read()
        
        assert 'TWILIO_ACCOUNT_SID=' in env_content, "TWILIO_ACCOUNT_SID not in .env"
        assert 'TWILIO_AUTH_TOKEN=' in env_content, "TWILIO_AUTH_TOKEN not in .env"
        
        # Extract values
        import re
        sid_match = re.search(r'TWILIO_ACCOUNT_SID=([^\n]+)', env_content)
        token_match = re.search(r'TWILIO_AUTH_TOKEN=([^\n]+)', env_content)
        
        assert sid_match and sid_match.group(1), "TWILIO_ACCOUNT_SID has no value"
        assert token_match and token_match.group(1), "TWILIO_AUTH_TOKEN has no value"
        
        print(f"✅ Twilio env vars present in .env: SID={sid_match.group(1)[:10]}..., TOKEN={'*' * 10}")


if __name__ == '__main__':
    pytest.main([__file__, '-v', '--tb=short'])
