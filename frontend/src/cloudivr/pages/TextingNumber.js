import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { MessageSquare, Globe, KeyRound, Smartphone, MessageSquareText } from 'lucide-react';
import { useApi } from '../api';
import { cp } from '../paths';
import { PageHeader, Spinner } from '../ui';
import { MobileOffer } from './buy/MobileOffer';
import { ReadyToText } from './buy/ReadyToText';
import { MobileLines } from './number/MobileLines';

const POINTS = [
  [MessageSquare, 'Send and receive texts', 'Every text shows up in Messages, right next to your calls and voicemails.'],
  [KeyRound, 'Gets verification codes', 'A real USA carrier number, not VoIP, so most banks and apps accept it.'],
  [Globe, 'Works in your browser', 'No phone or SIM needed. You can also call out from the browser phone.'],
];

function Others() {
  return (
    <div className="grid sm:grid-cols-2 gap-3" data-testid="texting-number-others">
      <Link to={cp('/app/esim')} className="civr-card p-4 flex items-start gap-3" data-testid="texting-number-other-esim">
        <Smartphone className="w-5 h-5 text-[var(--c-muted)] mt-0.5" /><span><span className="block font-semibold text-sm">Want the texts on your own phone?</span><span className="block text-xs text-[var(--c-muted)] mt-1">Get a USA eSIM instead.</span></span>
      </Link>
      <Link to={cp('/app/texting?add=1')} className="civr-card p-4 flex items-start gap-3" data-testid="texting-number-other-landline">
        <MessageSquareText className="w-5 h-5 text-[var(--c-muted)] mt-0.5" /><span><span className="block font-semibold text-sm">Keep the number you already have?</span><span className="block text-xs text-[var(--c-muted)] mt-1">Add texting to your landline instead.</span></span>
      </Link>
    </div>
  );
}

export default function TextingNumber() {
  const { data, reload } = useApi('/mobile-numbers');
  const nav = useNavigate();
  if (!data) return <Spinner />;
  const has = !!data.items?.length;
  return (
    <div className="space-y-8" data-testid="texting-number-page">
      <PageHeader label="Phone numbers" title="Texting Number" sub="A USA number for sending and receiving texts right here in CloudIVR." testid="texting-number-header" />
      <div className="grid sm:grid-cols-3 gap-4" data-testid="texting-number-points">
        {POINTS.map(([Icon, title, sub]) => <div key={title} className="civr-card p-5"><Icon className="w-5 h-5 text-[#818cf8]" /><div className="font-semibold mt-3">{title}</div><div className="text-sm text-[var(--c-muted)] mt-1">{sub}</div></div>)}
      </div>
      {has && <MobileLines noEmpty />}
      {data.available ? <MobileOffer open={!has} onBought={() => { reload(); nav(cp('/app/texting-number')); }} />
        : <p className="text-sm text-[#fbbf24]" data-testid="texting-number-unavailable">Texting Numbers are temporarily unavailable. Try again later.</p>}
      <ReadyToText />
      <Others />
    </div>
  );
}
