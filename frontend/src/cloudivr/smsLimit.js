// Same rule as the server (js/cloudivr-web/sms-limit.js): 160 GSM-7 characters per text, or 70 with emoji/Unicode.
const GSM = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà');
const EXT = new Set('^{}\\[~]|€');
// Smart punctuation is sent as the plain GSM version (the server does the same), so it still fits 160.
const SMART = { '‘': "'", '’': "'", '‚': "'", '′': "'", '“': '"', '”': '"', '„': '"', '″': '"', '–': '-', '—': '-', '−': '-', '…': '...', '\u00a0': ' ', '\u2009': ' ', '\u200b': '' };
const gsmText = (t) => String(t || '').replace(/[‘’‚′“”„″–—−…\u00a0\u2009\u200b]/g, (c) => SMART[c]);

export function smsInfo(text) {
  const s = gsmText(text);
  let units = 0;
  for (const ch of s) {
    if (GSM.has(ch)) units += 1;
    else if (EXT.has(ch)) units += 2;
    else return { limit: 70, used: [...s].reduce((n, c) => n + (c.codePointAt(0) > 0xffff ? 2 : 1), 0), unicode: true };
  }
  return { limit: 160, used: units, unicode: false };
}

export const smsOver = (text) => { const i = smsInfo(text); return i.used > i.limit; };
export const smsCount = (text) => { const i = smsInfo(text); return `${i.used}/${i.limit}${i.unicode ? ' · emoji or special characters: 70 per text' : ''}`; };
