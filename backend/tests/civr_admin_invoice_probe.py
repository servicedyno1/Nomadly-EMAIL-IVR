# Probe: distribution of admin invoices (bill-to names, descriptions, zero totals)
import os, requests, collections
API = os.environ['REACT_APP_BACKEND_URL'].rstrip('/') + '/api/cloudivr-web'
s = requests.Session()
d = s.post(f"{API}/admin/login", json={"email": "moxxcompany@gmail.com", "password": "Katiekendra123@"}).json()
s.post(f"{API}/admin/verify", json={"challenge": d["challenge"], "code": d["devCode"]})
r = s.get(f"{API}/admin/invoices").json()
print("total", r["total"])
print(collections.Counter(i["billTo"].get("name") for i in r["invoices"]).most_common(10))
print(collections.Counter(i["items"][0]["description"].split(" · ")[0] for i in r["invoices"]).most_common(30))
print(collections.Counter(i["kind"] for i in r["invoices"]))
print("zero", [(i["number"], i["items"][0]["description"]) for i in r["invoices"] if i["total"] <= 0][:20])
for i in r["invoices"]:
    if i["billTo"].get("name") == "Zeynep Kaya":
        print("BOT bill-to sample", i); break
