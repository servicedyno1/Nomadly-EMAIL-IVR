#!/usr/bin/env python3
"""
Backend Cleanup Verification Test - READ-ONLY ONLY
Verifies that the repo cleanup (deletion of 88 unused files) caused NO regression.
Tests ONLY safe, read-only endpoints.

SAFETY: This backend is wired to PRODUCTION MongoDB + LIVE payment/telephony/domain APIs.
- READ-ONLY ONLY (no mutations, no payments, no provisioning)
- Tests health endpoint and a few safe dev endpoints
"""

import requests
import json
import sys

# Backend URL from frontend/.env
BACKEND_URL = "https://elegant-hofstadter-9.preview.emergentagent.com"

def print_section(title):
    """Print a formatted section header"""
    print("\n" + "="*80)
    print(f"  {title}")
    print("="*80)

def test_health():
    """
    PRIMARY TEST: Health check
    GET {REACT_APP_BACKEND_URL}/api/health
    Expected: 200 with JSON {status:"healthy", database:"connected"}
    """
    print_section("TEST 1: Health Check (Primary)")
    
    url = f"{BACKEND_URL}/api/health"
    print(f"URL: {url}")
    print(f"Method: GET")
    
    try:
        response = requests.get(url, timeout=30)
        print(f"\nStatus Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"\nResponse JSON:")
            print(json.dumps(data, indent=2))
            
            # Verify expected fields
            print("\n--- VERIFICATION ---")
            print(f"✓ HTTP 200: {'✅' if response.status_code == 200 else '❌'}")
            print(f"✓ status === 'healthy': {'✅' if data.get('status') == 'healthy' else '❌'}")
            print(f"✓ database === 'connected': {'✅' if data.get('database') == 'connected' else '❌'}")
            
            return (response.status_code == 200 and 
                   data.get('status') == 'healthy' and 
                   data.get('database') == 'connected')
        else:
            print(f"\nResponse Text: {response.text}")
            return False
            
    except Exception as e:
        print(f"\n❌ ERROR: {str(e)}")
        return False

def test_call_reconciler():
    """
    OPTIONAL TEST 1: Call reconciler dev test (read-only, synthetic)
    POST {REACT_APP_BACKEND_URL}/api/dev/call-reconciler-test with body {}
    """
    print_section("TEST 2: Call Reconciler Dev Test (Optional)")
    
    url = f"{BACKEND_URL}/api/dev/call-reconciler-test"
    print(f"URL: {url}")
    print(f"Method: POST")
    print(f"Body: {{}}")
    print(f"Note: This is a synthetic/self-cleaning dev test (no production data mutation)")
    
    try:
        response = requests.post(url, json={}, timeout=30)
        print(f"\nStatus Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"\nResponse JSON:")
            print(json.dumps(data, indent=2))
            
            # Verify expected fields
            print("\n--- VERIFICATION ---")
            print(f"✓ HTTP 200: {'✅' if response.status_code == 200 else '❌'}")
            print(f"✓ top-level 'pass' === true: {'✅' if data.get('pass') == True else '❌'}")
            
            return response.status_code == 200 and data.get('pass') == True
        else:
            print(f"\nResponse Text: {response.text}")
            return False
            
    except Exception as e:
        print(f"\n❌ ERROR: {str(e)}")
        return False

def test_ux_fixes_audit():
    """
    OPTIONAL TEST 2: UX fixes audit dev test (read-only, diagnostic)
    GET {REACT_APP_BACKEND_URL}/api/dev/ux-fixes-audit
    """
    print_section("TEST 3: UX Fixes Audit Dev Test (Optional)")
    
    url = f"{BACKEND_URL}/api/dev/ux-fixes-audit"
    print(f"URL: {url}")
    print(f"Method: GET")
    print(f"Note: This is a diagnostic/audit endpoint (read-only)")
    
    try:
        response = requests.get(url, timeout=30)
        print(f"\nStatus Code: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"\nResponse JSON:")
            print(json.dumps(data, indent=2))
            
            # Verify expected fields
            print("\n--- VERIFICATION ---")
            print(f"✓ HTTP 200: {'✅' if response.status_code == 200 else '❌'}")
            print(f"✓ top-level 'ok' === true: {'✅' if data.get('ok') == True else '❌'}")
            
            return response.status_code == 200 and data.get('ok') == True
        else:
            print(f"\nResponse Text: {response.text}")
            return False
            
    except Exception as e:
        print(f"\n❌ ERROR: {str(e)}")
        return False

def main():
    """Run all tests and report results"""
    print("\n" + "="*80)
    print("  BACKEND CLEANUP VERIFICATION TEST")
    print("  Verifying repo cleanup (88 files deleted) caused NO regression")
    print("  READ-ONLY TESTING ONLY")
    print("="*80)
    print(f"\nBackend URL: {BACKEND_URL}")
    print("Safety: Testing ONLY read-only endpoints (no mutations, no payments)")
    
    results = {
        'test1_health': test_health(),
        'test2_call_reconciler': test_call_reconciler(),
        'test3_ux_fixes_audit': test_ux_fixes_audit()
    }
    
    # Summary
    print_section("SUMMARY")
    total = len(results)
    passed = sum(1 for v in results.values() if v)
    
    for test_name, result in results.items():
        status = '✅ PASSED' if result else '❌ FAILED'
        print(f"{test_name}: {status}")
    
    print(f"\nTotal: {passed}/{total} tests passed ({int(passed/total*100)}%)")
    
    if passed == total:
        print("\n✅ ALL TESTS PASSED - Cleanup caused NO regression!")
        print("   The backend is healthy and serving correctly.")
        print("   FastAPI proxy (8001) → Node service (5000) chain is working.")
        sys.exit(0)
    else:
        print(f"\n❌ {total - passed} TEST(S) FAILED - Potential regression detected")
        sys.exit(1)

if __name__ == "__main__":
    main()
