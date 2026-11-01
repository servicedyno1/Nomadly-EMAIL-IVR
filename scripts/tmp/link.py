import os,requests,sys
sys.path.insert(0,'/app/backend/tests')
from dotenv import load_dotenv; load_dotenv('/app/frontend/.env')
API=os.environ['REACT_APP_BACKEND_URL'].rstrip('/')+'/api/cloudivr-web'
s=requests.Session()
d=s.post(f"{API}/admin/login",json={'email':'moxxcompany@gmail.com','password':'Katiekendra123@'}).json()
r=s.post(f"{API}/admin/verify",json={'challenge':d['challenge'],'code':d['devCode']}).json()
tok=r.get('token'); h={'Authorization':f'Bearer {tok}'} if tok else {}
e=s.get(f"{API}/admin/esim",headers=h).json()
sims=[x for x in (e.get('fleet') or {}).get('sims',[]) if x['phoneNumber']=='+16462556424']
print('sim', [(x['status'],x['linkedTo']) for x in sims])
if sims:
  print(s.post(f"{API}/admin/esim/sims/{sims[0]['iccid']}/link",json={'email':'onarrival21@gmail.com'},headers=h).json())
