# Helper: get/set the preview wallet balance of a CloudIVR web account (usage: wallet_helper.py <chatId> [get|set <amount>|save|restore])
import sys, os, json
from pymongo import MongoClient

def env(k):
    for line in open('/app/backend/.env'):
        if line.startswith(k + '='):
            return line.split('=', 1)[1].strip().strip('"')

db = MongoClient(env('MONGO_URL'))[env('DB_NAME')]
cid = sys.argv[1]
cmd = sys.argv[2] if len(sys.argv) > 2 else 'get'
SAVE = f'/tmp/wallet_{cid}.json'
w = db.walletOf.find_one({'_id': cid}) or {}
if cmd == 'get':
    print(json.dumps({'usdIn': w.get('usdIn'), 'usdOut': w.get('usdOut'), 'balance': (w.get('usdIn') or 0) - (w.get('usdOut') or 0)}))
elif cmd == 'save':
    if not os.path.exists(SAVE):
        json.dump({'usdIn': w.get('usdIn'), 'usdOut': w.get('usdOut')}, open(SAVE, 'w'))
    print(open(SAVE).read())
elif cmd == 'set':
    amt = float(sys.argv[3])
    db.walletOf.update_one({'_id': cid}, {'$set': {'usdIn': (w.get('usdOut') or 0) + amt}})
    print('set', amt)
elif cmd == 'restore':
    s = json.load(open(SAVE))
    db.walletOf.update_one({'_id': cid}, {'$set': s})
    print('restored', s)
elif cmd == 'acct':
    a = db.webAccounts.find_one({'email': sys.argv[1]})
    print(a and a['_id'])
