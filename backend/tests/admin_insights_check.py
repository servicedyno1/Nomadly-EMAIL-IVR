# Admin signup insights: funnel label + no /admin exits + newest-first (iteration 277)
import requests, json
B=open('/app/frontend/.env').read().split('REACT_APP_BACKEND_URL=')[1].split()[0]+'/api/cloudivr-web'
s=requests.Session()
r=s.post(B+'/admin/login',json={'email':'moxxcompany@gmail.com','password':'Katiekendra123@'}); print('login',r.status_code)
d=r.json(); v=s.post(B+'/admin/verify',json={'challenge':d['challenge'],'code':d.get('devCode')}); print('verify',v.status_code)
tok=v.json().get('token')
if tok: s.headers['Authorization']='Bearer '+tok
i=s.get(B+'/admin/signup-insights'); print('insights',i.status_code)
j=i.json(); print('keys',list(j.keys())); print('funnel',j.get('funnel'))
txt=json.dumps(j); print('contains /admin path:', '"/admin' in txt or '/cloudivr/admin' in txt)
for k,val in j.items():
    if isinstance(val,list) and val and isinstance(val[0],dict): print(k, len(val), [ (x.get('at') or x.get('createdAt') or x.get('lastAt')) for x in val[:4]])
