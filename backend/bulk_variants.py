"""eSIM BulkSMS: AI copy variants (Claude Opus 5.5 via the Emergent LLM key). Internal endpoint for the Node engine only."""
import json
import os
import re
import uuid

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

router = APIRouter()

SYSTEM = (
    "You rewrite short business SMS copy for a US/Canada texting platform. Produce alternative phrasings that keep the SAME meaning, "
    "the SAME offer and call to action, the same tone and language, and any brand name, URL, code or phone number EXACTLY as written. "
    "Never add a URL, phone number, email, price, date, claim or urgency that the original does not have. Never impersonate banks, "
    "government or carriers. Plain text only (no emoji unless the original has them). Each variant must fit within the character "
    "limit given. Answer with a JSON array of strings and nothing else."
)


class VariantsIn(BaseModel):
    text: str
    limit: int = 160
    n: int = 5
    with_links: bool = False
    avoid: list[str] = []


def _local(request: Request) -> bool:
    host = request.client.host if request.client else ""
    return host in ("127.0.0.1", "::1", "localhost")


PRIMARY = ("anthropic", "claude-opus-5-5")
FALLBACK = ("openai", "gpt-5.6-terra")


async def _ask(prov_model: tuple, key: str, prompt: str) -> str:
    from emergentintegrations.llm.chat import LlmChat, UserMessage

    chat = LlmChat(api_key=key, session_id=f"bulk-variants-{uuid.uuid4()}", system_message=SYSTEM).with_model(*prov_model)
    return str(await chat.send_message(UserMessage(text=prompt)) or "")


@router.post("/api/internal/bulk-esim/variants")
async def variants(body: VariantsIn, request: Request):
    if not _local(request):
        return JSONResponse({"error": "forbidden"}, status_code=403)
    key = os.environ.get("EMERGENT_LLM_KEY")
    if not key:
        return JSONResponse({"error": "EMERGENT_LLM_KEY not set"}, status_code=503)
    n = max(1, min(body.n, 10))
    avoid = "\n".join(f"- {a}" for a in body.avoid[:30])
    prompt = (
        f"Original SMS:\n\"\"\"{body.text}\"\"\"\n\nWrite {n} distinct variants. Hard limit: {body.limit} characters each (GSM-7 characters only). "
        f"{'Keep every URL and phone number exactly as in the original; add none.' if body.with_links else 'The variants must contain NO URL, NO phone number and NO email address.'}"
        + (f"\n\nDo not reuse these earlier variants:\n{avoid}" if avoid else "")
        + "\n\nReturn only a JSON array of strings."
    )
    # Claude first; if it fails (outage, model error, low balance) OpenAI answers — with OPENAI_API_KEY when set (own credit), else the same universal key.
    used, primary_error, text = PRIMARY, None, ""
    try:
        text = await _ask(PRIMARY, key, prompt)
    except Exception as e:
        primary_error = str(e)[:300]
        try:
            used = FALLBACK
            text = await _ask(FALLBACK, os.environ.get("OPENAI_API_KEY") or key, prompt)
        except Exception as e2:  # both down → the engine tells the customer to try later and alerts the admin
            return JSONResponse({"error": f"claude: {primary_error} | openai: {str(e2)[:300]}", "primary_error": primary_error, "fallback_error": str(e2)[:300]}, status_code=502)
    m = re.search(r"\[[\s\S]*\]", text)
    try:
        arr = json.loads(m.group(0)) if m else []
    except Exception:
        arr = []
    out = [str(x).strip() for x in arr if isinstance(x, (str, int, float)) and str(x).strip()]
    return {"variants": out[:n], "model": used[1], "provider": used[0], "fallback": used is FALLBACK, "primary_error": primary_error}
