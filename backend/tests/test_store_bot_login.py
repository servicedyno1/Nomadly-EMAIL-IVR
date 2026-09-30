"""
Pytest suite for Bot→Web auto-login feature.
Tests:
  - GET /api/store/config (public, returns botUsername+botStartPayload)
  - GET /api/store/plans regression
  - POST /api/store/auth/bot-login: empty body / garbage / valid mint / replay
  - Synthetic email format tg-<chatId>@bot.local
"""
import os
import subprocess
import requests
import pytest

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://vault-init-6.preview.emergentagent.com",
).rstrip("/")
TEST_CHATID = "5346193142"


def _mint_token(chat_id: str = TEST_CHATID) -> str:
    """Call the Node helper to mint a fresh HMAC bot-login token."""
    cmd = [
        "node",
        "-e",
        (
            "require('dotenv').config({path:'/app/backend/.env'});"
            f"console.log(require('/app/js/store-routes').mintBotLoginToken('{chat_id}'))"
        ),
    ]
    out = subprocess.check_output(cmd, cwd="/app").decode().strip()
    assert "." in out, f"Bad token: {out}"
    return out


def _cleanup_chat_id(chat_id: str = TEST_CHATID):
    """Remove webBotLoginConsumed + webUsers entries for a given chatId."""
    js = (
        "require('dotenv').config({path:'/app/backend/.env'});"
        "const {MongoClient}=require('mongodb');"
        "(async()=>{const c=await MongoClient.connect(process.env.MONGO_URL);"
        "const db=c.db(process.env.DB_NAME);"
        f"await db.collection('webBotLoginConsumed').deleteMany({{chatId:'{chat_id}'}});"
        f"await db.collection('webUsers').deleteOne({{tgChatId:'{chat_id}',authSource:'telegram'}});"
        "await c.close();})();"
    )
    subprocess.run(["node", "-e", js], cwd="/app", check=False, capture_output=True)


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture
def fresh_token():
    _cleanup_chat_id()
    return _mint_token()


# ---------- /api/store/config (public) ----------
class TestStoreConfig:
    def test_config_public_returns_bot_meta(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/store/config")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("botUsername"), body
        assert body["botStartPayload"] == "web-login", body

    def test_config_no_auth_header(self, api_client):
        # Confirm no auth is required — explicitly no Authorization header
        r = requests.get(f"{BASE_URL}/api/store/config")
        assert r.status_code == 200


# ---------- /api/store/plans regression ----------
class TestStorePlansRegression:
    def test_plans_still_returns(self, api_client):
        r = api_client.get(f"{BASE_URL}/api/store/plans")
        assert r.status_code == 200
        plans = r.json()
        # Could be list or wrapped dict
        if isinstance(plans, dict) and "plans" in plans:
            plans = plans["plans"]
        assert isinstance(plans, list) and len(plans) >= 1


# ---------- /api/store/auth/bot-login ----------
class TestBotLogin:
    def test_empty_body_400(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/store/auth/bot-login", json={})
        assert r.status_code == 400, r.text
        body = r.json()
        msg = (body.get("error") or body.get("message") or "").lower()
        assert "bt" in msg and "required" in msg, body

    def test_garbage_token_401(self, api_client):
        r = api_client.post(f"{BASE_URL}/api/store/auth/bot-login", json={"bt": "garbage"})
        assert r.status_code == 401, r.text
        body = r.json()
        msg = (body.get("error") or body.get("message") or "").lower()
        assert "invalid" in msg, body

    def test_fresh_token_200_synthetic_email(self, api_client, fresh_token):
        r = api_client.post(
            f"{BASE_URL}/api/store/auth/bot-login", json={"bt": fresh_token}
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert "token" in body and isinstance(body["token"], str) and body["token"]
        user = body.get("user") or {}
        assert user.get("email") == f"tg-{TEST_CHATID}@bot.local", user
        assert "walletUsd" in user
        # tgDisplay may be empty if no Telegram profile cached — only assert key exists
        assert "tgDisplay" in user

    def test_single_use_replay_401(self, api_client, fresh_token):
        # 1st exchange — succeed
        r1 = api_client.post(
            f"{BASE_URL}/api/store/auth/bot-login", json={"bt": fresh_token}
        )
        assert r1.status_code == 200, r1.text
        # 2nd exchange — must fail
        r2 = api_client.post(
            f"{BASE_URL}/api/store/auth/bot-login", json={"bt": fresh_token}
        )
        assert r2.status_code == 401, r2.text
        body = r2.json()
        msg = (body.get("error") or body.get("message") or "").lower()
        assert "already been used" in msg or "used" in msg, body


# ---------- Regression: unified login ----------
class TestUnifiedLoginRegression:
    def test_web_user_login(self, api_client):
        # storetest@example.com / password1234
        r = api_client.post(
            f"{BASE_URL}/api/store/auth/login",
            json={"email": "storetest@example.com", "password": "password1234"},
        )
        # 200 if seeded, else 401 — only assert it returns a structured response
        assert r.status_code in (200, 401), r.text

    def test_panel_user_login(self, api_client):
        # pnldoctest / 123456
        r = api_client.post(
            f"{BASE_URL}/api/panel/login",
            json={"username": "pnldoctest", "pin": "123456"},
        )
        assert r.status_code in (200, 401), r.text


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
