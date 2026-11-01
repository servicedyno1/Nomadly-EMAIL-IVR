import React from 'react';
import { Link } from 'react-router-dom';
import { MessageSquareText, Wallet, Phone, ArrowRight } from 'lucide-react';
import { useApi, money, when, enc } from '../../api';
import { cp } from '../../paths';
import { STATUS } from '../texting/NumberPanel';
import { usePrivacy } from '../../privacy';

// Overview for customers whose only product is the Texting plan.
export function TextingHome({ items, balance }) {
  const pv = usePrivacy();
  const { data } = useApi('/hosted-sms/recent?limit=8');
  const live = items.filter(x => !['rejected', 'cancelled'].includes(x.status));
  const msgs = data?.messages;
  return (
    <div className="grid lg:grid-cols-12 gap-6 items-start" data-testid="texting-home">
      <div className="lg:col-span-5 space-y-4">
        <div className="civr-label !text-[#a1a1aa]">Your texting numbers</div>
        {live.map(x => (
          <Link key={x.id} to={cp(`/app/texting?id=${enc(x.id)}`)} className="civr-card civr-card-link p-4 flex items-center gap-3" data-testid={`texting-home-number-${x.phoneNumber.replace(/\D/g, '')}`}>
            <MessageSquareText className="w-5 h-5 text-[#818cf8] shrink-0" />
            <div className="flex-1 min-w-0"><div className="font-mono" data-no-translate>{pv.phone(x.phoneNumber)}</div><div className={`text-xs mt-0.5 ${STATUS[x.status]?.tone || ''}`}>{STATUS[x.status]?.label || x.status}</div></div>
            <ArrowRight className="w-4 h-4 text-[#a1a1aa]" />
          </Link>
        ))}
        <Link to={cp('/app/wallet')} className="civr-card civr-card-link p-4 flex items-center gap-3" data-testid="texting-home-wallet">
          <Wallet className="w-5 h-5 text-[#818cf8]" /><div className="flex-1"><div className="text-xs text-[#a1a1aa]">Wallet</div><div className="font-mono text-xl" data-testid="texting-home-balance">{money(balance)}</div></div>
        </Link>
        <div className="civr-card p-4 flex items-center gap-3" data-testid="texting-home-upsell">
          <Phone className="w-5 h-5 text-[#818cf8] shrink-0" />
          <div className="flex-1 text-sm"><div className="font-semibold">Want calls too?</div><div className="text-xs text-[#a1a1aa]">Get a CloudIVR number for menus, forwarding and AI agents.</div></div>
          <Link to={cp('/app/buy')} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="texting-home-buy">Get a number</Link>
        </div>
      </div>
      <div className="lg:col-span-7 civr-card p-6" data-testid="texting-home-latest">
        <div className="flex items-center justify-between gap-2 mb-4"><div className="font-display text-2xl font-bold">Latest texts</div><Link to={cp('/app/texting')} className="text-sm text-[#818cf8] underline underline-offset-2 py-2" data-testid="texting-home-open">Open texting</Link></div>
        {!msgs ? <p className="text-sm text-[#a1a1aa]">…</p> : !msgs.length ? <p className="text-sm text-[#a1a1aa]" data-testid="texting-home-empty">No texts yet. When a customer texts one of your numbers, it shows up here.</p> : (
          <ul className="space-y-3">{msgs.map(m => (
            <li key={m.id} className="rounded-xl bg-[#1a1a1a] px-4 py-3" data-testid="texting-home-message">
              <div className="text-xs text-[#a1a1aa] font-mono flex flex-wrap gap-x-2" data-no-translate><span>{pv.phone(m.from)}</span><span>→ {pv.phone(m.phoneNumber)}</span><span>· {when(m.at)}</span></div>
              <div className="text-sm mt-1 break-words">{pv.text(m.body, 'Message hidden')}</div>
            </li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}
