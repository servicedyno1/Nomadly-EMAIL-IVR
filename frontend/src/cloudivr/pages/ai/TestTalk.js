import React, { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Mic, PhoneOff, Loader2 } from 'lucide-react';
import { api } from '../../api';
import { IS_CIVR_DOMAIN } from '../../paths';
import { startTalk } from './talk';

const wsUrl = (path) => {
  const base = IS_CIVR_DOMAIN || !process.env.REACT_APP_BACKEND_URL ? window.location.origin : process.env.REACT_APP_BACKEND_URL;
  return base.replace(/^http/, 'ws') + path;
};

function Bubble({ t, i }) {
  const me = t.role === 'caller';
  return (
    <div className={`flex ${me ? 'justify-end' : 'justify-start'} civr-rise`} data-testid={`ai-test-line-${i}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${me ? 'bg-[#34d399]/15 text-[#d1fae5]' : 'bg-[#1a1a1a] text-[#e4e4e7]'}`}>
        <div className="text-[10px] font-mono uppercase tracking-wider opacity-60 mb-0.5">{me ? 'You' : 'Agent'}</div>{t.text}
      </div>
    </div>
  );
}

// Free browser test talk with an agent (no phone call, no charge).
export function TestTalk({ agent }) {
  const [as, setAs] = useState('inbound');
  const [state, setState] = useState('idle');
  const [lines, setLines] = useState([]);
  const [left, setLeft] = useState(0);
  const talk = useRef(null);
  useEffect(() => () => talk.current?.stop(), []);
  useEffect(() => { if (state !== 'live') return undefined; const t = setInterval(() => setLeft(s => Math.max(0, s - 1)), 1000); return () => clearInterval(t); }, [state]);

  const start = async () => {
    setState('connecting'); setLines([]);
    try {
      const d = await api(`/ai-agents/${agent.id}/test`, { method: 'POST', body: { as } });
      setLeft(d.maxSeconds);
      talk.current = await startTalk(wsUrl(d.path), (e) => {
        if (e.event === 'transcript') setLines(l => [...l, e]);
        else if (e.event === 'notice') toast.message(e.text);
        else if (e.event === 'closed') { setState('ended'); talk.current = null; }
      });
      setState('live');
    } catch (e) { toast.error(e.name === 'NotAllowedError' ? 'Allow the microphone to talk to your agent.' : e.message); setState('idle'); }
  };

  return (
    <div className="civr-card p-6" data-testid="ai-test-talk">
      <div className="font-display text-2xl font-bold">Talk to {agent.name}</div>
      <p className="text-sm text-[#a1a1aa] mt-1">Free test in your browser — use your microphone. Up to 3 minutes per talk, 15 minutes a day.</p>
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <select className="civr-input !w-auto" value={as} onChange={e => setAs(e.target.value)} disabled={state === 'live'} data-testid="ai-test-direction-select">
          <option value="inbound">As a caller ringing your number</option><option value="outbound">As a lead the agent calls</option>
        </select>
        {state === 'live'
          ? <button className="civr-btn civr-btn-danger" onClick={() => talk.current?.stop()} data-testid="ai-test-end-button"><PhoneOff className="w-4 h-4" />End · {left}s</button>
          : <button className="civr-btn civr-btn-primary" onClick={start} disabled={state === 'connecting'} data-testid="ai-test-start-button">{state === 'connecting' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}Start talking</button>}
        {state === 'live' && <span className="civr-pill civr-pill-on civr-pulse" data-testid="ai-test-live-pill">live</span>}
      </div>
      {lines.length > 0 && <div className="mt-5 space-y-2 max-h-80 overflow-y-auto" data-testid="ai-test-transcript">{lines.map((t, i) => <Bubble key={i} t={t} i={i} />)}</div>}
      {state === 'ended' && <p className="text-xs text-[#a1a1aa] mt-3" data-testid="ai-test-ended-note">Talk ended — the summary is in Call history.</p>}
    </div>
  );
}
