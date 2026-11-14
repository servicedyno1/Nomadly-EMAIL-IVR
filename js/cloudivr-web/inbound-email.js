'use strict'
// Resend inbound email: webhook receives email.received events, fetches full content, stores in MongoDB.
// Admin API: list, read, reply from the admin dashboard.
const axios = require('axios')
const log = (...a) => console.log('[InboundEmail]', ...a)

const RESEND_KEY = () => process.env.RESEND_API_KEY
const COLLECTION = 'inboundEmails'

function createInboundEmail(db) {
  const col = db.collection(COLLECTION)

  // Ensure indexes
  col.createIndex({ receivedAt: -1 }).catch(() => {})
  col.createIndex({ from: 1 }).catch(() => {})
  col.createIndex({ read: 1 }).catch(() => {})

  // ── Fetch full email content from Resend ──
  async function fetchEmailContent(emailId) {
    try {
      const r = await axios.get(`https://api.resend.com/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${RESEND_KEY()}` },
        timeout: 15000
      })
      return r.data
    } catch (e) {
      log('fetchEmailContent failed:', emailId, e.response?.status, e.response?.data?.message || e.message)
      return null
    }
  }

  // ── Fetch attachments list ──
  async function fetchAttachments(emailId) {
    try {
      const r = await axios.get(`https://api.resend.com/emails/receiving/${emailId}/attachments`, {
        headers: { Authorization: `Bearer ${RESEND_KEY()}` },
        timeout: 10000
      })
      return r.data?.data || []
    } catch (e) {
      log('fetchAttachments failed:', emailId, e.message)
      return []
    }
  }

  // ── Webhook handler (POST /cloudivr-web/email-inbound/webhook) ──
  async function handleWebhook(req, res) {
    // Acknowledge immediately (Resend expects fast response)
    res.status(200).json({ ok: true })

    try {
      const event = req.body
      if (!event?.type || event.type !== 'email.received') return
      const data = event.data
      if (!data?.email_id) return

      log('Received email:', data.email_id, 'from:', data.from, 'to:', data.to, 'subject:', data.subject)

      // Check for duplicate
      const exists = await col.findOne({ resendEmailId: data.email_id })
      if (exists) { log('Duplicate:', data.email_id); return }

      // Fetch full email content
      const full = await fetchEmailContent(data.email_id)
      const attachments = await fetchAttachments(data.email_id)

      const doc = {
        resendEmailId: data.email_id,
        from: data.from || 'unknown',
        to: Array.isArray(data.to) ? data.to : [data.to || ''],
        cc: data.cc || [],
        subject: data.subject || '(no subject)',
        text: full?.text || '',
        html: full?.html || '',
        headers: full?.headers || {},
        attachments: attachments.map(a => ({
          id: a.id,
          filename: a.filename,
          contentType: a.content_type,
          size: a.size
        })),
        read: false,
        starred: false,
        archived: false,
        replied: false,
        receivedAt: new Date(data.created_at || Date.now()),
        storedAt: new Date()
      }

      await col.insertOne(doc)
      log('Stored email:', data.email_id, 'subject:', doc.subject)
    } catch (e) {
      log('Webhook processing error:', e.message)
    }
  }

  // ── Admin API routes ──
  function routes(r, h, A) {
    // Webhook — no auth (Resend calls this)
    r.post('/email-inbound/webhook', (req, res) => handleWebhook(req, res))

    // Admin: list emails
    r.get('/admin/inbox', A, h(async (req, res) => {
      const { archived, starred, search, skip = 0, limit = 50 } = req.query
      const filter = {}
      if (archived === 'true') filter.archived = true
      else filter.archived = { $ne: true }
      if (starred === 'true') filter.starred = true
      if (search) {
        const re = new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
        filter.$or = [{ from: re }, { subject: re }, { text: re }]
      }
      const items = await col.find(filter)
        .sort({ receivedAt: -1 })
        .skip(Number(skip) || 0)
        .limit(Math.min(Number(limit) || 50, 100))
        .project({ html: 0 })
        .toArray()
      const unread = await col.countDocuments({ read: false, archived: { $ne: true } })
      const total = await col.countDocuments(filter)
      res.json({ items, unread, total })
    }))

    // Admin: get single email (full content)
    r.get('/admin/inbox/:id', A, h(async (req, res) => {
      const { ObjectId } = require('mongodb')
      let oid
      try { oid = new ObjectId(req.params.id) } catch { return res.status(400).json({ error: 'invalid_id' }) }
      const doc = await col.findOne({ _id: oid })
      if (!doc) return res.status(404).json({ error: 'not_found' })
      // Mark as read
      if (!doc.read) await col.updateOne({ _id: oid }, { $set: { read: true } })
      doc.read = true
      res.json(doc)
    }))

    // Admin: mark read/unread
    r.put('/admin/inbox/:id/read', A, h(async (req, res) => {
      const { ObjectId } = require('mongodb')
      let oid
      try { oid = new ObjectId(req.params.id) } catch { return res.status(400).json({ error: 'invalid_id' }) }
      const read = req.body?.read !== false
      await col.updateOne({ _id: oid }, { $set: { read } })
      res.json({ ok: true, read })
    }))

    // Admin: star/unstar
    r.put('/admin/inbox/:id/star', A, h(async (req, res) => {
      const { ObjectId } = require('mongodb')
      let oid
      try { oid = new ObjectId(req.params.id) } catch { return res.status(400).json({ error: 'invalid_id' }) }
      const starred = req.body?.starred !== false
      await col.updateOne({ _id: oid }, { $set: { starred } })
      res.json({ ok: true, starred })
    }))

    // Admin: archive/unarchive
    r.put('/admin/inbox/:id/archive', A, h(async (req, res) => {
      const { ObjectId } = require('mongodb')
      let oid
      try { oid = new ObjectId(req.params.id) } catch { return res.status(400).json({ error: 'invalid_id' }) }
      const archived = req.body?.archived !== false
      await col.updateOne({ _id: oid }, { $set: { archived } })
      res.json({ ok: true, archived })
    }))

    // Admin: reply to email
    r.post('/admin/inbox/:id/reply', A, h(async (req, res) => {
      const { ObjectId } = require('mongodb')
      let oid
      try { oid = new ObjectId(req.params.id) } catch { return res.status(400).json({ error: 'invalid_id' }) }
      const doc = await col.findOne({ _id: oid })
      if (!doc) return res.status(404).json({ error: 'not_found' })
      const { text, html: replyHtml } = req.body || {}
      if (!text && !replyHtml) return res.status(400).json({ error: 'empty_reply' })

      // Send reply via Resend
      const replyTo = doc.from
      const subject = doc.subject.startsWith('Re:') ? doc.subject : `Re: ${doc.subject}`
      const fromAddr = Array.isArray(doc.to) ? doc.to[0] : doc.to
      try {
        const r2 = await axios.post('https://api.resend.com/emails', {
          from: fromAddr || 'richard@cloudivr.net',
          to: [replyTo],
          subject,
          text: text || undefined,
          html: replyHtml || undefined,
          headers: doc.resendEmailId ? { 'In-Reply-To': `<${doc.resendEmailId}>` } : undefined
        }, {
          headers: { Authorization: `Bearer ${RESEND_KEY()}`, 'Content-Type': 'application/json' },
          timeout: 15000
        })
        await col.updateOne({ _id: oid }, { $set: { replied: true, repliedAt: new Date() } })
        log('Reply sent to:', replyTo, 'resendId:', r2.data?.id)
        res.json({ ok: true, id: r2.data?.id })
      } catch (e) {
        log('Reply failed:', e.response?.data || e.message)
        res.status(500).json({ error: 'send_failed', message: e.response?.data?.message || e.message })
      }
    }))

    // Admin: delete email
    r.delete('/admin/inbox/:id', A, h(async (req, res) => {
      const { ObjectId } = require('mongodb')
      let oid
      try { oid = new ObjectId(req.params.id) } catch { return res.status(400).json({ error: 'invalid_id' }) }
      await col.deleteOne({ _id: oid })
      res.json({ ok: true })
    }))

    // Admin: get attachment download URL
    r.get('/admin/inbox/:id/attachment/:attachId', A, h(async (req, res) => {
      try {
        const { ObjectId } = require('mongodb')
        let oid
        try { oid = new ObjectId(req.params.id) } catch { return res.status(400).json({ error: 'invalid_id' }) }
        const doc = await col.findOne({ _id: oid })
        if (!doc) return res.status(404).json({ error: 'not_found' })
        const r2 = await axios.get(
          `https://api.resend.com/emails/receiving/${doc.resendEmailId}/attachments/${req.params.attachId}`,
          { headers: { Authorization: `Bearer ${RESEND_KEY()}` }, timeout: 10000 }
        )
        res.json({ url: r2.data?.download_url || null, filename: r2.data?.filename })
      } catch (e) {
        res.status(500).json({ error: 'fetch_failed', message: e.message })
      }
    }))
  }

  return { routes, handleWebhook }
}

module.exports = { createInboundEmail }
