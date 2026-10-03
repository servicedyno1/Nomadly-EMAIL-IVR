#!/usr/bin/env python3
"""
Backend Test for Nomadly Review Request
Tests the specific endpoints and AMD code verification as requested.
"""

import requests
import json
import sys
from datetime import datetime

# Backend URL from frontend/.env
BACKEND_URL = "https://vault-config-5.preview.emergentagent.com"
TEST_USER_ID = "6687923716"  # From test_result.md

def test_health_check():
    """Test 1: Health Check - GET /api/health"""
    print("🔍 Testing Health Check...")
    try:
        response = requests.get(f"{BACKEND_URL}/api/health", timeout=10)
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"   Response: {data}")
            if data.get('status') == 'healthy':
                print("   ✅ Health check passed")
                return True
            else:
                print(f"   ❌ Health check failed - status: {data.get('status')}")
                return False
        else:
            print(f"   ❌ Health check failed - HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"   ❌ Health check error: {e}")
        return False

def test_sms_app_auth():
    """Test 2: SMS App Auth - GET /api/sms-app/auth/6687923716"""
    print("🔍 Testing SMS App Auth...")
    try:
        response = requests.get(f"{BACKEND_URL}/api/sms-app/auth/{TEST_USER_ID}", timeout=10)
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"   Response: {data}")
            if data.get('valid') == True:
                print("   ✅ SMS App Auth passed")
                return True
            else:
                print(f"   ❌ SMS App Auth failed - valid: {data.get('valid')}")
                return False
        else:
            print(f"   ❌ SMS App Auth failed - HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"   ❌ SMS App Auth error: {e}")
        return False

def test_single_ivr_twiml():
    """Test 3: SingleIVR TwiML - POST /api/twilio/single-ivr?sessionId=nonexistent"""
    print("🔍 Testing SingleIVR TwiML...")
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/twilio/single-ivr?sessionId=nonexistent", 
            timeout=10
        )
        print(f"   Status: {response.status_code}")
        print(f"   Content-Type: {response.headers.get('content-type', 'N/A')}")
        
        if response.status_code == 200:
            content_type = response.headers.get('content-type', '')
            if 'text/xml' in content_type or 'application/xml' in content_type:
                print(f"   Response (first 200 chars): {response.text[:200]}...")
                if '<Response>' in response.text or '<?xml' in response.text:
                    print("   ✅ SingleIVR TwiML passed")
                    return True
                else:
                    print("   ❌ SingleIVR TwiML failed - not valid XML")
                    return False
            else:
                print(f"   ❌ SingleIVR TwiML failed - wrong content-type: {content_type}")
                return False
        else:
            print(f"   ❌ SingleIVR TwiML failed - HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"   ❌ SingleIVR TwiML error: {e}")
        return False

def test_bulk_ivr_twiml():
    """Test 4: BulkIVR TwiML - POST /api/twilio/bulk-ivr?campaignId=nonexistent&leadIndex=0"""
    print("🔍 Testing BulkIVR TwiML...")
    try:
        response = requests.post(
            f"{BACKEND_URL}/api/twilio/bulk-ivr?campaignId=nonexistent&leadIndex=0", 
            timeout=10
        )
        print(f"   Status: {response.status_code}")
        print(f"   Content-Type: {response.headers.get('content-type', 'N/A')}")
        
        if response.status_code == 200:
            content_type = response.headers.get('content-type', '')
            if 'text/xml' in content_type or 'application/xml' in content_type:
                print(f"   Response (first 200 chars): {response.text[:200]}...")
                if '<Response>' in response.text or '<?xml' in response.text:
                    print("   ✅ BulkIVR TwiML passed")
                    return True
                else:
                    print("   ❌ BulkIVR TwiML failed - not valid XML")
                    return False
            else:
                print(f"   ❌ BulkIVR TwiML failed - wrong content-type: {content_type}")
                return False
        else:
            print(f"   ❌ BulkIVR TwiML failed - HTTP {response.status_code}")
            return False
    except Exception as e:
        print(f"   ❌ BulkIVR TwiML error: {e}")
        return False

def verify_amd_code():
    """Test 5: Code Review Verification - Check AMD implementation in files"""
    print("🔍 Verifying AMD Code Implementation...")
    
    files_to_check = [
        ("/app/js/voice-service.js", [
            "answeredBy: null",
            "machineDetection: 'Enable'",
            "call.machine.detection.ended"
        ]),
        ("/app/js/telnyx-service.js", [
            "answering_machine_detection"
        ]),
        ("/app/js/twilio-service.js", [
            "machineDetection"
        ]),
        ("/app/js/ivr-outbound.js", [
            "Human Answered",
            "Voicemail Detected"
        ]),
        ("/app/js/_index.js", [
            "AnsweredBy",
            "/twilio/single-ivr-status"
        ])
    ]
    
    all_checks_passed = True
    
    for file_path, required_patterns in files_to_check:
        print(f"   📁 Checking {file_path}...")
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            file_passed = True
            for pattern in required_patterns:
                if pattern in content:
                    print(f"      ✅ Found: {pattern}")
                else:
                    print(f"      ❌ Missing: {pattern}")
                    file_passed = False
                    all_checks_passed = False
            
            if file_passed:
                print(f"      ✅ {file_path} - All AMD patterns found")
            else:
                print(f"      ❌ {file_path} - Some AMD patterns missing")
                
        except FileNotFoundError:
            print(f"      ❌ File not found: {file_path}")
            all_checks_passed = False
        except Exception as e:
            print(f"      ❌ Error reading {file_path}: {e}")
            all_checks_passed = False
    
    if all_checks_passed:
        print("   ✅ AMD Code Verification passed")
    else:
        print("   ❌ AMD Code Verification failed")
    
    return all_checks_passed

def main():
    """Run all tests and provide summary"""
    print("=" * 60)
    print("🧪 NOMADLY BACKEND TESTING - Review Request Verification")
    print("=" * 60)
    print(f"Backend URL: {BACKEND_URL}")
    print(f"Test User: {TEST_USER_ID}")
    print(f"Test Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print()
    
    tests = [
        ("Health Check", test_health_check),
        ("SMS App Auth", test_sms_app_auth),
        ("SingleIVR TwiML", test_single_ivr_twiml),
        ("BulkIVR TwiML", test_bulk_ivr_twiml),
        ("AMD Code Verification", verify_amd_code)
    ]
    
    results = []
    
    for test_name, test_func in tests:
        print(f"🔬 Running: {test_name}")
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"   ❌ Test failed with exception: {e}")
            results.append((test_name, False))
        print()
    
    # Summary
    print("=" * 60)
    print("📊 TEST SUMMARY")
    print("=" * 60)
    
    passed = 0
    total = len(results)
    
    for test_name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"{status} - {test_name}")
        if result:
            passed += 1
    
    print()
    print(f"Results: {passed}/{total} tests passed ({(passed/total)*100:.1f}%)")
    
    if passed == total:
        print("🎉 ALL TESTS PASSED - No regressions detected, all endpoints respond, AMD code is correct")
        return 0
    else:
        print("⚠️  SOME TESTS FAILED - Review the failures above")
        return 1

if __name__ == "__main__":
    sys.exit(main())