#!/usr/bin/env python3
"""
Comprehensive Backend Test for Reseller API GAP FIXES (2026-09-25)

This test suite verifies all GAP fixes on the Node/Express reseller router:
- GAP5: GET /domains - nameservers enrichment from registeredDomains
- GAP4: GET /hosting/gapacct2 - suspended_reason, auto_renew_last_error, suspended_at, auto_renew_last_attempt_at
- GAP7: GET /hosting/gapacct1 - suspended override from WHM stub
- GAP6: DELETE /hosting/gapacct2 - honest dry_run (no fake terminated:true)
- GAP2: POST /dns/zone-a.example/records - apex/name normalization
- CHANGE-PRIMARY: POST /hosting/:user/change-primary - new endpoint with validation
- Auth/negative tests

Environment: DEV SANDBOX (SKIP_WEBHOOK_SYNC=true, isLive()=false)
All mutating calls return {"mode":"dry_run", ...}
"""

import requests
import json
import sys
from typing import Dict, Any, List, Tuple

# Configuration
# Using local Node.js server directly (FastAPI proxy has routing issues)
BASE_URL = "http://127.0.0.1:5000/reseller/v1"
API_KEY = "nmdly_test_reseller_gapfix"
HEADERS = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json"
}
HEADERS_BEARER = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

# Test results tracking
test_results = []
total_tests = 0
passed_tests = 0
failed_tests = 0


def log_test(test_name: str, passed: bool, details: str = "", response_data: Any = None):
    """Log test result"""
    global total_tests, passed_tests, failed_tests
    total_tests += 1
    if passed:
        passed_tests += 1
        status = "✅ PASS"
    else:
        failed_tests += 1
        status = "❌ FAIL"
    
    result = {
        "test": test_name,
        "status": status,
        "details": details,
        "response": response_data
    }
    test_results.append(result)
    print(f"{status}: {test_name}")
    if details:
        print(f"  → {details}")
    if not passed and response_data:
        print(f"  → Response: {json.dumps(response_data, indent=2)}")


def test_gap5_domains_nameservers():
    """GAP5: GET /domains - nameservers enrichment from registeredDomains"""
    print("\n" + "="*80)
    print("★★★ GAP5: GET /domains - Nameservers Enrichment ★★★")
    print("="*80)
    
    try:
        response = requests.get(f"{BASE_URL}/domains", headers=HEADERS, timeout=10)
        data = response.json()
        
        # Test 1: HTTP 200
        log_test(
            "GAP5.1: GET /domains returns 200",
            response.status_code == 200,
            f"Status: {response.status_code}",
            data if response.status_code != 200 else None
        )
        
        if response.status_code == 200:
            # Test 2: Find zone-a.example
            domains = data.get("domains", [])
            zone_a = None
            for domain in domains:
                if domain.get("domain") == "zone-a.example":
                    zone_a = domain
                    break
            
            log_test(
                "GAP5.2: zone-a.example found in domains list",
                zone_a is not None,
                f"Found: {zone_a is not None}",
                {"domains_count": len(domains), "zone_a": zone_a}
            )
            
            if zone_a:
                # Test 3: Nameservers field exists
                has_ns = "nameservers" in zone_a
                log_test(
                    "GAP5.3: zone-a.example has nameservers field",
                    has_ns,
                    f"Has nameservers: {has_ns}",
                    zone_a
                )
                
                # Test 4: Nameservers are enriched from registeredDomains
                ns = zone_a.get("nameservers", [])
                expected_ns = ["x.ns.cloudflare.com", "y.ns.cloudflare.com"]
                ns_match = set(ns) == set(expected_ns)
                log_test(
                    "GAP5.4: nameservers = [x.ns.cloudflare.com, y.ns.cloudflare.com]",
                    ns_match,
                    f"Expected: {expected_ns}, Got: {ns}",
                    zone_a
                )
    except Exception as e:
        log_test("GAP5: GET /domains", False, f"Exception: {str(e)}")


def test_gap4_hosting_gapacct2_details():
    """GAP4: GET /hosting/gapacct2 - suspended_reason, auto_renew_last_error, suspended_at, auto_renew_last_attempt_at"""
    print("\n" + "="*80)
    print("★★★ GAP4: GET /hosting/gapacct2 - Suspension Details ★★★")
    print("="*80)
    
    try:
        response = requests.get(f"{BASE_URL}/hosting/gapacct2", headers=HEADERS, timeout=10)
        data = response.json()
        
        # Test 1: HTTP 200
        log_test(
            "GAP4.1: GET /hosting/gapacct2 returns 200",
            response.status_code == 200,
            f"Status: {response.status_code}",
            data if response.status_code != 200 else None
        )
        
        if response.status_code == 200:
            # Test 2: suspended_reason field
            has_suspended_reason = "suspended_reason" in data
            suspended_reason = data.get("suspended_reason")
            log_test(
                "GAP4.2: suspended_reason field present",
                has_suspended_reason and suspended_reason is not None,
                f"suspended_reason: {suspended_reason}",
                data
            )
            
            # Test 3: suspended_reason value
            log_test(
                "GAP4.3: suspended_reason == 'auto_renew_insufficient_funds'",
                suspended_reason == "auto_renew_insufficient_funds",
                f"Expected: 'auto_renew_insufficient_funds', Got: {suspended_reason}",
                data
            )
            
            # Test 4: auto_renew_last_error field
            has_auto_renew_error = "auto_renew_last_error" in data
            auto_renew_error = data.get("auto_renew_last_error")
            log_test(
                "GAP4.4: auto_renew_last_error field present",
                has_auto_renew_error and auto_renew_error is not None,
                f"auto_renew_last_error: {auto_renew_error}",
                data
            )
            
            # Test 5: auto_renew_last_error value
            log_test(
                "GAP4.5: auto_renew_last_error == 'insufficient_funds'",
                auto_renew_error == "insufficient_funds",
                f"Expected: 'insufficient_funds', Got: {auto_renew_error}",
                data
            )
            
            # Test 6: suspended_at field (ISO date)
            has_suspended_at = "suspended_at" in data
            suspended_at = data.get("suspended_at")
            log_test(
                "GAP4.6: suspended_at field present (ISO date)",
                has_suspended_at and suspended_at is not None and isinstance(suspended_at, str),
                f"suspended_at: {suspended_at}",
                data
            )
            
            # Test 7: auto_renew_last_attempt_at field (ISO date)
            has_attempt_at = "auto_renew_last_attempt_at" in data
            attempt_at = data.get("auto_renew_last_attempt_at")
            log_test(
                "GAP4.7: auto_renew_last_attempt_at field present (ISO date)",
                has_attempt_at and attempt_at is not None and isinstance(attempt_at, str),
                f"auto_renew_last_attempt_at: {attempt_at}",
                data
            )
    except Exception as e:
        log_test("GAP4: GET /hosting/gapacct2", False, f"Exception: {str(e)}")


def test_gap7_hosting_gapacct1_suspended_override():
    """GAP7: GET /hosting/gapacct1 - suspended override from WHM stub"""
    print("\n" + "="*80)
    print("★★★ GAP7: GET /hosting/gapacct1 - Suspended Override ★★★")
    print("="*80)
    
    try:
        # Test 1: GET /hosting/gapacct1
        response = requests.get(f"{BASE_URL}/hosting/gapacct1", headers=HEADERS, timeout=10)
        data = response.json()
        
        log_test(
            "GAP7.1: GET /hosting/gapacct1 returns 200",
            response.status_code == 200,
            f"Status: {response.status_code}",
            data if response.status_code != 200 else None
        )
        
        if response.status_code == 200:
            # Test 2: suspended field is true (WHM override)
            suspended = data.get("suspended")
            log_test(
                "GAP7.2: suspended == true (WHM stub overrides DB false)",
                suspended is True,
                f"Expected: true, Got: {suspended}",
                data
            )
        
        # Test 3: GET /hosting?usage=true - gapacct1 also shows suspended:true
        response_list = requests.get(f"{BASE_URL}/hosting?usage=true", headers=HEADERS, timeout=10)
        data_list = response_list.json()
        
        log_test(
            "GAP7.3: GET /hosting?usage=true returns 200",
            response_list.status_code == 200,
            f"Status: {response_list.status_code}",
            data_list if response_list.status_code != 200 else None
        )
        
        if response_list.status_code == 200:
            # Find gapacct1 in list
            accounts = data_list.get("accounts", [])
            gapacct1 = None
            for account in accounts:
                if account.get("user") == "gapacct1" or account.get("username") == "gapacct1":
                    gapacct1 = account
                    break
            
            log_test(
                "GAP7.4: gapacct1 found in hosting list",
                gapacct1 is not None,
                f"Found: {gapacct1 is not None}",
                {"accounts_count": len(accounts), "gapacct1": gapacct1}
            )
            
            if gapacct1:
                suspended_in_list = gapacct1.get("suspended")
                log_test(
                    "GAP7.5: gapacct1 suspended == true in list",
                    suspended_in_list is True,
                    f"Expected: true, Got: {suspended_in_list}",
                    gapacct1
                )
    except Exception as e:
        log_test("GAP7: GET /hosting/gapacct1", False, f"Exception: {str(e)}")


def test_gap6_delete_hosting_honest_dryrun():
    """GAP6: DELETE /hosting/gapacct2 - honest dry_run (no fake terminated:true)"""
    print("\n" + "="*80)
    print("★★★ GAP6: DELETE /hosting/gapacct2 - Honest Dry-Run ★★★")
    print("="*80)
    
    try:
        response = requests.delete(f"{BASE_URL}/hosting/gapacct2", headers=HEADERS, timeout=10)
        data = response.json()
        
        # Test 1: HTTP 200
        log_test(
            "GAP6.1: DELETE /hosting/gapacct2 returns 200",
            response.status_code == 200,
            f"Status: {response.status_code}",
            data if response.status_code != 200 else None
        )
        
        if response.status_code == 200:
            # Test 2: mode == "dry_run"
            mode = data.get("mode")
            log_test(
                "GAP6.2: mode == 'dry_run'",
                mode == "dry_run",
                f"Expected: 'dry_run', Got: {mode}",
                data
            )
            
            # Test 3: MUST NOT contain terminated:true (no fake success)
            has_terminated = "terminated" in data
            terminated = data.get("terminated")
            log_test(
                "GAP6.3: MUST NOT contain terminated:true (honest dry-run)",
                not (has_terminated and terminated is True),
                f"terminated field: {terminated if has_terminated else 'not present'}",
                data
            )
    except Exception as e:
        log_test("GAP6: DELETE /hosting/gapacct2", False, f"Exception: {str(e)}")


def test_gap2_dns_apex_name_normalization():
    """GAP2: POST /dns/zone-a.example/records - apex/name normalization"""
    print("\n" + "="*80)
    print("★★★ GAP2: POST /dns/zone-a.example/records - Apex/Name Normalization ★★★")
    print("="*80)
    
    # Test 1: @ → zone-a.example (NOT @.zone-a.example)
    try:
        payload = {"type": "A", "name": "@", "value": "1.2.3.4"}
        response = requests.post(
            f"{BASE_URL}/dns/zone-a.example/records",
            headers=HEADERS,
            json=payload,
            timeout=10
        )
        data = response.json()
        
        log_test(
            "GAP2.1: POST /dns/zone-a.example/records (name='@') returns 200",
            response.status_code == 200,
            f"Status: {response.status_code}",
            data if response.status_code != 200 else None
        )
        
        if response.status_code == 200:
            detail = data.get("detail", {})
            record_name = detail.get("name")
            log_test(
                "GAP2.2: name='@' → detail.name == 'zone-a.example' (NOT '@.zone-a.example')",
                record_name == "zone-a.example",
                f"Expected: 'zone-a.example', Got: {record_name}",
                data
            )
    except Exception as e:
        log_test("GAP2.1-2: POST /dns (name='@')", False, f"Exception: {str(e)}")
    
    # Test 2: zone-a.example → zone-a.example (NOT zone-a.example.zone-a.example)
    try:
        payload = {"type": "A", "name": "zone-a.example", "value": "1.2.3.4"}
        response = requests.post(
            f"{BASE_URL}/dns/zone-a.example/records",
            headers=HEADERS,
            json=payload,
            timeout=10
        )
        data = response.json()
        
        log_test(
            "GAP2.3: POST /dns/zone-a.example/records (name='zone-a.example') returns 200",
            response.status_code == 200,
            f"Status: {response.status_code}",
            data if response.status_code != 200 else None
        )
        
        if response.status_code == 200:
            detail = data.get("detail", {})
            record_name = detail.get("name")
            log_test(
                "GAP2.4: name='zone-a.example' → detail.name == 'zone-a.example' (NOT double-appended)",
                record_name == "zone-a.example",
                f"Expected: 'zone-a.example', Got: {record_name}",
                data
            )
    except Exception as e:
        log_test("GAP2.3-4: POST /dns (name='zone-a.example')", False, f"Exception: {str(e)}")
    
    # Test 3: www → www.zone-a.example
    try:
        payload = {"type": "A", "name": "www", "value": "1.2.3.4"}
        response = requests.post(
            f"{BASE_URL}/dns/zone-a.example/records",
            headers=HEADERS,
            json=payload,
            timeout=10
        )
        data = response.json()
        
        log_test(
            "GAP2.5: POST /dns/zone-a.example/records (name='www') returns 200",
            response.status_code == 200,
            f"Status: {response.status_code}",
            data if response.status_code != 200 else None
        )
        
        if response.status_code == 200:
            detail = data.get("detail", {})
            record_name = detail.get("name")
            log_test(
                "GAP2.6: name='www' → detail.name == 'www.zone-a.example'",
                record_name == "www.zone-a.example",
                f"Expected: 'www.zone-a.example', Got: {record_name}",
                data
            )
    except Exception as e:
        log_test("GAP2.5-6: POST /dns (name='www')", False, f"Exception: {str(e)}")


def test_change_primary_endpoint():
    """CHANGE-PRIMARY: POST /hosting/:user/change-primary - new endpoint with validation"""
    print("\n" + "="*80)
    print("★★★ CHANGE-PRIMARY: POST /hosting/:user/change-primary ★★★")
    print("="*80)
    
    # Test 1: Valid domain (not current primary) → dry_run
    try:
        payload = {"domain": "newprimary.example"}
        response = requests.post(
            f"{BASE_URL}/hosting/gapacct1/change-primary",
            headers=HEADERS,
            json=payload,
            timeout=10
        )
        data = response.json()
        
        log_test(
            "CHANGE-PRIMARY.1: POST /hosting/gapacct1/change-primary (valid domain) returns 200",
            response.status_code == 200,
            f"Status: {response.status_code}",
            data if response.status_code != 200 else None
        )
        
        if response.status_code == 200:
            # Test 2: mode == "dry_run"
            mode = data.get("mode")
            log_test(
                "CHANGE-PRIMARY.2: mode == 'dry_run'",
                mode == "dry_run",
                f"Expected: 'dry_run', Got: {mode}",
                data
            )
            
            # Test 3: from == "primary-a.example"
            from_domain = data.get("from")
            log_test(
                "CHANGE-PRIMARY.3: from == 'primary-a.example'",
                from_domain == "primary-a.example",
                f"Expected: 'primary-a.example', Got: {from_domain}",
                data
            )
            
            # Test 4: to == "newprimary.example"
            to_domain = data.get("to")
            log_test(
                "CHANGE-PRIMARY.4: to == 'newprimary.example'",
                to_domain == "newprimary.example",
                f"Expected: 'newprimary.example', Got: {to_domain}",
                data
            )
    except Exception as e:
        log_test("CHANGE-PRIMARY.1-4: Valid domain", False, f"Exception: {str(e)}")
    
    # Test 5: Already primary → 400 already_primary
    try:
        payload = {"domain": "primary-a.example"}
        response = requests.post(
            f"{BASE_URL}/hosting/gapacct1/change-primary",
            headers=HEADERS,
            json=payload,
            timeout=10
        )
        data = response.json()
        
        log_test(
            "CHANGE-PRIMARY.5: POST /hosting/gapacct1/change-primary (already primary) returns 400",
            response.status_code == 400,
            f"Status: {response.status_code}",
            data if response.status_code != 400 else None
        )
        
        if response.status_code == 400:
            error = data.get("error")
            log_test(
                "CHANGE-PRIMARY.6: error == 'already_primary'",
                error == "already_primary",
                f"Expected: 'already_primary', Got: {error}",
                data
            )
    except Exception as e:
        log_test("CHANGE-PRIMARY.5-6: Already primary", False, f"Exception: {str(e)}")
    
    # Test 7: Invalid domain → 400 invalid_domain
    try:
        payload = {"domain": "notadomain"}
        response = requests.post(
            f"{BASE_URL}/hosting/gapacct1/change-primary",
            headers=HEADERS,
            json=payload,
            timeout=10
        )
        data = response.json()
        
        log_test(
            "CHANGE-PRIMARY.7: POST /hosting/gapacct1/change-primary (invalid domain) returns 400",
            response.status_code == 400,
            f"Status: {response.status_code}",
            data if response.status_code != 400 else None
        )
        
        if response.status_code == 400:
            error = data.get("error")
            log_test(
                "CHANGE-PRIMARY.8: error == 'invalid_domain'",
                error == "invalid_domain",
                f"Expected: 'invalid_domain', Got: {error}",
                data
            )
    except Exception as e:
        log_test("CHANGE-PRIMARY.7-8: Invalid domain", False, f"Exception: {str(e)}")


def test_auth_negative():
    """Auth/negative tests"""
    print("\n" + "="*80)
    print("★★★ AUTH/NEGATIVE TESTS ★★★")
    print("="*80)
    
    # Test 1: No API key → 401 missing_api_key
    try:
        response = requests.get(f"{BASE_URL}/domains", timeout=10)
        data = response.json()
        
        log_test(
            "AUTH.1: GET /domains (no API key) returns 401",
            response.status_code == 401,
            f"Status: {response.status_code}",
            data if response.status_code != 401 else None
        )
        
        if response.status_code == 401:
            error = data.get("error")
            log_test(
                "AUTH.2: error == 'missing_api_key'",
                error == "missing_api_key",
                f"Expected: 'missing_api_key', Got: {error}",
                data
            )
    except Exception as e:
        log_test("AUTH.1-2: No API key", False, f"Exception: {str(e)}")
    
    # Test 2: Non-existent account → 404 not_found
    try:
        response = requests.get(f"{BASE_URL}/hosting/does-not-exist", headers=HEADERS, timeout=10)
        data = response.json()
        
        log_test(
            "AUTH.3: GET /hosting/does-not-exist returns 404",
            response.status_code == 404,
            f"Status: {response.status_code}",
            data if response.status_code != 404 else None
        )
        
        if response.status_code == 404:
            error = data.get("error")
            log_test(
                "AUTH.4: error == 'not_found'",
                error == "not_found",
                f"Expected: 'not_found', Got: {error}",
                data
            )
    except Exception as e:
        log_test("AUTH.3-4: Non-existent account", False, f"Exception: {str(e)}")
    
    # Test 3: Bearer auth header works
    try:
        response = requests.get(f"{BASE_URL}/domains", headers=HEADERS_BEARER, timeout=10)
        
        log_test(
            "AUTH.5: GET /domains with Authorization: Bearer header returns 200",
            response.status_code == 200,
            f"Status: {response.status_code}",
            None
        )
    except Exception as e:
        log_test("AUTH.5: Bearer auth", False, f"Exception: {str(e)}")


def print_summary():
    """Print test summary"""
    print("\n" + "="*80)
    print("★★★ TEST SUMMARY ★★★")
    print("="*80)
    print(f"Total Tests: {total_tests}")
    print(f"Passed: {passed_tests} ({passed_tests/total_tests*100:.1f}%)")
    print(f"Failed: {failed_tests} ({failed_tests/total_tests*100:.1f}%)")
    print("="*80)
    
    if failed_tests > 0:
        print("\n❌ FAILED TESTS:")
        for result in test_results:
            if "❌" in result["status"]:
                print(f"  - {result['test']}: {result['details']}")
    
    print("\n" + "="*80)
    print("★★★ DETAILED RESULTS BY GAP ★★★")
    print("="*80)
    
    # Group by GAP
    gaps = {
        "GAP5": [],
        "GAP4": [],
        "GAP7": [],
        "GAP6": [],
        "GAP2": [],
        "CHANGE-PRIMARY": [],
        "AUTH": []
    }
    
    for result in test_results:
        for gap in gaps.keys():
            if result["test"].startswith(gap):
                gaps[gap].append(result)
                break
    
    for gap, results in gaps.items():
        if results:
            passed = sum(1 for r in results if "✅" in r["status"])
            total = len(results)
            print(f"\n{gap}: {passed}/{total} tests passed")
            for result in results:
                print(f"  {result['status']}: {result['test']}")


def main():
    """Run all tests"""
    print("="*80)
    print("RESELLER API GAP FIXES - COMPREHENSIVE BACKEND TEST")
    print("="*80)
    print(f"Base URL: {BASE_URL}")
    print(f"API Key: {API_KEY}")
    print(f"Environment: DEV SANDBOX (dry_run mode)")
    print("="*80)
    
    # Run all test groups
    test_gap5_domains_nameservers()
    test_gap4_hosting_gapacct2_details()
    test_gap7_hosting_gapacct1_suspended_override()
    test_gap6_delete_hosting_honest_dryrun()
    test_gap2_dns_apex_name_normalization()
    test_change_primary_endpoint()
    test_auth_negative()
    
    # Print summary
    print_summary()
    
    # Exit with appropriate code
    sys.exit(0 if failed_tests == 0 else 1)


if __name__ == "__main__":
    main()
