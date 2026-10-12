#!/usr/bin/env python3
"""
Focused re-test: cPanel File Manager content read/save via WHM-session fallback
for account nbayftest with broken user-level auth.

Test account: nbayftest / PIN: 241743 / domain: testingbays.sbs
The fix: routes now call cpProxy.uapiViaSession which routes the cpsession 
through the CPANEL_API_URL tunnel instead of the unreachable origin IP.
"""

import requests
import time
import sys

# Base URL from frontend/.env
BASE_URL = "https://vault-setup-24.preview.emergentagent.com"

# Test credentials
USERNAME = "nbayftest"
PIN = "241743"

def log(msg):
    print(f"[TEST] {msg}")

def login():
    """Authenticate and get token"""
    log("Step 0: Authenticating...")
    url = f"{BASE_URL}/api/panel/login"
    payload = {"username": USERNAME, "pin": PIN}
    
    start = time.time()
    resp = requests.post(url, json=payload, timeout=30)
    elapsed = time.time() - start
    
    log(f"  Login response: HTTP {resp.status_code} (took {elapsed:.2f}s)")
    
    if resp.status_code != 200:
        log(f"  ❌ Login failed: {resp.text[:200]}")
        return None
    
    data = resp.json()
    if not data.get("token"):
        log(f"  ❌ No token in response: {data}")
        return None
    
    log(f"  ✅ Login successful, token obtained")
    return data["token"]

def save_file(token, dir_path, filename, content):
    """Save file content - must succeed via WHM session fallback"""
    log(f"\nStep 1: SAVE file {filename} in {dir_path}")
    url = f"{BASE_URL}/api/panel/files/save"
    headers = {"Authorization": f"Bearer {token}"}
    payload = {
        "dir": dir_path,
        "file": filename,
        "content": content
    }
    
    start = time.time()
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=30)
        elapsed = time.time() - start
        
        log(f"  Response: HTTP {resp.status_code} (took {elapsed:.2f}s)")
        
        if elapsed > 25:
            log(f"  ⚠️  WARNING: Request took {elapsed:.2f}s (close to 30s timeout)")
        
        if resp.status_code != 200:
            log(f"  ❌ FAILED: HTTP {resp.status_code}")
            log(f"  Response body: {resp.text[:500]}")
            return False
        
        data = resp.json()
        log(f"  Response data: {data}")
        
        # Check for HTML leak (login page)
        if "<!DOCTYPE html>" in resp.text or "cPanel Login" in resp.text:
            log(f"  ❌ FAILED: Response contains HTML login page (auth failure leak)")
            return False
        
        # Check status === 1 (could be top-level or under result)
        status = data.get("status")
        if status is None:
            result = data.get("result", {})
            status = result.get("status")
        
        if status != 1:
            log(f"  ❌ FAILED: status is {status}, expected 1")
            return False
        
        log(f"  ✅ PASSED: File saved successfully via WHM session fallback")
        log(f"     - HTTP 200 within {elapsed:.2f}s (no 30s timeout)")
        log(f"     - result.status === 1")
        log(f"     - No HTML leak")
        return True
        
    except requests.exceptions.Timeout:
        elapsed = time.time() - start
        log(f"  ❌ FAILED: Request timed out after {elapsed:.2f}s")
        return False
    except Exception as e:
        elapsed = time.time() - start
        log(f"  ❌ FAILED: Exception after {elapsed:.2f}s: {e}")
        return False

def read_file(token, dir_path, filename, expected_content):
    """Read file content - must return actual saved content, not HTML"""
    log(f"\nStep 2: READ file {filename} from {dir_path}")
    url = f"{BASE_URL}/api/panel/files/content"
    headers = {"Authorization": f"Bearer {token}"}
    params = {"dir": dir_path, "file": filename}
    
    start = time.time()
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=30)
        elapsed = time.time() - start
        
        log(f"  Response: HTTP {resp.status_code} (took {elapsed:.2f}s)")
        
        if elapsed > 25:
            log(f"  ⚠️  WARNING: Request took {elapsed:.2f}s (close to 30s timeout)")
        
        if resp.status_code != 200:
            log(f"  ❌ FAILED: HTTP {resp.status_code}")
            log(f"  Response body: {resp.text[:500]}")
            return False
        
        # Check for HTML leak
        if "<!DOCTYPE html>" in resp.text:
            log(f"  ❌ FAILED: Response contains '<!DOCTYPE html>' (HTML leak)")
            log(f"  Response preview: {resp.text[:300]}")
            return False
        
        if "cPanel Login" in resp.text:
            log(f"  ❌ FAILED: Response contains 'cPanel Login' (auth failure leak)")
            log(f"  Response preview: {resp.text[:300]}")
            return False
        
        data = resp.json()
        log(f"  Response JSON structure: {list(data.keys())}")
        
        # Extract content from response - try multiple possible locations
        actual_content = None
        
        # Try top-level data.content first
        if "content" in data:
            actual_content = data.get("content")
        
        # Try data.data (could be string or dict with content)
        if actual_content is None and "data" in data:
            data_field = data.get("data")
            if isinstance(data_field, str):
                actual_content = data_field
            elif isinstance(data_field, dict) and "content" in data_field:
                actual_content = data_field.get("content")
        
        # Try result.data.content or result.data
        if actual_content is None and "result" in data:
            result = data.get("result", {})
            result_data = result.get("data", {})
            if isinstance(result_data, str):
                actual_content = result_data
            elif isinstance(result_data, dict) and "content" in result_data:
                actual_content = result_data.get("content")
        
        log(f"  Extracted content: '{actual_content}'")
        log(f"  Expected content: '{expected_content}'")
        
        if actual_content is None:
            log(f"  ❌ FAILED: Could not extract content from response")
            log(f"  Full response: {data}")
            return False
        
        if actual_content != expected_content:
            log(f"  ❌ FAILED: Content mismatch")
            log(f"     Expected: '{expected_content}'")
            log(f"     Got: '{actual_content}'")
            return False
        
        log(f"  ✅ PASSED: File content read successfully via WHM session fallback")
        log(f"     - HTTP 200 within {elapsed:.2f}s (no 30s timeout)")
        log(f"     - Content matches: '{actual_content}'")
        log(f"     - No HTML leak")
        return True
        
    except requests.exceptions.Timeout:
        elapsed = time.time() - start
        log(f"  ❌ FAILED: Request timed out after {elapsed:.2f}s")
        return False
    except Exception as e:
        elapsed = time.time() - start
        log(f"  ❌ FAILED: Exception after {elapsed:.2f}s: {e}")
        import traceback
        traceback.print_exc()
        return False

def delete_file(token, dir_path, filename):
    """Delete test file"""
    log(f"\nStep 3: DELETE file {filename} from {dir_path}")
    url = f"{BASE_URL}/api/panel/files/delete"
    headers = {"Authorization": f"Bearer {token}"}
    payload = {"dir": dir_path, "file": filename}
    
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=30)
        log(f"  Response: HTTP {resp.status_code}")
        
        if resp.status_code == 200:
            log(f"  ✅ File deleted successfully")
            return True
        else:
            log(f"  ⚠️  Delete returned HTTP {resp.status_code}: {resp.text[:200]}")
            return False
    except Exception as e:
        log(f"  ⚠️  Delete failed: {e}")
        return False

def verify_cleanup(token, dir_path):
    """Verify test files are gone"""
    log(f"\nStep 4: VERIFY cleanup - list {dir_path}")
    url = f"{BASE_URL}/api/panel/files"
    headers = {"Authorization": f"Bearer {token}"}
    params = {"dir": dir_path}
    
    try:
        resp = requests.get(url, params=params, headers=headers, timeout=30)
        
        if resp.status_code != 200:
            log(f"  ⚠️  List returned HTTP {resp.status_code}")
            return False
        
        data = resp.json()
        files = data.get("files", [])
        
        test_files = ["qa-content-test.txt", "e2e-test-file.txt"]
        found_test_files = [f for f in files if f.get("name") in test_files]
        
        if found_test_files:
            log(f"  ⚠️  Test files still present: {[f['name'] for f in found_test_files]}")
            return False
        
        log(f"  ✅ Cleanup verified - no test files in {dir_path}")
        return True
        
    except Exception as e:
        log(f"  ⚠️  Verification failed: {e}")
        return False

def main():
    log("=" * 80)
    log("FOCUSED RE-TEST: cPanel File Manager content read/save via WHM-session fallback")
    log("Account: nbayftest (broken user-level auth, must use WHM session fallback)")
    log("=" * 80)
    
    # Step 0: Login
    token = login()
    if not token:
        log("\n❌ TEST SUITE FAILED: Could not authenticate")
        sys.exit(1)
    
    # Test parameters
    dir_path = "/public_html"
    test_file = "qa-content-test.txt"
    test_content = "hello-fallback-2026-verify-XYZ"
    
    results = {
        "save": False,
        "read": False,
        "cleanup": False
    }
    
    # Step 1: Save file
    results["save"] = save_file(token, dir_path, test_file, test_content)
    
    # Step 2: Read file (only if save succeeded)
    if results["save"]:
        results["read"] = read_file(token, dir_path, test_file, test_content)
    else:
        log("\n⚠️  Skipping READ test (SAVE failed)")
    
    # Step 3: Cleanup - delete test files
    log("\n" + "=" * 80)
    log("CLEANUP: Deleting test files")
    log("=" * 80)
    
    delete_file(token, dir_path, test_file)
    delete_file(token, dir_path, "e2e-test-file.txt")  # Also clean up old test file
    
    # Step 4: Verify cleanup
    results["cleanup"] = verify_cleanup(token, dir_path)
    
    # Final report
    log("\n" + "=" * 80)
    log("FINAL REPORT")
    log("=" * 80)
    log(f"SAVE:    {'✅ PASSED' if results['save'] else '❌ FAILED'}")
    log(f"READ:    {'✅ PASSED' if results['read'] else '❌ FAILED'}")
    log(f"CLEANUP: {'✅ PASSED' if results['cleanup'] else '⚠️  INCOMPLETE'}")
    
    all_passed = results["save"] and results["read"]
    
    if all_passed:
        log("\n✅ TEST SUITE PASSED: File content read/save via WHM-session fallback is WORKING")
        log("   - No 30s timeouts")
        log("   - Real JSON responses (no HTML leak)")
        log("   - Content saved and retrieved correctly")
        sys.exit(0)
    else:
        log("\n❌ TEST SUITE FAILED: File content read/save has issues")
        sys.exit(1)

if __name__ == "__main__":
    main()
