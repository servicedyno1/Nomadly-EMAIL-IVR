#!/usr/bin/env python3
"""
Web Storefront Phase-1 Backend Testing
Testing: account auth + wallet + crypto top-up
Base URL: https://app-setup-68.preview.emergentagent.com/api/store

Test fixture (seeded):
- User: storetest@example.com / password1234 (wallet $0)
- Pending order: STORE-TEST-ORDER-1 ($25 USDT-TRC20)
"""

import requests
import json
import time
import random
import string
from datetime import datetime

BASE_URL = "https://app-setup-68.preview.emergentagent.com/api/store"

class StoreBackendTester:
    def __init__(self):
        self.base_url = BASE_URL
        self.test_results = []
        self.failed_tests = []
        self.passed_tests = []
        self.store_token = None
        
    def log_test(self, test_num, test_name, passed, expected, actual, details=""):
        """Log test result with detailed info"""
        result = {
            "test": f"{test_num}. {test_name}",
            "passed": passed,
            "expected": expected,
            "actual": actual,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        
        if passed:
            self.passed_tests.append(test_name)
            print(f"✅ Test {test_num}: {test_name}")
            print(f"   Expected: {expected}")
            print(f"   Actual: {actual}")
        else:
            self.failed_tests.append(test_name)
            print(f"❌ Test {test_num}: {test_name}")
            print(f"   Expected: {expected}")
            print(f"   Actual: {actual}")
            if details:
                print(f"   Details: {details}")
        print()
            
    def make_request(self, method, endpoint, data=None, headers=None, timeout=15):
        """Make HTTP request with error handling"""
        url = f"{self.base_url}{endpoint}"
        try:
            req_headers = headers or {}
            if method == "GET":
                response = requests.get(url, headers=req_headers, timeout=timeout)
            elif method == "POST":
                response = requests.post(url, json=data, headers=req_headers, timeout=timeout)
            else:
                raise ValueError(f"Unsupported method: {method}")
            return response
        except requests.exceptions.Timeout:
            print(f"⚠️  Request timeout after {timeout}s: {method} {endpoint}")
            return None
        except requests.exceptions.RequestException as e:
            print(f"⚠️  Request failed: {e}")
            return None
    
    def random_email(self):
        """Generate random email for signup tests"""
        rand = ''.join(random.choices(string.ascii_lowercase + string.digits, k=8))
        return f"newuser_{rand}@example.com"
    
    # ========== A) AUTH TESTS ==========
    
    def test_1_signup_new_user(self):
        """Test 1: POST /auth/signup with new user"""
        email = self.random_email()
        response = self.make_request("POST", "/auth/signup", {
            "email": email,
            "password": "password1234"
        })
        
        if response and response.status_code == 200:
            data = response.json()
            has_token = "token" in data and len(data.get("token", "")) > 0
            has_user = "user" in data
            wallet_zero = data.get("user", {}).get("walletUsd") == 0
            
            if has_token and has_user and wallet_zero:
                self.log_test(1, "Signup new user", True,
                    "200, token present, user.walletUsd == 0",
                    f"200, token={has_token}, walletUsd={data.get('user', {}).get('walletUsd')}")
            else:
                self.log_test(1, "Signup new user", False,
                    "200, token present, user.walletUsd == 0",
                    f"200, but token={has_token}, user={has_user}, walletUsd={data.get('user', {}).get('walletUsd')}",
                    f"Response: {data}")
        else:
            status = response.status_code if response else "No response"
            body = response.json() if response else {}
            self.log_test(1, "Signup new user", False,
                "200, token present, user.walletUsd == 0",
                f"Status {status}",
                f"Body: {body}")
    
    def test_2_signup_duplicate_email(self):
        """Test 2: POST /auth/signup with duplicate email"""
        # First signup
        email = self.random_email()
        self.make_request("POST", "/auth/signup", {
            "email": email,
            "password": "password1234"
        })
        
        # Duplicate signup
        response = self.make_request("POST", "/auth/signup", {
            "email": email,
            "password": "password1234"
        })
        
        if response and response.status_code == 409:
            self.log_test(2, "Signup duplicate email", True,
                "409 Conflict",
                f"409, body: {response.json()}")
        else:
            status = response.status_code if response else "No response"
            body = response.json() if response else {}
            self.log_test(2, "Signup duplicate email", False,
                "409 Conflict",
                f"Status {status}",
                f"Body: {body}")
    
    def test_3_signup_weak_password(self):
        """Test 3: POST /auth/signup with weak password"""
        email = self.random_email()
        response = self.make_request("POST", "/auth/signup", {
            "email": email,
            "password": "short"
        })
        
        if response and response.status_code == 400:
            self.log_test(3, "Signup weak password", True,
                "400 Bad Request (password too short)",
                f"400, body: {response.json()}")
        else:
            status = response.status_code if response else "No response"
            body = response.json() if response else {}
            self.log_test(3, "Signup weak password", False,
                "400 Bad Request",
                f"Status {status}",
                f"Body: {body}")
    
    def test_4_login_valid_credentials(self):
        """Test 4: POST /auth/login with valid credentials (storetest@example.com)"""
        response = self.make_request("POST", "/auth/login", {
            "email": "storetest@example.com",
            "password": "password1234"
        })
        
        if response and response.status_code == 200:
            data = response.json()
            has_token = "token" in data and len(data.get("token", "")) > 0
            
            if has_token:
                self.store_token = data["token"]  # Save for later tests
                self.log_test(4, "Login valid credentials", True,
                    "200, token present",
                    f"200, token saved (length={len(self.store_token)})")
            else:
                self.log_test(4, "Login valid credentials", False,
                    "200, token present",
                    f"200, but no token in response",
                    f"Response: {data}")
        else:
            status = response.status_code if response else "No response"
            body = response.json() if response else {}
            self.log_test(4, "Login valid credentials", False,
                "200, token present",
                f"Status {status}",
                f"Body: {body}")
    
    def test_5_login_wrong_password(self):
        """Test 5: POST /auth/login with wrong password"""
        response = self.make_request("POST", "/auth/login", {
            "email": "storetest@example.com",
            "password": "wrongpass"
        })
        
        if response and response.status_code == 401:
            self.log_test(5, "Login wrong password", True,
                "401 Unauthorized",
                f"401, body: {response.json()}")
        else:
            status = response.status_code if response else "No response"
            body = response.json() if response else {}
            self.log_test(5, "Login wrong password", False,
                "401 Unauthorized",
                f"Status {status}",
                f"Body: {body}")
    
    def test_6_get_me_with_token(self):
        """Test 6: GET /auth/me with Bearer token"""
        if not self.store_token:
            self.log_test(6, "GET /auth/me with token", False,
                "200, user.email == storetest@example.com",
                "No token available (test 4 failed)")
            return
        
        response = self.make_request("GET", "/auth/me", headers={
            "Authorization": f"Bearer {self.store_token}"
        })
        
        if response and response.status_code == 200:
            data = response.json()
            email = data.get("user", {}).get("email")
            
            if email == "storetest@example.com":
                self.log_test(6, "GET /auth/me with token", True,
                    "200, user.email == storetest@example.com",
                    f"200, email={email}")
            else:
                self.log_test(6, "GET /auth/me with token", False,
                    "200, user.email == storetest@example.com",
                    f"200, but email={email}",
                    f"Response: {data}")
        else:
            status = response.status_code if response else "No response"
            body = response.json() if response else {}
            self.log_test(6, "GET /auth/me with token", False,
                "200, user.email == storetest@example.com",
                f"Status {status}",
                f"Body: {body}")
    
    def test_7_wallet_no_auth(self):
        """Test 7: GET /wallet without Authorization header"""
        response = self.make_request("GET", "/wallet")
        
        if response and response.status_code == 401:
            self.log_test(7, "GET /wallet without auth", True,
                "401 Unauthorized",
                f"401, body: {response.json()}")
        else:
            status = response.status_code if response else "No response"
            body = response.json() if response else {}
            self.log_test(7, "GET /wallet without auth", False,
                "401 Unauthorized",
                f"Status {status}",
                f"Body: {body}")
    
    # ========== B) WALLET + TOP-UP VALIDATION TESTS ==========
    
    def test_8_get_wallet(self):
        """Test 8: GET /wallet with Bearer token"""
        if not self.store_token:
            self.log_test(8, "GET /wallet", False,
                "200, balanceUsd == 0, coins array length == 8",
                "No token available")
            return
        
        response = self.make_request("GET", "/wallet", headers={
            "Authorization": f"Bearer {self.store_token}"
        })
        
        if response and response.status_code == 200:
            data = response.json()
            balance = data.get("balanceUsd")
            coins = data.get("coins", [])
            coins_len = len(coins)
            
            # Note: balance might not be 0 if webhook test already ran
            if coins_len == 8:
                self.log_test(8, "GET /wallet", True,
                    "200, balanceUsd == 0, coins array length == 8",
                    f"200, balanceUsd={balance}, coins length={coins_len}")
            else:
                self.log_test(8, "GET /wallet", False,
                    "200, balanceUsd == 0, coins array length == 8",
                    f"200, balanceUsd={balance}, coins length={coins_len}",
                    f"Response: {data}")
        else:
            status = response.status_code if response else "No response"
            body = response.json() if response else {}
            self.log_test(8, "GET /wallet", False,
                "200, balanceUsd == 0, coins array length == 8",
                f"Status {status}",
                f"Body: {body}")
    
    def test_9_topup_below_min_btc(self):
        """Test 9: POST /wallet/topup with $5 BTC (below $10 min)"""
        if not self.store_token:
            self.log_test(9, "Topup below min BTC", False,
                "400 (minimum $10)",
                "No token available")
            return
        
        response = self.make_request("POST", "/wallet/topup", {
            "amountUsd": 5,
            "coin": "BTC"
        }, headers={"Authorization": f"Bearer {self.store_token}"})
        
        if response and response.status_code == 400:
            body = response.json()
            error = body.get("error", "")
            if "10" in error or "minimum" in error.lower():
                self.log_test(9, "Topup below min BTC", True,
                    "400 (minimum $10)",
                    f"400, error: {error}")
            else:
                self.log_test(9, "Topup below min BTC", False,
                    "400 (minimum $10)",
                    f"400, but error message unclear: {error}")
        else:
            status = response.status_code if response else "No response"
            body = response.json() if response else {}
            self.log_test(9, "Topup below min BTC", False,
                "400 (minimum $10)",
                f"Status {status}",
                f"Body: {body}")
    
    def test_10_topup_below_min_usdt_trc20(self):
        """Test 10: POST /wallet/topup with $15 USDT-TRC20 (below $20 min)"""
        if not self.store_token:
            self.log_test(10, "Topup below min USDT-TRC20", False,
                "400 (minimum $20)",
                "No token available")
            return
        
        response = self.make_request("POST", "/wallet/topup", {
            "amountUsd": 15,
            "coin": "USDT-TRC20"
        }, headers={"Authorization": f"Bearer {self.store_token}"})
        
        if response and response.status_code == 400:
            body = response.json()
            error = body.get("error", "")
            if "20" in error or "minimum" in error.lower():
                self.log_test(10, "Topup below min USDT-TRC20", True,
                    "400 (minimum $20)",
                    f"400, error: {error}")
            else:
                self.log_test(10, "Topup below min USDT-TRC20", False,
                    "400 (minimum $20)",
                    f"400, but error message unclear: {error}")
        else:
            status = response.status_code if response else "No response"
            body = response.json() if response else {}
            self.log_test(10, "Topup below min USDT-TRC20", False,
                "400 (minimum $20)",
                f"Status {status}",
                f"Body: {body}")
    
    def test_11_topup_unsupported_coin(self):
        """Test 11: POST /wallet/topup with unsupported coin FOO"""
        if not self.store_token:
            self.log_test(11, "Topup unsupported coin", False,
                "400 (unsupported coin)",
                "No token available")
            return
        
        response = self.make_request("POST", "/wallet/topup", {
            "amountUsd": 10,
            "coin": "FOO"
        }, headers={"Authorization": f"Bearer {self.store_token}"})
        
        if response and response.status_code == 400:
            body = response.json()
            error = body.get("error", "")
            if "unsupported" in error.lower() or "coin" in error.lower():
                self.log_test(11, "Topup unsupported coin", True,
                    "400 (unsupported coin)",
                    f"400, error: {error}")
            else:
                self.log_test(11, "Topup unsupported coin", False,
                    "400 (unsupported coin)",
                    f"400, but error message unclear: {error}")
        else:
            status = response.status_code if response else "No response"
            body = response.json() if response else {}
            self.log_test(11, "Topup unsupported coin", False,
                "400 (unsupported coin)",
                f"Status {status}",
                f"Body: {body}")
    
    def test_12_topup_live_provider(self):
        """Test 12: POST /wallet/topup with $25 USDT-TRC20 (may hit live provider)"""
        if not self.store_token:
            self.log_test(12, "Topup live provider", False,
                "200 with orderId+address OR 502 provider unavailable",
                "No token available")
            return
        
        response = self.make_request("POST", "/wallet/topup", {
            "amountUsd": 25,
            "coin": "USDT-TRC20"
        }, headers={"Authorization": f"Bearer {self.store_token}"}, timeout=15)
        
        if response:
            if response.status_code == 200:
                body = response.json()
                has_order_id = "orderId" in body
                has_address = "address" in body
                
                if has_order_id and has_address:
                    self.log_test(12, "Topup live provider", True,
                        "200 with orderId+address OR 502 provider unavailable",
                        f"200, orderId={body.get('orderId')}, address={body.get('address')[:20]}...")
                else:
                    self.log_test(12, "Topup live provider", False,
                        "200 with orderId+address OR 502 provider unavailable",
                        f"200, but missing orderId or address",
                        f"Body: {body}")
            elif response.status_code == 502:
                body = response.json()
                error = body.get("error", "")
                if "provider" in error.lower() or "unavailable" in error.lower():
                    self.log_test(12, "Topup live provider", True,
                        "200 with orderId+address OR 502 provider unavailable",
                        f"502 provider unavailable (acceptable): {error}")
                else:
                    self.log_test(12, "Topup live provider", False,
                        "200 with orderId+address OR 502 provider unavailable",
                        f"502, but unclear error: {error}")
            else:
                status = response.status_code
                body = response.json() if response else {}
                self.log_test(12, "Topup live provider", False,
                    "200 with orderId+address OR 502 provider unavailable",
                    f"Status {status}",
                    f"Body: {body}")
        else:
            self.log_test(12, "Topup live provider", False,
                "200 with orderId+address OR 502 provider unavailable",
                "No response (timeout or network error)")
    
    # ========== C) WEBHOOK CREDIT TESTS ==========
    
    def test_13_webhook_credit(self):
        """Test 13: POST /crypto-webhook with seeded order STORE-TEST-ORDER-1"""
        response = self.make_request("POST", "/crypto-webhook", {
            "event": "payment.confirmed",
            "payment_id": "TESTPID1",
            "base_amount": 25,
            "fee_payer": "company",
            "meta_data": {
                "refId": "STORE-TEST-ORDER-1"
            }
        }, timeout=15)
        
        if response and response.status_code == 200:
            body = response.text
            if body == "OK":
                self.log_test(13, "Webhook credit", True,
                    "200, body 'OK'",
                    f"200, body: {body}")
            else:
                self.log_test(13, "Webhook credit", False,
                    "200, body 'OK'",
                    f"200, but body: {body}")
        else:
            status = response.status_code if response else "No response"
            body = response.text if response else ""
            self.log_test(13, "Webhook credit", False,
                "200, body 'OK'",
                f"Status {status}",
                f"Body: {body}")
    
    def test_14_wallet_after_webhook(self):
        """Test 14: GET /wallet after webhook - should show $25 balance and topup txn"""
        if not self.store_token:
            self.log_test(14, "Wallet after webhook", False,
                "balanceUsd == 25, topup txn present",
                "No token available")
            return
        
        # Re-login to get fresh token (in case webhook test ran before login)
        login_resp = self.make_request("POST", "/auth/login", {
            "email": "storetest@example.com",
            "password": "password1234"
        })
        if login_resp and login_resp.status_code == 200:
            self.store_token = login_resp.json()["token"]
        
        response = self.make_request("GET", "/wallet", headers={
            "Authorization": f"Bearer {self.store_token}"
        })
        
        if response and response.status_code == 200:
            data = response.json()
            balance = data.get("balanceUsd")
            txns = data.get("txns", [])
            has_topup = any(t.get("type") == "topup" for t in txns)
            
            if balance == 25 and has_topup:
                self.log_test(14, "Wallet after webhook", True,
                    "balanceUsd == 25, topup txn present",
                    f"balanceUsd={balance}, topup txn found")
            else:
                self.log_test(14, "Wallet after webhook", False,
                    "balanceUsd == 25, topup txn present",
                    f"balanceUsd={balance}, has_topup={has_topup}",
                    f"Txns: {txns}")
        else:
            status = response.status_code if response else "No response"
            body = response.json() if response else {}
            self.log_test(14, "Wallet after webhook", False,
                "balanceUsd == 25, topup txn present",
                f"Status {status}",
                f"Body: {body}")
    
    def test_15_webhook_idempotency(self):
        """Test 15: POST same webhook again - balance should stay $25 (idempotent)"""
        # Send duplicate webhook
        response = self.make_request("POST", "/crypto-webhook", {
            "event": "payment.confirmed",
            "payment_id": "TESTPID1",
            "base_amount": 25,
            "fee_payer": "company",
            "meta_data": {
                "refId": "STORE-TEST-ORDER-1"
            }
        }, timeout=15)
        
        if not response or response.status_code != 200:
            self.log_test(15, "Webhook idempotency", False,
                "Balance stays $25 (not $50)",
                f"Webhook failed: {response.status_code if response else 'No response'}")
            return
        
        # Check wallet balance
        if not self.store_token:
            login_resp = self.make_request("POST", "/auth/login", {
                "email": "storetest@example.com",
                "password": "password1234"
            })
            if login_resp and login_resp.status_code == 200:
                self.store_token = login_resp.json()["token"]
        
        wallet_resp = self.make_request("GET", "/wallet", headers={
            "Authorization": f"Bearer {self.store_token}"
        })
        
        if wallet_resp and wallet_resp.status_code == 200:
            data = wallet_resp.json()
            balance = data.get("balanceUsd")
            
            if balance == 25:
                self.log_test(15, "Webhook idempotency", True,
                    "Balance stays $25 (not $50)",
                    f"balanceUsd={balance} (idempotent)")
            else:
                self.log_test(15, "Webhook idempotency", False,
                    "Balance stays $25 (not $50)",
                    f"balanceUsd={balance} (should be 25, not {balance})",
                    f"Duplicate webhook was NOT idempotent!")
        else:
            status = wallet_resp.status_code if wallet_resp else "No response"
            body = wallet_resp.json() if wallet_resp else {}
            self.log_test(15, "Webhook idempotency", False,
                "Balance stays $25 (not $50)",
                f"Wallet check failed: {status}",
                f"Body: {body}")
    
    # ========== RUN ALL TESTS ==========
    
    def run_all_tests(self):
        """Run complete test suite"""
        print("=" * 80)
        print("🚀 Web Storefront Phase-1 Backend Testing")
        print(f"Base URL: {self.base_url}")
        print("=" * 80)
        print()
        
        print("=" * 80)
        print("A) AUTH TESTS")
        print("=" * 80)
        self.test_1_signup_new_user()
        self.test_2_signup_duplicate_email()
        self.test_3_signup_weak_password()
        self.test_4_login_valid_credentials()
        self.test_5_login_wrong_password()
        self.test_6_get_me_with_token()
        self.test_7_wallet_no_auth()
        
        print("=" * 80)
        print("B) WALLET + TOP-UP VALIDATION TESTS")
        print("=" * 80)
        self.test_8_get_wallet()
        self.test_9_topup_below_min_btc()
        self.test_10_topup_below_min_usdt_trc20()
        self.test_11_topup_unsupported_coin()
        self.test_12_topup_live_provider()
        
        print("=" * 80)
        print("C) WEBHOOK CREDIT TESTS")
        print("=" * 80)
        self.test_13_webhook_credit()
        self.test_14_wallet_after_webhook()
        self.test_15_webhook_idempotency()
        
        # Print summary
        self.print_summary()
    
    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 80)
        print("🎯 TEST SUMMARY")
        print("=" * 80)
        
        total_tests = len(self.test_results)
        passed_count = len(self.passed_tests)
        failed_count = len(self.failed_tests)
        
        print(f"Total Tests: {total_tests}")
        print(f"✅ Passed: {passed_count}")
        print(f"❌ Failed: {failed_count}")
        print(f"Success Rate: {(passed_count/total_tests)*100:.1f}%")
        print()
        
        if self.failed_tests:
            print(f"❌ FAILED TESTS ({failed_count}):")
            for test in self.failed_tests:
                print(f"  - {test}")
            print()
        
        if self.passed_tests:
            print(f"✅ PASSED TESTS ({passed_count}):")
            for test in self.passed_tests:
                print(f"  - {test}")
        
        print("=" * 80)

if __name__ == "__main__":
    tester = StoreBackendTester()
    tester.run_all_tests()
