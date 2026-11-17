import React, { useEffect, useState, useCallback } from 'react';
import { PhoneIncoming, PhoneOutgoing, MessageSquare, Voicemail, Send, PhoneForwarded, List, AlertTriangle, CheckCircle2, Info, PlayCircle, Loader2, Plus, Webhook, Hash, KeyRound, CreditCard } from 'lucide-react';
import { api } from '../../api';

const ICON = {
  incoming: PhoneIncoming, outgoing: PhoneOutgoing, greeting: MessageSquare, forward: PhoneForwarded, message: MessageSquare,
  sms: Send, voicemail: Voicemail, menu: List, webhook: Webhook, collect: Hash, pin: KeyRound, pay: CreditCard,
};
const TONE = { incoming: '#38bdf8', outgoing: '#38bdf8', greeting: '#818cf8', forward: '#34d399', message: '#fbbf24', sms: '#f472b6', voicemail: '#a78bfa', menu: '#38bdf8', webhook: '#2dd4bf', collect: '#fb923c', pin: '#f87171', pay: '#4ade80' };

// Build parent→children map from edges, render as an indented tree from "incoming".
// With `edit`, key nodes (ids like k1.2 = key 1 then key 2) open an inline editor and menus get an "add key" button.
const pathOf = (id) => (/^k\d(\.\d)*$/.test(id) ? id.slice(1).split('.') : null);
function Tree({ nodes, edges, testid = 'ivr-flow', edit }) {
  const [sel, setSel] = useState(null);
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const kids = {};
  edges.forEach(e => { (kids[e.from] = kids[e.from] || []).push(e); });
  // plain render function (not a component) so typing in the inline editor never remounts the tree
  const node = (id, label, depth, key) => {
    const n = byId[id]; if (!n) return null;
    const Ico = ICON[n.type] || List; const c = TONE[n.type] || '#a1a1aa';
    const path = edit ? pathOf(id) : null;
    const open = !!path && sel === id;
    const addTo = edit && (id === 'greeting' ? [] : n.type === 'menu' ? path : null);
    const body = (
      <>
        {label && <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#1c1c1c] text-[#a1a1aa] mt-0.5 shrink-0">{label}</span>}
        <span className="mt-0.5 shrink-0" style={{ color: c }}><Ico className="w-4 h-4" /></span>
        <span className="min-w-0 text-left">
          <span className="block text-sm leading-tight">{n.label}</span>
          {n.detail && <span className="block text-xs text-[#71717a] truncate max-w-[280px]">{n.detail}</span>}
        </span>
      </>
    );
    return (
      <div key={key} data-testid={`${testid}-node-${id}`}>
        <div className="flex items-start gap-2 py-1.5" style={{ marginLeft: depth * 18 }}>
          {depth > 0 && <span className="text-[#3f3f46] -ml-3 mt-1 select-none">└</span>}
          {path ? <button type="button" onClick={() => setSel(open ? null : id)} aria-expanded={open} className={`flex items-start gap-2 rounded-lg px-1 -mx-1 hover:bg-[#1c1c1c] transition-colors ${open ? 'bg-[#1c1c1c]' : ''}`} data-testid={`${testid}-node-${id}-edit`}>{body}</button> : body}
          {addTo && edit.canAdd(addTo) && <button type="button" onClick={() => { const np = edit.onAdd(addTo); if (np) setSel(`k${np.join('.')}`); }} className="ml-auto shrink-0 text-xs text-[#818cf8] hover:text-[#a5b4fc] flex items-center gap-1" data-testid={`${testid}-node-${id}-add`}><Plus className="w-3.5 h-3.5" />key</button>}
        </div>
        {open && <div className="my-2 rounded-xl border border-[#818cf8]/40 p-3 space-y-2" style={{ marginLeft: depth * 18 }} data-testid={`${testid}-editor`}>{edit.renderEditor(path, (np) => setSel(np ? `k${np.join('.')}` : null))}</div>}
        {(kids[id] || []).map((e) => node(e.to, e.label, depth + 1, e.to))}
      </div>
    );
  };
  return <div data-testid={`${testid}-tree`}>{node('incoming', '', 0, 'incoming')}</div>;
}

const LEVEL_ICON = { error: AlertTriangle, warn: Info };
const LEVEL_TONE = { error: '#fb7185', warn: '#fbbf24' };

export function IvrFlow({ greeting, list, context, edit }) {
  const [bp, setBp] = useState({ nodes: [], edges: [] });
  const [val, setVal] = useState(null);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const ivr = useCallback(() => ({ greeting, options: list }), [greeting, list]);

  useEffect(() => {
    const body = { ivr: ivr(), context };
    const t = setTimeout(() => {
      Promise.all([
        api('/ivr/blueprint', { method: 'POST', body }).then(setBp).catch(() => {}),
        api('/ivr/validate', { method: 'POST', body }).then(setVal).catch(() => {}),
      ]);
      setTest(null);
    }, 400);
    return () => clearTimeout(t);
  }, [ivr, context]);

  const runTest = async () => {
    setTesting(true);
    try { setTest(await api('/ivr/simulate', { method: 'POST', body: { ivr: ivr(), context } })); }
    catch (e) { setTest({ error: e.message, tests: [] }); }
    finally { setTesting(false); }
  };

  return <FlowCard bp={bp} val={val} test={test} testing={testing} runTest={runTest} edit={edit} />;
}

// Presentational card shared by the inbound keypad menu and outbound call setups.
export function FlowCard({ bp, val, test, testing, runTest, edit, testid = 'ivr-flow', empty = 'Add a key to see the flow.', readyLabel = 'Ready to save', testLabel = 'Test my menu' }) {
  return (
    <div className="civr-card p-6 space-y-5 h-fit" data-testid={testid}>
      <div><div className="font-display text-2xl font-bold">Call flow</div>{edit && <p className="text-xs text-[#71717a] mt-1">Click a key to change it here, or use “+ key” to add one.</p>}</div>

      {/* Visual flow */}
      <div className="rounded-xl border border-[#222] p-3 bg-[#0d0d0f] overflow-x-auto">
        {bp.nodes.length ? <Tree {...bp} testid={testid} edit={edit} /> : <div className="text-sm text-[#71717a]">{empty}</div>}
      </div>

      {/* Checks */}
      {val && (
        <div data-testid={`${testid}-checks`}>
          <div className="flex items-center gap-2 text-sm font-semibold mb-2">
            {val.ready ? <><CheckCircle2 className="w-4 h-4 text-[#34d399]" /><span className="text-[#34d399]">{readyLabel}</span></>
              : <><AlertTriangle className="w-4 h-4 text-[#fb7185]" /><span className="text-[#fb7185]">{val.errors} thing{val.errors === 1 ? '' : 's'} to fix before it works</span></>}
          </div>
          {!val.issues.length && <div className="text-sm text-[#71717a]">No problems found.</div>}
          <ul className="space-y-1.5">
            {val.issues.map((is, i) => { const Ico = LEVEL_ICON[is.level]; return (
              <li key={i} className="flex items-start gap-2 text-[13px]" data-testid={`${testid}-issue-${is.level}-${i}`}>
                <Ico className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: LEVEL_TONE[is.level] }} />
                <span><span className="text-[#d4d4d8]">{is.where}</span><span className="text-[#a1a1aa]"> — {is.message}</span></span>
              </li>
            ); })}
          </ul>
        </div>
      )}

      {/* Simulated test report */}
      <div data-testid={`${testid}-test`}>
        <button type="button" onClick={runTest} disabled={testing} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid={`${testid}-test-button`}>
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}{testLabel}
        </button>
        {test && !test.error && (
          <div className="mt-3">
            <div className="text-sm mb-2" data-testid={`${testid}-test-summary`}>
              <span className="text-[#34d399] font-semibold">{test.passed} passed</span>
              {test.failed > 0 && <span className="text-[#fb7185] font-semibold"> · {test.failed} would fail</span>}
            </div>
            <ul className="space-y-1">
              {test.tests.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]" data-testid={`${testid}-test-row-${i}`}>
                  {t.ok ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-[#34d399] shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-[#fb7185] shrink-0" />}
                  <span><span className="text-[#d4d4d8]">{t.path}</span><span className="text-[#71717a]"> · {t.input}</span><span className="text-[#a1a1aa]"> → {t.expect}</span></span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {test?.error && <div className="mt-2 text-sm text-[#fb7185]">{test.error}</div>}
      </div>
    </div>
  );
}

// Outbound (Quick IVR call / Bulk IVR campaign): one request returns checks, the walk-through and the flow.
export function OutboundFlow({ kind, config, context, testid, readyLabel }) {
  const [d, setD] = useState(null);
  const [shown, setShown] = useState(false);
  const key = JSON.stringify([config, context]);
  useEffect(() => {
    const t = setTimeout(() => { api('/outbound/check', { method: 'POST', body: { kind, config, context } }).then(setD).catch(() => {}); setShown(false); }, 500);
    return () => clearTimeout(t);
  }, [key, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  return <FlowCard bp={d?.flow || { nodes: [], edges: [] }} val={d?.validation || null} test={shown ? d?.test : null} testing={false} runTest={() => setShown(true)} testid={testid} empty="Start filling in the call to see the flow." readyLabel={readyLabel} testLabel="Walk through this call" />;
}
