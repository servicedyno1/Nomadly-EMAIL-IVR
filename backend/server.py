from fastapi import FastAPI, Request
from fastapi.responses import Response, JSONResponse, FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
import httpx
import uuid
import asyncio
from datetime import datetime, timezone
from pydantic import BaseModel, Field
from typing import Optional
from contextlib import asynccontextmanager
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from subaccount_monitor import run_health_check


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ.get('DB_NAME', 'test')]

# Node.js Express server URL (runs on port 5000)
NODEJS_URL = "http://127.0.0.1:5000"

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# APScheduler for background tasks
scheduler = AsyncIOScheduler()

# Shared HTTP client for the monitor (created at startup)
monitor_http_client: httpx.AsyncClient = None

# Async HTTP client for proxying to Node.js (60s timeout for long WHM API calls like AutoSSL)
http_client = httpx.AsyncClient(timeout=60.0)


# ============================================================
# LIFESPAN: Startup/Shutdown with APScheduler
# ============================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    global monitor_http_client
    monitor_http_client = httpx.AsyncClient(timeout=30.0)

    # Schedule the subaccount health check every 30 minutes
    async def scheduled_health_check():
        try:
            logger.info("[Scheduler] Running phone number health check...")
            result = await run_health_check(db, monitor_http_client)
            logger.info(f"[Scheduler] Health check result: {result}")
        except Exception as e:
            logger.error(f"[Scheduler] Health check failed: {e}")

    # ── DEV-SAFETY GUARD ──────────────────────────────────────────────
    # The health monitor sends Telegram messages via TELEGRAM_BOT_TOKEN_PROD
    # to REAL production users and writes "suspended" status to the (shared)
    # production DB. On a dev/sandbox pod (SKIP_WEBHOOK_SYNC=true) we must NOT
    # run it, otherwise this pod could notify live users from the production
    # bot and mutate production data. Production (Railway) leaves the flag
    # unset/false so the monitor runs there as normal.
    skip_monitor = os.environ.get("SKIP_WEBHOOK_SYNC", "").lower() == "true"
    if skip_monitor:
        logger.info(
            "[Scheduler] SKIP_WEBHOOK_SYNC=true — phone health monitor DISABLED "
            "(dev sandbox: will not notify production users or mutate prod data)"
        )
    else:
        scheduler.add_job(
            scheduled_health_check,
            "interval",
            minutes=30,
            id="phone_number_health_check",
            replace_existing=True,
        )
        # Also run once at startup after a short delay
        scheduler.add_job(
            scheduled_health_check,
            "date",
            run_date=datetime.now(timezone.utc),
            id="phone_number_health_check_startup",
        )
        scheduler.start()
        logger.info("[Scheduler] Phone number health monitor started (every 30 min)")

    yield

    # Shutdown
    if scheduler.running:
        scheduler.shutdown(wait=False)
    await monitor_http_client.aclose()
    logger.info("[Scheduler] Subaccount monitor stopped")


# Create the main app with lifespan
app = FastAPI(lifespan=lifespan)


# ============================================================
# PHONE TEST REVIEWS API — handled by Node.js Express via proxy
# (removed FastAPI direct handlers to avoid collection name mismatch:
#  FastAPI was using 'phone_reviews', Node.js uses 'phoneReviews')
# ============================================================


# ============================================================
# SUBACCOUNT MONITOR ENDPOINTS (must be BEFORE the proxy catch-all)
# ============================================================
@app.post("/api/admin/subaccount-check")
async def manual_subaccount_check():
    """Manually trigger a phone number health check."""
    try:
        result = await run_health_check(db, monitor_http_client)
        return JSONResponse(content={"status": "ok", "result": result})
    except Exception as e:
        logger.error(f"Manual health check failed: {e}")
        return JSONResponse(content={"status": "error", "error": str(e)}, status_code=500)


@app.get("/api/admin/suspension-events")
async def get_suspension_events():
    """Get all suspension events (active and resolved)."""
    try:
        events = []
        async for doc in db["suspensionEvents"].find({}).sort("detectedAt", -1):
            doc["_id"] = str(doc["_id"])
            if "detectedAt" in doc and doc["detectedAt"]:
                doc["detectedAt"] = doc["detectedAt"].isoformat()
            if "resolvedAt" in doc and doc["resolvedAt"]:
                doc["resolvedAt"] = doc["resolvedAt"].isoformat()
            events.append(doc)
        return JSONResponse(content={"status": "ok", "events": events})
    except Exception as e:
        return JSONResponse(content={"status": "error", "error": str(e)}, status_code=500)


@app.get("/api/admin/subaccount-status")
async def get_subaccount_statuses():
    """Get current status of all monitored Twilio subaccounts."""
    try:
        subaccounts = []
        async for doc in db["phoneNumbersOf"].find({}):
            owner_chat_id = doc.get("_id")
            numbers = doc.get("val", {}).get("numbers", [])
            for num in numbers:
                if num.get("provider") == "twilio" and num.get("twilioSubAccountSid"):
                    subaccounts.append({
                        "chatId": str(owner_chat_id),
                        "phoneNumber": num.get("phoneNumber"),
                        "subAccountSid": num.get("twilioSubAccountSid"),
                        "plan": num.get("plan"),
                        "status": num.get("status"),
                    })
        return JSONResponse(content={"status": "ok", "subaccounts": subaccounts})
    except Exception as e:
        return JSONResponse(content={"status": "error", "error": str(e)}, status_code=500)


# ============================================================
# SMS APP: Serve APK download + web preview for testing
# ============================================================
SMS_APP_APK = Path("/app/static/nomadly-sms.apk")
SMS_APP_DIR = Path(__file__).parent.parent / "sms-app" / "www"

@app.get("/api/sms-app/download")
async def download_sms_app():
    """Serve the Nomadly SMS APK for download."""
    if SMS_APP_APK.exists():
        return FileResponse(
            SMS_APP_APK,
            media_type="application/vnd.android.package-archive",
            filename="NomadlySMS.apk",
            headers={"Content-Disposition": "attachment; filename=NomadlySMS.apk"}
        )
    return JSONResponse({"error": "APK not available"}, status_code=404)

@app.get("/api/smsapp")
async def download_sms_app_short():
    """Short URL redirect for SMS app download."""
    if SMS_APP_APK.exists():
        return FileResponse(
            SMS_APP_APK,
            media_type="application/vnd.android.package-archive",
            filename="NomadlySMS.apk",
            headers={"Content-Disposition": "attachment; filename=NomadlySMS.apk"}
        )
    return JSONResponse({"error": "APK not available"}, status_code=404)

@app.get("/api/sms-app/download/info")
async def sms_app_info():
    """Get SMS app version info."""
    return JSONResponse({
        "version": "2.4.1",
        "name": "Nomadly SMS",
        "size": SMS_APP_APK.stat().st_size if SMS_APP_APK.exists() else 0,
        "available": SMS_APP_APK.exists()
    })

# Serve SMS app web files for preview/testing (same files bundled in the APK)
@app.get("/api/sms-app-web")
async def sms_app_web():
    index = SMS_APP_DIR / "index.html"
    if index.exists():
        return FileResponse(index, media_type="text/html")
    return Response("Not found", status_code=404)

@app.get("/api/sms-app-web/{file_path:path}")
async def sms_app_assets(file_path: str):
    full = SMS_APP_DIR / file_path
    if full.exists() and full.is_file():
        ct = {'.css':'text/css','.js':'application/javascript','.html':'text/html','.png':'image/png','.json':'application/json'}
        return FileResponse(full, media_type=ct.get(full.suffix.lower(), 'application/octet-stream'))
    return Response(status_code=404)


# ============================================================
# PROXY: Forward all /api/* requests to Node.js Express on :5000
# ============================================================
@app.api_route("/api/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"])
async def proxy_to_nodejs(request: Request, path: str):
    """Proxy all /api/* requests to the Node.js Express server on port 5000."""
    target_url = f"{NODEJS_URL}/{path}"
    
    if request.query_params:
        target_url += f"?{request.query_params}"
    
    try:
        body = await request.body()
        
        headers = dict(request.headers)
        # Preserve the public host/proto for downstream self-URL rendering
        # (e.g. the /apidoc developer page) since we strip the raw Host below.
        _lower = {k.lower() for k in headers}
        _orig_host = headers.get("host")
        if _orig_host and "x-forwarded-host" not in _lower:
            headers["x-forwarded-host"] = _orig_host
        if "x-forwarded-proto" not in _lower:
            headers["x-forwarded-proto"] = "https"
        headers.pop("host", None)
        headers.pop("content-length", None)
        
        response = await http_client.request(
            method=request.method,
            url=target_url,
            content=body,
            headers=headers,
        )
        
        response_headers = dict(response.headers)
        response_headers.pop("transfer-encoding", None)
        response_headers.pop("content-encoding", None)
        response_headers.pop("content-length", None)
        
        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=response_headers,
        )
    except httpx.ConnectError:
        logger.error(f"Cannot connect to Node.js server at {NODEJS_URL}/{path}")
        return Response(content='{"error":"Node.js server unavailable"}', status_code=502, media_type="application/json")
    except httpx.TimeoutException:
        logger.error(f"Timeout proxying to Node.js for {path}")
        return Response(content='{"error":"Request timed out — the operation may still be running"}', status_code=504, media_type="application/json")
    except Exception as e:
        logger.error(f"Proxy error for {path}: {str(e)}")
        import json as _json
        return Response(content=_json.dumps({"error": str(e)}), status_code=502, media_type="application/json")


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
    await http_client.aclose()
    if monitor_http_client:
        await monitor_http_client.aclose()
