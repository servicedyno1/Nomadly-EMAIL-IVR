#!/usr/bin/env python3
"""
Backend Test: Subdomain Shortener Bugfix (2026-10-08c)
Tests the fix for subdomain shortener activation (go.namewords.sbs)
"""
import requests
import json
import time
import random
import sys

# Configuration
BASE_URL = "https://b2ca4cb5-c43d-49df-b365-788a1d7196dc.preview.emergentagent.com/api/reseller/v1"
API_KEY = "rsk_live_cdc3f785ac3cfd813c6143d7813e1a59cc15fc42327ab736"
HEADERS = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}

# Test state
test_alias = None
test_results = []

def log_test(name, passed, details=""):
    """Log test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status}: {name}")
    if details:
        print(f"  {details}")
    test_results.append({"name": name, "passed": passed, "details": details})

def test_health():
    """Test 6: Sanity check - health endpoint"""
    print("\n" + "="*80)
    print("TEST 6: SANITY - Health Check")
    print("="*80)
    
    try:
        # Test main health endpoint
        resp = requests.get("https://b2ca4cb5-c43d-49df-b365-788a1d7196dc.preview.emergentagent.com/api/health", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            log_test("GET /api/health", True, f"Status: {data.get('status')}, Database: {data.get('database')}")
        else:
            log_test("GET /api/health", False, f"HTTP {resp.status_code}")
    except Exception as e:
        log_test("GET /api/health", False, f"Error: {str(e)}")

def test_subdomain_activation():
    """Test 2: Subdomain activation (the reported case)"""
    print("\n" + "="*80)
    print("TEST 2: SUBDOMAIN ACTIVATION (go.namewords.sbs)")
    print("="*80)
    
    domain = "go.namewords.sbs"
    
    # First, check current status
    try:
        resp = requests.get(f"{BASE_URL}/shortener/domains", headers=HEADERS, timeout=15)
        print(f"GET /shortener/domains: HTTP {resp.status_code}")
        if resp.status_code == 200:
            data = resp.json()
            existing = [d for d in data.get('domains', []) if d.get('domain') == domain]
            if existing:
                print(f"  Domain {domain} already exists with status: {existing[0].get('status')}")
                if existing[0].get('active'):
                    log_test("Subdomain already activated", True, f"Status: {existing[0].get('status')}, Active: True")
                    return True
    except Exception as e:
        print(f"  Warning: Could not check existing domains: {e}")
    
    # Activate the subdomain
    print(f"\nPOST /shortener/domains (domain: {domain}, source: existing)")
    try:
        payload = {"domain": domain, "source": "existing"}
        resp = requests.post(f"{BASE_URL}/shortener/domains", headers=HEADERS, json=payload, timeout=30)
        print(f"  HTTP {resp.status_code}")
        print(f"  Response: {json.dumps(resp.json(), indent=2)}")
        
        if resp.status_code == 200:
            data = resp.json()
            # Check if activation succeeded
            if data.get('status') in ['completed', 'railway_linked', 'dns_added']:
                log_test("POST /shortener/domains (subdomain activation)", True, 
                        f"HTTP 200, Status: {data.get('status')}")
            else:
                log_test("POST /shortener/domains (subdomain activation)", False, 
                        f"HTTP 200 but status is {data.get('status')}, not completed/railway_linked/dns_added")
        elif resp.status_code == 404:
            log_test("POST /shortener/domains (subdomain activation)", False, 
                    f"HTTP 404 not_found - BUG NOT FIXED: {resp.json().get('message', '')}")
            return False
        elif resp.status_code == 502:
            log_test("POST /shortener/domains (subdomain activation)", False, 
                    f"HTTP 502 activation_failed: {resp.json().get('message', '')}")
            return False
        else:
            log_test("POST /shortener/domains (subdomain activation)", False, 
                    f"HTTP {resp.status_code}: {resp.text}")
            return False
    except Exception as e:
        log_test("POST /shortener/domains (subdomain activation)", False, f"Error: {str(e)}")
        return False
    
    # Verify the domain shows as active in GET /shortener/domains
    print(f"\nGET /shortener/domains (verify activation)")
    time.sleep(2)  # Brief pause
    try:
        resp = requests.get(f"{BASE_URL}/shortener/domains", headers=HEADERS, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            domain_entry = next((d for d in data.get('domains', []) if d.get('domain') == domain), None)
            if domain_entry:
                print(f"  Domain entry: {json.dumps(domain_entry, indent=2)}")
                if domain_entry.get('active') and domain_entry.get('status') in ['completed', 'railway_linked', 'dns_added']:
                    log_test("GET /shortener/domains shows active=true", True, 
                            f"Status: {domain_entry.get('status')}, Active: {domain_entry.get('active')}")
                    return True
                else:
                    log_test("GET /shortener/domains shows active=true", False, 
                            f"Status: {domain_entry.get('status')}, Active: {domain_entry.get('active')}")
                    return False
            else:
                log_test("GET /shortener/domains shows active=true", False, 
                        f"Domain {domain} not found in list")
                return False
    except Exception as e:
        log_test("GET /shortener/domains shows active=true", False, f"Error: {str(e)}")
        return False

def test_link_creation():
    """Test 3: Link creation no longer blocked"""
    print("\n" + "="*80)
    print("TEST 3: LINK CREATION (no longer blocked)")
    print("="*80)
    
    global test_alias
    domain = "go.namewords.sbs"
    test_alias = f"qatest{random.randint(1000, 9999)}"
    url = "https://example.com/subdomain-test"
    
    print(f"POST /shortener/links (domain: {domain}, alias: {test_alias})")
    try:
        payload = {
            "domain": domain,
            "url": url,
            "alias": test_alias
        }
        resp = requests.post(f"{BASE_URL}/shortener/links", headers=HEADERS, json=payload, timeout=15)
        print(f"  HTTP {resp.status_code}")
        print(f"  Response: {json.dumps(resp.json(), indent=2)}")
        
        if resp.status_code == 201:
            data = resp.json()
            if data.get('created') and data.get('slug') == test_alias:
                log_test("POST /shortener/links (link creation)", True, 
                        f"HTTP 201, Created link: {data.get('short_url')}")
                return True
            else:
                log_test("POST /shortener/links (link creation)", False, 
                        f"HTTP 201 but unexpected response structure")
                return False
        elif resp.status_code == 409:
            error = resp.json().get('error', '')
            if error == 'domain_not_activated':
                log_test("POST /shortener/links (link creation)", False, 
                        f"HTTP 409 domain_not_activated - BUG NOT FIXED")
                return False
            else:
                log_test("POST /shortener/links (link creation)", False, 
                        f"HTTP 409 {error}: {resp.json().get('message', '')}")
                return False
        else:
            log_test("POST /shortener/links (link creation)", False, 
                    f"HTTP {resp.status_code}: {resp.text}")
            return False
    except Exception as e:
        log_test("POST /shortener/links (link creation)", False, f"Error: {str(e)}")
        return False

def test_patch_url_edit():
    """Test 4: PATCH url edit"""
    print("\n" + "="*80)
    print("TEST 4: PATCH URL EDIT")
    print("="*80)
    
    global test_alias
    if not test_alias:
        print("  Skipping: No test link created")
        log_test("PATCH /shortener/links/:slug (url edit)", False, "Skipped: No test link")
        return False
    
    domain = "go.namewords.sbs"
    new_url = "https://example.org/edited"
    
    # Test positive case: edit URL
    print(f"PATCH /shortener/links/{test_alias} (edit URL to {new_url})")
    try:
        payload = {
            "domain": domain,
            "url": new_url
        }
        resp = requests.patch(f"{BASE_URL}/shortener/links/{test_alias}", headers=HEADERS, json=payload, timeout=15)
        print(f"  HTTP {resp.status_code}")
        print(f"  Response: {json.dumps(resp.json(), indent=2)}")
        
        if resp.status_code == 200:
            data = resp.json()
            if data.get('updated') and data.get('url') == new_url:
                log_test("PATCH /shortener/links/:slug (url edit)", True, 
                        f"HTTP 200, URL updated to: {data.get('url')}")
            else:
                log_test("PATCH /shortener/links/:slug (url edit)", False, 
                        f"HTTP 200 but URL not updated correctly: {data.get('url')}")
                return False
        else:
            log_test("PATCH /shortener/links/:slug (url edit)", False, 
                    f"HTTP {resp.status_code}: {resp.text}")
            return False
    except Exception as e:
        log_test("PATCH /shortener/links/:slug (url edit)", False, f"Error: {str(e)}")
        return False
    
    # Verify with GET
    print(f"\nGET /shortener/links/{test_alias}?domain={domain} (verify edit)")
    time.sleep(1)
    try:
        resp = requests.get(f"{BASE_URL}/shortener/links/{test_alias}?domain={domain}", headers=HEADERS, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            print(f"  Response: {json.dumps(data, indent=2)}")
            if data.get('url') == new_url:
                log_test("GET /shortener/links/:slug confirms edited URL", True, 
                        f"URL is {new_url}")
            else:
                log_test("GET /shortener/links/:slug confirms edited URL", False, 
                        f"URL is {data.get('url')}, expected {new_url}")
                return False
    except Exception as e:
        log_test("GET /shortener/links/:slug confirms edited URL", False, f"Error: {str(e)}")
        return False
    
    # Test negative case: PATCH with no editable field
    print(f"\nPATCH /shortener/links/{test_alias} (no editable field - should fail)")
    try:
        payload = {"domain": domain}  # No url, disabled, or expires_in_days
        resp = requests.patch(f"{BASE_URL}/shortener/links/{test_alias}", headers=HEADERS, json=payload, timeout=15)
        print(f"  HTTP {resp.status_code}")
        print(f"  Response: {json.dumps(resp.json(), indent=2)}")
        
        if resp.status_code == 400:
            data = resp.json()
            if data.get('error') == 'nothing_to_update':
                log_test("PATCH with no editable field returns 400 nothing_to_update", True, 
                        f"HTTP 400 {data.get('error')}")
            else:
                log_test("PATCH with no editable field returns 400 nothing_to_update", False, 
                        f"HTTP 400 but error is {data.get('error')}, not nothing_to_update")
        else:
            log_test("PATCH with no editable field returns 400 nothing_to_update", False, 
                    f"HTTP {resp.status_code}, expected 400")
    except Exception as e:
        log_test("PATCH with no editable field returns 400 nothing_to_update", False, f"Error: {str(e)}")
    
    return True

def test_cleanup():
    """Test 5: Cleanup (required)"""
    print("\n" + "="*80)
    print("TEST 5: CLEANUP (DELETE test link)")
    print("="*80)
    
    global test_alias
    if not test_alias:
        print("  Skipping: No test link to delete")
        log_test("DELETE /shortener/links/:slug (cleanup)", False, "Skipped: No test link")
        return False
    
    domain = "go.namewords.sbs"
    
    print(f"DELETE /shortener/links/{test_alias}?domain={domain}")
    try:
        resp = requests.delete(f"{BASE_URL}/shortener/links/{test_alias}?domain={domain}", headers=HEADERS, timeout=15)
        print(f"  HTTP {resp.status_code}")
        print(f"  Response: {json.dumps(resp.json(), indent=2)}")
        
        if resp.status_code == 200:
            data = resp.json()
            if data.get('deleted'):
                log_test("DELETE /shortener/links/:slug (cleanup)", True, 
                        f"HTTP 200, Link deleted successfully")
                return True
            else:
                log_test("DELETE /shortener/links/:slug (cleanup)", False, 
                        f"HTTP 200 but deleted flag not true")
                return False
        else:
            log_test("DELETE /shortener/links/:slug (cleanup)", False, 
                    f"HTTP {resp.status_code}: {resp.text}")
            return False
    except Exception as e:
        log_test("DELETE /shortener/links/:slug (cleanup)", False, f"Error: {str(e)}")
        return False

def print_summary():
    """Print test summary"""
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    
    passed = sum(1 for t in test_results if t['passed'])
    total = len(test_results)
    
    print(f"\nTotal: {passed}/{total} tests passed")
    print("\nDetailed Results:")
    for t in test_results:
        status = "✅ PASS" if t['passed'] else "❌ FAIL"
        print(f"  {status}: {t['name']}")
        if t['details']:
            print(f"    {t['details']}")
    
    return passed == total

def main():
    """Run all tests"""
    print("="*80)
    print("BACKEND TEST: Subdomain Shortener Bugfix (2026-10-08c)")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Testing subdomain: go.namewords.sbs")
    print("="*80)
    
    # Run tests in order
    test_health()
    
    # Test 2: Subdomain activation
    activation_ok = test_subdomain_activation()
    
    # Test 3: Link creation (only if activation succeeded)
    if activation_ok:
        link_created = test_link_creation()
        
        # Test 4: PATCH url edit (only if link was created)
        if link_created:
            test_patch_url_edit()
        
        # Test 5: Cleanup (always try if we have a test_alias)
        test_cleanup()
    else:
        print("\n⚠️  Skipping link tests because subdomain activation failed")
    
    # Print summary
    all_passed = print_summary()
    
    sys.exit(0 if all_passed else 1)

if __name__ == "__main__":
    main()
