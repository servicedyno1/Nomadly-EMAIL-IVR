import React, { useEffect, useState, useCallback } from 'react';
import { PhoneIncoming, MessageSquare, Voicemail, Send, PhoneForwarded, List, AlertTriangle, CheckCircle2, Info, PlayCircle, Loader2, Webhook, Hash, KeyRound, CreditCard } from 'lucide-react';
import { api } from '../../api';

const ICON = {
  incoming: PhoneIncoming, greeting: MessageSquare, forward: PhoneForwarded, message: MessageSquare,
  sms: Send, voicemail: Voicemail, menu: List, webhook: Webhook, collect: Hash, pin: KeyRound, pay: CreditCard,
};
const TONE = { incoming: '#38bdf8', greeting: '#818cf8', forward: '#34d399', message: '#fbbf24', sms: '#f472b6', voicemail: '#a78bfa', menu: '#38bdf8', webhook: '#2dd4bf', collect: '#fb923c', pin: '#f87171', pay: '#4ade80' };

// Build parent→children map from edges, render as an indented tree from "incoming".
function Tree({ nodes, edges }) {
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  const kids = {};
  edges.forEach(e => { (kids[e.from] = kids[e.from] || []).push(e); });
  const Node = ({ id, label, depth }) => {
    const n = byId[id]; if (!n) return null;
    const Ico = ICON[n.type] || List; const c = TONE[n.type] || '#a1a1aa';
    return (
      <div data-testid={`ivr-flow-node-${id}`}>
        <div className="flex items-start gap-2 py-1.5" style={{ marginLeft: depth * 18 }}>
          {depth > 0 && <span className="text-[#3f3f46] -ml-3 mt-1 select-none">└</span>}
          {label && <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-[#1c1c1c] text-[#a1a1aa] mt-0.5 shrink-0">{label}</span>}
          <span className="mt-0.5 shrink-0" style={{ color: c }}><Ico className="w-4 h-4" /></span>
          <div className="min-w-0">
            <div className="text-sm leading-tight">{n.label}</div>
            {n.detail && <div className="text-xs text-[#71717a] truncate max-w-[280px]">{n.detail}</div>}
          </div>
        </div>
        {(kids[id] || []).map((e, i) => <Node key={i} id={e.to} label={e.label} depth={depth + 1} />)}
      </div>
    );
  };
  return <div data-testid="ivr-flow-tree">{<Node id="incoming" label="" depth={0} />}</div>;
}

const LEVEL_ICON = { error: AlertTriangle, warn: Info };
const LEVEL_TONE = { error: '#fb7185', warn: '#fbbf24' };

export function IvrFlow({ greeting, list, context }) {
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

  return (
    <div className="civr-card p-6 space-y-5 h-fit" data-testid="ivr-flow">
      <div className="font-display text-2xl font-bold">Call flow</div>

      {/* Visual flow */}
      <div className="rounded-xl border border-[#222] p-3 bg-[#0d0d0f] overflow-x-auto">
        {bp.nodes.length ? <Tree {...bp} /> : <div className="text-sm text-[#71717a]">Add a key to see the flow.</div>}
      </div>

      {/* Checks */}
      {val && (
        <div data-testid="ivr-flow-checks">
          <div className="flex items-center gap-2 text-sm font-semibold mb-2">
            {val.ready ? <><CheckCircle2 className="w-4 h-4 text-[#34d399]" /><span className="text-[#34d399]">Ready to save</span></>
              : <><AlertTriangle className="w-4 h-4 text-[#fb7185]" /><span className="text-[#fb7185]">{val.errors} thing{val.errors === 1 ? '' : 's'} to fix before it works</span></>}
          </div>
          {!val.issues.length && <div className="text-sm text-[#71717a]">No problems found.</div>}
          <ul className="space-y-1.5">
            {val.issues.map((is, i) => { const Ico = LEVEL_ICON[is.level]; return (
              <li key={i} className="flex items-start gap-2 text-[13px]" data-testid={`ivr-flow-issue-${is.level}-${i}`}>
                <Ico className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: LEVEL_TONE[is.level] }} />
                <span><span className="text-[#d4d4d8]">{is.where}</span><span className="text-[#a1a1aa]"> — {is.message}</span></span>
              </li>
            ); })}
          </ul>
        </div>
      )}

      {/* Simulated test report */}
      <div data-testid="ivr-flow-test">
        <button type="button" onClick={runTest} disabled={testing} className="civr-btn civr-btn-ghost civr-btn-sm" data-testid="ivr-flow-test-button">
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />}Test my menu
        </button>
        {test && !test.error && (
          <div className="mt-3">
            <div className="text-sm mb-2" data-testid="ivr-flow-test-summary">
              <span className="text-[#34d399] font-semibold">{test.passed} passed</span>
              {test.failed > 0 && <span className="text-[#fb7185] font-semibold"> · {test.failed} would fail</span>}
            </div>
            <ul className="space-y-1">
              {test.tests.map((t, i) => (
                <li key={i} className="flex items-start gap-2 text-[13px]" data-testid={`ivr-flow-test-row-${i}`}>
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
