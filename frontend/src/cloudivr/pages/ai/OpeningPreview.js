import React, { useEffect, useState } from 'react';
import { PhoneIncoming, PhoneOutgoing, ChevronDown, Sparkles } from 'lucide-react';
import { api } from '../../api';

function Line({ icon: Icon, label, o, testid, extra }) {
  return (
    <div className="flex gap-3" data-testid={testid}>
      <Icon className="w-4 h-4 mt-0.5 shrink-0 text-[#818cf8]" />
      <div className="min-w-0">
        <div className="text-[11px] font-mono uppercase tracking-wider text-[#a1a1aa]">{label}</div>
        <div className="text-sm text-[#e4e4e7] mt-0.5" data-no-translate data-testid={`${testid}-text`}>{o ? `“${o.text}”` : '…'}</div>
        {extra}
      </div>
    </div>
  );
}

// Exactly what the agent says first, rendered by the server from the unsaved form values (debounced).
export function OpeningPreview({ f }) {
  const [p, setP] = useState(null);
  const [failed, setFailed] = useState(false);
  const { name, businessName, language, firstMessage, greeting, record } = f;
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api('/ai-agents/opening-preview', { method: 'POST', body: { name, businessName, language, firstMessage, greeting, record: record !== false } })
        .then(d => { if (live) { setP(d); setFailed(false); } })
        .catch(() => { if (live) setFailed(true); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [name, businessName, language, firstMessage, greeting, record]);
  if (failed && !p) return null;
  const added = p && (p.outbound.aiAdded || p.outbound.recAdded || p.inbound.aiAdded || p.inbound.recAdded);
  return (
    <div className="rounded-xl border border-[#2a2a2a] bg-[#111] p-4 space-y-3" data-testid="ai-opening-preview">
      <div className="text-xs font-semibold text-[#e4e4e7]">What the agent says first</div>
      <Line icon={PhoneOutgoing} label={`When it calls a lead (sample name “${p?.sampleLead || 'Alex'}”)`} o={p?.outbound} testid="ai-opening-preview-outbound"
        extra={p?.outboundNoName && <div className="text-xs text-[#a1a1aa] mt-1" data-testid="ai-opening-preview-noname"><span>Lead without a name:</span> <span data-no-translate>{`“${p.outboundNoName}”`}</span></div>} />
      <Line icon={PhoneIncoming} label="When it answers your number" o={p?.inbound} testid="ai-opening-preview-inbound" />
      {added && <div className="flex gap-2 text-xs text-[#a1a1aa]" data-testid="ai-opening-preview-added-note"><Sparkles className="w-3.5 h-3.5 shrink-0 text-[#fbbf24] mt-0.5" />The AI notice and, on recorded calls, the recording notice are added for you when your text leaves them out. They are required on every call.</div>}
    </div>
  );
}

const TIPS = [
  ['Write goals and rules, not a word-for-word speech', 'Say what the agent should find out and how it should sound. A long speech makes it talk in long blocks and sound robotic.'],
  ['Put the greeting in “First message” only', 'The agent opens the call with your first message and never greets again. Start the script with what comes after the greeting.'],
  ['Keep it short and ask one question at a time', 'Phone replies should be one or two short sentences. List the questions in the order you want them asked.'],
  ['Put prices, hours and policies in “FAQs & facts”', 'The agent only states facts that are written there, so it never invents a price or a promise.'],
  ['Tell it how to end', 'Say when to transfer, when to take a message and when to say goodbye. Notes in [brackets] are never read aloud.'],
];

export function ScriptGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-[#2a2a2a]" data-testid="ai-script-guide">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium min-h-[44px]" aria-expanded={open} data-testid="ai-script-guide-toggle">
        How to write a script that sounds natural
        <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ol className="px-4 pb-4 space-y-3 text-sm" data-testid="ai-script-guide-list">
          {TIPS.map(([t, d], i) => (
            <li key={t} className="flex gap-3" data-testid={`ai-script-guide-tip-${i}`}>
              <span className="w-5 h-5 rounded-full bg-[#818cf8]/15 text-[#818cf8] text-xs flex items-center justify-center shrink-0">{i + 1}</span>
              <span><span className="font-medium text-[#e4e4e7]">{t}</span><span className="block text-xs text-[#a1a1aa] mt-0.5">{d}</span></span>
            </li>
          ))}
          <li className="text-xs text-[#a1a1aa] pt-1" data-testid="ai-script-guide-example">{'Example first message: “Hi {lead_name|there}, this is {name} from {business}. You asked about solar panels last week, do you have a minute?”'}</li>
        </ol>
      )}
    </div>
  );
}
