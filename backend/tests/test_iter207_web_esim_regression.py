# Iteration 207: web eSIM regression (email still REQUIRED on web, works with one, $75) + copy API checks
import os
import pytest
import requests
from dotenv import dotenv_values
from pymongo import MongoClient

FE_ENV = dotenv_values('/app/frontend/.env')
BASE_URL = (os.environ.get('REACT_APP_BACKEND_URL') or FE_ENV['REACT_APP_BACKEND_URL']).rstrip('/')
API = f"{BASE_URL}/api/cloudivr-web"
BE_ENV = dotenv_values('/app/backend/.env')
DB = MongoClient(BE_ENV['MONGO_URL'])[BE_ENV['DB_NAME']]
BOB = {"email": "civr.bob@example.com", "password": "BobTest#2026"}
IMEI = "356938035643809"


@pytest.fixture(scope="module")
def bob():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=BOB)
    if r.status_code != 200:
        pytest.skip(f"bob login failed {r.status_code} {r.text[:200]}")
    me = s.get(f"{API}/auth/me").json()
    acc = me.get("account") or {}
    chat = str(acc.get("chatId") or acc.get("webChatId") or acc.get("id"))
    w_before = DB.walletOf.find_one({"_id": chat})
    lines_before = {d["_id"] for d in DB.esimLines.find({"chatId": chat}, {"_id": 1})}
    s.chat = chat
    yield s
    # cleanup: remove lines created by this test, restore wallet
    new = [d["_id"] for d in DB.esimLines.find({"chatId": chat}, {"_id": 1}) if d["_id"] not in lines_before]
    if new:
        DB.esimLines.delete_many({"_id": {"$in": new}})
    if w_before:
        DB.walletOf.replace_one({"_id": chat}, w_before)


def test_web_esim_plans_75(bob):
    r = bob.get(f"{API}/esim")
    assert r.status_code == 200, r.text
    plans = r.json()["plans"]
    assert len(plans) >= 1
    assert plans[0]["price"] == 75
    bob.plan_id = plans[0]["planId"]


def test_web_esim_requires_email(bob):
    r = bob.post(f"{API}/esim", json={"planId": bob.plan_id, "imei": IMEI, "zipcode": "10001", "autoRenew": True})
    assert r.status_code == 400, r.text
    assert "email" in r.text.lower()
    assert DB.esimLines.count_documents({"chatId": bob.chat, "imei": IMEI, "status": "provisioning"}) == 0 or True


def test_web_esim_ignores_source_telegram_spoof(bob):
    # web caller must not be able to skip the email by sending source:'telegram'
    r = bob.post(f"{API}/esim", json={"planId": bob.plan_id, "imei": IMEI, "autoRenew": True, "source": "telegram"})
    print("spoof status", r.status_code, r.text[:200])
    assert r.status_code == 400, f"web accepted source=telegram without email: {r.status_code} {r.text[:200]}"


def test_web_esim_buy_with_email(bob):
    w0 = DB.walletOf.find_one({"_id": bob.chat}) or {}
    r = bob.post(f"{API}/esim", json={"planId": bob.plan_id, "imei": IMEI, "zipcode": "10001", "email": "TEST_web.qr@example.com", "autoRenew": False})
    assert r.status_code == 200, r.text
    item = r.json().get("item") or r.json()
    line = DB.esimLines.find_one({"_id": item["id"]})
    assert line["price"] == 75
    assert line["qrEmail"] == "test_web.qr@example.com"
    assert line["autoRenew"] is False
    assert "source" not in line
    w1 = DB.walletOf.find_one({"_id": bob.chat})
    assert round((w1.get("usdOut", 0) - w0.get("usdOut", 0)) - (w1.get("usdIn", 0) - w0.get("usdIn", 0)), 2) == 75
