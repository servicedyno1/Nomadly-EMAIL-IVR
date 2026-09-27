#!/usr/bin/env python3
"""
READ-ONLY Backend Health Regression Test
After language file changes (js/lang/en|fr|hi|zh.js)
ONLY tests /api/health endpoint - NO writes, NO triggers
"""

import requests
import json
import sys

# Base URL from frontend/.env
BASE_URL = "https://cloud-integration-3.preview.emergentagent.com"

def test_health_endpoint():
    """
    Test GET /api/health
    Expected: HTTP 200 with {status:"healthy", database:"connected"}
    """
    print("\n" + "="*80)
    print("READ-ONLY HEALTH CHECK - Language File Regression Test")
    print("="*80)
    
    url = f"{BASE_URL}/api/health"
    print(f"\n[TEST] GET {url}")
    
    try:
        response = requests.get(url, timeout=10)
        
        print(f"[RESPONSE] Status Code: {response.status_code}")
        print(f"[RESPONSE] Headers: {dict(response.headers)}")
        
        # Try to parse JSON
        try:
            data = response.json()
            print(f"[RESPONSE] Body (JSON):\n{json.dumps(data, indent=2)}")
        except:
            print(f"[RESPONSE] Body (raw):\n{response.text[:500]}")
        
        # Validate response
        if response.status_code == 200:
            if response.headers.get('content-type', '').startswith('application/json'):
                data = response.json()
                
                # Check required fields
                has_status = 'status' in data
                has_database = 'database' in data
                status_healthy = data.get('status') == 'healthy'
                db_connected = data.get('database') == 'connected'
                
                print(f"\n[VALIDATION]")
                print(f"  ✓ HTTP 200: YES")
                print(f"  ✓ Content-Type JSON: YES")
                print(f"  ✓ Has 'status' field: {has_status}")
                print(f"  ✓ Has 'database' field: {has_database}")
                print(f"  ✓ status == 'healthy': {status_healthy}")
                print(f"  ✓ database == 'connected': {db_connected}")
                
                if has_status and has_database and status_healthy and db_connected:
                    print(f"\n[RESULT] ✅ PASS - Health endpoint working correctly")
                    print(f"[RESULT] Node backend boots healthy after lang-file edits")
                    return True
                else:
                    print(f"\n[RESULT] ❌ FAIL - Response missing expected fields or values")
                    return False
            else:
                print(f"\n[RESULT] ❌ FAIL - Response is not JSON (got {response.headers.get('content-type')})")
                return False
        else:
            print(f"\n[RESULT] ❌ FAIL - Expected HTTP 200, got {response.status_code}")
            return False
            
    except requests.exceptions.RequestException as e:
        print(f"\n[ERROR] Request failed: {e}")
        print(f"[RESULT] ❌ FAIL - Network error or server unreachable")
        return False
    except Exception as e:
        print(f"\n[ERROR] Unexpected error: {e}")
        print(f"[RESULT] ❌ FAIL - Unexpected error")
        return False

if __name__ == "__main__":
    print("\n" + "="*80)
    print("SAFETY NOTICE: READ-ONLY TEST")
    print("="*80)
    print("✓ ONLY testing GET /api/health")
    print("✓ NO POST requests")
    print("✓ NO database writes")
    print("✓ NO call/SMS/Telegram triggers")
    print("✓ LIVE production data - READ-ONLY verification")
    
    success = test_health_endpoint()
    
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"Total tests: 1")
    print(f"Passed: {1 if success else 0}")
    print(f"Failed: {0 if success else 1}")
    print("="*80 + "\n")
    
    sys.exit(0 if success else 1)
