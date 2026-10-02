#!/usr/bin/env python3
"""
Hosting Panel Backend Endpoint Testing
Testing NEW domain-mode and set-primary features

Test account (DB-only, not real cPanel):
- Username: pnldoctest
- PIN: 123456
- Primary: primary-doctest.example
- Addon: addon-doctest.example (mode: own)
- Plan: Golden (isGold: true)

IMPORTANT: This account is DB-only. Only test VALIDATION/WIRING/AUTH behavior.
Do NOT test happy-path mutations (those would attempt real cPanel/WHM calls and timeout).
"""

import requests
import json
from datetime import datetime

# Base URL from frontend/.env
BASE_URL = "https://passphrase-config-3.preview.emergentagent.com"
PANEL_API = f"{BASE_URL}/api/panel"

# Test credentials
TEST_USERNAME = "pnldoctest"
TEST_PIN = "123456"
EXPECTED_PRIMARY = "primary-doctest.example"
EXPECTED_ADDON = "addon-doctest.example"

class HostingPanelTester:
    def __init__(self):
        self.test_results = []
        self.failed_tests = []
        self.passed_tests = []
        self.token = None
        
    def log_test(self, test_name, passed, expected, actual, details=""):
        """Log test result with expected vs actual"""
        result = {
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
            print(f"✅ {test_name}")
            print(f"   Expected: {expected}")
            print(f"   Actual: {actual}")
        else:
            self.failed_tests.append(test_name)
            print(f"❌ {test_name}")
            print(f"   Expected: {expected}")
            print(f"   Actual: {actual}")
            if details:
                print(f"   Details: {details}")
                
    def make_request(self, method, endpoint, data=None, headers=None, timeout=15):
        """Make HTTP request with error handling"""
        url = f"{PANEL_API}{endpoint}"
        try:
            if method == "GET":
                response = requests.get(url, headers=headers, timeout=timeout)
            elif method == "POST":
                response = requests.post(url, json=data, headers=headers, timeout=timeout)
            else:
                raise ValueError(f"Unsupported method: {method}")
                
            return response
        except requests.exceptions.Timeout:
            print(f"⚠️  Request timeout after {timeout}s: {method} {endpoint}")
            return None
        except requests.exceptions.RequestException as e:
            print(f"⚠️  Request failed: {e}")
            return None
            
    def test_1_login(self):
        """Test 1: POST /api/panel/login with correct credentials"""
        print("\n=== Test 1: Login with correct credentials ===")
        
        response = self.make_request("POST", "/login", {
            "username": TEST_USERNAME,
            "pin": TEST_PIN
        })
        
        if not response:
            self.log_test(
                "Test 1: Login",
                False,
                "200 + token + domain + isGold",
                "No response (timeout or connection error)",
                "Request failed"
            )
            return False
            
        expected = "200, non-empty token, domain=primary-doctest.example, isGold=true"
        
        if response.status_code == 200:
            try:
                data = response.json()
                token = data.get("token", "")
                domain = data.get("domain", "")
                is_gold = data.get("isGold", False)
                username = data.get("username", "")
                
                if token and domain == EXPECTED_PRIMARY and is_gold == True:
                    self.token = token  # Save for subsequent tests
                    actual = f"200, token={token[:20]}..., domain={domain}, isGold={is_gold}, username={username}"
                    self.log_test("Test 1: Login", True, expected, actual)
                    return True
                else:
                    actual = f"200, token={'present' if token else 'MISSING'}, domain={domain}, isGold={is_gold}"
                    self.log_test("Test 1: Login", False, expected, actual, 
                                "Token, domain, or isGold mismatch")
                    return False
            except json.JSONDecodeError:
                self.log_test("Test 1: Login", False, expected, 
                            f"200 but invalid JSON: {response.text[:100]}")
                return False
        else:
            actual = f"{response.status_code}, body: {response.text[:200]}"
            self.log_test("Test 1: Login", False, expected, actual)
            return False
            
    def test_2_docroot_modes_no_auth(self):
        """Test 2: GET /api/panel/domains/docroot-modes WITHOUT Authorization"""
        print("\n=== Test 2: GET docroot-modes without auth ===")
        
        response = self.make_request("GET", "/domains/docroot-modes")
        
        expected = "401 Unauthorized"
        
        if not response:
            self.log_test("Test 2: No auth", False, expected, "No response")
            return False
            
        if response.status_code == 401:
            actual = f"401, body: {response.text[:100]}"
            self.log_test("Test 2: No auth", True, expected, actual)
            return True
        else:
            actual = f"{response.status_code}, body: {response.text[:200]}"
            self.log_test("Test 2: No auth", False, expected, actual)
            return False
            
    def test_3_docroot_modes_with_auth(self):
        """Test 3: GET /api/panel/domains/docroot-modes WITH Bearer token"""
        print("\n=== Test 3: GET docroot-modes with auth ===")
        
        if not self.token:
            self.log_test("Test 3: With auth", False, "200 + modes", 
                        "Skipped - no token from login")
            return False
            
        headers = {"Authorization": f"Bearer {self.token}"}
        response = self.make_request("GET", "/domains/docroot-modes", headers=headers)
        
        expected = f"200, modes={{{EXPECTED_ADDON}:'own'}}, primary={EXPECTED_PRIMARY}"
        
        if not response:
            self.log_test("Test 3: With auth", False, expected, "No response")
            return False
            
        if response.status_code == 200:
            try:
                data = response.json()
                modes = data.get("modes", {})
                primary = data.get("primary", "")
                
                if modes.get(EXPECTED_ADDON) == "own" and primary == EXPECTED_PRIMARY:
                    actual = f"200, modes={modes}, primary={primary}"
                    self.log_test("Test 3: With auth", True, expected, actual)
                    return True
                else:
                    actual = f"200, modes={modes}, primary={primary}"
                    self.log_test("Test 3: With auth", False, expected, actual,
                                "Modes or primary mismatch")
                    return False
            except json.JSONDecodeError:
                self.log_test("Test 3: With auth", False, expected,
                            f"200 but invalid JSON: {response.text[:100]}")
                return False
        else:
            actual = f"{response.status_code}, body: {response.text[:200]}"
            self.log_test("Test 3: With auth", False, expected, actual)
            return False
            
    def test_4_docroot_mode_primary(self):
        """Test 4: POST /api/panel/domains/docroot-mode on primary domain"""
        print("\n=== Test 4: POST docroot-mode on primary (should fail) ===")
        
        if not self.token:
            self.log_test("Test 4: Primary docroot", False, "400", 
                        "Skipped - no token")
            return False
            
        headers = {"Authorization": f"Bearer {self.token}"}
        response = self.make_request("POST", "/domains/docroot-mode", 
                                    {"domain": EXPECTED_PRIMARY, "mode": "mirror"},
                                    headers=headers)
        
        expected = "400, error message (cannot change primary)"
        
        if not response:
            self.log_test("Test 4: Primary docroot", False, expected, "No response")
            return False
            
        if response.status_code == 400:
            try:
                data = response.json()
                error = data.get("error", "")
                actual = f"400, error: {error}"
                self.log_test("Test 4: Primary docroot", True, expected, actual)
                return True
            except json.JSONDecodeError:
                actual = f"400, body: {response.text[:100]}"
                self.log_test("Test 4: Primary docroot", True, expected, actual)
                return True
        else:
            actual = f"{response.status_code}, body: {response.text[:200]}"
            self.log_test("Test 4: Primary docroot", False, expected, actual)
            return False
            
    def test_5_docroot_mode_not_addon(self):
        """Test 5: POST /api/panel/domains/docroot-mode on non-existent domain"""
        print("\n=== Test 5: POST docroot-mode on non-addon domain ===")
        
        if not self.token:
            self.log_test("Test 5: Not addon", False, "404", "Skipped - no token")
            return False
            
        headers = {"Authorization": f"Bearer {self.token}"}
        response = self.make_request("POST", "/domains/docroot-mode",
                                    {"domain": "notmine.example", "mode": "mirror"},
                                    headers=headers)
        
        expected = "404, error (not an addon)"
        
        if not response:
            self.log_test("Test 5: Not addon", False, expected, "No response")
            return False
            
        if response.status_code == 404:
            try:
                data = response.json()
                error = data.get("error", "")
                actual = f"404, error: {error}"
                self.log_test("Test 5: Not addon", True, expected, actual)
                return True
            except json.JSONDecodeError:
                actual = f"404, body: {response.text[:100]}"
                self.log_test("Test 5: Not addon", True, expected, actual)
                return True
        else:
            actual = f"{response.status_code}, body: {response.text[:200]}"
            self.log_test("Test 5: Not addon", False, expected, actual)
            return False
            
    def test_6_docroot_mode_missing_param(self):
        """Test 6: POST /api/panel/domains/docroot-mode without mode parameter"""
        print("\n=== Test 6: POST docroot-mode without mode param ===")
        
        if not self.token:
            self.log_test("Test 6: Missing mode", False, "400", "Skipped - no token")
            return False
            
        headers = {"Authorization": f"Bearer {self.token}"}
        response = self.make_request("POST", "/domains/docroot-mode",
                                    {"domain": EXPECTED_ADDON},
                                    headers=headers)
        
        expected = "400, error (domain and mode required)"
        
        if not response:
            self.log_test("Test 6: Missing mode", False, expected, "No response")
            return False
            
        if response.status_code == 400:
            try:
                data = response.json()
                error = data.get("error", "")
                actual = f"400, error: {error}"
                self.log_test("Test 6: Missing mode", True, expected, actual)
                return True
            except json.JSONDecodeError:
                actual = f"400, body: {response.text[:100]}"
                self.log_test("Test 6: Missing mode", True, expected, actual)
                return True
        else:
            actual = f"{response.status_code}, body: {response.text[:200]}"
            self.log_test("Test 6: Missing mode", False, expected, actual)
            return False
            
    def test_7_set_primary_already_primary(self):
        """Test 7: POST /api/panel/domains/set-primary on already-primary domain"""
        print("\n=== Test 7: POST set-primary on already-primary domain ===")
        
        if not self.token:
            self.log_test("Test 7: Already primary", False, "400", "Skipped - no token")
            return False
            
        headers = {"Authorization": f"Bearer {self.token}"}
        response = self.make_request("POST", "/domains/set-primary",
                                    {"domain": EXPECTED_PRIMARY},
                                    headers=headers)
        
        expected = "400, error (already primary)"
        
        if not response:
            self.log_test("Test 7: Already primary", False, expected, "No response")
            return False
            
        if response.status_code == 400:
            try:
                data = response.json()
                error = data.get("error", "")
                actual = f"400, error: {error}"
                self.log_test("Test 7: Already primary", True, expected, actual)
                return True
            except json.JSONDecodeError:
                actual = f"400, body: {response.text[:100]}"
                self.log_test("Test 7: Already primary", True, expected, actual)
                return True
        else:
            actual = f"{response.status_code}, body: {response.text[:200]}"
            self.log_test("Test 7: Already primary", False, expected, actual)
            return False
            
    def test_8_set_primary_not_addon(self):
        """Test 8: POST /api/panel/domains/set-primary on non-addon domain"""
        print("\n=== Test 8: POST set-primary on non-addon domain ===")
        
        if not self.token:
            self.log_test("Test 8: Not addon", False, "400 + needsAttach", 
                        "Skipped - no token")
            return False
            
        headers = {"Authorization": f"Bearer {self.token}"}
        response = self.make_request("POST", "/domains/set-primary",
                                    {"domain": "notanaddon.example"},
                                    headers=headers)
        
        expected = "400, error + needsAttach=true"
        
        if not response:
            self.log_test("Test 8: Not addon", False, expected, "No response")
            return False
            
        if response.status_code == 400:
            try:
                data = response.json()
                error = data.get("error", "")
                needs_attach = data.get("needsAttach", False)
                actual = f"400, error: {error}, needsAttach: {needs_attach}"
                
                if needs_attach == True:
                    self.log_test("Test 8: Not addon", True, expected, actual)
                    return True
                else:
                    self.log_test("Test 8: Not addon", False, expected, actual,
                                "needsAttach should be true")
                    return False
            except json.JSONDecodeError:
                actual = f"400, body: {response.text[:100]}"
                self.log_test("Test 8: Not addon", False, expected, actual,
                            "Expected JSON with needsAttach field")
                return False
        else:
            actual = f"{response.status_code}, body: {response.text[:200]}"
            self.log_test("Test 8: Not addon", False, expected, actual)
            return False
            
    def test_9_set_primary_missing_domain(self):
        """Test 9: POST /api/panel/domains/set-primary without domain parameter"""
        print("\n=== Test 9: POST set-primary without domain param ===")
        
        if not self.token:
            self.log_test("Test 9: Missing domain", False, "400", "Skipped - no token")
            return False
            
        headers = {"Authorization": f"Bearer {self.token}"}
        response = self.make_request("POST", "/domains/set-primary", {},
                                    headers=headers)
        
        expected = "400, error (domain required)"
        
        if not response:
            self.log_test("Test 9: Missing domain", False, expected, "No response")
            return False
            
        if response.status_code == 400:
            try:
                data = response.json()
                error = data.get("error", "")
                actual = f"400, error: {error}"
                self.log_test("Test 9: Missing domain", True, expected, actual)
                return True
            except json.JSONDecodeError:
                actual = f"400, body: {response.text[:100]}"
                self.log_test("Test 9: Missing domain", True, expected, actual)
                return True
        else:
            actual = f"{response.status_code}, body: {response.text[:200]}"
            self.log_test("Test 9: Missing domain", False, expected, actual)
            return False
            
    def test_10_docroot_mode_no_auth(self):
        """Test 10: POST /api/panel/domains/docroot-mode WITHOUT Authorization"""
        print("\n=== Test 10: POST docroot-mode without auth ===")
        
        response = self.make_request("POST", "/domains/docroot-mode",
                                    {"domain": EXPECTED_ADDON, "mode": "mirror"})
        
        expected = "401 Unauthorized"
        
        if not response:
            self.log_test("Test 10: POST no auth", False, expected, "No response")
            return False
            
        if response.status_code == 401:
            actual = f"401, body: {response.text[:100]}"
            self.log_test("Test 10: POST no auth", True, expected, actual)
            return True
        else:
            actual = f"{response.status_code}, body: {response.text[:200]}"
            self.log_test("Test 10: POST no auth", False, expected, actual)
            return False
            
    def run_all_tests(self):
        """Run all 10 test cases in sequence"""
        print("🚀 Starting Hosting Panel Backend Endpoint Testing")
        print(f"Testing against: {PANEL_API}")
        print(f"Test account: {TEST_USERNAME}")
        print("=" * 70)
        
        # Run tests in order
        self.test_1_login()
        self.test_2_docroot_modes_no_auth()
        self.test_3_docroot_modes_with_auth()
        self.test_4_docroot_mode_primary()
        self.test_5_docroot_mode_not_addon()
        self.test_6_docroot_mode_missing_param()
        self.test_7_set_primary_already_primary()
        self.test_8_set_primary_not_addon()
        self.test_9_set_primary_missing_domain()
        self.test_10_docroot_mode_no_auth()
        
        # Print summary
        self.print_summary()
        
    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 70)
        print("🎯 TEST SUMMARY")
        print("=" * 70)
        
        total_tests = len(self.test_results)
        passed_count = len(self.passed_tests)
        failed_count = len(self.failed_tests)
        
        print(f"Total Tests: {total_tests}")
        print(f"✅ Passed: {passed_count}")
        print(f"❌ Failed: {failed_count}")
        
        if total_tests > 0:
            print(f"Success Rate: {(passed_count/total_tests)*100:.1f}%")
        
        if self.failed_tests:
            print(f"\n❌ FAILED TESTS ({failed_count}):")
            for i, test in enumerate(self.failed_tests, 1):
                print(f"  {i}. {test}")
                
        if self.passed_tests:
            print(f"\n✅ PASSED TESTS ({passed_count}):")
            for i, test in enumerate(self.passed_tests, 1):
                print(f"  {i}. {test}")
                
        print("\n" + "=" * 70)
        
        # Return exit code
        return 0 if failed_count == 0 else 1

if __name__ == "__main__":
    tester = HostingPanelTester()
    exit_code = tester.run_all_tests()
    exit(exit_code)
