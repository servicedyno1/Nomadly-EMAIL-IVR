// Country (ISO) of an E.164 number by longest dialing-code match. +1: Canadian/Caribbean area codes, else US.
const CODES = {
  7: 'RU', 20: 'EG', 27: 'ZA', 30: 'GR', 31: 'NL', 32: 'BE', 33: 'FR', 34: 'ES', 36: 'HU', 39: 'IT', 40: 'RO', 41: 'CH', 43: 'AT', 44: 'GB', 45: 'DK', 46: 'SE', 47: 'NO', 48: 'PL', 49: 'DE',
  51: 'PE', 52: 'MX', 53: 'CU', 54: 'AR', 55: 'BR', 56: 'CL', 57: 'CO', 58: 'VE', 60: 'MY', 61: 'AU', 62: 'ID', 63: 'PH', 64: 'NZ', 65: 'SG', 66: 'TH', 81: 'JP', 82: 'KR', 84: 'VN', 86: 'CN',
  90: 'TR', 91: 'IN', 92: 'PK', 93: 'AF', 94: 'LK', 95: 'MM', 98: 'IR', 211: 'SS', 212: 'MA', 213: 'DZ', 216: 'TN', 218: 'LY', 220: 'GM', 221: 'SN', 225: 'CI', 226: 'BF', 227: 'NE', 228: 'TG', 229: 'BJ',
  230: 'MU', 231: 'LR', 232: 'SL', 233: 'GH', 234: 'NG', 235: 'TD', 236: 'CF', 237: 'CM', 238: 'CV', 240: 'GQ', 241: 'GA', 242: 'CG', 243: 'CD', 244: 'AO', 248: 'SC', 249: 'SD', 250: 'RW', 251: 'ET',
  252: 'SO', 253: 'DJ', 254: 'KE', 255: 'TZ', 256: 'UG', 257: 'BI', 258: 'MZ', 260: 'ZM', 261: 'MG', 263: 'ZW', 264: 'NA', 265: 'MW', 266: 'LS', 267: 'BW', 268: 'SZ', 269: 'KM', 290: 'SH', 297: 'AW', 298: 'FO', 299: 'GL',
  350: 'GI', 351: 'PT', 352: 'LU', 353: 'IE', 354: 'IS', 355: 'AL', 356: 'MT', 357: 'CY', 358: 'FI', 359: 'BG', 370: 'LT', 371: 'LV', 372: 'EE', 373: 'MD', 374: 'AM', 375: 'BY', 376: 'AD', 377: 'MC', 378: 'SM',
  380: 'UA', 381: 'RS', 382: 'ME', 383: 'XK', 385: 'HR', 386: 'SI', 387: 'BA', 389: 'MK', 420: 'CZ', 421: 'SK', 423: 'LI', 500: 'FK', 501: 'BZ', 502: 'GT', 503: 'SV', 504: 'HN', 505: 'NI', 506: 'CR', 507: 'PA',
  509: 'HT', 590: 'GP', 591: 'BO', 592: 'GY', 593: 'EC', 594: 'GF', 595: 'PY', 596: 'MQ', 597: 'SR', 598: 'UY', 599: 'CW', 670: 'TL', 673: 'BN', 675: 'PG', 679: 'FJ', 852: 'HK', 853: 'MO', 855: 'KH', 856: 'LA',
  880: 'BD', 886: 'TW', 960: 'MV', 961: 'LB', 962: 'JO', 963: 'SY', 964: 'IQ', 965: 'KW', 966: 'SA', 967: 'YE', 968: 'OM', 970: 'PS', 971: 'AE', 972: 'IL', 973: 'BH', 974: 'QA', 975: 'BT', 976: 'MN', 977: 'NP',
  992: 'TJ', 993: 'TM', 994: 'AZ', 995: 'GE', 996: 'KG', 998: 'UZ',
};
const NANP = {
  CA: [204, 226, 236, 249, 250, 263, 289, 306, 343, 354, 365, 367, 368, 382, 403, 416, 418, 428, 431, 437, 438, 450, 468, 474, 506, 514, 519, 548, 579, 581, 584, 587, 604, 613, 639, 647, 672, 683, 705, 709, 742, 753, 778, 780, 782, 807, 819, 825, 867, 873, 879, 902, 905],
  PR: [787, 939], JM: [876, 658], DO: [809, 829, 849], BS: [242], BB: [246], TT: [868], BM: [441], KY: [345], AG: [268], AI: [264], VG: [284], VI: [340], GD: [473], LC: [758], DM: [767], VC: [784], KN: [869], TC: [649], GU: [671], MP: [670], AS: [684], SX: [721], MS: [664],
};
const AREA = Object.fromEntries(Object.entries(NANP).flatMap(([iso, list]) => list.map(a => [a, iso])));

export function countryOfPhone(n) {
  const d = String(n || '').replace(/\D/g, '');
  if (!d || !String(n).trim().startsWith('+') && d.length < 11) return null;
  if (d[0] === '1') return d.length >= 4 ? AREA[Number(d.slice(1, 4))] || 'US' : 'US';
  for (const len of [3, 2, 1]) { const iso = CODES[Number(d.slice(0, len))]; if (iso) return iso; }
  return null;
}
