import sys, requests
API = "https://vault-setup-30--5ddhk04r.preview.emergentagent.com/api/cloudivr-web"
s = requests.Session()
s.post(f"{API}/auth/login", json={'email': 'civr.alice@example.com', 'password': 'AliceTest#2026'})
items = s.get(f"{API}/contacts?limit=100").json()
print('existing', len(items.get('contacts', items.get('items', []))), [c.get('phone') for c in items.get('items', [])][:10])
if sys.argv[1:] == ['seed']:
    for p, n in [('+14155550130', 'TEST_Dead One'), ('+14155550131', 'TEST_Live A'), ('+14155550133', 'TEST_Live B')]:
        r = s.post(f"{API}/contacts", json={'phone': p, 'name': n})
        print(p, r.status_code, r.text[:120])
if sys.argv[1:] == ['clean']:
    for c in items.get('contacts', items.get('items', [])):
        if str(c.get('name', '')).startswith('TEST_'):
            print('del', c['phone'], s.delete(f"{API}/contacts/{c['id']}").status_code)
