"""
Regression test for the cuttly.js provider revert (2026-05-12).

Background:
  - 2026-05-02 swap from url-shortener57 → tiny-url-shortner caused tinyurl.com
    URLs to surface in production. User feedback ("It should be through
    RapidAPI") indicated the RapidAPI hop is fine — just NOT the tinyurl
    provider. We reverted the provider, kept the RapidAPI flow intact.
  - Defaults now: url-shortener57.p.rapidapi.com, /shorten, result_url.
  - Provider overridable at runtime via RAPIDAPI_SHORTENER_HOST /
    RAPIDAPI_SHORTENER_PATH / RAPIDAPI_SHORTENER_FIELD env vars.
"""

from pathlib import Path
import re

SRC = Path("/app/js/cuttly.js")
INDEX = Path("/app/js/_index.js")


def test_default_provider_is_not_tinyurl():
    src = SRC.read_text()
    # Strip comments before checking — our revert note legitimately mentions tinyurl.
    src_no_comments = re.sub(r"//[^\n]*", "", src)
    src_no_comments = re.sub(r"/\*.*?\*/", "", src_no_comments, flags=re.DOTALL)
    assert "tiny-url-shortner" not in src_no_comments.lower()
    assert "tinyurl.com" not in src_no_comments.lower()


def test_default_provider_is_linkly():
    """2026-10-22: Shortit "Random" links moved from RapidAPI (srtn.me) to Linkly."""
    src = SRC.read_text()
    # Strip full-line comments only (a naive // regex would eat "https://…" strings)
    src_no_comments = re.sub(r"^\s*//[^\n]*", "", src, flags=re.M)
    assert "https://api.linklyhq.com/api/v1" in src_no_comments
    assert "/workspace/${workspaceId}/links" in src_no_comments
    assert "full_url" in src_no_comments
    assert "Bearer ${process.env.LINKLY_API_KEY}" in src_no_comments
    # RapidAPI must be fully gone from the live code path
    assert "rapidapi" not in src_no_comments.lower()
    assert "srtn-me-url-shortener" not in src_no_comments


def test_linkly_env_contract():
    src = SRC.read_text()
    for v in ("LINKLY_API_KEY", "LINKLY_WORKSPACE_ID", "LINKLY_DOMAIN"):
        assert v in src, f"Env variable {v} missing"
    # Workspace ID auto-discovery fallback
    assert "/workspaces" in src


def test_index_js_random_slug_uses_linkly():
    """The random-slug flow must call createShortUrlApi unconditionally."""
    src = INDEX.read_text()
    region_start = src.index("Always route through SELF_URL key")
    region = src[region_start:region_start + 2500]
    assert "await createShortUrlApi(url)" in region
    assert "process.env.SHORTLINK_PROVIDER" not in region
    assert "Linkly URL shortener failed" in region
    assert "RapidAPI" not in region


def test_linkly_links_show_analytics_not_available():
    src = Path("/app/js/shortener-analytics.js").read_text()
    assert "linkly\\.link" in src


