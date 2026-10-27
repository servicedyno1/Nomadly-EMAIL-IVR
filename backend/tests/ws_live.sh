#!/bin/bash
# Live OpenAI realtime test talk: usage: ws_live.sh <waitForHello true|false> <secs>
cd /app
BASE=$(grep REACT_APP_BACKEND_URL frontend/.env|cut -d= -f2)
API=$BASE/api/cloudivr-web
J=/tmp/civr_cj
curl -s -c $J -H 'Content-Type: application/json' -d '{"email":"civr.alice@example.com","password":"AliceTest#2026"}' $API/auth/login >/dev/null
ID=$(curl -s -b $J -H 'Content-Type: application/json' -d "{\"name\":\"Ava\",\"businessName\":\"Sunrise Dental\",\"goal\":\"Hi [Client Full Name], this is Ava from Sunrise Dental, how are you today? [PAUSE] Ask if they would like to book a dental cleaning this month and get a preferred day.\",\"firstMessage\":\"Hi, may I speak with {lead_name}?\",\"waitForHello\":$1}" $API/ai-agents | python3 -c 'import sys,json;print(json.load(sys.stdin)["agent"]["id"])')
echo AGENT $ID
P=$(curl -s -b $J -H 'Content-Type: application/json' -d '{"as":"outbound"}' $API/ai-agents/$ID/test)
echo TEST $P
PATHX=$(echo $P | python3 -c 'import sys,json;print(json.load(sys.stdin)["path"])')
WSS=$(echo $BASE | sed 's#^https#wss#')$PATHX
node ${WSJS:-scripts/ai_agent_ws_test.js} "$WSS" ${AUD:-scripts/fixtures/q.ulaw} $2
sleep 3
curl -s -b $J -X DELETE $API/ai-agents/$ID; echo
