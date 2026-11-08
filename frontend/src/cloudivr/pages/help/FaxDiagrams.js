import React from 'react';
import { ArrowRight, ArrowDown, FileUp, FileText, Calculator, CheckCircle2, Phone, Printer, Users, Mail, Inbox } from 'lucide-react';

// Simple drawn diagrams for the Fax help articles (keyed by article.visual).
function Step({ icon: Icon, title, sub, dashed, testid }) {
  return (
    <div className={`flex-1 min-w-[8.5rem] rounded-xl border ${dashed ? 'border-dashed border-[var(--c-border-hover)]' : 'border-[var(--c-border)]'} bg-white/[0.03] p-3 text-center`} data-testid={testid}>
      <div className="w-9 h-9 mx-auto mb-2 rounded-lg bg-[var(--c-accent-soft)] flex items-center justify-center"><Icon className="w-4 h-4 text-[var(--c-accent)]" /></div>
      <div className="text-sm font-semibold text-[#f3f4f6]">{title}</div>
      {sub && <div className="text-xs text-[#a1a1aa] mt-1 leading-snug">{sub}</div>}
    </div>
  );
}
const Arrow = () => <div className="flex items-center justify-center text-[#71717a] shrink-0"><ArrowRight className="w-4 h-4 hidden sm:block" /><ArrowDown className="w-4 h-4 sm:hidden" /></div>;
const Flow = ({ children, testid }) => <div className="flex flex-col sm:flex-row items-stretch gap-2 my-2" data-testid={testid}>{children.flatMap((c, i) => (i ? [<Arrow key={`a${i}`} />, c] : [c]))}</div>;
const Caption = ({ children }) => <div className="text-xs text-[#a1a1aa] mt-1">{children}</div>;

function SendDiagram() {
  return (
    <div>
      <Flow testid="fax-diagram-send">
        <Step icon={FileUp} title="1. Pick a document" sub="PDF, JPG or PNG · up to 10 MB / 50 pages" />
        <Step icon={FileText} title="2. Cover page" sub="Optional · your name, recipient, subject, note" dashed />
        <Step icon={Calculator} title="3. Check price" sub="Pages · free vs paid · cost" />
        <Step icon={CheckCircle2} title="4. Send" sub="Status moves to Delivered or Failed" />
      </Flow>
      <Caption>Charged only when the fax is delivered. Failed faxes are free.</Caption>
    </div>
  );
}

function LineDiagram() {
  const Mode = ({ on, icon: Icon, title, sub, testid }) => (
    <div className={`flex-1 rounded-xl border p-4 ${on ? 'border-[var(--c-accent)]/60 bg-[var(--c-accent-soft)]' : 'border-white/10 bg-white/[0.03]'}`} data-testid={testid}>
      <div className="flex items-center gap-2 font-semibold text-sm"><Icon className="w-4 h-4 text-[var(--c-accent)]" />{title}</div>
      <div className="text-xs text-[#a1a1aa] mt-2 leading-snug">{sub}</div>
    </div>
  );
  return (
    <div>
      <div className="flex flex-col sm:flex-row gap-3 my-2" data-testid="fax-diagram-line">
        <Mode icon={Phone} title="Fax line OFF (voice)" sub="Your number takes calls as usual. Fax machines calling it don’t get through. You can still send faxes." testid="fax-diagram-line-off" />
        <div className="flex items-center justify-center text-xs text-[#a1a1aa] px-1">switch</div>
        <Mode on icon={Printer} title="Fax line ON" sub="Faxes arrive as PDF in Fax history and your Inbox, plus an email copy. Voice calls to this number pause." testid="fax-diagram-line-on" />
      </div>
      <Caption>A number does voice or fax at one time, not both. Switch back any time on the Fax page.</Caption>
    </div>
  );
}

function PriceDiagram() {
  const cells = Array.from({ length: 20 }, (_, i) => i);
  return (
    <div className="my-2" data-testid="fax-diagram-price">
      <svg viewBox="0 0 400 76" className="w-full max-w-xl" role="img" aria-label="50 free pages, then $2 per page">
        {cells.map(i => <rect key={i} x={i * 20 + 1} y={6} width={17} height={26} rx={3} fill={i < 12 ? 'var(--c-accent)' : 'none'} fillOpacity={i < 12 ? 0.35 : 0} stroke={i < 12 ? 'var(--c-accent)' : 'var(--c-muted)'} strokeDasharray={i < 12 ? '' : '3 2'} />)}
        <text x="0" y="56" fill="var(--c-text)" fontSize="14" fontWeight="600">50 free pages / month</text>
        <text x="400" y="56" fill="var(--c-text)" fontSize="14" fontWeight="600" textAnchor="end">then $2 a page</text>
        <line x1="240" y1="0" x2="240" y2="38" stroke="var(--c-text)" strokeWidth="1.5" />
      </svg>
      <Caption>Sent and received pages both count, a cover page too. The free pages reset when the plan renews. Bulk = pages × numbers, free pages first.</Caption>
    </div>
  );
}

function BulkDiagram() {
  return (
    <div className="my-2" data-testid="fax-diagram-bulk">
      <div className="flex flex-col sm:flex-row items-center gap-3">
        <Step icon={FileText} title="One document" sub="+ optional cover page" />
        <Arrow />
        <div className="flex-1 grid grid-cols-3 gap-2 w-full">
          {['Fax 1', 'Fax 2', 'Fax 3', 'Fax 4', 'Fax 5', '… 500'].map(n => <div key={n} className="rounded-lg border border-[var(--c-border)] bg-white/[0.03] px-1 py-2 text-xs text-center font-mono text-[var(--c-text)] whitespace-nowrap">{n}</div>)}
        </div>
        <Arrow />
        <Step icon={Users} title="One summary" sub="Delivered · failed · charged + CSV report" />
      </div>
      <Caption>Paste numbers (one per line) or load a CSV / TXT. Duplicates and invalid entries are skipped.</Caption>
    </div>
  );
}

function ReceiveDiagram() {
  return (
    <Flow testid="fax-diagram-receive">
      <Step icon={Printer} title="Someone faxes you" sub="to a number with Fax line ON" />
      <Step icon={Inbox} title="PDF in CloudIVR" sub="Fax history + Inbox" />
      <Step icon={Mail} title="Email copy" sub="to your account email" />
    </Flow>
  );
}

export const DIAGRAMS = { 'fax-send': SendDiagram, 'fax-line': LineDiagram, 'fax-price': PriceDiagram, 'fax-bulk': BulkDiagram, 'fax-receive': ReceiveDiagram };
