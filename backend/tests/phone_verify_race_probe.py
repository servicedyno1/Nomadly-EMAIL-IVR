# Probe: parallel wrong guesses on /auth/phone/verify - does MAX_TRIES (5) hold under concurrency?
import random
import requests
from concurrent.futures import ThreadPoolExecutor
from dotenv import dotenv_values

API = dotenv_values('/app/frontend/.env')['REACT_APP_BACKEND_URL'].rstrip('/') + '/api/cloudivr-web'
phone = "+1555" + "".join(random.choice("0123456789") for _ in range(7))
d = requests.post(f"{API}/auth/phone/start", json={"phone": phone}).json()
right = d["previewCode"]
guesses = [f"{i:06d}" for i in range(40) if f"{i:06d}" != right]


def go(c):
    return requests.post(f"{API}/auth/phone/verify", json={"challenge": d["challenge"], "code": c}).status_code


with ThreadPoolExecutor(40) as ex:
    res = list(ex.map(go, guesses))
print("401 wrong_code (counted guesses):", res.count(401), " 400 expired:", res.count(400), " other:", [r for r in res if r not in (400, 401)])
print("RACE" if res.count(401) > 5 else "OK")
