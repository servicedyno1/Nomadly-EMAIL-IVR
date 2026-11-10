'use strict'
// USA/Canada recipient checks: valid mobile-capable US/CA number (no Caribbean/territories/toll-free) + local quiet hours by area code.
const { parsePhoneNumberFromString } = require('libphonenumber-js/max')

const Z = {
  'America/New_York': '201 202 203 207 212 215 216 220 223 226 227 229 231 234 239 240 248 249 252 260 263 267 269 272 276 283 289 301 302 304 305 313 315 317 321 324 326 329 330 332 336 339 343 347 351 352 354 363 365 367 380 382 386 401 404 407 410 412 413 416 418 419 423 434 436 437 438 440 443 445 448 450 463 468 470 472 475 478 484 502 508 513 514 516 517 518 519 540 548 551 561 567 570 571 574 579 581 582 585 586 603 606 607 609 610 613 614 616 617 624 631 640 645 646 647 656 667 678 679 680 681 683 686 689 703 704 705 706 716 717 718 724 727 728 732 734 740 742 743 753 754 757 762 765 770 772 774 781 786 802 803 804 810 813 814 819 826 828 835 838 839 843 845 848 854 856 857 859 860 862 863 864 865 873 878 904 905 908 910 912 914 917 919 929 934 937 941 942 943 947 948 954 959 973 978 980 984 989',
  'America/Chicago': '204 205 210 214 217 218 224 225 228 251 254 256 262 274 281 308 309 312 314 316 318 319 320 325 327 331 334 337 346 353 361 402 405 409 414 417 430 431 432 447 464 469 479 501 504 507 512 515 531 534 539 557 563 572 573 580 584 601 605 608 612 615 618 620 629 630 636 641 651 659 660 662 682 701 708 712 713 715 726 730 731 737 763 769 773 779 785 806 815 816 817 830 832 847 861 870 872 901 903 913 918 920 931 936 938 940 945 952 956 972 975 979 985',
  'America/Regina': '306 474 639',
  'America/Denver': '303 307 385 406 435 505 575 719 720 801 915 970 983',
  'America/Edmonton': '368 403 587 780 825',
  'America/Phoenix': '480 520 602 623 928',
  'America/Los_Angeles': '206 209 213 253 279 310 323 341 350 360 369 408 415 424 425 442 458 503 509 510 530 541 559 562 564 619 626 628 650 657 661 669 702 707 714 725 747 760 775 805 818 820 831 840 858 909 916 925 949 951 971',
  'America/Vancouver': '236 250 257 604 672 778',
  'America/Anchorage': '907',
  'Pacific/Honolulu': '808',
  'America/Halifax': '506 782 902',
  'America/St_Johns': '709 879',
}
// Area codes that span two zones: both must be inside the window.
const SPLIT = { 850: ['America/New_York', 'America/Chicago'], 812: ['America/New_York', 'America/Chicago'], 930: ['America/New_York', 'America/Chicago'], 906: ['America/New_York', 'America/Chicago'], 807: ['America/New_York', 'America/Chicago'], 219: ['America/Chicago', 'America/New_York'], 270: ['America/Chicago', 'America/New_York'], 364: ['America/Chicago', 'America/New_York'], 208: ['America/Denver', 'America/Los_Angeles'], 986: ['America/Denver', 'America/Los_Angeles'], 701: ['America/Chicago', 'America/Denver'], 605: ['America/Chicago', 'America/Denver'], 308: ['America/Chicago', 'America/Denver'], 867: ['America/Edmonton', 'America/Vancouver'] }
const NPA = {}
for (const [z, list] of Object.entries(Z)) for (const a of list.split(' ')) NPA[a] = [z]
Object.assign(NPA, SPLIT)
const UNKNOWN = ['America/New_York', 'America/Los_Angeles']
const MAINLAND = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles']
const BAD_TYPES = ['TOLL_FREE', 'PREMIUM_RATE', 'SHARED_COST', 'PERSONAL_NUMBER', 'UAN', 'PAGER', 'VOICEMAIL']

function validUsCa(p) {
  const x = parsePhoneNumberFromString(String(p || ''))
  return !!x && x.isValid() && ['US', 'CA'].includes(x.country) && !BAD_TYPES.includes(x.getType())
}
const zones = (p) => NPA[String(p).slice(2, 5)] || UNKNOWN
const hourIn = (z, t) => { const s = new Intl.DateTimeFormat('en-US', { timeZone: z, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).format(t); const [h, m] = s.split(':').map(Number); return h + m / 60 }
const open = (zs, t, from, to) => zs.every(z => { const h = hourIn(z, t); return h >= from && h < to })
// 0 when the recipient may get a text now, else ms until their window opens.
function quietWait(p, from = 8, to = 21, now = Date.now()) {
  const zs = zones(p)
  if (open(zs, new Date(now), from, to)) return 0
  for (let m = 5; m <= 26 * 60; m += 5) if (open(zs, new Date(now + m * 60000), from, to)) return m * 60000
  return 3600000
}
// A booking hour (UTC) is offered only when every mainland zone is inside the window for the whole hour.
const hourOpen = (date, h, from = 8, to = 21) => { const t = new Date(`${date}T${String(h).padStart(2, '0')}:00:00Z`).getTime(); return open(MAINLAND, new Date(t), from, to) && open(MAINLAND, new Date(t + 59 * 60000), from, to) }

module.exports = { validUsCa, quietWait, hourOpen, zones }
