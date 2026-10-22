#!/usr/bin/env python3
# Sim helper: send a text update to the bot webhook and print new bot replies from the mock Telegram API.
# usage: sim_send.py <chat_id> "<text>" [wait_seconds]
import sys, json, time, requests
chat, text = int(sys.argv[1]), sys.argv[2]
wait = float(sys.argv[3]) if len(sys.argv) > 3 else 3
since = int(time.time() * 1000)
uid = int(time.time() * 1000) % 2_000_000_000
upd = {"update_id": uid, "message": {"message_id": uid % 1000000, "date": int(time.time()),
       "chat": {"id": chat, "type": "private", "first_name": "Sim", "username": f"sim_{chat}"},
       "from": {"id": chat, "is_bot": False, "first_name": "Sim", "username": f"sim_{chat}", "language_code": "en"},
       "text": text}}
r = requests.post("http://localhost:5000/telegram/webhook", json=upd, timeout=30)
print("webhook:", r.status_code)
time.sleep(wait)
calls = requests.get(f"http://127.0.0.1:5099/_calls?chat_id={chat}&since={since}").json()
for c in calls:
    print("---", c["method"], "|", (c.get("text") or "")[:600].replace("\n", " / "))
    if c.get("buttons"): print("    buttons:", c["buttons"])
