#!/usr/bin/env python3
"""
Comprehensive Backend Testing for Nomadly Coupon System
Testing against: https://vault-setup-fix.preview.emergentagent.com/api

Focus on previously failing issues:
1. Case insensitivity (lowercase coupons)
2. Daily coupon single-use enforcement
"""

import requests
import json
import time
from datetime import datetime

# Base URL for testing
BASE_URL = "https://vault-setup-fix.preview.emergentagent.com/api"

class CouponTester:
    def __init__(self):
        self.base_url = BASE_URL
        self.test_results = []
        self.failed_tests = []
        self.passed_tests = []
        
    def log_test(self, test_name, passed, details=""):
        """Log test result"""
        result = {
            "test": test_name,
            "passed": passed,
            "details": details,
            "timestamp": datetime.now().isoformat()
        }
        self.test_results.append(result)
        
        if passed:
            self.passed_tests.append(test_name)
            print(f"✅ {test_name}")
        else:
            self.failed_tests.append(test_name)
            print(f"❌ {test_name}: {details}")
            
    def make_request(self, method, endpoint, data=None):
        """Make HTTP request with error handling"""
        url = f"{self.base_url}{endpoint}"
        try:
            if method == "GET":
                response = requests.get(url, timeout=10)
            elif method == "POST":
                response = requests.post(url, json=data, timeout=10)
            else:
                raise ValueError(f"Unsupported method: {method}")
                
            return response
        except requests.exceptions.RequestException as e:
            print(f"Request failed: {e}")
            return None
            
    def test_static_coupons(self):
        """Test all 5 static coupons with correct discounts"""
        print("\n=== Testing Static Coupons ===")
        
        # Expected static coupons and their discounts
        static_coupons = {
            "SA0": 10,
            "BU0": 5, 
            "STA158": 15,
            "FR10": 10,
            "GLK5": 5
        }
        
        for code, expected_discount in static_coupons.items():
            response = self.make_request("POST", "/test-coupon", {
                "code": code,
                "chatId": "test-static-user",
                "markUsed": False
            })
            
            if response and response.status_code == 200:
                data = response.json()
                result = data.get("result", data)  # Handle both old and new response formats
                if result.get("discount") == expected_discount and result.get("type") == "static":
                    self.log_test(f"Static coupon {code}", True, f"Correct discount: {expected_discount}%")
                else:
                    self.log_test(f"Static coupon {code}", False, 
                                f"Expected {expected_discount}%, got {result}")
            else:
                self.log_test(f"Static coupon {code}", False, 
                            f"Request failed: {response.status_code if response else 'No response'}")
                            
    def test_case_insensitivity(self):
        """Test case insensitivity - PREVIOUSLY FAILED"""
        print("\n=== Testing Case Insensitivity (Previously Failed) ===")
        
        # Test lowercase versions
        lowercase_tests = [
            ("sa0", 10),
            ("bu0", 5),
            ("sta158", 15),
            ("glk5", 5)
        ]
        
        for code, expected_discount in lowercase_tests:
            response = self.make_request("POST", "/test-coupon", {
                "code": code,
                "chatId": "test-case-user",
                "markUsed": False
            })
            
            if response and response.status_code == 200:
                data = response.json()
                result = data.get("result", data)  # Handle both old and new response formats
                if result.get("discount") == expected_discount and result.get("type") == "static":
                    self.log_test(f"Case insensitive {code}", True, 
                                f"Lowercase resolved to {expected_discount}% discount")
                else:
                    self.log_test(f"Case insensitive {code}", False, 
                                f"Expected {expected_discount}%, got {result}")
            else:
                self.log_test(f"Case insensitive {code}", False, 
                            f"Lowercase not recognized: {response.status_code if response else 'No response'}")
                            
        # Test mixed case
        mixed_case_tests = [("Sa0", 10), ("Bu0", 5)]
        for code, expected_discount in mixed_case_tests:
            response = self.make_request("POST", "/test-coupon", {
                "code": code,
                "chatId": "test-mixed-case",
                "markUsed": False
            })
            
            if response and response.status_code == 200:
                data = response.json()
                result = data.get("result", data)  # Handle both old and new response formats
                if result.get("discount") == expected_discount:
                    self.log_test(f"Mixed case {code}", True, f"Resolved correctly")
                else:
                    self.log_test(f"Mixed case {code}", False, f"Got {result}")
            else:
                self.log_test(f"Mixed case {code}", False, "Not recognized")
                
    def test_daily_coupons(self):
        """Test daily coupon generation and validation"""
        print("\n=== Testing Daily Coupons ===")
        
        # Get today's daily coupons
        response = self.make_request("GET", "/test-coupon/daily")
        if not response or response.status_code != 200:
            self.log_test("Daily coupon endpoint", False, "Endpoint not accessible")
            return None, None
            
        daily_data = response.json()
        self.log_test("Daily coupon endpoint", True, f"Got daily coupons for {daily_data.get('date')}")
        
        codes = daily_data.get("codes", {})
        nmd5_code = None
        nmd10_code = None
        
        # Find NMD5 and NMD10 codes
        for code, details in codes.items():
            if code.startswith("NMD5") and details.get("discount") == 5:
                nmd5_code = code
            elif code.startswith("NMD10") and details.get("discount") == 10:
                nmd10_code = code
        
        # Test NMD5 coupon
        if nmd5_code:
            response = self.make_request("POST", "/test-coupon", {
                "code": nmd5_code,
                "chatId": "retest-daily-1",
                "markUsed": False
            })
            
            if response and response.status_code == 200:
                data = response.json()
                result = data.get("result", data)  # Handle both old and new response formats
                if result.get("discount") == 5 and result.get("type") == "daily":
                    self.log_test("Daily NMD5 validation", True, "5% discount, type: daily")
                else:
                    self.log_test("Daily NMD5 validation", False, f"Got {result}")
            else:
                self.log_test("Daily NMD5 validation", False, "Validation failed")
                
        # Test NMD10 coupon  
        if nmd10_code:
            response = self.make_request("POST", "/test-coupon", {
                "code": nmd10_code,
                "chatId": "retest-daily-2", 
                "markUsed": False
            })
            
            if response and response.status_code == 200:
                data = response.json()
                result = data.get("result", data)  # Handle both old and new response formats
                if result.get("discount") == 10 and result.get("type") == "daily":
                    self.log_test("Daily NMD10 validation", True, "10% discount, type: daily")
                else:
                    self.log_test("Daily NMD10 validation", False, f"Got {result}")
            else:
                self.log_test("Daily NMD10 validation", False, "Validation failed")
                
        return nmd5_code, nmd10_code
        
    def test_single_use_enforcement(self, nmd5_code, nmd10_code):
        """Test daily coupon single-use enforcement - PREVIOUSLY FAILED"""
        print("\n=== Testing Single-Use Enforcement (Previously Failed) ===")
        
        # Use NMD10 code if NMD5 is already used, or find an unused code
        test_code = nmd10_code if nmd10_code else nmd5_code
        
        if not test_code:
            self.log_test("Single-use test setup", False, "No daily code available")
            return
            
        chat_id = f"singleuse-fresh-{int(time.time())}"  # Use timestamp for uniqueness
        
        # First use - mark as used
        response = self.make_request("POST", "/test-coupon", {
            "code": test_code,
            "chatId": chat_id,
            "markUsed": True
        })
        
        if response and response.status_code == 200:
            data = response.json()
            result = data.get("result", data)  # Handle both old and new response formats
            if "discount" in result:
                self.log_test("Single-use first attempt", True, f"Successfully used coupon: {result.get('discount')}%")
            else:
                self.log_test("Single-use first attempt", False, f"Unexpected response: {result}")
                return
        else:
            self.log_test("Single-use first attempt", False, "First use failed")
            return
            
        # Second use - should be rejected
        response = self.make_request("POST", "/test-coupon", {
            "code": test_code,
            "chatId": chat_id,
            "markUsed": False
        })
        
        if response and response.status_code == 200:
            data = response.json()
            result = data.get("result", data)  # Handle both old and new response formats
            if result.get("error") == "already_used":
                self.log_test("Single-use second attempt", True, "Correctly rejected with already_used")
            else:
                self.log_test("Single-use second attempt", False, 
                            f"Should be rejected but got: {result}")
        else:
            self.log_test("Single-use second attempt", False, "Request failed")
            
        # Test with different chatId - should still work
        different_chat_id = f"singleuse-different-{int(time.time())}"
        response = self.make_request("POST", "/test-coupon", {
            "code": test_code,
            "chatId": different_chat_id,
            "markUsed": False
        })
        
        if response and response.status_code == 200:
            data = response.json()
            result = data.get("result", data)  # Handle both old and new response formats
            if "discount" in result:
                self.log_test("Single-use different user", True, "Different user can still use")
            else:
                self.log_test("Single-use different user", False, f"Got {result}")
        else:
            self.log_test("Single-use different user", False, "Different user test failed")
            
    def test_invalid_coupons(self):
        """Test invalid coupon handling"""
        print("\n=== Testing Invalid Coupons ===")
        
        invalid_tests = [
            ("FAKECOUPON", "invalid_coupon"),
            ("EXPIRED123", "invalid_coupon"),
            ("", "400 error"),  # Empty string
        ]
        
        for code, expected in invalid_tests:
            if code == "":
                # Test empty string
                response = self.make_request("POST", "/test-coupon", {
                    "code": "",
                    "chatId": "test-invalid"
                })
                
                if response:
                    if response.status_code == 200:
                        data = response.json()
                        if data.get("error") == "code is required":
                            self.log_test("Empty coupon code", True, "Returns 'code is required' error")
                        else:
                            self.log_test("Empty coupon code", False, f"Got {data}")
                    elif response.status_code == 400:
                        self.log_test("Empty coupon code", True, "Returns 400 error")
                    else:
                        self.log_test("Empty coupon code", False, f"Got status {response.status_code}")
                else:
                    self.log_test("Empty coupon code", False, "No response received")
            else:
                response = self.make_request("POST", "/test-coupon", {
                    "code": code,
                    "chatId": "test-invalid"
                })
                
                if response and response.status_code == 200:
                    data = response.json()
                    result = data.get("result", data)  # Handle both old and new response formats
                    if result.get("error") == expected:
                        self.log_test(f"Invalid coupon {code}", True, f"Correctly returns {expected}")
                    else:
                        self.log_test(f"Invalid coupon {code}", False, f"Got {result}")
                else:
                    self.log_test(f"Invalid coupon {code}", False, "Request failed")
                    
        # Test empty body
        try:
            response = requests.post(f"{self.base_url}/test-coupon", json={}, timeout=10)
            if response.status_code == 400:
                self.log_test("Empty request body", True, "Returns 400 error")
            else:
                self.log_test("Empty request body", False, f"Got {response.status_code}")
        except:
            self.log_test("Empty request body", False, "Request failed")
            
    def test_welcome_offer(self):
        """Test welcome offer coupons"""
        print("\n=== Testing Welcome Offer Coupons ===")
        
        # Test valid format but likely expired/used
        response = self.make_request("POST", "/test-coupon", {
            "code": "WELCOME25-TNRWBE",
            "chatId": "test-welcome"
        })
        
        if response and response.status_code == 200:
            data = response.json()
            result = data.get("result", data)  # Handle both old and new response formats
            # Either valid discount or already_used/expired is acceptable
            if "discount" in result or result.get("error") in ["already_used", "expired", "invalid_coupon"]:
                self.log_test("Welcome offer valid format", True, f"Response: {result}")
            else:
                self.log_test("Welcome offer valid format", False, f"Unexpected: {result}")
        else:
            self.log_test("Welcome offer valid format", False, "Request failed")
            
        # Test invalid welcome code
        response = self.make_request("POST", "/test-coupon", {
            "code": "WELCOME25-FAKECODE",
            "chatId": "test-welcome"
        })
        
        if response and response.status_code == 200:
            data = response.json()
            result = data.get("result", data)  # Handle both old and new response formats
            if result.get("error") == "invalid_coupon":
                self.log_test("Welcome offer invalid", True, "Correctly rejects fake code")
            else:
                self.log_test("Welcome offer invalid", False, f"Got {result}")
        else:
            self.log_test("Welcome offer invalid", False, "Request failed")
            
    def test_edge_cases(self):
        """Test edge cases"""
        print("\n=== Testing Edge Cases ===")
        
        # Very long code
        long_code = "A" * 150
        response = self.make_request("POST", "/test-coupon", {
            "code": long_code,
            "chatId": "test-edge"
        })
        
        if response and response.status_code == 200:
            data = response.json()
            result = data.get("result", data)  # Handle both old and new response formats
            if result.get("error") == "invalid_coupon":
                self.log_test("Very long code", True, "Correctly rejects without crashing")
            else:
                self.log_test("Very long code", False, f"Got {result}")
        else:
            self.log_test("Very long code", False, "Request failed or crashed")
            
        # Special characters
        special_code = "TEST@#$%^&*()"
        response = self.make_request("POST", "/test-coupon", {
            "code": special_code,
            "chatId": "test-edge"
        })
        
        if response and response.status_code == 200:
            data = response.json()
            result = data.get("result", data)  # Handle both old and new response formats
            if result.get("error") == "invalid_coupon":
                self.log_test("Special characters", True, "Correctly rejects without crashing")
            else:
                self.log_test("Special characters", False, f"Got {result}")
        else:
            self.log_test("Special characters", False, "Request failed or crashed")
            
        # Missing chatId - should default to test-user-000
        response = self.make_request("POST", "/test-coupon", {
            "code": "SA0"
            # No chatId
        })
        
        if response and response.status_code == 200:
            data = response.json()
            result = data.get("result", data)  # Handle both old and new response formats
            if result.get("discount") == 10:
                self.log_test("Missing chatId", True, "Defaults and works correctly")
            else:
                self.log_test("Missing chatId", False, f"Got {result}")
        else:
            self.log_test("Missing chatId", False, "Request failed")
            
    def test_static_endpoint(self):
        """Test static coupon endpoint"""
        print("\n=== Testing Static Coupon Endpoint ===")
        
        response = self.make_request("GET", "/test-coupon/static")
        if response and response.status_code == 200:
            data = response.json()
            expected_codes = ["SA0", "BU0", "STA158", "FR10", "GLK5"]
            
            if all(code in str(data) for code in expected_codes):
                self.log_test("Static endpoint", True, "Returns all expected coupon codes")
            else:
                self.log_test("Static endpoint", False, f"Missing codes in: {data}")
        else:
            self.log_test("Static endpoint", False, "Endpoint not accessible")
            
    def run_all_tests(self):
        """Run complete test suite"""
        print("🚀 Starting Comprehensive Coupon System Testing")
        print(f"Testing against: {self.base_url}")
        print("=" * 60)
        
        # Test static endpoint first
        self.test_static_endpoint()
        
        # Test all static coupons
        self.test_static_coupons()
        
        # Test case insensitivity (previously failed)
        self.test_case_insensitivity()
        
        # Test daily coupons and get codes for single-use test
        nmd5_code, nmd10_code = self.test_daily_coupons()
        
        # Test single-use enforcement (previously failed)
        if nmd5_code or nmd10_code:
            self.test_single_use_enforcement(nmd5_code, nmd10_code)
            
        # Test invalid coupons
        self.test_invalid_coupons()
        
        # Test welcome offers
        self.test_welcome_offer()
        
        # Test edge cases
        self.test_edge_cases()
        
        # Print summary
        self.print_summary()
        
    def print_summary(self):
        """Print test summary"""
        print("\n" + "=" * 60)
        print("🎯 TEST SUMMARY")
        print("=" * 60)
        
        total_tests = len(self.test_results)
        passed_count = len(self.passed_tests)
        failed_count = len(self.failed_tests)
        
        print(f"Total Tests: {total_tests}")
        print(f"✅ Passed: {passed_count}")
        print(f"❌ Failed: {failed_count}")
        print(f"Success Rate: {(passed_count/total_tests)*100:.1f}%")
        
        if self.failed_tests:
            print(f"\n❌ FAILED TESTS ({failed_count}):")
            for test in self.failed_tests:
                print(f"  - {test}")
                
        if self.passed_tests:
            print(f"\n✅ PASSED TESTS ({passed_count}):")
            for test in self.passed_tests:
                print(f"  - {test}")

if __name__ == "__main__":
    tester = CouponTester()
    tester.run_all_tests()