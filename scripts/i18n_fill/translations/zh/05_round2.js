// Round 2 (2026-10): admin strings back to English, new compact hP.plans/generatePlanText,
// user-facing leftovers (vps_10, billing-cycle names, Support button label).
const { en } = require('../../../../js/lang/en.js')
const { ADMIN_KEYS, pick } = require('../../admin_keys.js')

const cycle = `({ Hourly: '按小时', Monthly: '按月' })[item.type] || item.type.replace(/(\\d+) Months/, '$1 个月')`

module.exports = {
  t: {
    ...pick(en.t, ADMIN_KEYS.t),
    vps_10: '✏️ 请输入新的<b>主题</b>行：',
    dustDepositNotice: { __src: `(receivedUsd, minUsd, tickerView) =>
 \`⚠️ <b>存款低于最低限额 — 未入账</b>\\n\\n我们收到了您 <b>≈ $\${Number(receivedUsd).toFixed(2)} USD</b> 等值的 \${tickerView}，但该币种的钱包充值最低限额是 <b>$\${Number(minUsd).toFixed(0)} USD</b>。\\n\\n清扫如此小额存款的网络费用超过存款本身，因此您的资金未入账。\\n\\n如需帮助，请点击 💬 支持，我们的团队将为您提供协助。\\n\\n— \${CHAT_BOT_NAME}\`` },
  },
  vs: { ...pick(en.vs, ADMIN_KEYS.vs) },
  admin: { ...pick(en.admin, ADMIN_KEYS.admin) },
  vp: {
    askPlanType: { __src: `plans => \`💳 选择账单周期：

\${plans
 .map(
 item =>
 \`<strong>• \${item.type === 'Hourly' ? '⏳' : '📅'} \${${cycle}} –</strong> $\${item.originalPrice} \${
 item.discount === 0 ? '（无折扣）' : \`（含 \${item.discount}% 折扣）\`
 }\`,
 )
 .join('\\n')}\`` },
  },
  hostingPlansText: {
    generatePlanText: { __src: `(hostingType, planKey) => {
 const plan = plans(hostingType)[planKey]
 return \`<b>\${plan.name} — $\${plan.price}</b>

\${plan.storage} · \${plan.bandwidth} · \${plan.domains}
\${plan.ssl} · \${plan.protection}
\${plan.panel}\`
 }` },
  },
  __topLevel: {
    plans: `hostingType => {
 return {
 premiumWeekly: {
 name: 'Premium Anti-Red (1-Week)',
 price: PREMIUM_ANTIRED_WEEKLY_PRICE,
 duration: '7 天',
 storage: '10 GB SSD',
 bandwidth: '100 GB',
 domains: '最多 2 个域名',
 ssl: '免费 SSL',
 protection: 'IP 伪装 · 机器人检测 · UA 拦截',
 panel: 'HostPanel — 文件、数据库和邮箱管理',
 },
 premiumCpanel: {
 name: 'Premium Anti-Red HostPanel (30 Days)',
 price: PREMIUM_ANTIRED_CPANEL_PRICE,
 duration: '30 天',
 storage: '50 GB SSD',
 bandwidth: '500 GB',
 domains: '最多 6 个域名',
 ssl: '免费 SSL',
 protection: 'IP 伪装 · JS 挑战 · UA 与 TLS 拦截',
 panel: 'HostPanel — 备份、迁移和高级工具',
 },
 goldenCpanel: {
 name: 'Golden Anti-Red HostPanel (30 Days)',
 price: GOLDEN_ANTIRED_CPANEL_PRICE,
 duration: '30 天',
 storage: '100 GB SSD',
 bandwidth: '不限流量',
 domains: '不限域名',
 ssl: '免费 SSL + 通配符',
 protection: '完整 Anti-Red：IP 伪装 · JS 挑战 · TLS/JA3 · WAF 规则 · 优先支持',
 panel: 'HostPanel — 预发布环境、安全与全部高级工具',
 },
 }
}`,
  },
}
