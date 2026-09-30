#!/usr/bin/env python3
"""
Bulk IVR Security Fix Testing - Simplified Output
"""
import requests
import json
import pymongo
from pymongo import MongoClient
import subprocess

# MongoDB connection from review request
MONGO_CONNECTION_STRING = "mongodb://localhost:27017"
DATABASE_NAME = "test"
BACKEND_URL = "http://localhost:5000"

def run_security_tests():
    results = []
    
    # Test 1: Node.js health
    try:
        response = requests.get(f"{BACKEND_URL}/health", timeout=10)
        if response.status_code == 200:
            result = subprocess.run(['wc', '-c', '/var/log/supervisor/nodejs.err.log'], 
                                  capture_output=True, text=True)
            if "0 " in result.stdout:
                results.append("✅ Node.js Health: PASS")
            else:
                results.append("❌ Node.js Health: FAIL - errors in log")
        else:
            results.append("❌ Node.js Health: FAIL - bad status code")
    except Exception as e:
        results.append(f"❌ Node.js Health: FAIL - {e}")
    
    # Test 2: Verified caller IDs removal
    try:
        with open('/app/js/_index.js', 'r') as f:
            content = f.read()
        
        if ("Verified caller IDs from the main Twilio account are NOT exposed to users" in content and 
            "twilioClient.outgoingCallerIds.list()" not in content and 
            "const allCallerIds = [...bulkCapableNumbers]" in content):
            results.append("✅ Verified Caller IDs Removal: PASS")
        else:
            results.append("❌ Verified Caller IDs Removal: FAIL")
    except Exception as e:
        results.append(f"❌ Verified Caller IDs Removal: FAIL - {e}")
    
    # Test 3: Sub-account enforcement
    try:
        with open('/app/js/bulk-call-service.js', 'r') as f:
            content = f.read()
        
        if ("if (!campaign.twilioSubAccountSid)" in content and 
            "status: 'cancelled'" in content and
            "Campaign Blocked" in content):
            results.append("✅ Sub-account Enforcement: PASS")
        else:
            results.append("❌ Sub-account Enforcement: FAIL")
    except Exception as e:
        results.append(f"❌ Sub-account Enforcement: FAIL - {e}")
    
    # Test 4: MongoDB running campaigns
    try:
        client = MongoClient(MONGO_CONNECTION_STRING)
        db = client[DATABASE_NAME]
        collection = db['bulkCallCampaigns']
        running_campaigns = list(collection.find({"status": "running"}))
        
        if len(running_campaigns) == 0:
            results.append("✅ MongoDB Running Campaigns: PASS (0 found)")
        else:
            results.append(f"❌ MongoDB Running Campaigns: FAIL ({len(running_campaigns)} found)")
        client.close()
    except Exception as e:
        results.append(f"❌ MongoDB Running Campaigns: FAIL - {e}")
    
    # Test 5: @wizardchop wallet
    try:
        client = MongoClient(MONGO_CONNECTION_STRING)
        db = client[DATABASE_NAME]
        collection = db['walletOf']
        wallet = collection.find_one({"_id": 1167900472})
        
        if wallet and 'usdOut' in wallet:
            usd_in = wallet.get('usdIn', 0)
            usd_out = wallet.get('usdOut', 0)
            balance = usd_in - usd_out
            
            if balance < 0:
                results.append(f"✅ @wizardchop Wallet: PASS (balance: ${balance:.2f})")
            else:
                results.append(f"❌ @wizardchop Wallet: FAIL (balance: ${balance:.2f})")
        else:
            results.append("❌ @wizardchop Wallet: FAIL - wallet not found or invalid structure")
        client.close()
    except Exception as e:
        results.append(f"❌ @wizardchop Wallet: FAIL - {e}")
    
    # Test 6: Campaign termination
    try:
        client = MongoClient(MONGO_CONNECTION_STRING)
        db = client[DATABASE_NAME]
        collection = db['bulkCallCampaigns']
        campaign = collection.find_one({"id": "028eb7bb-a186-4e04-bf55-d0bc4fecd8fb"})
        
        if campaign and campaign.get('status') == 'cancelled':
            results.append("✅ Campaign Termination: PASS (status: cancelled)")
        else:
            results.append("❌ Campaign Termination: FAIL")
        client.close()
    except Exception as e:
        results.append(f"❌ Campaign Termination: FAIL - {e}")
    
    # Print results
    print("=" * 60)
    print("BULK IVR SECURITY FIX TEST RESULTS")
    print("=" * 60)
    
    passed = 0
    for result in results:
        print(result)
        if result.startswith("✅"):
            passed += 1
    
    print("=" * 60)
    print(f"OVERALL: {passed}/{len(results)} tests passed")
    
    return passed == len(results)

if __name__ == "__main__":
    success = run_security_tests()
    exit(0 if success else 1)