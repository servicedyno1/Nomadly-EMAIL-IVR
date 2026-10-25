import React, { useState } from 'react';
import { toast } from 'sonner';
import { LayoutTemplate, Save, Trash2 } from 'lucide-react';
import { api, useApi } from '../../api';

// Start from a built-in business menu or one of your saved menus; save the current menu as a template.
export function IvrTemplates({ current, onApply }) {
  const { data, reload } = useApi('/ivr/templates');
  const [name, setName] = useState('');
  const save = async () => {
    try { await api('/ivr/templates', { method: 'POST', body: { name, ivr: current() } }); toast.success('Saved to My templates'); setName(''); reload(); } catch (e) { toast.error(e.message); }
  };
  const del = async (id) => { try { await api(`/ivr/templates/${id}`, { method: 'DELETE' }); reload(); } catch (e) { toast.error(e.message); } };
  const use = (t) => { onApply(t.config); toast.success(`“${t.name}” loaded — add the forward numbers, then Save keypad menu`); };
  const row = (t, i, mine) => (
    <div key={t.id} className="flex items-center gap-2 py-1.5" data-testid={`ivr-template-${mine ? 'mine' : 'builtin'}-${i}`}>
      <button type="button" className="flex-1 min-h-[40px] text-left text-sm hover:text-[#34d399] truncate" onClick={() => use(t)} data-testid={`ivr-template-${mine ? 'mine' : 'builtin'}-${i}-use`}>{t.name}</button>
      {mine && <button type="button" className="p-1.5 text-[#a1a1aa] hover:text-[#fb7185]" onClick={() => del(t.id)} aria-label="Delete template" data-testid={`ivr-template-mine-${i}-delete`}><Trash2 className="w-3.5 h-3.5" /></button>}
    </div>
  );
  return (
    <div className="civr-card p-6" data-testid="ivr-templates">
      <div className="flex items-center gap-2 font-display text-2xl font-bold mb-3"><LayoutTemplate className="w-5 h-5 text-[#34d399]" />Templates</div>
      <div className="text-xs text-[#a1a1aa] mb-1">Business menus</div>
      {(data?.builtin || []).map((t, i) => row(t, i, false))}
      {data?.mine?.length > 0 && <><div className="text-xs text-[#a1a1aa] mt-4 mb-1">My templates</div>{data.mine.map((t, i) => row(t, i, true))}</>}
      <div className="flex gap-2 mt-4"><input className="civr-input !h-10" value={name} onChange={e => setName(e.target.value)} placeholder="Template name" data-testid="ivr-template-name-input" />
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" disabled={!name.trim()} onClick={save} data-testid="ivr-template-save-button"><Save className="w-4 h-4" />Save</button></div>
      <p className="text-xs text-[#a1a1aa] mt-2">Saves the menu below so you can reuse it on any number.</p>
    </div>
  );
}
