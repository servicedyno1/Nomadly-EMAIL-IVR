# Restore Alice's state after regression suites (ring group off, ai-summary off, webhook secret rotated, text triggers off)
import os, requests
B = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
A = f"{B}/api/cloudivr-web"
s = requests.Session(); s.headers.update({"Origin": B})
print(s.post(f"{A}/auth/login", json={"email": "civr.alice@example.com", "password": "AliceTest#2026"}).status_code)
n = "%2B16692098449"
print('rg', s.put(f"{A}/numbers/{n}/ring-group", json={"enabled": False}).status_code)
print('ai', s.patch(f"{A}/numbers/{n}/ai-summary", json={"enabled": False}).status_code)
print('sec', s.post(f"{A}/webhooks/secret").status_code)
print('tt', s.put(f"{A}/numbers/{n}/text-triggers", json={"enabled": False, "myPhone": None, "rules": [{"action": "message", "message": "Thanks", "enabled": True, "oncePerHour": False}]}).status_code)
print('tt now', s.get(f"{A}/numbers/{n}/text-triggers").json()["textTriggers"]["enabled"])
print('rg now', s.get(f"{A}/numbers/{n}/ring-group").text[:150])
