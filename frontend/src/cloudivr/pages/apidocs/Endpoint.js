import React from 'react';
import { CodeTabs } from './CodeTabs';
import { samples } from './snippets';

const METHOD = { GET: 'bg-sky-100 text-sky-800', POST: 'bg-emerald-100 text-emerald-800' };

export const MethodPath = ({ method, path }) => (
  <div className="inline-flex items-center gap-2 font-mono text-sm">
    <span className={`px-2 py-0.5 rounded-md text-xs font-bold ${METHOD[method]}`}>{method}</span>
    <span className="text-slate-900 break-all">{path}</span>
  </div>
);

export const Params = ({ rows, testid }) => (
  <div className="mt-5 rounded-xl ring-1 ring-slate-200 divide-y divide-slate-200" data-testid={testid}>
    {rows.map(([name, req, desc]) => (
      <div key={name} className="grid sm:grid-cols-[180px_1fr] gap-1 sm:gap-4 px-4 py-3 text-sm">
        <div className="flex items-baseline gap-2"><span className="font-mono text-slate-900">{name}</span><span className={`text-[11px] ${req === 'required' ? 'text-rose-600' : 'text-slate-400'}`}>{req}</span></div>
        <div className="text-slate-600">{desc}</div>
      </div>
    ))}
  </div>
);

// One endpoint: summary + params on the left, request/response code on the right (stacked on mobile).
export function Endpoint({ id, method, path, title, children, params, body, reqPath, response, status = 200 }) {
  return (
    <section id={id} className="scroll-mt-24 py-10 border-t border-slate-200 first:border-t-0" data-testid={`api-docs-${id}`}>
      <div className="grid lg:grid-cols-2 gap-8">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
          <div className="mt-2"><MethodPath method={method} path={path} /></div>
          <div className="mt-4 text-sm leading-relaxed text-slate-600 space-y-3">{children}</div>
          {params && <Params rows={params} testid={`api-docs-${id}-params`} />}
        </div>
        <div className="min-w-0 space-y-4 lg:sticky lg:top-24 self-start">
          <CodeTabs title="Request" samples={samples(method, reqPath || path, body)} testid={`api-docs-${id}-request`} />
          {response && <CodeTabs title={`Response · ${status}`} samples={{ JSON: response }} testid={`api-docs-${id}-response`} />}
        </div>
      </div>
    </section>
  );
}
