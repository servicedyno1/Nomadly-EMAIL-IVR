"""Phase 2 backend tests: Outbound menu routing + Per-Number Voice IVR parity + regressions."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    BASE_URL = "https://subscription-check-20.preview.emergentagent.com"

TIMEOUT = 90


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# Health
def test_health(api):
    r = api.get(f"{BASE_URL}/api/health", timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("status") == "healthy"
    assert data.get("database") == "connected"


# Outbound menu routing (Telnyx + Twilio single + bulk, opt-in menu)
def test_outbound_menu_route(api):
    r = api.post(f"{BASE_URL}/api/dev/outbound-menu-route-test", json={}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("pass") is True, data
    checks = data.get("checks", {})
    expected = [
        "telnyx_root_forward", "telnyx_root_message", "telnyx_root_submenu",
        "telnyx_sub_forward", "telnyx_sub_message", "telnyx_root_invalid",
        "single_root_forward_dials", "single_root_message_says", "single_root_submenu_gathers",
        "single_sub_forward_dials", "single_sub_message_says", "single_invalid_hangs_up",
        "bulk_root_forward_dials", "bulk_root_submenu_gathers", "bulk_sub_message_says",
    ]
    missing = [k for k in expected if k not in checks]
    assert not missing, f"missing checks: {missing} | got {list(checks.keys())}"
    false_checks = [k for k in expected if checks.get(k) is not True]
    assert not false_checks, f"false checks: {false_checks} | full={data}"


# Per-Number Voice: apply template with premium voice + speed and reachable audio
def test_ivr_parity_apply_template_nova(api):
    body = {
        "templateKey": "pay_notification",
        "placeholderValues": {"Name": "John", "Bank": "Chase", "Amount": "250"},
        "voiceKey": "nova",
        "ttsSpeed": 1.15,
        "generateAudio": True,
    }
    r = api.post(f"{BASE_URL}/api/dev/ivr-parity/apply-template", json=body, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("ok") is True, data
    cfg = data.get("config", {})
    assert cfg.get("voiceKey") == "nova", cfg
    assert float(cfg.get("ttsSpeed")) == 1.15, cfg
    audio = data.get("audio", {})
    assert (audio.get("voice") or "").lower() == "nova", audio
    audio_url = audio.get("audioUrl")
    assert audio_url and isinstance(audio_url, str), audio
    # fetch audio
    ar = requests.get(audio_url, timeout=TIMEOUT)
    assert ar.status_code == 200, f"audio fetch {ar.status_code}"
    ctype = ar.headers.get("content-type", "").lower()
    assert "audio" in ctype or "mpeg" in ctype, ctype


# Regression: legacy Twilio single IVR transfer billing (no menu)
def test_regression_twilio_single_ivr_transfer_billing(api):
    r = api.post(f"{BASE_URL}/api/dev/twilio-ivr-transfer-billing-test", json={}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("pass") is True, data


# Regression: legacy bulk (no menu)
def test_regression_bulk_transfer_billing(api):
    r = api.post(f"{BASE_URL}/api/dev/bulk-transfer-billing-test", json={}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("pass") is True, data


# Regression: CallRecon
def test_regression_call_reconciler(api):
    r = api.post(f"{BASE_URL}/api/dev/call-reconciler-test", json={}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data.get("pass") is True, data
