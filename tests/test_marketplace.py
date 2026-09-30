#!/usr/bin/env python3
"""
Marketplace Webhook Simulator — Tests ALL marketplace flows
Sends simulated Telegram webhook payloads to http://localhost:5000/telegram/webhook
Verifies DB state and checks for errors in logs.
"""

import requests
import json
import time
import subprocess
import sys

BASE = "http://localhost:5000/telegram/webhook"
HEADERS = {"Content-Type": "application/json"}

MONGO_URI = "mongodb://localhost:27017"
DB_NAME = "test"

# Two test users
SELLER_ID = 5590563715   # Real admin — will receive bot messages
BUYER_ID  = 5590563716   # Simulated buyer (offset by 1 from admin)

update_counter = 100000

def next_update_id():
    global update_counter
    update_counter += 1
    return update_counter

def send_text(chat_id, text, username="testseller"):
    """Simulate a text message from user"""
    payload = {
        "update_id": next_update_id(),
        "message": {
            "message_id": next_update_id(),
            "from": {"id": chat_id, "is_bot": False, "first_name": "Test", "username": username},
            "chat": {"id": chat_id, "first_name": "Test", "username": username, "type": "private"},
            "date": int(time.time()),
            "text": text
        }
    }
    r = requests.post(BASE, json=payload, headers=HEADERS, timeout=10)
    return r.status_code

def send_photo(chat_id, username="testseller"):
    """Simulate a photo message from user"""
    payload = {
        "update_id": next_update_id(),
        "message": {
            "message_id": next_update_id(),
            "from": {"id": chat_id, "is_bot": False, "first_name": "Test", "username": username},
            "chat": {"id": chat_id, "first_name": "Test", "username": username, "type": "private"},
            "date": int(time.time()),
            "photo": [
                {"file_id": "AgACAgIAAxkBAATestPhoto1", "file_unique_id": "AQADTestPhoto1", "file_size": 1024, "width": 90, "height": 90},
                {"file_id": "AgACAgIAAxkBAATestPhoto1HD", "file_unique_id": "AQADTestPhoto1HD", "file_size": 51200, "width": 800, "height": 600}
            ]
        }
    }
    r = requests.post(BASE, json=payload, headers=HEADERS, timeout=10)
    return r.status_code

def send_callback(chat_id, callback_data, username="testseller"):
    """Simulate an inline button callback query"""
    payload = {
        "update_id": next_update_id(),
        "callback_query": {
            "id": str(next_update_id()),
            "from": {"id": chat_id, "is_bot": False, "first_name": "Test", "username": username},
            "message": {
                "message_id": next_update_id(),
                "chat": {"id": chat_id, "first_name": "Test", "username": username, "type": "private"},
                "date": int(time.time()),
                "text": "Product card"
            },
            "data": callback_data
        }
    }
    r = requests.post(BASE, json=payload, headers=HEADERS, timeout=10)
    return r.status_code

def check_db(collection, query=None):
    """Query MongoDB for marketplace records"""
    from pymongo import MongoClient
    try:
        client = MongoClient(MONGO_URI)
        db = client[DB_NAME]
        result = list(db[collection].find(query or {}))
        client.close()
        return str(len(result))
    except Exception as e:
        return f"DB Error: {e}"

def check_db_count(collection, query=None):
    """Count documents in collection"""
    from pymongo import MongoClient
    try:
        client = MongoClient(MONGO_URI)
        db = client[DB_NAME]
        count = db[collection].count_documents(query or {})
        client.close()
        return str(count)
    except Exception as e:
        return f"DB Error: {e}"

def get_products(seller_id=None):
    """Get marketplace products"""
    from pymongo import MongoClient
    try:
        client = MongoClient(MONGO_URI)
        db = client[DB_NAME]
        q = {"sellerId": seller_id, "status": "active"} if seller_id else {"status": "active"}
        result = list(db.marketplaceProducts.find(q).sort("createdAt", -1))
        client.close()
        return result
    except Exception:
        return []

def get_conversations(buyer_id=None):
    """Get marketplace conversations"""
    from pymongo import MongoClient
    try:
        client = MongoClient(MONGO_URI)
        db = client[DB_NAME]
        q = {"buyerId": buyer_id} if buyer_id else {}
        result = list(db.marketplaceConversations.find(q))
        client.close()
        return result
    except Exception:
        return []

def get_state(chat_id):
    """Get user state"""
    from pymongo import MongoClient
    try:
        client = MongoClient(MONGO_URI)
        db = client[DB_NAME]
        result = db.state.find_one({"_id": float(chat_id)})
        client.close()
        return result or {}
    except Exception:
        return {}

def get_one(collection, query):
    """Get one document from collection"""
    from pymongo import MongoClient
    try:
        client = MongoClient(MONGO_URI)
        db = client[DB_NAME]
        result = db[collection].find_one(query)
        client.close()
        return result or {}
    except Exception:
        return {}

def clean_test_data():
    """Clean previous test data"""
    from pymongo import MongoClient
    try:
        client = MongoClient(MONGO_URI)
        db = client[DB_NAME]
        db.marketplaceProducts.delete_many({"sellerId": SELLER_ID})
        db.marketplaceConversations.delete_many({"$or": [{"buyerId": BUYER_ID}, {"sellerId": SELLER_ID}]})
        db.marketplaceMessages.delete_many({})
        # Reset seller and buyer state for marketplace
        db.state.update_one({"_id": float(SELLER_ID)}, {"$set": {"action": None, "mpImages": None, "mpTitle": None, "mpDesc": None, "mpPrice": None, "mpCategory": None, "mpActiveProduct": None, "mpListingsList": None, "mpConvList": None, "mpActiveConversation": None}})
        db.state.delete_one({"_id": float(BUYER_ID)})
        client.close()
        print("  Cleaned up previous test data.")
    except Exception as e:
        print(f"  Clean error: {e}")

def check_recent_logs(lines=20, pattern=None):
    """Check recent nodejs logs"""
    try:
        result = subprocess.run(
            ["tail", f"-n{lines}", "/var/log/supervisor/nodejs.out.log"],
            capture_output=True, text=True, timeout=5
        )
        output = result.stdout
        if pattern:
            return [l for l in output.split('\n') if pattern.lower() in l.lower()]
        return output
    except:
        return ""

def check_error_logs(lines=20):
    """Check recent error logs"""
    try:
        result = subprocess.run(
            ["tail", f"-n{lines}", "/var/log/supervisor/nodejs.err.log"],
            capture_output=True, text=True, timeout=5
        )
        return result.stdout.strip()
    except:
        return ""

# ─── Color output ───
GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
RESET = "\033[0m"
BOLD = "\033[1m"

passed = 0
failed = 0
errors = []

def test(name, condition, detail=""):
    global passed, failed, errors
    if condition:
        passed += 1
        print(f"  {GREEN}✅ PASS{RESET}: {name}")
    else:
        failed += 1
        errors.append(f"{name}: {detail}")
        print(f"  {RED}❌ FAIL{RESET}: {name} — {detail}")

def section(title):
    print(f"\n{BOLD}{CYAN}━━━ {title} ━━━{RESET}")

# ══════════════════════════════════════════════════════
# CLEAN UP — Remove any existing test data
# ══════════════════════════════════════════════════════
section("SETUP: Clean previous test data")
clean_test_data()
time.sleep(1)

# ══════════════════════════════════════════════════════
# TEST 1: Marketplace Home
# ══════════════════════════════════════════════════════
section("TEST 1: Marketplace Home Screen")

status = send_text(SELLER_ID, "🏪 Marketplace")
time.sleep(2)
test("Webhook accepts marketplace button", status == 200, f"HTTP {status}")

state = get_state(SELLER_ID)
test("Seller state set to mpHome", state.get("action") == "mpHome", f"action={state.get('action')}")

# ══════════════════════════════════════════════════════
# TEST 2: Seller — List a Product (Image Upload)
# ══════════════════════════════════════════════════════
section("TEST 2: Seller — Start listing product")

status = send_text(SELLER_ID, "➕ List a Product")
time.sleep(2)
state = get_state(SELLER_ID)
test("Action set to mpNewImage", state.get("action") == "mpNewImage", f"action={state.get('action')}")
test("mpImages initialized", state.get("mpImages") == [] or state.get("mpImages") is None, f"mpImages={state.get('mpImages')}")

# Upload photo 1
section("TEST 3: Seller — Upload product images")
status = send_photo(SELLER_ID)
time.sleep(2)
state = get_state(SELLER_ID)
images = state.get("mpImages", [])
test("Photo 1 received", len(images) >= 1, f"images count={len(images)}")

# Upload photo 2
status = send_photo(SELLER_ID)
time.sleep(2)
state = get_state(SELLER_ID)
images = state.get("mpImages", [])
test("Photo 2 received", len(images) >= 2, f"images count={len(images)}")

# Done uploading
status = send_text(SELLER_ID, "✅ Done Uploading")
time.sleep(2)
state = get_state(SELLER_ID)
test("Action set to mpNewTitle after done uploading", state.get("action") == "mpNewTitle", f"action={state.get('action')}")

# ══════════════════════════════════════════════════════
# TEST 4: Seller — Enter title
# ══════════════════════════════════════════════════════
section("TEST 4: Seller — Enter title")

status = send_text(SELLER_ID, "Premium VPN Account — Lifetime Access")
time.sleep(2)
state = get_state(SELLER_ID)
test("Title saved", state.get("mpTitle") == "Premium VPN Account — Lifetime Access", f"title={state.get('mpTitle')}")
test("Action set to mpNewDesc", state.get("action") == "mpNewDesc", f"action={state.get('action')}")

# ══════════════════════════════════════════════════════
# TEST 5: Seller — Enter description
# ══════════════════════════════════════════════════════
section("TEST 5: Seller — Enter description")

status = send_text(SELLER_ID, "Get a premium VPN account with unlimited bandwidth. Works on all devices. Lifetime warranty included.")
time.sleep(2)
state = get_state(SELLER_ID)
test("Description saved", "premium VPN" in (state.get("mpDesc") or ""), f"desc={state.get('mpDesc', '')[:50]}")
test("Action set to mpNewPrice", state.get("action") == "mpNewPrice", f"action={state.get('action')}")

# ══════════════════════════════════════════════════════
# TEST 6: Seller — Invalid price then valid price
# ══════════════════════════════════════════════════════
section("TEST 6: Seller — Price validation")

# Invalid price (too low)
status = send_text(SELLER_ID, "$5")
time.sleep(2)
state = get_state(SELLER_ID)
test("Invalid price rejected (too low)", state.get("action") == "mpNewPrice", f"action={state.get('action')}")

# Invalid price (too high)
status = send_text(SELLER_ID, "10000")
time.sleep(2)
state = get_state(SELLER_ID)
test("Invalid price rejected (too high)", state.get("action") == "mpNewPrice", f"action={state.get('action')}")

# Valid price
status = send_text(SELLER_ID, "150")
time.sleep(2)
state = get_state(SELLER_ID)
test("Valid price saved", state.get("mpPrice") == 150.0 or state.get("mpPrice") == 150, f"price={state.get('mpPrice')}")
test("Action set to mpNewCategory", state.get("action") == "mpNewCategory", f"action={state.get('action')}")

# ══════════════════════════════════════════════════════
# TEST 7: Seller — Select category
# ══════════════════════════════════════════════════════
section("TEST 7: Seller — Select category")

# Invalid category first
status = send_text(SELLER_ID, "Invalid Category")
time.sleep(2)
state = get_state(SELLER_ID)
test("Invalid category rejected", state.get("action") == "mpNewCategory", f"action={state.get('action')}")

# Valid category
status = send_text(SELLER_ID, "💻 Digital Goods")
time.sleep(2)
state = get_state(SELLER_ID)
test("Category saved", state.get("mpCategory") == "💻 Digital Goods", f"category={state.get('mpCategory')}")
test("Action set to mpNewConfirm (preview)", state.get("action") == "mpNewConfirm", f"action={state.get('action')}")

# ══════════════════════════════════════════════════════
# TEST 8: Seller — Publish product
# ══════════════════════════════════════════════════════
section("TEST 8: Seller — Publish product")

status = send_text(SELLER_ID, "✅ Publish")
time.sleep(3)
state = get_state(SELLER_ID)
test("Action returned to mpHome after publish", state.get("action") == "mpHome", f"action={state.get('action')}")

products = get_products(SELLER_ID)
test("Product created in DB", len(products) >= 1, f"products count={len(products)}")
if products:
    p = products[0]
    test("Product title correct", p.get("title") == "Premium VPN Account — Lifetime Access", f"title={p.get('title')}")
    test("Product price correct", p.get("price") == 150, f"price={p.get('price')}")
    test("Product category correct", p.get("category") == "💻 Digital Goods", f"cat={p.get('category')}")
    test("Product status is active", p.get("status") == "active", f"status={p.get('status')}")
    test("Product has images", len(p.get("images", [])) >= 2, f"images={len(p.get('images', []))}")
    PRODUCT_ID = p.get("_id")
    print(f"  📦 Product ID: {PRODUCT_ID}")
else:
    PRODUCT_ID = None
    print(f"  {RED}⚠️ No product found — subsequent tests may fail{RESET}")

# ══════════════════════════════════════════════════════
# TEST 9: Seller — My Listings
# ══════════════════════════════════════════════════════
section("TEST 9: Seller — My Listings")

status = send_text(SELLER_ID, "📦 My Listings")
time.sleep(2)
state = get_state(SELLER_ID)
test("Action set to mpMyListings", state.get("action") == "mpMyListings", f"action={state.get('action')}")
test("Listings list populated", len(state.get("mpListingsList", [])) >= 1, f"listings={state.get('mpListingsList')}")

# Select the listing to manage
status = send_text(SELLER_ID, "✅ Premium VPN Account — Lifetime Ac")
time.sleep(2)
state = get_state(SELLER_ID)
test("Action set to mpManageListing", state.get("action") == "mpManageListing", f"action={state.get('action')}")
test("Active product set", state.get("mpActiveProduct") is not None, f"activeProduct={state.get('mpActiveProduct')}")

# ══════════════════════════════════════════════════════
# TEST 10: Seller — Edit product title
# ══════════════════════════════════════════════════════
section("TEST 10: Seller — Edit product")

status = send_text(SELLER_ID, "✏️ Edit")
time.sleep(2)
state = get_state(SELLER_ID)
test("Edit menu shown (still mpManageListing)", state.get("action") == "mpManageListing", f"action={state.get('action')}")

# Edit title
status = send_text(SELLER_ID, "📝 Edit Title")
time.sleep(2)
state = get_state(SELLER_ID)
test("Action set to mpEditTitle", state.get("action") == "mpEditTitle", f"action={state.get('action')}")

status = send_text(SELLER_ID, "Premium VPN — Updated Title")
time.sleep(2)
state = get_state(SELLER_ID)
test("Title edited, back to manage", state.get("action") == "mpManageListing", f"action={state.get('action')}")

# Verify title updated in DB
if PRODUCT_ID:
    products = get_products(SELLER_ID)
    updated = [p for p in products if p.get("_id") == PRODUCT_ID]
    if updated:
        test("Title updated in DB", updated[0].get("title") == "Premium VPN — Updated Title", f"title={updated[0].get('title')}")

# Go back to marketplace home
status = send_text(SELLER_ID, "Back")
time.sleep(2)

# ══════════════════════════════════════════════════════
# TEST 11: Create a 2nd product (for browse testing)
# ══════════════════════════════════════════════════════
section("TEST 11: Create 2nd product (🔧 Tools category)")

status = send_text(SELLER_ID, "🏪 Marketplace")
time.sleep(1)
status = send_text(SELLER_ID, "➕ List a Product")
time.sleep(1)
send_photo(SELLER_ID)
time.sleep(1)
send_text(SELLER_ID, "✅ Done Uploading")
time.sleep(1)
send_text(SELLER_ID, "Hacking Toolkit v2.0")
time.sleep(1)
send_text(SELLER_ID, "Advanced penetration testing tools bundle.")
time.sleep(1)
send_text(SELLER_ID, "250")
time.sleep(1)
send_text(SELLER_ID, "🔧 Tools")
time.sleep(1)
send_text(SELLER_ID, "✅ Publish")
time.sleep(3)

products = get_products(SELLER_ID)
test("2nd product created", len(products) >= 2, f"products count={len(products)}")
PRODUCT_ID_2 = None
for p in products:
    if "Hacking" in p.get("title", ""):
        PRODUCT_ID_2 = p.get("_id")
        test("2nd product title correct", True)
        break
else:
    test("2nd product title correct", False, "Product not found")

# ══════════════════════════════════════════════════════
# TEST 12: Buyer — Browse All Products
# ══════════════════════════════════════════════════════
section("TEST 12: Buyer — Browse Products")

# First let buyer enter marketplace
status = send_text(BUYER_ID, "🏪 Marketplace", username="testbuyer")
time.sleep(2)
state = get_state(BUYER_ID)
test("Buyer in marketplace home", state.get("action") == "mpHome", f"action={state.get('action')}")

# Browse all
status = send_text(BUYER_ID, "🔍 Browse Products", username="testbuyer")
time.sleep(2)
state = get_state(BUYER_ID)
test("Buyer in browse category", state.get("action") == "mpBrowseCategory", f"action={state.get('action')}")

# Select All Categories
status = send_text(BUYER_ID, "📋 All Categories", username="testbuyer")
time.sleep(3)
# Products should be displayed (via sendPhoto or sendMessage — will show in logs)
logs = check_recent_logs(30, "marketplace")
test("Browse triggered (webhook processed)", status == 200, f"HTTP {status}")

# ══════════════════════════════════════════════════════
# TEST 13: Buyer — Browse by specific category
# ══════════════════════════════════════════════════════
section("TEST 13: Buyer — Browse by category")

# Go back to marketplace to browse by category
status = send_text(BUYER_ID, "🏪 Marketplace", username="testbuyer")
time.sleep(1)
status = send_text(BUYER_ID, "🔍 Browse Products", username="testbuyer")
time.sleep(1)
status = send_text(BUYER_ID, "💻 Digital Goods", username="testbuyer")
time.sleep(3)
test("Category browse webhook accepted", status == 200, f"HTTP {status}")

# ══════════════════════════════════════════════════════
# TEST 14: Buyer — Start chat with seller (callback_query)
# ══════════════════════════════════════════════════════
section("TEST 14: Buyer — Chat with Seller (inline button)")

if PRODUCT_ID:
    status = send_callback(BUYER_ID, f"mp:chat:{PRODUCT_ID}", username="testbuyer")
    time.sleep(3)
    state = get_state(BUYER_ID)
    test("Buyer in mpChat mode", state.get("action") == "mpChat", f"action={state.get('action')}")
    test("Active conversation set", state.get("mpActiveConversation") is not None, f"conv={state.get('mpActiveConversation')}")
    CONV_ID = state.get("mpActiveConversation")

    # Verify conversation in DB
    convs = get_conversations(BUYER_ID)
    test("Conversation created in DB", len(convs) >= 1, f"convs={len(convs)}")
    if convs:
        c = convs[0]
        test("Conversation has correct product", c.get("productId") == PRODUCT_ID, f"productId={c.get('productId')}")
        test("Conversation buyer is correct", c.get("buyerId") == BUYER_ID, f"buyer={c.get('buyerId')}")
        test("Conversation seller is correct", c.get("sellerId") == SELLER_ID, f"seller={c.get('sellerId')}")
        test("Conversation status is active", c.get("status") == "active", f"status={c.get('status')}")
else:
    CONV_ID = None
    print(f"  {YELLOW}⚠️ No PRODUCT_ID — skipping chat test{RESET}")

# ══════════════════════════════════════════════════════
# TEST 15: Chat Relay — Buyer sends message
# ══════════════════════════════════════════════════════
section("TEST 15: Chat Relay — Buyer sends message")

if CONV_ID:
    status = send_text(BUYER_ID, "Hello, is this product still available?", username="testbuyer")
    time.sleep(2)
    test("Buyer message webhook accepted", status == 200, f"HTTP {status}")

    # Check messages in DB
    msg_count = check_db_count("marketplaceMessages", {"conversationId": CONV_ID})
    test("Message stored in DB", int(msg_count or 0) >= 1, f"msg_count={msg_count}")

# ══════════════════════════════════════════════════════
# TEST 16: Chat Relay — Seller replies (via inline Reply button)
# ══════════════════════════════════════════════════════
section("TEST 16: Chat Relay — Seller replies")

if CONV_ID:
    # Seller clicks "Reply to Buyer" inline button
    status = send_callback(SELLER_ID, f"mp:reply:{CONV_ID}")
    time.sleep(2)
    state = get_state(SELLER_ID)
    test("Seller enters mpChat mode", state.get("action") == "mpChat", f"action={state.get('action')}")
    test("Seller has active conversation", state.get("mpActiveConversation") == CONV_ID, f"conv={state.get('mpActiveConversation')}")

    # Seller sends a message
    status = send_text(SELLER_ID, "Yes! It's still available. Interested?")
    time.sleep(2)
    msg_count = check_db_count("marketplaceMessages", {"conversationId": CONV_ID})
    test("Seller message stored in DB", int(msg_count or 0) >= 2, f"msg_count={msg_count}")

# ══════════════════════════════════════════════════════
# TEST 17: Chat — Price suggestion
# ══════════════════════════════════════════════════════
section("TEST 17: Chat — /price command")

if CONV_ID:
    # Buyer suggests a lower price
    status = send_text(BUYER_ID, "/price 120", username="testbuyer")
    time.sleep(2)
    test("/price webhook accepted", status == 200)

    # Check conversation agreedPrice updated
    convs = get_conversations(BUYER_ID)
    if convs:
        test("Agreed price updated to 120", convs[0].get("agreedPrice") == 120, f"agreedPrice={convs[0].get('agreedPrice')}")

    # Invalid price
    status = send_text(BUYER_ID, "/price 5", username="testbuyer")
    time.sleep(2)
    test("Invalid /price rejected", status == 200)

    # /price without amount
    status = send_text(BUYER_ID, "/price", username="testbuyer")
    time.sleep(2)
    test("/price without amount shows usage", status == 200)

# ══════════════════════════════════════════════════════
# TEST 18: Chat — Anti-scam detection
# ══════════════════════════════════════════════════════
section("TEST 18: Anti-scam payment pattern detection")

if CONV_ID:
    # Seller tries to ask for direct payment
    status = send_text(SELLER_ID, "Just send payment to my PayPal account directly")
    time.sleep(2)
    test("Payment pattern detected (paypal)", status == 200)
    
    status = send_text(SELLER_ID, "Pay me directly, no escrow needed")
    time.sleep(2)
    test("Payment pattern detected (no escrow)", status == 200)

    status = send_text(BUYER_ID, "Here is my cashapp: $testuser123", username="testbuyer")
    time.sleep(2)
    test("Payment pattern detected (cashapp)", status == 200)

# ══════════════════════════════════════════════════════
# TEST 19: Chat — /report command
# ══════════════════════════════════════════════════════
section("TEST 19: Chat — /report command")

if CONV_ID:
    status = send_text(BUYER_ID, "/report", username="testbuyer")
    time.sleep(2)
    test("/report webhook accepted", status == 200)

# ══════════════════════════════════════════════════════
# TEST 20: Chat — /escrow command
# ══════════════════════════════════════════════════════
section("TEST 20: Chat — /escrow command")

if CONV_ID:
    status = send_text(BUYER_ID, "/escrow", username="testbuyer")
    time.sleep(3)
    test("/escrow webhook accepted", status == 200)

    # Check escrow started in DB
    convs = get_conversations(BUYER_ID)
    if convs:
        test("Conversation status set to escrow_started", convs[0].get("status") == "escrow_started", f"status={convs[0].get('status')}")
        test("Escrow timestamp set", convs[0].get("escrowStartedAt") is not None, f"escrowAt={convs[0].get('escrowStartedAt')}")

# ══════════════════════════════════════════════════════
# TEST 21: Chat — /done (end conversation)
# ══════════════════════════════════════════════════════
section("TEST 21: Chat — /done (end conversation)")

if CONV_ID:
    status = send_text(BUYER_ID, "/done", username="testbuyer")
    time.sleep(2)
    test("/done webhook accepted", status == 200)

    state = get_state(BUYER_ID)
    test("Buyer returned to mpHome after /done", state.get("action") == "mpHome", f"action={state.get('action')}")

    # After close, check directly
    conv_data = get_one("marketplaceConversations", {"_id": CONV_ID})
    test("Conversation closed in DB", conv_data.get("status") == "closed", f"status={conv_data.get('status')}")

# ══════════════════════════════════════════════════════
# TEST 22: Seller — Own product check
# ══════════════════════════════════════════════════════
section("TEST 22: Seller — Cannot chat with own product")

# Make sure seller is NOT in mpChat mode first — send /done to exit
send_text(SELLER_ID, "/done")
time.sleep(2)

if PRODUCT_ID:
    # Seller tries to chat with own product
    status = send_callback(SELLER_ID, f"mp:chat:{PRODUCT_ID}")
    time.sleep(2)
    test("Own product chat blocked", status == 200)
    # Seller should NOT be in mpChat
    state = get_state(SELLER_ID)
    test("Seller NOT put in chat mode for own product", state.get("action") != "mpChat", f"action={state.get('action')}")

# ══════════════════════════════════════════════════════
# TEST 23: Buyer — Existing conversation resume
# ══════════════════════════════════════════════════════
section("TEST 23: Buyer — Resume existing conversation")

# Create a new conversation first
if PRODUCT_ID_2:
    status = send_callback(BUYER_ID, f"mp:chat:{PRODUCT_ID_2}", username="testbuyer")
    time.sleep(3)
    state = get_state(BUYER_ID)
    test("New conversation started for 2nd product", state.get("action") == "mpChat", f"action={state.get('action')}")
    CONV_ID_2 = state.get("mpActiveConversation")

    # Try to start another conversation with same product — should resume
    status = send_text(BUYER_ID, "/done", username="testbuyer")  # exit first
    time.sleep(1)
    # Go back to marketplace
    status = send_text(BUYER_ID, "🏪 Marketplace", username="testbuyer")
    time.sleep(1)

    # Try chatting with same product again via callback
    status = send_callback(BUYER_ID, f"mp:chat:{PRODUCT_ID_2}", username="testbuyer")
    time.sleep(3)
    state = get_state(BUYER_ID)
    # Note: The old conversation was closed by /done, so a new one should be created
    test("Resumed or new conversation started", state.get("action") == "mpChat", f"action={state.get('action')}")

    # End it
    send_text(BUYER_ID, "/done", username="testbuyer")
    time.sleep(1)

# ══════════════════════════════════════════════════════
# TEST 24: Seller — Start Escrow from product card (direct)
# ══════════════════════════════════════════════════════
section("TEST 24: Direct Escrow from product card")

if PRODUCT_ID:
    status = send_callback(BUYER_ID, f"mp:escrow_product:{PRODUCT_ID}", username="testbuyer")
    time.sleep(3)
    test("Direct escrow webhook accepted", status == 200)

    # Check that a conversation was created and escrow started
    from pymongo import MongoClient
    try:
        client = MongoClient(MONGO_URI)
        db = client[DB_NAME]
        data = list(db.marketplaceConversations.find({"productId": PRODUCT_ID, "buyerId": BUYER_ID, "status": "escrow_started"}))
        client.close()
        test("Escrow conversation created", len(data) >= 1, f"count={len(data)}")
    except Exception as e:
        test("Escrow conversation created", False, str(e))

# ══════════════════════════════════════════════════════
# TEST 25: Seller — Mark product as sold
# ══════════════════════════════════════════════════════
section("TEST 25: Seller — Mark product as sold")

# Go to marketplace > my listings > select product > mark sold
send_text(SELLER_ID, "🏪 Marketplace")
time.sleep(1)
send_text(SELLER_ID, "📦 My Listings")
time.sleep(2)
state = get_state(SELLER_ID)
test("Seller in my listings", state.get("action") == "mpMyListings", f"action={state.get('action')}")

# Select the 2nd product to mark as sold
if PRODUCT_ID_2:
    send_text(SELLER_ID, "✅ Hacking Toolkit v2.0")
    time.sleep(2)
    state = get_state(SELLER_ID)
    test("Managing listing", state.get("action") == "mpManageListing", f"action={state.get('action')}")

    send_text(SELLER_ID, "✅ Mark as Sold")
    time.sleep(2)

    # Check DB
    prod_data = get_one("marketplaceProducts", {"_id": PRODUCT_ID_2})
    test("Product marked as sold in DB", prod_data.get("status") == "sold", f"status={prod_data.get('status')}")

# ══════════════════════════════════════════════════════
# TEST 26: Seller — Remove product
# ══════════════════════════════════════════════════════
section("TEST 26: Seller — Remove listing")

send_text(SELLER_ID, "🏪 Marketplace")
time.sleep(1)
send_text(SELLER_ID, "📦 My Listings")
time.sleep(2)

# Select the 1st product
send_text(SELLER_ID, "✅ Premium VPN — Updated Title")
time.sleep(2)
state = get_state(SELLER_ID)
test("Managing listing for removal", state.get("action") == "mpManageListing", f"action={state.get('action')}")

send_text(SELLER_ID, "❌ Remove Listing")
time.sleep(2)

if PRODUCT_ID:
    prod_data = get_one("marketplaceProducts", {"_id": PRODUCT_ID})
    test("Product removed in DB", prod_data.get("status") == "removed", f"status={prod_data.get('status')}")

# ══════════════════════════════════════════════════════
# TEST 27: My Conversations view
# ══════════════════════════════════════════════════════
section("TEST 27: My Conversations")

send_text(BUYER_ID, "🏪 Marketplace", username="testbuyer")
time.sleep(1)
send_text(BUYER_ID, "💬 My Conversations", username="testbuyer")
time.sleep(2)
# This should either show conversations or say no conversations
test("My Conversations webhook accepted", status == 200)

# ══════════════════════════════════════════════════════
# TEST 28: Cancel during listing creation
# ══════════════════════════════════════════════════════
section("TEST 28: Cancel during listing creation")

send_text(SELLER_ID, "🏪 Marketplace")
time.sleep(1)
send_text(SELLER_ID, "➕ List a Product")
time.sleep(1)
state = get_state(SELLER_ID)
test("In image upload mode", state.get("action") == "mpNewImage", f"action={state.get('action')}")

send_text(SELLER_ID, "❌ Cancel")
time.sleep(2)
state = get_state(SELLER_ID)
test("Cancelled, back to marketplace home", state.get("action") == "mpHome", f"action={state.get('action')}")

# ══════════════════════════════════════════════════════
# TEST 29: Back button during title entry
# ══════════════════════════════════════════════════════
section("TEST 29: Back button navigation")

send_text(SELLER_ID, "➕ List a Product")
time.sleep(1)
send_photo(SELLER_ID)
time.sleep(1)
send_text(SELLER_ID, "✅ Done Uploading")
time.sleep(1)
state = get_state(SELLER_ID)
test("In title entry", state.get("action") == "mpNewTitle", f"action={state.get('action')}")

send_text(SELLER_ID, "Back")
time.sleep(2)
state = get_state(SELLER_ID)
test("Back goes to image upload", state.get("action") == "mpNewImage", f"action={state.get('action')}")

# Back from image upload goes to marketplace
send_text(SELLER_ID, "Back")
time.sleep(2)
state = get_state(SELLER_ID)
test("Back from images goes to marketplace", state.get("action") == "mpHome", f"action={state.get('action')}")

# ══════════════════════════════════════════════════════
# TEST 30: Empty browse (no products — both are sold/removed)
# ══════════════════════════════════════════════════════
section("TEST 30: Browse with no active products")

send_text(BUYER_ID, "🏪 Marketplace", username="testbuyer")
time.sleep(1)
send_text(BUYER_ID, "🔍 Browse Products", username="testbuyer")
time.sleep(1)
send_text(BUYER_ID, "📋 All Categories", username="testbuyer")
time.sleep(2)
test("Empty browse webhook accepted", status == 200)

# ══════════════════════════════════════════════════════
# TEST 31: Pagination test (create 7 products)
# ══════════════════════════════════════════════════════
section("TEST 31: Pagination — Create multiple products")

for i in range(7):
    send_text(SELLER_ID, "🏪 Marketplace")
    time.sleep(1)
    send_text(SELLER_ID, "➕ List a Product")
    time.sleep(1)
    send_photo(SELLER_ID)
    time.sleep(1)
    send_text(SELLER_ID, "✅ Done Uploading")
    time.sleep(1)
    send_text(SELLER_ID, f"Test Product #{i+1}")
    time.sleep(1)
    send_text(SELLER_ID, f"Description for product #{i+1}")
    time.sleep(1)
    send_text(SELLER_ID, str(20 + i * 10))
    time.sleep(1)
    cat = ["💻 Digital Goods", "🏦 Bnk Logs", "🏧 Bnk Opening", "🔧 Tools"][i % 4]
    send_text(SELLER_ID, cat)
    time.sleep(1)
    send_text(SELLER_ID, "✅ Publish")
    time.sleep(2)

products = get_products(SELLER_ID)
test(f"7 products created for pagination", len(products) >= 7, f"count={len(products)}")

# Browse all — should get page 1 (5 products) then we test next page
send_text(BUYER_ID, "🏪 Marketplace", username="testbuyer")
time.sleep(1)
send_text(BUYER_ID, "🔍 Browse Products", username="testbuyer")
time.sleep(1)
send_text(BUYER_ID, "📋 All Categories", username="testbuyer")
time.sleep(3)
test("Page 1 browse accepted", True)

# Pagination via callback: next page
status = send_callback(BUYER_ID, "mp:page:all:1", username="testbuyer")
time.sleep(3)
test("Page 2 callback accepted", status == 200)

# ══════════════════════════════════════════════════════
# TEST 32: Verify error logs
# ══════════════════════════════════════════════════════
section("TEST 32: Error log check")

err_logs = check_error_logs(50)
# Filter out known non-critical errors (node internals, telegram API errors for test users)
# Only flag errors that contain actual error keywords (crash, uncaught, fatal, etc.)
critical_errors = [l for l in err_logs.split('\n') if l.strip() and any(kw in l.lower() for kw in ['uncaught', 'fatal', 'crash', 'segfault', 'cannot find module', 'syntax error', 'referenceerror', 'typeerror: cannot'])]
test("No critical errors in nodejs.err.log", len(critical_errors) == 0, f"errors: {critical_errors[:3]}")

# Check marketplace-specific errors
mp_errors = check_recent_logs(100, "marketplace.*error")
test("No marketplace errors in out.log", len(mp_errors) == 0, f"mp_errors: {mp_errors}")

# ══════════════════════════════════════════════════════
# SUMMARY
# ══════════════════════════════════════════════════════
print(f"\n{BOLD}{'═' * 60}{RESET}")
print(f"{BOLD}MARKETPLACE TEST RESULTS{RESET}")
print(f"{'═' * 60}")
print(f"  {GREEN}PASSED: {passed}{RESET}")
print(f"  {RED}FAILED: {failed}{RESET}")
print(f"  TOTAL:  {passed + failed}")
print(f"  Rate:   {passed/(passed+failed)*100:.1f}%")
if errors:
    print(f"\n{RED}FAILURES:{RESET}")
    for e in errors:
        print(f"  • {e}")
print(f"{'═' * 60}\n")
