#!/usr/bin/env python3
"""
Backend Test Suite for Reseller API "Database not ready" Bugfix
================================================================

CONTEXT:
The reseller REST API was returning HTTP 500 { "error":"auth_error", "message":"Database not ready" }
on every call (reported on GET /vps/plans). Root cause was a stale/undefined DB handle in js/_index.js.

FIX:
Changed `let resellerDb = db` to `let resellerDb = null` and `getDb: () => resellerDb || db` to fall
back to the live DB at call-time (after loadData() has run).

TEST ENVIRONMENT:
The dev pod has been configured to REPRODUCE the production condition (dedicated RESELLER_DB_URL disabled,
so the fallback DB path is exercised), and a valid reseller API key was seeded into the local DB.

TESTS:
1. GET /api/reseller/v1/vps/plans with valid key → expect 200 with plans array (NOT 500 "Database not ready")
2. GET /api/reseller/v1/vps/plans with invalid key → expect 401 invalid_api_key (NOT 500 "Database not ready")
3. GET /api/reseller/v1/vps/plans with no auth → expect 401 missing_api_key

PASS CRITERIA:
Test 1 returns 200 with a plans array, Test 2 returns 401 invalid_api_key, Test 3 returns 401 missing_api_key,
and NONE of them return 500 "Database not ready".
"""

import os
import sys
import requests
import json
from typing import Dict, Any, Optional

# Read REACT_APP_BACKEND_URL from frontend/.env
def get_backend_url() -> str:
    env_path = '/app/frontend/.env'
    with open(env_path, 'r') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                return line.split('=', 1)[1].strip()
    raise ValueError("REACT_APP_BACKEND_URL not found in /app/frontend/.env")

BASE_URL = get_backend_url()
RESELLER_API_BASE = f"{BASE_URL}/api/reseller/v1"

# Valid API key (seeded into local DB)
VALID_API_KEY = "rsk_live_6af6daabd545fccb80c2c5265a8caaae52af8ae6dd49f848"
INVALID_API_KEY = "rsk_live_bogus_invalid_key_123"

# Test results
test_results = []
passed = 0
failed = 0

def log_test(name: str, passed_flag: bool, details: str):
    """Log test result"""
    global passed, failed
    status = "✅ PASS" if passed_flag else "❌ FAIL"
    test_results.append(f"{status}: {name}\n{details}\n")
    if passed_flag:
        passed += 1
    else:
        failed += 1
    print(f"{status}: {name}")
    print(details)
    print()

def make_request(endpoint: str, headers: Optional[Dict[str, str]] = None) -> tuple[int, Dict[str, Any], str]:
    """Make HTTP request and return status, json body, and raw text"""
    url = f"{RESELLER_API_BASE}{endpoint}"
    try:
        response = requests.get(url, headers=headers or {}, timeout=10)
        status = response.status_code
        try:
            body = response.json()
        except:
            body = {}
        text = response.text
        return status, body, text
    except Exception as e:
        return 0, {"error": str(e)}, str(e)

def test_1_valid_key():
    """TEST 1: GET /vps/plans with valid key → expect 200 with plans array"""
    print("=" * 80)
    print("TEST 1: GET /vps/plans with valid Authorization header (valid key)")
    print("=" * 80)
    
    headers = {"Authorization": f"Bearer {VALID_API_KEY}"}
    status, body, text = make_request("/vps/plans", headers)
    
    details = f"URL: {RESELLER_API_BASE}/vps/plans\n"
    details += f"Headers: Authorization: Bearer {VALID_API_KEY}\n"
    details += f"Status: {status}\n"
    details += f"Body: {json.dumps(body, indent=2)}\n"
    
    # Check 1: Status must be 200
    if status != 200:
        log_test("TEST 1: Valid key returns 200", False, 
                 details + f"\n❌ CRITICAL: Expected status 200, got {status}")
        return
    
    # Check 2: Must NOT be 500 "Database not ready"
    if status == 500 and body.get("message") == "Database not ready":
        log_test("TEST 1: Valid key returns 200", False,
                 details + "\n❌ CRITICAL: Got 500 'Database not ready' - THE BUG IS NOT FIXED!")
        return
    
    # Check 3: Must have plans array
    if "plans" not in body:
        log_test("TEST 1: Valid key returns 200", False,
                 details + "\n❌ CRITICAL: Response does not contain 'plans' array")
        return
    
    # Check 4: Plans must be an array
    if not isinstance(body.get("plans"), list):
        log_test("TEST 1: Valid key returns 200", False,
                 details + f"\n❌ CRITICAL: 'plans' is not an array, got {type(body.get('plans'))}")
        return
    
    # Check 5: Plans array should have items
    plans_count = len(body.get("plans", []))
    details += f"\n✅ Plans count: {plans_count}"
    details += f"\n✅ Response structure: product={body.get('product')}, provider={body.get('provider')}, region={body.get('region')}"
    
    log_test("TEST 1: Valid key returns 200 with plans array", True, details)

def test_2_invalid_key():
    """TEST 2: GET /vps/plans with invalid key → expect 401 invalid_api_key"""
    print("=" * 80)
    print("TEST 2: GET /vps/plans with invalid Authorization header")
    print("=" * 80)
    
    headers = {"Authorization": f"Bearer {INVALID_API_KEY}"}
    status, body, text = make_request("/vps/plans", headers)
    
    details = f"URL: {RESELLER_API_BASE}/vps/plans\n"
    details += f"Headers: Authorization: Bearer {INVALID_API_KEY}\n"
    details += f"Status: {status}\n"
    details += f"Body: {json.dumps(body, indent=2)}\n"
    
    # Check 1: Status must be 401
    if status != 401:
        log_test("TEST 2: Invalid key returns 401", False,
                 details + f"\n❌ CRITICAL: Expected status 401, got {status}")
        return
    
    # Check 2: Must NOT be 500 "Database not ready"
    if status == 500 and body.get("message") == "Database not ready":
        log_test("TEST 2: Invalid key returns 401", False,
                 details + "\n❌ CRITICAL: Got 500 'Database not ready' - THE BUG IS NOT FIXED!")
        return
    
    # Check 3: Error must be "invalid_api_key"
    if body.get("error") != "invalid_api_key":
        log_test("TEST 2: Invalid key returns 401 invalid_api_key", False,
                 details + f"\n❌ Expected error='invalid_api_key', got error='{body.get('error')}'")
        return
    
    details += "\n✅ Correct error: invalid_api_key"
    details += "\n✅ This proves the DB lookup actually executed successfully (not 500 'Database not ready')"
    
    log_test("TEST 2: Invalid key returns 401 invalid_api_key", True, details)

def test_3_no_auth():
    """TEST 3: GET /vps/plans with no auth → expect 401 missing_api_key"""
    print("=" * 80)
    print("TEST 3: GET /vps/plans with NO Authorization header")
    print("=" * 80)
    
    status, body, text = make_request("/vps/plans")
    
    details = f"URL: {RESELLER_API_BASE}/vps/plans\n"
    details += f"Headers: (none)\n"
    details += f"Status: {status}\n"
    details += f"Body: {json.dumps(body, indent=2)}\n"
    
    # Check 1: Status must be 401
    if status != 401:
        log_test("TEST 3: No auth returns 401", False,
                 details + f"\n❌ CRITICAL: Expected status 401, got {status}")
        return
    
    # Check 2: Must NOT be 500 "Database not ready"
    if status == 500 and body.get("message") == "Database not ready":
        log_test("TEST 3: No auth returns 401", False,
                 details + "\n❌ CRITICAL: Got 500 'Database not ready' - THE BUG IS NOT FIXED!")
        return
    
    # Check 3: Error must be "missing_api_key"
    if body.get("error") != "missing_api_key":
        log_test("TEST 3: No auth returns 401 missing_api_key", False,
                 details + f"\n❌ Expected error='missing_api_key', got error='{body.get('error')}'")
        return
    
    details += "\n✅ Correct error: missing_api_key"
    
    log_test("TEST 3: No auth returns 401 missing_api_key", True, details)

def main():
    print("\n" + "=" * 80)
    print("RESELLER API BUGFIX VERIFICATION TEST SUITE")
    print("Bug: 'Database not ready' error on every reseller API call")
    print("Fix: Changed getDb to fall back to live DB at call-time")
    print("=" * 80 + "\n")
    
    print(f"Base URL: {BASE_URL}")
    print(f"Reseller API Base: {RESELLER_API_BASE}")
    print(f"Valid API Key: {VALID_API_KEY}")
    print()
    
    # Run all tests
    test_1_valid_key()
    test_2_invalid_key()
    test_3_no_auth()
    
    # Summary
    print("\n" + "=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total tests: {passed + failed}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print()
    
    if failed == 0:
        print("✅ ALL TESTS PASSED - BUGFIX VERIFIED!")
        print()
        print("PASS CRITERIA MET:")
        print("• Test 1 returns 200 with a plans array ✅")
        print("• Test 2 returns 401 invalid_api_key ✅")
        print("• Test 3 returns 401 missing_api_key ✅")
        print("• NONE of them return 500 'Database not ready' ✅")
        print()
        print("CONCLUSION:")
        print("The reseller API 'Database not ready' bug is FIXED. The getDb fallback to the")
        print("live DB is working correctly. All three test scenarios passed.")
        return 0
    else:
        print("❌ SOME TESTS FAILED - BUGFIX NOT VERIFIED")
        print()
        print("FAILED TESTS:")
        for result in test_results:
            if "❌ FAIL" in result:
                print(result)
        return 1

if __name__ == "__main__":
    sys.exit(main())
