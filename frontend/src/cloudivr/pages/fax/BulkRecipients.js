import React, { useRef } from 'react';
import { toast } from 'sonner';
import { Upload } from 'lucide-react';
import { Field } from '../../ui';

export const countLines = (s) => String(s || '').split(/[\r\n,;\t|]+|\s+(?=\+)/).filter(t => /\d{3}/.test(t)).length;

// Recipient list for bulk fax: paste numbers or load them from a CSV / TXT file (read in the browser).
export function BulkRecipients({ value, onChange, max }) {
  const ref = useRef(null);
  const load = (f) => {
    if (!f) return;
    if (f.size > 1024 * 1024) { toast.error('The list file must be under 1 MB.'); return; }
    const r = new FileReader();
    r.onload = () => { onChange(String(r.result || '')); toast.success(`Loaded ${countLines(r.result)} numbers from ${f.name}`); };
    r.readAsText(f);
    ref.current.value = '';
  };
  const n = countLines(value);
  return (
    <Field label={`Fax numbers (up to ${max})`} hint="One per line, with country code. Duplicates and invalid entries are skipped.">
      <textarea className="civr-input w-full min-h-[120px] font-mono text-sm" value={value} onChange={e => onChange(e.target.value)} placeholder={'+14155550100\n+12125550123'} data-testid="fax-bulk-textarea" />
      <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
        <span className={`text-xs ${n > max ? 'text-[#fb7185]' : 'text-[#a1a1aa]'}`} data-testid="fax-bulk-count">{n} number{n === 1 ? '' : 's'}{n > max ? ` — over the ${max} limit` : ''}</span>
        <button type="button" className="civr-btn civr-btn-ghost civr-btn-sm" onClick={() => ref.current?.click()} data-testid="fax-bulk-file-button"><Upload className="w-4 h-4" />Load CSV / TXT</button>
        <input ref={ref} type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" className="hidden" onChange={e => load(e.target.files?.[0])} data-testid="fax-bulk-file-input" />
      </div>
    </Field>
  );
}
