import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ask } from './confirm';

// Unsaved-changes guard. A form is "dirty" once the user has touched it AND its values differ from the values
// at the first touch, so loading/normalising data on mount never counts as an edit.
const dirty = new Map();
let seq = 0;
export const anyDirty = () => [...dirty.values()].some(Boolean);

// Asks before throwing edits away. true = go ahead (nothing unsaved, or the user chose to leave).
export async function confirmLeave() {
  if (!anyDirty()) return true;
  const ok = await ask('You have unsaved changes. Leave without saving them?', { danger: true, ok: 'Leave without saving', cancel: 'Stay and save' });
  if (ok) dirty.clear();
  return ok;
}

// const unsaved = useUnsaved(formValues); <div {...unsaved.bind}> … after a successful save: unsaved.reset()
export function useUnsaved(value) {
  const id = useRef(null);
  if (id.current === null) { seq += 1; id.current = seq; }
  const base = useRef(null);
  const cur = useRef(value);
  cur.current = value;
  const [touched, setTouched] = useState(false);
  const snap = JSON.stringify(value ?? null);
  const isDirty = touched && base.current !== null && snap !== base.current;
  useEffect(() => { dirty.set(id.current, isDirty); }, [isDirty]);
  useEffect(() => { const k = id.current; return () => { dirty.delete(k); }; }, []);
  const touch = useCallback(() => {
    if (base.current === null) { base.current = JSON.stringify(cur.current ?? null); setTouched(true); }
  }, []);
  const reset = useCallback(() => { base.current = null; setTouched(false); dirty.set(id.current, false); }, []);
  return { dirty: isDirty, reset, bind: { onChangeCapture: touch, onClickCapture: touch, onKeyDownCapture: touch } };
}

export const UnsavedPill = ({ show, testid = 'unsaved-changes-pill' }) => (show ? <span className="civr-pill civr-pill-warn self-center" role="status" data-testid={testid}>Unsaved changes</span> : null);

// Save button(s) + the "Unsaved changes" pill beside them.
export const SaveRow = ({ dirty, testid, children }) => <div className="flex flex-wrap items-center gap-3">{children}<UnsavedPill show={dirty} testid={testid} /></div>;

// Mounted once in the app shell: asks before an in-app link, a reload or closing the tab drops unsaved edits.
export function UnsavedGuard() {
  const nav = useNavigate();
  useEffect(() => {
    const beforeUnload = (e) => { if (anyDirty()) { e.preventDefault(); e.returnValue = ''; } };
    const click = (e) => {
      if (!anyDirty() || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target?.closest?.('a[href]');
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault(); e.stopPropagation();
      confirmLeave().then(ok => { if (ok) nav(`${url.pathname}${url.search}${url.hash}`); });
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', click, true); };
  }, [nav]);
  return null;
}
