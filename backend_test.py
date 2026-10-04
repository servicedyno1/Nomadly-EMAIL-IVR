#!/usr/bin/env python3
"""
Reseller API Parity Test Suite (2026-10-03)
Tests 9 bug fixes for Nomadly Reseller API (Node bot behind FastAPI proxy)
All tests run in DRY-RUN mode (RESELLER_API_LIVE not set)
"""

import requests
import json
import sys

# Configuration
BASE_URL = "https://gracious-hopper-10.preview.emergentagent.com/api/reseller/v1"
API_KEY = "rsk_live_6fc131dd06c97b3dd6fe3a4cbbd69d0c6eac28871fbf0f7c"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# Test counters
passed = 0
failed = 0
test_results = []

def log_test(test_name, success, details=""):
    """Log test result"""
    global passed, failed
    status = "✅ PASS" if success else "❌ FAIL"
    result = f"{status}: {test_name}"
    if details:
        result += f"\n    {details}"
    print(result)
    test_results.append({"name": test_name, "success": success, "details": details})
    if success:
        passed += 1
    else:
        failed += 1

def test_health():
    """Test 1: GET /health → {ok:true, mode:"dry_run"}"""
    print("\n=== TEST 1: Health Check ===")
    try:
        resp = requests.get(f"{BASE_URL}/health", headers=HEADERS, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200:
            log_test("GET /health returns 200", True, f"Response: {json.dumps(data)}")
        else:
            log_test("GET /health returns 200", False, f"Got {resp.status_code}: {data}")
            return
        
        if data.get("ok") is True:
            log_test("Health check ok=true", True)
        else:
            log_test("Health check ok=true", False, f"Got ok={data.get('ok')}")
        
        if data.get("mode") == "dry_run":
            log_test("Health check mode=dry_run", True)
        else:
            log_test("Health check mode=dry_run", False, f"Got mode={data.get('mode')}")
    except Exception as e:
        log_test("GET /health", False, f"Exception: {str(e)}")

def test_account():
    """Test 2: GET /account → owner_chat_id "999000111", wallet_balance"""
    print("\n=== TEST 2: Account Info ===")
    try:
        resp = requests.get(f"{BASE_URL}/account", headers=HEADERS, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200:
            log_test("GET /account returns 200", True, f"Response: {json.dumps(data)[:200]}")
        else:
            log_test("GET /account returns 200", False, f"Got {resp.status_code}: {data}")
            return
        
        if str(data.get("owner_chat_id")) == "999000111":
            log_test("Account owner_chat_id=999000111", True)
        else:
            log_test("Account owner_chat_id=999000111", False, f"Got {data.get('owner_chat_id')}")
        
        if "wallet_balance_usd" in data:
            log_test("Account has wallet_balance_usd", True, f"Balance: ${data.get('wallet_balance_usd')}")
        else:
            log_test("Account has wallet_balance_usd", False, "Field missing")
    except Exception as e:
        log_test("GET /account", False, f"Exception: {str(e)}")

def test_hosting_plans():
    """Test 3: GET /hosting/plans → 200 plan array"""
    print("\n=== TEST 3: Hosting Plans ===")
    try:
        resp = requests.get(f"{BASE_URL}/hosting/plans", headers=HEADERS, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200:
            log_test("GET /hosting/plans returns 200", True)
        else:
            log_test("GET /hosting/plans returns 200", False, f"Got {resp.status_code}: {data}")
            return
        
        # Handle both direct array and dict with 'plans' key
        plans = data.get('plans', data) if isinstance(data, dict) else data
        
        if isinstance(plans, list) and len(plans) > 0:
            log_test("Plans array is non-empty", True, f"Found {len(plans)} plans")
        else:
            log_test("Plans array is non-empty", False, f"Got {type(plans)}: {plans}")
        
        # Check for golden-monthly and premium-monthly
        plan_ids = [p.get("plan_id") for p in plans if isinstance(p, dict)]
        if "golden-monthly" in plan_ids:
            log_test("Plans include golden-monthly", True)
        else:
            log_test("Plans include golden-monthly", False, f"Plan IDs: {plan_ids}")
        
        if "premium-monthly" in plan_ids:
            log_test("Plans include premium-monthly", True)
        else:
            log_test("Plans include premium-monthly", False, f"Plan IDs: {plan_ids}")
    except Exception as e:
        log_test("GET /hosting/plans", False, f"Exception: {str(e)}")

def test_hosting_create_domain_modes():
    """Test 4: POST /hosting with various domain_mode values (ISSUE-7)"""
    print("\n=== TEST 4: POST /hosting domain_mode validation (ISSUE-7) ===")
    
    # Test 4a: Invalid domain_mode "foo" → 400
    try:
        payload = {
            "plan_id": "golden-monthly",
            "domain": "dryruntest-apifix.com",
            "domain_mode": "foo"
        }
        resp = requests.post(f"{BASE_URL}/hosting", headers=HEADERS, json=payload, timeout=10)
        data = resp.json()
        
        if resp.status_code == 400:
            log_test("POST /hosting with invalid domain_mode → 400", True, f"Error: {data.get('error')}")
        else:
            log_test("POST /hosting with invalid domain_mode → 400", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("POST /hosting invalid domain_mode", False, f"Exception: {str(e)}")
    
    # Test 4b: domain_mode "existing" → 200 dry_run
    try:
        payload = {
            "plan_id": "golden-monthly",
            "domain": "dryruntest-a.com",
            "domain_mode": "existing"
        }
        resp = requests.post(f"{BASE_URL}/hosting", headers=HEADERS, json=payload, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200 and data.get("mode") == "dry_run":
            log_test("POST /hosting domain_mode=existing → 200 dry_run", True)
        else:
            log_test("POST /hosting domain_mode=existing → 200 dry_run", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("POST /hosting domain_mode=existing", False, f"Exception: {str(e)}")
    
    # Test 4c: domain_mode "external" → 200 dry_run
    try:
        payload = {
            "plan_id": "golden-monthly",
            "domain": "dryruntest-b.com",
            "domain_mode": "external"
        }
        resp = requests.post(f"{BASE_URL}/hosting", headers=HEADERS, json=payload, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200 and data.get("mode") == "dry_run":
            log_test("POST /hosting domain_mode=external → 200 dry_run", True)
        else:
            log_test("POST /hosting domain_mode=external → 200 dry_run", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("POST /hosting domain_mode=external", False, f"Exception: {str(e)}")
    
    # Test 4d: domain_mode "byo" (legacy) → 200 dry_run (must NOT 400, must NOT error)
    try:
        payload = {
            "plan_id": "golden-monthly",
            "domain": "dryruntest-c.com",
            "domain_mode": "byo"
        }
        resp = requests.post(f"{BASE_URL}/hosting", headers=HEADERS, json=payload, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200 and data.get("mode") == "dry_run":
            log_test("POST /hosting domain_mode=byo (legacy) → 200 dry_run", True)
        else:
            log_test("POST /hosting domain_mode=byo (legacy) → 200 dry_run", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("POST /hosting domain_mode=byo", False, f"Exception: {str(e)}")

def test_domain_register():
    """Test 5: POST /domains/register (ISSUE-9)"""
    print("\n=== TEST 5: POST /domains/register (ISSUE-9) ===")
    try:
        payload = {"domain": "dryruntest-regfix.com"}
        resp = requests.post(f"{BASE_URL}/domains/register", headers=HEADERS, json=payload, timeout=30)
        data = resp.json()
        
        if resp.status_code == 200:
            log_test("POST /domains/register returns 200", True, f"Response: {json.dumps(data)[:200]}")
        else:
            log_test("POST /domains/register returns 200", False, f"Got {resp.status_code}: {data}")
            return
        
        if data.get("mode") == "dry_run":
            log_test("Domain register mode=dry_run", True)
        else:
            log_test("Domain register mode=dry_run", False, f"Got mode={data.get('mode')}")
        
        if "would_provision" in data:
            log_test("Domain register has would_provision", True)
        else:
            log_test("Domain register has would_provision", False, "Field missing")
    except Exception as e:
        log_test("POST /domains/register", False, f"Exception: {str(e)}")

def test_hosting_list():
    """Test 6: GET /hosting → lists apifix01 AND apifix02"""
    print("\n=== TEST 6: GET /hosting (list accounts) ===")
    try:
        resp = requests.get(f"{BASE_URL}/hosting", headers=HEADERS, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200:
            log_test("GET /hosting returns 200", True)
        else:
            log_test("GET /hosting returns 200", False, f"Got {resp.status_code}: {data}")
            return
        
        # Handle both direct list and dict with 'accounts' or 'hosting' key
        accounts = data
        if isinstance(data, dict):
            accounts = data.get('accounts', data.get('hosting', data.get('data', [])))
        
        if isinstance(accounts, list):
            usernames = [acc.get("username") for acc in accounts if isinstance(acc, dict)]
            
            if "apifix01" in usernames:
                log_test("Hosting list includes apifix01", True)
            else:
                log_test("Hosting list includes apifix01", False, f"Usernames: {usernames}")
            
            if "apifix02" in usernames:
                log_test("Hosting list includes apifix02", True)
            else:
                log_test("Hosting list includes apifix02", False, f"Usernames: {usernames}")
        else:
            log_test("GET /hosting returns list", False, f"Got {type(accounts)}, keys: {list(data.keys()) if isinstance(data, dict) else 'N/A'}")
    except Exception as e:
        log_test("GET /hosting", False, f"Exception: {str(e)}")

def test_hosting_detail():
    """Test 7: GET /hosting/apifix01 → 200"""
    print("\n=== TEST 7: GET /hosting/apifix01 (detail) ===")
    try:
        resp = requests.get(f"{BASE_URL}/hosting/apifix01", headers=HEADERS, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200:
            log_test("GET /hosting/apifix01 returns 200", True, f"Domain: {data.get('domain')}")
        else:
            log_test("GET /hosting/apifix01 returns 200", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("GET /hosting/apifix01", False, f"Exception: {str(e)}")

def test_auto_renew():
    """Test 8: ISSUE-5 auto-renew toggle"""
    print("\n=== TEST 8: POST /hosting/apifix01/auto-renew (ISSUE-5) ===")
    
    # Test 8a: Set auto_renew to false
    try:
        payload = {"enabled": False}
        resp = requests.post(f"{BASE_URL}/hosting/apifix01/auto-renew", headers=HEADERS, json=payload, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200 and data.get("auto_renew") is False:
            log_test("POST auto-renew enabled=false → auto_renew=false", True)
        else:
            log_test("POST auto-renew enabled=false → auto_renew=false", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("POST auto-renew enabled=false", False, f"Exception: {str(e)}")
    
    # Test 8b: Toggle with no body → should toggle to true
    try:
        resp = requests.post(f"{BASE_URL}/hosting/apifix01/auto-renew", headers=HEADERS, json={}, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200 and data.get("auto_renew") is True:
            log_test("POST auto-renew no body → toggle to true", True)
        else:
            log_test("POST auto-renew no body → toggle to true", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("POST auto-renew no body", False, f"Exception: {str(e)}")
    
    # Test 8c: Invalid body → 400
    try:
        payload = {"enabled": "notbool"}
        resp = requests.post(f"{BASE_URL}/hosting/apifix01/auto-renew", headers=HEADERS, json=payload, timeout=10)
        data = resp.json()
        
        if resp.status_code == 400:
            log_test("POST auto-renew invalid body → 400", True, f"Error: {data.get('error')}")
        else:
            log_test("POST auto-renew invalid body → 400", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("POST auto-renew invalid body", False, f"Exception: {str(e)}")

def test_site_status():
    """Test 9: ISSUE-6 site-status (both routes, same response)"""
    print("\n=== TEST 9: GET site-status (ISSUE-6) ===")
    
    # Test 9a: GET /hosting/apifix01/site-status
    try:
        resp = requests.get(f"{BASE_URL}/hosting/apifix01/site-status", headers=HEADERS, timeout=10)
        data1 = resp.json()
        
        if resp.status_code == 200:
            log_test("GET /hosting/apifix01/site-status returns 200", True)
        else:
            log_test("GET /hosting/apifix01/site-status returns 200", False, f"Got {resp.status_code}: {data1}")
            return
        
        if "status" in data1:
            log_test("site-status has status field", True, f"Status: {data1.get('status')}")
        else:
            log_test("site-status has status field", False, "Field missing")
        
        if "auto_renew" in data1:
            log_test("site-status has auto_renew field", True, f"auto_renew: {data1.get('auto_renew')}")
        else:
            log_test("site-status has auto_renew field", False, "Field missing")
        
        # Test 9b: GET /hosting/apifix01/account/site-status (alias)
        resp2 = requests.get(f"{BASE_URL}/hosting/apifix01/account/site-status", headers=HEADERS, timeout=10)
        data2 = resp2.json()
        
        if resp2.status_code == 200:
            log_test("GET /hosting/apifix01/account/site-status returns 200", True)
        else:
            log_test("GET /hosting/apifix01/account/site-status returns 200", False, f"Got {resp2.status_code}: {data2}")
            return
        
        if data1.get("status") == data2.get("status"):
            log_test("Both site-status routes return same status", True)
        else:
            log_test("Both site-status routes return same status", False, f"Route1: {data1.get('status')}, Route2: {data2.get('status')}")
        
        if "auto_renew" in data2:
            log_test("account/site-status has auto_renew field", True)
        else:
            log_test("account/site-status has auto_renew field", False, "Field missing")
    except Exception as e:
        log_test("GET site-status", False, f"Exception: {str(e)}")
    
    # Test 9c: POST /hosting/apifix01/site-status (take offline)
    try:
        payload = {"action": "take_offline", "mode": "maintenance"}
        resp = requests.post(f"{BASE_URL}/hosting/apifix01/site-status", headers=HEADERS, json=payload, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200 and data.get("mode") == "dry_run":
            log_test("POST site-status take_offline → 200 dry_run", True)
        else:
            log_test("POST site-status take_offline → 200 dry_run", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("POST site-status take_offline", False, f"Exception: {str(e)}")
    
    # Test 9d: POST /hosting/apifix01/account/site-status (alias)
    try:
        payload = {"action": "take_offline", "mode": "maintenance"}
        resp = requests.post(f"{BASE_URL}/hosting/apifix01/account/site-status", headers=HEADERS, json=payload, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200 and data.get("mode") == "dry_run":
            log_test("POST account/site-status take_offline → 200 dry_run", True)
        else:
            log_test("POST account/site-status take_offline → 200 dry_run", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("POST account/site-status", False, f"Exception: {str(e)}")

def test_renew():
    """Test 10: ISSUE-3 renew"""
    print("\n=== TEST 10: POST /hosting/apifix01/renew (ISSUE-3) ===")
    try:
        resp = requests.post(f"{BASE_URL}/hosting/apifix01/renew", headers=HEADERS, json={}, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200:
            log_test("POST /hosting/apifix01/renew returns 200", True)
        else:
            log_test("POST /hosting/apifix01/renew returns 200", False, f"Got {resp.status_code}: {data}")
            return
        
        if data.get("mode") == "dry_run":
            log_test("Renew mode=dry_run", True)
        else:
            log_test("Renew mode=dry_run", False, f"Got mode={data.get('mode')}")
        
        if "would_provision" in data:
            log_test("Renew has would_provision", True)
        else:
            log_test("Renew has would_provision", False, "Field missing")
    except Exception as e:
        log_test("POST /hosting/apifix01/renew", False, f"Exception: {str(e)}")

def test_upgrade():
    """Test 11: ISSUE-2 upgrade"""
    print("\n=== TEST 11: POST upgrade (ISSUE-2) ===")
    
    # Test 11a: apifix02 (Premium) → golden-monthly (valid upgrade)
    try:
        payload = {"plan_id": "golden-monthly"}
        resp = requests.post(f"{BASE_URL}/hosting/apifix02/upgrade", headers=HEADERS, json=payload, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200 and data.get("mode") == "dry_run":
            log_test("POST apifix02/upgrade to golden → 200 dry_run", True)
        else:
            log_test("POST apifix02/upgrade to golden → 200 dry_run", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("POST apifix02/upgrade", False, f"Exception: {str(e)}")
    
    # Test 11b: apifix01 (Golden) → golden-monthly (no upgrade path, 409)
    try:
        payload = {"plan_id": "golden-monthly"}
        resp = requests.post(f"{BASE_URL}/hosting/apifix01/upgrade", headers=HEADERS, json=payload, timeout=10)
        data = resp.json()
        
        if resp.status_code == 409 and data.get("error") == "no_upgrade_path":
            log_test("POST apifix01/upgrade to golden → 409 no_upgrade_path", True)
        else:
            log_test("POST apifix01/upgrade to golden → 409 no_upgrade_path", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("POST apifix01/upgrade no_upgrade_path", False, f"Exception: {str(e)}")
    
    # Test 11c: Invalid plan_id → 400 with available list
    try:
        payload = {"plan_id": "garbage"}
        resp = requests.post(f"{BASE_URL}/hosting/apifix02/upgrade", headers=HEADERS, json=payload, timeout=10)
        data = resp.json()
        
        if resp.status_code == 400 and data.get("error") == "invalid_upgrade_target":
            log_test("POST upgrade invalid plan → 400 invalid_upgrade_target", True)
            if "available" in data:
                log_test("Invalid upgrade response has available list", True)
            else:
                log_test("Invalid upgrade response has available list", False, "Field missing")
        else:
            log_test("POST upgrade invalid plan → 400", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("POST upgrade invalid plan", False, f"Exception: {str(e)}")

def test_addons():
    """Test 12: ISSUE-1 addon shape (string handling)"""
    print("\n=== TEST 12: GET /hosting/apifix01/addons (ISSUE-1) ===")
    try:
        resp = requests.get(f"{BASE_URL}/hosting/apifix01/addons", headers=HEADERS, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200:
            log_test("GET /hosting/apifix01/addons returns 200", True)
        else:
            log_test("GET /hosting/apifix01/addons returns 200", False, f"Got {resp.status_code}: {data}")
            return
        
        if data.get("addon_count") == 1:
            log_test("Addon count is 1", True)
        else:
            log_test("Addon count is 1", False, f"Got addon_count={data.get('addon_count')}")
        
        addons = data.get("addons", [])
        if len(addons) > 0:
            # Check if addon is a string OR an object with 'domain' field
            addon = addons[0]
            if isinstance(addon, str) and addon == "addon-apifix.com":
                log_test("Addon is string 'addon-apifix.com'", True)
            elif isinstance(addon, dict) and addon.get("domain") == "addon-apifix.com":
                log_test("Addon has domain 'addon-apifix.com' (object format)", True, f"Format: {addon}")
            else:
                log_test("Addon is 'addon-apifix.com'", False, f"Got addons={addons}")
        else:
            log_test("Addon is present", False, f"Got addons={addons}")
    except Exception as e:
        log_test("GET /hosting/apifix01/addons", False, f"Exception: {str(e)}")

def test_addon_lookup():
    """Test 13: ISSUE-1 addon lookup by string"""
    print("\n=== TEST 13: GET captcha/honeypot by addon domain (ISSUE-1) ===")
    
    # Test 13a: GET /hosting/captcha/addon-apifix.com
    try:
        resp = requests.get(f"{BASE_URL}/hosting/captcha/addon-apifix.com", headers=HEADERS, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200:
            log_test("GET /hosting/captcha/addon-apifix.com returns 200", True, f"Response: {json.dumps(data)[:100]}")
        else:
            log_test("GET /hosting/captcha/addon-apifix.com returns 200", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("GET captcha by addon", False, f"Exception: {str(e)}")
    
    # Test 13b: GET /hosting/honeypot/addon-apifix.com
    try:
        resp = requests.get(f"{BASE_URL}/hosting/honeypot/addon-apifix.com", headers=HEADERS, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200:
            log_test("GET /hosting/honeypot/addon-apifix.com returns 200", True, f"Response: {json.dumps(data)[:100]}")
        else:
            log_test("GET /hosting/honeypot/addon-apifix.com returns 200", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("GET honeypot by addon", False, f"Exception: {str(e)}")

def test_cancel():
    """Test 14: ISSUE-4 cancel (DELETE /hosting/:user)"""
    print("\n=== TEST 14: DELETE /hosting/apifix01 (ISSUE-4) ===")
    try:
        resp = requests.delete(f"{BASE_URL}/hosting/apifix01", headers=HEADERS, timeout=10)
        data = resp.json()
        
        if resp.status_code == 200:
            log_test("DELETE /hosting/apifix01 returns 200", True)
        else:
            log_test("DELETE /hosting/apifix01 returns 200", False, f"Got {resp.status_code}: {data}")
            return
        
        if data.get("mode") == "dry_run":
            log_test("Cancel mode=dry_run", True)
        else:
            log_test("Cancel mode=dry_run", False, f"Got mode={data.get('mode')}")
        
        # Check for note about account not terminated
        if "note" in data or "message" in data:
            log_test("Cancel has note/message field", True, f"Note: {data.get('note') or data.get('message')}")
        else:
            log_test("Cancel has note/message field", False, "Field missing")
    except Exception as e:
        log_test("DELETE /hosting/apifix01", False, f"Exception: {str(e)}")

def test_negative_auth():
    """Test 15: Negative tests (no auth, not found)"""
    print("\n=== TEST 15: Negative Tests (Auth & Not Found) ===")
    
    # Test 15a: No Authorization header → 401
    try:
        resp = requests.get(f"{BASE_URL}/hosting", timeout=10)
        data = resp.json()
        
        if resp.status_code == 401:
            log_test("GET /hosting without auth → 401", True, f"Error: {data.get('error')}")
        else:
            log_test("GET /hosting without auth → 401", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("GET /hosting without auth", False, f"Exception: {str(e)}")
    
    # Test 15b: Non-existent user → 404
    try:
        resp = requests.get(f"{BASE_URL}/hosting/nonexistentuser", headers=HEADERS, timeout=10)
        data = resp.json()
        
        if resp.status_code == 404:
            log_test("GET /hosting/nonexistentuser → 404", True, f"Error: {data.get('error')}")
        else:
            log_test("GET /hosting/nonexistentuser → 404", False, f"Got {resp.status_code}: {data}")
    except Exception as e:
        log_test("GET /hosting/nonexistentuser", False, f"Exception: {str(e)}")

def test_service_health():
    """Test 16: Service health check"""
    print("\n=== TEST 16: Service Health ===")
    
    # Check supervisor nodejs status
    import subprocess
    try:
        result = subprocess.run(["sudo", "supervisorctl", "status", "nodejs"], 
                              capture_output=True, text=True, timeout=5)
        if "RUNNING" in result.stdout:
            log_test("Supervisor nodejs is RUNNING", True, result.stdout.strip())
        else:
            log_test("Supervisor nodejs is RUNNING", False, result.stdout.strip())
    except Exception as e:
        log_test("Supervisor nodejs status", False, f"Exception: {str(e)}")
    
    # Check for errors in nodejs logs
    try:
        result = subprocess.run(["tail", "-n", "50", "/var/log/supervisor/nodejs.err.log"], 
                              capture_output=True, text=True, timeout=5)
        if "Cannot find module" in result.stdout or "Error:" in result.stdout:
            log_test("nodejs.err.log has no critical errors", False, f"Found errors: {result.stdout[:200]}")
        else:
            log_test("nodejs.err.log has no critical errors", True, "No 'Cannot find module' or stack traces")
    except Exception as e:
        log_test("nodejs.err.log check", False, f"Exception: {str(e)}")

def main():
    """Run all tests"""
    print("=" * 80)
    print("RESELLER API PARITY TEST SUITE (2026-10-03)")
    print("Testing 9 bug fixes for Nomadly Reseller API")
    print("Mode: DRY-RUN (RESELLER_API_LIVE not set)")
    print("=" * 80)
    
    test_health()
    test_account()
    test_hosting_plans()
    test_hosting_create_domain_modes()
    test_domain_register()
    test_hosting_list()
    test_hosting_detail()
    test_auto_renew()
    test_site_status()
    test_renew()
    test_upgrade()
    test_addons()
    test_addon_lookup()
    test_cancel()
    test_negative_auth()
    test_service_health()
    
    print("\n" + "=" * 80)
    print(f"TEST SUMMARY: {passed} PASSED, {failed} FAILED")
    print("=" * 80)
    
    # Print failed tests
    if failed > 0:
        print("\n❌ FAILED TESTS:")
        for result in test_results:
            if not result["success"]:
                print(f"  - {result['name']}")
                if result["details"]:
                    print(f"    {result['details']}")
    
    return 0 if failed == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
