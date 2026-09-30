"""Helper for driving the bot via mock Telegram API."""
import json, time, requests, sys

WEBHOOK = "http://localhost:5000/telegram/webhook"
MOCK = "http://127.0.0.1:5099"
CHAT_ID = 777000123
_uid = [1000]

def _next():
    _uid[0] += 1
    return _uid[0]

def send_text(text, wait=4.0):
    since = int(time.time() * 1000) - 200
    n = _next()
    body = {
        "update_id": n,
        "message": {
            "message_id": n,
            "date": int(time.time()),
            "chat": {"id": CHAT_ID, "type": "private", "first_name": "Sim"},
            "from": {"id": CHAT_ID, "is_bot": False, "first_name": "Sim", "username": "sim_user"},
            "text": text,
        },
    }
    r = requests.post(WEBHOOK, json=body, timeout=15)
    time.sleep(wait)
    calls = requests.get(f"{MOCK}/_calls", params={"chat_id": CHAT_ID, "since": since, "method": "sendMessage"}, timeout=10).json()
    return calls

def send_callback(callback_data, message_id, wait=4.0):
    since = int(time.time() * 1000) - 200
    n = _next()
    body = {
        "update_id": n,
        "callback_query": {
            "id": str(n),
            "from": {"id": CHAT_ID, "is_bot": False, "first_name": "Sim", "username": "sim_user"},
            "message": {"message_id": message_id, "date": int(time.time()), "chat": {"id": CHAT_ID, "type": "private"}},
            "data": callback_data,
        },
    }
    requests.post(WEBHOOK, json=body, timeout=15)
    time.sleep(wait)
    calls = requests.get(f"{MOCK}/_calls", params={"chat_id": CHAT_ID, "since": since, "method": "sendMessage"}, timeout=10).json()
    return calls

def last_screen(calls):
    """Return the last sendMessage that carries buttons/reply_markup (skip 'retrieving' interstitials)."""
    if not calls:
        return None
    best = None
    for c in calls:
        best = c
    # prefer last one with buttons
    for c in reversed(calls):
        if c.get("buttons") or c.get("reply_markup"):
            return c
    return best

def all_button_labels(call):
    if not call: return []
    labels = []
    for b in call.get("buttons") or []:
        labels.append(b)
    rm = call.get("reply_markup") or {}
    if isinstance(rm, str):
        try:
            rm = json.loads(rm)
        except Exception:
            rm = {}
    for kb in (rm.get("keyboard") or []):
        for btn in kb:
            if isinstance(btn, dict):
                labels.append(btn.get("text"))
            else:
                labels.append(btn)
    for kb in (rm.get("inline_keyboard") or []):
        for btn in kb:
            labels.append(btn.get("text"))
    return labels

def dump(call, label=""):
    if not call:
        print(f"[{label}] <no message>")
        return
    print(f"\n=== {label} (msg_id={call.get('message_id')}) ===")
    print("TEXT:", (call.get("text") or "")[:600])
    print("BUTTONS:", all_button_labels(call))

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "/start"
    calls = send_text(cmd, wait=3.5)
    for c in calls:
        dump(c, "call")
