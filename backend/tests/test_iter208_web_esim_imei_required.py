# Iteration 208: web eSIM still requires IMEI (pay-first is Telegram-only) and email; no line / no charge on reject
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


@pytest.fixture(scope="module")
def bob():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=BOB)
    if r.status_code != 200:
        pytest.skip(f"bob login failed {r.status_code}")
    acc = (s.get(f"{API}/auth/me").json().get("account") or {})
    s.chat = str(acc.get("chatId") or acc.get("webChatId") or acc.get("id"))
    s.plan_id = s.get(f"{API}/esim").json()["plans"][0]["planId"]
    s.w0 = DB.walletOf.find_one({"_id": s.chat})
    s.lines0 = DB.esimLines.count_documents({"chatId": s.chat})
    yield s
    if s.w0:
        DB.walletOf.replace_one({"_id": s.chat}, s.w0)


@pytest.mark.parametrize("body", [
    {"email": "TEST_web.qr@example.com"},                       # no IMEI
    {"email": "TEST_web.qr@example.com", "imei": ""},           # empty IMEI
    {"email": "TEST_web.qr@example.com", "imei": "356938035643808"},  # Luhn-invalid
    {"email": "TEST_web.qr@example.com", "source": "telegram"},  # spoof pay-first
])
def test_web_esim_requires_imei(bob, body):
    r = bob.post(f"{API}/esim", json={"planId": bob.plan_id, "autoRenew": True, **body})
    assert r.status_code == 400, f"{r.status_code} {r.text[:200]}"
    assert "IMEI" in r.text
    assert DB.esimLines.count_documents({"chatId": bob.chat}) == bob.lines0
    assert DB.esimLines.count_documents({"chatId": bob.chat, "status": "awaiting_imei"}) == 0


def test_web_esim_requires_email_without_imei(bob):
    r = bob.post(f"{API}/esim", json={"planId": bob.plan_id, "autoRenew": True})
    assert r.status_code == 400
    assert DB.esimLines.count_documents({"chatId": bob.chat}) == bob.lines0
