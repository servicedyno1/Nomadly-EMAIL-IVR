import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ArrowUpCircle, Loader2 } from 'lucide-react';
import { useApi, enc, usd } from './api';
import { useShell } from './Shell';
import { PlanFeatures, unlocks } from './PlanFeatures';
import { cp } from './paths';

// "This is on the Business plan" pop-up for locked features.
//   showUpgrade({ feature: 'Scheduling', need: 'business', phone: '+1…' })  — need = plan id or name, phone = number to upgrade.
let open = null;
export const showUpgrade = (req) => open?.(req);

const planOf = (plans, need) => (plans || []).find(p => p.id === need || p.name === need) || null;

// Active main numbers on a cheaper plan than `plan` (the ones that can be upgraded to it).
function useCandidates(plan, plans, enabled) {
  const { data } = useApi(enabled ? '/numbers' : null);
  const order = (plans || []).map(p => p.id);
  return { loading: !data, nums: (data?.numbers || []).filter(n => n.status === 'active' && !n.isSubNumber && order.indexOf(n.plan) < order.indexOf(plan?.id)) };
}

function Dialog({ req, plan, plans, onClose }) {
  const nav = useNavigate();
  const box = useRef(null);
  const { nums, loading } = useCandidates(plan, plans, true);
  const [pick, setPick] = useState(req.phone || '');
  const phone = nums.some(n => n.phoneNumber === pick) ? pick : nums[0]?.phoneNumber;
  const from = nums.find(n => n.phoneNumber === phone)?.plan || (plans || [])[0]?.id;
  const adds = unlocks(plans, from, plan.id);
  useEffect(() => { box.current?.querySelector('[data-testid="upgrade-dialog-go"]')?.focus(); }, []);
  const go = () => { onClose(); nav(phone ? cp(`/app/numbers/${enc(phone)}?tab=billing&plan=${plan.id}`) : cp(`/app/buy?plan=${plan.id}`)); };
  return (
    <div ref={box} role="dialog" aria-modal="true" aria-labelledby="civr-upgrade-title" className="civr-card !bg-[#111] w-full max-w-md p-6 civr-rise shadow-2xl shadow-black/60 max-h-[90vh] overflow-y-auto" data-testid="upgrade-dialog">
      <div className="flex gap-3 items-start">
        <span className="w-10 h-10 shrink-0 rounded-xl bg-[#fbbf24]/10 text-[#fbbf24] flex items-center justify-center"><Lock className="w-5 h-5" /></span>
        <div className="min-w-0">
          <div id="civr-upgrade-title" className="font-semibold text-[#f3f4f6]" data-testid="upgrade-dialog-title">{`${req.feature} is on the ${plan.name} plan`}</div>
          <p className="text-sm text-[#a1a1aa] mt-1" data-testid="upgrade-dialog-price">{`${plan.name} is ${usd(plan.price)}/month per number. Your renewal date stays the same, and within 14 days of buying 25% of your current plan price comes off.`}</p>
        </div>
      </div>
      {adds.length > 0 && <div className="mt-5" data-testid="upgrade-dialog-unlocks"><div className="civr-label mb-2">{`${plan.name} also gives you`}</div><PlanFeatures plan={{ webFeatures: adds }} compact testid="upgrade-dialog-feature" /></div>}
      {nums.length > 1 && <label className="block mt-5"><span className="civr-label mb-2 block">Number to upgrade</span>
        <select className="civr-input font-mono" value={phone} onChange={e => setPick(e.target.value)} data-testid="upgrade-dialog-number-select">{nums.map(n => <option key={n.phoneNumber} value={n.phoneNumber}>{`${n.phoneNumber} · ${n.planName}`}</option>)}</select></label>}
      <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button type="button" className="civr-btn civr-btn-ghost" onClick={onClose} data-testid="upgrade-dialog-cancel">Not now</button>
        <button type="button" className="civr-btn civr-btn-primary" onClick={go} disabled={loading} aria-busy={loading} data-testid="upgrade-dialog-go">{loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUpCircle className="w-4 h-4" />}{loading ? 'Checking your numbers…' : phone ? `Upgrade ${phone}` : `Buy a ${plan.name} number`}</button>
      </div>
    </div>
  );
}

export function UpgradeHost() {
  const { catalog } = useShell();
  const [req, setReq] = useState(null);
  useEffect(() => { open = setReq; return () => { open = null; }; }, []);
  useEffect(() => {
    if (!req) return undefined;
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); setReq(null); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [req]);
  const plan = req && planOf(catalog?.plans, req.need);
  if (!req || !plan) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget) setReq(null); }} data-testid="upgrade-dialog-backdrop">
      <Dialog req={req} plan={plan} plans={catalog.plans} onClose={() => setReq(null)} />
    </div>
  );
}

// Small "🔒 Business" pill that opens the pop-up.
export function PlanLock({ feature, need = 'business', phone, testid, label }) {
  const { catalog } = useShell();
  const name = planOf(catalog?.plans, need)?.name || need;
  return (
    <button type="button" onClick={() => showUpgrade({ feature, need, phone })} className="civr-pill civr-pill-warn cursor-pointer !normal-case !tracking-normal inline-flex items-center gap-1 hover:brightness-125 transition-[filter]" data-testid={testid}>
      <Lock className="w-3 h-3" />{label || name}
    </button>
  );
}

// One-line locked note: lock icon, what it is, and the pill.
export function LockedNote({ text, feature, need, phone, testid }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-[#a1a1aa]" data-testid={testid}>
      <Lock className="w-3.5 h-3.5 text-[#fbbf24] shrink-0" /><span>{text}</span>
      <PlanLock feature={feature} need={need} phone={phone} testid={`${testid}-button`} />
    </div>
  );
}
