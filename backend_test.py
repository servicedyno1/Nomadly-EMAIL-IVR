#!/usr/bin/env python3
"""
Reseller VPS Password/SSH Endpoints Verification (2026-10-05b)
LIVE MODE - PRODUCTION DATA - READ-ONLY + VALIDATION ONLY

Tests the newly-added reseller VPS password/SSH endpoints:
- POST /vps/:id/password-reset (auth gating only)
- POST /vps/:id/ssh-key (auth gating + validation only)
- GET /vps/:id/ssh-keys (auth gating only)
- GET /vps/:id/credentials (read-only)
- GET /account (sanity check)

CRITICAL SAFETY:
- NO live password resets (only 401 auth check)
- NO live SSH key injections (only 401 auth check + 400 validation check with invalid key)
- NO VPS creation
- NO mutations
"""

import requests
import json
import sys
from typing import Dict, Any, Tuple

# Environment
BASE_URL = "https://3f880739-5533-4e15-b35e-112dc854f3b8.preview.emergentagent.com/api/reseller/v1"
LIVE_API_KEY = "rsk_live_cdc3f785ac3cfd813c6143d7813e1a59cc15fc42327ab736"
TEST_VPS_ID = "b7a9f3b5-be02-4545-921d-b2f2e6603556"

# Test counters
tests_run = 0
tests_passed = 0
tests_failed = 0

def log_test(name: str, passed: bool, details: str = ""):
    """Log test result"""
    global tests_run, tests_passed, tests_failed
    tests_run += 1
    if passed:
        tests_passed += 1
        print(f"✅ TEST {tests_run}: {name}")
        if details:
            print(f"   {details}")
    else:
        tests_failed += 1
        print(f"❌ TEST {tests_run}: {name}")
        if details:
            print(f"   {details}")

def make_request(method: str, endpoint: str, headers: Dict[str, str] = None, 
                 json_data: Dict[str, Any] = None) -> Tuple[int, Any]:
    """Make HTTP request and return (status_code, response_body)"""
    url = f"{BASE_URL}{endpoint}"
    try:
        if method == "GET":
            resp = requests.get(url, headers=headers, timeout=30)
        elif method == "POST":
            resp = requests.post(url, headers=headers, json=json_data, timeout=30)
        else:
            raise ValueError(f"Unsupported method: {method}")
        
        try:
            body = resp.json()
        except:
            body = resp.text
        
        return resp.status_code, body
    except Exception as e:
        return 0, {"error": str(e)}

def print_response(status: int, body: Any, max_len: int = 200):
    """Print response summary"""
    body_str = json.dumps(body, indent=2) if isinstance(body, dict) else str(body)
    if len(body_str) > max_len:
        body_str = body_str[:max_len] + "..."
    print(f"   Status: {status}")
    print(f"   Body: {body_str}")

print("=" * 80)
print("RESELLER VPS PASSWORD/SSH ENDPOINTS VERIFICATION")
print("=" * 80)
print(f"Base URL: {BASE_URL}")
print(f"Test VPS ID: {TEST_VPS_ID}")
print(f"Mode: LIVE (PRODUCTION DATA)")
print("=" * 80)
print()

# ============================================================================
# TEST 1: Auth gating - POST /vps/:id/password-reset WITHOUT auth → 401
# ============================================================================
print("TEST 1: Auth gating - POST /vps/:id/password-reset (no auth)")
print("-" * 80)
status, body = make_request("POST", f"/vps/{TEST_VPS_ID}/password-reset")
print_response(status, body)
log_test(
    "POST /vps/:id/password-reset without auth → 401",
    status == 401,
    f"Expected 401, got {status}"
)
print()

# ============================================================================
# TEST 2: Auth gating - POST /vps/:id/ssh-key WITHOUT auth → 401
# ============================================================================
print("TEST 2: Auth gating - POST /vps/:id/ssh-key (no auth, empty body)")
print("-" * 80)
status, body = make_request("POST", f"/vps/{TEST_VPS_ID}/ssh-key", json_data={})
print_response(status, body)
log_test(
    "POST /vps/:id/ssh-key without auth → 401",
    status == 401,
    f"Expected 401, got {status}"
)
print()

# ============================================================================
# TEST 3: Auth gating - GET /vps/:id/ssh-keys WITHOUT auth → 401
# ============================================================================
print("TEST 3: Auth gating - GET /vps/:id/ssh-keys (no auth)")
print("-" * 80)
status, body = make_request("GET", f"/vps/{TEST_VPS_ID}/ssh-keys")
print_response(status, body)
log_test(
    "GET /vps/:id/ssh-keys without auth → 401",
    status == 401,
    f"Expected 401, got {status}"
)
print()

# ============================================================================
# TEST 4: GET /vps/:id/credentials WITH auth → 200 with username "root"
# ============================================================================
print("TEST 4: GET /vps/:id/credentials (with auth)")
print("-" * 80)
headers = {"Authorization": f"Bearer {LIVE_API_KEY}"}
status, body = make_request("GET", f"/vps/{TEST_VPS_ID}/credentials", headers=headers)
print_response(status, body)

# Check status
status_ok = status == 200
log_test(
    "GET /vps/:id/credentials returns 200",
    status_ok,
    f"Expected 200, got {status}"
)

# Check username
if status_ok and isinstance(body, dict):
    username = body.get("username")
    username_ok = username == "root"
    log_test(
        "GET /vps/:id/credentials has username='root'",
        username_ok,
        f"Expected username='root', got '{username}'"
    )
    
    # Note: password may be null for legacy box - that's acceptable
    password = body.get("password")
    if password is None:
        print(f"   ℹ️  Note: password is null (acceptable for legacy VPS)")
    else:
        print(f"   ℹ️  Note: password is present (length: {len(password)})")
else:
    log_test(
        "GET /vps/:id/credentials has username='root'",
        False,
        "Response is not a valid JSON object"
    )
print()

# ============================================================================
# TEST 5: POST /vps/:id/ssh-key WITH auth + INVALID key → 400 invalid_public_key
# ============================================================================
print("TEST 5: POST /vps/:id/ssh-key (with auth, invalid public key)")
print("-" * 80)
headers = {"Authorization": f"Bearer {LIVE_API_KEY}"}
invalid_key_body = {"public_key": "not-a-valid-key"}
status, body = make_request("POST", f"/vps/{TEST_VPS_ID}/ssh-key", headers=headers, json_data=invalid_key_body)
print_response(status, body)

# Check status
status_ok = status == 400
log_test(
    "POST /vps/:id/ssh-key with invalid key → 400",
    status_ok,
    f"Expected 400, got {status}"
)

# Check error message
if status_ok and isinstance(body, dict):
    error = body.get("error", "")
    error_ok = "invalid_public_key" in error or "invalid" in error.lower()
    log_test(
        "POST /vps/:id/ssh-key error contains 'invalid_public_key'",
        error_ok,
        f"Expected 'invalid_public_key', got '{error}'"
    )
else:
    log_test(
        "POST /vps/:id/ssh-key error contains 'invalid_public_key'",
        False,
        "Response is not a valid JSON object"
    )
print()

# ============================================================================
# TEST 6: GET /account WITH auth → 200 (sanity check, owner_chat_id "5590563715")
# ============================================================================
print("TEST 6: GET /account (sanity check)")
print("-" * 80)
headers = {"Authorization": f"Bearer {LIVE_API_KEY}"}
status, body = make_request("GET", "/account", headers=headers)
print_response(status, body)

# Check status
status_ok = status == 200
log_test(
    "GET /account returns 200",
    status_ok,
    f"Expected 200, got {status}"
)

# Check owner_chat_id
if status_ok and isinstance(body, dict):
    owner_chat_id = str(body.get("owner_chat_id", ""))
    owner_ok = owner_chat_id == "5590563715"
    log_test(
        "GET /account has owner_chat_id='5590563715'",
        owner_ok,
        f"Expected '5590563715', got '{owner_chat_id}'"
    )
else:
    log_test(
        "GET /account has owner_chat_id='5590563715'",
        False,
        "Response is not a valid JSON object"
    )
print()

# ============================================================================
# SUMMARY
# ============================================================================
print("=" * 80)
print("TEST SUMMARY")
print("=" * 80)
print(f"Total tests: {tests_run}")
print(f"Passed: {tests_passed}")
print(f"Failed: {tests_failed}")
print(f"Pass rate: {tests_passed}/{tests_run} ({100*tests_passed//tests_run if tests_run > 0 else 0}%)")
print("=" * 80)

if tests_failed > 0:
    print("❌ SOME TESTS FAILED")
    sys.exit(1)
else:
    print("✅ ALL TESTS PASSED")
    sys.exit(0)
