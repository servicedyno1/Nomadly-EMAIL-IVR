import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PhoneOutgoing } from 'lucide-react';
import { api, enc } from '../../api';
import { FlagSelect } from '../../Pickers';
import { countryOfPhone } from '../../phoneCountry';

// Pick which of your numbers a SIP login calls out from (that number's plan, minutes and rates apply).
export function CallsFrom({ num, loginId = null, value, testid, card = false }) {
  const [opts, setOpts] = useState(null);
  const [cur, setCur] = useState(value || num.phoneNumber);
  useEffect(() => { api(`/numbers/${enc(num.phoneNumber)}/sip/caller-id`).then(d => { setOpts(d.options); if (!loginId) setCur(d.main || num.phoneNumber); }).catch(() => setOpts([])); }, [num.phoneNumber, loginId]);
  if (!opts || opts.length < 2) return null;
  const save = async (v) => {
    const prev = cur; setCur(v);
    try { await api(`/numbers/${enc(num.phoneNumber)}/sip/caller-id`, { method: 'PUT', body: { callerId: v, loginId } }); toast.success(`Calls from this login now show ${v}`); } catch (e) { setCur(prev); toast.error(e.message); }
  };
  const row = (
    <label className="flex items-center gap-2 text-sm" data-testid={testid}>
      <PhoneOutgoing className="w-4 h-4 text-[#818cf8] shrink-0" /><span className="text-[var(--c-muted)] shrink-0">Calls from</span>
      <FlagSelect code={countryOfPhone(cur)}><select className="civr-input !h-9 !py-0 min-w-[200px]" value={cur} onChange={e => save(e.target.value)} data-testid={`${testid}-select`}>
        {opts.map(p => <option key={p} value={p}>{p === num.phoneNumber ? `${p} (this number)` : p}</option>)}
      </select></FlagSelect>
    </label>
  );
  if (!card) return row;
  return <div className="lg:col-span-3 civr-card p-5" data-testid={`${testid}-card`}><div className="font-semibold mb-2">Main SIP login</div>{row}<p className="text-xs text-[var(--c-muted)] mt-2">Outgoing calls use the chosen number’s plan, minutes and rates.</p></div>;
}
