#!/bin/bash
# CloudIVR web API smoke test (preview): two web accounts, dry-run purchase, settings, isolation.
cd /tmp && API=$(grep REACT_APP_BACKEND_URL /app/frontend/.env | cut -d= -f2)/api/cloudivr-web && rm -f a.txt b.txt
reg() { curl -s -c $1 -X POST $API/auth/register -H 'Content-Type: application/json' -d "{\"email\":\"$2\",\"password\":\"$3\",\"name\":\"$4\"}" > /dev/null; curl -s -c $1 -X POST $API/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$2\",\"password\":\"$3\"}" | head -c 160; echo; }
reg a.txt civr.alice@example.com 'AliceTest#2026' 'Alice Tester'
reg b.txt civr.bob@example.com 'BobTest#2026' 'Bob Tester'
cd /app && node -e "
require('dotenv').config({path:'backend/.env'});const {MongoClient}=require('mongodb');(async()=>{const c=await MongoClient.connect(process.env.MONGO_URL);const db=c.db(process.env.DB_NAME);
for (const e of ['civr.alice@example.com','civr.bob@example.com']){const a=await db.collection('webAccounts').findOne({email:e});const w=await db.collection('walletOf').findOne({_id:String(a._id)});if(((w?.usdIn||0)-(w?.usdOut||0))<300) await db.collection('walletOf').updateOne({_id:String(a._id)},{\$inc:{usdIn:500}},{upsert:true});console.log('funded',e,a._id);}
await c.close()})()" && cd /tmp
curl -s -b a.txt "$API/numbers/search?country=US&type=local" | python3 -c "import sys,json;d=json.load(sys.stdin);print('search',len(d.get('numbers',[])),d.get('message'));open('/tmp/pick','w').write(d['numbers'][0]['phoneNumber'] if d.get('numbers') else '')"
P=$(cat /tmp/pick); PE=$(python3 -c "import urllib.parse;print(urllib.parse.quote('$P'))")
echo "buy:"; curl -s -b a.txt -X POST $API/numbers/buy -H 'Content-Type: application/json' -d "{\"phoneNumber\":\"$P\",\"plan\":\"business\"}" | head -c 200; echo
echo "B reads A number:"; curl -s -b b.txt "$API/numbers/$PE" | head -c 150; echo
echo "B patches A number:"; curl -s -b b.txt -X PATCH "$API/numbers/$PE/forwarding" -H 'Content-Type: application/json' -d '{"mode":"always","forwardTo":"+14155550100"}' | head -c 150; echo
echo "A forwarding:"; curl -s -b a.txt -X PATCH "$API/numbers/$PE/forwarding" -H 'Content-Type: application/json' -d '{"mode":"always","forwardTo":"+14155550100"}' | head -c 200; echo
echo "A ivr:"; curl -s -b a.txt -X PUT "$API/numbers/$PE/ivr" -H 'Content-Type: application/json' -d '{"enabled":true,"greeting":"Hi","options":{"1":{"action":"forward","forwardTo":"+14155550101","label":"Sales"},"2":{"action":"submenu","label":"More","subMenu":{"greeting":"Sub","options":{"1":{"action":"voicemail"}}}}}}' | head -c 200; echo
echo "A tts:"; curl -s -b a.txt -X POST "$API/audio/tts" -H 'Content-Type: application/json' -d '{"text":"Hello, press one to talk to us.","voice":"rachel","speed":1,"name":"Test greeting"}' | head -c 300; echo
echo "A topup:"; curl -s -b a.txt -X POST "$API/wallet/topup" -H 'Content-Type: application/json' -d '{"amountUsd":20,"coin":"BTC"}' | head -c 300; echo
curl -s -b a.txt "$API/wallet" | python3 -c "import sys,json;d=json.load(sys.stdin);print('wallet',d.get('balance'),d.get('coins'))"
echo "B campaigns using A caller:"; curl -s -b b.txt -X POST "$API/campaigns" -H 'Content-Type: application/json' -d "{\"callerId\":\"$P\",\"leads\":\"+14155550100\"}" | head -c 150; echo
