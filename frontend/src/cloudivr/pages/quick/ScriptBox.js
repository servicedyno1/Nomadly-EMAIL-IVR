import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Sparkles } from 'lucide-react';
import { api, useApi } from '../../api';
import { Field } from '../../ui';
import { VoiceMaker } from '../../VoiceMaker';

export const placeholdersOf = (text) => [...new Set((String(text || '').match(/\[([A-Za-z0-9_]+)\]/g) || []).map(s => s.slice(1, -1)))];
export const fillScript = (text, values) => String(text || '').replace(/\[([A-Za-z0-9_]+)\]/g, (m, k) => (values?.[k] ? values[k] : m));

// Script templates (Payment / Security / Delivery) or your own words, with [Placeholders] to fill.
// value = { templateKey, text, values }; onAudio(audio) when an AI voice file is made from the filled script.
export function ScriptBox({ value, onChange, onAudio, testid = 'script' }) {
  const { data } = useApi('/outbound/templates');
  const [cat, setCat] = useState('');
  const cats = data?.categories || [];
  const list = (data?.templates || []).filter(t => !cat || t.category === cat);
  const names = useMemo(() => placeholdersOf(value.text), [value.text]);
  const smart = data?.smart || {};
  const set = (p) => onChange({ ...value, ...p });
  const pick = (key) => { const t = (data?.templates || []).find(x => x.key === key); set(t ? { templateKey: key, text: t.text, templateName: t.name, activeKeys: t.activeKeys } : { templateKey: '', templateName: '' }); };
  const autofill = async () => {
    try { const d = await api('/outbound/fill', { method: 'POST', body: { names } }); set({ values: { ...(value.values || {}), ...d.values } }); toast.success('Filled what we could'); } catch (e) { toast.error(e.message); }
  };
  const filled = fillScript(value.text, value.values);
  return (
    <div className="space-y-4" data-testid={testid}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Category"><select className="civr-input" value={cat} onChange={e => setCat(e.target.value)} data-testid={`${testid}-category`}><option value="">All templates</option>{cats.map(c => <option key={c.key} value={c.key}>{c.name}</option>)}</select></Field>
        <Field label="Template"><select className="civr-input" value={value.templateKey || ''} onChange={e => pick(e.target.value)} data-testid={`${testid}-template`}><option value="">Write my own</option>{list.map(t => <option key={t.key} value={t.key}>{t.name}</option>)}</select></Field>
      </div>
      <Field label="Script (what the caller hears)" hint="Use [Name]-style placeholders for details you fill in below.">
        <textarea rows={4} maxLength={1500} className="civr-input" value={value.text || ''} onChange={e => set({ text: e.target.value })} placeholder="Hello [Name], this is a reminder about your appointment. Press 1 to speak with us." data-testid={`${testid}-text`} />
      </Field>
      {names.length > 0 && (
        <div className="space-y-3" data-testid={`${testid}-placeholders`}>
          <div className="flex items-center justify-between"><span className="text-xs font-medium text-[#d4d4d8]">Fill in the placeholders</span>
            <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={autofill} data-testid={`${testid}-autofill`}><Sparkles className="w-4 h-4" />Auto-fill</button></div>
          <div className="grid sm:grid-cols-2 gap-3">
            {names.map(n => (
              <Field key={n} label={smart[n]?.label || n} hint={smart[n]?.hint}>
                {smart[n]?.presets ? (
                  <select className="civr-input" value={value.values?.[n] || ''} onChange={e => set({ values: { ...(value.values || {}), [n]: e.target.value } })} data-testid={`${testid}-ph-${n}`}><option value="">Pick…</option>{smart[n].presets.map(p => <option key={p}>{p}</option>)}</select>
                ) : <input className="civr-input" value={value.values?.[n] || ''} onChange={e => set({ values: { ...(value.values || {}), [n]: e.target.value } })} data-testid={`${testid}-ph-${n}`} />}
              </Field>
            ))}
          </div>
        </div>
      )}
      {filled && filled !== value.text && <div className="text-sm text-[#e4e4e7] border border-[#222] rounded-xl p-3" dir="auto" data-no-translate data-testid={`${testid}-preview-text`}>{filled}</div>}
      {onAudio && <VoiceMaker text={filled} name={value.templateName || 'Call script'} onMade={onAudio} testid={`${testid}-voice`} />}
    </div>
  );
}
