# Iteration 201: low-balance renewal reminder carries meta.topup (end-to-end via spenza tick on a fresh +1555 account)
import random
import time
import requests
from dotenv import dotenv_values
from pymongo import MongoClient
from datetime import datetime, timedelta, timezone

FE_ENV = dotenv_values('/app/frontend/.env')
API = FE_ENV['REACT_APP_BACKEND_URL'].rstrip('/') + "/api/cloudivr-web"
BE_ENV = dotenv_values('/app/backend/.env')
DB = MongoClient(BE_ENV['MONGO_URL'])[BE_ENV['DB_NAME']]


def test_low_balance_reminder_has_topup():
    DB.webLoginAttempts.delete_many({"_id": {"$regex": r"^phone-send"}})
    s = requests.Session()
    phone = "+1555" + "".join(random.choice("0123456789") for _ in range(7))
    d = s.post(f"{API}/auth/phone/start", json={"phone": phone}).json()
    acc = s.post(f"{API}/auth/phone/verify", json={"challenge": d["challenge"], "code": d["previewCode"], "name": "TEST_remind"}).json()["account"]
    cid = str(acc["id"])
    DB.walletOf.update_one({"_id": cid}, {"$set": {"usdIn": 100, "usdOut": 0}}, upsert=True)
    r = s.post(f"{API}/mobile-numbers", json={"zipcode": "10011"})
    assert r.status_code in (200, 201), r.text
    lid = r.json()["item"]["id"]
    for _ in range(20):
        if DB.esimLines.find_one({"_id": lid})["status"] == "active":
            break
        time.sleep(3)
    exp = datetime.now(timezone.utc) + timedelta(days=2)
    DB.esimLines.update_one({"_id": lid}, {"$set": {"expiresAt": exp, "nextBillAt": exp - timedelta(days=1)}})
    n = None
    for _ in range(15):
        n = DB.webNotifications.find_one({"chatId": cid, "meta.mobile": lid, "meta.topup": {"$exists": True}})
        if n:
            break
        time.sleep(3)
    DB.esimLines.update_one({"_id": lid}, {"$set": {"status": "cancelled"}})
    assert n, "no reminder with meta.topup"
    print("NOTICE", n["text"], n["meta"])
    assert n["meta"]["topup"] == 50
    assert "Top up $50.00" in n["text"]
    inbox = s.get(f"{API}/notifications")
    print("INBOX", inbox.status_code, str(inbox.text)[:300])
