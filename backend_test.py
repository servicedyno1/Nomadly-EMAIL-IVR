#!/usr/bin/env python3
"""
Backend Test Script for Task 2026-10-11
3 fixes: shortener deactivation guard + single Visitor Captcha + Safe Browsing monitor

CRITICAL SAFETY CONSTRAINTS:
- Reseller API (/api/reseller/v1/*) is wired to LIVE PRODUCTION database
- DO NOT create or modify any reseller API key
- DO NOT call ANY mutating method (POST/PUT/PATCH/DELETE) on /api/reseller/v1/*
- DO NOT send any Authorization/X-API-Key header to /api/reseller/v1/*
- Only the exact GET calls listed are allowed

Tests:
1. HostPanel login (POST /api/panel/login) for Gold and Premium accounts
2. GET /api/panel/security/captcha/status with Gold token
3. GET /api/panel/security/captcha/status with Premium token
4. POST /api/panel/security/captcha/toggle with Premium token (expect 403 block)
5. GET /api/panel/security/status with Gold token
6. Routing check of new reseller endpoints WITHOUT any key/header (expect 401)
"""

import requests
import json
import sys

# Configuration
BASE_URL = "https://vault-setup-24.preview.emergentagent.com"

# Test accounts (seeded in LOCAL DB - safe to use)
GOLD_ACCOUNT = {"username": "goldtest", "pin": "123456"}
PREMIUM_ACCOUNT = {"username": "premtest", "pin": "123456"}

# Test results tracking
tests_passed = 0
tests_failed = 0
test_results = []

def log_test(name, passed, details="", response_snippet=""):
    """Log test result"""
    global tests_passed, tests_failed
    status = "✅ PASS" if passed else "❌ FAIL"
    result = {
        "name": name,
        "status": status,
        "passed": passed,
        "details": details,
        "response_snippet": response_snippet
    }
    test_results.append(result)
    
    print(f"\n{status}: {name}")
    if details:
        print(f"  Details: {details}")
    if response_snippet:
        print(f"  Response: {response_snippet}")
    
    if passed:
        tests_passed += 1
    else:
        tests_failed += 1

def test_1_hostpanel_login():
    """Test 1: HostPanel login for Gold and Premium accounts"""
    print("\n" + "="*80)
    print("TEST 1: HostPanel Login")
    print("="*80)
    
    tokens = {}
    
    # Test Gold account login
    print(f"\n1a. POST /api/panel/login (Gold account: {GOLD_ACCOUNT['username']})")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/panel/login",
            json={"username": GOLD_ACCOUNT["username"], "pin": GOLD_ACCOUNT["pin"]},
            timeout=30
        )
        
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("token")
            if token:
                tokens["gold"] = token
                log_test(
                    "Gold account login",
                    True,
                    f"Status: {resp.status_code}, Token received",
                    f"token: {token[:20]}..."
                )
            else:
                log_test(
                    "Gold account login",
                    False,
                    f"Status: {resp.status_code}, No token in response",
                    json.dumps(data, indent=2)[:200]
                )
        else:
            log_test(
                "Gold account login",
                False,
                f"Status: {resp.status_code}",
                resp.text[:200]
            )
    except Exception as e:
        log_test("Gold account login", False, f"Exception: {str(e)}")
    
    # Test Premium account login
    print(f"\n1b. POST /api/panel/login (Premium account: {PREMIUM_ACCOUNT['username']})")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/panel/login",
            json={"username": PREMIUM_ACCOUNT["username"], "pin": PREMIUM_ACCOUNT["pin"]},
            timeout=30
        )
        
        if resp.status_code == 200:
            data = resp.json()
            token = data.get("token")
            if token:
                tokens["premium"] = token
                log_test(
                    "Premium account login",
                    True,
                    f"Status: {resp.status_code}, Token received",
                    f"token: {token[:20]}..."
                )
            else:
                log_test(
                    "Premium account login",
                    False,
                    f"Status: {resp.status_code}, No token in response",
                    json.dumps(data, indent=2)[:200]
                )
        else:
            log_test(
                "Premium account login",
                False,
                f"Status: {resp.status_code}",
                resp.text[:200]
            )
    except Exception as e:
        log_test("Premium account login", False, f"Exception: {str(e)}")
    
    return tokens

def test_2_captcha_status_gold(gold_token):
    """Test 2: GET /api/panel/security/captcha/status with Gold token"""
    print("\n" + "="*80)
    print("TEST 2: Captcha Status - Gold Account")
    print("="*80)
    
    if not gold_token:
        log_test("Captcha status (Gold)", False, "No Gold token available")
        return
    
    print("\n2. GET /api/panel/security/captcha/status (Gold token)")
    try:
        resp = requests.get(
            f"{BASE_URL}/api/panel/security/captcha/status",
            headers={"Authorization": f"Bearer {gold_token}"},
            timeout=30
        )
        
        if resp.status_code == 200:
            data = resp.json()
            
            # Check expected fields
            is_gold = data.get("isGold")
            captcha_gold_only = data.get("captchaGoldOnly")
            plan = data.get("plan", "")
            domains = data.get("domains", [])
            
            # Extract domain names (domains can be strings or objects with 'domain' property)
            domain_names = []
            for d in domains:
                if isinstance(d, str):
                    domain_names.append(d)
                elif isinstance(d, dict) and "domain" in d:
                    domain_names.append(d["domain"])
            
            # Verify expectations
            checks = []
            checks.append(("isGold is True", is_gold == True))
            checks.append(("captchaGoldOnly is True", captcha_gold_only == True))
            checks.append(("plan contains 'Golden Anti-Red HostPanel'", "Golden Anti-Red HostPanel" in plan))
            checks.append(("domains includes goldtest.com", "goldtest.com" in domain_names))
            checks.append(("domains includes goldaddon.com", "goldaddon.com" in domain_names))
            
            all_passed = all(check[1] for check in checks)
            
            details = "\n    ".join([f"{'✓' if check[1] else '✗'} {check[0]}" for check in checks])
            
            log_test(
                "Captcha status (Gold)",
                all_passed,
                details,
                json.dumps({
                    "isGold": is_gold,
                    "captchaGoldOnly": captcha_gold_only,
                    "plan": plan,
                    "domains": domains
                }, indent=2)[:300]
            )
        else:
            log_test(
                "Captcha status (Gold)",
                False,
                f"Status: {resp.status_code}",
                resp.text[:200]
            )
    except Exception as e:
        log_test("Captcha status (Gold)", False, f"Exception: {str(e)}")

def test_3_captcha_status_premium(premium_token):
    """Test 3: GET /api/panel/security/captcha/status with Premium token"""
    print("\n" + "="*80)
    print("TEST 3: Captcha Status - Premium Account")
    print("="*80)
    
    if not premium_token:
        log_test("Captcha status (Premium)", False, "No Premium token available")
        return
    
    print("\n3. GET /api/panel/security/captcha/status (Premium token)")
    try:
        resp = requests.get(
            f"{BASE_URL}/api/panel/security/captcha/status",
            headers={"Authorization": f"Bearer {premium_token}"},
            timeout=30
        )
        
        if resp.status_code == 200:
            data = resp.json()
            
            # Check expected fields
            is_gold = data.get("isGold")
            captcha_gold_only = data.get("captchaGoldOnly")
            plan = data.get("plan", "")
            
            # Verify expectations
            checks = []
            checks.append(("isGold is False", is_gold == False))
            checks.append(("captchaGoldOnly is True", captcha_gold_only == True))
            checks.append(("plan contains 'Premium'", "Premium" in plan))
            
            all_passed = all(check[1] for check in checks)
            
            details = "\n    ".join([f"{'✓' if check[1] else '✗'} {check[0]}" for check in checks])
            
            log_test(
                "Captcha status (Premium)",
                all_passed,
                details,
                json.dumps({
                    "isGold": is_gold,
                    "captchaGoldOnly": captcha_gold_only,
                    "plan": plan
                }, indent=2)[:300]
            )
        else:
            log_test(
                "Captcha status (Premium)",
                False,
                f"Status: {resp.status_code}",
                resp.text[:200]
            )
    except Exception as e:
        log_test("Captcha status (Premium)", False, f"Exception: {str(e)}")

def test_4_captcha_toggle_premium(premium_token):
    """Test 4: POST /api/panel/security/captcha/toggle with Premium token (expect block)"""
    print("\n" + "="*80)
    print("TEST 4: Captcha Toggle - Premium Account (expect 403 block)")
    print("="*80)
    
    if not premium_token:
        log_test("Captcha toggle block (Premium)", False, "No Premium token available")
        return
    
    print("\n4. POST /api/panel/security/captcha/toggle (Premium token, expect 403)")
    try:
        resp = requests.post(
            f"{BASE_URL}/api/panel/security/captcha/toggle",
            headers={"Authorization": f"Bearer {premium_token}"},
            json={"domain": "premtest.com", "enabled": True},
            timeout=30
        )
        
        # Expect either HTTP 403 OR a JSON body with captchaGoldOnly:true / isGold:false
        if resp.status_code == 403:
            log_test(
                "Captcha toggle block (Premium)",
                True,
                f"Status: {resp.status_code} (correctly blocked)",
                resp.text[:200]
            )
        elif resp.status_code == 200:
            data = resp.json()
            captcha_gold_only = data.get("captchaGoldOnly")
            is_gold = data.get("isGold")
            
            if captcha_gold_only == True or is_gold == False:
                log_test(
                    "Captcha toggle block (Premium)",
                    True,
                    f"Status: {resp.status_code}, Response indicates Gold-only restriction",
                    json.dumps(data, indent=2)[:200]
                )
            else:
                log_test(
                    "Captcha toggle block (Premium)",
                    False,
                    f"Status: {resp.status_code}, Response does not indicate Gold-only restriction",
                    json.dumps(data, indent=2)[:200]
                )
        else:
            log_test(
                "Captcha toggle block (Premium)",
                False,
                f"Status: {resp.status_code} (expected 403 or 200 with Gold-only indicator)",
                resp.text[:200]
            )
    except Exception as e:
        log_test("Captcha toggle block (Premium)", False, f"Exception: {str(e)}")

def test_5_security_status_gold(gold_token):
    """Test 5: GET /api/panel/security/status with Gold token"""
    print("\n" + "="*80)
    print("TEST 5: Security Status - Gold Account")
    print("="*80)
    
    if not gold_token:
        log_test("Security status (Gold)", False, "No Gold token available")
        return
    
    print("\n5. GET /api/panel/security/status (Gold token)")
    try:
        resp = requests.get(
            f"{BASE_URL}/api/panel/security/status",
            headers={"Authorization": f"Bearer {gold_token}"},
            timeout=30
        )
        
        if resp.status_code == 200:
            data = resp.json()
            
            # Check that response is valid JSON and includes protectionLayers
            protection_layers = data.get("protectionLayers")
            has_cf_worker = "cfWorker" in data if isinstance(data, dict) else False
            
            checks = []
            checks.append(("Response is valid JSON", isinstance(data, dict)))
            checks.append(("protectionLayers present", protection_layers is not None))
            
            all_passed = all(check[1] for check in checks)
            
            details = "\n    ".join([f"{'✓' if check[1] else '✗'} {check[0]}" for check in checks])
            if has_cf_worker:
                details += f"\n    ℹ cfWorker key present in response (value: {data.get('cfWorker')})"
            else:
                details += "\n    ℹ cfWorker key NOT present in response"
            
            log_test(
                "Security status (Gold)",
                all_passed,
                details,
                json.dumps(data, indent=2)[:400]
            )
        else:
            log_test(
                "Security status (Gold)",
                False,
                f"Status: {resp.status_code}",
                resp.text[:200]
            )
    except Exception as e:
        log_test("Security status (Gold)", False, f"Exception: {str(e)}")

def test_6_reseller_endpoints_routing():
    """Test 6: Routing check of new reseller endpoints WITHOUT any key/header"""
    print("\n" + "="*80)
    print("TEST 6: Reseller Endpoints Routing (NO auth, expect 401)")
    print("="*80)
    
    # Test 6a: GET /api/reseller/v1/safe-browsing/flags
    print("\n6a. GET /api/reseller/v1/safe-browsing/flags (no auth)")
    try:
        resp = requests.get(
            f"{BASE_URL}/api/reseller/v1/safe-browsing/flags",
            timeout=30
        )
        
        if resp.status_code == 401:
            data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            error = data.get("error", "")
            
            if error == "missing_api_key":
                log_test(
                    "Reseller /safe-browsing/flags routing",
                    True,
                    f"Status: {resp.status_code}, error: {error} (route mounted correctly)",
                    json.dumps(data, indent=2)[:200]
                )
            else:
                log_test(
                    "Reseller /safe-browsing/flags routing",
                    True,
                    f"Status: {resp.status_code} (route mounted, auth required)",
                    resp.text[:200]
                )
        else:
            log_test(
                "Reseller /safe-browsing/flags routing",
                False,
                f"Status: {resp.status_code} (expected 401)",
                resp.text[:200]
            )
    except Exception as e:
        log_test("Reseller /safe-browsing/flags routing", False, f"Exception: {str(e)}")
    
    # Test 6b: GET /api/reseller/v1/safe-browsing/status?domain=example.com
    print("\n6b. GET /api/reseller/v1/safe-browsing/status?domain=example.com (no auth)")
    try:
        resp = requests.get(
            f"{BASE_URL}/api/reseller/v1/safe-browsing/status",
            params={"domain": "example.com"},
            timeout=30
        )
        
        if resp.status_code == 401:
            data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            error = data.get("error", "")
            
            if error == "missing_api_key":
                log_test(
                    "Reseller /safe-browsing/status routing",
                    True,
                    f"Status: {resp.status_code}, error: {error} (route mounted correctly)",
                    json.dumps(data, indent=2)[:200]
                )
            else:
                log_test(
                    "Reseller /safe-browsing/status routing",
                    True,
                    f"Status: {resp.status_code} (route mounted, auth required)",
                    resp.text[:200]
                )
        else:
            log_test(
                "Reseller /safe-browsing/status routing",
                False,
                f"Status: {resp.status_code} (expected 401)",
                resp.text[:200]
            )
    except Exception as e:
        log_test("Reseller /safe-browsing/status routing", False, f"Exception: {str(e)}")

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("BACKEND TEST: 3 fixes verification")
    print("Task: 2026-10-11")
    print("  1. Shortener deactivation guard")
    print("  2. Single Visitor Captcha")
    print("  3. Safe Browsing monitor")
    print("="*80)
    print(f"\nBase URL: {BASE_URL}")
    print(f"Gold account: {GOLD_ACCOUNT['username']}")
    print(f"Premium account: {PREMIUM_ACCOUNT['username']}")
    print("\n⚠️  CRITICAL: This test does NOT call mutating reseller API endpoints")
    print("⚠️  CRITICAL: This test does NOT use any reseller API keys")
    
    try:
        # Run all tests
        tokens = test_1_hostpanel_login()
        
        gold_token = tokens.get("gold")
        premium_token = tokens.get("premium")
        
        test_2_captcha_status_gold(gold_token)
        test_3_captcha_status_premium(premium_token)
        test_4_captcha_toggle_premium(premium_token)
        test_5_security_status_gold(gold_token)
        test_6_reseller_endpoints_routing()
        
        # Summary
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        print(f"\n✅ Tests Passed: {tests_passed}")
        print(f"❌ Tests Failed: {tests_failed}")
        print(f"📊 Total Tests: {tests_passed + tests_failed}")
        if tests_passed + tests_failed > 0:
            print(f"📈 Pass Rate: {tests_passed / (tests_passed + tests_failed) * 100:.1f}%")
        
        # Detailed results
        print("\n" + "="*80)
        print("DETAILED RESULTS")
        print("="*80)
        for i, result in enumerate(test_results, 1):
            print(f"\n{i}. {result['status']} {result['name']}")
            if result['details']:
                print(f"   {result['details']}")
        
        # Exit code
        sys.exit(0 if tests_failed == 0 else 1)
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Test suite failed with exception: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
