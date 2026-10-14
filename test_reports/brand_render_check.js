// Render marketplace strings per-tree with brand from brand.env, for all languages.
const path = require('path');
const fs = require('fs');

const trees = [
  { dir: '/root/sd-live/app-main', brand: 'Nomadly', upper: 'NOMADLY' },
  { dir: '/root/sd-live/app-wl', brand: 'Smadav', upper: 'SMADAV' },
  { dir: '/root/sd-live/app-voodoo', brand: 'Voodoo Land', upper: 'VOODOO LAND' },
];
const langs = ['en', 'fr', 'hi', 'zh'];

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

for (const tree of trees) {
  console.log(`\n=== ${tree.dir} (brand=${tree.brand}) ===`);
  // Clear module cache (lang files cache the brand at require-time)
  for (const k of Object.keys(require.cache)) {
    if (k.includes(tree.dir) || k.includes('/js/lang/') || k.includes('/js/config')) delete require.cache[k];
  }
  process.env.CHAT_BOT_BRAND = tree.brand;

  for (const l of langs) {
    const langFile = path.join(tree.dir, 'js/lang', `${l}.js`);
    for (const k of Object.keys(require.cache)) {
      if (k.includes(tree.dir) || k.includes('/js/lang/') || k.endsWith('/js/config.js')) delete require.cache[k];
    }
    const mod = require(langFile);
    const t = mod[l].t;

    const mpHome = typeof t.mpHome === 'function' ? t.mpHome() : t.mpHome;
    check(`[${l}] mpHome has brand ${tree.upper}`, mpHome.includes(tree.upper), `mpHome=${mpHome.slice(0,120)}`);
    check(`[${l}] mpHome mentions safedeal.sh`, /safedeal\.sh/i.test(mpHome));

    const buyer = t.mpEscrowBuyer('Twilio acct', 120);
    check(`[${l}] mpEscrowBuyer I'm buying`, /I'm buying|买|acheter|खरीद/i.test(buyer) || buyer.includes("I'm buying"));
    check(`[${l}] mpEscrowBuyer tap-copy title`, buyer.includes('<code>Twilio acct</code>'));
    check(`[${l}] mpEscrowBuyer tap-copy price`, buyer.includes('<code>120.00</code>'));
    check(`[${l}] mpEscrowBuyer Share a link`, /Share a link|lien|लिंक|链接/i.test(buyer));
    check(`[${l}] mpEscrowBuyer paste instruction`, /paste|coll|पेस्ट|粘贴/i.test(buyer));
    check(`[${l}] mpEscrowBuyer 5% min $10`, /5\s*%/.test(buyer) && /(\$10|10\s*\$)/.test(buyer));

    const seller = t.mpEscrowSeller();
    check(`[${l}] mpEscrowSeller safedeal.sh invite wait`, /safedeal\.sh/i.test(seller));
    check(`[${l}] mpEscrowSeller Funded`, /Funded|financ|धन|资金/i.test(seller));
    check(`[${l}] mpEscrowSeller I'm selling backup`, /I'm selling|vends|बेच|卖/i.test(seller));

    const oor = t.mpEscrowOutOfRange(25);
    check(`[${l}] mpEscrowOutOfRange $30`, /(\$30|30\s*\$)/.test(oor));
    check(`[${l}] mpEscrowOutOfRange $3,000`, /(\$3,?000|3[\s,]000\s*\$)/.test(oor));
    check(`[${l}] mpEscrowOutOfRange /price`, /\/price/.test(oor));
    check(`[${l}] mpEscrowOutOfRange /escrow`, /\/escrow/.test(oor));

    check(`[${l}] mpOpenSafeDeal label exists`, typeof t.mpOpenSafeDeal === 'string' && t.mpOpenSafeDeal.length > 0);

    const reseller = typeof t.becomeReseller === 'function' ? t.becomeReseller() : t.becomeReseller;
    check(`[${l}] becomeReseller 50/50`, /50\/50/.test(reseller));
    check(`[${l}] becomeReseller /done`, /\/done/.test(reseller));

    // Keys mentioning SafeDeal not Lockbay
    const keysToCheck = ['mpProductCard','mpProductDetail','mpPreview','mpProductPublished',
                         'mpChatStartBuyer','mpChatStartSeller','mpPaymentWarning','mpAiScamWarning','mpResumedChat'];
    for (const k of keysToCheck) {
      let v = t[k];
      if (typeof v === 'function') {
        try { v = v({title:'X', price:100, id:'1'}, 'ctx'); }
        catch { try { v = v('X',100); } catch { try { v = v(100); } catch { try { v = v(); } catch { v = ''; } } } }
      }
      if (!v) continue;
      const s = String(v);
      check(`[${l}] ${k} no 'Lockbay'`, !/Lockbay/i.test(s), s.slice(0,120));
    }
  }
}

console.log(`\n═══ ${pass} passed, ${fail} failed ═══`);
process.exit(fail === 0 ? 0 : 1);
