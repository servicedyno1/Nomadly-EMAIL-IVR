#!/usr/bin/env python3
"""
SMS App Backend Test Suite for Nomadly SMS App
Testing all API endpoints served through FastAPI proxy to Node.js Express
"""

import requests
import json
import time
from typing import Dict, Any, Optional

# Backend URL from environment
BACKEND_URL = "https://vault-key-manager.preview.emergentagent.com"
TEST_CHAT_ID = "6687923716"
INVALID_CHAT_ID = "9999999999"

class SMSAppTester:
    def __init__(self):
        self.session = requests.Session()
        self.session.timeout = 30
        self.campaign_id = None
        self.test_results = []
        
    def log_test(self, test_name: str, success: bool, details: str = "", response_data: Any = None):
        """Log test results"""
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"{status}: {test_name}")
        if details:
            print(f"   {details}")
        if response_data and not success:
            print(f"   Response: {response_data}")
        
        self.test_results.append({
            "test": test_name,
            "success": success,
            "details": details,
            "response": response_data
        })
        print()
        
    def test_auth_valid(self) -> bool:
        """Test 1: Valid authentication with test chatId"""
        print("🔍 Test 1: Valid Authentication")
        
        try:
            url = f"{BACKEND_URL}/api/sms-app/auth/{TEST_CHAT_ID}"
            response = self.session.get(url)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('valid') == True and 'user' in data:
                    user = data['user']
                    expected_fields = ['chatId', 'name', 'plan', 'planExpiry', 'isSubscribed', 'isFreeTrial']
                    missing_fields = [field for field in expected_fields if field not in user]
                    
                    if not missing_fields:
                        self.log_test("Valid Authentication", True, 
                                    f"User: {user.get('name')}, Plan: {user.get('plan')}, Free SMS: {user.get('freeSmsRemaining', 0)}")
                        return True
                    else:
                        self.log_test("Valid Authentication", False, 
                                    f"Missing user fields: {missing_fields}", data)
                        return False
                else:
                    self.log_test("Valid Authentication", False, 
                                "Invalid response structure", data)
                    return False
            else:
                self.log_test("Valid Authentication", False, 
                            f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Valid Authentication", False, f"Exception: {e}")
            return False
    
    def test_plan_info(self) -> bool:
        """Test 2: Get plan information"""
        print("🔍 Test 2: Plan Information")
        
        try:
            url = f"{BACKEND_URL}/api/sms-app/plan/{TEST_CHAT_ID}"
            response = self.session.get(url)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ['chatId', 'name', 'plan', 'freeSmsUsed', 'freeSmsLimit']
                missing_fields = [field for field in required_fields if field not in data]
                
                if not missing_fields:
                    self.log_test("Plan Information", True, 
                                f"Plan: {data.get('plan')}, SMS Used: {data.get('freeSmsUsed')}/{data.get('freeSmsLimit')}")
                    return True
                else:
                    self.log_test("Plan Information", False, 
                                f"Missing fields: {missing_fields}", data)
                    return False
            else:
                self.log_test("Plan Information", False, 
                            f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Plan Information", False, f"Exception: {e}")
            return False
    
    def test_create_campaign(self) -> bool:
        """Test 3: Create a new campaign"""
        print("🔍 Test 3: Create Campaign")
        
        try:
            url = f"{BACKEND_URL}/api/sms-app/campaigns"
            payload = {
                "chatId": int(TEST_CHAT_ID),
                "name": "API Test Campaign",
                "content": ["Hello [name]! This is a test message."],
                "contacts": [
                    {"phoneNumber": "+18189279992", "name": "Test User"}
                ],
                "source": "app"
            }
            
            response = self.session.post(url, json=payload)
            
            if response.status_code == 200:
                data = response.json()
                if 'campaign' in data and '_id' in data['campaign']:
                    campaign = data['campaign']
                    self.campaign_id = campaign['_id']
                    self.log_test("Create Campaign", True, 
                                f"Campaign ID: {self.campaign_id}, Name: {campaign.get('name')}")
                    return True
                else:
                    self.log_test("Create Campaign", False, 
                                "Invalid response structure", data)
                    return False
            else:
                self.log_test("Create Campaign", False, 
                            f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Create Campaign", False, f"Exception: {e}")
            return False
    
    def test_get_campaigns(self) -> bool:
        """Test 4: Get all campaigns for user"""
        print("🔍 Test 4: Get Campaigns")
        
        try:
            url = f"{BACKEND_URL}/api/sms-app/campaigns/{TEST_CHAT_ID}"
            response = self.session.get(url)
            
            if response.status_code == 200:
                data = response.json()
                if 'campaigns' in data and isinstance(data['campaigns'], list):
                    campaigns = data['campaigns']
                    campaign_found = any(c.get('_id') == self.campaign_id for c in campaigns) if self.campaign_id else True
                    
                    if campaign_found:
                        self.log_test("Get Campaigns", True, 
                                    f"Found {len(campaigns)} campaigns")
                        return True
                    else:
                        self.log_test("Get Campaigns", False, 
                                    f"Created campaign {self.campaign_id} not found in list")
                        return False
                else:
                    self.log_test("Get Campaigns", False, 
                                "Invalid response structure", data)
                    return False
            else:
                self.log_test("Get Campaigns", False, 
                            f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Get Campaigns", False, f"Exception: {e}")
            return False
    
    def test_update_campaign(self) -> bool:
        """Test 5: Update campaign"""
        print("🔍 Test 5: Update Campaign")
        
        if not self.campaign_id:
            self.log_test("Update Campaign", False, "No campaign ID available")
            return False
        
        try:
            url = f"{BACKEND_URL}/api/sms-app/campaigns/{self.campaign_id}"
            payload = {
                "chatId": int(TEST_CHAT_ID),
                "name": "Updated API Test Campaign"
            }
            
            response = self.session.put(url, json=payload)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success') == True:
                    self.log_test("Update Campaign", True, "Campaign updated successfully")
                    return True
                else:
                    self.log_test("Update Campaign", False, 
                                "Update not successful", data)
                    return False
            else:
                self.log_test("Update Campaign", False, 
                            f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Update Campaign", False, f"Exception: {e}")
            return False
    
    def test_update_progress(self) -> bool:
        """Test 6: Update campaign progress"""
        print("🔍 Test 6: Update Campaign Progress")
        
        if not self.campaign_id:
            self.log_test("Update Campaign Progress", False, "No campaign ID available")
            return False
        
        try:
            url = f"{BACKEND_URL}/api/sms-app/campaigns/{self.campaign_id}/progress"
            payload = {
                "chatId": int(TEST_CHAT_ID),
                "sentCount": 1,
                "failedCount": 0,
                "status": "sending"
            }
            
            response = self.session.put(url, json=payload)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('ok') == True:
                    self.log_test("Update Campaign Progress", True, "Progress updated successfully")
                    return True
                else:
                    self.log_test("Update Campaign Progress", False, 
                                "Progress update not successful", data)
                    return False
            else:
                self.log_test("Update Campaign Progress", False, 
                            f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Update Campaign Progress", False, f"Exception: {e}")
            return False
    
    def test_report_sms_sent(self) -> bool:
        """Test 7: Report SMS sent"""
        print("🔍 Test 7: Report SMS Sent")
        
        try:
            url = f"{BACKEND_URL}/api/sms-app/sms-sent/{TEST_CHAT_ID}"
            response = self.session.post(url)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('ok') == True:
                    self.log_test("Report SMS Sent", True, "SMS count incremented")
                    return True
                else:
                    self.log_test("Report SMS Sent", False, 
                                "SMS report not successful", data)
                    return False
            else:
                self.log_test("Report SMS Sent", False, 
                            f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Report SMS Sent", False, f"Exception: {e}")
            return False
    
    def test_full_sync(self) -> bool:
        """Test 8: Full sync endpoint"""
        print("🔍 Test 8: Full Sync")
        
        try:
            url = f"{BACKEND_URL}/api/sms-app/sync/{TEST_CHAT_ID}"
            response = self.session.get(url)
            
            if response.status_code == 200:
                data = response.json()
                required_fields = ['user', 'campaigns', 'serverTime']
                missing_fields = [field for field in required_fields if field not in data]
                
                if not missing_fields:
                    self.log_test("Full Sync", True, 
                                f"Synced {len(data.get('campaigns', []))} campaigns, Server time: {data.get('serverTime')}")
                    return True
                else:
                    self.log_test("Full Sync", False, 
                                f"Missing fields: {missing_fields}", data)
                    return False
            else:
                self.log_test("Full Sync", False, 
                            f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Full Sync", False, f"Exception: {e}")
            return False
    
    def test_delete_campaign(self) -> bool:
        """Test 9: Delete campaign"""
        print("🔍 Test 9: Delete Campaign")
        
        if not self.campaign_id:
            self.log_test("Delete Campaign", False, "No campaign ID available")
            return False
        
        try:
            url = f"{BACKEND_URL}/api/sms-app/campaigns/{self.campaign_id}?chatId={TEST_CHAT_ID}"
            response = self.session.delete(url)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('success') == True:
                    self.log_test("Delete Campaign", True, "Campaign deleted successfully")
                    return True
                else:
                    self.log_test("Delete Campaign", False, 
                                "Delete not successful", data)
                    return False
            else:
                self.log_test("Delete Campaign", False, 
                            f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Delete Campaign", False, f"Exception: {e}")
            return False
    
    def test_logout(self) -> bool:
        """Test 10: Logout"""
        print("🔍 Test 10: Logout")
        
        try:
            url = f"{BACKEND_URL}/api/sms-app/logout/{TEST_CHAT_ID}"
            response = self.session.post(url)
            
            if response.status_code == 200:
                data = response.json()
                if data.get('ok') == True:
                    self.log_test("Logout", True, "Logout successful")
                    return True
                else:
                    self.log_test("Logout", False, 
                                "Logout not successful", data)
                    return False
            else:
                self.log_test("Logout", False, 
                            f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Logout", False, f"Exception: {e}")
            return False
    
    def test_invalid_auth(self) -> bool:
        """Test 11: Invalid authentication"""
        print("🔍 Test 11: Invalid Authentication")
        
        try:
            url = f"{BACKEND_URL}/api/sms-app/auth/{INVALID_CHAT_ID}"
            response = self.session.get(url)
            
            if response.status_code == 401:
                data = response.json()
                if data.get('valid') == False:
                    self.log_test("Invalid Authentication", True, 
                                f"Correctly rejected invalid chatId: {data.get('error', 'No error message')}")
                    return True
                else:
                    self.log_test("Invalid Authentication", False, 
                                "Should have returned valid=false", data)
                    return False
            else:
                self.log_test("Invalid Authentication", False, 
                            f"Expected HTTP 401, got {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("Invalid Authentication", False, f"Exception: {e}")
            return False
    
    def test_sms_app_web(self) -> bool:
        """Test 12: SMS App Web interface"""
        print("🔍 Test 12: SMS App Web Interface")
        
        try:
            url = f"{BACKEND_URL}/api/sms-app-web"
            response = self.session.get(url)
            
            if response.status_code == 200:
                content = response.text
                if 'html' in content.lower() or 'DOCTYPE' in content:
                    self.log_test("SMS App Web Interface", True, 
                                f"HTML content returned ({len(content)} chars)")
                    return True
                else:
                    self.log_test("SMS App Web Interface", False, 
                                "Response doesn't appear to be HTML", content[:200])
                    return False
            elif response.status_code == 404:
                self.log_test("SMS App Web Interface", False, 
                            "SMS App web files not found (404)")
                return False
            else:
                self.log_test("SMS App Web Interface", False, 
                            f"HTTP {response.status_code}", response.text)
                return False
                
        except Exception as e:
            self.log_test("SMS App Web Interface", False, f"Exception: {e}")
            return False
    
    def run_all_tests(self) -> bool:
        """Run all SMS app tests in sequence"""
        print("🚀 Starting Nomadly SMS App Backend Testing Suite")
        print("=" * 70)
        print(f"Backend URL: {BACKEND_URL}")
        print(f"Test Chat ID: {TEST_CHAT_ID}")
        print("=" * 70)
        
        tests = [
            self.test_auth_valid,
            self.test_plan_info,
            self.test_create_campaign,
            self.test_get_campaigns,
            self.test_update_campaign,
            self.test_update_progress,
            self.test_report_sms_sent,
            self.test_full_sync,
            self.test_delete_campaign,
            self.test_logout,
            self.test_invalid_auth,
            self.test_sms_app_web
        ]
        
        passed = 0
        total = len(tests)
        
        for test in tests:
            try:
                if test():
                    passed += 1
                time.sleep(0.5)  # Small delay between tests
            except Exception as e:
                print(f"❌ FAIL: Test {test.__name__} crashed: {e}")
        
        print("=" * 70)
        print(f"📊 TEST RESULTS: {passed}/{total} tests passed ({passed/total*100:.1f}%)")
        
        if passed == total:
            print("🎉 ALL TESTS PASSED - SMS App backend is working correctly!")
            return True
        else:
            print(f"⚠️  {total - passed} test(s) failed - see details above")
            return False

def main():
    """Main test runner"""
    tester = SMSAppTester()
    success = tester.run_all_tests()
    
    # Save detailed results
    with open('/app/sms_app_test_results.json', 'w') as f:
        json.dump({
            'timestamp': time.time(),
            'backend_url': BACKEND_URL,
            'test_chat_id': TEST_CHAT_ID,
            'total_tests': len(tester.test_results),
            'passed_tests': sum(1 for r in tester.test_results if r['success']),
            'success_rate': sum(1 for r in tester.test_results if r['success']) / len(tester.test_results) * 100,
            'results': tester.test_results
        }, f, indent=2)
    
    return success

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)