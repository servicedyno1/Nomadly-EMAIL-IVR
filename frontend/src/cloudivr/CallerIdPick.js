import React from 'react';
import { Link } from 'react-router-dom';
import { useApi } from './api';
import { Field } from './ui';
import { cp } from './paths';
import { usePrivacy } from './privacy';

// "Show as": the number people see. Empty = the CloudIVR number placing the call; otherwise one the user verified.
export function useVerifiedCallerIds() {
  const { data } = useApi('/caller-ids');
  return (data?.items || []).filter(i => i.status === 'verified').map(i => i.number);
}

export function ShowAsSelect({ value, onChange, testid, compact = false }) {
  const pv = usePrivacy();
  const list = useVerifiedCallerIds();
  const add = <Link to={cp('/app/numbers#caller-ids')} className="text-[#818cf8]" data-testid={`${testid}-add-link`}>Add your own number →</Link>;
  const select = (
    <select className={`civr-input font-mono ${compact ? '!h-9 text-xs' : ''}`} value={list.includes(value) ? value : ''} onChange={e => onChange(e.target.value)} disabled={!list.length} data-testid={testid}>
      <option value="">Same as calling number</option>
      {list.map(n => <option key={n} value={n}>{pv.phone(n)}</option>)}
    </select>
  );
  if (compact) return list.length ? <div className="mb-3"><div className="text-xs text-[#a1a1aa] mb-1">Show as</div>{select}</div> : null;
  return <Field label="Show as (caller ID people see)" hint={list.length ? <>Calls are still billed to the calling number. {add}</> : <>Verify a number you own to show it instead. {add}</>}>{select}</Field>;
}
