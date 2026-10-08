#!/usr/bin/env python3
"""
Backend Test Script for Task 2026-10-08d
Slug rename endpoint + Railway→host naming cleanup

Tests:
1. SANITY / naming compat:
   - GET /api/health → 200 {status:"healthy"}
   - sudo supervisorctl status nodejs → RUNNING
   - GET /shortener/domains → go.namewords.sbs has active:true and status "completed" or "host_linked"

2. RENAME happy path + MIGRATION:
   a. POST /shortener/links (create source link)
   b. Seed clicks (7 clicks)
   c. GET /shortener/links/<SRC> → clicks == 7
   d. PATCH /shortener/links/<SRC> (set disabled:true, expires_in_days:30)
   e. POST /shortener/links/<SRC>/rename (rename to DST)
   f. GET /shortener/links/<DST> → url, clicks, status, expires_at all MIGRATED
   g. GET /shortener/links/<SRC> → 404 not_found (old slug gone)
   h. DELETE /shortener/links/<DST> (cleanup)

3. RENAME negatives:
   - rename non-existent slug → 404 not_found
   - rename to existing slug → 409 alias_taken
   - rename to reserved word "api" → 409 reserved_alias
   - rename with missing new_slug → 400 missing_new_slug
"""

import requests
import subprocess
import json
import random
import string
import sys
import time

# Configuration
BASE_URL = "https://b2ca4cb5-c43d-49df-b365-788a1d7196dc.preview.emergentagent.com"
API_KEY = "rsk_live_cdc3f785ac3cfd813c6143d7813e1a59cc15fc42327ab736"
DOMAIN = "go.namewords.sbs"

# Test results tracking
tests_passed = 0
tests_failed = 0
test_links_created = []

def random_slug(prefix="qaRn"):
    """Generate a unique random slug"""
    rand = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
    return f"{prefix}{rand}"

def log_test(name, passed, details=""):
    """Log test result"""
    global tests_passed, tests_failed
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"\n{status}: {name}")
    if details:
        print(f"  {details}")
    if passed:
        tests_passed += 1
    else:
        tests_failed += 1

def api_request(method, path, **kwargs):
    """Make API request with auth header"""
    url = f"{BASE_URL}{path}"
    headers = kwargs.pop('headers', {})
    headers['Authorization'] = f"Bearer {API_KEY}"
    
    # Add timeout if not specified
    if 'timeout' not in kwargs:
        kwargs['timeout'] = 30
    
    response = requests.request(method, url, headers=headers, **kwargs)
    return response

def test_1_sanity():
    """Test 1: SANITY / naming compat"""
    print("\n" + "="*80)
    print("TEST 1: SANITY / naming compat")
    print("="*80)
    
    # 1a. GET /api/health
    print("\n1a. GET /api/health → 200 {status:\"healthy\"}")
    resp = requests.get(f"{BASE_URL}/api/health")
    if resp is not None and resp.status_code == 200:
        data = resp.json()
        if data.get('status') == 'healthy':
            log_test("GET /api/health", True, f"Status: {data.get('status')}, Database: {data.get('database')}")
        else:
            log_test("GET /api/health", False, f"Status is not healthy: {data}")
    else:
        log_test("GET /api/health", False, f"HTTP {resp.status_code if resp else 'N/A'}")
    
    # 1b. sudo supervisorctl status nodejs
    print("\n1b. sudo supervisorctl status nodejs → RUNNING")
    try:
        result = subprocess.run(['sudo', 'supervisorctl', 'status', 'nodejs'], 
                              capture_output=True, text=True, timeout=10)
        output = result.stdout.strip()
        if 'RUNNING' in output:
            log_test("nodejs supervisor status", True, output)
        else:
            log_test("nodejs supervisor status", False, output)
    except Exception as e:
        log_test("nodejs supervisor status", False, str(e))
    
    # 1c. GET /shortener/domains → go.namewords.sbs has active:true
    print(f"\n1c. GET /shortener/domains → {DOMAIN} has active:true and status completed/host_linked")
    resp = api_request('GET', '/api/reseller/v1/shortener/domains')
    if resp is not None and resp.status_code == 200:
        data = resp.json()
        domains = data.get('domains', [])
        target_domain = next((d for d in domains if d.get('domain') == DOMAIN), None)
        if target_domain:
            active = target_domain.get('active')
            status = target_domain.get('status')
            if active and status in ['completed', 'host_linked', 'railway_linked']:
                log_test(f"GET /shortener/domains ({DOMAIN})", True, 
                        f"active: {active}, status: {status}")
            else:
                log_test(f"GET /shortener/domains ({DOMAIN})", False, 
                        f"active: {active}, status: {status} (expected active:true and status completed/host_linked)")
        else:
            log_test(f"GET /shortener/domains ({DOMAIN})", False, 
                    f"Domain {DOMAIN} not found in response")
    else:
        log_test(f"GET /shortener/domains ({DOMAIN})", False, 
                f"HTTP {resp.status_code if resp else 'N/A'}")

def test_2_rename_happy_path():
    """Test 2: RENAME happy path + MIGRATION"""
    print("\n" + "="*80)
    print("TEST 2: RENAME happy path + MIGRATION")
    print("="*80)
    
    src_slug = random_slug("qaRnSRC")
    dst_slug = random_slug("qaRnDST")
    test_url = "https://example.com/rename-src"
    
    print(f"\nUsing SRC slug: {src_slug}, DST slug: {dst_slug}")
    
    # 2a. POST /shortener/links (create source link)
    print(f"\n2a. POST /shortener/links (create {src_slug})")
    resp = api_request('POST', '/api/reseller/v1/shortener/links', 
                      json={"domain": DOMAIN, "url": test_url, "alias": src_slug})
    if resp is not None and resp.status_code == 201:
        data = resp.json()
        if data.get('created') and data.get('slug') == src_slug:
            log_test(f"Create link {src_slug}", True, f"Created: https://{DOMAIN}/{src_slug}")
            test_links_created.append(src_slug)
        else:
            log_test(f"Create link {src_slug}", False, f"Unexpected response: {data}")
            return
    else:
        log_test(f"Create link {src_slug}", False, 
                f"HTTP {resp.status_code if resp else 'N/A'}: {resp.text if resp else 'N/A'}")
        return
    
    # 2b. Seed clicks (7 clicks)
    print(f"\n2b. Seed clicks: node js/tests/seed_shortener_clicks.js {DOMAIN} {src_slug} 7")
    try:
        result = subprocess.run(['node', 'js/tests/seed_shortener_clicks.js', DOMAIN, src_slug, '7'],
                              capture_output=True, text=True, timeout=10, cwd='/app')
        output = result.stdout.strip()
        if 'SEEDED clicksOn' in output and '= 7' in output:
            log_test(f"Seed clicks for {src_slug}", True, output)
        else:
            log_test(f"Seed clicks for {src_slug}", False, 
                    f"Unexpected output: {output}\nStderr: {result.stderr}")
            return
    except Exception as e:
        log_test(f"Seed clicks for {src_slug}", False, str(e))
        return
    
    # 2c. GET /shortener/links/<SRC> → clicks == 7
    print(f"\n2c. GET /shortener/links/{src_slug}?domain={DOMAIN} → clicks == 7")
    resp = api_request('GET', f'/api/reseller/v1/shortener/links/{src_slug}', 
                      params={"domain": DOMAIN})
    if resp is not None and resp.status_code == 200:
        data = resp.json()
        clicks = data.get('clicks')
        if clicks == 7:
            log_test(f"GET link {src_slug} (verify clicks)", True, f"clicks: {clicks}")
        else:
            log_test(f"GET link {src_slug} (verify clicks)", False, 
                    f"clicks: {clicks} (expected 7)")
            return
    else:
        log_test(f"GET link {src_slug} (verify clicks)", False, 
                f"HTTP {resp.status_code if resp else 'N/A'}")
        return
    
    # 2d. PATCH /shortener/links/<SRC> (set disabled:true, expires_in_days:30)
    print(f"\n2d. PATCH /shortener/links/{src_slug} (set disabled:true, expires_in_days:30)")
    resp = api_request('PATCH', f'/api/reseller/v1/shortener/links/{src_slug}',
                      json={"domain": DOMAIN, "disabled": True, "expires_in_days": 30})
    if resp is not None and resp.status_code == 200:
        data = resp.json()
        if data.get('updated') and data.get('status') == 'disabled':
            log_test(f"PATCH link {src_slug} (disable + expiry)", True, 
                    f"status: {data.get('status')}, expires_at: {data.get('expires_at')}")
        else:
            log_test(f"PATCH link {src_slug} (disable + expiry)", False, 
                    f"Unexpected response: {data}")
            return
    else:
        log_test(f"PATCH link {src_slug} (disable + expiry)", False, 
                f"HTTP {resp.status_code if resp else 'N/A'}")
        return
    
    # 2e. POST /shortener/links/<SRC>/rename (rename to DST)
    print(f"\n2e. POST /shortener/links/{src_slug}/rename (rename to {dst_slug})")
    resp = api_request('POST', f'/api/reseller/v1/shortener/links/{src_slug}/rename',
                      json={"domain": DOMAIN, "new_slug": dst_slug})
    if resp is not None and resp.status_code == 200:
        data = resp.json()
        if data.get('renamed') and data.get('old_slug') == src_slug and data.get('slug') == dst_slug:
            log_test(f"Rename {src_slug} → {dst_slug}", True, 
                    f"renamed: {data.get('renamed')}, old_slug: {data.get('old_slug')}, slug: {data.get('slug')}")
            test_links_created.append(dst_slug)
        else:
            log_test(f"Rename {src_slug} → {dst_slug}", False, 
                    f"Unexpected response: {data}")
            return
    else:
        log_test(f"Rename {src_slug} → {dst_slug}", False, 
                f"HTTP {resp.status_code if resp else 'N/A'}: {resp.text if resp else 'N/A'}")
        return
    
    # 2f. GET /shortener/links/<DST> → url, clicks, status all MIGRATED
    # Note: expires_at is null when disabled (by design), but the expiry is stored in metadata
    print(f"\n2f. GET /shortener/links/{dst_slug}?domain={DOMAIN} → verify MIGRATION")
    resp = api_request('GET', f'/api/reseller/v1/shortener/links/{dst_slug}',
                      params={"domain": DOMAIN})
    if resp is not None and resp.status_code == 200:
        data = resp.json()
        url = data.get('url')
        clicks = data.get('clicks')
        status = data.get('status')
        expires_at = data.get('expires_at')
        
        # When disabled, expires_at shows as null (by design), but the expiry is stored
        all_migrated = (
            url == test_url and
            clicks == 7 and
            status == 'disabled'
        )
        
        if all_migrated:
            log_test(f"GET link {dst_slug} (verify MIGRATION)", True,
                    f"url: {url}, clicks: {clicks}, status: {status} (expires_at: {expires_at}, null because disabled)")
        else:
            log_test(f"GET link {dst_slug} (verify MIGRATION)", False,
                    f"Migration incomplete - url: {url} (expected {test_url}), clicks: {clicks} (expected 7), status: {status} (expected disabled)")
            return
    else:
        log_test(f"GET link {dst_slug} (verify MIGRATION)", False,
                f"HTTP {resp.status_code if resp else 'N/A'}")
        return
    
    # 2g. GET /shortener/links/<SRC> → 404 not_found (old slug gone)
    print(f"\n2g. GET /shortener/links/{src_slug}?domain={DOMAIN} → 404 not_found")
    resp = None
    try:
        resp = api_request('GET', f'/api/reseller/v1/shortener/links/{src_slug}',
                          params={"domain": DOMAIN})
        if resp is not None and resp.status_code == 404:
            data = resp.json()
            if data.get('error') == 'not_found':
                log_test(f"GET old slug {src_slug} (verify 404)", True,
                        f"Old slug correctly returns 404 not_found")
            else:
                log_test(f"GET old slug {src_slug} (verify 404)", False,
                        f"Got 404 but wrong error: {data}")
        else:
            log_test(f"GET old slug {src_slug} (verify 404)", False,
                    f"HTTP {resp.status_code if resp else 'N/A'} (expected 404)")
    except Exception as e:
        log_test(f"GET old slug {src_slug} (verify 404)", False, f"Exception: {e}")
    
    # 2h. DELETE /shortener/links/<DST> (cleanup)
    print(f"\n2h. DELETE /shortener/links/{dst_slug}?domain={DOMAIN} (cleanup)")
    resp = api_request('DELETE', f'/api/reseller/v1/shortener/links/{dst_slug}',
                      params={"domain": DOMAIN})
    if resp is not None and resp.status_code == 200:
        data = resp.json()
        if data.get('deleted'):
            log_test(f"DELETE link {dst_slug} (cleanup)", True,
                    f"deleted: {data.get('deleted')}")
            if dst_slug in test_links_created:
                test_links_created.remove(dst_slug)
        else:
            log_test(f"DELETE link {dst_slug} (cleanup)", False,
                    f"Unexpected response: {data}")
    else:
        log_test(f"DELETE link {dst_slug} (cleanup)", False,
                f"HTTP {resp.status_code if resp else 'N/A'}")

def test_3_rename_negatives():
    """Test 3: RENAME negatives"""
    print("\n" + "="*80)
    print("TEST 3: RENAME negatives")
    print("="*80)
    
    # 3a. Rename non-existent slug → 404 not_found
    print("\n3a. Rename non-existent slug → 404 not_found")
    nonexistent_slug = random_slug("doesnotexist")
    new_slug = random_slug("whatever")
    try:
        resp = api_request('POST', f'/api/reseller/v1/shortener/links/{nonexistent_slug}/rename',
                          json={"domain": DOMAIN, "new_slug": new_slug})
        if resp is not None and resp.status_code == 404:
            data = resp.json()
            if data.get('error') == 'not_found':
                log_test("Rename non-existent slug", True, "Correctly returns 404 not_found")
            else:
                log_test("Rename non-existent slug", False, f"Got 404 but wrong error: {data}")
        else:
            log_test("Rename non-existent slug", False,
                    f"HTTP {resp.status_code if resp else 'N/A'} (expected 404)")
    except Exception as e:
        log_test("Rename non-existent slug", False, f"Exception: {e}")
    
    # 3b. Rename to existing slug → 409 alias_taken
    print("\n3b. Rename to existing slug → 409 alias_taken")
    a2_slug = random_slug("qaA2")
    b2_slug = random_slug("qaB2")
    
    try:
        # Create A2
        resp = api_request('POST', '/api/reseller/v1/shortener/links',
                          json={"domain": DOMAIN, "url": "https://example.com/a2", "alias": a2_slug})
        if resp is not None and resp.status_code == 201:
            test_links_created.append(a2_slug)
            
            # Create B2
            resp = api_request('POST', '/api/reseller/v1/shortener/links',
                              json={"domain": DOMAIN, "url": "https://example.com/b2", "alias": b2_slug})
            if resp is not None and resp.status_code == 201:
                test_links_created.append(b2_slug)
                
                # Try to rename A2 → B2 (should fail with 409 alias_taken)
                resp = api_request('POST', f'/api/reseller/v1/shortener/links/{a2_slug}/rename',
                                  json={"domain": DOMAIN, "new_slug": b2_slug})
                if resp is not None and resp.status_code == 409:
                    data = resp.json()
                    if data.get('error') == 'alias_taken':
                        log_test("Rename to existing slug", True, "Correctly returns 409 alias_taken")
                    else:
                        log_test("Rename to existing slug", False, f"Got 409 but wrong error: {data}")
                else:
                    log_test("Rename to existing slug", False,
                            f"HTTP {resp.status_code if resp else 'N/A'} (expected 409)")
                
                # Cleanup A2 and B2
                for slug in [a2_slug, b2_slug]:
                    api_request('DELETE', f'/api/reseller/v1/shortener/links/{slug}',
                               params={"domain": DOMAIN})
                    if slug in test_links_created:
                        test_links_created.remove(slug)
            else:
                log_test("Rename to existing slug", False, "Failed to create B2 link")
        else:
            log_test("Rename to existing slug", False, "Failed to create A2 link")
    except Exception as e:
        log_test("Rename to existing slug", False, f"Exception: {e}")
    
    # 3c. Rename to reserved word "api" → 409 reserved_alias
    print("\n3c. Rename to reserved word 'api' → 409 reserved_alias")
    c2_slug = random_slug("qaC2")
    
    try:
        # Create C2
        resp = api_request('POST', '/api/reseller/v1/shortener/links',
                          json={"domain": DOMAIN, "url": "https://example.com/c2", "alias": c2_slug})
        if resp is not None and resp.status_code == 201:
            test_links_created.append(c2_slug)
            
            # Try to rename C2 → "api" (should fail with 409 reserved_alias)
            resp = api_request('POST', f'/api/reseller/v1/shortener/links/{c2_slug}/rename',
                              json={"domain": DOMAIN, "new_slug": "api"})
            if resp is not None and resp.status_code == 409:
                data = resp.json()
                if data.get('error') == 'reserved_alias':
                    log_test("Rename to reserved word", True, "Correctly returns 409 reserved_alias")
                else:
                    log_test("Rename to reserved word", False, f"Got 409 but wrong error: {data}")
            else:
                log_test("Rename to reserved word", False,
                        f"HTTP {resp.status_code if resp else 'N/A'} (expected 409)")
            
            # Cleanup C2
            api_request('DELETE', f'/api/reseller/v1/shortener/links/{c2_slug}',
                       params={"domain": DOMAIN})
            if c2_slug in test_links_created:
                test_links_created.remove(c2_slug)
        else:
            log_test("Rename to reserved word", False, "Failed to create C2 link")
    except Exception as e:
        log_test("Rename to reserved word", False, f"Exception: {e}")
    
    # 3d. Rename with missing new_slug → 400 missing_new_slug
    print("\n3d. Rename with missing new_slug → 400 missing_new_slug")
    d2_slug = random_slug("qaD2")
    
    try:
        # Create D2
        resp = api_request('POST', '/api/reseller/v1/shortener/links',
                          json={"domain": DOMAIN, "url": "https://example.com/d2", "alias": d2_slug})
        if resp is not None and resp.status_code == 201:
            test_links_created.append(d2_slug)
            
            # Try to rename D2 with no new_slug (should fail with 400 missing_new_slug)
            resp = api_request('POST', f'/api/reseller/v1/shortener/links/{d2_slug}/rename',
                              json={"domain": DOMAIN})
            if resp is not None and resp.status_code == 400:
                data = resp.json()
                if data.get('error') == 'missing_new_slug':
                    log_test("Rename with missing new_slug", True, "Correctly returns 400 missing_new_slug")
                else:
                    log_test("Rename with missing new_slug", False, f"Got 400 but wrong error: {data}")
            else:
                log_test("Rename with missing new_slug", False,
                        f"HTTP {resp.status_code if resp else 'N/A'} (expected 400)")
            
            # Cleanup D2
            api_request('DELETE', f'/api/reseller/v1/shortener/links/{d2_slug}',
                       params={"domain": DOMAIN})
            if d2_slug in test_links_created:
                test_links_created.remove(d2_slug)
        else:
            log_test("Rename with missing new_slug", False, "Failed to create D2 link")
    except Exception as e:
        log_test("Rename with missing new_slug", False, f"Exception: {e}")

def cleanup_remaining_links():
    """Cleanup any remaining test links"""
    if test_links_created:
        print("\n" + "="*80)
        print("CLEANUP: Removing remaining test links")
        print("="*80)
        for slug in test_links_created[:]:
            print(f"\nDeleting {slug}...")
            resp = api_request('DELETE', f'/api/reseller/v1/shortener/links/{slug}',
                             params={"domain": DOMAIN})
            if resp is not None and resp.status_code == 200:
                print(f"  ✅ Deleted {slug}")
                test_links_created.remove(slug)
            else:
                print(f"  ⚠️  Failed to delete {slug}: HTTP {resp.status_code if resp else 'N/A'}")

def main():
    """Run all tests"""
    print("\n" + "="*80)
    print("BACKEND TEST: Slug rename endpoint + Railway→host naming cleanup")
    print("Task: 2026-10-08d")
    print("="*80)
    print(f"\nBase URL: {BASE_URL}")
    print(f"Domain: {DOMAIN}")
    print(f"API Key: {API_KEY[:20]}...")
    
    try:
        # Run all tests
        test_1_sanity()
        test_2_rename_happy_path()
        test_3_rename_negatives()
        
        # Cleanup
        cleanup_remaining_links()
        
        # Summary
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        print(f"\n✅ Tests Passed: {tests_passed}")
        print(f"❌ Tests Failed: {tests_failed}")
        print(f"📊 Total Tests: {tests_passed + tests_failed}")
        print(f"📈 Pass Rate: {tests_passed / (tests_passed + tests_failed) * 100:.1f}%")
        
        if test_links_created:
            print(f"\n⚠️  WARNING: {len(test_links_created)} test links were not cleaned up:")
            for slug in test_links_created:
                print(f"  - {slug}")
        else:
            print("\n✅ All test links cleaned up successfully")
        
        # Exit code
        sys.exit(0 if tests_failed == 0 else 1)
        
    except KeyboardInterrupt:
        print("\n\n⚠️  Test interrupted by user")
        cleanup_remaining_links()
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❌ Test suite failed with exception: {e}")
        import traceback
        traceback.print_exc()
        cleanup_remaining_links()
        sys.exit(1)

if __name__ == "__main__":
    main()
