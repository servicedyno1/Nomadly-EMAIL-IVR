#!/usr/bin/env python3
"""
Reseller API Deliverables Test Suite
=====================================
Verifies the DELIVERABLES additions to the Reseller REST API (/api/reseller/v1).

This is a follow-up to the prior passing run. DRY-RUN SANDBOX (SKIP_WEBHOOK_SYNC=true)
sharing PRODUCTION Mongo — must NOT charge wallet, reset PINs, or mutate provider state.

Test scope:
1. GET /hosting/:user/credentials → 200 with specific fields (panel_pin MUST be null, no PIN reset)
2. GET /hosting/:user → 200 with deliverables{} object
3. GET /hosting → 200 with top-level panel_url + server_ip, each account has expires_at + credentials_url
4. GET /domains → 200 with each domain having nameserver_type, nameservers, expires_at, dns_records_url, nameservers_url
5. Auth on credentials endpoint (401 without key, 401 with invalid key)
6. Regression check (quick re-check of previously tested endpoints)
7. Verify no 500s in logs and wallet stays $5.00
"""

import requests
import json
import sys
from typing import Dict, Any, List, Tuple

# Configuration
BASE_URL = "https://smadav-prod-logs.preview.emergentagent.com/api/reseller/v1"
FALLBACK_URL = "http://127.0.0.1:5000/reseller/v1"
API_KEY = "rsk_live_cdc3f785ac3cfd813c6143d7813e1a59cc15fc42327ab736"
OWNER_CHAT_ID = "5590563715"
EXPECTED_WALLET = 5.0
TEST_HOSTING_USER = "nbaykkd4zh"
TEST_DOMAIN = "testingbays.sbs"

# Test results tracking
passed = 0
failed = 0
test_results = []

def log_test(name: str, success: bool, details: str = ""):
    """Log a test result"""
    global passed, failed
    if success:
        passed += 1
        status = "✅ PASS"
    else:
        failed += 1
        status = "❌ FAIL"
    
    result = f"{status}: {name}"
    if details:
        result += f"\n    {details}"
    test_results.append(result)
    print(result)

def make_request(method: str, endpoint: str, headers: Dict = None, json_data: Dict = None, use_fallback: bool = False) -> Tuple[int, Any]:
    """Make an API request and return (status_code, response_json)"""
    base = FALLBACK_URL if use_fallback else BASE_URL
    url = f"{base}{endpoint}"
    
    try:
        if method == "GET":
            resp = requests.get(url, headers=headers, timeout=30)
        elif method == "POST":
            resp = requests.post(url, headers=headers, json=json_data, timeout=30)
        else:
            return (0, {"error": f"Unsupported method: {method}"})
        
        try:
            return (resp.status_code, resp.json())
        except:
            return (resp.status_code, {"error": "Non-JSON response", "text": resp.text[:200]})
    except Exception as e:
        return (0, {"error": str(e)})

def test_credentials_endpoint():
    """Test 1: GET /hosting/:user/credentials"""
    print("\n" + "="*80)
    print("TEST 1: GET /hosting/nbaykkd4zh/credentials")
    print("="*80)
    
    headers = {"X-API-Key": API_KEY}
    status, data = make_request("GET", f"/hosting/{TEST_HOSTING_USER}/credentials", headers=headers)
    
    # Check status code
    if status == 200:
        log_test("1.1 Status code 200", True)
    else:
        log_test("1.1 Status code 200", False, f"Got {status}")
        return
    
    # Check required fields
    required_fields = ["username", "domain", "plan", "panel_url", "server_ip", "nameservers", "expires_at", "mode"]
    for field in required_fields:
        if field in data:
            log_test(f"1.2 Field '{field}' present", True, f"Value: {data[field]}")
        else:
            log_test(f"1.2 Field '{field}' present", False, "Field missing")
    
    # Check specific values
    if data.get("panel_url") == "https://panel.1.hostbay.io":
        log_test("1.3 panel_url correct", True, "https://panel.1.hostbay.io")
    else:
        log_test("1.3 panel_url correct", False, f"Got: {data.get('panel_url')}")
    
    if data.get("server_ip") == "68.183.77.106":
        log_test("1.4 server_ip correct", True, "68.183.77.106")
    else:
        log_test("1.4 server_ip correct", False, f"Got: {data.get('server_ip')}")
    
    if data.get("mode") == "dry_run":
        log_test("1.5 mode is 'dry_run'", True)
    else:
        log_test("1.5 mode is 'dry_run'", False, f"Got: {data.get('mode')}")
    
    # CRITICAL: panel_pin MUST be null
    if data.get("panel_pin") is None:
        log_test("1.6 CRITICAL: panel_pin is null", True, "PIN not revealed in dry_run mode")
    else:
        log_test("1.6 CRITICAL: panel_pin is null", False, f"Got: {data.get('panel_pin')} - THIS IS A SECURITY ISSUE!")
    
    # CRITICAL: direct_cpanel_login_url MUST be null
    if data.get("direct_cpanel_login_url") is None:
        log_test("1.7 CRITICAL: direct_cpanel_login_url is null", True, "Direct login not available in dry_run mode")
    else:
        log_test("1.7 CRITICAL: direct_cpanel_login_url is null", False, f"Got: {data.get('direct_cpanel_login_url')}")
    
    # Check for note about PIN reveal being live-only
    note_found = False
    for key in ["note", "message", "warning", "info"]:
        if key in data and data[key] and "live" in str(data[key]).lower():
            note_found = True
            log_test("1.8 Note about PIN reveal being live-only", True, f"Found in '{key}': {data[key]}")
            break
    
    if not note_found:
        log_test("1.8 Note about PIN reveal being live-only", False, "No note found about live-only PIN reveal")
    
    # Check nameservers is an array
    if isinstance(data.get("nameservers"), list):
        log_test("1.9 nameservers is an array", True, f"Length: {len(data.get('nameservers', []))}")
    else:
        log_test("1.9 nameservers is an array", False, f"Got type: {type(data.get('nameservers'))}")

def test_hosting_details_with_deliverables():
    """Test 2: GET /hosting/:user with deliverables object"""
    print("\n" + "="*80)
    print("TEST 2: GET /hosting/nbaykkd4zh (with deliverables)")
    print("="*80)
    
    headers = {"X-API-Key": API_KEY}
    status, data = make_request("GET", f"/hosting/{TEST_HOSTING_USER}", headers=headers)
    
    # Check status code
    if status == 200:
        log_test("2.1 Status code 200", True)
    else:
        log_test("2.1 Status code 200", False, f"Got {status}")
        return
    
    # Check deliverables object exists
    if "deliverables" in data:
        log_test("2.2 deliverables object present", True)
        deliverables = data["deliverables"]
        
        # Check required fields in deliverables
        required_fields = ["cpanel_username", "panel_url", "server_ip", "nameservers", "credentials_url"]
        for field in required_fields:
            if field in deliverables:
                log_test(f"2.3 deliverables.{field} present", True, f"Value: {deliverables[field]}")
            else:
                log_test(f"2.3 deliverables.{field} present", False, "Field missing")
    else:
        log_test("2.2 deliverables object present", False, "deliverables object missing")

def test_hosting_list_with_deliverables():
    """Test 3: GET /hosting (list) with top-level panel_url + server_ip"""
    print("\n" + "="*80)
    print("TEST 3: GET /hosting (list with deliverables)")
    print("="*80)
    
    headers = {"X-API-Key": API_KEY}
    status, data = make_request("GET", "/hosting", headers=headers)
    
    # Check status code
    if status == 200:
        log_test("3.1 Status code 200", True)
    else:
        log_test("3.1 Status code 200", False, f"Got {status}")
        return
    
    # Check top-level panel_url
    if "panel_url" in data:
        log_test("3.2 Top-level panel_url present", True, f"Value: {data['panel_url']}")
    else:
        log_test("3.2 Top-level panel_url present", False, "Field missing")
    
    # Check top-level server_ip
    if "server_ip" in data:
        log_test("3.3 Top-level server_ip present", True, f"Value: {data['server_ip']}")
    else:
        log_test("3.3 Top-level server_ip present", False, "Field missing")
    
    # Check accounts array
    if "accounts" in data and isinstance(data["accounts"], list):
        log_test("3.4 accounts array present", True, f"Count: {len(data['accounts'])}")
        
        # Check each account has expires_at and credentials_url
        if len(data["accounts"]) > 0:
            for i, account in enumerate(data["accounts"]):
                account_id = account.get("username", f"account_{i}")
                
                if "expires_at" in account:
                    log_test(f"3.5 Account '{account_id}' has expires_at", True, f"Value: {account['expires_at']}")
                else:
                    log_test(f"3.5 Account '{account_id}' has expires_at", False, "Field missing")
                
                if "credentials_url" in account:
                    log_test(f"3.6 Account '{account_id}' has credentials_url", True, f"Value: {account['credentials_url']}")
                else:
                    log_test(f"3.6 Account '{account_id}' has credentials_url", False, "Field missing")
        else:
            log_test("3.5 Check account fields", True, "No accounts to check (empty list is acceptable)")
    else:
        log_test("3.4 accounts array present", False, "accounts array missing or not a list")

def test_domains_list_with_deliverables():
    """Test 4: GET /domains with deliverables fields"""
    print("\n" + "="*80)
    print("TEST 4: GET /domains (with deliverables)")
    print("="*80)
    
    headers = {"X-API-Key": API_KEY}
    status, data = make_request("GET", "/domains", headers=headers)
    
    # Check status code
    if status == 200:
        log_test("4.1 Status code 200", True)
    else:
        log_test("4.1 Status code 200", False, f"Got {status}")
        return
    
    # Check domains array
    if "domains" in data and isinstance(data["domains"], list):
        log_test("4.2 domains array present", True, f"Count: {len(data['domains'])}")
        
        # Check each domain has required fields
        if len(data["domains"]) > 0:
            for i, domain in enumerate(data["domains"]):
                domain_name = domain.get("domain", f"domain_{i}")
                
                required_fields = ["nameserver_type", "nameservers", "expires_at", "dns_records_url", "nameservers_url"]
                for field in required_fields:
                    if field in domain:
                        log_test(f"4.3 Domain '{domain_name}' has {field}", True, f"Value: {domain[field]}")
                    else:
                        log_test(f"4.3 Domain '{domain_name}' has {field}", False, "Field missing")
        else:
            log_test("4.3 Check domain fields", True, "No domains to check (empty list is acceptable for this owner)")
    else:
        log_test("4.2 domains array present", False, "domains array missing or not a list")

def test_credentials_auth():
    """Test 5: Auth on credentials endpoint"""
    print("\n" + "="*80)
    print("TEST 5: Auth on /hosting/:user/credentials")
    print("="*80)
    
    # Test without key
    status, data = make_request("GET", f"/hosting/{TEST_HOSTING_USER}/credentials", headers={})
    if status == 401:
        log_test("5.1 Without API key → 401", True, f"Error: {data.get('error', 'N/A')}")
    else:
        log_test("5.1 Without API key → 401", False, f"Got {status}")
    
    # Test with invalid key
    headers = {"X-API-Key": "invalid_key_12345"}
    status, data = make_request("GET", f"/hosting/{TEST_HOSTING_USER}/credentials", headers=headers)
    if status == 401:
        log_test("5.2 With invalid API key → 401", True, f"Error: {data.get('error', 'N/A')}")
    else:
        log_test("5.2 With invalid API key → 401", False, f"Got {status}")

def test_regression():
    """Test 6: Quick regression check"""
    print("\n" + "="*80)
    print("TEST 6: Regression check (previously tested endpoints)")
    print("="*80)
    
    headers = {"X-API-Key": API_KEY}
    
    # 6.1 GET /hosting/plans
    status, data = make_request("GET", "/hosting/plans", headers=headers)
    if status == 200:
        # Check for gold plan with visitor_captcha_available
        gold_found = False
        for plan in data.get("plans", []):
            if "gold" in plan.get("plan_id", "").lower():
                if plan.get("visitor_captcha_available") == True:
                    gold_found = True
                    log_test("6.1 GET /hosting/plans → 200, gold has visitor_captcha_available", True)
                    break
        if not gold_found:
            log_test("6.1 GET /hosting/plans → 200, gold has visitor_captcha_available", False, "Gold plan not found or missing visitor_captcha_available")
    else:
        log_test("6.1 GET /hosting/plans → 200", False, f"Got {status}")
    
    # 6.2 GET /renewals
    status, data = make_request("GET", "/renewals", headers=headers)
    if status == 200:
        log_test("6.2 GET /renewals → 200", True, f"Count: {data.get('count', 'N/A')}")
    else:
        log_test("6.2 GET /renewals → 200", False, f"Got {status}")
    
    # 6.3 GET /hosting/captcha/:domain
    status, data = make_request("GET", f"/hosting/captcha/{TEST_DOMAIN}", headers=headers)
    if status == 200:
        if data.get("gold_plan") == True:
            log_test("6.3 GET /hosting/captcha/testingbays.sbs → 200, gold_plan:true", True)
        else:
            log_test("6.3 GET /hosting/captcha/testingbays.sbs → 200, gold_plan:true", False, f"gold_plan: {data.get('gold_plan')}")
    else:
        log_test("6.3 GET /hosting/captcha/testingbays.sbs → 200", False, f"Got {status}")
    
    # 6.4 POST /hosting/:user/renew
    status, data = make_request("POST", f"/hosting/{TEST_HOSTING_USER}/renew", headers=headers)
    if status == 402:
        if data.get("error") == "insufficient_wallet_balance":
            log_test("6.4 POST /hosting/nbaykkd4zh/renew → 402 insufficient", True)
        else:
            log_test("6.4 POST /hosting/nbaykkd4zh/renew → 402 insufficient", False, f"Error: {data.get('error')}")
    else:
        log_test("6.4 POST /hosting/nbaykkd4zh/renew → 402", False, f"Got {status}")
    
    # 6.5 GET /hosting/:user/addons
    status, data = make_request("GET", f"/hosting/{TEST_HOSTING_USER}/addons", headers=headers)
    if status == 200:
        log_test("6.5 GET /hosting/nbaykkd4zh/addons → 200", True, f"Addon quota: {data.get('addon_quota', 'N/A')}")
    else:
        log_test("6.5 GET /hosting/nbaykkd4zh/addons → 200", False, f"Got {status}")

def test_wallet_unchanged():
    """Test 7: Verify wallet balance unchanged"""
    print("\n" + "="*80)
    print("TEST 7: Verify wallet balance unchanged")
    print("="*80)
    
    headers = {"X-API-Key": API_KEY}
    status, data = make_request("GET", "/account", headers=headers)
    
    if status == 200:
        wallet = data.get("wallet_balance_usd")
        if wallet == EXPECTED_WALLET:
            log_test("7.1 Wallet balance unchanged", True, f"Wallet: ${wallet} (expected: ${EXPECTED_WALLET})")
        else:
            log_test("7.1 Wallet balance unchanged", False, f"Wallet: ${wallet} (expected: ${EXPECTED_WALLET}) - WALLET WAS CHARGED!")
    else:
        log_test("7.1 Wallet balance check", False, f"Failed to get account info, status: {status}")

def print_summary():
    """Print test summary"""
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"Total tests: {passed + failed}")
    print(f"Passed: {passed}")
    print(f"Failed: {failed}")
    print(f"Pass rate: {(passed / (passed + failed) * 100):.1f}%")
    print("="*80)
    
    if failed > 0:
        print("\n❌ FAILED TESTS:")
        for result in test_results:
            if "❌ FAIL" in result:
                print(result)
    
    return failed == 0

def main():
    """Run all tests"""
    print("="*80)
    print("Reseller API Deliverables Test Suite")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"API Key: {API_KEY[:20]}...")
    print(f"Owner: {OWNER_CHAT_ID}")
    print(f"Expected wallet: ${EXPECTED_WALLET}")
    print("="*80)
    
    # Run all tests
    test_credentials_endpoint()
    test_hosting_details_with_deliverables()
    test_hosting_list_with_deliverables()
    test_domains_list_with_deliverables()
    test_credentials_auth()
    test_regression()
    test_wallet_unchanged()
    
    # Print summary
    success = print_summary()
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)

if __name__ == "__main__":
    main()
