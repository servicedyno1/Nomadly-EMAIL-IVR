// Translates the rendered CloudIVR UI in place (text nodes + a few attributes) from an English → language
// dictionary. Keys may hold {0}-style slots for text built from values ("Renewed until {0}").
const SKIP = 'script,style,textarea,code,pre,input,[data-no-translate],[contenteditable="true"]';
const SCOPE = '.civr,[data-sonner-toaster]';
const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
const SLOT = /^\{\d+\}$/;

let dict = null;
let patterns = [];
let cache = new Map();
let observer = null;
const texts = new WeakMap();
const attrs = new WeakMap();

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(d) {
  return Object.keys(d).filter(k => /\{\d+\}/.test(k)).map(k => {
    const parts = k.split(/(\{\d+\})/).filter(Boolean);
    const lit = parts.filter(p => !SLOT.test(p)).join('');
    if (lit.replace(/[^A-Za-z]/g, '').length < 3) return null;
    return { re: new RegExp(`^${parts.map(p => (SLOT.test(p) ? '([\\s\\S]+?)' : esc(p))).join('')}$`), slots: parts.filter(p => SLOT.test(p)), out: d[k], lit: lit.length };
  }).filter(Boolean).sort((a, b) => b.lit - a.lit);
}

function lookup(core) {
  if (dict[core] != null) return dict[core];
  const dot = core.match(/^(.*?)([.:!?…])$/);
  if (dot && dict[dot[1]] != null) return dict[dot[1]] + dot[2];
  for (const p of patterns) {
    const m = core.match(p.re);
    if (m) return p.slots.reduce((o, s, i) => o.split(s).join(tr(m[i + 1])), p.out);
  }
  return null;
}

// Translate one string (keeps surrounding whitespace); unknown text is returned unchanged.
export function tr(s) {
  if (!dict || typeof s !== 'string' || !/[A-Za-z]/.test(s)) return s;
  const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
  let out = cache.get(m[2]);
  if (out === undefined) { out = lookup(m[2]); cache.set(m[2], out); }
  return out == null ? s : m[1] + out + m[3];
}

const inScope = (el) => el && el.closest && el.closest(SCOPE) && !el.closest(SKIP);

function doText(node) {
  const el = node.parentElement;
  if (!inScope(el)) return;
  const rec = texts.get(node), cur = node.nodeValue;
  if (rec && cur === rec.out) return;
  const out = tr(cur);
  texts.set(node, { src: cur, out });
  if (out !== cur) node.nodeValue = out;
}

function doAttr(el, name) {
  if (!el.hasAttribute(name) || !el.closest(SCOPE) || el.closest('[data-no-translate]')) return;
  const map = attrs.get(el) || {};
  const cur = el.getAttribute(name), rec = map[name];
  if (rec && cur === rec.out) return;
  const out = tr(cur);
  map[name] = { src: cur, out };
  attrs.set(el, map);
  if (out !== cur) el.setAttribute(name, out);
}

function walk(root) {
  if (root.nodeType === 3) { doText(root); return; }
  if (root.nodeType !== 1) return;
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) doText(n);
  const els = [root, ...root.querySelectorAll(ATTRS.map(a => `[${a}]`).join(','))];
  for (const el of els) for (const a of ATTRS) if (el.hasAttribute && el.hasAttribute(a)) doAttr(el, a);
}

// Puts back the English text before re-translating (language switch).
function restore(root) {
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    const rec = texts.get(n);
    if (rec && n.nodeValue === rec.out) n.nodeValue = rec.src;
    texts.delete(n);
  }
  for (const el of root.querySelectorAll(ATTRS.map(a => `[${a}]`).join(','))) {
    const map = attrs.get(el);
    if (!map) continue;
    for (const [a, rec] of Object.entries(map)) if (el.getAttribute(a) === rec.out) el.setAttribute(a, rec.src);
    attrs.delete(el);
  }
}

export function setDictionary(d) {
  const root = document.body;
  if (observer) { observer.disconnect(); observer = null; }
  restore(root);
  dict = d && Object.keys(d).length ? d : null;
  cache = new Map();
  patterns = dict ? compile(dict) : [];
  if (!dict) return;
  walk(root);
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttr(m.target, m.attributeName);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
