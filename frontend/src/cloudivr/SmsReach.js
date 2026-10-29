import { openHelpChat } from './shortcuts';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Ban, Tag, Globe2 } from 'lucide-react';
import { api, useApi, enc } from './api';
import { cp } from './paths';

const STATUS = {
  ready: ['Ready to text', 'civr-pill civr-pill-ok', CheckCircle2],
  limited: ['Limited texting', 'civr-pill civr-pill-warn', AlertTriangle],
  approval: ['Needs texting approval', 'civr-pill civr-pill-bad', Ban],
};
const price = (p) => `$${Number(p || 0).toFixed(2)}`;

// "Ready / Limited / Needs approval" for one number + the countries it can text (tap to open).
export function ReachChip({ phone, testid = 'sms-reach' }) {
  const { data } = useApi(phone ? `/sms-reach?phone=${enc(phone)}` : null);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const [label, cls, Icon] = STATUS[data.status] || STATUS.limited;
  const ok = data.countries.filter(c => c.ok);
  return (
    <div className="space-y-2" data-testid={testid} data-status={data.status}>
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={`${cls} !cursor-pointer`} data-testid={`${testid}-chip`}>
        <Icon className="w-3.5 h-3.5" />{label}<span className="opacity-90">· {ok.length ? `can text ${ok.length} ${ok.length === 1 ? 'country' : 'countries'}` : 'receiving only'}</span>
      </button>
      {data.status !== 'ready' && <p className="text-xs text-[#a1a1aa] max-w-xl" data-testid={`${testid}-note`}>{data.note}</p>}
      {open && (
        <ul className="civr-card p-3 grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs max-w-2xl" data-testid={`${testid}-list`}>
          {data.countries.map(c => (
            <li key={c.iso} className="flex items-start gap-2" data-testid={`${testid}-country-${c.iso}`} title={c.why || ''}>
              {c.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-px text-[#34d399] shrink-0" /> : <Ban className="w-3.5 h-3.5 mt-px text-[#a1a1aa] shrink-0" />}
              <span className="min-w-0"><span className={c.ok ? '' : 'text-[#a1a1aa]'}>{c.name}</span>{' '}<span className="text-[#a1a1aa]">{c.ok ? `${price(c.price)}${c.mode === 'brand' ? ' · as your sender name' : ''}` : c.mode === 'approval' ? 'needs approval' : c.mode === 'brand' ? 'set a sender name' : 'not available'}</span></span>
            </li>
          ))}
          <li className="sm:col-span-2 pt-1 text-[#a1a1aa]">Receiving texts works from any country.</li>
        </ul>
      )}
    </div>
  );
}

// Live check of one destination while typing: country, price, sender, or why it can't be sent.
export function useDestCheck(phone, to) {
  const [r, setR] = useState(null);
  useEffect(() => {
    const dest = String(to || '').replace(/[^\d+]/g, '');
    if (!phone || dest.length < 8) { setR(null); return undefined; }
    let live = true;
    const t = setTimeout(() => api('/sms-reach/check', { method: 'POST', body: { phone, to: dest } }).then(x => live && setR(x)).catch(() => live && setR(null)), 350);
    return () => { live = false; clearTimeout(t); };
  }, [phone, to]);
  return r;
}

export function DestNote({ check, testid = 'sms-dest-note' }) {
  if (!check) return null;
  if (!check.ok) {
    const needsName = check.mode === 'brand';
    const needsReg = check.mode === 'approval' && /10DLC|toll-free/i.test(check.why || '');
    return (
      <p className="flex items-start gap-1.5 text-xs text-[#fbbf24]" role="status" data-testid={testid} data-ok="false">
        <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" /><span>{check.why}{needsName && <> <Link to={cp('/app/settings#sender-name')} className="underline" data-testid={`${testid}-settings-link`}>Set it now</Link></>}
          {needsReg && <> <button type="button" className="underline" onClick={() => openHelpChat('Please help me register my number for business texting (10DLC / toll-free approval) so I can text US mobiles.')} data-testid={`${testid}-register-button`}>Ask us to register it</button></>}</span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-xs text-[#a1a1aa]" role="status" data-testid={testid} data-ok="true">
      {check.mode === 'brand' ? <Tag className="w-3.5 h-3.5 mt-px shrink-0" /> : <Globe2 className="w-3.5 h-3.5 mt-px shrink-0" />}
      <span>{`${check.country} · ${price(check.price)} per text`}{check.mode === 'brand' ? ` · ${check.why}` : ''}</span>
    </p>
  );
}
