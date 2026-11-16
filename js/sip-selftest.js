// "Test my SIP registration" (bot + web): tells a customer in one tap whether the problem is on our side or in their
// softphone. Signs in to our own SIP server with the number's saved login (a REGISTER with no Contact — a read-only
// "who is signed in?" query that changes nothing) and reports: login accepted? any device signed in right now?
'use strict'
const dgram = require('dgram')
const crypto = require('crypto')
const phoneConfig = require('./phone-config')

const UA = 'cloudivr-selftest'
const OPS_UA = /^(cloudivr-selftest|preflight-check)/i // our own checks, never a customer's phone
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex')
const rnd = (n) => crypto.randomBytes(n).toString('hex')

// → { status: 200|401|403|…|0 (no reply), contacts: <devices signed in> }
function probe({ host, domain, user, pass, port = 5060, timeoutMs = 6000 }) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4')
    const callId = rnd(8), tag = rnd(4), uri = `sip:${domain}`
    let cseq = 0, authed = false, done = false
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); try { sock.close() } catch (_) {} resolve(r) }
    const timer = setTimeout(() => finish({ status: 0, contacts: 0 }), timeoutMs)
    const send = (auth) => {
      const a = sock.address()
      const msg = [
        `REGISTER ${uri} SIP/2.0`,
        `Via: SIP/2.0/UDP ${a.address}:${a.port};branch=z9hG4bK${rnd(6)};rport`,
        'Max-Forwards: 70',
        `From: <sip:${user}@${domain}>;tag=${tag}`,
        `To: <sip:${user}@${domain}>`,
        `Call-ID: ${callId}`,
        `CSeq: ${++cseq} REGISTER`,
        `User-Agent: ${UA}`,
        ...(auth ? [auth] : []),
        'Content-Length: 0', '', '',
      ].join('\r\n')
      sock.send(msg)
    }
    sock.on('error', () => finish({ status: 0, contacts: 0 }))
    sock.on('message', (buf) => {
      const txt = buf.toString()
      const status = Number((txt.match(/^SIP\/2\.0 (\d{3})/) || [])[1] || 0)
      if (!status || status < 200) return
      if ((status === 401 || status === 407) && !authed) {
        const m = txt.match(/^(WWW-Authenticate|Proxy-Authenticate):\s*Digest\s+(.*)$/im)
        if (!m) return finish({ status, contacts: 0 })
        const ch = Object.fromEntries([...m[2].matchAll(/(\w+)="?([^",\r\n]+)"?/g)].map(x => [x[1].toLowerCase(), x[2]]))
        const realm = ch.realm || domain, nonce = ch.nonce || ''
        const resp = md5(`${md5(`${user}:${realm}:${pass}`)}:${nonce}:${md5(`REGISTER:${uri}`)}`)
        authed = true
        return send(`${/^WWW/i.test(m[1]) ? 'Authorization' : 'Proxy-Authorization'}: Digest username="${user}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${resp}", algorithm=MD5`)
      }
      const contacts = status === 200 ? (txt.match(/^(?:Contact|m):.*$/gim) || []).join(',').split('<sip').length - 1 : 0
      finish({ status, contacts })
    })
    sock.connect(port, host, () => send(null))
  })
}

const last = new Map()
const COOLDOWN_MS = 15000

// → { code, phone, server, username, devices, lastSeenAt, lastApp }
async function run({ db, num, domain, probeFn = probe, now = Date.now() }) {
  const base = { phone: num.phoneNumber, server: domain, username: null, devices: 0, lastSeenAt: null, lastApp: null }
  if (num.sipDisabled || !phoneConfig.canAccessFeature(num.plan, 'sipCredentials')) return { ...base, code: 'not_included' }
  const user = num.telnyxSipUsername || num.sipUsername
  const pass = num.telnyxSipUsername ? (num.telnyxSipPassword || num.sipPassword) : num.sipPassword
  if (!user || !pass) return { ...base, code: 'no_login' }
  base.username = user
  const prev = last.get(num.phoneNumber)
  if (prev && now - prev.at < COOLDOWN_MS) return prev.result
  const seen = db ? await db.collection('sipPresence').findOne({ _id: String(user) }).catch(() => null) : null
  if (seen?.at && !OPS_UA.test(seen.ua || '')) { base.lastSeenAt = new Date(seen.at).toISOString(); base.lastApp = seen.ua || null }
  const args = { host: process.env.SIP_SERVER_IP || domain, domain, user, pass }
  let r = await probeFn(args)
  // Our SIP server caches a password for a few minutes; right after a reset the first try can miss — it re-reads on the next.
  if (r.status === 401) r = await probeFn(args)
  // 403 = the server's lockout: more than 10 wrong-password tries on this login in 15 minutes.
  const code = r.status === 0 ? 'unreachable' : r.status === 403 ? 'locked' : r.status !== 200 ? 'rejected' : r.contacts > 0 ? 'connected' : 'ready_not_connected'
  const result = { ...base, code, devices: r.contacts || 0, ...(code === 'rejected' ? { sipStatus: r.status } : {}) }
  last.set(num.phoneNumber, { at: now, result })
  return result
}

// Plain-language verdict for the web (the page translates it) — title, message and what to check.
function explain(r) {
  const tips = [
    `Server / Domain must be exactly ${r.server} — in the Domain or SIP Server field only, never added to the username.`,
    'Copy and paste the username and password — a mistyped or cut-off password is the most common cause.',
    'Port 5060 (UDP or TCP), or 5061 for TLS.',
    `Turn STUN off in the app (Zoiper: account → Network settings → STUN → off). Zoiper’s “STUN server … error (57)” means STUN is on. If your app needs one, use ${r.server} port 3478.`,
    'Try another network (mobile data instead of Wi‑Fi or the other way round) — some routers and firewalls block SIP.',
    'Using a dialer or PBX (3CX, FreePBX…)? Add this as a SIP trunk, not as a user or extension.',
  ]
  switch (r.code) {
    case 'connected': return { ok: true, title: 'Connected', message: `${r.devices} device${r.devices === 1 ? ' is' : 's are'} signed in to this number right now. Calls can ring it.`, tips: [] }
    case 'ready_not_connected': return { ok: false, title: 'Your login works — but no app is signed in', message: 'We just signed in with this number’s username and password on our server and it was accepted, so the line is ready on our side. Your softphone is not connected, which points to a setting in the app or the network it is on.', tips }
    case 'no_login': return { ok: false, title: 'This number has no SIP login yet', message: 'Create new credentials for this number, then set up your softphone with them.', tips: [] }
    case 'not_included': return { ok: false, title: 'SIP is not part of this number’s plan', message: 'Upgrade the plan to use a softphone or desk phone with this number.', tips: [] }
    case 'locked': return { ok: false, title: 'This login is locked for a few minutes', message: 'An app kept trying to sign in with the wrong password, so our server paused this login for 15 minutes. Close or sign out of every softphone using it, wait 15 minutes, then sign in again with the exact username and password (copy and paste them).', tips: [tips[0], tips[1]] }
    case 'unreachable': return { ok: false, title: 'We could not reach our SIP server', message: 'This is on our side, not your settings. Please try again in a minute — support has what it needs if it keeps happening.', tips: [] }
    default: return { ok: false, title: 'Our server did not accept this login', message: 'This is on our side, not your settings. Create new credentials and try again, or contact support.', tips: [] }
  }
}

const BOT = {
  en: { head: '🧪 <b>SIP registration test</b>', connected: (n) => `✅ <b>Connected</b> — ${n} device${n === 1 ? ' is' : 's are'} signed in right now. Calls can ring it.`, ready: '🟡 <b>Your login works — but no app is signed in.</b>\nWe just signed in with your username and password on our server and it was accepted, so the line is ready on our side. The problem is a setting in your softphone or its network:', tips: (s) => [`Server / Domain: <code>${s}</code> — in the Domain field only, not added to the username`, 'Copy‑paste username and password (tap 👁️ Reveal Password) — don’t retype', 'Port 5060 (UDP/TCP) or 5061 (TLS)', `Turn STUN <b>off</b> (Zoiper: account → Network settings → STUN → off) — Zoiper “STUN server … error (57)” means it is on. If your app needs one: <code>${s}</code> port 3478`, 'Try another network — some Wi‑Fi and firewalls block SIP', 'Dialer or PBX? Add it as a SIP trunk, not a user/extension'], seen: (w, a) => `Last signed in: ${w}${a ? ` (${a})` : ''}`, locked: '🔒 <b>This login is locked for a few minutes.</b>\nAn app kept trying to sign in with the wrong password, so our server paused this login for 15 minutes. Close or sign out of every softphone using it, wait 15 minutes, then sign in again — copy‑paste the username and password (tap 👁️ Reveal Password).', no_login: '⚠️ This number has no SIP login yet. Tap 🔄 Reset Password to create one.', not_included: '⚠️ SIP is not part of this number’s plan.', unreachable: '🔴 We could not reach our SIP server. This is on our side, not your settings — please try again in a minute.', rejected: '🔴 Our server did not accept this login. This is on our side — tap 🔄 Reset Password and test again, or contact support.' },
  fr: { head: '🧪 <b>Test d’enregistrement SIP</b>', connected: (n) => `✅ <b>Connecté</b> — ${n} appareil(s) connecté(s) en ce moment. Les appels peuvent sonner.`, ready: '🟡 <b>Vos identifiants fonctionnent — mais aucune application n’est connectée.</b>\nNous venons de nous connecter avec votre identifiant et mot de passe sur notre serveur : accepté. La ligne est prête de notre côté. Le problème vient d’un réglage de votre softphone ou de son réseau :', tips: (s) => [`Serveur / Domaine : <code>${s}</code> — uniquement dans le champ Domaine, pas dans l’identifiant`, 'Copiez‑collez l’identifiant et le mot de passe — ne les retapez pas', 'Port 5060 (UDP/TCP) ou 5061 (TLS)', `<b>Désactivez</b> STUN (Zoiper : compte → Paramètres réseau → STUN → désactivé) — l’erreur Zoiper « STUN server … (57) » signifie qu’il est activé. Si nécessaire : <code>${s}</code> port 3478`, 'Essayez un autre réseau — certains Wi‑Fi et pare‑feu bloquent le SIP', 'Dialer ou PBX ? Ajoutez‑le comme trunk SIP, pas comme utilisateur'], seen: (w, a) => `Dernière connexion : ${w}${a ? ` (${a})` : ''}`, locked: '🔒 <b>Ces identifiants sont bloqués quelques minutes.</b>\nUne application a essayé plusieurs fois avec un mauvais mot de passe ; notre serveur a suspendu cet identifiant pendant 15 minutes. Fermez tous les softphones qui l’utilisent, attendez 15 minutes, puis reconnectez‑vous en copiant‑collant l’identifiant et le mot de passe.', no_login: '⚠️ Ce numéro n’a pas encore d’identifiants SIP. Appuyez sur 🔄 Réinitialiser le mot de passe.', not_included: '⚠️ Le SIP n’est pas inclus dans le forfait de ce numéro.', unreachable: '🔴 Notre serveur SIP est injoignable. Le problème est de notre côté — réessayez dans une minute.', rejected: '🔴 Notre serveur a refusé ces identifiants. Le problème est de notre côté — réinitialisez le mot de passe et retestez, ou contactez le support.' },
  zh: { head: '🧪 <b>SIP 注册测试</b>', connected: (n) => `✅ <b>已连接</b> — 当前有 ${n} 台设备登录，来电可以响铃。`, ready: '🟡 <b>您的登录信息有效 — 但没有应用登录。</b>\n我们刚用您的用户名和密码在服务器上登录并成功，线路在我们这边已就绪。问题出在您的软电话设置或网络：', tips: (s) => [`服务器 / 域名：<code>${s}</code> — 只填在域名栏，不要加到用户名里`, '复制粘贴用户名和密码 — 不要手动输入', '端口 5060（UDP/TCP）或 5061（TLS）', `<b>关闭</b> STUN（Zoiper：账户 → 网络设置 → STUN → 关闭）— Zoiper 报错“STUN server … (57)”表示它已开启。如必须填写：<code>${s}</code> 端口 3478`, '换一个网络试试 — 有些 Wi‑Fi 和防火墙会拦截 SIP', '使用拨号器或 PBX？请添加为 SIP 中继，而不是用户/分机'], seen: (w, a) => `上次登录：${w}${a ? `（${a}）` : ''}`, locked: '🔒 <b>此登录已被暂时锁定。</b>\n有应用多次使用错误密码登录，服务器已将此登录暂停 15 分钟。请关闭所有使用它的软电话，等待 15 分钟，然后复制粘贴用户名和密码重新登录。', no_login: '⚠️ 此号码还没有 SIP 登录信息。点击 🔄 重置密码 创建。', not_included: '⚠️ 此号码的套餐不包含 SIP。', unreachable: '🔴 无法连接我们的 SIP 服务器。这是我们这边的问题 — 请稍后再试。', rejected: '🔴 我们的服务器未接受此登录。这是我们这边的问题 — 请重置密码后再测试，或联系客服。' },
  hi: { head: '🧪 <b>SIP रजिस्ट्रेशन टेस्ट</b>', connected: (n) => `✅ <b>कनेक्टेड</b> — अभी ${n} डिवाइस साइन इन है। कॉल बज सकती हैं।`, ready: '🟡 <b>आपका लॉगिन काम करता है — लेकिन कोई ऐप साइन इन नहीं है।</b>\nहमने अभी आपके यूज़रनेम और पासवर्ड से अपने सर्वर पर साइन इन किया और वह स्वीकार हुआ, यानी लाइन हमारी तरफ़ से तैयार है। समस्या आपके सॉफ़्टफ़ोन की सेटिंग या नेटवर्क में है:', tips: (s) => [`सर्वर / डोमेन: <code>${s}</code> — केवल डोमेन फ़ील्ड में, यूज़रनेम में नहीं`, 'यूज़रनेम और पासवर्ड कॉपी‑पेस्ट करें — दोबारा टाइप न करें', 'पोर्ट 5060 (UDP/TCP) या 5061 (TLS)', `STUN <b>बंद</b> करें (Zoiper: अकाउंट → नेटवर्क सेटिंग्स → STUN → बंद) — Zoiper त्रुटि “STUN server … (57)” का मतलब है कि यह चालू है। ज़रूरी हो तो: <code>${s}</code> पोर्ट 3478`, 'दूसरा नेटवर्क आज़माएँ — कुछ Wi‑Fi और फ़ायरवॉल SIP रोकते हैं', 'डायलर या PBX? इसे SIP ट्रंक के रूप में जोड़ें, यूज़र के रूप में नहीं'], seen: (w, a) => `पिछला साइन इन: ${w}${a ? ` (${a})` : ''}`, locked: '🔒 <b>यह लॉगिन कुछ मिनटों के लिए लॉक है।</b>\nकोई ऐप बार‑बार ग़लत पासवर्ड से साइन इन कर रहा था, इसलिए सर्वर ने यह लॉगिन 15 मिनट के लिए रोक दिया। इसे इस्तेमाल करने वाले सभी सॉफ़्टफ़ोन बंद करें, 15 मिनट रुकें, फिर यूज़रनेम और पासवर्ड कॉपी‑पेस्ट करके साइन इन करें।', no_login: '⚠️ इस नंबर का अभी कोई SIP लॉगिन नहीं है। 🔄 पासवर्ड रीसेट करें दबाएँ।', not_included: '⚠️ SIP इस नंबर के प्लान में शामिल नहीं है।', unreachable: '🔴 हम अपने SIP सर्वर तक नहीं पहुँच सके। यह हमारी तरफ़ की समस्या है — एक मिनट में फिर कोशिश करें।', rejected: '🔴 हमारे सर्वर ने यह लॉगिन स्वीकार नहीं किया। यह हमारी तरफ़ की समस्या है — पासवर्ड रीसेट करके फिर टेस्ट करें या सपोर्ट से संपर्क करें।' },
  fa: { head: '🧪 <b>تست ثبت SIP</b>', connected: (n) => `✅ <b>متصل</b> — هم‌اکنون ${n} دستگاه وارد شده است. تماس‌ها زنگ می‌خورند.`, ready: '🟡 <b>اطلاعات ورود شما درست است — اما هیچ برنامه‌ای وارد نشده.</b>\nهمین حالا با نام کاربری و رمز شما در سرور خودمان وارد شدیم و پذیرفته شد؛ خط از سمت ما آماده است. مشکل از تنظیمات سافت‌فون یا شبکهٔ شماست:', tips: (s) => [`سرور / دامنه: <code>${s}</code> — فقط در قسمت دامنه، نه در نام کاربری`, 'نام کاربری و رمز را کپی و جای‌گذاری کنید — دوباره تایپ نکنید', 'پورت 5060 (UDP/TCP) یا 5061 (TLS)', `STUN را <b>خاموش</b> کنید (Zoiper: حساب → تنظیمات شبکه → STUN → خاموش) — خطای Zoiper «STUN server … (57)» یعنی روشن است. در صورت نیاز: <code>${s}</code> پورت 3478`, 'شبکهٔ دیگری را امتحان کنید — برخی وای‌فای‌ها و فایروال‌ها SIP را مسدود می‌کنند', 'دایلر یا PBX؟ آن را به‌صورت ترانک SIP اضافه کنید، نه کاربر'], seen: (w, a) => `آخرین ورود: ${w}${a ? ` (${a})` : ''}`, locked: '🔒 <b>این ورود برای چند دقیقه قفل شده است.</b>\nیک برنامه بارها با رمز اشتباه تلاش کرده و سرور این ورود را ۱۵ دقیقه متوقف کرده است. همهٔ سافت‌فون‌هایی که از آن استفاده می‌کنند را ببندید، ۱۵ دقیقه صبر کنید، سپس با کپی و جای‌گذاری نام کاربری و رمز دوباره وارد شوید.', no_login: '⚠️ این شماره هنوز اطلاعات SIP ندارد. روی 🔄 بازنشانی رمز عبور بزنید.', not_included: '⚠️ SIP در طرح این شماره نیست.', unreachable: '🔴 به سرور SIP خودمان دسترسی نداشتیم. مشکل از سمت ماست — یک دقیقهٔ دیگر دوباره امتحان کنید.', rejected: '🔴 سرور ما این ورود را نپذیرفت. مشکل از سمت ماست — رمز را بازنشانی و دوباره تست کنید یا با پشتیبانی تماس بگیرید.' },
}

function botText(r, lang = 'en') {
  const t = BOT[lang] || BOT.en
  const lines = [t.head, `📞 ${r.phone}`, '']
  if (r.code === 'connected') lines.push(t.connected(r.devices))
  else if (r.code === 'ready_not_connected') {
    lines.push(t.ready, '', ...t.tips(r.server).map((x, i) => `${i + 1}. ${x}`))
    if (r.lastSeenAt) lines.push('', t.seen(new Date(r.lastSeenAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC', r.lastApp))
  } else lines.push(t[r.code] || t.rejected)
  return lines.join('\n')
}

module.exports = { probe, run, explain, botText, UA }
