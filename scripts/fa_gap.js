require('dotenv').config({path:'/app/backend/.env'});
const fa=require('/app/js/lang/fa.js').fa, en=require('/app/js/lang/en.js').en;
const D=[1,'x',2,'y',3,'z'];const S=[],F=[];
const eng=v=>/[a-z]{4}/i.test(String(v).replace(/<[^>]+>|\$\{[^}]*\}|https?:\S+|@\w+|\/\w+/g,''));
(function w(e,G,p){for(const k in e){const ev=e[k],fv=G?.[k];const kp=p.concat(k);
 if(typeof ev==='string'){if(ev===fv&&eng(ev))S.push(kp)}
 else if(typeof ev==='function'){try{const a=ev(...D),b=fv(...D);if(a===b&&typeof a==='string'&&eng(a))F.push(kp)}catch(_){}}
 else if(ev&&typeof ev==='object'&&!Array.isArray(ev))w(ev,fv,kp)}})(en,fa,[]);
module.exports={S,F,en,fa};
if(require.main===module){console.log('strings',S.length,'fns',F.length);console.log(S.map(x=>x.join('.')).join(' '));console.log(F.map(x=>x.join('.')).join(' '))}
