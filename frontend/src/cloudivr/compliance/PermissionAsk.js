import React, { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { setPermissionAsker } from '../api';
import { Modal } from '../pages/contacts/Modal';
import { cp } from '../paths';

// "I have permission to call these numbers": every campaign, once for Quick IVR. The server logs each confirmation.
export function PermissionAskHost() {
  const [pending, setPending] = useState(null);
  const [ok, setOk] = useState(false);
  useEffect(() => {
    setPermissionAsker((d) => new Promise((resolve) => { setOk(false); setPending((prev) => { prev?.resolve(false); return { resolve, quick: d?.kind === 'quick' }; }); }));
    return () => setPermissionAsker(null);
  }, []);
  if (!pending) return null;
  const done = (v) => { pending.resolve(v); setPending(null); };
  return (
    <Modal title={pending.quick ? 'Permission to call' : 'Permission to call this list'} sub={pending.quick ? 'We ask this once for Quick IVR.' : 'We ask this for every campaign and keep a record of it.'} onClose={() => done(false)} testid="permission-ask-dialog">
      <label className="flex items-start gap-3 text-sm cursor-pointer">
        <input type="checkbox" checked={ok} onChange={e => setOk(e.target.checked)} className="mt-1" data-testid="permission-ask-checkbox" />
        <span>{pending.quick ? 'I confirm I have permission to call the numbers I call with Quick IVR' : 'I confirm I have permission to call every number in this campaign'}, as required by the <a href={cp('/terms')} target="_blank" rel="noreferrer" className="underline text-[var(--c-accent)]" data-testid="permission-ask-terms-link">Terms of Service</a>.</span>
      </label>
      <button type="button" className="civr-btn civr-btn-primary w-full mt-5" disabled={!ok} onClick={() => done(true)} data-testid="permission-ask-confirm-button"><ShieldCheck className="w-4 h-4" />Confirm and continue</button>
    </Modal>
  );
}
