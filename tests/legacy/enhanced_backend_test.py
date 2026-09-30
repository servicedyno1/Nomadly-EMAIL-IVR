#!/usr/bin/env python3
"""
Enhanced Backend Testing for Nomadly Node.js Application
Tests specific endpoints mentioned in the review request
"""

import requests
import json
import subprocess
import re
import pymongo
import os
from typing import Dict, Any, Optional

# Test Configuration
NODEJS_DIRECT_URL = "http://localhost:5000"
FASTAPI_PROXY_URL = "http://localhost:8001/api"

class NomadlyTester:
    def __init__(self):
        self.test_results = []
        self.passed = 0
        self.failed = 0
        
        # MongoDB connection for user verification
        self.mongo_client = None
        self.db = None
        self._init_mongo()
    
    def _init_mongo(self):
        """Initialize MongoDB connection"""
        try:
            mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
            self.mongo_client = pymongo.MongoClient(mongo_url)
            self.db = self.mongo_client.test  # DB_NAME from .env
            # Test connection
            self.mongo_client.admin.command('ping')
            print("✓ MongoDB connection established")
        except Exception as e:
            print(f"⚠ MongoDB connection failed: {e}")
            self.mongo_client = None
            self.db = None
    
    def log_test(self, test_name: str, passed: bool, expected: str, actual: str, details: str = ""):
        """Log test result"""
        status = "✅ PASS" if passed else "❌ FAIL"
        result = {
            "test": test_name,
            "status": status,
            "passed": passed,
            "expected": expected,
            "actual": actual,
            "details": details
        }
        self.test_results.append(result)
        if passed:
            self.passed += 1
        else:
            self.failed += 1
        print(f"{status} {test_name}: {details}")
        return passed
    
    def test_health_check(self) -> bool:
        """Test: Health check GET localhost:5000 should return 200 OK with Nomadly branding"""
        try:
            response = requests.get(f"{NODEJS_DIRECT_URL}/", timeout=10)
            expected = "200 OK with Nomadly branding"
            actual = f"{response.status_code} {response.reason}"
            
            passed = (response.status_code == 200 and "Nomadly" in response.text)
            details = f"Status: {actual}"
            if "Nomadly" in response.text:
                details += " | Contains Nomadly branding ✓"
            else:
                details += " | Missing Nomadly branding ✗"
            
            return self.log_test("Health Check (GET /)", passed, expected, actual, details)
            
        except Exception as e:
            return self.log_test("Health Check (GET /)", False, expected, f"ERROR: {str(e)}", "Connection failed")
    
    def test_voice_webhook(self) -> bool:
        """Test: POST localhost:5000/telnyx/voice-webhook with call.initiated event should return 200"""
        try:
            payload = {
                "data": {
                    "event_type": "call.initiated",
                    "payload": {
                        "direction": "incoming",
                        "from": "+15551234567",
                        "to": "+18777000068",
                        "call_control_id": "test-call-001", 
                        "call_leg_id": "leg-001",
                        "connection_id": "2898117434361775526",
                        "state": "ringing"
                    }
                }
            }
            headers = {"Content-Type": "application/json"}
            response = requests.post(f"{NODEJS_DIRECT_URL}/telnyx/voice-webhook", 
                                   json=payload, headers=headers, timeout=10)
            
            expected = "200"
            actual = f"{response.status_code}"
            
            passed = response.status_code == 200
            
            if passed:
                details = "Voice webhook accepting call.initiated events correctly"
            else:
                details = f"Status: {actual} | Webhook may not be handling calls properly"
                
            return self.log_test("Voice Webhook (POST /telnyx/voice-webhook)", passed, expected, actual, details)
            
        except Exception as e:
            return self.log_test("Voice Webhook (POST /telnyx/voice-webhook)", False, expected, f"ERROR: {str(e)}", "Connection failed")
    
    def test_prepare_call(self) -> bool:
        """Test: POST localhost:5000/phone/test/prepare-call with callerNumber should return 200 with success: true"""
        try:
            payload = {"callerNumber": "+18556820054"}
            headers = {"Content-Type": "application/json"}
            response = requests.post(f"{NODEJS_DIRECT_URL}/phone/test/prepare-call", 
                                   json=payload, headers=headers, timeout=10)
            
            expected = "200 with success: true"
            actual = f"{response.status_code}"
            
            passed = response.status_code == 200
            
            details_parts = [f"Status: {actual}"]
            
            if response.status_code == 200:
                try:
                    response_data = response.json()
                    if response_data.get('success') == True:
                        details_parts.append("success: true ✓")
                        passed = True
                    else:
                        details_parts.append(f"success: {response_data.get('success')} ✗")
                        passed = False
                except:
                    details_parts.append("Invalid JSON response")
                    passed = False
            else:
                details_parts.append("Expected 200 status")
                passed = False
                
            details = " | ".join(details_parts)
            return self.log_test("Prepare Call (POST /phone/test/prepare-call)", passed, expected, actual, details)
            
        except Exception as e:
            return self.log_test("Prepare Call (POST /phone/test/prepare-call)", False, expected, f"ERROR: {str(e)}", "Connection failed")
    
    def test_otp_endpoint(self) -> bool:
        """Test: POST localhost:5000/phone/test/verify-otp with invalid OTP should return 401"""
        try:
            payload = {"otp": "000000"}
            headers = {"Content-Type": "application/json"}
            response = requests.post(f"{NODEJS_DIRECT_URL}/phone/test/verify-otp", 
                                   json=payload, headers=headers, timeout=10)
            
            expected = "401 (invalid OTP)"
            actual = f"{response.status_code}"
            
            # Expect 401 for invalid OTP, confirms API route works
            passed = response.status_code == 401
            
            if passed:
                details = "API endpoint working correctly (invalid OTP rejected)"
            else:
                details = f"Status: {actual} | Expected 401 for invalid OTP"
                
            return self.log_test("OTP Endpoint (POST /phone/test/verify-otp)", passed, expected, actual, details)
            
        except Exception as e:
            return self.log_test("OTP Endpoint (POST /phone/test/verify-otp)", False, expected, f"ERROR: {str(e)}", "Connection failed")
    
    def test_mongodb_users(self) -> bool:
        """Test: Both users should exist in MongoDB with correct phone numbers"""
        if self.db is None:
            return self.log_test("MongoDB Users Verification", False, "DB connection", "No connection", "MongoDB not accessible")
        
        try:
            # Check for the two specific users mentioned in the review
            expected_users = [
                {"chatId": 5168006768, "phoneNumber": "+18556820054", "provider": "telnyx", "status": "active"},
                {"chatId": 817673476, "phoneNumber": "+18777000068", "provider": "telnyx", "status": "active"}
            ]
            
            found_users = []
            missing_users = []
            
            for expected_user in expected_users:
                chat_id = expected_user["chatId"]
                expected_phone = expected_user["phoneNumber"]
                
                # Query phoneNumbersOf collection
                user_doc = self.db.phoneNumbersOf.find_one({"_id": chat_id})
                
                if user_doc:
                    # Check if user has the expected phone number
                    numbers = user_doc.get("val", {}).get("numbers", []) if "val" in user_doc else user_doc.get("numbers", [])
                    matching_number = None
                    for num in numbers:
                        if num.get("phoneNumber") == expected_phone and num.get("status") == "active":
                            matching_number = num
                            break
                    
                    if matching_number:
                        found_users.append({
                            "chatId": chat_id, 
                            "phoneNumber": expected_phone,
                            "provider": matching_number.get("provider", "unknown"),
                            "status": matching_number.get("status", "unknown")
                        })
                    else:
                        missing_users.append(f"chatId {chat_id}: phone {expected_phone} not found or not active")
                else:
                    missing_users.append(f"chatId {chat_id}: user document not found")
            
            expected = "Both users with correct phone numbers"
            actual = f"{len(found_users)}/2 users found"
            passed = len(found_users) == 2 and len(missing_users) == 0
            
            details_parts = []
            for user in found_users:
                details_parts.append(f"chatId {user['chatId']}: {user['phoneNumber']} ({user['provider']}, {user['status']}) ✓")
            
            for missing in missing_users:
                details_parts.append(f"{missing} ✗")
            
            details = " | ".join(details_parts) if details_parts else "No users found"
            
            return self.log_test("MongoDB Users Verification", passed, expected, actual, details)
            
        except Exception as e:
            return self.log_test("MongoDB Users Verification", False, "User verification", f"ERROR: {str(e)}", "Database query failed")
    
    def test_nodejs_startup_logs(self) -> bool:
        """Test: Check Node.js startup logs for clean startup"""
        try:
            result = subprocess.run(['tail', '-n', '100', '/var/log/supervisor/nodejs.out.log'], 
                                  capture_output=True, text=True, timeout=10)
            
            if result.returncode != 0:
                return self.log_test("Node.js Startup Logs", False, "Log access", "Cannot read logs", "Permission or file not found")
            
            log_content = result.stdout
            
            # Check for required startup indicators
            checks = {
                "Services initialized": "all services initialized|services ready",
                "No errors": True,  # Will be checked separately
                "Telnyx ready": "telnyx.*ready|telnyx.*initialized",
                "Migration complete": "migration.*complete|migrated.*numbers",
            }
            
            found_logs = {}
            for check_name, pattern in checks.items():
                if check_name == "No errors":
                    # Check that there are NO error keywords in startup
                    error_patterns = ["error:", "failed:", "exception:", "cannot", "undefined"]
                    has_errors = any(error_word in log_content.lower() for error_word in error_patterns)
                    found_logs[check_name] = not has_errors
                else:
                    found_logs[check_name] = bool(re.search(pattern, log_content, re.IGNORECASE))
            
            # Count successful checks
            passed_checks = sum(1 for found in found_logs.values() if found)
            total_checks = len(checks)
            
            passed = passed_checks >= 2  # At least 2 out of 4 checks should pass for basic functionality
            expected = "Clean startup with services initialized"
            actual = f"{passed_checks}/{total_checks} checks passed"
            
            details_list = []
            for check_name, found in found_logs.items():
                status = "✓" if found else "✗"
                details_list.append(f"{check_name}: {status}")
            
            details = " | ".join(details_list)
            
            return self.log_test("Node.js Startup Logs", passed, expected, actual, details)
            
        except Exception as e:
            return self.log_test("Node.js Startup Logs", False, "Log verification", f"ERROR: {str(e)}", "Failed to read logs")
    
    def test_nodejs_error_logs(self) -> bool:
        """Test: Check Node.js error logs should be empty or minimal"""
        try:
            result = subprocess.run(['tail', '-n', '50', '/var/log/supervisor/nodejs.err.log'], 
                                  capture_output=True, text=True, timeout=10)
            
            if result.returncode != 0:
                return self.log_test("Node.js Error Logs", False, "Log access", "Cannot read error logs", "Permission or file not found")
            
            error_content = result.stdout.strip()
            
            expected = "Empty or minimal error logs"
            
            if not error_content:
                actual = "Empty"
                passed = True
                details = "No errors in Node.js stderr log"
            else:
                error_lines = [line for line in error_content.splitlines() if line.strip()]
                actual = f"{len(error_lines)} error lines"
                
                # Allow minimal errors (deprecation warnings, etc.)
                critical_errors = [line for line in error_lines 
                                 if any(keyword in line.lower() for keyword in ['fatal', 'crashed', 'cannot start', 'failed to start'])]
                
                passed = len(critical_errors) == 0
                
                if passed and len(error_lines) > 0:
                    details = f"Minor errors only ({len(error_lines)} lines) - no critical failures"
                elif passed:
                    details = "Clean error log"
                else:
                    # Show critical errors
                    preview = " | ".join(critical_errors[:2])
                    if len(critical_errors) > 2:
                        preview += f" | ... ({len(critical_errors)} critical errors)"
                    details = f"Critical errors found: {preview}"
                
            return self.log_test("Node.js Error Logs", passed, expected, actual, details)
            
        except Exception as e:
            return self.log_test("Node.js Error Logs", False, expected, f"ERROR: {str(e)}", "Failed to read error logs")
    
    def run_all_tests(self):
        """Run all tests specified in the review request"""
        print("🚀 Starting Nomadly Node.js Application Tests")
        print("=" * 70)
        
        # Execute tests in order based on review request
        self.test_health_check()
        self.test_voice_webhook()
        self.test_prepare_call()
        self.test_otp_endpoint()
        self.test_mongodb_users()
        self.test_nodejs_startup_logs()
        self.test_nodejs_error_logs()
        
        # Generate summary
        print("\n" + "=" * 70)
        print(f"📊 TEST SUMMARY: {self.passed}/{len(self.test_results)} PASSED")
        print("=" * 70)
        
        # Show failed tests details
        failed_tests = [test for test in self.test_results if not test["passed"]]
        if failed_tests:
            print("\n❌ FAILED TESTS:")
            for test in failed_tests:
                print(f"  • {test['test']}: {test['details']}")
        
        if self.failed == 0:
            print("\n🎉 ALL TESTS PASSED! Nomadly Node.js application is working correctly.")
        else:
            print(f"\n⚠️  {self.failed} tests failed. See details above.")
            
        # Cleanup
        if self.mongo_client:
            self.mongo_client.close()
            
        return self.failed == 0

def main():
    """Main test execution"""
    tester = NomadlyTester()
    success = tester.run_all_tests()
    
    if success:
        print("\n✅ Nomadly Node.js application is fully operational")
        exit(0)
    else:
        print("\n❌ Some tests failed - manual review required")
        exit(1)

if __name__ == "__main__":
    main()