import React, { useState } from 'react';
import { toast } from 'sonner';
import { Zap, Plus, Loader2 } from 'lucide-react';
import { api, enc, useApi } from '../../api';
import { Field, Toggle, Spinner, ErrorNote } from '../../ui';
import { useUnsaved, SaveRow } from '../../guard';
import { RuleCard, TryText, RunsList, ACTIONS } from './TriggerParts';

const MAX = 5;
const fromSaved = (r) => ({ ...r, keywords: (r.keywords || []).join(', '), message: r.message || '', agentId: r.agentId || '' });
const blank = (action) => ({ id: '', enabled: true, action, keywordOnly: false, keywords: '', businessHoursOnly: false, oncePerHour: true, message: '', agentId: '' });

function Editor({ num, data, reload }) {
  const saved = data.textTriggers;
  const [f, setF] = useState(() => ({ enabled: !!saved.enabled, myPhone: saved.myPhone || '', rules: (saved.rules || []).map(fromSaved) }));
  const [busy, setBusy] = useState(false);
  const u = useUnsaved(f);
  const setRule = (i, patch) => setF(x => ({ ...x, rules: x.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const move = (i, d) => setF(x => { const rules = [...x.rules]; [rules[i], rules[i + d]] = [rules[i + d], rules[i]]; return { ...x, rules }; });
  const remove = (i) => setF(x => ({ ...x, rules: x.rules.filter((_, j) => j !== i) }));
  const add = (action) => setF(x => ({ ...x, enabled: x.rules.length ? x.enabled : true, rules: [...x.rules, blank(action)] }));
  const save = async () => {
    setBusy(true);
    try {
      await api(`/numbers/${enc(num.phoneNumber)}/text-triggers`, { method: 'PUT', body: f });
      toast.success(f.enabled ? 'Text Triggers saved and on' : 'Text Triggers saved (off)');
      u.reset(); reload();
    } catch (e) { toast.error(e.message); } finally { setBusy(false); }
  };
  const needsPhone = f.rules.some(r => r.action === 'callback');
  return (
    <div className="civr-card p-6 space-y-6" data-testid="triggers-card" {...u.bind}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 font-display text-2xl font-bold"><Zap className="w-5 h-5 text-[#34d399]" />Text Triggers</div>
          <p className="text-sm text-[#a1a1aa] mt-1 max-w-xl">When a text arrives on this number, start a call automatically. Triggers are checked from top to bottom — the first one that matches runs.</p>
        </div>
        <div className="flex items-center gap-3"><span className="text-sm">{f.enabled ? 'On' : 'Off'}</span><Toggle checked={f.enabled} onChange={v => setF({ ...f, enabled: v })} testid="triggers-enabled-toggle" /></div>
      </div>
      <Field label="Your phone" hint={needsPhone ? 'Auto Callback rings this phone first, then connects you to the person who texted.' : 'Used by Auto Callback. Include the country code.'}>
        <input className="civr-input font-mono" value={f.myPhone} onChange={e => setF({ ...f, myPhone: e.target.value })} placeholder="+14155550100" data-testid="triggers-my-phone-input" />
      </Field>
      <div className="space-y-3" data-testid="triggers-list">
        {!f.rules.length && <div className="text-sm text-[#a1a1aa] border border-dashed border-[#2a2a2a] rounded-2xl p-6 text-center" data-testid="triggers-empty">No triggers yet. Add one below.</div>}
        {f.rules.map((r, i) => <RuleCard key={i} r={r} i={i} n={f.rules.length} data={data} set={(p) => setRule(i, p)} move={(d) => move(i, d)} remove={() => remove(i)} />)}
      </div>
      {f.rules.length < MAX && (
        <div className="flex flex-wrap gap-2" data-testid="triggers-add-row">
          {ACTIONS.map(([k, label]) => <button key={k} type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => add(k)} data-testid={`triggers-add-${k}`}><Plus className="w-4 h-4" />{label}</button>)}
        </div>
      )}
      <p className="text-xs text-[#a1a1aa]" data-testid="triggers-cost-note">{`Calls bill from your wallet: about $${Number(data.rates.call).toFixed(2)}/min per call leg (Auto Callback uses two legs), AI agent calls $${Number(data.rates.ai).toFixed(2)}/min. Nothing runs if your wallet is below $1.`}</p>
      <SaveRow dirty={u.dirty} testid="triggers-unsaved-pill"><button className="civr-btn civr-btn-primary" disabled={busy} onClick={save} data-testid="triggers-save-button">{busy && <Loader2 className="w-4 h-4 animate-spin" />}Save Text Triggers</button></SaveRow>
    </div>
  );
}

export default function TextTriggersTab({ num }) {
  const { data, error, loading, reload } = useApi(`/numbers/${enc(num.phoneNumber)}/text-triggers`);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNote error={error} />;
  if (!num.capabilities?.sms) return <div className="civr-card p-6 text-sm text-[#a1a1aa]" data-testid="triggers-no-sms">This number can’t receive text messages, so Text Triggers can’t run on it.</div>;
  return (
    <div className="grid xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-start">
      <Editor key={JSON.stringify(data.textTriggers)} num={num} data={data} reload={reload} />
      <div className="space-y-4"><TryText num={num} /><RunsList runs={data.runs} /></div>
    </div>
  );
}
