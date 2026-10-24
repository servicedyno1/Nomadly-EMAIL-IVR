import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Ear, Keyboard, PhoneCall } from 'lucide-react';
import { useApi, money } from '../api';
import { PageHeader } from '../ui';
import { Setup } from './textcall/Setup';
import { LiveCall } from './textcall/Live';
import { History } from './textcall/History';

const STEPS = [
  [PhoneCall, 'Call any phone', 'Pick your CloudIVR number and the number to call. We tell them it is a typed call.'],
  [Keyboard, 'You type', 'A clear voice reads every message to them. Quick phrases and a keypad for phone menus are one tap away.'],
  [Ear, 'You read their words', 'What they say shows up as live text while they talk — in English, Spanish or French.'],
];

function HowItWorks({ info }) {
  return (
    <aside className="civr-card p-6 space-y-5 h-fit" data-testid="text-call-how">
      <div className="civr-label">How it works</div>
      {STEPS.map(([Icon, t, s], i) => (
        <div key={t} className="flex gap-3"><div className="w-9 h-9 shrink-0 rounded-xl bg-[#34d399]/10 text-[#34d399] flex items-center justify-center"><Icon className="w-4 h-4" /></div>
          <div><div className="font-semibold text-sm">{i + 1}. {t}</div><div className="text-xs text-[#a1a1aa] mt-0.5">{s}</div></div></div>
      ))}
      {info && <div className="border-t border-white/10 pt-4 text-xs text-[#a1a1aa] space-y-1" data-testid="text-call-pricing">
        <div>{`US & Canada: ${money(info.usRate + info.relayRate)}/min`}</div>
        <div>{`International: ${money(info.intlRate + info.relayRate)}/min`}</div>
        <div>{`Includes ${money(info.relayRate)}/min for the text relay.`}</div>
        <div>Included on Pro and Business numbers. Transcripts are kept 90 days.</div>
      </div>}
    </aside>
  );
}

export default function TextCall() {
  const { data: info } = useApi('/relay/info');
  const [callId, setCallId] = useState(null);
  const [round, setRound] = useState(0);
  const { state } = useLocation();
  useEffect(() => { if (info?.live) setCallId(info.live); }, [info?.live]);
  // Answered from the ringing banner ("Answer as text").
  useEffect(() => { if (state?.liveId) setCallId(state.liveId); }, [state?.liveId]);
  return (
    <div data-testid="text-call-page">
      <PageHeader label="Calling" title="Text calls" sub="For deaf and hard-of-hearing callers: you type and they hear a voice; they talk and you read their words live." testid="text-call-header" />
      <div className="grid lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">{callId ? <LiveCall id={callId} onClose={() => { setCallId(null); setRound(r => r + 1); }} /> : <Setup info={info} onStarted={setCallId} />}</div>
        <HowItWorks info={info} />
      </div>
      <History key={round} onOpenLive={setCallId} />
    </div>
  );
}
