import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PhoneCall, Volume2, Bot, Trash2, ArrowUp, ArrowDown, FlaskConical, Loader2 } from 'lucide-react';
import { api, enc, when } from '../../api';
import { Field, Toggle } from '../../ui';
import { cp } from '../../paths';
import { usePrivacy } from '../../privacy';

export const ACTIONS = [
  ['callback', 'Auto Callback', PhoneCall, 'We ring your phone first and read you the text. Press 1 to call them back.'],
  ['message', 'Text-to-Call message', Volume2, 'We call the person who texted and read your message to them.'],
  ['ai', 'AI agent calls them back', Bot, 'Your AI voice agent calls them about their text.'],
];
export const actionOf = (k) => ACTIONS.find(a => a[0] === k) || ACTIONS[0];

function Cond({ label, hint, checked, onChange, testid, children }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div><div className="text-sm">{label}</div>{hint && <div className="text-xs text-[#a1a1aa] mt-0.5">{hint}</div>}</div>
        <Toggle checked={checked} onChange={onChange} testid={testid} />
      </div>
      {checked && children}
    </div>
  );
}

function AgentPick({ r, set, data, t }) {
  if (!data.canAi) return <div className="text-xs text-[#fbbf24]" data-testid={`${t}-ai-locked`}>AI agent call backs are on the Business plan.</div>;
  if (!data.agents.length) return <div className="text-xs text-[#a1a1aa]" data-testid={`${t}-ai-none`}>No AI agents yet. <Link to={cp('/app/ai-agents')} className="text-[#34d399] underline">Create one</Link>, then pick it here.</div>;
  return (
    <Field label="Which AI agent calls">
      <select className="civr-input" value={r.agentId || ''} onChange={e => set({ agentId: e.target.value })} data-testid={`${t}-agent-select`}>
        <option value="">Pick an agent…</option>{data.agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
    </Field>
  );
}

// One trigger: what it does + when it runs.
export function RuleCard({ r, i, n, set, move, remove, data }) {
  const t = `trigger-${i}`;
  const [, name, Icon, what] = actionOf(r.action);
  return (
    <div className={`border rounded-2xl p-5 space-y-5 transition-colors ${r.enabled ? 'border-[#2a2a2a] bg-[#0e0e0e]' : 'border-[#1a1a1a] opacity-70'}`} data-testid={t}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs text-[#a1a1aa]">{String(i + 1).padStart(2, '0')}</span>
        <span className="flex items-center gap-2 font-semibold"><Icon className="w-4 h-4 text-[#34d399]" />{name}</span>
        <div className="ml-auto flex items-center gap-1">
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm !px-2" disabled={i === 0} onClick={() => move(-1)} aria-label="Move up" data-testid={`${t}-up`}><ArrowUp className="w-4 h-4" /></button>
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm !px-2" disabled={i === n - 1} onClick={() => move(1)} aria-label="Move down" data-testid={`${t}-down`}><ArrowDown className="w-4 h-4" /></button>
          <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm !px-2 hover:!text-[#fb7185]" onClick={remove} aria-label="Remove trigger" data-testid={`${t}-remove`}><Trash2 className="w-4 h-4" /></button>
          <Toggle checked={r.enabled} onChange={v => set({ enabled: v })} testid={`${t}-enabled-toggle`} />
        </div>
      </div>
      <p className="text-xs text-[#a1a1aa] -mt-2">{what}</p>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup">
        {ACTIONS.map(([k, label, I]) => (
          <button key={k} type="button" role="radio" aria-checked={r.action === k} onClick={() => set({ action: k })} data-testid={`${t}-action-${k}`}
            className={`flex flex-col items-start gap-1 rounded-xl border px-3 py-2 text-left text-xs transition-colors ${r.action === k ? 'border-[#34d399] bg-[#34d399]/10 text-[#34d399]' : 'border-[#232323] text-[#a1a1aa] hover:text-white'}`}><I className="w-4 h-4" />{label}</button>
        ))}
      </div>
      {r.action === 'message' && (
        <Field label="Message we read to them" hint={`${(r.message || '').length}/500`}>
          <textarea rows={3} maxLength={500} className="civr-input" value={r.message || ''} onChange={e => set({ message: e.target.value })} placeholder="Thanks for your text! We’re open 9 to 5, Monday to Friday. We’ll call you back soon." data-testid={`${t}-message-input`} />
        </Field>
      )}
      {r.action === 'ai' && <AgentPick r={r} set={set} data={data} t={t} />}
      <div className="space-y-4 border-t border-[#1a1a1a] pt-4">
        <Cond label="Only when the text has a keyword" checked={r.keywordOnly} onChange={v => set({ keywordOnly: v })} testid={`${t}-keyword-toggle`}>
          <input className="civr-input" value={r.keywords} onChange={e => set({ keywords: e.target.value })} placeholder="call me, urgent, quote" data-testid={`${t}-keywords-input`} />
          <div className="text-xs text-[#a1a1aa]">Separate words with commas. Capital letters don’t matter.</div>
        </Cond>
        <Cond label="Only during business hours" hint={data.hours.enabled ? `Uses this number’s Hours tab · ${data.hours.openNow ? 'open now' : 'closed now'}` : 'Your Hours tab schedule is off, so this always counts as open.'} checked={r.businessHoursOnly} onChange={v => set({ businessHoursOnly: v })} testid={`${t}-hours-toggle`} />
        <Cond label="Once per sender per hour" hint="More texts from the same person within an hour don’t start another call." checked={r.oncePerHour} onChange={v => set({ oncePerHour: v })} testid={`${t}-once-toggle`} />
      </div>
    </div>
  );
}

const RESULT = { match: ['Runs', 'civr-pill civr-pill-on'], no_keyword: ['No keyword', 'civr-pill'], closed: ['Outside hours', 'civr-pill civr-pill-warn'], off: ['Off', 'civr-pill'], earlier_rule: ['Earlier trigger runs', 'civr-pill'] };

// Sample text → which trigger would run. Never dials.
export function TryText({ num }) {
  const [f, setF] = useState({ from: '+14155550123', text: '' });
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState(null);
  const go = async () => {
    setBusy(true);
    try { setOut(await api(`/numbers/${enc(num.phoneNumber)}/text-triggers/test`, { method: 'POST', body: f })); } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="civr-card p-6 space-y-4" data-testid="triggers-try-card">
      <div className="flex items-center gap-2 font-display text-xl font-bold"><FlaskConical className="w-5 h-5 text-[#38bdf8]" />Try a text</div>
      <p className="text-sm text-[#a1a1aa]">See which saved trigger a text would start. Nothing is dialed.</p>
      <Field label="From"><input className="civr-input font-mono" value={f.from} onChange={e => setF({ ...f, from: e.target.value })} data-testid="triggers-try-from-input" /></Field>
      <Field label="Text"><textarea rows={2} className="civr-input" value={f.text} onChange={e => setF({ ...f, text: e.target.value })} placeholder="Hi, can you call me back?" data-testid="triggers-try-text-input" /></Field>
      <button className="civr-btn civr-btn-ghost civr-btn-sm" disabled={busy} onClick={go} data-testid="triggers-try-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Try it</button>
      {out && (
        <div className="space-y-2 text-sm" data-testid="triggers-try-result">
          {!out.enabled && <div className="text-xs text-[#fbbf24]" data-testid="triggers-try-off-note">Text Triggers are switched off — real texts start nothing until you turn them on.</div>}
          <div className="text-[#f4f4f5]" data-testid="triggers-try-detail">{out.matched ? `${actionOf(out.matched.action)[1]}: ${out.detail}` : out.detail}</div>
          <div className="flex flex-wrap gap-1.5">{out.checks.map(c => <span key={c.id} className={RESULT[c.result]?.[1] || 'civr-pill'} data-testid={`triggers-try-check-${c.index}`}>{`${c.index + 1} · ${RESULT[c.result]?.[0] || c.result}`}</span>)}</div>
        </div>
      )}
    </div>
  );
}

const STATUS = { started: ['Started', 'civr-pill civr-pill-on'], preview: ['Preview', 'civr-pill civr-pill-warn'], skipped: ['Skipped', 'civr-pill'], failed: ['Failed', 'civr-pill civr-pill-bad'] };

export function RunsList({ runs }) {
  const pv = usePrivacy();
  return (
    <div className="civr-card p-6" data-testid="triggers-runs-card">
      <div className="font-display text-xl font-bold mb-4">Recent runs</div>
      {!runs.length ? <div className="text-sm text-[#a1a1aa]" data-testid="triggers-runs-empty">No texts have started a trigger yet.</div> : (
        <ul className="divide-y divide-[#1a1a1a]" data-testid="triggers-runs-list">
          {runs.map((r, i) => (
            <li key={r.id} className="py-3 first:pt-0 space-y-1" data-testid={`triggers-run-${i}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={STATUS[r.status]?.[1] || 'civr-pill'}>{STATUS[r.status]?.[0] || r.status}</span>
                <span className="font-medium">{actionOf(r.action)[1]}</span>
                <span className="font-mono text-xs text-[#a1a1aa]">{pv.phone(r.from)}</span>
                <span className="ml-auto text-xs text-[#a1a1aa]">{when(r.at)}</span>
              </div>
              {r.body && <div className="text-xs text-[#e4e4e7] italic break-words">{pv.text(`“${r.body}”`, 'Message hidden')}</div>}
              <div className="text-xs text-[#a1a1aa]">{r.detail}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
