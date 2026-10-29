# Seeds TEST AI call records with the new outcomes for UI label checks (run with --clean to remove)
import sys, uuid, datetime
from pymongo import MongoClient


def env(k):
    for l in open('/app/backend/.env'):
        if l.startswith(k + '='):
            return l.split('=', 1)[1].strip().strip('"')


db = MongoClient(env('MONGO_URL'))[env('DB_NAME')]
db.aiCalls.delete_many({"agentName": "TEST_outcomes"})
if '--clean' not in sys.argv:
    now = datetime.datetime.utcnow()
    for i, o in enumerate(['voicemail', 'no_answer', 'no_conversation', 'screened']):
        db.aiCalls.insert_one({"id": str(uuid.uuid4()), "chatId": "5000000000000001", "agentId": "x", "agentName": "TEST_outcomes", "direction": "outbound",
                               "number": "+15550000000", "other": f"+1555000000{i}", "startedAt": now - datetime.timedelta(minutes=i), "endedAt": now,
                               "duration": 0 if o == 'no_answer' else 20, "charge": 0, "outcome": o, "summary": None, "transcript": []})
print('ok')
