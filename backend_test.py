#!/usr/bin/env python3
"""
Backend test for Reseller VPS OS-reinstall endpoint (2026-10-05c)

CRITICAL SAFETY: This test performs ONLY 3 safe checks that do NOT trigger a real reinstall:
1. No auth → expect 401 (route registered + auth-gated)
2. Valid os WITHOUT confirm → expect 400 confirmation_required (disk-wipe guard blocks it)
3. Invalid os WITH confirm → expect 400 invalid_os (validation runs BEFORE rebuild, safe)

⛔ ABSOLUTE HARD CONSTRAINT: NEVER send {"confirm": true} with a VALID os (e.g. ubuntu-24-04-x64)
   to the reinstall endpoint — that triggers a REAL, IRREVERSIBLE disk wipe of the production VPS.
"""

import os
import sys
import requests
import json

# Environment
BASE_URL = "https://3f880739-5533-4e15-b35e-112dc854f3b8.preview.emergentagent.com/api/reseller/v1"
LIVE_API_KEY = "rsk_live_cdc3f785ac3cfd813c6143d7813e1a59cc15fc42327ab736"
TEST_VPS_ID = "b7a9f3b5-be02-4545-921d-b2f2e6603556"

# Test counters
tests_run = 0
tests_passed = 0
tests_failed = 0

def test(name, condition, details=""):
    """Record test result"""
    global tests_run, tests_passed, tests_failed
    tests_run += 1
    if condition:
        tests_passed += 1
        print(f"✅ TEST {tests_run}: {name}")
        if details:
            print(f"   {details}")
    else:
        tests_failed += 1
        print(f"❌ TEST {tests_run}: {name}")
        if details:
            print(f"   {details}")
    return condition

def main():
    print("=" * 80)
    print("RESELLER VPS OS-REINSTALL ENDPOINT TEST (2026-10-05c)")
    print("=" * 80)
    print(f"Base URL: {BASE_URL}")
    print(f"Test VPS ID: {TEST_VPS_ID}")
    print(f"Mode: LIVE (PRODUCTION)")
    print("=" * 80)
    print()
    
    # ========================================================================
    # SAFE CHECK 1: No auth → expect 401
    # ========================================================================
    print("★★★ SAFE CHECK 1: POST /vps/:id/reinstall WITHOUT auth → expect 401 ★★★")
    try:
        url = f"{BASE_URL}/vps/{TEST_VPS_ID}/reinstall"
        response = requests.post(url, json={"os": "ubuntu-24-04-x64"}, timeout=10)
        status = response.status_code
        body = response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text[:200]
        
        test(
            "POST /vps/:id/reinstall without auth → 401",
            status == 401,
            f"Status: {status}, Body: {json.dumps(body, indent=2) if isinstance(body, dict) else body}"
        )
        
        if status == 401:
            test(
                "Response has error='missing_api_key'",
                isinstance(body, dict) and body.get('error') == 'missing_api_key',
                f"Error: {body.get('error') if isinstance(body, dict) else 'N/A'}"
            )
        else:
            test("Response has error='missing_api_key'", False, f"Expected 401, got {status}")
    except Exception as e:
        test("POST /vps/:id/reinstall without auth → 401", False, f"Exception: {e}")
        test("Response has error='missing_api_key'", False, f"Exception: {e}")
    
    print()
    
    # ========================================================================
    # SAFE CHECK 2: Valid os WITHOUT confirm → expect 400 confirmation_required
    # ========================================================================
    print("★★★ SAFE CHECK 2: POST /vps/:id/reinstall WITH key, valid os, NO confirm → expect 400 confirmation_required ★★★")
    try:
        url = f"{BASE_URL}/vps/{TEST_VPS_ID}/reinstall"
        headers = {"Authorization": f"Bearer {LIVE_API_KEY}"}
        # CRITICAL: NO "confirm" field — this is the disk-wipe guard check
        body = {"os": "ubuntu-24-04-x64"}
        response = requests.post(url, json=body, headers=headers, timeout=10)
        status = response.status_code
        resp_body = response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text[:200]
        
        test(
            "POST /vps/:id/reinstall with valid os, NO confirm → 400",
            status == 400,
            f"Status: {status}, Body: {json.dumps(resp_body, indent=2) if isinstance(resp_body, dict) else resp_body}"
        )
        
        if status == 400:
            test(
                "Response has error='confirmation_required'",
                isinstance(resp_body, dict) and resp_body.get('error') == 'confirmation_required',
                f"Error: {resp_body.get('error') if isinstance(resp_body, dict) else 'N/A'}"
            )
            test(
                "Response message mentions disk wipe",
                isinstance(resp_body, dict) and 'wipe' in resp_body.get('message', '').lower(),
                f"Message: {resp_body.get('message', 'N/A') if isinstance(resp_body, dict) else 'N/A'}"
            )
        else:
            test("Response has error='confirmation_required'", False, f"Expected 400, got {status}")
            test("Response message mentions disk wipe", False, f"Expected 400, got {status}")
    except Exception as e:
        test("POST /vps/:id/reinstall with valid os, NO confirm → 400", False, f"Exception: {e}")
        test("Response has error='confirmation_required'", False, f"Exception: {e}")
        test("Response message mentions disk wipe", False, f"Exception: {e}")
    
    print()
    
    # ========================================================================
    # SAFE CHECK 3: Invalid os WITH confirm → expect 400 invalid_os
    # ========================================================================
    print("★★★ SAFE CHECK 3: POST /vps/:id/reinstall WITH key, invalid os, WITH confirm → expect 400 invalid_os ★★★")
    try:
        url = f"{BASE_URL}/vps/{TEST_VPS_ID}/reinstall"
        headers = {"Authorization": f"Bearer {LIVE_API_KEY}"}
        # CRITICAL: Invalid os "windows-xp" — validation runs BEFORE rebuild, so this is SAFE
        body = {"os": "windows-xp", "confirm": True}
        response = requests.post(url, json=body, headers=headers, timeout=10)
        status = response.status_code
        resp_body = response.json() if response.headers.get('content-type', '').startswith('application/json') else response.text[:200]
        
        test(
            "POST /vps/:id/reinstall with invalid os, WITH confirm → 400",
            status == 400,
            f"Status: {status}, Body: {json.dumps(resp_body, indent=2) if isinstance(resp_body, dict) else resp_body}"
        )
        
        if status == 400:
            test(
                "Response has error='invalid_os'",
                isinstance(resp_body, dict) and resp_body.get('error') == 'invalid_os',
                f"Error: {resp_body.get('error') if isinstance(resp_body, dict) else 'N/A'}"
            )
            test(
                "Response has 'valid_os' list",
                isinstance(resp_body, dict) and 'valid_os' in resp_body,
                f"Valid OS count: {len(resp_body.get('valid_os', [])) if isinstance(resp_body, dict) else 'N/A'}"
            )
            if isinstance(resp_body, dict) and 'valid_os' in resp_body:
                valid_os_list = resp_body.get('valid_os', [])
                print(f"   Valid OS images: {', '.join([img.get('id', 'N/A') for img in valid_os_list[:5]])}{'...' if len(valid_os_list) > 5 else ''}")
        else:
            test("Response has error='invalid_os'", False, f"Expected 400, got {status}")
            test("Response has 'valid_os' list", False, f"Expected 400, got {status}")
    except Exception as e:
        test("POST /vps/:id/reinstall with invalid os, WITH confirm → 400", False, f"Exception: {e}")
        test("Response has error='invalid_os'", False, f"Exception: {e}")
        test("Response has 'valid_os' list", False, f"Exception: {e}")
    
    print()
    
    # ========================================================================
    # SUMMARY
    # ========================================================================
    print("=" * 80)
    print("TEST SUMMARY")
    print("=" * 80)
    print(f"Total tests: {tests_run}")
    print(f"Passed: {tests_passed}")
    print(f"Failed: {tests_failed}")
    print(f"Pass rate: {tests_passed}/{tests_run} ({100*tests_passed//tests_run if tests_run > 0 else 0}%)")
    print("=" * 80)
    
    # PASS criteria: All 3 safe checks must pass
    # CHECK 1: No auth → 401 (2 tests)
    # CHECK 2: Valid os WITHOUT confirm → 400 confirmation_required (3 tests)
    # CHECK 3: Invalid os WITH confirm → 400 invalid_os (3 tests)
    # Total: 8 tests
    
    if tests_passed == tests_run and tests_run >= 8:
        print()
        print("✅ ALL SAFE CHECKS PASSED")
        print()
        print("PASS CRITERIA MET:")
        print("  1. ✅ No auth → 401 (route registered + auth-gated)")
        print("  2. ✅ Valid os WITHOUT confirm → 400 confirmation_required (disk-wipe guard working)")
        print("  3. ✅ Invalid os WITH confirm → 400 invalid_os (validation runs before rebuild, safe)")
        print()
        print("CRITICAL SAFETY VERIFIED:")
        print("  ✅ NO real reinstall was triggered (all checks were safe)")
        print("  ✅ Disk-wipe guard is working (confirmation_required for valid os without confirm)")
        print("  ✅ OS validation is working (invalid_os for invalid os, even with confirm)")
        print("  ✅ Route is registered and auth-gated (401 without key)")
        print()
        return 0
    else:
        print()
        print("❌ SOME CHECKS FAILED")
        print()
        print(f"Expected all 8+ tests to pass, but {tests_failed} failed.")
        print()
        return 1

if __name__ == "__main__":
    sys.exit(main())
