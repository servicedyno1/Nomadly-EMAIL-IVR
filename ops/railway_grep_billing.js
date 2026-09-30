require('dotenv').config({path:'/app/backend/.env'});
const TOK=process.env.API_KEY_RAILWAY, ENV='889fd56a-720a-4020-884c-034784992666', SVC='b9c4ad64-7667-4dd3-8b9a-3867ede47885';
const Q='query E($e:String!,$f:String,$a:String,$al:Int,$bl:Int!){environmentLogs(environmentId:$e,filter:$f,anchorDate:$a,afterLimit:$al,beforeLimit:$bl){timestamp message}}';
const days=Number(process.env.DAYS||7), show=Number(process.env.SHOW||1);
(async()=>{
 for (const f of process.argv.slice(2)) {
  const r=await fetch('https://backboard.railway.app/graphql/v2',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'Mozilla/5.0','Project-Access-Token':TOK},body:JSON.stringify({query:Q,variables:{e:ENV,f:'@service:'+SVC+' '+f,a:new Date(Date.now()-days*86400e3).toISOString(),al:1000,bl:0}})});
  const j=await r.json(); const rows=j.data?.environmentLogs||[];
  console.log('\n'+f.padEnd(40), rows.length);
  rows.slice(-show).forEach(x=>console.log('   ',x.timestamp.slice(0,19),'|',x.message.replace(/\s+/g,' ').slice(0,230)));
 }
})();
