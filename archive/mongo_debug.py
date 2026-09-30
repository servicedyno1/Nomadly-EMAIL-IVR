#!/usr/bin/env python3

import os
from pymongo import MongoClient

# Get MongoDB connection
mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
db_name = os.getenv('DB_NAME', 'test')

client = MongoClient(mongo_url)
db = client[db_name]

print("=== CHECKING phoneNumbersOf COLLECTION ===")

# Check if user exists at all
user_data = db.phoneNumbersOf.find_one({'_id': 1005284399})
print(f"User 1005284399 document: {user_data}")

# Check all documents in collection for debugging
all_docs = list(db.phoneNumbersOf.find().limit(5))
print(f"\nFirst 5 documents in phoneNumbersOf collection:")
for doc in all_docs:
    print(f"ID: {doc.get('_id')}, Numbers count: {len(doc.get('numbers', []))}")

# Check specifically for the target phone number across all users
target_number = '+18669834855'
users_with_target = list(db.phoneNumbersOf.find({'numbers.phoneNumber': target_number}))
print(f"\nUsers with phone number {target_number}:")
for user in users_with_target:
    print(f"User ID: {user.get('_id')}")
    for number in user.get('numbers', []):
        if number.get('phoneNumber') == target_number:
            print(f"  Found {target_number}: plan={number.get('plan')}, status={number.get('status')}")

client.close()