// Helpers for driving sandbox bot through full menu then into VPS flow
const { makeSim, inlineOf, strip, sleep } = require('/app/scripts/lib/tg_sim.js')

function kbOf(msgs) { const r = []; for (const m of msgs) if (Array.isArray(m.kb)) r.push(...m.kb); return r }

async function openVpsDetails(sim) {
  // /start → English → 👀 Just looking → 🖥️ VPS / RDP → 📋 My VPS → plantest-vps
  let s = await sim.step({ kind: 'text', v: '/start' })
  if (kbOf(s.msgs).some(k => /English/i.test(k))) {
    s = await sim.step({ kind: 'text', v: kbOf(s.msgs).find(k => /English/i.test(k)) })
  }
  // If initial 5-option menu
  let kb = kbOf(s.msgs)
  if (kb.some(k => /Just looking/i.test(k))) {
    s = await sim.step({ kind: 'text', v: kb.find(k => /Just looking/i.test(k)) })
    kb = kbOf(s.msgs)
  }
  const vpsBtn = kb.find(k => /VPS \/ RDP|VPS\s*\/\s*RDP/i.test(k))
  if (!vpsBtn) throw new Error('main menu lacks "VPS / RDP" button; got: ' + kb.join(' | '))
  s = await sim.step({ kind: 'text', v: vpsBtn })
  // VPS/RDP menu — contains "📋 My VPS" possibly as inline or kb
  let kb2 = kbOf(s.msgs); let il2 = inlineOf(s.msgs)
  const myKb = kb2.find(k => /My VPS|Manage my servers/i.test(k) && !/Create/i.test(k))
  const myIl = il2.find(b => /My VPS|Manage my servers|📋/i.test(b.t) && !/Create/i.test(b.t))
  if (myKb) s = await sim.step({ kind: 'text', v: myKb })
  else if (myIl) s = await sim.step({ kind: 'cb', data: myIl.d })
  else throw new Error('cannot find My VPS; kb=' + kb2.join(' | ') + '; inline=' + il2.map(b => b.t).join(' | '))
  // list of VPSes — plantest-vps likely inline
  let il3 = inlineOf(s.msgs); let kb3 = kbOf(s.msgs)
  const plantestIl = il3.find(b => /plantest-vps/i.test(b.t))
  const plantestKb = kb3.find(k => /plantest-vps/i.test(k))
  if (plantestIl) s = await sim.step({ kind: 'cb', data: plantestIl.d })
  else if (plantestKb) s = await sim.step({ kind: 'text', v: plantestKb })
  else throw new Error('plantest-vps not in list; kb=' + kb3.join(' | ') + '; inline=' + il3.map(b => b.t).join(' | '))
  return s
}

module.exports = { kbOf, openVpsDetails, inlineOf, strip, sleep, makeSim }
