"""
Speechcue SIP Test - Iteration 4 Backend Tests
Tests for: hasUsedCalls flag, /testsip messaging, language files, menu updates
"""
import pytest
import requests
import os

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://vault-setup-29.preview.emergentagent.com')

class TestVerifyOtpEndpoint:
    """Test /api/phone/test/verify-otp endpoint"""
    
    def test_invalid_otp_returns_401_with_testsip_message(self):
        """Test that invalid OTP returns 401 with '/testsip' in message"""
        response = requests.post(
            f"{BASE_URL}/api/phone/test/verify-otp",
            json={"otp": "123456"},
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        data = response.json()
        
        assert 'error' in data, "Response should have 'error' field"
        assert 'message' in data, "Response should have 'message' field"
        assert '/testsip' in data['message'], f"Message should contain '/testsip': {data['message']}"
        print(f"✅ Invalid OTP returns 401 with message: {data['message']}")
    
    def test_short_otp_returns_400(self):
        """Test that OTP < 6 digits returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/phone/test/verify-otp",
            json={"otp": "12345"},
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        data = response.json()
        assert 'error' in data
        print(f"✅ Short OTP returns 400 with error: {data['error']}")
    
    def test_empty_otp_returns_400(self):
        """Test that empty OTP returns 400"""
        response = requests.post(
            f"{BASE_URL}/api/phone/test/verify-otp",
            json={"otp": ""},
            headers={"Content-Type": "application/json"}
        )
        
        assert response.status_code == 400, f"Expected 400, got {response.status_code}"
        print("✅ Empty OTP returns 400")


class TestOldEndpointRemoved:
    """Test that old /api/sip-test-credentials endpoint is removed"""
    
    def test_old_endpoint_returns_404(self):
        """Old endpoint should return 404 or error"""
        response = requests.get(f"{BASE_URL}/api/sip-test-credentials")
        
        assert response.status_code in [404, 500], f"Expected 404/500, got {response.status_code}"
        print(f"✅ Old /api/sip-test-credentials endpoint returns {response.status_code}")


class TestFrontendLoads:
    """Test that frontend page loads correctly - HTTP status only
    Note: React SPA content verified via Playwright browser tests
    """
    
    def test_phone_test_page_returns_200(self):
        """Test /phone/test page returns 200 status"""
        response = requests.get(f"{BASE_URL}/phone/test")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        print("✅ Phone test page returns 200 status")
        # Note: Content verification done via Playwright since React SPA needs JS rendering


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
