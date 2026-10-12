#!/usr/bin/env python3
"""
Web Storefront PHASE 2 Backend Testing
Tests: buy hosting from wallet + my-plans + panel bridge + refund integrity

Base URL: https://vault-setup-24.preview.emergentagent.com/api/store

Test Accounts (seeded):
- BUYER: storebuyer@example.com / password1234 (wallet $200, owns webtest01/weblinked-test.example)
- BROKE: storebroke@example.com / password1234 (wallet $0)
"""

import requests
import json
import time
import random
import string
from datetime import datetime

BASE_URL = "https://vault-setup-24.preview.emergentagent.com/api/store"

class StorefrontPhase2Tester:
    def __init__(self):
        self.base_url = BASE_URL
        self.buyer_token = None
        self.broke_token = None
        self.test_results = []
        self.failed_tests = []
        self.passed_tests = []
        
    def log_test(self, test_num, test_name, passed, expected, actual, details=""):
        """Log test result with detailed info"""
        result = {
            "test_num": test_num,
            "test": test_name,
            "passed": passed,
            "expected": expected,
            "actual": actual,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        
        if passed:
            self.passed_tests.append(test_name)
            print(f"✅ Test #{test_num}: {test_name}")
            print(f"   Expected: {expected}")
            print(f"   Actual: {actual}")
        else:
            self.failed_tests.append(test_name)
            print(f"❌ Test #{test_num}: {test_name}")
            print(f"   Expected: {expected}")
            print(f"   Actual: {actual}")
            if details:
                print(f"   Details: {details}")
        print()
            
    def make_request(self, method, endpoint, data=None, headers=None, timeout=15):
        """Make HTTP request with error handling"""
        url = f"{self.base_url}{endpoint}"
        try:
            if method == "GET":
                response = requests.get(url, headers=headers, timeout=timeout)
            elif method == "POST":
                response = requests.post(url, json=data, headers=headers, timeout=timeout)
            else:
                raise ValueError(f"Unsupported method: {method}")
            return response
        except requests.exceptions.Timeout:
            print(f"⚠️  Request timeout for {endpoint}")
            return None
        except requests.exceptions.RequestException as e:
            print(f"⚠️  Request failed for {endpoint}: {e}")
            return None
    
    def login(self, email, password):
        """Login and return token"""
        response = self.make_request("POST", "/auth/login", {
            "email": email,
            "password": password
        })
        if response and response.status_code == 200:
            data = response.json()
            return data.get("token")
        return None
    
    def setup_auth(self):
        """Login both test users"""
        print("=== Setting up authentication ===")
        self.buyer_token = self.login("storebuyer@example.com", "password1234")
        self.broke_token = self.login("storebroke@example.com", "password1234")
        
        if not self.buyer_token:
            print("❌ Failed to login BUYER account")
            return False
        if not self.broke_token:
            print("❌ Failed to login BROKE account")
            return False
            
        print(f"✅ BUYER token: {self.buyer_token[:20]}...")
        print(f"✅ BROKE token: {self.broke_token[:20]}...")
        print()
        return True
    
    def test_1_get_plans(self):
        """Test 1: GET /plans (no auth) → 200, exactly 3 plans"""
        print("=== Test 1: GET /plans (no auth) ===")
        response = self.make_request("GET", "/plans")
        
        if not response:
            self.log_test(1, "GET /plans", False, "200 with 3 plans", "No response", "Request failed")
            return
        
        if response.status_code != 200:
            self.log_test(1, "GET /plans", False, "200", f"{response.status_code}", response.text[:200])
            return
        
        data = response.json()
        plans = data.get("plans", [])
        plan_ids = [p.get("id") for p in plans]
        
        expected_ids = ["premium-weekly", "premium-monthly", "golden-monthly"]
        if len(plans) == 3 and set(plan_ids) == set(expected_ids):
            self.log_test(1, "GET /plans", True, 
                         "3 plans: premium-weekly, premium-monthly, golden-monthly",
                         f"3 plans: {', '.join(plan_ids)}")
        else:
            self.log_test(1, "GET /plans", False,
                         f"3 plans with ids {expected_ids}",
                         f"{len(plans)} plans: {plan_ids}")
    
    def test_2_get_my_plans(self):
        """Test 2: GET /my-plans (BUYER) → 200, contains weblinked-test.example"""
        print("=== Test 2: GET /my-plans (BUYER) ===")
        headers = {"Authorization": f"Bearer {self.buyer_token}"}
        response = self.make_request("GET", "/my-plans", headers=headers)
        
        if not response:
            self.log_test(2, "GET /my-plans (BUYER)", False, "200 with weblinked-test.example", "No response")
            return
        
        if response.status_code != 200:
            self.log_test(2, "GET /my-plans (BUYER)", False, "200", f"{response.status_code}", response.text[:200])
            return
        
        data = response.json()
        plans = data.get("plans", [])
        domains = [p.get("domain") for p in plans]
        
        if "weblinked-test.example" in domains:
            self.log_test(2, "GET /my-plans (BUYER)", True,
                         "plans array contains weblinked-test.example",
                         f"Found: {domains}")
        else:
            self.log_test(2, "GET /my-plans (BUYER)", False,
                         "plans array contains weblinked-test.example",
                         f"Domains found: {domains}")
    
    def test_3_open_panel_valid(self):
        """Test 3: POST /open-panel (BUYER) {cpUser:webtest01} → 200, token + domain"""
        print("=== Test 3: POST /open-panel (BUYER) valid cpUser ===")
        headers = {"Authorization": f"Bearer {self.buyer_token}"}
        response = self.make_request("POST", "/open-panel", 
                                     {"cpUser": "webtest01"}, 
                                     headers=headers)
        
        if not response:
            self.log_test(3, "POST /open-panel (valid)", False, "200 with token + domain", "No response")
            return
        
        if response.status_code != 200:
            self.log_test(3, "POST /open-panel (valid)", False, "200", f"{response.status_code}", response.text[:200])
            return
        
        data = response.json()
        token = data.get("token")
        domain = data.get("domain")
        
        if token and domain == "weblinked-test.example":
            self.log_test(3, "POST /open-panel (valid)", True,
                         "200 with non-empty token and domain=weblinked-test.example",
                         f"token present, domain={domain}")
        else:
            self.log_test(3, "POST /open-panel (valid)", False,
                         "token + domain=weblinked-test.example",
                         f"token={bool(token)}, domain={domain}")
    
    def test_4_open_panel_invalid(self):
        """Test 4: POST /open-panel (BUYER) {cpUser:doesnotexist} → 404"""
        print("=== Test 4: POST /open-panel (BUYER) invalid cpUser ===")
        headers = {"Authorization": f"Bearer {self.buyer_token}"}
        response = self.make_request("POST", "/open-panel",
                                     {"cpUser": "doesnotexist"},
                                     headers=headers)
        
        if not response:
            self.log_test(4, "POST /open-panel (invalid)", False, "404", "No response")
            return
        
        if response.status_code == 404:
            self.log_test(4, "POST /open-panel (invalid)", True, "404", "404")
        else:
            self.log_test(4, "POST /open-panel (invalid)", False, "404", 
                         f"{response.status_code}: {response.text[:200]}")
    
    def test_5_get_wallet(self):
        """Test 5: GET /wallet (BUYER) → 200, balanceUsd == 200"""
        print("=== Test 5: GET /wallet (BUYER) ===")
        headers = {"Authorization": f"Bearer {self.buyer_token}"}
        response = self.make_request("GET", "/wallet", headers=headers)
        
        if not response:
            self.log_test(5, "GET /wallet (BUYER)", False, "200, balance=200", "No response")
            return
        
        if response.status_code != 200:
            self.log_test(5, "GET /wallet (BUYER)", False, "200", f"{response.status_code}", response.text[:200])
            return
        
        data = response.json()
        balance = data.get("balanceUsd")
        
        if balance == 200:
            self.log_test(5, "GET /wallet (BUYER)", True, "balanceUsd=200", f"balanceUsd={balance}")
        else:
            self.log_test(5, "GET /wallet (BUYER)", False, "balanceUsd=200", f"balanceUsd={balance}")
    
    def test_6_purchase_invalid_plan(self):
        """Test 6: POST /hosting/purchase (BUYER) {planId:nope} → 400"""
        print("=== Test 6: POST /hosting/purchase invalid plan ===")
        headers = {"Authorization": f"Bearer {self.buyer_token}"}
        response = self.make_request("POST", "/hosting/purchase",
                                     {"planId": "nope", "domain": "x.com", "domainMode": "byo"},
                                     headers=headers)
        
        if not response:
            self.log_test(6, "POST /hosting/purchase (invalid plan)", False, "400", "No response")
            return
        
        if response.status_code == 400:
            self.log_test(6, "POST /hosting/purchase (invalid plan)", True, "400 (unknown plan)", "400")
        else:
            self.log_test(6, "POST /hosting/purchase (invalid plan)", False, "400",
                         f"{response.status_code}: {response.text[:200]}")
    
    def test_7_purchase_duplicate_domain(self):
        """Test 7: POST /hosting/purchase (BUYER) existing domain → 409"""
        print("=== Test 7: POST /hosting/purchase duplicate domain ===")
        headers = {"Authorization": f"Bearer {self.buyer_token}"}
        response = self.make_request("POST", "/hosting/purchase",
                                     {"planId": "premium-weekly", 
                                      "domain": "weblinked-test.example",
                                      "domainMode": "byo"},
                                     headers=headers)
        
        if not response:
            self.log_test(7, "POST /hosting/purchase (duplicate)", False, "409", "No response")
            return
        
        if response.status_code == 409:
            self.log_test(7, "POST /hosting/purchase (duplicate)", True, 
                         "409 (domain already has hosting)", "409")
        else:
            self.log_test(7, "POST /hosting/purchase (duplicate)", False, "409",
                         f"{response.status_code}: {response.text[:200]}")
    
    def test_8_purchase_insufficient_balance(self):
        """Test 8: POST /hosting/purchase (BROKE) → 402, needTopup=true"""
        print("=== Test 8: POST /hosting/purchase insufficient balance ===")
        headers = {"Authorization": f"Bearer {self.broke_token}"}
        response = self.make_request("POST", "/hosting/purchase",
                                     {"planId": "premium-weekly",
                                      "domain": "brokebuy-test.example",
                                      "domainMode": "byo"},
                                     headers=headers)
        
        if not response:
            self.log_test(8, "POST /hosting/purchase (broke)", False, "402 with needTopup=true", "No response")
            return
        
        if response.status_code != 402:
            self.log_test(8, "POST /hosting/purchase (broke)", False, "402",
                         f"{response.status_code}: {response.text[:200]}")
            return
        
        data = response.json()
        need_topup = data.get("needTopup")
        
        if need_topup is True:
            self.log_test(8, "POST /hosting/purchase (broke)", True,
                         "402 with needTopup=true",
                         f"402, needTopup={need_topup}")
        else:
            self.log_test(8, "POST /hosting/purchase (broke)", False,
                         "402 with needTopup=true",
                         f"402, needTopup={need_topup}")
    
    def test_9_refund_integrity(self):
        """Test 9: REFUND INTEGRITY - purchase fails → wallet refunded"""
        print("=== Test 9: REFUND INTEGRITY (most important) ===")
        
        # Step 1: Get initial balance
        headers = {"Authorization": f"Bearer {self.buyer_token}"}
        wallet_response = self.make_request("GET", "/wallet", headers=headers)
        
        if not wallet_response or wallet_response.status_code != 200:
            self.log_test(9, "REFUND INTEGRITY", False, "Balance 200→200 after failed purchase",
                         "Could not get initial balance")
            return
        
        initial_balance = wallet_response.json().get("balanceUsd")
        print(f"   Initial balance: ${initial_balance}")
        
        # Step 2: Attempt purchase with random domain (will fail due to WHM unreachable)
        random_suffix = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
        test_domain = f"refundtest-{random_suffix}.example"
        print(f"   Attempting purchase with domain: {test_domain}")
        print(f"   (Expected to fail with 502 due to WHM unreachable - this is EXPECTED)")
        
        purchase_response = self.make_request("POST", "/hosting/purchase",
                                              {"planId": "premium-weekly",
                                               "domain": test_domain,
                                               "domainMode": "byo"},
                                              headers=headers,
                                              timeout=30)  # Longer timeout for WHM retries
        
        if not purchase_response:
            self.log_test(9, "REFUND INTEGRITY", False, "502 then balance restored",
                         "Purchase request timed out or failed")
            return
        
        print(f"   Purchase response: {purchase_response.status_code}")
        
        # Step 3: Verify we got 502 (provisioning failed)
        if purchase_response.status_code != 502:
            self.log_test(9, "REFUND INTEGRITY", False, "502 (provisioning fails)",
                         f"Got {purchase_response.status_code} instead of 502: {purchase_response.text[:200]}")
            return
        
        print(f"   ✓ Got expected 502 (provisioning failed)")
        
        # Step 4: Check balance is restored
        time.sleep(1)  # Brief pause to ensure DB write completes
        final_wallet_response = self.make_request("GET", "/wallet", headers=headers)
        
        if not final_wallet_response or final_wallet_response.status_code != 200:
            self.log_test(9, "REFUND INTEGRITY", False, "Balance restored to 200",
                         "Could not get final balance")
            return
        
        final_balance = final_wallet_response.json().get("balanceUsd")
        print(f"   Final balance: ${final_balance}")
        
        # Step 5: Verify balance is back to original (refund worked)
        if initial_balance == 200 and final_balance == 200:
            self.log_test(9, "REFUND INTEGRITY", True,
                         "502 + balance restored to $200 (refund worked)",
                         f"Before: ${initial_balance}, After: ${final_balance} (refund successful)")
        else:
            self.log_test(9, "REFUND INTEGRITY", False,
                         f"Balance ${initial_balance} → ${initial_balance} (refund)",
                         f"Before: ${initial_balance}, After: ${final_balance}")
    
    def test_10_wallet_no_auth(self):
        """Test 10: GET /wallet (no auth) → 401"""
        print("=== Test 10: GET /wallet (no auth) ===")
        response = self.make_request("GET", "/wallet")
        
        if not response:
            self.log_test(10, "GET /wallet (no auth)", False, "401", "No response")
            return
        
        if response.status_code == 401:
            self.log_test(10, "GET /wallet (no auth)", True, "401 Unauthorized", "401")
        else:
            self.log_test(10, "GET /wallet (no auth)", False, "401",
                         f"{response.status_code}: {response.text[:200]}")
    
    def run_all_tests(self):
        """Run all Phase 2 tests"""
        print("=" * 80)
        print("WEB STOREFRONT PHASE 2 BACKEND TESTING")
        print("=" * 80)
        print()
        
        # Setup
        if not self.setup_auth():
            print("\n❌ Authentication setup failed. Cannot proceed with tests.")
            return
        
        # Run all tests
        self.test_1_get_plans()
        self.test_2_get_my_plans()
        self.test_3_open_panel_valid()
        self.test_4_open_panel_invalid()
        self.test_5_get_wallet()
        self.test_6_purchase_invalid_plan()
        self.test_7_purchase_duplicate_domain()
        self.test_8_purchase_insufficient_balance()
        self.test_9_refund_integrity()
        self.test_10_wallet_no_auth()
        
        # Summary
        print("\n" + "=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        print(f"Total tests: {len(self.test_results)}")
        print(f"✅ Passed: {len(self.passed_tests)}")
        print(f"❌ Failed: {len(self.failed_tests)}")
        print()
        
        if self.failed_tests:
            print("Failed tests:")
            for test in self.failed_tests:
                print(f"  - {test}")
        else:
            print("🎉 ALL TESTS PASSED!")
        
        print("\n" + "=" * 80)
        
        # Return success status
        return len(self.failed_tests) == 0

if __name__ == "__main__":
    tester = StorefrontPhase2Tester()
    success = tester.run_all_tests()
    exit(0 if success else 1)
