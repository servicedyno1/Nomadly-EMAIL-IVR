'use strict'
// Where a number rings: US state / Canadian province from the area code, otherwise the country from the calling code.
const NANP = {}
const add = (name, codes) => codes.split(/\s+/).filter(Boolean).forEach(c => { NANP[c] = name })
add('Alabama', '205 251 256 334 659 938')
add('Alaska', '907')
add('Arizona', '480 520 602 623 928')
add('Arkansas', '327 479 501 870')
add('California', '209 213 279 310 323 341 350 357 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 738 747 760 805 818 820 831 840 858 909 916 925 949 951')
add('Colorado', '303 719 720 970 983')
add('Connecticut', '203 475 860 959')
add('Delaware', '302')
add('Washington DC', '202 771')
add('Florida', '239 305 321 324 352 386 407 448 561 645 656 689 727 728 754 772 786 813 850 863 904 941 954')
add('Georgia', '229 404 470 478 678 706 762 770 912 943')
add('Hawaii', '808')
add('Idaho', '208 986')
add('Illinois', '217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 861 872')
add('Indiana', '219 260 317 463 574 765 812 930')
add('Iowa', '319 515 563 641 712')
add('Kansas', '316 620 785 913')
add('Kentucky', '270 364 502 606 859')
add('Louisiana', '225 318 337 504 985')
add('Maine', '207')
add('Maryland', '227 240 301 410 443 667')
add('Massachusetts', '339 351 413 508 617 774 781 857 978')
add('Michigan', '231 248 269 313 517 586 616 679 734 810 906 947 989')
add('Minnesota', '218 320 507 612 651 763 952')
add('Mississippi', '228 601 662 769')
add('Missouri', '314 417 557 573 636 660 816 975')
add('Montana', '406')
add('Nebraska', '308 402 531')
add('Nevada', '702 725 775')
add('New Hampshire', '603')
add('New Jersey', '201 551 609 640 732 848 856 862 908 973')
add('New Mexico', '505 575')
add('New York', '212 315 329 332 347 363 516 518 585 607 624 631 646 680 716 718 838 845 914 917 929 934')
add('North Carolina', '252 336 472 704 743 828 910 919 980 984')
add('North Dakota', '701')
add('Ohio', '216 220 234 283 326 330 380 419 436 440 513 567 614 740 937')
add('Oklahoma', '405 539 572 580 918')
add('Oregon', '458 503 541 971')
add('Pennsylvania', '215 223 267 272 412 445 484 570 582 610 717 724 814 835 878')
add('Rhode Island', '401')
add('South Carolina', '803 821 839 843 854 864')
add('South Dakota', '605')
add('Tennessee', '423 615 629 731 865 901 931')
add('Texas', '210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 915 936 940 945 956 972 979')
add('Utah', '385 435 801')
add('Vermont', '802')
add('Virginia', '276 434 540 571 686 703 757 804 826 948')
add('Washington', '206 253 360 425 509 564')
add('West Virginia', '304 681')
add('Wisconsin', '262 274 353 414 534 608 715 920')
add('Wyoming', '307')
add('Puerto Rico', '787 939')
add('US Virgin Islands', '340')
add('Guam', '671')
add('Northern Mariana Islands', '670')
add('American Samoa', '684')
add('Alberta, Canada', '368 403 587 780 825')
add('British Columbia, Canada', '236 250 257 604 672 778')
add('Manitoba, Canada', '204 431 584')
add('New Brunswick, Canada', '428 506')
add('Newfoundland, Canada', '709 879')
add('Nova Scotia / PEI, Canada', '782 902')
add('Ontario, Canada', '226 249 289 343 365 382 387 416 437 519 548 613 647 683 705 742 753 807 905 942')
add('Quebec, Canada', '263 354 367 418 438 450 468 514 579 581 819 873')
add('Saskatchewan, Canada', '306 474 639')
add('Northern Canada', '867')
add('Bahamas', '242'); add('Barbados', '246'); add('Anguilla', '264'); add('Antigua and Barbuda', '268'); add('British Virgin Islands', '284')
add('Cayman Islands', '345'); add('Bermuda', '441'); add('Grenada', '473'); add('Turks and Caicos', '649'); add('Jamaica', '658 876')
add('Montserrat', '664'); add('Sint Maarten', '721'); add('Saint Lucia', '758'); add('Dominica', '767'); add('Saint Vincent', '784')
add('Dominican Republic', '809 829 849'); add('Trinidad and Tobago', '868'); add('Saint Kitts and Nevis', '869')
add('Toll-free', '800 833 844 855 866 877 888')

const CC = {
  7: 'Russia / Kazakhstan', 20: 'Egypt', 27: 'South Africa', 30: 'Greece', 31: 'Netherlands', 32: 'Belgium', 33: 'France', 34: 'Spain', 36: 'Hungary',
  39: 'Italy', 40: 'Romania', 41: 'Switzerland', 43: 'Austria', 44: 'United Kingdom', 45: 'Denmark', 46: 'Sweden', 47: 'Norway', 48: 'Poland',
  49: 'Germany', 51: 'Peru', 52: 'Mexico', 53: 'Cuba', 54: 'Argentina', 55: 'Brazil', 56: 'Chile', 57: 'Colombia', 58: 'Venezuela', 60: 'Malaysia',
  61: 'Australia', 62: 'Indonesia', 63: 'Philippines', 64: 'New Zealand', 65: 'Singapore', 66: 'Thailand', 81: 'Japan', 82: 'South Korea',
  84: 'Vietnam', 86: 'China', 90: 'Turkey', 91: 'India', 92: 'Pakistan', 93: 'Afghanistan', 94: 'Sri Lanka', 95: 'Myanmar', 98: 'Iran',
  211: 'South Sudan', 212: 'Morocco', 213: 'Algeria', 216: 'Tunisia', 218: 'Libya', 220: 'Gambia', 221: 'Senegal', 223: 'Mali', 224: 'Guinea',
  225: 'Ivory Coast', 226: 'Burkina Faso', 227: 'Niger', 228: 'Togo', 229: 'Benin', 230: 'Mauritius', 231: 'Liberia', 232: 'Sierra Leone',
  233: 'Ghana', 234: 'Nigeria', 235: 'Chad', 236: 'Central African Republic', 237: 'Cameroon', 238: 'Cape Verde', 240: 'Equatorial Guinea',
  241: 'Gabon', 242: 'Congo', 243: 'DR Congo', 244: 'Angola', 248: 'Seychelles', 249: 'Sudan', 250: 'Rwanda', 251: 'Ethiopia', 252: 'Somalia',
  253: 'Djibouti', 254: 'Kenya', 255: 'Tanzania', 256: 'Uganda', 257: 'Burundi', 258: 'Mozambique', 260: 'Zambia', 261: 'Madagascar',
  263: 'Zimbabwe', 264: 'Namibia', 265: 'Malawi', 266: 'Lesotho', 267: 'Botswana', 268: 'Eswatini', 291: 'Eritrea', 297: 'Aruba',
  351: 'Portugal', 352: 'Luxembourg', 353: 'Ireland', 354: 'Iceland', 355: 'Albania', 356: 'Malta', 357: 'Cyprus', 358: 'Finland',
  359: 'Bulgaria', 370: 'Lithuania', 371: 'Latvia', 372: 'Estonia', 373: 'Moldova', 374: 'Armenia', 375: 'Belarus', 376: 'Andorra',
  377: 'Monaco', 380: 'Ukraine', 381: 'Serbia', 382: 'Montenegro', 383: 'Kosovo', 385: 'Croatia', 386: 'Slovenia', 387: 'Bosnia and Herzegovina',
  389: 'North Macedonia', 420: 'Czechia', 421: 'Slovakia', 423: 'Liechtenstein', 501: 'Belize', 502: 'Guatemala', 503: 'El Salvador',
  504: 'Honduras', 505: 'Nicaragua', 506: 'Costa Rica', 507: 'Panama', 509: 'Haiti', 591: 'Bolivia', 592: 'Guyana', 593: 'Ecuador',
  595: 'Paraguay', 597: 'Suriname', 598: 'Uruguay', 852: 'Hong Kong', 853: 'Macau', 855: 'Cambodia', 856: 'Laos', 880: 'Bangladesh',
  886: 'Taiwan', 960: 'Maldives', 961: 'Lebanon', 962: 'Jordan', 963: 'Syria', 964: 'Iraq', 965: 'Kuwait', 966: 'Saudi Arabia', 967: 'Yemen',
  968: 'Oman', 970: 'Palestine', 971: 'United Arab Emirates', 972: 'Israel', 973: 'Bahrain', 974: 'Qatar', 975: 'Bhutan', 976: 'Mongolia',
  977: 'Nepal', 992: 'Tajikistan', 993: 'Turkmenistan', 994: 'Azerbaijan', 995: 'Georgia (country)', 996: 'Kyrgyzstan', 998: 'Uzbekistan',
}

// → readable area, e.g. "Florida", "Ontario, Canada", "United Kingdom"; "Other" when unknown.
function areaOf(number) {
  const d = String(number || '').replace(/\D/g, '')
  if (d.length === 11 && d[0] === '1') return NANP[d.slice(1, 4)] || 'United States / Canada'
  for (const len of [3, 2, 1]) { const c = CC[d.slice(0, len)]; if (c) return c }
  return 'Other'
}

module.exports = { areaOf }
