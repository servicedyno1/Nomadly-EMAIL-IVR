import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Smartphone, MessageSquare } from 'lucide-react';
import { money } from '../../api';
import { statusPill } from '../../ui';
import { CapBadges } from '../../kinds';
import { cp } from '../../paths';
import { renewText } from './RenewPick';
import { LineAutoRenew } from './LineAutoRenew';

const LABEL = { awaiting_imei: 'needs IMEI', provisioning: 'setting up', active: 'active', suspended: 'paused', failed: 'failed' };

// USA eSIM or Texting Number in the My numbers list.
export function EsimCard({ item, reload, mobile = false }) {
  const t = mobile ? 'mobile-card' : 'esim-card';
  const href = cp(`/app/esim/${item.id}`);
  return (
    <div className="civr-card p-6 flex flex-col" data-testid={`${t}-${item.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={href} className="font-mono text-xl inline-flex items-center gap-1.5 min-h-[44px] -my-2 hover:text-[var(--c-accent,#818cf8)] transition-colors" data-no-translate data-testid={`${t}-${item.id}-phone`}>{item.phoneNumber || 'Number coming'}</Link>
          <div className="text-xs text-[#a1a1aa] mt-1 flex items-center gap-1.5">{mobile ? <MessageSquare className="w-3.5 h-3.5" /> : <Smartphone className="w-3.5 h-3.5" />}{mobile ? 'USA · Texting Number' : 'USA · eSIM on your phone'}</div>
        </div>
        <span className={statusPill(item.status === 'suspended' ? 'suspended' : item.status)} data-testid={`${t}-${item.id}-status`}>{LABEL[item.status] || item.status}</span>
      </div>
      <div className="mt-3"><CapBadges caps={['calls', 'texts']} testid={`${t}-${item.id}-caps`} /></div>
      <LineAutoRenew item={item} reload={reload} testid={`${t}-${item.id}-autorenew`} className="mt-5 pt-4 border-t border-[var(--c-border,#1f1f1f)]" />
      <div className="flex flex-wrap items-center justify-between gap-2 mt-auto pt-5 text-xs text-[#a1a1aa]">
        <span data-testid={`${t}-${item.id}-renew-info`}>{renewText(item, money)}</span>
        <Link to={href} className="civr-btn civr-btn-ghost civr-btn-sm !h-9" data-testid={`${t}-${item.id}-link`}>Open<ChevronRight className="w-4 h-4" /></Link>
      </div>
    </div>
  );
}
