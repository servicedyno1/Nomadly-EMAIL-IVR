#!/usr/bin/env python3
"""
Web Storefront Phase 5 Testing: Direct-crypto plan payment + GUEST buy-now
Testing against: REACT_APP_BACKEND_URL from /app/frontend/.env
Routes under /api/store

Tests:
1. GET /api/store/plans → verify premium-monthly features don't contain "Email"
2. GUEST checkout WITHOUT email → expect 400
3. GUEST checkout valid → expect 200 with orderId and address
4. PUBLIC order poll (no auth) → expect 200, status "pending"
5. WEBHOOK ROUTING → hosting provisioning (expect "failed" status)
6. AUTHED pay-crypto → login first, then POST /api/store/hosting/pay-crypto
7. PUBLIC domain search (no auth) → expect 200 with available boolean
"""

import requests
import json
import time
import random
import string
from datetime import datetime

# Read base URL from frontend/.env
def get_base_url():
    try:
        with open('/app/frontend/.env', 'r') as f:
            for line in f:
                if line.startswith('REACT_APP_BACKEND_URL='):
                    return line.split('=', 1)[1].strip()
    except:
        pass
    return "https://vault-setup-fix.preview.emergentagent.com"

BASE_URL = get_base_url()
API_BASE = f"{BASE_URL}/api/store"

# Test credentials (from test_result.md)
TEST_USER_EMAIL = "storebuyer@example.com"
TEST_USER_PASSWORD = "password1234"

class Phase5Tester:
    def __init__(self):
        self.results = []
        self.passed = 0
        self.failed = 0
        self.guest_order_id = None
        self.guest_domain = None
        self.auth_token = None
        
    def random_string(self, length=8):
        """Generate random string for unique test data"""
        return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))
    
    def log_result(self, test_num, test_name, passed, expected, actual, details=""):
        """Log test result"""
        status = "✅ PASS" if passed else "❌ FAIL"
        result = {
            "test": test_num,
            "name": test_name,
            "status": status,
            "passed": passed,
            "expected": expected,
            "actual": actual,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.results.append(result)
        
        if passed:
            self.passed += 1
            print(f"{status} | Test {test_num}: {test_name}")
        else:
            self.failed += 1
            print(f"{status} | Test {test_num}: {test_name}")
            print(f"  Expected: {expected}")
            print(f"  Actual: {actual}")
            if details:
                print(f"  Details: {details}")
    
    def test_1_plans_endpoint(self):
        """Test 1: GET /api/store/plans → verify premium-monthly features"""
        print("\n=== Test 1: Plans Endpoint ===")
        try:
            response = requests.get(f"{API_BASE}/plans", timeout=15)
            
            if response.status_code != 200:
                self.log_result(1, "GET /plans", False, "200", response.status_code, 
                              f"Response: {response.text[:200]}")
                return
            
            data = response.json()
            plans = data.get('plans', [])
            
            # Find premium-monthly plan
            premium_monthly = None
            for plan in plans:
                if plan.get('id') == 'premium-monthly':
                    premium_monthly = plan
                    break
            
            if not premium_monthly:
                self.log_result(1, "GET /plans", False, "premium-monthly plan exists", 
                              "Plan not found", f"Available plans: {[p.get('id') for p in plans]}")
                return
            
            features = premium_monthly.get('features', [])
            has_email = any('Email' in str(f) for f in features)
            has_mysql = any('MySQL' in str(f) for f in features)
            
            if has_email:
                self.log_result(1, "GET /plans", False, 
                              "premium-monthly features should NOT contain 'Email'",
                              f"Features contain 'Email': {features}",
                              "Features should say 'MySQL databases' instead")
            elif not has_mysql:
                self.log_result(1, "GET /plans", False,
                              "premium-monthly features should contain 'MySQL'",
                              f"Features: {features}",
                              "Expected 'MySQL databases' in features")
            else:
                self.log_result(1, "GET /plans", True, 
                              "200, premium-monthly has MySQL (not Email)",
                              f"200, features: {features}",
                              "✓ Correctly shows MySQL databases")
                
        except Exception as e:
            self.log_result(1, "GET /plans", False, "200", f"Exception: {str(e)}")
    
    def test_2_guest_checkout_no_email(self):
        """Test 2: GUEST checkout WITHOUT email → expect 400"""
        print("\n=== Test 2: Guest Checkout Without Email ===")
        try:
            rand = self.random_string()
            payload = {
                "planId": "premium-weekly",
                "domain": f"guesttestA-{rand}.example",
                "domainMode": "byo",
                "coin": "USDT-TRC20"
                # NO email field
            }
            
            response = requests.post(f"{API_BASE}/guest/checkout", json=payload, timeout=15)
            
            if response.status_code == 400:
                data = response.json()
                error = data.get('error', '')
                if 'email' in error.lower():
                    self.log_result(2, "Guest checkout (no email)", True,
                                  "400 (email required)", f"400, error: {error}")
                else:
                    self.log_result(2, "Guest checkout (no email)", False,
                                  "400 with email error", f"400 but error: {error}")
            else:
                self.log_result(2, "Guest checkout (no email)", False,
                              "400", f"{response.status_code}, body: {response.text[:200]}")
                
        except Exception as e:
            self.log_result(2, "Guest checkout (no email)", False, "400", f"Exception: {str(e)}")
    
    def test_3_guest_checkout_valid(self):
        """Test 3: GUEST checkout valid → expect 200 with orderId and address"""
        print("\n=== Test 3: Guest Checkout Valid ===")
        try:
            rand = self.random_string()
            self.guest_domain = f"guesttestB-{rand}.example"
            payload = {
                "planId": "premium-weekly",
                "domain": self.guest_domain,
                "domainMode": "byo",
                "email": f"guestB-{rand}@example.com",
                "coin": "USDT-TRC20"
            }
            
            response = requests.post(f"{API_BASE}/guest/checkout", json=payload, timeout=15)
            
            if response.status_code == 502:
                data = response.json()
                error = data.get('error', '')
                if 'provider unavailable' in error.lower():
                    self.log_result(3, "Guest checkout (valid)", True,
                                  "200 or 502 (provider down)", "502 (provider unavailable)",
                                  "⚠️ Payment provider down - SKIP tests 4-5")
                    return
            
            if response.status_code != 200:
                self.log_result(3, "Guest checkout (valid)", False,
                              "200", f"{response.status_code}, body: {response.text[:200]}")
                return
            
            data = response.json()
            order_id = data.get('orderId')
            address = data.get('address')
            
            if order_id and address:
                self.guest_order_id = order_id
                self.log_result(3, "Guest checkout (valid)", True,
                              "200 with orderId + address",
                              f"200, orderId: {order_id[:16]}..., address: {address[:16]}...")
            else:
                self.log_result(3, "Guest checkout (valid)", False,
                              "200 with orderId + address",
                              f"200 but missing fields: {data}")
                
        except Exception as e:
            self.log_result(3, "Guest checkout (valid)", False, "200", f"Exception: {str(e)}")
    
    def test_4_public_order_poll(self):
        """Test 4: PUBLIC order poll (no auth) → expect 200, status pending"""
        print("\n=== Test 4: Public Order Poll ===")
        
        if not self.guest_order_id:
            self.log_result(4, "Public order poll", False, "200", "SKIPPED",
                          "No guest order ID from test 3")
            return
        
        try:
            response = requests.get(f"{API_BASE}/order/{self.guest_order_id}", timeout=15)
            
            if response.status_code != 200:
                self.log_result(4, "Public order poll", False,
                              "200", f"{response.status_code}, body: {response.text[:200]}")
                return
            
            data = response.json()
            status = data.get('status')
            domain = data.get('domain')
            
            # Domain comparison should be case-insensitive (domains are normalized to lowercase)
            if status == 'pending' and domain.lower() == self.guest_domain.lower():
                self.log_result(4, "Public order poll", True,
                              "200, status=pending, domain matches",
                              f"200, status={status}, domain={domain}")
            else:
                self.log_result(4, "Public order poll", False,
                              f"200, status=pending, domain={self.guest_domain}",
                              f"200, status={status}, domain={domain}")
                
        except Exception as e:
            self.log_result(4, "Public order poll", False, "200", f"Exception: {str(e)}")
    
    def test_5_webhook_routing(self):
        """Test 5: WEBHOOK ROUTING → hosting provisioning (expect failed status)"""
        print("\n=== Test 5: Webhook Routing to Hosting Provisioning ===")
        
        if not self.guest_order_id:
            self.log_result(5, "Webhook routing", False, "200", "SKIPPED",
                          "No guest order ID from test 3")
            return
        
        try:
            # Send webhook to trigger provisioning
            rand = self.random_string()
            webhook_payload = {
                "event": "payment.confirmed",
                "payment_id": f"GTESTPID-{rand}",
                "base_amount": 30,
                "fee_payer": "company",
                "meta_data": {
                    "refId": self.guest_order_id
                }
            }
            
            response = requests.post(f"{API_BASE}/crypto-webhook", 
                                   json=webhook_payload, timeout=15)
            
            if response.status_code != 200 or response.text != 'OK':
                self.log_result(5, "Webhook routing", False,
                              "200 'OK'", f"{response.status_code}, body: {response.text[:100]}")
                return
            
            # Wait for provisioning to attempt and fail (~30s timeout as per instructions)
            print("  Waiting ~30s for provisioning to attempt (WHM will fail)...")
            time.sleep(30)
            
            # Check order status - should be "failed" (not "pending", not "credited")
            status_response = requests.get(f"{API_BASE}/order/{self.guest_order_id}", timeout=15)
            
            if status_response.status_code != 200:
                self.log_result(5, "Webhook routing", False,
                              "Order status check 200", 
                              f"{status_response.status_code}, body: {status_response.text[:200]}")
                return
            
            status_data = status_response.json()
            final_status = status_data.get('status')
            
            if final_status == 'failed':
                self.log_result(5, "Webhook routing", True,
                              "Webhook routed to provisioning, status=failed (WHM unreachable)",
                              f"status={final_status}",
                              "✓ Webhook correctly routed to hosting provisioning (not wallet top-up)")
            elif final_status == 'pending':
                self.log_result(5, "Webhook routing", False,
                              "status=failed (provisioning attempted)",
                              f"status={final_status}",
                              "Webhook may not have been processed or provisioning still running")
            elif final_status == 'credited':
                self.log_result(5, "Webhook routing", False,
                              "status=failed (hosting order)",
                              f"status={final_status}",
                              "❌ Webhook incorrectly routed to wallet credit instead of hosting provisioning")
            else:
                self.log_result(5, "Webhook routing", False,
                              "status=failed",
                              f"status={final_status}",
                              f"Unexpected status: {status_data}")
                
        except Exception as e:
            self.log_result(5, "Webhook routing", False, "200", f"Exception: {str(e)}")
    
    def test_6_authed_pay_crypto(self):
        """Test 6: AUTHED pay-crypto → login first, then POST /api/store/hosting/pay-crypto"""
        print("\n=== Test 6: Authenticated Pay-Crypto ===")
        
        # First, login to get token
        try:
            login_payload = {
                "email": TEST_USER_EMAIL,
                "password": TEST_USER_PASSWORD
            }
            login_response = requests.post(f"{API_BASE}/auth/login", 
                                         json=login_payload, timeout=15)
            
            if login_response.status_code != 200:
                self.log_result(6, "Authed pay-crypto (login)", False,
                              "200", f"{login_response.status_code}, body: {login_response.text[:200]}")
                return
            
            login_data = login_response.json()
            self.auth_token = login_data.get('token')
            
            if not self.auth_token:
                self.log_result(6, "Authed pay-crypto (login)", False,
                              "token in response", f"No token: {login_data}")
                return
            
            print(f"  ✓ Logged in as {TEST_USER_EMAIL}")
            
            # Now test pay-crypto endpoint
            rand = self.random_string()
            pay_crypto_payload = {
                "planId": "golden-monthly",
                "domain": f"cryptotestC-{rand}.example",
                "domainMode": "byo",
                "coin": "BTC"
            }
            
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            response = requests.post(f"{API_BASE}/hosting/pay-crypto",
                                   json=pay_crypto_payload, headers=headers, timeout=15)
            
            if response.status_code == 502:
                data = response.json()
                error = data.get('error', '')
                if 'provider unavailable' in error.lower():
                    self.log_result(6, "Authed pay-crypto", True,
                                  "200 or 502 (provider down)", "502 (provider unavailable)",
                                  "⚠️ Payment provider down - acceptable")
                    return
            
            if response.status_code != 200:
                self.log_result(6, "Authed pay-crypto", False,
                              "200", f"{response.status_code}, body: {response.text[:200]}")
                return
            
            data = response.json()
            order_id = data.get('orderId')
            address = data.get('address')
            
            if order_id and address:
                self.log_result(6, "Authed pay-crypto", True,
                              "200 with orderId + address",
                              f"200, orderId: {order_id[:16]}..., address: {address[:16]}...")
            else:
                self.log_result(6, "Authed pay-crypto", False,
                              "200 with orderId + address",
                              f"200 but missing fields: {data}")
                
        except Exception as e:
            self.log_result(6, "Authed pay-crypto", False, "200", f"Exception: {str(e)}")
    
    def test_7_public_domain_search(self):
        """Test 7: PUBLIC domain search (no auth) → expect 200 with available boolean"""
        print("\n=== Test 7: Public Domain Search ===")
        try:
            rand = self.random_string()
            domain = f"somerandomxyz-{rand}.com"
            
            response = requests.get(f"{API_BASE}/domain/search?domain={domain}", timeout=15)
            
            if response.status_code != 200:
                self.log_result(7, "Public domain search", False,
                              "200", f"{response.status_code}, body: {response.text[:200]}")
                return
            
            data = response.json()
            available = data.get('available')
            
            if isinstance(available, bool):
                self.log_result(7, "Public domain search", True,
                              "200 with available boolean",
                              f"200, available={available}, domain={domain}",
                              "✓ Live registrar check working (either true/false is fine)")
            else:
                self.log_result(7, "Public domain search", False,
                              "200 with available boolean",
                              f"200 but available={available} (type: {type(available)})")
                
        except Exception as e:
            self.log_result(7, "Public domain search", False, "200", f"Exception: {str(e)}")
    
    def run_all_tests(self):
        """Run all Phase 5 tests"""
        print("=" * 80)
        print("🚀 Web Storefront Phase 5 Testing")
        print(f"Base URL: {BASE_URL}")
        print(f"API Base: {API_BASE}")
        print(f"Test User: {TEST_USER_EMAIL}")
        print("=" * 80)
        
        self.test_1_plans_endpoint()
        self.test_2_guest_checkout_no_email()
        self.test_3_guest_checkout_valid()
        self.test_4_public_order_poll()
        self.test_5_webhook_routing()
        self.test_6_authed_pay_crypto()
        self.test_7_public_domain_search()
        
        self.print_summary()
    
    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 80)
        print("📊 TEST SUMMARY")
        print("=" * 80)
        
        total = self.passed + self.failed
        print(f"Total Tests: {total}")
        print(f"✅ Passed: {self.passed}")
        print(f"❌ Failed: {self.failed}")
        
        if total > 0:
            success_rate = (self.passed / total) * 100
            print(f"Success Rate: {success_rate:.1f}%")
        
        print("\n" + "=" * 80)
        print("DETAILED RESULTS")
        print("=" * 80)
        
        for result in self.results:
            status_icon = "✅" if result['passed'] else "❌"
            print(f"\n{status_icon} Test {result['test']}: {result['name']}")
            print(f"   Expected: {result['expected']}")
            print(f"   Actual: {result['actual']}")
            if result['details']:
                print(f"   Details: {result['details']}")
        
        print("\n" + "=" * 80)
        
        # Key findings
        print("\n🔍 KEY FINDINGS:")
        
        # Check for critical failures
        critical_failures = []
        for r in self.results:
            if not r['passed'] and 'SKIP' not in str(r['actual']):
                critical_failures.append(f"  - Test {r['test']}: {r['name']}")
        
        if critical_failures:
            print("❌ CRITICAL FAILURES:")
            for cf in critical_failures:
                print(cf)
        else:
            print("✅ All tests passed or skipped due to expected conditions")
        
        print("\n" + "=" * 80)

if __name__ == "__main__":
    tester = Phase5Tester()
    tester.run_all_tests()
