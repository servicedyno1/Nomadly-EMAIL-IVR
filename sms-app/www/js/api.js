/**
 * SMS App — API Client (brand-aware, see brand.js)
 *
 * API base resolution (native APK):
 *   1. The brand's OWN baked server (`BRAND.apiBase`, e.g. 2.speechcue.com /
 *      1.smadavspeech.com) — probed via GET /sms-app/config. Used whenever reachable.
 *   2. Backup only: the Cloudflare discovery Worker, reading `brands[<slug>]` (never
 *      another brand's server). Used only if the baked server is unreachable.
 *   3. Neither reachable → clean "Cannot reach <Brand> servers" error; next action retries.
 * In a browser (dev/preview) the same-origin `/api` prefix is used.
 */

class APIError extends Error {
  constructor(message, status, type, detail) {
    super(message)
    this.name = 'APIError'
    this.status = status
    this.type = type // 'network' | 'timeout' | 'http' | 'parse'
    this.detail = detail
  }
}

const API = {
  // Backup-only discovery Worker (brand-keyed). Source: /app/ops/nomadly-api-config-worker.js
  discoveryUrl: 'https://nomadly-api-config.nomadly-cfg.workers.dev/',

  _resolvedBase: null,
  _configFetchPromise: null,

  // For in-browser development only.
  get devFallbackUrl() {
    return `${window.location.origin}/api`
  },

  // Effective backend base URL (see header). Memoised once resolved; failures are retried.
  async baseUrl() {
    if (this._resolvedBase) return this._resolvedBase
    if (!this._configFetchPromise) {
      this._configFetchPromise = (async () => {
        const isNative = window.Capacitor?.isNativePlatform?.()

        // Browser dev mode — skip discovery, use relative /api
        if (!isNative) return this.devFallbackUrl

        // Native APK — the brand's own baked server FIRST (never depends on Cloudflare).
        const brand = window.BRAND || {}
        const slug = brand.slug || 'nomadly'
        const baked = (brand.apiBase || '').replace(/\/+$/, '')
        if (baked && await this._reachable(baked)) {
          console.log(`[API] Using baked apiBase for ${slug}:`, baked)
          return baked
        }

        // Backup: the discovery Worker, reading ONLY this brand's entry (`brands[slug]`).
        const discovered = await this._discover(slug)
        if (discovered && discovered !== baked && await this._reachable(discovered)) {
          console.warn(`[API] Baked apiBase unreachable — using discovered backup for ${slug}:`, discovered)
          return discovered
        }
        throw new APIError(`Cannot reach ${brand.name || 'Nomadly'} servers. Check your connection and try again.`, 0, 'network', 'server_unreachable')
      })()
      // If discovery fails, DO NOT permanently memoize the failure —
      // clear the in-flight promise so a future retry re-runs discovery.
      this._configFetchPromise.catch(() => {
        this._configFetchPromise = null
      })
    }
    this._resolvedBase = await this._configFetchPromise
    return this._resolvedBase
  },

  // Quick liveness probe: any HTTP answer from <base>/sms-app/config = reachable.
  async _reachable(base, timeoutMs = 6000) {
    for (let i = 0; i < 2; i++) {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), timeoutMs)
      try {
        const r = await fetch(`${base}/sms-app/config`, { signal: ctl.signal, cache: 'no-cache' })
        if (r.status < 500) return true
      } catch (e) {
        console.warn(`[API] Probe ${i + 1} failed for ${base}:`, e.message)
      } finally {
        clearTimeout(t)
      }
      if (i === 0) await new Promise(r => setTimeout(r, 1500))
    }
    return false
  },

  // Brand-keyed discovery (v2 `brands[slug]`); a v1 payload is honoured only by nomadly.
  async _discover(slug) {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 5000)
    try {
      const sep = this.discoveryUrl.includes('?') ? '&' : '?'
      const r = await fetch(`${this.discoveryUrl}${sep}brand=${encodeURIComponent(slug)}`, { signal: ctl.signal, cache: 'no-cache' })
      if (!r.ok) return ''
      const cfg = await r.json()
      const fromBrands = cfg?.brands && typeof cfg.brands[slug] === 'string' ? cfg.brands[slug].trim() : ''
      const legacy = !cfg?.brands && slug === 'nomadly' && typeof cfg?.apiBase === 'string' ? cfg.apiBase.trim() : ''
      return (fromBrands || legacy).replace(/\/+$/, '')
    } catch (e) {
      console.warn('[API] Discovery failed:', e.message)
      return ''
    } finally {
      clearTimeout(t)
    }
  },

  async request(method, path, body = null) {
    const base = await this.baseUrl()
    const url = `${base}/${path}`
    const options = { method, headers: { 'Content-Type': 'application/json' } }
    if (body) options.body = JSON.stringify(body)

    console.log(`[API] ${method} ${url}`)
    let response
    // Hard timeout so a slow/hung network can NEVER leave the UI stuck (e.g. the
    // login "Connect" button spinning forever with a disabled state). Without
    // this, fetch() has no client-side timeout and the login() finally-block
    // that re-enables the button would never run. (Nomadly report 2026-08-07:
    // "sign in button is inactive / doesn't work".)
    const REQUEST_TIMEOUT_MS = 20000
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS)
    options.signal = ctl.signal
    try {
      response = await fetch(url, options)
    } catch (e) {
      // Fetch-level failure = DNS, TLS, offline, or our abort timeout. Never the server.
      const aborted = e && e.name === 'AbortError'
      console.error(`[API] ${aborted ? 'Timeout' : 'Network failure'} for ${url}:`, e.message)
      throw new APIError(
        aborted
          ? 'The server took too long to respond. Check your connection and try again.'
          : 'Cannot reach server. Check your internet connection and try again.',
        0,
        aborted ? 'timeout' : 'network',
        { cause: e.message, url },
      )
    } finally {
      clearTimeout(timer)
    }


    let data
    try {
      data = await response.json()
    } catch (e) {
      throw new APIError(
        `Server returned an unexpected response (HTTP ${response.status}).`,
        response.status,
        'parse',
        { cause: e.message },
      )
    }

    if (!response.ok) {
      // 4xx/5xx = server reached, server chose to reject. data.error usually
      // carries a human-readable reason ("Invalid activation code…", "device
      // limit"…). Surface it directly.
      throw new APIError(
        data.error || `Request failed (HTTP ${response.status})`,
        response.status,
        'http',
        data,
      )
    }

    return data
  },

  // Auth
  async authenticate(code) {
    const deviceId = Storage.getDeviceId()
    return this.request('GET', `sms-app/auth/${code}?deviceId=${encodeURIComponent(deviceId)}`)
  },

  async logout(code) {
    const deviceId = Storage.getDeviceId()
    return this.request('POST', `sms-app/logout/${code}?deviceId=${encodeURIComponent(deviceId)}`)
  },

  async getPlan(code) {
    return this.request('GET', `sms-app/plan/${code}`)
  },

  // Campaigns
  async getCampaigns(chatId) {
    return this.request('GET', `sms-app/campaigns/${chatId}`)
  },

  async createCampaign(data) {
    return this.request('POST', 'sms-app/campaigns', data)
  },

  async updateCampaign(campaignId, data) {
    return this.request('PUT', `sms-app/campaigns/${campaignId}`, data)
  },

  async deleteCampaign(campaignId, chatId) {
    return this.request('DELETE', `sms-app/campaigns/${campaignId}?chatId=${chatId}`)
  },

  async updateProgress(campaignId, data) {
    return this.request('PUT', `sms-app/campaigns/${campaignId}/progress`, data)
  },

  async reportSmsSent(chatId) {
    return this.request('POST', `sms-app/sms-sent/${chatId}`)
  },

  async reportSmsErrors(chatId, campaignId, errors) {
    return this.request('POST', `sms-app/report-errors/${chatId}`, { campaignId, errors })
  },

  // Test SMS diagnostic log — server tracks per-carrier success/failure rates
  async reportTestSms(chatId, data) {
    return this.request('POST', `sms-app/test-log/${chatId}`, data)
  },

  // Carrier success-rate stats for pre-send campaign precheck
  async getCarrierStats(prefixes) {
    const q = encodeURIComponent((prefixes || []).join(','))
    return this.request('GET', `sms-app/carrier-stats?prefixes=${q}`)
  },

  // Report detected SIMs so the Telegram bot can manage them
  async reportSims(chatId, sims) {
    return this.request('POST', `sms-app/sims/${chatId}`, { sims })
  },

  // Per-user SMS prefs stored server-side (bot can edit them too)
  async getUserPrefs(chatId) {
    return this.request('GET', `sms-app/prefs/${chatId}`)
  },
  async updateUserPrefs(chatId, patch) {
    return this.request('PUT', `sms-app/prefs/${chatId}`, patch)
  },

  // Auto-throttle telemetry — drops/slows per campaign
  async reportThrottleEvent(chatId, data) {
    return this.request('POST', `sms-app/throttle-events/${chatId}`, data)
  },

  updateDeviceName(code, deviceId, deviceName) {
    return this.request('PUT', 'sms-app/device/name', { code, deviceId, deviceName })
  },

  // Full sync
  async sync(chatId, appVersion = (window.BRAND && window.BRAND.version) || 'unknown') {
    return this.request('GET', `sms-app/sync/${chatId}?version=${encodeURIComponent(appVersion)}`)
  },
}
