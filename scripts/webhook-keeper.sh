#!/bin/bash
# Keeps the Telegram bot webhook pointed to our Emergent pod
# Runs every 20 seconds to override any Railway webhook theft

BOT_TOKEN="${TELEGRAM_BOT_TOKEN_DEV:?set TELEGRAM_BOT_TOKEN_DEV in the environment}"
OUR_URL="${WEBHOOK_URL:?set WEBHOOK_URL to <pod>/api/telegram/webhook}"

while true; do
  CURRENT=$(curl -s "https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo" | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['url'])" 2>/dev/null)
  
  if [ "$CURRENT" != "$OUR_URL" ]; then
    echo "[$(date)] Webhook stolen! Was: $CURRENT — Reclaiming..."
    curl -s "https://api.telegram.org/bot${BOT_TOKEN}/setWebhook?url=${OUR_URL}&allowed_updates=%5B%22message%22%2C%22callback_query%22%2C%22my_chat_member%22%5D" > /dev/null
    echo "[$(date)] Webhook reclaimed to: $OUR_URL"
  fi
  
  sleep 20
done
