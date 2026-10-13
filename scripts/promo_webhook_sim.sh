#!/usr/bin/env bash
# Drive the DEV bot (@Nomadlytestbot) through its webhook with synthetic admin updates.
# Usage: bash scripts/promo_webhook_sim.sh "<text>"  |  bash scripts/promo_webhook_sim.sh --cb "promo_open:leads"
set -e
ADMIN=$(grep '^TELEGRAM_ADMIN_CHAT_ID=' /app/backend/.env | cut -d'"' -f2)
TS=$(date +%s)
if [ "$1" = "--cb" ]; then
  BODY=$(python3 - "$ADMIN" "$2" "$TS" <<'PY'
import json,sys
admin,data,ts=sys.argv[1],sys.argv[2],int(sys.argv[3])
print(json.dumps({"update_id":ts,"callback_query":{"id":str(ts),"from":{"id":int(admin),"is_bot":False,"first_name":"Admin"},"message":{"message_id":ts%100000,"chat":{"id":int(admin),"type":"private"},"date":ts,"text":"promo"},"chat_instance":"1","data":data}}))
PY
)
else
  BODY=$(python3 - "$ADMIN" "$1" "$TS" <<'PY'
import json,sys
admin,text,ts=sys.argv[1],sys.argv[2],int(sys.argv[3])
print(json.dumps({"update_id":ts,"message":{"message_id":ts%100000,"from":{"id":int(admin),"is_bot":False,"first_name":"Admin"},"chat":{"id":int(admin),"type":"private"},"date":ts,"text":text}}))
PY
)
fi
curl -s -o /dev/null -w "webhook HTTP %{http_code}\n" -X POST http://localhost:5000/telegram/webhook -H 'Content-Type: application/json' -d "$BODY"
