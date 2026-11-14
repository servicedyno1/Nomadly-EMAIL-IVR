import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { PRODUCT_GROUPS } from '../../products';
import { appPath } from '../../nav';

function Tile({ it, tone, i }) {
  const [id, Icon, title, text, price, to, soon] = it;
  return (
    <Link to={appPath(to)} className="civr-card civr-card-link civr-tile p-5 flex flex-col civr-rise" style={{ animationDelay: `${i * 40}ms` }} data-testid={`home-product-${id}`}>
      <div className="flex items-start justify-between gap-3">
        <span className={`civr-chip civr-chip-${tone} civr-chip-lg`} aria-hidden><Icon className="w-4 h-4" /></span>
        <ArrowUpRight className="w-4 h-4 text-[var(--c-muted)] civr-tile-arrow" />
      </div>
      <div className="font-semibold mt-4 flex items-center gap-2">{title}{soon && <span className="civr-pill" data-testid={`home-product-${id}-soon`}>Soon</span>}</div>
      <p className="text-sm text-[var(--c-muted)] mt-1 leading-relaxed flex-1">{text}</p>
      <div className="text-xs font-semibold mt-4 text-[var(--c-text)]" data-testid={`home-product-${id}-price`}>{price}</div>
    </Link>
  );
}

// Bird-style Home: every product as an app tile, grouped like the sidebar.
export function ProductGrid() {
  let n = 0;
  return (
    <section className="mt-10" data-testid="home-products">
      <h2 className="font-display text-xl font-bold">Products</h2>
      <p className="text-sm text-[var(--c-muted)] mt-1">Everything you can add to your account, paid from one wallet.</p>
      <div className="mt-6 space-y-8">
        {PRODUCT_GROUPS.map(([gid, title, tone, items]) => (
          <div key={gid} data-testid={`home-products-group-${gid}`}>
            <div className="text-xs font-semibold uppercase tracking-wider text-[var(--c-muted)] mb-3">{title}</div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">{items.map(it => <Tile key={it[0]} it={it} tone={tone} i={n++} />)}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
