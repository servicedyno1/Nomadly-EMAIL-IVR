#!/usr/bin/env python3
"""
Reseller API Re-test (2026-09-08 bot-balance-verify update)
============================================================
Re-test the Nomadly Reseller REST API after an update that:
  (a) extends the bot wallet balance + bot pricing over the API
  (b) hardens the insufficient-balance guard

This is a DEV/sandbox pod (SKIP_WEBHOOK_SYNC=true) hard-locked to dry_run mode,
connected to PRODUCTION MongoDB — testing MUST be READ-ONLY + dry-run only.

Owner: chatId 5590563715 (@onarrival1), wallet balance $5.00
API key: rsk_live_cdc3f785ac3cfd813c6143d7813e1a59cc15fc42327ab736
"""

import os
import sys
import json
import requests
import random
import string

# Read REACT_APP_BACKEND_URL from frontend/.env
def get_backend_url():
    env_path = '/app/frontend/.env'
    with open(env_path, 'r') as f:
        for line in f:
            if line.startswith('REACT_APP_BACKEND_URL='):
                return line.split('=', 1)[1].strip()
    raise Exception('REACT_APP_BACKEND_URL not found in /app/frontend/.env')

BACKEND_URL = get_backend_url()
BASE_URL = f"{BACKEND_URL}/api/reseller/v1"
API_KEY = "rsk_live_cdc3f785ac3cfd813c6143d7813e1a59cc15fc42327ab736"
OWNER_CHAT_ID = "5590563715"
EXPECTED_WALLET_BALANCE = 5.00

# Test results tracking
tests_passed = 0
tests_failed = 0
test_results = []

def log_test(name, passed, details=""):
    global tests_passed, tests_failed
    if passed:
        tests_passed += 1
        status = "✅ PASS"
    else:
        tests_failed += 1
        status = "❌ FAIL"
    
    result = f"{status}: {name}"
    if details:
        result += f"\n    {details}"
    print(result)
    test_results.append({"name": name, "passed": passed, "details": details})

def random_string(length=8):
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=length))

def test_insufficient_balance_guard():
    """
    PRIMARY TEST: INSUFFICIENT-BALANCE GUARD
    Because the wallet is only $5, EVERY billed order must be REFUSED with HTTP 402
    BEFORE any simulation/provisioning — even in dry_run.
    """
    print("\n" + "="*80)
    print("PRIMARY TEST: INSUFFICIENT-BALANCE GUARD (HTTP 402)")
    print("="*80)
    
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    
    # Test 1: POST /vps (price ~$18)
    print("\n[1] POST /vps (plan: s-1vcpu-1gb, region: EU, price ~$18)")
    try:
        resp = requests.post(f"{BASE_URL}/vps", 
                            headers=headers,
                            json={"plan_id": "s-1vcpu-1gb", "region": "EU"},
                            timeout=30)
        
        if resp.status_code == 402:
            data = resp.json()
            checks = [
                ("status code", resp.status_code == 402),
                ("error field", data.get("error") == "insufficient_wallet_balance"),
                ("price_usd present", "price_usd" in data and isinstance(data["price_usd"], (int, float))),
                ("wallet_balance_usd", data.get("wallet_balance_usd") == EXPECTED_WALLET_BALANCE),
                ("shortfall_usd present", "shortfall_usd" in data and isinstance(data["shortfall_usd"], (int, float))),
                ("mode", data.get("mode") == "dry_run"),
                ("product", data.get("product") == "vps"),
                ("action", data.get("action") == "create"),
                ("NO would_provision", "would_provision" not in data),
                ("NO sufficient_balance:true", data.get("sufficient_balance") != True)
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            details += f"\n    Response: {json.dumps(data, indent=2)}"
            log_test("POST /vps → 402 insufficient_wallet_balance", all_passed, details)
        else:
            log_test("POST /vps → 402 insufficient_wallet_balance", False, 
                    f"Expected 402, got {resp.status_code}. Response: {resp.text[:500]}")
    except Exception as e:
        log_test("POST /vps → 402 insufficient_wallet_balance", False, f"Exception: {str(e)}")
    
    # Test 2: POST /rdp (price ~$42.75)
    print("\n[2] POST /rdp (region: EU, price ~$42.75)")
    try:
        # First get a valid plan_id
        plans_resp = requests.get(f"{BASE_URL}/rdp/plans?region=EU", headers=headers, timeout=30)
        if plans_resp.status_code == 200:
            plans_data = plans_resp.json()
            plans = plans_data.get("plans", [])
            if plans:
                plan_id = plans[0]["plan_id"]
                print(f"    Using plan_id: {plan_id}")
                
                resp = requests.post(f"{BASE_URL}/rdp",
                                    headers=headers,
                                    json={"plan_id": plan_id, "region": "EU"},
                                    timeout=30)
                
                if resp.status_code == 402:
                    data = resp.json()
                    checks = [
                        ("status code", resp.status_code == 402),
                        ("error field", data.get("error") == "insufficient_wallet_balance"),
                        ("price_usd present", "price_usd" in data and isinstance(data["price_usd"], (int, float))),
                        ("wallet_balance_usd", data.get("wallet_balance_usd") == EXPECTED_WALLET_BALANCE),
                        ("shortfall_usd present", "shortfall_usd" in data and isinstance(data["shortfall_usd"], (int, float))),
                        ("mode", data.get("mode") == "dry_run"),
                        ("product", data.get("product") == "rdp"),
                        ("NO would_provision", "would_provision" not in data),
                        ("NO sufficient_balance:true", data.get("sufficient_balance") != True)
                    ]
                    
                    all_passed = all(check[1] for check in checks)
                    details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
                    details += f"\n    Response: {json.dumps(data, indent=2)}"
                    log_test("POST /rdp → 402 insufficient_wallet_balance", all_passed, details)
                else:
                    log_test("POST /rdp → 402 insufficient_wallet_balance", False,
                            f"Expected 402, got {resp.status_code}. Response: {resp.text[:500]}")
            else:
                log_test("POST /rdp → 402 insufficient_wallet_balance", False, "No RDP plans available")
        else:
            log_test("POST /rdp → 402 insufficient_wallet_balance", False, 
                    f"Failed to get RDP plans: {plans_resp.status_code}")
    except Exception as e:
        log_test("POST /rdp → 402 insufficient_wallet_balance", False, f"Exception: {str(e)}")
    
    # Test 3: POST /hosting (price $100)
    print("\n[3] POST /hosting (plan: golden-monthly, price $100)")
    try:
        domain = f"resellertest-{random_string()}.com"
        resp = requests.post(f"{BASE_URL}/hosting",
                            headers=headers,
                            json={"plan_id": "golden-monthly", "domain": domain, "domain_mode": "byo"},
                            timeout=30)
        
        if resp.status_code == 402:
            data = resp.json()
            checks = [
                ("status code", resp.status_code == 402),
                ("error field", data.get("error") == "insufficient_wallet_balance"),
                ("price_usd", data.get("price_usd") == 100),
                ("wallet_balance_usd", data.get("wallet_balance_usd") == EXPECTED_WALLET_BALANCE),
                ("shortfall_usd", data.get("shortfall_usd") == 95),
                ("mode", data.get("mode") == "dry_run"),
                ("product", data.get("product") == "hosting"),
                ("NO would_provision", "would_provision" not in data),
                ("NO sufficient_balance:true", data.get("sufficient_balance") != True)
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            details += f"\n    Response: {json.dumps(data, indent=2)}"
            log_test("POST /hosting → 402 insufficient_wallet_balance", all_passed, details)
        else:
            log_test("POST /hosting → 402 insufficient_wallet_balance", False,
                    f"Expected 402, got {resp.status_code}. Response: {resp.text[:500]}")
    except Exception as e:
        log_test("POST /hosting → 402 insufficient_wallet_balance", False, f"Exception: {str(e)}")
    
    # Test 4: POST /domains/register (price $30+)
    print("\n[4] POST /domains/register (price $30+)")
    try:
        domain = f"resellertest-{random_string()}.com"
        resp = requests.post(f"{BASE_URL}/domains/register",
                            headers=headers,
                            json={"domain": domain},
                            timeout=30)
        
        # Accept either 402 (insufficient balance) or 409 (domain unavailable)
        if resp.status_code == 402:
            data = resp.json()
            checks = [
                ("status code", resp.status_code == 402),
                ("error field", data.get("error") == "insufficient_wallet_balance"),
                ("price_usd present", "price_usd" in data and isinstance(data["price_usd"], (int, float))),
                ("wallet_balance_usd", data.get("wallet_balance_usd") == EXPECTED_WALLET_BALANCE),
                ("shortfall_usd present", "shortfall_usd" in data and isinstance(data["shortfall_usd"], (int, float))),
                ("mode", data.get("mode") == "dry_run"),
                ("product", data.get("product") == "domain"),
                ("NO would_provision", "would_provision" not in data)
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            details += f"\n    Response: {json.dumps(data, indent=2)}"
            log_test("POST /domains/register → 402 insufficient_wallet_balance", all_passed, details)
        elif resp.status_code == 409:
            data = resp.json()
            if data.get("error") == "domain_unavailable":
                log_test("POST /domains/register → 402 insufficient_wallet_balance", True,
                        f"Got 409 domain_unavailable (acceptable alternative). Domain: {domain}")
            else:
                log_test("POST /domains/register → 402 insufficient_wallet_balance", False,
                        f"Got 409 but wrong error: {data.get('error')}")
        else:
            log_test("POST /domains/register → 402 insufficient_wallet_balance", False,
                    f"Expected 402 or 409, got {resp.status_code}. Response: {resp.text[:500]}")
    except Exception as e:
        log_test("POST /domains/register → 402 insufficient_wallet_balance", False, f"Exception: {str(e)}")

def test_pricing_endpoint():
    """Test GET /pricing?region=EU"""
    print("\n" + "="*80)
    print("TEST: GET /pricing?region=EU")
    print("="*80)
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    
    try:
        resp = requests.get(f"{BASE_URL}/pricing?region=EU", headers=headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            
            # Check required fields
            checks = [
                ("status code", resp.status_code == 200),
                ("mode", data.get("mode") == "dry_run"),
                ("currency", data.get("currency") == "usd"),
                ("wallet_balance_usd", data.get("wallet_balance_usd") == EXPECTED_WALLET_BALANCE),
                ("region", data.get("region") == "EU"),
                ("domains key", "domains" in data),
                ("domains.note", "note" in data.get("domains", {})),
                ("domains.min_price_usd", data.get("domains", {}).get("min_price_usd") == 30),
                ("hosting key", "hosting" in data and isinstance(data["hosting"], list)),
                ("hosting length", len(data.get("hosting", [])) == 3),
                ("vps key", "vps" in data),
                ("rdp key", "rdp" in data)
            ]
            
            # Check hosting prices
            hosting = data.get("hosting", [])
            hosting_prices = {p["plan_id"]: p["price_usd"] for p in hosting}
            checks.extend([
                ("premium-weekly price", hosting_prices.get("premium-weekly") == 30),
                ("premium-monthly price", hosting_prices.get("premium-monthly") == 75),
                ("golden-monthly price", hosting_prices.get("golden-monthly") == 100)
            ])
            
            # Check VPS structure
            vps = data.get("vps", {})
            checks.extend([
                ("vps.provider", "provider" in vps),
                ("vps.region", vps.get("region") == "EU"),
                ("vps.plans", "plans" in vps and isinstance(vps["plans"], list))
            ])
            
            # Check RDP structure
            rdp = data.get("rdp", {})
            checks.extend([
                ("rdp.provider", "provider" in rdp),
                ("rdp.region", rdp.get("region") == "EU"),
                ("rdp.plans", "plans" in rdp and isinstance(rdp["plans"], list))
            ])
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            details += f"\n    Hosting plans: {json.dumps(hosting, indent=2)}"
            log_test("GET /pricing?region=EU → 200 with full catalog", all_passed, details)
        else:
            log_test("GET /pricing?region=EU → 200 with full catalog", False,
                    f"Expected 200, got {resp.status_code}. Response: {resp.text[:500]}")
    except Exception as e:
        log_test("GET /pricing?region=EU → 200 with full catalog", False, f"Exception: {str(e)}")

def test_account_endpoint():
    """Test GET /account"""
    print("\n" + "="*80)
    print("TEST: GET /account")
    print("="*80)
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    
    try:
        resp = requests.get(f"{BASE_URL}/account", headers=headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            
            checks = [
                ("status code", resp.status_code == 200),
                ("owner_chat_id", data.get("owner_chat_id") == OWNER_CHAT_ID),
                ("wallet_balance_usd", data.get("wallet_balance_usd") == EXPECTED_WALLET_BALANCE),
                ("currency", data.get("currency") == "usd"),
                ("mode", data.get("mode") == "dry_run")
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            details += f"\n    Response: {json.dumps(data, indent=2)}"
            log_test("GET /account → 200 with correct data", all_passed, details)
        else:
            log_test("GET /account → 200 with correct data", False,
                    f"Expected 200, got {resp.status_code}. Response: {resp.text[:500]}")
    except Exception as e:
        log_test("GET /account → 200 with correct data", False, f"Exception: {str(e)}")

def test_unbilled_reads():
    """Test unbilled read endpoints"""
    print("\n" + "="*80)
    print("TEST: UNBILLED READS (200)")
    print("="*80)
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    
    # Test 1: GET /health (NO auth needed)
    print("\n[1] GET /health (no auth)")
    try:
        resp = requests.get(f"{BASE_URL}/health", timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            checks = [
                ("status code", resp.status_code == 200),
                ("mode", data.get("mode") == "dry_run"),
                ("products list", "products" in data and isinstance(data["products"], list))
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            log_test("GET /health → 200", all_passed, details)
        else:
            log_test("GET /health → 200", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("GET /health → 200", False, f"Exception: {str(e)}")
    
    # Test 2: GET /hosting/plans
    print("\n[2] GET /hosting/plans")
    try:
        resp = requests.get(f"{BASE_URL}/hosting/plans", headers=headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            plans = data.get("plans", [])
            checks = [
                ("status code", resp.status_code == 200),
                ("plans count", len(plans) == 3)
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            log_test("GET /hosting/plans → 200 (3 plans)", all_passed, details)
        else:
            log_test("GET /hosting/plans → 200 (3 plans)", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("GET /hosting/plans → 200 (3 plans)", False, f"Exception: {str(e)}")
    
    # Test 3: GET /vps/plans?region=EU
    print("\n[3] GET /vps/plans?region=EU")
    try:
        resp = requests.get(f"{BASE_URL}/vps/plans?region=EU", headers=headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            plans = data.get("plans", [])
            checks = [
                ("status code", resp.status_code == 200),
                ("plans present", len(plans) > 0)
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            log_test("GET /vps/plans?region=EU → 200", all_passed, details)
        else:
            log_test("GET /vps/plans?region=EU → 200", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("GET /vps/plans?region=EU → 200", False, f"Exception: {str(e)}")
    
    # Test 4: GET /rdp/plans?region=EU
    print("\n[4] GET /rdp/plans?region=EU")
    try:
        resp = requests.get(f"{BASE_URL}/rdp/plans?region=EU", headers=headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            plans = data.get("plans", [])
            checks = [
                ("status code", resp.status_code == 200),
                ("plans present", len(plans) > 0)
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            log_test("GET /rdp/plans?region=EU → 200", all_passed, details)
        else:
            log_test("GET /rdp/plans?region=EU → 200", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("GET /rdp/plans?region=EU → 200", False, f"Exception: {str(e)}")
    
    # Test 5: GET /domains/search (1 call only to minimize live external calls)
    print("\n[5] GET /domains/search?domain=example-{random}.com (1 call only)")
    try:
        domain = f"example-{random_string()}.com"
        resp = requests.get(f"{BASE_URL}/domains/search?domain={domain}", headers=headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            checks = [
                ("status code", resp.status_code == 200),
                ("available field", "available" in data),
                ("price_usd field", "price_usd" in data)
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            log_test("GET /domains/search → 200", all_passed, details)
        else:
            log_test("GET /domains/search → 200", False, f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("GET /domains/search → 200", False, f"Exception: {str(e)}")
    
    # Test 6: GET /dns/<domain>/records (1 call only, graceful error acceptable)
    print("\n[6] GET /dns/testingbays.sbs/records (1 call only, graceful error OK)")
    try:
        resp = requests.get(f"{BASE_URL}/dns/testingbays.sbs/records", headers=headers, timeout=30)
        
        # Accept 200 with records array OR graceful error
        if resp.status_code == 200:
            data = resp.json()
            checks = [
                ("status code", resp.status_code == 200),
                ("records field", "records" in data)
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            log_test("GET /dns/<domain>/records → 200 or graceful error", all_passed, details)
        else:
            # Graceful error is acceptable
            log_test("GET /dns/<domain>/records → 200 or graceful error", True,
                    f"Got {resp.status_code} (graceful error acceptable)")
    except Exception as e:
        log_test("GET /dns/<domain>/records → 200 or graceful error", False, f"Exception: {str(e)}")

def test_auth():
    """Test authentication"""
    print("\n" + "="*80)
    print("TEST: AUTHENTICATION")
    print("="*80)
    
    # Test 1: Missing API key
    print("\n[1] GET /account with NO key → 401 missing_api_key")
    try:
        resp = requests.get(f"{BASE_URL}/account", timeout=30)
        
        if resp.status_code == 401:
            data = resp.json()
            checks = [
                ("status code", resp.status_code == 401),
                ("error", data.get("error") == "missing_api_key")
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            log_test("GET /account (no key) → 401 missing_api_key", all_passed, details)
        else:
            log_test("GET /account (no key) → 401 missing_api_key", False,
                    f"Expected 401, got {resp.status_code}")
    except Exception as e:
        log_test("GET /account (no key) → 401 missing_api_key", False, f"Exception: {str(e)}")
    
    # Test 2: Invalid API key
    print("\n[2] GET /account with WRONG key → 401 invalid_api_key")
    try:
        headers = {"Authorization": "Bearer WRONG_KEY_12345"}
        resp = requests.get(f"{BASE_URL}/account", headers=headers, timeout=30)
        
        if resp.status_code == 401:
            data = resp.json()
            checks = [
                ("status code", resp.status_code == 401),
                ("error", data.get("error") == "invalid_api_key")
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            log_test("GET /account (wrong key) → 401 invalid_api_key", all_passed, details)
        else:
            log_test("GET /account (wrong key) → 401 invalid_api_key", False,
                    f"Expected 401, got {resp.status_code}")
    except Exception as e:
        log_test("GET /account (wrong key) → 401 invalid_api_key", False, f"Exception: {str(e)}")

def test_apidoc():
    """Test GET /apidoc"""
    print("\n" + "="*80)
    print("TEST: GET /apidoc")
    print("="*80)
    
    # Note: /apidoc is at {REACT_APP_BACKEND_URL}/api/apidoc, NOT under /reseller/v1
    apidoc_url = f"{BACKEND_URL}/api/apidoc"
    
    try:
        resp = requests.get(apidoc_url, timeout=30)
        
        if resp.status_code == 200:
            html = resp.text
            checks = [
                ("status code", resp.status_code == 200),
                ("Content-Type HTML", "text/html" in resp.headers.get("Content-Type", "")),
                ("contains '/pricing'", "/pricing" in html),
                ("contains '402' guard wording", "402" in html and "insufficient" in html.lower())
            ]
            
            all_passed = all(check[1] for check in checks)
            details = "\n    ".join([f"{'✓' if c[1] else '✗'} {c[0]}" for c in checks])
            log_test("GET /apidoc → 200 HTML with /pricing and 402 guard", all_passed, details)
        else:
            log_test("GET /apidoc → 200 HTML with /pricing and 402 guard", False,
                    f"Expected 200, got {resp.status_code}")
    except Exception as e:
        log_test("GET /apidoc → 200 HTML with /pricing and 402 guard", False, f"Exception: {str(e)}")

def test_final_wallet_check():
    """Final safety check: wallet balance still $5"""
    print("\n" + "="*80)
    print("FINAL SAFETY CHECK: Wallet balance UNCHANGED")
    print("="*80)
    
    headers = {"Authorization": f"Bearer {API_KEY}"}
    
    try:
        resp = requests.get(f"{BASE_URL}/account", headers=headers, timeout=30)
        
        if resp.status_code == 200:
            data = resp.json()
            balance = data.get("wallet_balance_usd")
            
            if balance == EXPECTED_WALLET_BALANCE:
                log_test("Final wallet check: balance STILL $5.00", True,
                        f"Wallet balance: ${balance} (unchanged)")
            else:
                log_test("Final wallet check: balance STILL $5.00", False,
                        f"Wallet balance changed! Expected ${EXPECTED_WALLET_BALANCE}, got ${balance}")
        else:
            log_test("Final wallet check: balance STILL $5.00", False,
                    f"Failed to get account: {resp.status_code}")
    except Exception as e:
        log_test("Final wallet check: balance STILL $5.00", False, f"Exception: {str(e)}")

def main():
    print("="*80)
    print("RESELLER API RE-TEST (2026-09-08 bot-balance-verify update)")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"Owner: {OWNER_CHAT_ID} (@onarrival1)")
    print(f"Expected wallet balance: ${EXPECTED_WALLET_BALANCE}")
    print(f"Mode: dry_run (SKIP_WEBHOOK_SYNC=true)")
    print("="*80)
    
    # Run all tests
    test_insufficient_balance_guard()
    test_pricing_endpoint()
    test_account_endpoint()
    test_unbilled_reads()
    test_auth()
    test_apidoc()
    test_final_wallet_check()
    
    # Summary
    print("\n" + "="*80)
    print("TEST SUMMARY")
    print("="*80)
    print(f"Total tests: {tests_passed + tests_failed}")
    print(f"✅ Passed: {tests_passed}")
    print(f"❌ Failed: {tests_failed}")
    print(f"Pass rate: {100 * tests_passed / (tests_passed + tests_failed):.1f}%")
    print("="*80)
    
    # Exit with appropriate code
    sys.exit(0 if tests_failed == 0 else 1)

if __name__ == "__main__":
    main()
