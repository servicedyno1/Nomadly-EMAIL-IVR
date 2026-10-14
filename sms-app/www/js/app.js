/**
 * SMS App — Main Application Logic (brand-aware via brand.js)
 * Capacitor hybrid app: runs in WebView inside APK, native SMS via DirectSms plugin
 */

const App = {
  currentCampaign: null,
  campaigns: [],
  wizardStep: 1,
  sendingState: null,
  // SIM state — populated by refreshSims() after READ_PHONE_STATE is granted.
  availableSims: [],           // array of { subscriptionId, slotIndex, carrierName, displayName, phoneNumber, mcc, mnc }
  defaultSmsSubscriptionId: -1, // Android's current default SMS SIM (for display)
  simsChecked: false,
  simLabels: {},                // user-custom SIM labels keyed by String(subscriptionId); synced from server

  // ─── Brand (from brand.js, generated per build) ───
  brand() {
    const b = window.BRAND || {}
    const botUsername = (b.botUsername || 'NomadlyBot').replace(/^@/, '')
    return {
      slug: b.slug || 'nomadly',
      name: b.name || 'Nomadly',
      appName: b.appName || `${b.name || 'Nomadly'} SMS`,
      botUsername,
      botHandle: `@${botUsername}`,
      botUrl: b.botUrl || `https://t.me/${botUsername}`,
      accent: b.accent || '#10d9a0',
      initial: (b.name || 'N').charAt(0).toUpperCase(),
    }
  },
  applyBrand() {
    const b = this.brand()
    document.querySelectorAll('[data-brand]').forEach(el => { const v = b[el.getAttribute('data-brand')]; if (v !== undefined) el.textContent = v })
    document.querySelectorAll('[data-brand-href]').forEach(el => { const v = b[el.getAttribute('data-brand-href')]; if (v) el.setAttribute('href', v) })
    document.documentElement.style.setProperty('--brand-accent', b.accent)
    // Brand mark image (img/mark.png, generated per build) — falls back to the initial letter
    const logo = document.querySelector('.login-logo')
    if (logo && !logo.querySelector('img')) {
      const img = new Image()
      img.alt = b.appName
      img.onload = () => { logo.textContent = ''; logo.appendChild(img) }
      img.src = 'img/mark.png'
    }
  },

  // ─── Init ───
  async init() {
    this.applyBrand()
    console.log('='.repeat(50))
    console.log(`${this.brand().appName} App v${this.getAppVersion()} - Initializing`)
    console.log('Platform:', window.Capacitor ? 'Native (APK)' : 'Browser')
    console.log('='.repeat(50))
    
    if (Storage.isLoggedIn()) {
      this.showDashboard()
      this.syncData()
      // Check SMS permission status on startup
      this.checkAndDisplayPermissionStatus()
      // Best-effort enumerate SIMs (silent — no permission prompt here)
      this.refreshSims(false).catch(() => {})
    } else {
      this.showScreen('loginScreen')
    }
    document.getElementById('loginCode').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.login()
    })
    // Character counter for wizard
    const wzContent = document.getElementById('wzContent')
    if (wzContent) {
      wzContent.addEventListener('input', () => this.updateCharCount())
    }
    // Contact counter
    const wzContacts = document.getElementById('wzContacts')
    if (wzContacts) {
      wzContacts.addEventListener('input', () => this.updateContactCount())
    }
  },

  async checkAndDisplayPermissionStatus() {
    if (!window.Capacitor?.Plugins?.DirectSms) {
      console.log('[SMS] Not running in Capacitor (browser mode)')
      return
    }
    
    console.log('[SMS] Checking permission status on startup...')
    try {
      let perm = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          perm = await window.Capacitor.Plugins.DirectSms.checkPermission()
          break
        } catch (retryErr) {
          console.warn(`[SMS] Startup permission check attempt ${attempt} failed:`, retryErr)
          if (attempt < 3) await new Promise(r => setTimeout(r, 500 * attempt))
        }
      }
      
      if (!perm) {
        console.warn('[SMS] ⚠️ Could not check permission status (bridge issue)')
        const statusEl = document.getElementById('permissionStatus')
        if (statusEl) {
          statusEl.innerHTML = '⚠️ Could not verify SMS permission - <a href="#" onclick="App.requestPermissionNow(); return false;">Grant Now</a>'
          statusEl.style.display = 'block'
          statusEl.className = 'permission-warning'
        }
        return
      }
      
      console.log('[SMS] Permission check result:', perm)
      const statusEl = document.getElementById('permissionStatus')
      
      if (!perm.granted) {
        console.warn('[SMS] ⚠️ Permission NOT granted on startup')
        if (statusEl) {
          statusEl.innerHTML = '⚠️ SMS Permission Required - <a href="#" onclick="App.requestPermissionNow(); return false;">Grant Now</a>'
          statusEl.style.display = 'block'
          statusEl.className = 'permission-warning'
        }
      } else {
        console.log('[SMS] ✅ Permission granted on startup')
        if (statusEl) {
          statusEl.style.display = 'none'
        }
      }
    } catch (e) {
      console.error('[SMS] ❌ Failed to check permission:', e)
    }
  },

  async requestPermissionNow() {
    if (!window.Capacitor?.Plugins?.DirectSms) return
    
    console.log('[SMS] User clicked "Grant Now" - requesting permission...')
    try {
      const req = await window.Capacitor.Plugins.DirectSms.requestPermission()
      console.log('[SMS] Permission request result:', req)
      if (req.granted) {
        console.log('[SMS] ✅ Permission granted by user!')
        this.toast('SMS permission granted!', 'success')
        const statusEl = document.getElementById('permissionStatus')
        if (statusEl) statusEl.style.display = 'none'
      } else {
        console.warn('[SMS] ⚠️ Permission denied by user')
        this.toast(`Permission denied. Enable in Settings > Apps > ${this.brand().appName} > Permissions`, 'error')
      }
    } catch (e) {
      console.error('[SMS] ❌ Failed to request permission:', e)
      this.toast('Failed to request permission', 'error')
    }
  },

  // ─── SIM enumeration & selection ───
  // `promptForPermission=true` will trigger the Android READ_PHONE_STATE
  // runtime prompt if it isn't already granted. When false (passive calls
  // from init() or settings render), we silently skip if permission is
  // missing and return an empty list.
  async refreshSims(promptForPermission = false) {
    if (!window.Capacitor?.Plugins?.DirectSms) {
      this.availableSims = []
      this.simsChecked = true
      return []
    }
    try {
      let result = await window.Capacitor.Plugins.DirectSms.listSims()
      if (!result?.granted && promptForPermission) {
        const req = await window.Capacitor.Plugins.DirectSms.requestPhonePermission()
        if (req?.granted) {
          result = await window.Capacitor.Plugins.DirectSms.listSims()
        } else if (req?.permanentlyDenied) {
          this.toast('Phone permission permanently denied. Enable it in Android Settings to see your SIMs.', 'error')
        }
      }
      this.availableSims = Array.isArray(result?.sims) ? result.sims : []
      this.defaultSmsSubscriptionId =
        typeof result?.defaultSmsSubscriptionId === 'number' ? result.defaultSmsSubscriptionId : -1
      this.simsChecked = true
      console.log('[SIM] available:', this.availableSims, 'defaultSub:', this.defaultSmsSubscriptionId)
      this._populateSimSelectors()
      // Push detected SIMs to the server so the Telegram bot can show pickers.
      // Best-effort — if offline, the next sync will retry.
      const chatId = Storage.getUser()?.chatId
      if (chatId && this.availableSims.length > 0) {
        API.reportSims(chatId, this.availableSims).catch(e => console.warn('[SIM] reportSims failed:', e.message))
      }
      return this.availableSims
    } catch (e) {
      console.warn('[SIM] refreshSims failed:', e)
      this.availableSims = []
      this.simsChecked = true
      return []
    }
  },

  _simLabel(sim) {
    if (!sim) return 'Default SIM'
    const slot = (sim.slotIndex ?? 0) + 1
    const custom = this.simLabels?.[String(sim.subscriptionId)]
    if (custom && typeof custom === 'string' && custom.trim()) return `SIM ${slot} — ${custom.trim()}`
    const name = (sim.carrierName || sim.displayName || '').trim() || 'Unknown carrier'
    return `SIM ${slot} — ${name}`
  },

  _populateSimSelectors() {
    // Settings → Default SIM picker
    const setSel = document.getElementById('setDefaultSim')
    if (setSel) {
      const saved = Storage.get('defaultSubscriptionId')
      const currentVal = saved != null ? String(saved) : '-1'
      setSel.innerHTML = ''
      const defOpt = document.createElement('option')
      defOpt.value = '-1'
      defOpt.textContent = 'System default'
      setSel.appendChild(defOpt)
      this.availableSims.forEach(sim => {
        const o = document.createElement('option')
        o.value = String(sim.subscriptionId)
        o.textContent = this._simLabel(sim)
        setSel.appendChild(o)
      })
      setSel.value = currentVal
      const info = document.getElementById('simListInfo')
      if (info) {
        if (!this.availableSims.length) {
          info.textContent = 'Tap "Refresh SIM list" to allow reading your SIMs (requires Phone permission).'
        } else {
          info.textContent = `${this.availableSims.length} SIM${this.availableSims.length > 1 ? 's' : ''} detected.`
        }
      }
    }

    // Wizard SIM selector (per-campaign override)
    const wzSel = document.getElementById('wzSimSelect')
    if (wzSel) {
      const savedWiz = wzSel.dataset.selected || 'default'
      wzSel.innerHTML = ''
      const def = document.createElement('option')
      def.value = 'default'
      def.textContent = 'Use default SIM'
      wzSel.appendChild(def)
      if (this.availableSims.length > 1) {
        const rot = document.createElement('option')
        rot.value = 'rotate'
        rot.textContent = 'Auto-rotate across all SIMs'
        wzSel.appendChild(rot)
      }
      this.availableSims.forEach(sim => {
        const o = document.createElement('option')
        o.value = String(sim.subscriptionId)
        o.textContent = this._simLabel(sim)
        wzSel.appendChild(o)
      })
      wzSel.value = savedWiz
    }
  },

  saveDefaultSim() {
    const sel = document.getElementById('setDefaultSim')
    if (!sel) return
    const val = parseInt(sel.value, 10)
    if (Number.isNaN(val)) return
    Storage.set('defaultSubscriptionId', val)
    const chatId = Storage.getUser()?.chatId
    if (chatId) API.updateUserPrefs(chatId, { defaultSubscriptionId: val }).catch(() => {})
    this.toast('Default SIM saved', 'success')
  },

  saveBgServiceToggle() {
    const el = document.getElementById('setBgService')
    if (!el) return
    Storage.set('bgServiceEnabled', !!el.checked)
    const chatId = Storage.getUser()?.chatId
    if (chatId) API.updateUserPrefs(chatId, { bgServiceEnabled: !!el.checked }).catch(() => {})
    this.toast(el.checked ? 'Background sending enabled (beta)' : 'Background sending disabled', 'info')
  },

  // Resolve the SIM selection for a given campaign.
  // Returns: { subscriptionId: number|-1, subscriptionIds: number[], label: string }
  _resolveCampaignSim(campaign) {
    // Priority: campaign.simSelection (set at send-time) > wizard value > user default
    const wzSel = document.getElementById('wzSimSelect')
    const saved = Storage.get('defaultSubscriptionId')
    const autoRotateDefault = !!Storage.get('autoRotateDefault')
    let val = campaign?.simSelection ?? (wzSel ? wzSel.value : undefined)
    if (val === undefined || val === null || val === '') {
      val = autoRotateDefault && this.availableSims.length > 1 ? 'rotate' : 'default'
    }

    if (val === 'rotate' && this.availableSims.length > 1) {
      return {
        subscriptionId: -1,
        subscriptionIds: this.availableSims.map(s => s.subscriptionId),
        label: `Auto-rotate across ${this.availableSims.length} SIMs`,
      }
    }
    if (val === 'default' || val === undefined) {
      const sub = typeof saved === 'number' ? saved : -1
      return { subscriptionId: sub, subscriptionIds: [], label: sub >= 0 ? `SIM sub=${sub}` : 'System default SIM' }
    }
    const parsed = parseInt(val, 10)
    return { subscriptionId: Number.isNaN(parsed) ? -1 : parsed, subscriptionIds: [], label: `SIM sub=${parsed}` }
  },

  // ─── Screens ───
  showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'))
    document.getElementById(id).classList.add('active')
  },

  toast(msg, type = 'info') {
    const el = document.getElementById('toast')
    el.textContent = msg
    el.className = `toast ${type} show`
    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(() => el.classList.remove('show'), 3000)
  },

  // ─── Modal ───
  showModal(title, body, buttons) {
    const overlay = document.getElementById('modalOverlay')
    const content = document.getElementById('modalContent')
    const btnsHtml = buttons.map(b =>
      `<button class="btn ${b.class || 'btn-secondary'}" onclick="${b.action}">${b.label}</button>`
    ).join('')
    content.innerHTML = `<h2>${title}</h2><p>${body}</p><div class="modal-btns">${btnsHtml}</div>`
    overlay.classList.add('active')
  },
  closeModal(e) {
    if (e && e.target.id !== 'modalOverlay') return
    document.getElementById('modalOverlay').classList.remove('active')
  },
  hideModal() {
    document.getElementById('modalOverlay').classList.remove('active')
  },

  // ─── Login ───
  async login() {
    const code = document.getElementById('loginCode').value.trim()
    if (!code) return this.showLoginError(`Enter the activation code from ${this.brand().botHandle}`)
    console.log('[Login] Starting login for code:', code)
    console.log('[Login] Is Capacitor?', window.Capacitor ? 'YES' : 'NO')
    console.log('[Login] Is Native?', window.Capacitor?.isNativePlatform ? window.Capacitor.isNativePlatform() : 'N/A')
    this.setLoginLoading(true)
    try {
      console.log('[Login] Calling API.authenticate...')
      const result = await API.authenticate(code)
      console.log('[Login] Got result:', result)
      if (result.valid) {
        Storage.setCode(code)
        Storage.setUser(result.user)
        this.toast('Connected!', 'success')
        this.showDashboard()
        this.syncData()
      } else {
        console.error('[Login] Invalid result:', result)
        this.showLoginError(result.error || 'Invalid code')
      }
    } catch (e) {
      console.error('[Login] Exception:', e)
      // APIError (from api.js) carries `type` — use it to pick a precise message.
      // This replaces the old "any failure ⇒ Network error" collapse that made
      // outages (like a stale Railway hostname) look like a connectivity issue.
      const type = e && e.type
      const status = e && e.status
      if (type === 'network') {
        this.showLoginError(`Can't reach the server. Check your internet connection, then try again. If the problem persists, the server may be down — contact ${this.brand().botHandle} support.`)
      } else if (type === 'timeout') {
        this.showLoginError('The server is responding slowly. Try again in a moment.')
      } else if (status === 401) {
        this.showLoginError(e.message || `Invalid activation code. Get a fresh code from ${this.brand().botHandle}.`)
      } else if (status === 403) {
        this.showLoginError(e.message || `Device limit reached. Logout from another device or type /resetlogin in ${this.brand().botHandle}.`)
      } else if (status >= 500) {
        this.showLoginError('Server error. Please try again in a few minutes.')
      } else {
        this.showLoginError(e.message || 'Login failed. Please try again.')
      }
    } finally {
      this.setLoginLoading(false)
    }
  },

  showLoginError(msg) {
    const el = document.getElementById('loginError')
    el.textContent = msg; el.style.display = 'block'
    setTimeout(() => el.style.display = 'none', 5000)
  },

  setLoginLoading(on) {
    document.getElementById('loginBtn').disabled = on
    document.getElementById('loginBtnText').style.display = on ? 'none' : 'inline'
    document.getElementById('loginSpinner').style.display = on ? 'block' : 'none'
  },

  // ─── Logout ───
  showLogoutConfirm() {
    this.showModal('Log Out', 'Are you sure you want to log out of this account?', [
      { label: 'Cancel', action: 'App.hideModal()' },
      { label: 'Log Out', class: 'btn-outline-danger', action: 'App.logout()' },
    ])
  },
  async logout() {
    this.hideModal()
    try { await API.logout(Storage.getCode()) } catch {}
    Storage.clear(); this.campaigns = []
    this.showScreen('loginScreen')
    document.getElementById('loginCode').value = ''
    this.toast('Logged out', 'info')
  },

  // ─── Settings ───
  showSettings() {
    const user = Storage.getUser() || {}
    document.getElementById('setName').textContent = user.name || '-'
    document.getElementById('setCode').textContent = Storage.getCode() || '-'
    if (user.isSubscribed) {
      document.getElementById('setPlan').textContent = `Active (${user.plan || 'Premium'})`
    } else if (user.isFreeTrial) {
      document.getElementById('setPlan').textContent = `Free Trial (${user.freeSmsRemaining} SMS left)`
    } else {
      document.getElementById('setPlan').textContent = 'Expired'
    }
    // Populate version dynamically from meta tag (avoids hardcoded-mismatch bugs)
    const verEl = document.getElementById('setVersion')
    if (verEl) verEl.textContent = this.getAppVersion()
    // Populate saved test phone label (if any)
    const testPhone = Storage.get('testPhoneNumber')
    const tpLabel = document.getElementById('testPhoneLabel')
    if (tpLabel) tpLabel.textContent = testPhone || 'Not set'
    const testStatus = document.getElementById('testSmsStatus')
    if (testStatus) testStatus.textContent = ''
    // Background-service toggle
    const bgToggle = document.getElementById('setBgService')
    if (bgToggle) bgToggle.checked = !!Storage.get('bgServiceEnabled')
    // SIM list — populate from cache, then try to refresh silently
    this._populateSimSelectors()
    if (!this.simsChecked) this.refreshSims(false).catch(() => {})
    this.showScreen('settingsScreen')
  },

  // ─── Test SMS (one-tap delivery check) ───
  promptTestPhone(fromChange = false) {
    const current = Storage.get('testPhoneNumber') || ''
    this.showModal(
      'Your phone number',
      `<p style="margin:0 0 10px 0;font-size:14px;color:var(--text-secondary)">Enter the number you want the test SMS to go to (include country code, e.g. +14155550123).</p>
       <input id="testPhoneInput" type="tel" placeholder="+14155550123" value="${current.replace(/"/g, '&quot;')}" style="width:100%;padding:12px;border:1px solid var(--border);border-radius:8px;font-size:16px;box-sizing:border-box" />`,
      [
        { label: 'Cancel', action: 'App.hideModal()' },
        { label: fromChange ? 'Save' : 'Save & Send', class: 'btn-primary', action: `App.saveTestPhone(${fromChange ? 'false' : 'true'})` },
      ]
    )
    // focus after render
    setTimeout(() => { try { document.getElementById('testPhoneInput').focus() } catch {} }, 50)
  },

  saveTestPhone(sendAfter) {
    const input = document.getElementById('testPhoneInput')
    if (!input) return
    let val = (input.value || '').trim().replace(/\s+/g, '')
    // Basic validation: must start with + and have 7-15 digits
    if (!/^\+\d{7,15}$/.test(val)) {
      return this.toast('Invalid number. Include + and country code (e.g. +14155550123).', 'error')
    }
    Storage.set('testPhoneNumber', val)
    const tpLabel = document.getElementById('testPhoneLabel')
    if (tpLabel) tpLabel.textContent = val
    this.hideModal()
    if (sendAfter) this.sendTestSms()
  },

  async sendTestSms() {
    const phone = Storage.get('testPhoneNumber')
    if (!phone) return this.promptTestPhone(false)

    const btn = document.getElementById('sendTestSmsBtn')
    const status = document.getElementById('testSmsStatus')
    const setStatus = (txt, color) => {
      if (status) {
        status.textContent = txt
        status.style.color = color || 'var(--text-secondary)'
      }
    }

    // Short fixed test message (single-segment to avoid multipart complications)
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    const ss = String(now.getSeconds()).padStart(2, '0')
    const msg = `${this.brand().appName} test - your device can send SMS. Sent at ${hh}:${mm}:${ss}`

    if (btn) { btn.disabled = true; btn.textContent = 'Sending...' }
    setStatus(`Sending test to ${phone}...`)

    try {
      // Permission pre-check (same flow as campaign sends)
      if (window.Capacitor?.Plugins?.DirectSms) {
        try {
          const perm = await window.Capacitor.Plugins.DirectSms.checkPermission()
          if (!perm?.granted) {
            const req = await window.Capacitor.Plugins.DirectSms.requestPermission()
            if (!req?.granted) {
              setStatus('Permission denied. Enable SMS in Android Settings.', 'var(--danger)')
              return
            }
          }
        } catch (e) {
          console.warn('[TestSMS] Permission check failed, proceeding:', e)
        }
      }

      // Use the user's default SIM (from Settings) if set
      const savedSub = Storage.get('defaultSubscriptionId')
      const subId = typeof savedSub === 'number' ? savedSub : -1
      const selectedSim = this.availableSims.find(s => s.subscriptionId === subId)
      const simLabel = selectedSim ? this._simLabel(selectedSim) : 'System default SIM'

      const result = await this.nativeSms(phone, msg, subId)
      if (result.success) {
        const via = result.imsQuirkFallback
          ? `${simLabel} (verified via Wi-Fi Calling / IMS fallback)`
          : simLabel
        setStatus(`Sent via ${via}. Check your phone for the test SMS.`, 'var(--success, #2e7d32)')
        this.toast(result.imsQuirkFallback
          ? 'Test SMS sent — your carrier uses Wi-Fi Calling; delivery verified via system log.'
          : 'Test SMS sent - check your phone', 'success')
      } else {
        const reason = result.errorReason || 'unknown'
        const hint = this._testSmsErrorHint(reason, result.error)
        setStatus(`Failed via ${simLabel}: ${hint}`, 'var(--danger)')
        this.toast('Test SMS failed - see Settings for details', 'error')
      }

      // Best-effort server-side log (privacy: only carrier prefix + hash)
      this._reportTestSmsResult(phone, result, selectedSim).catch(() => {})
    } catch (e) {
      setStatus(`Error: ${e.message || e}`, 'var(--danger)')
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Send Test SMS' }
    }
  },

  // Privacy-safe hash of the phone number (first 4 digits kept for carrier
  // inference, rest hashed). Uses Web Crypto API (SubtleCrypto) when
  // available; falls back to a simple hash otherwise.
  async _hashPhone(phone) {
    try {
      const enc = new TextEncoder().encode(phone)
      const buf = await crypto.subtle.digest('SHA-256', enc)
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
    } catch {
      let h = 0
      for (let i = 0; i < phone.length; i++) h = ((h << 5) - h + phone.charCodeAt(i)) | 0
      return 'fb' + Math.abs(h).toString(36)
    }
  },

  async _reportTestSmsResult(phone, result, sim) {
    try {
      const chatId = Storage.getUser()?.chatId
      if (!chatId) return
      const phoneHash = await this._hashPhone(phone)
      const carrierPrefix = (phone.match(/^\+(\d{1,4})/) || [null, ''])[1]
      await API.reportTestSms(chatId, {
        phoneHash,
        carrierPrefix,
        success: !!result?.success,
        errorReason: result?.errorReason || null,
        errorCode: result?.errorCode ?? null,
        appVersion: this.getAppVersion(),
        simCarrier: sim?.carrierName || null,
        simSlot: sim?.slotIndex ?? null,
      })
    } catch (e) {
      console.warn('[TestSMS] Server log failed:', e.message)
    }
  },

  _testSmsErrorHint(reason, error) {
    const map = {
      no_service: 'No cellular service - check signal and SIM.',
      radio_off: 'Airplane mode is ON - turn it off.',
      generic_failure: 'Carrier blocked the SMS (credit/rate-limit/spam filter).',
      null_pdu: 'Message encoding error.',
      send_timeout: 'Timed out - carrier may be blocking sends.',
      permission_denied: 'SMS permission denied.',
      permission_permanently_denied: 'Permission permanently denied - open app Settings to enable.',
      permission_needed: 'SMS permission not granted.',
      invalid_input: 'Invalid phone number format.',
      plugin_bridge_exception: error || 'Plugin bridge error - restart the app.',
      send_exception: error || 'Send exception thrown by Android.',
    }
    return map[reason] || `${reason}${error ? ' (' + error + ')' : ''}`
  },

  // ─── Dashboard ───
  showDashboard() {
    this.showScreen('dashboardScreen')
    this.renderDashboard()
  },

  renderDashboard() {
    const user = Storage.getUser() || {}
    const campaigns = this.campaigns.length ? this.campaigns : Storage.getCampaigns()

    // Plan cards
    document.getElementById('planCardActive').style.display = 'none'
    document.getElementById('planCardTrial').style.display = 'none'
    document.getElementById('planCardExpired').style.display = 'none'

    if (user.isSubscribed) {
      document.getElementById('planCardActive').style.display = 'flex'
      const exp = new Date(user.planExpiry)
      document.getElementById('planActiveDetail').textContent =
        `${user.plan || 'Premium'} — expires ${exp.toLocaleDateString()}`
    } else if (user.isFreeTrial) {
      document.getElementById('planCardTrial').style.display = 'flex'
      document.getElementById('planTrialDetail').textContent =
        `${user.freeSmsRemaining} of ${user.freeSmsLimit} free SMS remaining`
      const pct = Math.max(0, Math.min(100, ((user.freeSmsLimit - user.freeSmsRemaining) / user.freeSmsLimit) * 100))
      document.getElementById('planTrialFill').style.width = pct + '%'
    } else {
      document.getElementById('planCardExpired').style.display = 'flex'
    }

    // New campaign button - disable if no plan
    const newBtn = document.getElementById('newCampaignBtn')
    if (newBtn) newBtn.disabled = !user.canUseSms

    // Quick stats
    let totalSent = 0, totalContacts = 0
    campaigns.forEach(c => {
      totalSent += c.sentCount || 0
      totalContacts += (c.contacts || []).length
    })
    document.getElementById('qsSent').textContent = `${totalSent} sent`
    document.getElementById('qsCampaigns').textContent = `${campaigns.length} campaigns`
    document.getElementById('qsContacts').textContent = `${totalContacts} contacts`

    // Campaign list
    const listEl = document.getElementById('campaignList')
    if (campaigns.length === 0) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-icon"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg></div>
        <h3>No campaigns yet</h3>
        <p>${user.canUseSms ? 'Create your first campaign to start sending' : 'Subscribe to start creating campaigns'}</p>
        ${user.canUseSms ? '<button class="btn btn-primary btn-sm" style="margin-top:12px" onclick="App.startNewCampaign()">Create Campaign</button>' : `<a href="${this.brand().botUrl}" class="btn btn-subscribe" style="margin-top:12px" target="_blank">Subscribe on Telegram</a>`}
      </div>`
      return
    }

    listEl.innerHTML = campaigns.map(c => {
      const pct = c.totalCount > 0 ? Math.round((c.sentCount / c.totalCount) * 100) : 0
      const badge = `badge-${c.status}`
      return `<div class="campaign-card" onclick="App.openCampaign('${c._id}')">
        <div class="c-card-top">
          <span class="c-card-name">${esc(c.name)}</span>
          <span class="c-card-badge ${badge}">${c.status}</span>
        </div>
        <div class="c-card-meta">
          <span>${(c.content || []).length} msg</span>
          <span>${(c.contacts || []).length} contacts</span>
          <span>${c.sentCount || 0} sent</span>
        </div>
        ${c.totalCount > 0 && c.sentCount > 0 ? `<div class="c-card-progress"><div class="c-card-bar" style="width:${pct}%"></div></div>` : ''}
      </div>`
    }).join('')
  },

  // ─── Sync ───
  async syncData() {
    const code = Storage.getCode()
    if (!code) return
    try {
      const data = await API.sync(code, this.getAppVersion())
      if (data.user) Storage.setUser(data.user)
      // Apply server-managed prefs (bot may have changed them) — local defaults
      // on the device are overridden only when the server has something to say.
      if (data.userPrefs) {
        const p = data.userPrefs
        if (typeof p.defaultSubscriptionId === 'number') {
          Storage.set('defaultSubscriptionId', p.defaultSubscriptionId)
        }
        if (typeof p.bgServiceEnabled === 'boolean') {
          Storage.set('bgServiceEnabled', p.bgServiceEnabled)
        }
        if (typeof p.autoRotate === 'boolean') {
          Storage.set('autoRotateDefault', p.autoRotate)
        }
        if (p.simLabels && typeof p.simLabels === 'object') {
          this.simLabels = p.simLabels
          Storage.set('simLabels', p.simLabels)
          // Re-render dropdowns with the fresh labels
          this._populateSimSelectors()
        }
      } else {
        // No server prefs yet — fall back to any cached labels
        const cached = Storage.get('simLabels')
        if (cached && typeof cached === 'object') this.simLabels = cached
      }
      if (data.campaigns) { 
        this.campaigns = data.campaigns
        Storage.setCampaigns(data.campaigns)
        
        // Auto-start queued campaigns (created from bot with "Send Now")
        const queuedCampaign = data.campaigns.find(c => c.status === 'queued' && !this.isSending)
        if (queuedCampaign && data.user?.canUseSms) {
          console.log('[App] Auto-starting queued campaign:', queuedCampaign.name)
          // Small delay to ensure UI is ready
          setTimeout(() => {
            this.startSending(queuedCampaign)
          }, 1000)
        }
      }
      // Check for app update
      if (data.latestVersion) {
        this.checkAppUpdate(data.latestVersion)
      }
      this.renderDashboard()
    } catch {
      this.campaigns = Storage.getCampaigns()
      this.renderDashboard()
    }
  },

  // ─── In-App Update Notification ───
  checkAppUpdate(latestVersion) {
    const currentVersion = this.getAppVersion()
    if (!currentVersion || currentVersion === 'unknown') return
    if (currentVersion === latestVersion) {
      // Hide banner if already up to date
      const banner = document.getElementById('updateBanner')
      if (banner) banner.style.display = 'none'
      return
    }
    // Compare versions (simple semver compare)
    const cur = currentVersion.split('.').map(Number)
    const lat = latestVersion.split('.').map(Number)
    let needsUpdate = false
    for (let i = 0; i < 3; i++) {
      if ((lat[i] || 0) > (cur[i] || 0)) { needsUpdate = true; break }
      if ((lat[i] || 0) < (cur[i] || 0)) break
    }
    if (!needsUpdate) return

    // Show persistent update banner
    let banner = document.getElementById('updateBanner')
    if (!banner) {
      banner = document.createElement('div')
      banner.id = 'updateBanner'
      banner.className = 'update-banner'
      document.body.prepend(banner)
    }
    banner.innerHTML = `
      <div class="update-banner-content">
        <div class="update-banner-text">
          <strong>Update Available</strong>
          <span>v${latestVersion} is ready — you're on v${currentVersion}</span>
        </div>
        <a href="${this.brand().botUrl}" target="_blank" class="btn btn-sm btn-update">Update</a>
        <button class="update-dismiss" onclick="document.getElementById('updateBanner').style.display='none'">&times;</button>
      </div>`
    banner.style.display = 'block'
  },

  getAppVersion() {
    // Read from the APK build config (set during build) or fallback
    try {
      const meta = document.querySelector('meta[name="app-version"]')
      if (meta) return meta.content
    } catch {}
    return (window.BRAND && window.BRAND.version) || 'unknown' // brand.js is generated per build
  },

  // ─── New Campaign (subscription gate — FRESH check from server) ───
  async startNewCampaign() {
    // Always do a fresh subscription check from server, not stale cache
    const code = Storage.getCode()
    if (code) {
      try {
        const planData = await API.getPlan(code)
        Storage.setUser(planData)
        if (!planData.canUseSms) {
          return this.showSubscriptionModal()
        }
      } catch {
        // If offline, fall back to cached data
        const user = Storage.getUser() || {}
        if (!user.canUseSms) return this.showSubscriptionModal()
      }
    } else {
      const user = Storage.getUser() || {}
      if (!user.canUseSms) return this.showSubscriptionModal()
    }
    this.currentCampaign = null
    this.wizardStep = 1
    document.getElementById('wzName').value = ''
    document.getElementById('wzContent').value = ''
    document.getElementById('wzContacts').value = ''
    document.getElementById('wzGapTime').value = '5'
    document.getElementById('wzSchedule').value = ''
    const wzSim = document.getElementById('wzSimSelect')
    if (wzSim) { wzSim.dataset.selected = 'default'; wzSim.value = 'default' }
    document.getElementById('wizardTitle').textContent = 'New Campaign'
    this._populateSimSelectors()
    this.updateCharCount()
    this.updateContactCount()
    this.showWizardStep(1)
    this.showScreen('wizardScreen')
  },

  // ─── Wizard Navigation ───
  showWizardStep(step) {
    this.wizardStep = step
    for (let i = 1; i <= 4; i++) {
      const pg = document.getElementById(`wzStep${i}`)
      if (pg) pg.style.display = i === step ? 'flex' : 'none'
      const dot = document.querySelector(`.wz-step[data-step="${i}"]`)
      if (dot) {
        dot.classList.remove('active', 'done')
        if (i === step) dot.classList.add('active')
        else if (i < step) dot.classList.add('done')
      }
    }
    if (step === 4) this.populateReview()
  },

  wizardNext() {
    if (this.wizardStep === 1) {
      const name = document.getElementById('wzName').value.trim()
      if (!name) return this.toast('Give your campaign a name', 'error')
      this.showWizardStep(2)
    } else if (this.wizardStep === 2) {
      const content = document.getElementById('wzContent').value.trim()
      if (!content) return this.toast('Write a message to send', 'error')
      this.showWizardStep(3)
    } else if (this.wizardStep === 3) {
      const contacts = this.parseContacts()
      if (contacts.length === 0) return this.toast('Add at least one contact', 'error')
      this.showWizardStep(4)
    }
  },

  wizardBack() {
    if (this.wizardStep > 1) {
      this.showWizardStep(this.wizardStep - 1)
    } else {
      if (this.currentCampaign) {
        this.openCampaign(this.currentCampaign._id)
      } else {
        this.showDashboard()
      }
    }
  },

  // ─── Character Counter ───
  updateCharCount() {
    const raw = (document.getElementById('wzContent').value || '')
    // Calculate effective message length: collapse newlines to spaces (as sent),
    // and if --- delimiter is used, show stats for the longest rotation message
    const hasDelimiter = /\n\s*---\s*\n|\n\s*---\s*$|^\s*---\s*\n/.test(raw)
    let effectiveMsg
    if (hasDelimiter) {
      const msgs = raw.split(/\n\s*---\s*\n|\n\s*---\s*$|^\s*---\s*\n/).map(m => m.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
      effectiveMsg = msgs.reduce((a, b) => a.length > b.length ? a : b, '')
    } else {
      effectiveMsg = raw.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
    }
    const len = effectiveMsg.length
    document.getElementById('charCount').textContent = len
    const segments = len <= 160 ? 1 : Math.ceil(len / 153)
    document.getElementById('charSegments').textContent = segments === 1 ? '1 SMS' : `${segments} SMS parts`
    const countEl = document.getElementById('charCount')
    countEl.style.color = len > 160 ? 'var(--warning)' : 'var(--text-muted)'
  },

  // ─── Contact Counter ───
  updateContactCount() {
    const contacts = this.parseContacts()
    document.getElementById('contactCounter').textContent = `${contacts.length} contacts`
  },

  // ─── Name-placeholder substitution ───
  // Recognised tokens (case-insensitive): [name], {name}, <name>, %name%, $name, $$name.
  // The single-syntax `[name]` is the canonical/documented form; the rest are
  // accepted because users commonly try them by intuition.
  // Returns substituted string. If `nameValue` is empty/falsy, replaces with ''.
  _substituteName(template, nameValue) {
    // Local regex with `g` flag — needed for replace-all. Recreated per call so
    // there's no shared `lastIndex` state.
    return String(template || '').replace(/(\[name\]|\{name\}|<name>|%name%|\$\$?name\b)/gi, String(nameValue || ''))
  },
  _templateHasPlaceholder(template) {
    // Any of the supported syntaxes.
    return /(\[name\]|\{name\}|<name>|%name%|\$\$?name\b)/i.test(String(template || ''))
  },
  _templateHasVariantOnly(template) {
    // True when only NON-canonical variants are present (no [name]). Used to
    // suggest "Did you mean [name]?" in the review screen.
    const s = String(template || '')
    return !/\[name\]/i.test(s) && /(\{name\}|<name>|%name%|\$\$?name\b)/i.test(s)
  },

  // ─── Parse Contacts ───
  // Accepted formats per line (whitespace-tolerant):
  //   "+1234567890,John Doe"        (canonical: comma-separated)
  //   "+1234567890\tJohn Doe"       (tab-separated)
  //   "+1234567890 John Doe"        (space-separated — fallback)
  //   "+1234567890"                 (no name)
  //   "1234567890"                  (no leading +)
  // Returns: [{ phoneNumber, name, raw, warning? }]
  parseContacts() {
    const raw = (document.getElementById('wzContacts').value || '').trim()
    if (!raw) return []
    const contacts = []
    const lines = raw.split('\n').filter(l => l.trim())
    for (const line of lines) {
      // 1. Prefer explicit delimiter (comma or tab) — splits cleanly.
      let phoneRaw, nameRaw
      const explicitMatch = line.match(/^\s*([^\t,]+)[\t,](.+)$/)
      if (explicitMatch) {
        phoneRaw = explicitMatch[1].trim()
        nameRaw = explicitMatch[2].trim()
      } else {
        // 2. Fallback: split on first whitespace that follows a phone-like
        //    sequence (digits, optional +, spaces/dashes/parens inside).
        //    Examples: "+12138686239 Steve Edith" → phone="+12138686239" name="Steve Edith"
        //              "+1 (213) 868-6239 Steve"  → phone="+1 (213) 868-6239" name="Steve"
        //              "+12138686239"             → phone="+12138686239" name=""
        const m = line.match(/^\s*(\+?[\d()\-\s]{7,})(?:\s+(.+))?$/)
        if (m) {
          phoneRaw = m[1].trim()
          nameRaw = (m[2] || '').trim()
        } else {
          phoneRaw = line.trim()
          nameRaw = ''
        }
      }
      const phoneDigits = (phoneRaw || '').replace(/[^+\d]/g, '')
      if (phoneDigits.length >= 7) {
        // Use the cleaned digit-only phone (drop stray characters) to prevent
        // sending to malformed numbers like "+12138686239 Steve Edith".
        contacts.push({ phoneNumber: phoneDigits, name: nameRaw })
      }
    }
    return contacts
  },

  // ─── Review ───
  populateReview() {
    const name = document.getElementById('wzName').value.trim()
    const content = document.getElementById('wzContent').value.trim()
    // Use same --- delimiter logic as buildCampaignData
    const hasDelimiter = /\n\s*---\s*\n|\n\s*---\s*$|^\s*---\s*\n/.test(content)
    const contentMessages = hasDelimiter
      ? content.split(/\n\s*---\s*\n|\n\s*---\s*$|^\s*---\s*\n/).map(m => m.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
      : [content.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()]
    const contacts = this.parseContacts()
    const gapTime = parseInt(document.getElementById('wzGapTime').value) || 5

    document.getElementById('rvName').textContent = name
    // Preview with a sample name (use first contact's name when available).
    const sampleName = contacts.length > 0 && contacts[0].name ? contacts[0].name : 'there'
    const firstMsg = contentMessages.length > 0 ? contentMessages[0] : content
    document.getElementById('rvPreview').textContent = this._substituteName(firstMsg, sampleName)

    // ─── Template / contact-name validation ───
    // Build a single warning banner under the preview so users catch issues
    // before sending — the most common AI-support complaint we get is
    // "[name] not working". The two root causes are:
    //   (1) using a variant syntax like {name} / <name> that wasn't substituted
    //   (2) having [name] in the template but contacts without names
    const templateHasName = this._templateHasPlaceholder(firstMsg)
    const variantOnly = this._templateHasVariantOnly(firstMsg)
    const contactsMissingName = contacts.filter(c => !c.name).length
    const warningBanner = document.getElementById('rvNameWarning')
    if (warningBanner) {
      const warnings = []
      if (variantOnly) {
        warnings.push('⚠️ Your template uses <b>{name}</b>, <b>&lt;name&gt;</b>, or <b>%name%</b>. Use <b>[name]</b> (square brackets) — other syntaxes are still recognised but <b>[name]</b> is the canonical form shown in the hint.')
      }
      if (templateHasName && contacts.length > 0 && contactsMissingName === contacts.length) {
        warnings.push(`⚠️ Your template uses <b>[name]</b> but <b>none</b> of your ${contacts.length} contacts have a name — <b>[name]</b> will be blank in every SMS. Add names using <code>+phone,Name</code> per line.`)
      } else if (templateHasName && contactsMissingName > 0) {
        warnings.push(`⚠️ ${contactsMissingName} of ${contacts.length} contacts have no name — <b>[name]</b> will be blank for those messages.`)
      }
      warningBanner.innerHTML = warnings.join('<br><br>')
      warningBanner.style.display = warnings.length ? 'block' : 'none'
    }
    const longestMsg = contentMessages.length > 0 ? contentMessages.reduce((a, b) => a.length > b.length ? a : b, '') : content
    const segments = longestMsg.length <= 160 ? 1 : Math.ceil(longestMsg.length / 153)
    const rotationNote = contentMessages.length > 1 ? ` · ${contentMessages.length} messages (rotation)` : ''
    document.getElementById('rvMsgMeta').textContent = `${longestMsg.length} chars · ${segments} SMS part${segments > 1 ? 's' : ''}${rotationNote}`

    document.getElementById('rvContacts').textContent = contacts.length
    const sample = contacts.slice(0, 3).map(c => c.name ? `${c.phoneNumber} (${c.name})` : c.phoneNumber).join(', ')
    document.getElementById('rvContactsList').textContent = contacts.length > 3 ? `${sample} +${contacts.length - 3} more` : sample

    // Estimated time
    const totalSec = contacts.length * gapTime
    const mins = Math.floor(totalSec / 60)
    const secs = totalSec % 60
    document.getElementById('estTime').textContent =
      `Estimated time: ${mins > 0 ? mins + ' min ' : ''}${secs} sec for ${contacts.length} messages`

    // Carrier precheck — recommend auto-rotate if history looks bad
    this._runCarrierPrecheck(contacts).catch(e => console.warn('[Precheck] failed:', e))
  },

  // Look up historical success-rate from the server for the country/carrier
  // prefixes represented in the target contact list. If the rate is < 70%
  // for any prefix that covers a meaningful chunk of contacts, suggest
  // enabling auto-rotate (when the user has ≥2 SIMs).
  async _runCarrierPrecheck(contacts) {
    const banner = document.getElementById('carrierPrecheckBanner')
    if (!banner) return
    banner.style.display = 'none'
    banner.innerHTML = ''
    if (!contacts || contacts.length === 0) return

    // Count contacts per dial prefix (first 1-4 digits after +)
    const prefixCounts = {}
    for (const c of contacts) {
      const m = (c.phoneNumber || '').match(/\+(\d{1,4})/)
      if (!m) continue
      // Use first 1-3 digits as country prefix — a coarse proxy for carrier pool
      const p = m[1].slice(0, Math.min(3, m[1].length))
      prefixCounts[p] = (prefixCounts[p] || 0) + 1
    }
    const prefixes = Object.keys(prefixCounts)
    if (prefixes.length === 0) return

    let resp
    try {
      resp = await API.getCarrierStats(prefixes)
    } catch (e) {
      return // network / server issue — stay silent
    }
    const stats = resp?.stats || {}
    const MIN_SAMPLE = 5       // don't warn on sparse data
    const RATE_THRESHOLD = 0.7 // warn below 70%
    const risky = []
    for (const p of prefixes) {
      const s = stats[p]
      if (!s || s.sample < MIN_SAMPLE || s.rate === null) continue
      if (s.rate < RATE_THRESHOLD) {
        risky.push({ prefix: p, rate: s.rate, sample: s.sample, affected: prefixCounts[p] })
      }
    }
    if (risky.length === 0) return

    // Sort by affected-count desc
    risky.sort((a, b) => b.affected - a.affected)
    const top = risky[0]
    const pctText = Math.round(top.rate * 100) + '%'

    const hasMultiSim = this.availableSims.length > 1
    const wzSel = document.getElementById('wzSimSelect')
    const alreadyRotating = wzSel && wzSel.value === 'rotate'

    let actionHtml = ''
    if (hasMultiSim && !alreadyRotating) {
      actionHtml = `<button class="btn btn-primary" data-testid="enable-rotate-btn" onclick="App._enableAutoRotateFromPrecheck()" style="margin-top:8px;font-size:13px;padding:8px 14px">Enable Auto-rotate across my SIMs</button>`
    } else if (hasMultiSim && alreadyRotating) {
      actionHtml = `<div style="margin-top:6px;font-size:12px;color:var(--success)">✓ Auto-rotate already enabled</div>`
    } else {
      actionHtml = `<div style="margin-top:6px;font-size:12px;color:var(--text-muted)">Tip: inserting a second SIM would let you auto-rotate and dodge this.</div>`
    }

    banner.innerHTML = `
      <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px;margin-bottom:12px">
        <div style="font-weight:600;color:var(--danger);font-size:14px">⚠️ Carrier alert for +${top.prefix}</div>
        <div style="font-size:13px;color:var(--text-secondary);margin-top:4px">
          Recent success rate on +${top.prefix}: <strong>${pctText}</strong>
          (${top.sample} tests in last ${resp.windowDays || 14}d).
          ${top.affected} of your ${contacts.length} contacts start with +${top.prefix}.
        </div>
        ${actionHtml}
      </div>`
    banner.style.display = 'block'
  },

  _enableAutoRotateFromPrecheck() {
    const wzSel = document.getElementById('wzSimSelect')
    if (!wzSel) return
    // Ensure 'rotate' option exists (only added when >=2 SIMs)
    const hasRotate = Array.from(wzSel.options).some(o => o.value === 'rotate')
    if (!hasRotate) return this.toast('Need at least 2 SIMs to auto-rotate.', 'error')
    wzSel.value = 'rotate'
    wzSel.dataset.selected = 'rotate'
    this.toast('Auto-rotate across SIMs enabled for this campaign.', 'success')
    // Re-run precheck to update the banner
    this._runCarrierPrecheck(this.parseContacts()).catch(() => {})
  },

  // ─── File Import ───
  importFile() { document.getElementById('fileInput').click() },
  handleFileImport(event) {
    const file = event.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      const existing = document.getElementById('wzContacts').value
      const sep = existing.trim() ? '\n' : ''
      document.getElementById('wzContacts').value = existing + sep + e.target.result
      this.updateContactCount()
      this.toast(`Imported from ${file.name}`, 'success')
    }
    reader.readAsText(file)
    event.target.value = ''
  },

  // ─── Save Draft ───
  async saveDraft() {
    const data = this.buildCampaignData()
    if (!data) return
    data.status = 'draft'
    try {
      if (this.currentCampaign) {
        await API.updateCampaign(this.currentCampaign._id, { chatId: data.chatId, ...data })
      } else {
        await API.createCampaign(data)
      }
      this.toast('Saved as draft', 'success')
      await this.syncData()
      this.showDashboard()
    } catch (e) {
      if (e.message && e.message.includes('subscription')) {
        this.showSubscriptionModal()
      } else {
        this.toast('Failed to save: ' + (e.message || ''), 'error')
      }
    }
  },

  // ─── Send Campaign ───
  async sendCampaign() {
    // Fresh subscription check
    const code = Storage.getCode()
    let planData
    try {
      planData = await API.getPlan(code)
      Storage.setUser(planData)
      if (!planData.canUseSms) {
        return this.showSubscriptionModal()
      }
    } catch {
      return this.toast('Cannot verify subscription. Check connection.', 'error')
    }

    const data = this.buildCampaignData()
    if (!data) return

    // Warn if trial contacts exceed remaining SMS
    if (planData && planData.isFreeTrial && !planData.isSubscribed) {
      const remaining = planData.freeSmsRemaining || 0
      const contactCount = (data.contacts || []).length
      if (contactCount > remaining) {
        this.showModal('Free Trial Limit',
          `You have ${remaining} free SMS left but this campaign has ${contactCount} contacts. ` +
          `Only the first ${remaining} messages will be sent. Subscribe for unlimited sending.`,
          [
            { label: 'Cancel', action: 'App.hideModal()' },
            { label: 'Subscribe', class: 'btn-subscribe', action: `window.open('${this.brand().botUrl}','_blank');App.hideModal()` },
            { label: 'Send Anyway', class: 'btn-primary', action: 'App.hideModal();App._doSendCampaign()' },
          ])
        this._pendingSendData = data
        return
      }
    }

    this._doSendCampaign(data)
  },

  async _doSendCampaign(data) {
    if (!data && this._pendingSendData) {
      data = this._pendingSendData
      this._pendingSendData = null
    }
    if (!data) return

    try {
      let campaign
      if (this.currentCampaign) {
        await API.updateCampaign(this.currentCampaign._id, { chatId: data.chatId, ...data })
        campaign = { ...this.currentCampaign, ...data }
      } else {
        const res = await API.createCampaign(data)
        campaign = res.campaign
      }
      this.startSending(campaign)
    } catch (e) {
      if (e.message && e.message.includes('subscription')) {
        this.showSubscriptionModal()
      } else {
        this.toast('Failed: ' + (e.message || ''), 'error')
      }
    }
  },

  buildCampaignData() {
    const name = document.getElementById('wzName').value.trim()
    const contentRaw = document.getElementById('wzContent').value.trim()
    const contacts = this.parseContacts()
    const gapTime = parseInt(document.getElementById('wzGapTime').value) || 5
    const scheduleVal = document.getElementById('wzSchedule').value
    const wzSim = document.getElementById('wzSimSelect')
    const simSelection = wzSim ? (wzSim.value || 'default') : 'default'
    const chatId = Storage.getUser()?.chatId

    if (!chatId) { this.toast('Not connected', 'error'); return null }
    if (!name) { this.toast('Campaign name is required', 'error'); return null }
    if (!contentRaw) { this.toast('Message content is required', 'error'); return null }

    // Split by '---' delimiter for message rotation. Newlines within a message are preserved as spaces.
    // If no --- delimiter, entire text = one message. This prevents multi-line messages from being
    // accidentally split into separate rotation messages.
    const hasDelimiter = /\n\s*---\s*\n|\n\s*---\s*$|^\s*---\s*\n/.test(contentRaw)
    const contentMessages = hasDelimiter
      ? contentRaw.split(/\n\s*---\s*\n|\n\s*---\s*$|^\s*---\s*\n/).map(m => m.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
      : [contentRaw.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()]
    if (contentMessages.length === 0) { this.toast('Message content is required', 'error'); return null }

    return {
      chatId,
      name,
      content: contentMessages,
      contacts,
      smsGapTime: gapTime,
      simSelection, // 'default' | 'rotate' | '<subscriptionId>'
      scheduledAt: scheduleVal ? new Date(scheduleVal).toISOString() : null,
      source: 'app',
    }
  },

  showSubscriptionModal() {
    const user = Storage.getUser() || {}
    const remaining = user.freeSmsRemaining || 0
    const used = user.freeSmsUsed || 0
    const limit = user.freeSmsLimit || 100
    let msg
    if (used >= limit) {
      msg = `You've used all ${limit} free trial SMS! Subscribe via ${this.brand().botHandle} to unlock unlimited BulkSMS campaigns, URL shortening, phone validations & more.`
    } else {
      msg = `Your subscription has expired. Subscribe via ${this.brand().botHandle} on Telegram to continue sending campaigns.`
    }
    this.showModal('⚡ Upgrade Plan',
      msg,
      [
        { label: 'Later', action: 'App.hideModal()' },
        { label: '⚡ Upgrade Plan', class: 'btn-primary', action: `window.open('${this.brand().botUrl}','_blank');App.hideModal()` },
      ])
  },

  // ─── Open Campaign Detail ───
  openCampaign(id) {
    const c = this.campaigns.find(x => x._id === id)
    if (!c) return
    this.currentCampaign = c
    this.showScreen('detailScreen')
    document.getElementById('detailTitle').textContent = c.name

    const contentHtml = (c.content || []).map(t =>
      `<div class="content-item">${esc(t)}</div>`
    ).join('')

    const contactsHtml = (c.contacts || []).slice(0, 15).map(ct =>
      `<div class="contact-row"><span class="phone">${esc(ct.phoneNumber)}</span><span class="cname">${esc(ct.name || '')}</span></div>`
    ).join('')
    const moreContacts = (c.contacts || []).length > 15
      ? `<p style="text-align:center;color:var(--text-muted);font-size:12px;margin-top:6px">+${c.contacts.length - 15} more</p>` : ''

    const pct = c.totalCount > 0 ? Math.round((c.sentCount / c.totalCount) * 100) : 0

    document.getElementById('detailContent').innerHTML = `
      <div class="detail-section">
        <h3>Status</h3>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="c-card-badge badge-${c.status}" style="font-size:12px">${c.status}</span>
          <span style="color:var(--text-muted);font-size:12px">${new Date(c.createdAt).toLocaleString()}</span>
        </div>
        ${c.totalCount > 0 && c.sentCount > 0 ? `<div style="margin-top:10px"><div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);margin-bottom:3px"><span>Progress</span><span>${c.sentCount}/${c.totalCount} (${pct}%)</span></div><div class="c-card-progress" style="height:5px"><div class="c-card-bar" style="width:${pct}%"></div></div></div>` : ''}
      </div>
      <div class="detail-section">
        <h3>Message${(c.content || []).length > 1 ? 's' : ''}</h3>
        ${contentHtml || '<p style="color:var(--text-muted);font-size:13px">No content</p>'}
      </div>
      <div class="detail-section">
        <h3>Contacts (${(c.contacts || []).length})</h3>
        ${contactsHtml || '<p style="color:var(--text-muted);font-size:13px">No contacts</p>'}
        ${moreContacts}
      </div>
    `

    const user = Storage.getUser() || {}
    const canSend = (c.contacts || []).length > 0 && (c.content || []).length > 0 && user.canUseSms
    const actionsEl = document.getElementById('detailActions')

    if (c.status === 'completed') {
      actionsEl.innerHTML = `
        <button class="btn btn-secondary" onclick="App.editExisting()">Edit & Resend</button>
        <button class="btn btn-outline-danger btn-sm" onclick="App.confirmDelete()">Delete</button>`
    } else if (c.status === 'sending' || c.status === 'paused' || c.status === 'paused_trial_exhausted') {
      actionsEl.innerHTML = `
        <button class="btn btn-secondary" onclick="App.editExisting()">Edit</button>
        <button class="btn btn-send" ${!canSend ? 'disabled' : ''} onclick="App.resumeExisting()">Resume Sending</button>
        <button class="btn btn-outline-danger btn-sm" style="flex:0;padding:14px" onclick="App.confirmDelete()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>`
    } else {
      actionsEl.innerHTML = `
        <button class="btn btn-secondary" onclick="App.editExisting()">Edit</button>
        <button class="btn btn-send" ${!canSend ? 'disabled' : ''} onclick="App.sendExisting()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          Send
        </button>
        <button class="btn btn-outline-danger btn-sm" style="flex:0;padding:14px" onclick="App.confirmDelete()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>`
    }
  },

  editExisting() {
    const c = this.currentCampaign; if (!c) return
    this.wizardStep = 1
    document.getElementById('wzName').value = c.name || ''
    // Join rotation messages with --- delimiter (single message = no delimiter)
    const contentArr = c.content || []
    document.getElementById('wzContent').value = contentArr.length > 1
      ? contentArr.join('\n---\n')
      : contentArr.join('')
    document.getElementById('wzContacts').value = (c.contacts || []).map(
      ct => ct.name ? `${ct.phoneNumber}, ${ct.name}` : ct.phoneNumber
    ).join('\n')
    document.getElementById('wzGapTime').value = c.smsGapTime || 5
    document.getElementById('wzSchedule').value = ''
    const wzSim = document.getElementById('wzSimSelect')
    if (wzSim) {
      const sel = c.simSelection || 'default'
      wzSim.dataset.selected = sel
    }
    document.getElementById('wizardTitle').textContent = 'Edit Campaign'
    this._populateSimSelectors()
    this.updateCharCount()
    this.updateContactCount()
    this.showWizardStep(1)
    this.showScreen('wizardScreen')
  },

  async sendExisting() {
    if (!this.currentCampaign) return
    // Fresh sub check
    try {
      const planData = await API.getPlan(Storage.getCode())
      Storage.setUser(planData)
      if (!planData.canUseSms) return this.showSubscriptionModal()
    } catch { return this.toast('Cannot verify subscription', 'error') }
    this.startSending(this.currentCampaign)
  },

  async resumeExisting() {
    if (!this.currentCampaign) return
    try {
      const planData = await API.getPlan(Storage.getCode())
      Storage.setUser(planData)
      if (!planData.canUseSms) return this.showSubscriptionModal()
    } catch { return this.toast('Cannot verify subscription', 'error') }
    this.startSending(this.currentCampaign)
  },

  confirmDelete() {
    this.showModal('Delete Campaign', 'This cannot be undone. Are you sure?', [
      { label: 'Cancel', action: 'App.hideModal()' },
      { label: 'Delete', class: 'btn-outline-danger', action: 'App.doDelete()' },
    ])
  },
  async doDelete() {
    this.hideModal()
    if (!this.currentCampaign) return
    try {
      await API.deleteCampaign(this.currentCampaign._id, Storage.getUser()?.chatId)
      this.toast('Deleted', 'success')
      await this.syncData()
      this.showDashboard()
    } catch { this.toast('Failed to delete', 'error') }
  },

  // ─── SMS Sending ───
  async startSending(campaign) {
    console.log('[SMS] ='.repeat(25))
    console.log('[SMS] Starting campaign:', campaign.name)
    console.log('[SMS] Campaign ID:', campaign._id)
    console.log('[SMS] Contacts:', campaign.contacts?.length || 0)
    console.log('[SMS] ='.repeat(25))
    
    const contacts = campaign.contacts || []
    const content = campaign.content || []
    if (!contacts.length || !content.length) return this.toast('Campaign needs content and contacts', 'error')

    // Trial cap — applied regardless of platform (native or browser)
    let sendContacts = contacts
    {
      const user = Storage.getUser() || {}
      if (user.isFreeTrial && !user.isSubscribed) {
        const remaining = user.freeSmsRemaining || 0
        const startIdx = campaign.lastSentIndex || 0
        const unsent = contacts.length - startIdx
        if (remaining <= 0) {
          return this.showSubscriptionModal()
        }
        if (unsent > remaining) {
          console.log(`[SMS] Trial limit: capping send to ${remaining} contacts (of ${unsent} remaining)`)
          sendContacts = contacts.slice(0, startIdx + remaining)
        }
      }
    }

    // Pre-check SMS permission before starting
    if (window.Capacitor?.Plugins?.DirectSms) {
      console.log('[SMS] Checking permission before send...')
      try {
        let perm = null
        // Retry permission check up to 2 times (bridge may not be ready)
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            perm = await window.Capacitor.Plugins.DirectSms.checkPermission()
            break
          } catch (retryErr) {
            console.warn(`[SMS] Permission check attempt ${attempt} failed:`, retryErr)
            if (attempt < 2) await new Promise(r => setTimeout(r, 500))
          }
        }
        
        if (!perm) {
          // Bridge failed — try requesting permission directly (triggers native dialog)
          console.log('[SMS] Permission check failed, trying direct request...')
          try {
            perm = await window.Capacitor.Plugins.DirectSms.requestPermission()
          } catch (reqErr) {
            console.error('[SMS] Direct permission request also failed:', reqErr)
            return this.toast(`SMS permission check failed. Please go to Android Settings > Apps > ${this.brand().appName} > Permissions and enable SMS manually.`, 'error')
          }
        }

        console.log('[SMS] Permission status:', perm)
        
        if (!perm.granted) {
          console.log('[SMS] Permission not granted, requesting...')
          const req = await window.Capacitor.Plugins.DirectSms.requestPermission()
          console.log('[SMS] Permission request result:', req)
          
          if (!req.granted) {
            console.error('[SMS] ❌ Permission DENIED by user - blocking send')
            return this.toast(`SMS permission DENIED. Go to Android Settings > Apps > ${this.brand().appName} > Permissions and enable SMS.`, 'error')
          }
          console.log('[SMS] ✅ Permission granted after request')
        } else {
          console.log('[SMS] ✅ Permission already granted')
        }
      } catch (e) {
        console.error('[SMS] ❌ Permission check failed:', e)
        // Don't block — attempt to send anyway (native side will handle permission)
        console.log('[SMS] Proceeding with send — native plugin will handle permission')
      }

      // v2.7.0: Background service is opt-in via Settings → Advanced.
      // When enabled, the foreground service keeps sending even if the app
      // is closed. When disabled (default), we use the reliable JS-loop path.
      if (Storage.get('bgServiceEnabled')) {
        try {
          const bgStartIndex = campaign.lastSentIndex || 0
          if (bgStartIndex >= sendContacts.length) {
            this.toast('Campaign already complete!', 'info')
            return this.showDashboard()
          }
          const simSel = this._resolveCampaignSim(campaign)
          console.log('[SMS] 🚀 Background service path — SIM:', simSel.label)
          await window.Capacitor.Plugins.DirectSms.startBackgroundSending({
            campaignId: campaign._id,
            campaignName: campaign.name,
            contacts: JSON.stringify(sendContacts),
            content: JSON.stringify(content),
            gapTimeMs: (campaign.smsGapTime || 5) * 1000,
            startIndex: bgStartIndex,
            subscriptionId: simSel.subscriptionId,
            subscriptionIds: JSON.stringify(simSel.subscriptionIds || []),
          })
          this.toast('SMS sending in background. You can close the app!', 'success')

          this.sendingState = {
            campaignId: campaign._id,
            chatId: Storage.getUser()?.chatId,
            contacts: sendContacts,
            content,
            total: sendContacts.length,
            idx: bgStartIndex,
            sent: 0,
            failed: 0,
            startTime: Date.now(),
            usingBackgroundService: true,
            simLabel: simSel.label,
          }
          this.showScreen('sendingScreen')
          document.getElementById('sendingTitle').textContent = campaign.name
          document.getElementById('pauseSendBtn').style.display = 'flex'
          document.getElementById('resumeSendBtn').style.display = 'none'
          document.getElementById('stopSendBtn').textContent = 'Stop & Save'
          document.getElementById('stopSendBtn').onclick = () => this.stopBackgroundSending()
          document.getElementById('pauseSendBtn').onclick = () => this.pauseBackgroundSending()
          this.pollBackgroundStatus()
          return
        } catch (serviceErr) {
          console.error('[SMS] ❌ Background service failed, falling back to JS loop:', serviceErr)
          this.toast('Background service unavailable — using foreground send.', 'info')
          // fall through to JS-loop
        }
      }
    }

    // JS-LOOP PATH (default; also used when not running under Capacitor)
    const simSel = this._resolveCampaignSim(campaign)
    console.log('[SMS] JS-loop path — SIM:', simSel.label)
    this.sendingState = {
      campaignId: campaign._id,
      chatId: Storage.getUser()?.chatId,
      contacts: sendContacts,
      content,
      gapTime: (campaign.smsGapTime || 5) * 1000,
      idx: campaign.lastSentIndex || 0,
      sent: campaign.sentCount || 0,
      failed: campaign.failedCount || 0,
      total: sendContacts.length,
      paused: false, stopped: false,
      startTime: Date.now(),
      errors: [],
      usingBackgroundService: false,
      subscriptionId: simSel.subscriptionId,
      subscriptionIds: simSel.subscriptionIds.slice(), // clone — may be mutated by auto-throttle
      initialSubscriptionIds: simSel.subscriptionIds.slice(), // immutable copy for diagnostics
      simLabel: simSel.label,
      // Per-SIM rolling-failure tracker for auto-throttle (keyed by subId)
      simStats: {},
      throttleMultiplier: 1, // gap gets multiplied when carrier rate-limits kick in
      throttledSims: [],     // subIds that have been dropped from rotation
    }

    this.showScreen('sendingScreen')
    document.getElementById('sendingTitle').textContent = campaign.name
    document.getElementById('pauseSendBtn').style.display = 'flex'
    document.getElementById('resumeSendBtn').style.display = 'none'
    document.getElementById('stopSendBtn').textContent = 'Stop & Save'
    document.getElementById('stopSendBtn').onclick = () => this.stopSending()
    this.updateSendingUI()
    API.updateProgress(campaign._id, { chatId: this.sendingState.chatId, status: 'sending' }).catch(() => {})
    this.sendNext()
  },

  async sendNext() {
    const s = this.sendingState
    if (!s || s.paused || s.stopped) return

    if (s.idx >= s.total) {
      const allFailed = s.sent === 0 && s.failed > 0
      const someFailed = s.failed > 0 && s.sent > 0
      if (allFailed) {
        document.getElementById('sendingTitle').textContent = 'Sending Failed'
        const lastErr = s.errors.length > 0 ? s.errors[s.errors.length - 1] : null
        let hint = 'Check your SIM card and SMS permissions.'
        if (lastErr) {
          if (lastErr.reason === 'no_service') hint = 'No cellular service — check signal and SIM.'
          else if (lastErr.reason === 'radio_off') hint = 'Radio/Airplane mode is ON — turn it off.'
          else if (lastErr.reason === 'generic_failure') {
            hint = 'SMS blocked by carrier. Common causes:\n' +
                   '• SIM has no SMS credit/balance\n' +
                   '• Carrier rate limit (try waiting 5+ min)\n' +
                   '• Invalid phone number format\n' +
                   '• Carrier spam filter (contact your mobile provider)'
          }
          else if (lastErr.reason === 'send_timeout') hint = 'SMS timed out — carrier may be blocking sends.'
          else if (lastErr.reason === 'null_pdu') hint = 'Message encoding error — try a shorter message.'
          else if (lastErr.reason === 'permission_denied') hint = `SMS permission denied — enable in Android Settings > Apps > ${this.brand().appName} > Permissions.`
          else if (lastErr.reason === 'permission_permanently_denied') hint = 'SMS permission permanently denied. You must enable it manually in Android Settings.'
          else if (lastErr.reason === 'permission_needed') hint = 'SMS permission not granted. Please grant SMS permission to use this feature.'
          else if (lastErr.reason === 'invalid_input') hint = 'Invalid phone number format — check contact numbers.'
          else if (lastErr.reason === 'send_exception' || lastErr.reason === 'plugin_bridge_exception') {
            hint = lastErr.error ? `Error: ${lastErr.error}` : 'SMS plugin error — restart app or check Android version compatibility.'
          }
        }
        document.getElementById('sendingStatus').textContent = hint
        // Show "Open Settings" button for permission issues
        if (lastErr && (lastErr.reason === 'permission_denied' || lastErr.reason === 'permission_permanently_denied' || lastErr.reason === 'permission_needed')) {
          const settingsBtn = document.createElement('button')
          settingsBtn.textContent = '⚙️ Open App Settings'
          settingsBtn.className = 'settings-btn'
          settingsBtn.style.cssText = 'margin-top:12px;padding:10px 20px;background:#4a90d9;color:white;border:none;border-radius:8px;font-size:14px;cursor:pointer;'
          settingsBtn.onclick = async () => {
            try {
              if (window.Capacitor?.Plugins?.DirectSms?.openSettings) {
                await window.Capacitor.Plugins.DirectSms.openSettings()
              }
            } catch (e) { console.error('Failed to open settings:', e) }
          }
          document.getElementById('sendingStatus').appendChild(document.createElement('br'))
          document.getElementById('sendingStatus').appendChild(settingsBtn)
        }
      } else if (someFailed) {
        document.getElementById('sendingTitle').textContent = 'Completed with errors'
        document.getElementById('sendingStatus').textContent = `${s.sent} sent, ${s.failed} failed`
      } else {
        document.getElementById('sendingTitle').textContent = 'Complete!'
        document.getElementById('sendingStatus').textContent = 'All messages sent successfully'
      }
      document.getElementById('sendingEta').textContent = 'Done'
      document.getElementById('pauseSendBtn').style.display = 'none'
      document.getElementById('stopSendBtn').textContent = 'Back to Campaigns'
      document.getElementById('stopSendBtn').onclick = () => { this.syncData(); this.showDashboard() }
      API.updateProgress(s.campaignId, { chatId: s.chatId, status: 'completed', sentCount: s.sent, failedCount: s.failed, lastSentIndex: s.idx }).catch(() => {})
      // Report errors to server for diagnostics
      if (s.errors.length > 0) {
        API.reportSmsErrors(s.chatId, s.campaignId, s.errors).catch(() => {})
      }
      return
    }

    const contact = s.contacts[s.idx]
    const msgIdx = s.idx % s.content.length
    const msg = this._substituteName(s.content[msgIdx], contact.name)

    document.getElementById('sendingStatus').textContent = `Sending to ${contact.phoneNumber}${contact.name ? ' (' + contact.name + ')' : ''}`

    // Pick SIM for this contact: rotation (if any) > single fixed > default (-1)
    // Honors auto-throttle: if a SIM is throttled, it is skipped in rotation.
    let thisSubId = (typeof s.subscriptionId === 'number') ? s.subscriptionId : -1
    if (Array.isArray(s.subscriptionIds) && s.subscriptionIds.length > 0) {
      const live = s.subscriptionIds.filter(id => !s.throttledSims.includes(id))
      const pool = live.length > 0 ? live : s.subscriptionIds // fallback to all if all throttled
      thisSubId = pool[s.idx % pool.length]
    }

    try {
      const result = await this.nativeSms(contact.phoneNumber, msg, thisSubId)
      this._recordSimOutcome(s, thisSubId, !!result.success, result.errorReason)
      if (result.success) {
        s.sent++
        // ── IMS / Wi-Fi Calling quirk detection ──
        // Native plugin fell back to content://sms/sent verification because sentIntent never fired.
        // Show a one-time toast so the user understands future "sent" markers.
        if (result.imsQuirkFallback && !s._imsToastShown) {
          s._imsToastShown = true
          s._imsFallbackCount = (s._imsFallbackCount || 0) + 1
          this.toast('ℹ️ Wi-Fi Calling detected — SMS verified via system log.', 'info')
          try { API.reportIMSQuirk?.(s.chatId, { campaignId: s.campaignId, simCarrier: s.simLabel }) } catch {}
        } else if (result.imsQuirkFallback) {
          s._imsFallbackCount = (s._imsFallbackCount || 0) + 1
        }
      } else {
        s.failed++
        s.errors.push({ 
          phone: contact.phoneNumber, 
          reason: result.errorReason || 'unknown', 
          code: result.errorCode,
          error: result.error || null,
          exceptionType: result.exceptionType || null,
          subscriptionId: thisSubId
        })
        console.warn(`[SMS] Failed to send to ${contact.phoneNumber}: ${result.errorReason} (code: ${result.errorCode})`, result.error ? `Detail: ${result.error}` : '')
      }
    } catch (e) {
      s.failed++
      this._recordSimOutcome(s, thisSubId, false, 'js_exception')
      s.errors.push({ phone: contact.phoneNumber, reason: 'js_exception', error: e.message })
    }

    // Auto-throttle decision (may mutate s.throttledSims or s.throttleMultiplier)
    this._applyAutoThrottle(s, thisSubId)

    s.idx++
    this.updateSendingUI()
    this._checkAutoCanary(s)

    // Report progress every 5 messages (or on last message) and check trial balance
    if (s.idx % 5 === 0 || s.idx >= s.total) {
      try {
        const progressRes = await API.updateProgress(s.campaignId, { chatId: s.chatId, sentCount: s.sent, failedCount: s.failed, lastSentIndex: s.idx, status: 'sending' })
        // Check if trial/subscription expired mid-campaign
        if (progressRes && progressRes.canUseSms === false) {
          console.warn('[SMS] Trial/subscription exhausted mid-campaign — stopping')
          s.idx = s.total // Force stop
          this.updateSendingUI()
          this.showSubscriptionModal()
          API.updateProgress(s.campaignId, { chatId: s.chatId, sentCount: s.sent, failedCount: s.failed, lastSentIndex: s.idx, status: 'paused_trial_exhausted' }).catch(() => {})
          return
        }
      } catch (e) {
        // If 403, trial exhausted — stop sending
        if (e.message && (e.message.includes('subscription') || e.message.includes('403'))) {
          console.warn('[SMS] Subscription check failed — stopping send')
          s.idx = s.total
          this.updateSendingUI()
          this.showSubscriptionModal()
          return
        }
        // Other errors — log but continue
        console.warn('[SMS] Progress update failed:', e.message)
      }
    }

    setTimeout(() => this.sendNext(), s.gapTime * (s.throttleMultiplier || 1))
  },

  // ─── Per-SIM auto-throttle ───
  // Records the last 5 outcomes per SIM. If >=4 of the last 5 are
  // rate-limit-style failures (generic_failure / send_timeout), we treat that
  // SIM as rate-limited by its carrier and either:
  //   • Drop it from rotation (if other SIMs are available), OR
  //   • Double the gap time so the single SIM gets breathing room.
  _recordSimOutcome(s, subId, success, reason) {
    if (!s.simStats) s.simStats = {}
    const key = String(subId)
    if (!s.simStats[key]) s.simStats[key] = { sent: 0, failed: 0, recent: [] }
    const st = s.simStats[key]
    if (success) st.sent++; else st.failed++
    st.recent.push({ ok: !!success, reason: reason || null })
    if (st.recent.length > 5) st.recent.shift()
  },

  _isRateLimitReason(reason) {
    return reason === 'generic_failure' || reason === 'send_timeout' || reason === 'multipart_timeout'
  },

  _applyAutoThrottle(s, lastSubId) {
    if (!s || s._throttleDisabled) return
    const key = String(lastSubId)
    const st = s.simStats?.[key]
    if (!st || st.recent.length < 5) return // need a full 5-sample window

    const rateLimited = st.recent.filter(r => !r.ok && this._isRateLimitReason(r.reason)).length
    if (rateLimited < 4) return // <80% rate-limit — not a carrier block

    // Decision 1: drop this SIM from rotation if we have others still live
    const rotationPool = Array.isArray(s.subscriptionIds) ? s.subscriptionIds : []
    const liveCount = rotationPool.filter(id => !s.throttledSims.includes(id)).length
    if (rotationPool.length > 1 && liveCount > 1 && !s.throttledSims.includes(lastSubId)) {
      s.throttledSims.push(lastSubId)
      // Reset the tracker so we don't immediately re-throttle if it re-enters
      st.recent = []
      const dropped = this._simLabelForId(lastSubId)
      this.toast(`Carrier rate limit detected — pausing ${dropped} for this campaign.`, 'error')
      console.warn(`[SMS] Auto-throttle: dropped SIM ${lastSubId} from rotation (${liveCount - 1} live SIMs remaining).`)
      const banner = document.getElementById('sendingStatus')
      if (banner) banner.textContent = `⚠️ ${dropped} rate-limited — switching to remaining SIMs.`
      this._reportThrottleEvent(s, 'drop', lastSubId, rateLimited)
      return
    }

    // Decision 2: single-SIM (or all rotated-out) — slow down the gap
    if (s.throttleMultiplier < 4) {
      s.throttleMultiplier = Math.min(4, (s.throttleMultiplier || 1) * 2)
      st.recent = [] // reset so we don't keep multiplying
      this.toast(`Carrier appears to rate-limit — slowing send rate ${s.throttleMultiplier}×.`, 'info')
      console.warn(`[SMS] Auto-throttle: gap × ${s.throttleMultiplier} (was × ${s.throttleMultiplier / 2}).`)
      this._reportThrottleEvent(s, 'slow', lastSubId, rateLimited)
    }
  },

  _reportThrottleEvent(s, action, subId, windowFailures) {
    try {
      const chatId = s?.chatId || Storage.getUser()?.chatId
      if (!chatId) return
      const sim = this.availableSims.find(x => x.subscriptionId === subId)
      // Infer a carrier prefix from the most-recently failed contact (if any)
      let carrierPrefix = null
      if (s?.errors?.length) {
        const lastErr = s.errors[s.errors.length - 1]
        const m = (lastErr?.phone || '').match(/^\+(\d{1,3})/)
        if (m) carrierPrefix = m[1]
      }
      API.reportThrottleEvent(chatId, {
        action,
        subscriptionId: typeof subId === 'number' ? subId : -1,
        simCarrier: sim?.carrierName || null,
        carrierPrefix,
        windowFailures,
        campaignId: s?.campaignId || null,
        appVersion: this.getAppVersion(),
      }).catch(() => {})
    } catch { /* best-effort */ }
  },

  _simLabelForId(subId) {
    if (subId < 0) return 'default SIM'
    const sim = this.availableSims.find(x => x.subscriptionId === subId)
    return sim ? this._simLabel(sim) : `SIM (sub ${subId})`
  },

  async nativeSms(phone, msg, subscriptionId) {
    const subId = (typeof subscriptionId === 'number') ? subscriptionId : -1
    if (window.Capacitor?.Plugins?.DirectSms) {
      try {
        const r = await window.Capacitor.Plugins.DirectSms.send({ phoneNumber: phone, message: msg, subscriptionId: subId })
        
        // Handle permission_needed — native plugin detected permission not granted
        if (r.errorReason === 'permission_needed') {
          console.warn('[SMS] Permission needed — attempting to request...')
          try {
            const perm = await window.Capacitor.Plugins.DirectSms.requestPermission()
            if (perm.granted) {
              // Permission just granted — retry the send
              console.log('[SMS] Permission granted after request — retrying send')
              const retry = await window.Capacitor.Plugins.DirectSms.send({ phoneNumber: phone, message: msg, subscriptionId: subId })
              return { success: !!retry.success, errorCode: retry.errorCode, errorReason: retry.errorReason || retry.status, error: retry.error, exceptionType: retry.exceptionType }
            } else if (perm.permanentlyDenied) {
              return { success: false, errorCode: -21, errorReason: 'permission_permanently_denied', error: 'SMS permission permanently denied. Tap "Open Settings" below to enable it manually.' }
            } else {
              return { success: false, errorCode: -20, errorReason: 'permission_denied', error: 'SMS permission denied by user.' }
            }
          } catch (permErr) {
            return { success: false, errorCode: -20, errorReason: 'permission_denied', error: 'Failed to request SMS permission: ' + (permErr.message || permErr) }
          }
        }
        
        if (!r.success) {
          console.error('[SMS] Send failed:', {
            phone,
            reason: r.errorReason || r.status,
            code: r.errorCode,
            error: r.error,
            exceptionType: r.exceptionType,
            subscriptionId: subId
          })
        }
        return { success: !!r.success, errorCode: r.errorCode, errorReason: r.errorReason || r.status, error: r.error, exceptionType: r.exceptionType }
      } catch (e) {
        console.error('[SMS] Plugin bridge exception:', e)
        return { success: false, errorCode: -3, errorReason: 'plugin_bridge_exception', error: e.message || String(e) }
      }
    }
    // Browser simulation
    console.log(`[SMS] → ${phone}: ${msg.substring(0, 40)}... (subId=${subId})`)
    await new Promise(r => setTimeout(r, 150))
    return { success: Math.random() > 0.05, errorReason: 'simulated' }
  },

  // Auto-canary: if the first several sends all failed, warn the user
  // (once) and point them to the Test SMS diagnostic so they don't burn
  // their entire contact list on a broken carrier / permission state.
  _checkAutoCanary(s) {
    if (!s || s._canaryFired) return
    const elapsed = Date.now() - s.startTime
    // Trigger once we've attempted at least 3 sends AND 30 seconds have passed
    // AND nothing has succeeded yet.
    if (s.idx >= 3 && s.sent === 0 && elapsed >= 30000) {
      s._canaryFired = true
      const banner = document.getElementById('sendingStatus')
      if (banner) {
        banner.innerHTML = `⚠️ <strong>No messages sent in 30s.</strong> Tap Stop, then go to Settings → Diagnostics → <u>Send Test SMS</u> to see why (permissions, SIM, carrier block, no signal, etc.).`
        banner.style.color = 'var(--danger)'
      }
      this.toast('No SMS sent in 30s — pause and try Test SMS in Settings.', 'error')
    }
  },

  updateSendingUI() {
    const s = this.sendingState; if (!s) return
    const rawPct = s.total > 0 ? Math.round((s.idx / s.total) * 100) : 0
    const pct = Math.min(100, Math.max(0, rawPct))
    const circ = 2 * Math.PI * 78
    document.getElementById('progressCircle').setAttribute('stroke-dashoffset', circ - (pct / 100) * circ)
    document.getElementById('sendingPercent').textContent = pct + '%'
    document.getElementById('sendingSent').textContent = s.sent
    document.getElementById('sendingFailed').textContent = s.failed
    document.getElementById('sendingRemaining').textContent = Math.max(0, s.total - s.idx)

    // ETA
    const elapsed = Date.now() - s.startTime
    const processed = s.idx - (s.contacts.indexOf(s.contacts[0]) || 0)
    if (processed > 0) {
      const remaining = Math.max(0, s.total - s.idx)
      const msPerMsg = elapsed / processed
      const etaSec = Math.round((remaining * msPerMsg) / 1000)
      const m = Math.floor(etaSec / 60), sec = etaSec % 60
      document.getElementById('sendingEta').textContent = `~${m > 0 ? m + 'm ' : ''}${sec}s left`
    }
  },

  pauseSending() {
    if (!this.sendingState) return
    this.sendingState.paused = true
    document.getElementById('pauseSendBtn').style.display = 'none'
    document.getElementById('resumeSendBtn').style.display = 'flex'
    document.getElementById('sendingStatus').textContent = 'Paused'
    document.getElementById('sendingTitle').textContent = 'Paused'
    API.updateProgress(this.sendingState.campaignId, { chatId: this.sendingState.chatId, status: 'paused', sentCount: this.sendingState.sent, failedCount: this.sendingState.failed, lastSentIndex: this.sendingState.idx }).catch(() => {})
  },

  resumeSending() {
    if (!this.sendingState) return
    this.sendingState.paused = false
    this.sendingState.startTime = Date.now()
    document.getElementById('pauseSendBtn').style.display = 'flex'
    document.getElementById('resumeSendBtn').style.display = 'none'
    document.getElementById('sendingTitle').textContent = 'Sending...'
    API.updateProgress(this.sendingState.campaignId, { chatId: this.sendingState.chatId, status: 'sending' }).catch(() => {})
    this.sendNext()
  },

  stopSending() {
    if (this.sendingState) {
      this.sendingState.stopped = true
      API.updateProgress(this.sendingState.campaignId, { chatId: this.sendingState.chatId, status: 'paused', sentCount: this.sendingState.sent, failedCount: this.sendingState.failed, lastSentIndex: this.sendingState.idx }).catch(() => {})
    }
    this.sendingState = null
    this.syncData()
    this.showDashboard()
  },

  // ─── Background Service Control Methods ───
  async stopBackgroundSending() {
    if (!window.Capacitor?.Plugins?.DirectSms) return this.stopSending()
    
    try {
      console.log('[SMS] Stopping background service...')
      await window.Capacitor.Plugins.DirectSms.stopBackgroundSending()
      
      // Get final status
      const status = await window.Capacitor.Plugins.DirectSms.getBackgroundStatus()
      console.log('[SMS] Final status:', status)
      
      // Update server with final progress
      if (this.sendingState?.campaignId) {
        await API.updateProgress(this.sendingState.campaignId, {
          chatId: this.sendingState.chatId,
          status: 'paused',
          sentCount: status.sentCount,
          failedCount: status.failedCount,
          lastSentIndex: status.currentIndex
        })
      }
      
      this.toast('SMS sending stopped', 'info')
      this.sendingState = null
      clearInterval(this._statusPollInterval)
      this.syncData()
      this.showDashboard()
    } catch (e) {
      console.error('[SMS] Failed to stop background service:', e)
      this.stopSending()
    }
  },

  async pauseBackgroundSending() {
    if (!window.Capacitor?.Plugins?.DirectSms) return this.pauseSending()
    
    try {
      console.log('[SMS] Pausing background service...')
      await window.Capacitor.Plugins.DirectSms.pauseBackgroundSending()
      
      document.getElementById('pauseSendBtn').style.display = 'none'
      document.getElementById('resumeSendBtn').style.display = 'flex'
      document.getElementById('resumeSendBtn').onclick = () => this.resumeBackgroundSending()
      document.getElementById('sendingTitle').textContent = 'Paused'
      
      this.toast('SMS sending paused', 'info')
    } catch (e) {
      console.error('[SMS] Failed to pause background service:', e)
      this.pauseSending()
    }
  },

  async resumeBackgroundSending() {
    if (!this.sendingState?.campaignId) return
    
    // Get current status to resume from where it stopped
    try {
      const status = await window.Capacitor.Plugins.DirectSms.getBackgroundStatus()
      const campaign = this.campaigns.find(c => c._id === this.sendingState.campaignId)
      
      if (!campaign) {
        this.toast('Campaign not found', 'error')
        return this.showDashboard()
      }
      
      // Restart the background service from last index
      await window.Capacitor.Plugins.DirectSms.startBackgroundSending({
        campaignId: campaign._id,
        campaignName: campaign.name,
        contacts: JSON.stringify(campaign.contacts),
        content: JSON.stringify(campaign.content),
        gapTimeMs: (campaign.smsGapTime || 5) * 1000,
        startIndex: status.currentIndex || 0
      })
      
      document.getElementById('pauseSendBtn').style.display = 'flex'
      document.getElementById('resumeSendBtn').style.display = 'none'
      document.getElementById('sendingTitle').textContent = campaign.name
      
      this.pollBackgroundStatus()
      this.toast('SMS sending resumed', 'success')
    } catch (e) {
      console.error('[SMS] Failed to resume background service:', e)
      this.toast('Failed to resume sending', 'error')
    }
  },

  async pollBackgroundStatus() {
    if (!window.Capacitor?.Plugins?.DirectSms) return
    
    clearInterval(this._statusPollInterval)
    
    this._statusPollInterval = setInterval(async () => {
      try {
        const status = await window.Capacitor.Plugins.DirectSms.getBackgroundStatus()
        console.log('[SMS] Background status:', status)
        
        if (!this.sendingState) return clearInterval(this._statusPollInterval)
        
        // Update UI with native service progress
        if (this.sendingState.usingBackgroundService) {
          this.sendingState.idx = status.currentIndex || 0
          this.sendingState.sent = status.sentCount || 0
          this.sendingState.failed = status.failedCount || 0
          // Sync total from native service to avoid stale JS-side value
          if (status.totalContacts && status.totalContacts > 0) {
            this.sendingState.total = status.totalContacts
          }
          
          // Update sending screen UI (clamp values to valid ranges)
          const rawPct = this.sendingState.total > 0 ? Math.round((this.sendingState.idx / this.sendingState.total) * 100) : 0
          const pct = Math.min(100, Math.max(0, rawPct))
          const circ = 2 * Math.PI * 78
          document.getElementById('progressCircle')?.setAttribute('stroke-dashoffset', circ - (pct / 100) * circ)
          document.getElementById('sendingPercent').textContent = pct + '%'
          document.getElementById('sendingSent').textContent = this.sendingState.sent
          document.getElementById('sendingFailed').textContent = this.sendingState.failed
          document.getElementById('sendingRemaining').textContent = Math.max(0, this.sendingState.total - this.sendingState.idx)
          
          // Check if completed
          if (status.status === 'completed' || this.sendingState.idx >= this.sendingState.total) {
            console.log('[SMS] Background service completed!')
            clearInterval(this._statusPollInterval)
            
            // Update server and check trial balance
            try {
              const progressRes = await API.updateProgress(this.sendingState.campaignId, {
                chatId: this.sendingState.chatId,
                status: 'completed',
                sentCount: this.sendingState.sent,
                failedCount: this.sendingState.failed,
                lastSentIndex: this.sendingState.idx
              })
              // Refresh user data after completion
              if (progressRes) {
                const user = Storage.getUser() || {}
                if (progressRes.freeSmsRemaining !== undefined) {
                  user.freeSmsRemaining = progressRes.freeSmsRemaining
                  user.canUseSms = progressRes.canUseSms
                  if (!progressRes.canUseSms) user.isFreeTrial = false
                  Storage.setUser(user)
                }
              }
            } catch (e) {
              console.warn('[SMS] Failed to update final progress:', e.message)
            }
            
            document.getElementById('sendingTitle').textContent = 'Complete!'
            document.getElementById('sendingStatus').textContent = 
              `✅ Sent ${this.sendingState.sent} messages` + 
              (this.sendingState.failed > 0 ? `, ${this.sendingState.failed} failed` : '')
            
            setTimeout(() => {
              this.sendingState = null
              this.syncData()
              this.showDashboard()
            }, 3000)
          } else {
            // Mid-campaign: periodically sync progress to server every ~10 messages
            const lastSynced = this.sendingState._lastSyncIdx || 0
            if (this.sendingState.idx - lastSynced >= 5) {
              this.sendingState._lastSyncIdx = this.sendingState.idx
              try {
                const progressRes = await API.updateProgress(this.sendingState.campaignId, {
                  chatId: this.sendingState.chatId,
                  sentCount: this.sendingState.sent,
                  failedCount: this.sendingState.failed,
                  lastSentIndex: this.sendingState.idx,
                  status: 'sending'
                })
                // Check if trial exhausted mid-campaign
                if (progressRes && progressRes.canUseSms === false) {
                  console.warn('[SMS] Trial exhausted during background send — stopping service')
                  clearInterval(this._statusPollInterval)
                  try { await window.Capacitor.Plugins.DirectSms.stopBackgroundSending() } catch (e) { /* ok */ }
                  this.showSubscriptionModal()
                  document.getElementById('sendingTitle').textContent = 'Trial Limit Reached'
                  document.getElementById('sendingStatus').textContent = `Sent ${this.sendingState.sent} messages. Subscribe to continue.`
                  setTimeout(() => {
                    this.sendingState = null
                    this.syncData()
                    this.showDashboard()
                  }, 5000)
                }
              } catch (e) {
                if (e.message && (e.message.includes('subscription') || e.message.includes('403'))) {
                  clearInterval(this._statusPollInterval)
                  try { await window.Capacitor.Plugins.DirectSms.stopBackgroundSending() } catch (e2) { /* ok */ }
                  this.showSubscriptionModal()
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('[SMS] Failed to poll background status:', e)
      }
    }, 2000) // Poll every 2 seconds
  },

  showDevicesScreen() {
    this.syncDevices()
    this.showScreen('devicesScreen')
  },

  async syncDevices() {
    const code = Storage.getCode()
    if (!code) return
    
    try {
      const data = await API.sync(code, this.getAppVersion())
      if (data.user && data.user.devices) {
        this.renderDevices(data.user.devices)
      }
    } catch (e) {
      console.error('[Devices] Sync error:', e)
      this.toast('Failed to load devices', 'error')
    }
  },

  renderDevices(devices) {
    const container = document.getElementById('devicesList')
    const currentDeviceId = this.getDeviceId()
    
    if (!devices || devices.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p style="color: var(--text-muted);">No devices connected</p>
        </div>`
      return
    }

    container.innerHTML = devices.map((d, idx) => {
      const isCurrent = d.deviceId === currentDeviceId
      const deviceName = d.deviceName || `Device ${idx + 1}`
      const lastActive = d.lastActive ? new Date(d.lastActive).toLocaleString() : 'Never'
      
      return `
        <div class="device-card" data-device-id="${d.deviceId}">
          <div class="device-info">
            <div class="device-name-row">
              <span class="device-name" onclick="App.renameDevice('${d.deviceId}', '${deviceName.replace(/'/g, "\\'")}')">${deviceName}</span>
              ${isCurrent ? '<span class="device-badge">This Device</span>' : ''}
            </div>
            <div class="device-meta">
              <span class="device-id">${d.deviceId}</span>
              <span class="device-time">Last active: ${lastActive}</span>
            </div>
          </div>
          ${!isCurrent ? `<button class="btn-icon-danger" onclick="App.logoutDevice('${d.deviceId}')" title="Logout this device">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
            </svg>
          </button>` : ''}
        </div>`
    }).join('')
  },

  renameDevice(deviceId, currentName) {
    const newName = prompt('Enter new device name:', currentName)
    if (!newName || newName === currentName) return
    
    const code = Storage.getCode()
    API.updateDeviceName(code, deviceId, newName)
      .then(() => {
        this.toast('Device renamed!', 'success')
        this.syncDevices()
      })
      .catch(err => {
        console.error('[Devices] Rename error:', err)
        this.toast('Failed to rename device', 'error')
      })
  },

  logoutDevice(deviceId) {
    if (!confirm('Logout this device? It will need to login again.')) return
    
    const code = Storage.getCode()
    API.request('POST', `sms-app/logout/${code}`, { deviceId })
      .then(() => {
        this.toast('Device logged out', 'success')
        this.syncDevices()
      })
      .catch(err => {
        console.error('[Devices] Logout error:', err)
        this.toast('Failed to logout device', 'error')
      })
  },
}

function esc(s) {
  if (!s) return ''
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML
}

document.addEventListener('DOMContentLoaded', () => App.init())
