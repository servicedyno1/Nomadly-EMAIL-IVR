// Chinese (Simplified) promo copy — same structure as en.js.
module.exports = {
  cloudphone: {
    hooks: ['给您的业务一条真正的电话线', '30+ 国家的本地号码，60 秒开通'],
    cross: ['有线索了？现在就打给他们', '您的线索需要一个能接通的号码'],
    lines: p => [
      '30+ 国家虚拟号码 — 无需 SIM 卡，无合约',
      'IVR 菜单、语音信箱、短信转发到 Telegram、SIP 软电话',
      `Starter 每月含 ${p.phoneStarterMin} 分钟 + ${p.phoneStarterSms} 条短信`,
    ],
    price: p => `${p.phoneStarter}/月起 · 随时取消`,
    button: '打开云 IVR',
  },
  antired_hosting: {
    hooks: ['被举报也不下线的主机', 'Anti-Red 主机：离岸、DMCA-ignored、含 cPanel'],
    cross: ['有域名了？用防封主机托管', '您的网站值得一个离岸的家'],
    lines: _p => [
      'DMCA-ignored 离岸服务器',
      'Anti-Red 扫描器在机器人和举报者进入前拦截',
      '完整 cPanel、免费 SSL、按周或按月付费',
    ],
    price: p => `${p.hostingWeekly}/周 或 ${p.hostingMonthly}/月`,
    button: '打开 Anti-Red 主机',
  },
  leads_validation: {
    hooks: ['带真实机主姓名的电话线索', '别再拨打空号'],
    cross: ['有号码了？现在找人来打', '用已验证号码填满您的拨号器'],
    lines: _p => [
      '按国家、州、区号和运营商筛选',
      '实时在网验证 — 只交付活跃号码',
      'CNAM 查询显示每个号码背后的姓名',
    ],
    price: p => `线索每条 ${p.leadRate} · CNAM 每次 ${p.cnamRate}`,
    button: '打开短信线索',
  },
  domains_shortener: {
    hooks: ['Bulletproof 域名，几分钟注册完成', '一个没人能夺走的域名'],
    cross: ['主机准备好了？配一个防封域名', '短链接用自己的域名更体面'],
    lines: p => [
      '400+ 后缀 · DMCA-ignored 离岸注册',
      '内置 Cloudflare DNS 与 NS 管理',
      `赠送 ${p.freeLinks} 条品牌短链接`,
    ],
    price: p => `域名 ${p.domainFrom}/年起`,
    button: '打开防封域名',
  },
  digital_products: {
    hooks: ['已验证的 Twilio、Telnyx、AWS 账号，Telegram 内交付', '跳过漫长的验证流程'],
    cross: ['需要大规模短信或语音？拿一个已验证账号', '为您的号码配一个已验证 Twilio 账号'],
    lines: _p => [
      'Twilio、Telnyx、AWS、Google Cloud、Workspace、Zoho、eSIM',
      '完全验证、即开即用，直接发到您的聊天',
      '支持钱包、加密货币或银行转账',
    ],
    price: p => `eSIM ${p.dpEsim} 起 · Twilio 子账号 ${p.dpTwilioSub}`,
    button: '打开数字产品',
  },
  cards_bundles: {
    hooks: ['需要卡的支付，用虚拟卡', '一分钟充好卡，全网可用'],
    cross: ['用虚拟卡支付广告和工具', '注册需要卡？现在就充一张'],
    lines: _p => [
      '按您选择的金额充值的虚拟借记卡',
      '全球在线支付与验证可用',
      '即时发放，每张 $50 至 $1,000',
    ],
    price: _p => '钱包支付 · 加密货币或银行充值',
    button: '打开虚拟卡',
  },
  email_validation: {
    hooks: ['发送前先清洗邮件列表', '退信毁掉活动。先验证'],
    cross: ['要发邮件？先验证列表', '保护您的 SMTP 信誉'],
    lines: p => [
      '7 层检测：语法、MX、SMTP、catch-all、临时邮箱',
      'Gmail、Yahoo、Outlook 及私有域名',
      `免费试用 ${p.evFreeTrial} 封，单次最多 10 万`,
    ],
    price: p => `每封 ${p.evRateBulk} 至 ${p.evRate}`,
    button: '打开邮箱验证',
  },
  marketplace: {
    hooks: ['带担保交易的数字商品买卖', '把您的工具放到买家所在的地方'],
    cross: ['有东西要卖？在这里上架', '浏览其他成员的工具'],
    lines: _p => [
      '资金托管，确认交付后才放款',
      '在 Telegram 内与买卖双方聊天',
      '最多 10 个在售商品，向全部用户推送',
    ],
    price: _p => '免费浏览 · 钱包支付',
    button: '打开市场',
  },
  vps_rdp: {
    hooks: ['Linux VPS 或 Windows RDP，几分钟就绪', '您自己的服务器，25 端口开放'],
    cross: ['发信需要服务器？现在部署', '在属于您的服务器上运行工具'],
    lines: _p => [
      '完整 root 或管理员权限，随意安装',
      'DMCA-ignored，默认开放 25 端口',
      '预付 3、6 或 12 个月最高省 25%',
    ],
    price: p => `Linux VPS ${p.vpsFrom}/月起 · Windows RDP ${p.rdpFrom}/月起`,
    button: '打开 VPS / RDP',
  },
  bulksms_app: {
    hooks: ['用您自己的号码群发短信', '在 Android 上发 BulkSMS，在这里管理'],
    cross: ['有线索？用自己的号码给他们发短信', '把线索交给 BulkSMS 应用'],
    lines: p => [
      '您的 SIM、您的发送方 — 不走共享网关',
      '定时发送、控制间隔、实时追踪送达',
      `免费试用：${p.smsTrial} 条短信，无需订阅`,
    ],
    price: p => `日付 ${p.smsDaily} · 周付 ${p.smsWeekly} · 月付 ${p.smsMonthly}`,
    button: '打开 BulkSMS',
  },
  email_blast: {
    hooks: ['不离开 Telegram 发邮件营销', '上传列表，写一次，发给成千上万人'],
    cross: ['列表验证好了？发送活动', '也用邮件触达您的线索'],
    lines: _p => [
      '自定义主题、完整 HTML 正文、CSV 上传',
      '实时进度：已发送、失败、待发送',
      '内置 SMTP，无需配置',
    ],
    price: _p => '按活动从钱包付费',
    button: '打开邮件群发',
  },
  refer_earn: {
    hooks: ['每带来一位朋友都有收益', '您的链接，他们的购买，您的奖励'],
    cross: ['认识需要这些服务的人？推荐给他们', '分享一次，他们购买您就有钱拿'],
    lines: p => [
      '把您的专属链接分享到任何地方',
      `被推荐人消费 ${p.referSpend} 后，${p.referReward} 进您的钱包`,
      '适用于机器人内的所有服务',
    ],
    price: _p => '免费加入 · 奖励发到钱包',
    button: '打开推荐赚钱',
  },
}
