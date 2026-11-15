# Helper (iter283): temporarily give civr.uxtest a legal profile for the permission UI test, then restore it.
import sys, datetime
from pymongo import MongoClient
def _env(k):
    for line in open('/app/backend/.env'):
        if line.startswith(k + '='):
            return line.split('=', 1)[1].strip().strip('"')
db = MongoClient(_env('MONGO_URL'))[_env('DB_NAME')]
q = {"email": "civr.uxtest@example.com"}
a = db.webAccounts.find_one(q)
cid = str(int(a["_id"]))
if sys.argv[1] == "on":
    assert not a.get("legalProfile"), "already has profile - do not touch"
    db.webAccounts.update_one(q, {"$set": {"legalProfile": {"type": "individual", "fullName": "TEST_ Ux Temp", "address": {"line1": "1 Main St", "city": "Austin", "postalCode": "78701", "countryCode": "US"}, "completedAt": datetime.datetime.utcnow(), "_iter283temp": True}}})
    print("on", db.webAccounts.find_one(q).get("legalProfile"))
elif sys.argv[1] == "off":
    if (a.get("legalProfile") or {}).get("_iter283temp"):
        db.webAccounts.update_one(q, {"$unset": {"legalProfile": "", "quickIvrPermissionAt": ""}})
    print("off", {k: a.get(k) for k in ["quickIvrPermissionAt"]}, db.webAccounts.find_one(q).get("legalProfile"))
else:
    print("perms", list(db.callPermissions.find({"chatId": cid}, {"_id": 1, "kind": 1, "campaign": 1, "at": 1})))
    print("quickAt", a.get("quickIvrPermissionAt"))
