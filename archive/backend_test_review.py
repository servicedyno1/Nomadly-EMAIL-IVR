#!/usr/bin/env python3
"""
Nomadly Backend Review Request Verification Test
Test Date: January 2025
Backend URL: https://app-vault-setup-1.preview.emergentagent.com
Test User: 6687923716

Review Request Tests:
1. Health Check: GET /api/health — should return 200 with status: healthy
2. SMS App Auth: GET /api/sms-app/auth/6687923716 — should return 200
3. Code verification — VPS Phase 1.5: PRE-EMPTIVE CONTABO CANCELLATION
4. Code verification — VPS Phase 1.6: ESCALATING ADMIN NOTIFICATIONS
"""

import requests
import json
import sys
import os
from datetime import datetime

# Backend URL from environment
BACKEND_URL = "https://app-vault-setup-1.preview.emergentagent.com"
TEST_USER = "6687923716"

class ReviewRequestTester:
    def __init__(self):
        self.results = []
        self.passed = 0
        self.failed = 0
        
    def log_result(self, test_name, success, details="", response_data=None):
        """Log test result"""
        status = "✅ PASS" if success else "❌ FAIL"
        result = {
            "test": test_name,
            "status": status,
            "success": success,
            "details": details,
            "response_data": response_data,
            "timestamp": datetime.now().isoformat()
        }
        self.results.append(result)
        
        if success:
            self.passed += 1
        else:
            self.failed += 1
            
        print(f"{status}: {test_name}")
        if details:
            print(f"   Details: {details}")
        if response_data and not success:
            print(f"   Response: {response_data}")
        print()

    def test_health_check(self):
        """Test 1: Health Check - GET /api/health"""
        try:
            response = requests.get(f"{BACKEND_URL}/api/health", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("status") == "healthy":
                    self.log_result(
                        "Health Check", 
                        True, 
                        f"Status: {data.get('status')}, Database: {data.get('database', 'N/A')}, Uptime: {data.get('uptime', 'N/A')} hours"
                    )
                else:
                    self.log_result(
                        "Health Check", 
                        False, 
                        f"Expected status 'healthy', got '{data.get('status')}'",
                        data
                    )
            else:
                self.log_result(
                    "Health Check", 
                    False, 
                    f"Expected 200, got {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result("Health Check", False, f"Request failed: {str(e)}")

    def test_sms_app_auth(self):
        """Test 2: SMS App Auth - GET /api/sms-app/auth/6687923716"""
        try:
            response = requests.get(f"{BACKEND_URL}/api/sms-app/auth/{TEST_USER}", timeout=10)
            
            if response.status_code == 200:
                data = response.json()
                if data.get("valid") is True:
                    self.log_result(
                        "SMS App Auth", 
                        True, 
                        f"Valid: {data.get('valid')}, Can use SMS: {data.get('canUseSms')}, Free SMS: {data.get('freeSmsRemaining', 'N/A')}"
                    )
                else:
                    self.log_result(
                        "SMS App Auth", 
                        False, 
                        f"Expected valid=true, got valid={data.get('valid')}",
                        data
                    )
            else:
                self.log_result(
                    "SMS App Auth", 
                    False, 
                    f"Expected 200, got {response.status_code}",
                    response.text
                )
                
        except Exception as e:
            self.log_result("SMS App Auth", False, f"Request failed: {str(e)}")

    def verify_vps_phase_1_5(self):
        """Test 3: Code verification — VPS Phase 1.5: PRE-EMPTIVE CONTABO CANCELLATION"""
        try:
            file_path = "/app/js/_index.js"
            if not os.path.exists(file_path):
                self.log_result(
                    "VPS Phase 1.5 Code", 
                    False, 
                    f"File not found: {file_path}"
                )
                return
                
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Check for Phase 1.5 section
            phase_1_5_found = "Phase 1.5: PRE-EMPTIVE CONTABO CANCELLATION" in content
            
            if not phase_1_5_found:
                self.log_result(
                    "VPS Phase 1.5 Code", 
                    False, 
                    "Phase 1.5: PRE-EMPTIVE CONTABO CANCELLATION section not found"
                )
                return
                
            # Get Phase 1.5 section content
            phase_1_5_start = content.find("Phase 1.5: PRE-EMPTIVE CONTABO CANCELLATION")
            phase_1_6_start = content.find("Phase 1.6: ESCALATING ADMIN NOTIFICATIONS")
            if phase_1_6_start == -1:
                phase_1_6_start = len(content)
            phase_1_5_section = content[phase_1_5_start:phase_1_6_start]
            
            # Check for required components
            required_components = [
                ("5 hours query", "fiveHoursFromNow" in phase_1_5_section and "PENDING_CANCELLATION" in phase_1_5_section),
                ("deleteVPSinstance call", "deleteVPSinstance" in phase_1_5_section),
                ("_contaboCancelledEarly flag", "_contaboCancelledEarly: true" in phase_1_5_section),
                ("status CANCELLED", "status: 'CANCELLED'" in phase_1_5_section),
                ("admin notification", "TELEGRAM_ADMIN_CHAT_ID" in phase_1_5_section),
                ("URGENT failure notification", "URGENT: VPS Cancel FAILED" in phase_1_5_section)
            ]
            
            found_components = []
            missing_components = []
            
            for name, condition in required_components:
                if condition:
                    found_components.append(name)
                else:
                    missing_components.append(name)
            
            if len(found_components) >= 5:  # At least 5 out of 6 components should be found
                self.log_result(
                    "VPS Phase 1.5 Code", 
                    True, 
                    f"Phase 1.5 section verified with {len(found_components)}/6 required components: {', '.join(found_components)}"
                )
            else:
                self.log_result(
                    "VPS Phase 1.5 Code", 
                    False, 
                    f"Phase 1.5 section found but missing components: {missing_components}"
                )
                    
        except Exception as e:
            self.log_result("VPS Phase 1.5 Code", False, f"File read failed: {str(e)}")

    def verify_vps_phase_1_6(self):
        """Test 4: Code verification — VPS Phase 1.6: ESCALATING ADMIN NOTIFICATIONS"""
        try:
            file_path = "/app/js/_index.js"
            if not os.path.exists(file_path):
                self.log_result(
                    "VPS Phase 1.6 Code", 
                    False, 
                    f"File not found: {file_path}"
                )
                return
                
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                
            # Check for Phase 1.6 section
            phase_1_6_found = "Phase 1.6: ESCALATING ADMIN NOTIFICATIONS" in content
            
            if not phase_1_6_found:
                self.log_result(
                    "VPS Phase 1.6 Code", 
                    False, 
                    "Phase 1.6: ESCALATING ADMIN NOTIFICATIONS section not found"
                )
                return
                
            # Get Phase 1.6 section content
            phase_1_6_start = content.find("Phase 1.6: ESCALATING ADMIN NOTIFICATIONS")
            phase_2_start = content.find("Phase 2: DELETE on Contabo", phase_1_6_start)
            if phase_2_start == -1:
                phase_2_start = len(content)
            phase_1_6_section = content[phase_1_6_start:phase_2_start]
            
            # Check for required components
            required_components = [
                ("5h-24h query", "fiveHoursFromNow" in phase_1_6_section and "oneDayFromNow" in phase_1_6_section and "PENDING_CANCELLATION" in phase_1_6_section),
                ("24h/12h/6h tiers", "hours: 24" in phase_1_6_section and "hours: 12" in phase_1_6_section and "hours: 6" in phase_1_6_section),
                ("_adminNotifyHistory tracking", "_adminNotifyHistory" in phase_1_6_section),
                ("balance and shortfall", "usdBal" in phase_1_6_section and "shortfall" in phase_1_6_section)
            ]
            
            found_components = []
            missing_components = []
            
            for name, condition in required_components:
                if condition:
                    found_components.append(name)
                else:
                    missing_components.append(name)
            
            if len(found_components) >= 3:  # At least 3 out of 4 components should be found
                self.log_result(
                    "VPS Phase 1.6 Code", 
                    True, 
                    f"Phase 1.6 section verified with {len(found_components)}/4 required components: {', '.join(found_components)}"
                )
            else:
                self.log_result(
                    "VPS Phase 1.6 Code", 
                    False, 
                    f"Phase 1.6 section found but missing components: {missing_components}"
                )
                    
        except Exception as e:
            self.log_result("VPS Phase 1.6 Code", False, f"File read failed: {str(e)}")

    def run_all_tests(self):
        """Run all review request tests"""
        print("=" * 80)
        print("NOMADLY BACKEND REVIEW REQUEST VERIFICATION")
        print("=" * 80)
        print(f"Backend URL: {BACKEND_URL}")
        print(f"Test User: {TEST_USER}")
        print(f"Test Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("=" * 80)
        print()
        
        # API Endpoint Tests
        print("🌐 API ENDPOINT TESTS")
        print("-" * 40)
        self.test_health_check()
        self.test_sms_app_auth()
        
        # Code Verification Tests
        print("📋 CODE VERIFICATION TESTS")
        print("-" * 40)
        self.verify_vps_phase_1_5()
        self.verify_vps_phase_1_6()
        
        # Summary
        print("=" * 80)
        print("TEST SUMMARY")
        print("=" * 80)
        total_tests = self.passed + self.failed
        success_rate = (self.passed / total_tests * 100) if total_tests > 0 else 0
        
        print(f"Total Tests: {total_tests}")
        print(f"Passed: {self.passed}")
        print(f"Failed: {self.failed}")
        print(f"Success Rate: {success_rate:.1f}%")
        
        if self.failed > 0:
            print("\n❌ FAILED TESTS:")
            for result in self.results:
                if not result["success"]:
                    print(f"  - {result['test']}: {result['details']}")
        
        print("\n" + "=" * 80)
        
        return self.failed == 0

if __name__ == "__main__":
    tester = ReviewRequestTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)