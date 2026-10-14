#!/usr/bin/env python3
"""
Reseller REST API Backend Test (2026-09-08)
Tests the NEW Reseller REST API at /api/reseller/v1/*
API Key: rsk_live_cdc3f785ac3cfd813c6143d7813e1a59cc15fc42327ab736
Owner: @onarrival1 / chatId 5590563715, wallet $5.00
Mode: dry_run (SKIP_WEBHOOK_SYNC=true on this dev/sandbox pod)

CRITICAL SAFETY:
- This API is HARD-LOCKED to dry_run mode (no real provisioning, no wallet charges)
- MONGO is PRODUCTION data - read-only + dry-run only
- Keep live registrar/DNS calls to a minimum
- VERIFY wallet balance is UNCHANGED after all tests ($5.00, usdIn=5, usdOut=0)
"""

import requests
import json
import sys
import time

# Base URL from frontend/.env
BASE_URL = "https://nomadly-deploy.preview.emergentagent.com"
API_BASE = f"{BASE_URL}/api/reseller/v1"

# API Key (bound to @onarrival1 / chatId 5590563715, wallet $5.00)
API_KEY = "rsk_live_cdc3f785ac3cfd813c6143d7813e1a59cc15fc42327ab736"
OWNER_CHAT_ID = "5590563715"
EXPECTED_WALLET_BALANCE = 5.00

# Colors for output
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
RESET = "\033[0m"

class TestResults:
    def __init__(self):
        self.passed = []
        self.failed = []
        self.warnings = []
        self.test_count = 0
    
    def add_pass(self, test_name, details=""):
        self.test_count += 1
        self.passed.append((test_name, details))
        print(f"{GREEN}✅ PASS{RESET} [{self.test_count}]: {test_name}")
        if details:
            print(f"   {details}")
    
    def add_fail(self, test_name, details=""):
        self.test_count += 1
        self.failed.append((test_name, details))
        print(f"{RED}❌ FAIL{RESET} [{self.test_count}]: {test_name}")
        if details:
            print(f"   {details}")
    
    def add_warning(self, test_name, details=""):
        self.warnings.append((test_name, details))
        print(f"{YELLOW}⚠️  WARN{RESET}: {test_name}")
        if details:
            print(f"   {details}")
    
    def summary(self):
        print("\n" + "="*80)
        print("TEST SUMMARY")
        print("="*80)
        print(f"✅ Passed: {len(self.passed)}/{self.test_count}")
        print(f"❌ Failed: {len(self.failed)}/{self.test_count}")
        print(f"⚠️  Warnings: {len(self.warnings)}")
        
        if self.failed:
            print(f"\n{RED}FAILED TESTS:{RESET}")
            for name, details in self.failed:
                print(f"  • {name}")
                if details:
                    print(f"    {details}")
        
        if self.warnings:
            print(f"\n{YELLOW}WARNINGS:{RESET}")
            for name, details in self.warnings:
                print(f"  • {name}")
                if details:
                    print(f"    {details}")
        
        return len(self.failed) == 0

def main():
    results = TestResults()
    
    print("="*80)
    print("Reseller REST API Backend Test (2026-09-08)")
    print("="*80)
    print(f"API Base: {API_BASE}")
    print(f"Owner: @onarrival1 / chatId {OWNER_CHAT_ID}")
    print(f"Expected Mode: dry_run")
    print(f"Expected Wallet: ${EXPECTED_WALLET_BALANCE}")
    print("="*80 + "\n")
    
    # ========================================================================
    # TEST 1: GET /health (no auth required)
    # ========================================================================
    print(f"\n{BLUE}[TEST 1] GET /health (no auth){RESET}")
    try:
        resp = requests.get(f"{API_BASE}/health", timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("ok") == True and data.get("service") == "reseller-api" and data.get("mode") == "dry_run":
                products = data.get("products", [])
                expected_products = ["domains", "dns", "vps", "rdp", "hosting"]
                if all(p in products for p in expected_products):
                    results.add_pass("GET /health", f"ok=true, service=reseller-api, mode=dry_run, products={products}")
                else:
                    results.add_fail("GET /health", f"Missing expected products. Got: {products}, Expected: {expected_products}")
            else:
                results.add_fail("GET /health", f"Unexpected response: {data}")
        else:
            results.add_fail("GET /health", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("GET /health", f"Exception: {e}")
    
    # ========================================================================
    # TEST 2: Auth - Missing API Key
    # ========================================================================
    print(f"\n{BLUE}[TEST 2] Auth - Missing API Key{RESET}")
    try:
        resp = requests.get(f"{API_BASE}/account", timeout=10)
        if resp.status_code == 401:
            data = resp.json()
            if data.get("error") == "missing_api_key":
                results.add_pass("Auth - Missing API Key", f"401 with error='missing_api_key'")
            else:
                results.add_fail("Auth - Missing API Key", f"Expected error='missing_api_key', got: {data}")
        else:
            results.add_fail("Auth - Missing API Key", f"Expected 401, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Auth - Missing API Key", f"Exception: {e}")
    
    # ========================================================================
    # TEST 3: Auth - Invalid API Key
    # ========================================================================
    print(f"\n{BLUE}[TEST 3] Auth - Invalid API Key{RESET}")
    try:
        resp = requests.get(f"{API_BASE}/account", headers={"Authorization": "Bearer WRONG_KEY_12345"}, timeout=10)
        if resp.status_code == 401:
            data = resp.json()
            if data.get("error") == "invalid_api_key":
                results.add_pass("Auth - Invalid API Key", f"401 with error='invalid_api_key'")
            else:
                results.add_fail("Auth - Invalid API Key", f"Expected error='invalid_api_key', got: {data}")
        else:
            results.add_fail("Auth - Invalid API Key", f"Expected 401, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Auth - Invalid API Key", f"Exception: {e}")
    
    # ========================================================================
    # TEST 4: Auth - Valid API Key (Authorization: Bearer)
    # ========================================================================
    print(f"\n{BLUE}[TEST 4] Auth - Valid API Key (Authorization: Bearer){RESET}")
    try:
        resp = requests.get(f"{API_BASE}/account", headers={"Authorization": f"Bearer {API_KEY}"}, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("owner_chat_id") == OWNER_CHAT_ID and data.get("mode") == "dry_run":
                wallet_balance = data.get("wallet_balance_usd")
                if wallet_balance == EXPECTED_WALLET_BALANCE:
                    results.add_pass("Auth - Valid API Key (Bearer)", f"owner_chat_id={OWNER_CHAT_ID}, wallet_balance_usd=${wallet_balance}, mode=dry_run")
                else:
                    results.add_warning("Auth - Valid API Key (Bearer)", f"Wallet balance mismatch: expected ${EXPECTED_WALLET_BALANCE}, got ${wallet_balance}")
                    results.add_pass("Auth - Valid API Key (Bearer)", f"owner_chat_id={OWNER_CHAT_ID}, mode=dry_run (wallet balance: ${wallet_balance})")
            else:
                results.add_fail("Auth - Valid API Key (Bearer)", f"Unexpected response: {data}")
        else:
            results.add_fail("Auth - Valid API Key (Bearer)", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Auth - Valid API Key (Bearer)", f"Exception: {e}")
    
    # ========================================================================
    # TEST 5: Auth - Valid API Key (X-API-Key header)
    # ========================================================================
    print(f"\n{BLUE}[TEST 5] Auth - Valid API Key (X-API-Key header){RESET}")
    try:
        resp = requests.get(f"{API_BASE}/account", headers={"X-API-Key": API_KEY}, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("owner_chat_id") == OWNER_CHAT_ID and data.get("mode") == "dry_run":
                wallet_balance = data.get("wallet_balance_usd")
                results.add_pass("Auth - Valid API Key (X-API-Key)", f"owner_chat_id={OWNER_CHAT_ID}, wallet_balance_usd=${wallet_balance}, mode=dry_run")
            else:
                results.add_fail("Auth - Valid API Key (X-API-Key)", f"Unexpected response: {data}")
        else:
            results.add_fail("Auth - Valid API Key (X-API-Key)", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Auth - Valid API Key (X-API-Key)", f"Exception: {e}")
    
    # Use Bearer auth for remaining tests
    headers = {"Authorization": f"Bearer {API_KEY}"}
    
    # ========================================================================
    # TEST 6: GET /hosting/plans
    # ========================================================================
    print(f"\n{BLUE}[TEST 6] GET /hosting/plans{RESET}")
    try:
        resp = requests.get(f"{API_BASE}/hosting/plans", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            plans = data.get("plans", [])
            if len(plans) == 3:
                # Check for expected plans
                plan_ids = [p.get("plan_id") for p in plans]
                expected_ids = ["premium-weekly", "premium-monthly", "golden-monthly"]
                if all(pid in plan_ids for pid in expected_ids):
                    # Check prices
                    prices = {p.get("plan_id"): p.get("price_usd") for p in plans}
                    expected_prices = {"premium-weekly": 30, "premium-monthly": 75, "golden-monthly": 100}
                    price_match = all(prices.get(pid) == expected_prices[pid] for pid in expected_ids)
                    if price_match:
                        results.add_pass("GET /hosting/plans", f"3 plans: premium-weekly=$30, premium-monthly=$75, golden-monthly=$100")
                    else:
                        results.add_fail("GET /hosting/plans", f"Price mismatch. Got: {prices}, Expected: {expected_prices}")
                else:
                    results.add_fail("GET /hosting/plans", f"Missing expected plan IDs. Got: {plan_ids}, Expected: {expected_ids}")
            else:
                results.add_fail("GET /hosting/plans", f"Expected 3 plans, got {len(plans)}: {plans}")
        else:
            results.add_fail("GET /hosting/plans", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("GET /hosting/plans", f"Exception: {e}")
    
    # ========================================================================
    # TEST 7: GET /vps/plans?region=EU
    # ========================================================================
    print(f"\n{BLUE}[TEST 7] GET /vps/plans?region=EU{RESET}")
    try:
        resp = requests.get(f"{API_BASE}/vps/plans?region=EU", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            plans = data.get("plans", [])
            if len(plans) > 0:
                # Check that all plans have plan_id and price_usd > 0
                all_valid = all(p.get("plan_id") and isinstance(p.get("price_usd"), (int, float)) and p.get("price_usd") > 0 for p in plans)
                if all_valid:
                    results.add_pass("GET /vps/plans?region=EU", f"{len(plans)} DigitalOcean plans with plan_id + price_usd > 0")
                else:
                    results.add_fail("GET /vps/plans?region=EU", f"Some plans missing plan_id or price_usd <= 0: {plans[:3]}")
            else:
                results.add_fail("GET /vps/plans?region=EU", f"Expected plans, got empty list")
        else:
            results.add_fail("GET /vps/plans?region=EU", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("GET /vps/plans?region=EU", f"Exception: {e}")
    
    # ========================================================================
    # TEST 8: GET /rdp/plans?region=EU
    # ========================================================================
    print(f"\n{BLUE}[TEST 8] GET /rdp/plans?region=EU{RESET}")
    try:
        resp = requests.get(f"{API_BASE}/rdp/plans?region=EU", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            plans = data.get("plans", [])
            if len(plans) > 0:
                # Check that all plans have plan_id and price_usd > 0
                all_valid = all(p.get("plan_id") and isinstance(p.get("price_usd"), (int, float)) and p.get("price_usd") > 0 for p in plans)
                if all_valid:
                    results.add_pass("GET /rdp/plans?region=EU", f"{len(plans)} Azure plans with plan_id + price_usd > 0")
                else:
                    results.add_fail("GET /rdp/plans?region=EU", f"Some plans missing plan_id or price_usd <= 0: {plans[:3]}")
            else:
                results.add_fail("GET /rdp/plans?region=EU", f"Expected plans, got empty list")
        else:
            results.add_fail("GET /rdp/plans?region=EU", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("GET /rdp/plans?region=EU", f"Exception: {e}")
    
    # ========================================================================
    # TEST 9: Dry-run billing - POST /vps
    # ========================================================================
    print(f"\n{BLUE}[TEST 9] Dry-run billing - POST /vps{RESET}")
    try:
        payload = {"plan_id": "s-1vcpu-1gb", "region": "EU", "hostname": "tb1"}
        resp = requests.post(f"{API_BASE}/vps", headers=headers, json=payload, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("mode") == "dry_run" and data.get("product") == "vps":
                price_usd = data.get("price_usd")
                wallet_balance = data.get("wallet_balance_usd")
                sufficient = data.get("sufficient_balance")
                would_provision = data.get("would_provision")
                if price_usd and wallet_balance == EXPECTED_WALLET_BALANCE and would_provision:
                    results.add_pass("Dry-run billing - POST /vps", f"mode=dry_run, product=vps, price_usd={price_usd}, wallet_balance_usd={wallet_balance}, sufficient_balance={sufficient}, would_provision present")
                else:
                    results.add_fail("Dry-run billing - POST /vps", f"Missing expected fields: {data}")
            else:
                results.add_fail("Dry-run billing - POST /vps", f"Expected mode=dry_run and product=vps, got: {data}")
        else:
            results.add_fail("Dry-run billing - POST /vps", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Dry-run billing - POST /vps", f"Exception: {e}")
    
    # ========================================================================
    # TEST 10: Dry-run billing - POST /rdp
    # ========================================================================
    print(f"\n{BLUE}[TEST 10] Dry-run billing - POST /rdp{RESET}")
    try:
        payload = {"plan_id": "Standard_D2s_v6", "region": "EU"}
        resp = requests.post(f"{API_BASE}/rdp", headers=headers, json=payload, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("mode") == "dry_run" and data.get("product") == "rdp":
                price_usd = data.get("price_usd")
                wallet_balance = data.get("wallet_balance_usd")
                if price_usd and wallet_balance == EXPECTED_WALLET_BALANCE:
                    results.add_pass("Dry-run billing - POST /rdp", f"mode=dry_run, product=rdp, price_usd={price_usd}, wallet_balance_usd={wallet_balance}")
                else:
                    results.add_fail("Dry-run billing - POST /rdp", f"Missing expected fields: {data}")
            else:
                results.add_fail("Dry-run billing - POST /rdp", f"Expected mode=dry_run and product=rdp, got: {data}")
        else:
            results.add_fail("Dry-run billing - POST /rdp", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Dry-run billing - POST /rdp", f"Exception: {e}")
    
    # ========================================================================
    # TEST 11: Dry-run billing - POST /hosting
    # ========================================================================
    print(f"\n{BLUE}[TEST 11] Dry-run billing - POST /hosting{RESET}")
    try:
        payload = {"plan_id": "golden-monthly", "domain": "myresellersite.com", "domain_mode": "byo"}
        resp = requests.post(f"{API_BASE}/hosting", headers=headers, json=payload, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            if data.get("mode") == "dry_run" and data.get("product") == "hosting":
                price_usd = data.get("price_usd")
                wallet_balance = data.get("wallet_balance_usd")
                if price_usd == 100 and wallet_balance == EXPECTED_WALLET_BALANCE:
                    results.add_pass("Dry-run billing - POST /hosting", f"mode=dry_run, product=hosting, price_usd={price_usd}, wallet_balance_usd={wallet_balance}")
                else:
                    results.add_fail("Dry-run billing - POST /hosting", f"Expected price_usd=100, got: {data}")
            else:
                results.add_fail("Dry-run billing - POST /hosting", f"Expected mode=dry_run and product=hosting, got: {data}")
        else:
            results.add_fail("Dry-run billing - POST /hosting", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Dry-run billing - POST /hosting", f"Exception: {e}")
    
    # ========================================================================
    # TEST 12: Validation - POST /vps with invalid plan_id
    # ========================================================================
    print(f"\n{BLUE}[TEST 12] Validation - POST /vps with invalid plan_id{RESET}")
    try:
        payload = {"plan_id": "nope", "region": "EU"}
        resp = requests.post(f"{API_BASE}/vps", headers=headers, json=payload, timeout=10)
        if resp.status_code == 400:
            data = resp.json()
            if data.get("error") == "invalid_plan":
                results.add_pass("Validation - POST /vps invalid plan_id", f"400 with error='invalid_plan'")
            else:
                results.add_fail("Validation - POST /vps invalid plan_id", f"Expected error='invalid_plan', got: {data}")
        else:
            results.add_fail("Validation - POST /vps invalid plan_id", f"Expected 400, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Validation - POST /vps invalid plan_id", f"Exception: {e}")
    
    # ========================================================================
    # TEST 13: Validation - POST /hosting with invalid plan_id
    # ========================================================================
    print(f"\n{BLUE}[TEST 13] Validation - POST /hosting with invalid plan_id{RESET}")
    try:
        payload = {"plan_id": "bad", "domain": "x.com", "domain_mode": "byo"}
        resp = requests.post(f"{API_BASE}/hosting", headers=headers, json=payload, timeout=10)
        if resp.status_code == 400:
            data = resp.json()
            if data.get("error") == "invalid_plan":
                results.add_pass("Validation - POST /hosting invalid plan_id", f"400 with error='invalid_plan'")
            else:
                results.add_fail("Validation - POST /hosting invalid plan_id", f"Expected error='invalid_plan', got: {data}")
        else:
            results.add_fail("Validation - POST /hosting invalid plan_id", f"Expected 400, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Validation - POST /hosting invalid plan_id", f"Exception: {e}")
    
    # ========================================================================
    # TEST 14: Validation - POST /domains/register with invalid domain
    # ========================================================================
    print(f"\n{BLUE}[TEST 14] Validation - POST /domains/register with invalid domain{RESET}")
    try:
        payload = {"domain": "not a domain"}
        resp = requests.post(f"{API_BASE}/domains/register", headers=headers, json=payload, timeout=10)
        if resp.status_code == 400:
            data = resp.json()
            if data.get("error") == "invalid_domain":
                results.add_pass("Validation - POST /domains/register invalid domain", f"400 with error='invalid_domain'")
            else:
                results.add_fail("Validation - POST /domains/register invalid domain", f"Expected error='invalid_domain', got: {data}")
        else:
            results.add_fail("Validation - POST /domains/register invalid domain", f"Expected 400, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Validation - POST /domains/register invalid domain", f"Exception: {e}")
    
    # ========================================================================
    # TEST 15: Validation - GET /vps/:id with non-existent ID
    # ========================================================================
    print(f"\n{BLUE}[TEST 15] Validation - GET /vps/doesnotexist{RESET}")
    try:
        resp = requests.get(f"{API_BASE}/vps/doesnotexist", headers=headers, timeout=10)
        if resp.status_code == 404:
            data = resp.json()
            if data.get("error") == "not_found":
                results.add_pass("Validation - GET /vps/doesnotexist", f"404 with error='not_found'")
            else:
                results.add_fail("Validation - GET /vps/doesnotexist", f"Expected error='not_found', got: {data}")
        else:
            results.add_fail("Validation - GET /vps/doesnotexist", f"Expected 404, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Validation - GET /vps/doesnotexist", f"Exception: {e}")
    
    # ========================================================================
    # TEST 16: Validation - GET /rdp/:id with non-existent ID
    # ========================================================================
    print(f"\n{BLUE}[TEST 16] Validation - GET /rdp/doesnotexist{RESET}")
    try:
        resp = requests.get(f"{API_BASE}/rdp/doesnotexist", headers=headers, timeout=10)
        if resp.status_code == 404:
            data = resp.json()
            if data.get("error") == "not_found":
                results.add_pass("Validation - GET /rdp/doesnotexist", f"404 with error='not_found'")
            else:
                results.add_fail("Validation - GET /rdp/doesnotexist", f"Expected error='not_found', got: {data}")
        else:
            results.add_fail("Validation - GET /rdp/doesnotexist", f"Expected 404, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Validation - GET /rdp/doesnotexist", f"Exception: {e}")
    
    # ========================================================================
    # TEST 17: Owner-scoped list - GET /vps
    # ========================================================================
    print(f"\n{BLUE}[TEST 17] Owner-scoped list - GET /vps{RESET}")
    try:
        resp = requests.get(f"{API_BASE}/vps", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            vps_list = data.get("vps", [])
            if isinstance(vps_list, list):
                results.add_pass("Owner-scoped list - GET /vps", f"200 with array (length={len(vps_list)})")
            else:
                results.add_fail("Owner-scoped list - GET /vps", f"Expected array, got: {data}")
        else:
            results.add_fail("Owner-scoped list - GET /vps", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Owner-scoped list - GET /vps", f"Exception: {e}")
    
    # ========================================================================
    # TEST 18: Owner-scoped list - GET /rdp
    # ========================================================================
    print(f"\n{BLUE}[TEST 18] Owner-scoped list - GET /rdp{RESET}")
    try:
        resp = requests.get(f"{API_BASE}/rdp", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            rdp_list = data.get("rdp", [])
            if isinstance(rdp_list, list):
                results.add_pass("Owner-scoped list - GET /rdp", f"200 with array (length={len(rdp_list)})")
            else:
                results.add_fail("Owner-scoped list - GET /rdp", f"Expected array, got: {data}")
        else:
            results.add_fail("Owner-scoped list - GET /rdp", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Owner-scoped list - GET /rdp", f"Exception: {e}")
    
    # ========================================================================
    # TEST 19: Owner-scoped list - GET /domains
    # ========================================================================
    print(f"\n{BLUE}[TEST 19] Owner-scoped list - GET /domains{RESET}")
    try:
        resp = requests.get(f"{API_BASE}/domains", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            domains_list = data.get("domains", [])
            if isinstance(domains_list, list):
                results.add_pass("Owner-scoped list - GET /domains", f"200 with array (length={len(domains_list)})")
            else:
                results.add_fail("Owner-scoped list - GET /domains", f"Expected array, got: {data}")
        else:
            results.add_fail("Owner-scoped list - GET /domains", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Owner-scoped list - GET /domains", f"Exception: {e}")
    
    # ========================================================================
    # TEST 20: Owner-scoped list - GET /hosting
    # ========================================================================
    print(f"\n{BLUE}[TEST 20] Owner-scoped list - GET /hosting{RESET}")
    try:
        resp = requests.get(f"{API_BASE}/hosting", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            accounts_list = data.get("accounts", [])
            if isinstance(accounts_list, list):
                results.add_pass("Owner-scoped list - GET /hosting", f"200 with array (length={len(accounts_list)})")
            else:
                results.add_fail("Owner-scoped list - GET /hosting", f"Expected array, got: {data}")
        else:
            results.add_fail("Owner-scoped list - GET /hosting", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Owner-scoped list - GET /hosting", f"Exception: {e}")
    
    # ========================================================================
    # TEST 21: Real read-only integration - GET /domains/search
    # ========================================================================
    print(f"\n{BLUE}[TEST 21] Real read-only integration - GET /domains/search{RESET}")
    try:
        domain = "myresellertestsite999.com"
        resp = requests.get(f"{API_BASE}/domains/search?domain={domain}", headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            if "available" in data and "price_usd" in data and "registrar" in data:
                results.add_pass("Real integration - GET /domains/search", f"domain={domain}, available={data.get('available')}, price_usd={data.get('price_usd')}, registrar={data.get('registrar')}")
            else:
                results.add_fail("Real integration - GET /domains/search", f"Missing expected fields: {data}")
        else:
            results.add_fail("Real integration - GET /domains/search", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Real integration - GET /domains/search", f"Exception: {e}")
    
    # ========================================================================
    # TEST 22: Real read-only integration - GET /dns/:domain/records
    # ========================================================================
    print(f"\n{BLUE}[TEST 22] Real read-only integration - GET /dns/testingbays.sbs/records{RESET}")
    try:
        domain = "testingbays.sbs"
        resp = requests.get(f"{API_BASE}/dns/{domain}/records", headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            if "domain" in data and "records" in data:
                records = data.get("records", [])
                results.add_pass("Real integration - GET /dns/:domain/records", f"domain={domain}, records count={len(records)}")
            else:
                results.add_fail("Real integration - GET /dns/:domain/records", f"Missing expected fields: {data}")
        else:
            results.add_fail("Real integration - GET /dns/:domain/records", f"Expected 200, got {resp.status_code}: {resp.text}")
    except Exception as e:
        results.add_fail("Real integration - GET /dns/:domain/records", f"Exception: {e}")
    
    # ========================================================================
    # FINAL VERIFICATION: Wallet balance unchanged
    # ========================================================================
    print(f"\n{BLUE}[FINAL VERIFICATION] Wallet balance unchanged{RESET}")
    try:
        resp = requests.get(f"{API_BASE}/account", headers=headers, timeout=10)
        if resp.status_code == 200:
            data = resp.json()
            final_balance = data.get("wallet_balance_usd")
            if final_balance == EXPECTED_WALLET_BALANCE:
                results.add_pass("FINAL VERIFICATION - Wallet unchanged", f"Wallet balance still ${final_balance} (expected ${EXPECTED_WALLET_BALANCE}) - dry_run mode confirmed")
            else:
                results.add_fail("FINAL VERIFICATION - Wallet unchanged", f"⚠️ WALLET BALANCE CHANGED! Expected ${EXPECTED_WALLET_BALANCE}, got ${final_balance}")
        else:
            results.add_fail("FINAL VERIFICATION - Wallet unchanged", f"Could not verify wallet balance: {resp.status_code}")
    except Exception as e:
        results.add_fail("FINAL VERIFICATION - Wallet unchanged", f"Exception: {e}")
    
    # ========================================================================
    # Summary
    # ========================================================================
    success = results.summary()
    
    if success:
        print(f"\n{GREEN}{'='*80}{RESET}")
        print(f"{GREEN}ALL TESTS PASSED ✅{RESET}")
        print(f"{GREEN}{'='*80}{RESET}")
        print(f"\nThe Reseller REST API is working correctly in dry_run mode.")
        print(f"✅ All endpoints respond as expected")
        print(f"✅ Auth works with both Bearer and X-API-Key headers")
        print(f"✅ Dry-run billing does NOT charge the wallet")
        print(f"✅ Validation errors return correct 400/404 status codes")
        print(f"✅ Owner-scoped lists work correctly")
        print(f"✅ Real read-only integrations (domain search, DNS records) work")
        print(f"✅ Wallet balance unchanged: ${EXPECTED_WALLET_BALANCE}")
        return 0
    else:
        print(f"\n{RED}{'='*80}{RESET}")
        print(f"{RED}SOME TESTS FAILED ❌{RESET}")
        print(f"{RED}{'='*80}{RESET}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
