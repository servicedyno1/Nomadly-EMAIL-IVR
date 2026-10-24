'use strict'
// Calling window for AI campaign calls: 8am–9pm in the called person's local time (TCPA).
// NANP numbers resolve by area code (split codes list every zone they cover, all must be in-window); others by country code.
const { DateTime } = require('luxon')

const NANP = {}
const add = (tz, codes) => codes.split(/\s+/).filter(Boolean).forEach(c => { NANP[c] = [...(NANP[c] || []), tz] })
add('America/Los_Angeles', `209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951
  206 253 360 425 509 564 458 503 541 971 702 725 775 236 250 257 604 672 778 208 986`)
add('America/Denver', '303 719 720 970 983 505 575 385 435 801 307 406 208 986 368 403 587 780 825 915 308 605 701 541 867')
add('America/Phoenix', '480 520 602 623 928')
add('America/Anchorage', '907')
add('Pacific/Honolulu', '808')
add('America/Chicago', `205 251 256 334 659 938 479 501 870 327 217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872 319 515 563 641 712
  316 620 785 913 225 318 337 504 985 218 320 507 612 651 763 952 228 601 662 769 314 417 557 573 636 660 816 975 308 402 531 701 405 539 572 580 918 605
  615 629 731 901 931 210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 936 940 945 956 972 979 262 274 414 534 608 715 920
  219 812 270 364 906 850 204 431 584 807 867`)
add('America/New_York', '812 270 364 906 850 807 867')
add('America/Regina', '306 474 639')
add('America/Halifax', '782 902 428 506 441')
add('America/St_Johns', '709 879')
add('America/Puerto_Rico', '787 939 340 264 268 284 473 664 721 758 767 784 869 246')
add('America/Nassau', '242')
add('America/Cayman', '345')
add('America/Grand_Turk', '649')
add('America/Jamaica', '658 876')
add('America/Santo_Domingo', '809 829 849')
add('America/Port_of_Spain', '868')
add('Pacific/Guam', '671 670')
add('Pacific/Pago_Pago', '684')

const CC = {
  44: 'Europe/London', 33: 'Europe/Paris', 34: 'Europe/Madrid', 49: 'Europe/Berlin', 39: 'Europe/Rome', 31: 'Europe/Amsterdam', 32: 'Europe/Brussels',
  41: 'Europe/Zurich', 43: 'Europe/Vienna', 351: 'Europe/Lisbon', 353: 'Europe/Dublin', 46: 'Europe/Stockholm', 47: 'Europe/Oslo', 45: 'Europe/Copenhagen',
  48: 'Europe/Warsaw', 30: 'Europe/Athens', 40: 'Europe/Bucharest', 7: 'Europe/Moscow', 90: 'Europe/Istanbul', 972: 'Asia/Jerusalem', 971: 'Asia/Dubai',
  966: 'Asia/Riyadh', 20: 'Africa/Cairo', 212: 'Africa/Casablanca', 234: 'Africa/Lagos', 233: 'Africa/Accra', 225: 'Africa/Abidjan', 221: 'Africa/Dakar',
  237: 'Africa/Douala', 254: 'Africa/Nairobi', 27: 'Africa/Johannesburg', 52: 'America/Mexico_City', 55: 'America/Sao_Paulo', 54: 'America/Argentina/Buenos_Aires',
  57: 'America/Bogota', 56: 'America/Santiago', 51: 'America/Lima', 58: 'America/Caracas', 61: 'Australia/Sydney', 64: 'Pacific/Auckland', 91: 'Asia/Kolkata',
  63: 'Asia/Manila', 62: 'Asia/Jakarta', 60: 'Asia/Kuala_Lumpur', 65: 'Asia/Singapore', 66: 'Asia/Bangkok', 84: 'Asia/Ho_Chi_Minh', 81: 'Asia/Tokyo',
  82: 'Asia/Seoul', 86: 'Asia/Shanghai', 852: 'Asia/Hong_Kong',
}

function zonesOf(number) {
  const d = String(number || '').replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return NANP[d.slice(1, 4)] || ['America/New_York']
  for (const len of [3, 2, 1]) { const tz = CC[d.slice(0, len)]; if (tz) return [tz] }
  return []
}

const START_HOUR = 8, END_HOUR = 21
const callableNow = (number, now = DateTime.now()) => zonesOf(number).every(tz => { const h = now.setZone(tz).hour; return h >= START_HOUR && h < END_HOUR })

module.exports = { callableNow, zonesOf, START_HOUR, END_HOUR }
