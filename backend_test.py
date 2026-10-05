#!/usr/bin/env python3
"""
Backend Test: Reseller API cPanel Credentials 501 Bug Fix Verification (LIVE mode)
===================================================================================

BUG: API-provisioned cPanel accounts returned HTTP 501 {"error":"no_credentials"} on 
password-dependent management endpoints because the generated cPanel password was never 
persisted into the DB the reseller API reads from.

FIX: 
- js/cr-register-domain-&-create-cpanel.js now returns password + whmHost
- js/reseller-api.js encrypts and persists cpPass_encrypted/iv/tag + cpUser + whmHost
- Backfilled existing account name65fb with credentials

ENVIRONMENT: LIVE mode (RESELLER_API_LIVE=true, uses PROD Railway DB)
⛔ CRITICAL: ALL tests are READ-ONLY GET requests. NO mutations allowed.

Target accounts:
- name65fb: API-provisioned (was 501, now backfilled) - EXPECT 200 on /files,/subdomains,/ssl,/stats
- nbayftest: manually-provisioned control - EXPECT 200 on same endpoints
"""

import requests
import json
import sys
from typing import Dict, Any, Tuple

# Configuration
BASE_URL = "https://3f880739-5533-4e15-b35e-112dc854f3b8.preview.emergentagent.com/api/reseller/v1"
API_KEY = "rsk_live_cdc3f785ac3cfd813c6143d7813e1a59cc15fc42327ab736"
EXPECTED_OWNER_CHAT_ID = "5590563715"

# Test counters
tests_run = 0
tests_passed = 0
tests_failed = 0

def print_header(title: str):
    """Print a formatted test section header"""
    print(f"\n{'='*80}")
    print(f"★★★ {title} ★★★")
    print(f"{'='*80}")

def print_test(name: str, passed: bool, details: str = ""):
    """Print test result"""
    global tests_run, tests_passed, tests_failed
    tests_run += 1
    
    if passed:
        tests_passed += 1
        status = "✅ PASS"
    else:
        tests_failed += 1
        status = "❌ FAIL"
    
    print(f"{status}: {name}")
    if details:
        print(f"         {details}")

def make_request(method: str, endpoint: str, headers: Dict[str, str] = None, 
                 params: Dict[str, str] = None) -> Tuple[int, Any, str]:
    """
    Make HTTP request and return (status_code, json_body, error_message)
    """
    url = f"{BASE_URL}{endpoint}"
    
    try:
        if method.upper() == "GET":
            response = requests.get(url, headers=headers, params=params, timeout=30)
        else:
            return (0, None, f"Method {method} not allowed in this test (READ-ONLY)")
        
        status_code = response.status_code
        
        try:
            body = response.json()
        except:
            body = {"_raw_text": response.text[:500]}
        
        return (status_code, body, "")
    
    except requests.exceptions.Timeout:
        return (0, None, "Request timeout (30s)")
    except requests.exceptions.ConnectionError as e:
        return (0, None, f"Connection error: {str(e)[:200]}")
    except Exception as e:
        return (0, None, f"Request error: {str(e)[:200]}")

def test_account_info():
    """Test 1: GET /account - verify key authenticates and owner info"""
    print_header("TEST 1: Account Info (Authentication & Owner Verification)")
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    status, body, error = make_request("GET", "/account", headers=headers)
    
    if error:
        print_test("GET /account request", False, f"Error: {error}")
        return
    
    print_test("GET /account returns 200", status == 200, 
               f"Status: {status}, Body: {json.dumps(body, indent=2)[:300]}")
    
    if status == 200 and body:
        print_test("Account has owner_chat_id", "owner_chat_id" in body,
                   f"owner_chat_id: {body.get('owner_chat_id', 'MISSING')}")
        
        print_test(f"Account owner_chat_id is {EXPECTED_OWNER_CHAT_ID}", 
                   body.get("owner_chat_id") == EXPECTED_OWNER_CHAT_ID,
                   f"Expected: {EXPECTED_OWNER_CHAT_ID}, Got: {body.get('owner_chat_id')}")
        
        print_test("Account has wallet_balance_usd", "wallet_balance_usd" in body,
                   f"Balance: ${body.get('wallet_balance_usd', 'MISSING')}")
        
        print_test("Account mode is 'live'", body.get("mode") == "live",
                   f"Mode: {body.get('mode', 'MISSING')}")

def test_name65fb_basic():
    """Test 2: GET /hosting/name65fb - verify account exists and is online"""
    print_header("TEST 2: name65fb Basic Info (API-provisioned account)")
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    status, body, error = make_request("GET", "/hosting/name65fb", headers=headers)
    
    if error:
        print_test("GET /hosting/name65fb request", False, f"Error: {error}")
        return
    
    print_test("GET /hosting/name65fb returns 200", status == 200,
               f"Status: {status}, Body: {json.dumps(body, indent=2)[:500]}")
    
    if status == 200 and body:
        print_test("Account state is 'online'", body.get("state") == "online",
                   f"State: {body.get('state', 'MISSING')}")
        
        print_test("Account has domain", "domain" in body,
                   f"Domain: {body.get('domain', 'MISSING')}")

def test_name65fb_files():
    """Test 3: GET /hosting/name65fb/files?path=/public_html - THE KEY TEST (was 501 before fix)"""
    print_header("TEST 3: name65fb Files (THE KEY TEST - was 501 no_credentials before fix)")
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    params = {"path": "/public_html"}
    status, body, error = make_request("GET", "/hosting/name65fb/files", headers=headers, params=params)
    
    if error:
        print_test("GET /hosting/name65fb/files request", False, f"Error: {error}")
        return
    
    print_test("GET /hosting/name65fb/files returns 200 (NOT 501)", status == 200,
               f"Status: {status}, Body: {json.dumps(body, indent=2)[:500]}")
    
    if status == 501:
        print_test("❌ CRITICAL: Still returns 501 no_credentials", False,
                   f"The bug fix did NOT work. Body: {json.dumps(body, indent=2)}")
    elif status == 200:
        print_test("✅ CRITICAL: Bug fix VERIFIED - no more 501", True,
                   "Files endpoint now works correctly")

def test_name65fb_subdomains():
    """Test 4: GET /hosting/name65fb/subdomains - was 501 before fix"""
    print_header("TEST 4: name65fb Subdomains (was 501 before fix)")
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    status, body, error = make_request("GET", "/hosting/name65fb/subdomains", headers=headers)
    
    if error:
        print_test("GET /hosting/name65fb/subdomains request", False, f"Error: {error}")
        return
    
    print_test("GET /hosting/name65fb/subdomains returns 200 (NOT 501)", status == 200,
               f"Status: {status}, Body: {json.dumps(body, indent=2)[:500]}")
    
    if status == 501:
        print_test("❌ CRITICAL: Still returns 501 no_credentials", False,
                   f"The bug fix did NOT work. Body: {json.dumps(body, indent=2)}")

def test_name65fb_ssl():
    """Test 5: GET /hosting/name65fb/ssl - was 501 before fix"""
    print_header("TEST 5: name65fb SSL (was 501 before fix)")
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    status, body, error = make_request("GET", "/hosting/name65fb/ssl", headers=headers)
    
    if error:
        print_test("GET /hosting/name65fb/ssl request", False, f"Error: {error}")
        return
    
    print_test("GET /hosting/name65fb/ssl returns 200 (NOT 501)", status == 200,
               f"Status: {status}, Body: {json.dumps(body, indent=2)[:500]}")
    
    if status == 501:
        print_test("❌ CRITICAL: Still returns 501 no_credentials", False,
                   f"The bug fix did NOT work. Body: {json.dumps(body, indent=2)}")

def test_name65fb_stats():
    """Test 6: GET /hosting/name65fb/stats - was 501 before fix"""
    print_header("TEST 6: name65fb Stats (was 501 before fix)")
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    status, body, error = make_request("GET", "/hosting/name65fb/stats", headers=headers)
    
    if error:
        print_test("GET /hosting/name65fb/stats request", False, f"Error: {error}")
        return
    
    print_test("GET /hosting/name65fb/stats returns 200 (NOT 501)", status == 200,
               f"Status: {status}, Body: {json.dumps(body, indent=2)[:500]}")
    
    if status == 501:
        print_test("❌ CRITICAL: Still returns 501 no_credentials", False,
                   f"The bug fix did NOT work. Body: {json.dumps(body, indent=2)}")

def test_name65fb_credentials():
    """Test 7: GET /hosting/name65fb/credentials - verify panel_pin and SSO URL"""
    print_header("TEST 7: name65fb Credentials (panel_pin + SSO URL)")
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    status, body, error = make_request("GET", "/hosting/name65fb/credentials", headers=headers)
    
    if error:
        print_test("GET /hosting/name65fb/credentials request", False, f"Error: {error}")
        return
    
    print_test("GET /hosting/name65fb/credentials returns 200", status == 200,
               f"Status: {status}, Body: {json.dumps(body, indent=2)[:500]}")
    
    if status == 200 and body:
        print_test("Credentials has panel_pin", "panel_pin" in body,
                   f"panel_pin: {body.get('panel_pin', 'MISSING')}")
        
        print_test("Credentials has direct_cpanel_login_url", "direct_cpanel_login_url" in body,
                   f"SSO URL: {body.get('direct_cpanel_login_url', 'MISSING')[:100]}...")

def test_nbayftest_control():
    """Test 8: CONTROL - nbayftest (manually-created account) must still work"""
    print_header("TEST 8: CONTROL - nbayftest (manually-created account)")
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    
    # Test 8a: files
    status, body, error = make_request("GET", "/hosting/nbayftest/files", 
                                       headers=headers, params={"path": "/public_html"})
    print_test("GET /hosting/nbayftest/files returns 200", status == 200,
               f"Status: {status}, Body: {json.dumps(body, indent=2)[:300]}")
    
    # Test 8b: subdomains
    status, body, error = make_request("GET", "/hosting/nbayftest/subdomains", headers=headers)
    print_test("GET /hosting/nbayftest/subdomains returns 200", status == 200,
               f"Status: {status}, Body: {json.dumps(body, indent=2)[:300]}")
    
    # Test 8c: ssl
    status, body, error = make_request("GET", "/hosting/nbayftest/ssl", headers=headers)
    print_test("GET /hosting/nbayftest/ssl returns 200", status == 200,
               f"Status: {status}, Body: {json.dumps(body, indent=2)[:300]}")
    
    # Test 8d: stats
    status, body, error = make_request("GET", "/hosting/nbayftest/stats", headers=headers)
    print_test("GET /hosting/nbayftest/stats returns 200", status == 200,
               f"Status: {status}, Body: {json.dumps(body, indent=2)[:300]}")

def test_negative_no_auth():
    """Test 9: Negative check - no auth header should return 401"""
    print_header("TEST 9: Negative Check (No Auth → 401)")
    
    # No headers (no auth)
    status, body, error = make_request("GET", "/hosting/name65fb/files", params={"path": "/public_html"})
    
    print_test("GET /hosting/name65fb/files WITHOUT auth returns 401", status == 401,
               f"Status: {status}, Body: {json.dumps(body, indent=2)[:300]}")
    
    if status == 401 and body:
        print_test("Error is 'missing_api_key'", body.get("error") == "missing_api_key",
                   f"Error: {body.get('error', 'MISSING')}")

def print_summary():
    """Print final test summary"""
    print("\n" + "="*80)
    print("FINAL TEST SUMMARY")
    print("="*80)
    print(f"Total tests run: {tests_run}")
    print(f"✅ Passed: {tests_passed}")
    print(f"❌ Failed: {tests_failed}")
    print(f"Pass rate: {(tests_passed/tests_run*100) if tests_run > 0 else 0:.1f}%")
    print("="*80)
    
    if tests_failed == 0:
        print("\n🎉 ALL TESTS PASSED - Bug fix VERIFIED!")
        print("✅ name65fb (API-provisioned) now returns 200 on all password-dependent endpoints")
        print("✅ nbayftest (manual control) still works correctly")
        print("✅ Auth validation working (401 without key)")
        return 0
    else:
        print(f"\n⚠️  {tests_failed} TEST(S) FAILED - Bug fix may NOT be complete")
        return 1

def main():
    """Run all tests"""
    print("="*80)
    print("RESELLER API - cPanel Credentials 501 Bug Fix Verification")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"API Key: {API_KEY[:20]}...{API_KEY[-10:]}")
    print(f"Expected Owner: {EXPECTED_OWNER_CHAT_ID}")
    print("⛔ LIVE MODE - READ-ONLY TESTS ONLY")
    print("="*80)
    
    # Run all tests
    test_account_info()
    test_name65fb_basic()
    test_name65fb_files()        # THE KEY TEST (was 501 before fix)
    test_name65fb_subdomains()   # was 501 before fix
    test_name65fb_ssl()          # was 501 before fix
    test_name65fb_stats()        # was 501 before fix
    test_name65fb_credentials()  # verify panel_pin + SSO URL
    test_nbayftest_control()     # control account must still work
    test_negative_no_auth()      # negative check
    
    # Print summary and exit
    exit_code = print_summary()
    sys.exit(exit_code)

if __name__ == "__main__":
    main()
