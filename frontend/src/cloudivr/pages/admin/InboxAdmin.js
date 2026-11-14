import React, { useEffect, useState, useCallback } from 'react';
import { Mail, MailOpen, Star, Archive, Trash2, Reply, Search, ArrowLeft, Paperclip, RefreshCw, Download } from 'lucide-react';
import { api } from '../../api';

const fmt = (d) => { const dt = new Date(d); return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }); };
const trunc = (s, n = 120) => (s || '').length > n ? s.slice(0, n) + '…' : s || '';

export default function InboxAdmin() {
  const [emails, setEmails] = useState([]);
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [search, setSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [replying, setReplying] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (showArchived) params.set('archived', 'true');
      if (search) params.set('search', search);
      const d = await api(`/admin/inbox?${params}`);
      setEmails(d.items || []);
      setUnread(d.unread || 0);
      setTotal(d.total || 0);
    } catch (e) { console.error('inbox load:', e); }
    setLoading(false);
  }, [showArchived, search]);

  useEffect(() => { load(); }, [load]);

  const openEmail = async (id) => {
    setSelected(id);
    setReplyOpen(false);
    setReplyText('');
    try {
      const d = await api(`/admin/inbox/${id}`);
      setDetail(d);
      // Update list to show as read
      setEmails(prev => prev.map(e => e._id === id ? { ...e, read: true } : e));
      setUnread(prev => Math.max(0, prev - (emails.find(e => e._id === id && !e.read) ? 1 : 0)));
    } catch (e) { console.error('open email:', e); }
  };

  const toggleStar = async (id, e) => {
    e?.stopPropagation();
    const em = emails.find(x => x._id === id);
    const starred = !em?.starred;
    await api(`/admin/inbox/${id}/star`, { method: 'PUT', body: JSON.stringify({ starred }), headers: { 'Content-Type': 'application/json' } });
    setEmails(prev => prev.map(x => x._id === id ? { ...x, starred } : x));
    if (detail?._id === id) setDetail(prev => ({ ...prev, starred }));
  };

  const archiveEmail = async (id) => {
    await api(`/admin/inbox/${id}/archive`, { method: 'PUT', body: JSON.stringify({ archived: true }), headers: { 'Content-Type': 'application/json' } });
    setEmails(prev => prev.filter(x => x._id !== id));
    if (selected === id) { setSelected(null); setDetail(null); }
  };

  const deleteEmail = async (id) => {
    if (!window.confirm('Delete this email permanently?')) return;
    await api(`/admin/inbox/${id}`, { method: 'DELETE' });
    setEmails(prev => prev.filter(x => x._id !== id));
    if (selected === id) { setSelected(null); setDetail(null); }
  };

  const sendReply = async () => {
    if (!replyText.trim() || !detail) return;
    setReplying(true);
    try {
      await api(`/admin/inbox/${detail._id}/reply`, { method: 'POST', body: JSON.stringify({ text: replyText }), headers: { 'Content-Type': 'application/json' } });
      setReplyOpen(false);
      setReplyText('');
      setDetail(prev => ({ ...prev, replied: true }));
      setEmails(prev => prev.map(e => e._id === detail._id ? { ...e, replied: true } : e));
    } catch (e) { alert('Reply failed: ' + (e.message || 'unknown error')); }
    setReplying(false);
  };

  const downloadAttachment = async (emailId, attachId, filename) => {
    try {
      const d = await api(`/admin/inbox/${emailId}/attachment/${attachId}`);
      if (d.url) window.open(d.url, '_blank');
    } catch (e) { alert('Download failed'); }
  };

  // ── Detail view ──
  if (selected && detail) {
    return (
      <div data-testid="inbox-detail">
        <button onClick={() => { setSelected(null); setDetail(null); }} className="flex items-center gap-2 text-sm text-[#a1a1aa] hover:text-white mb-4 transition-colors" data-testid="inbox-back">
          <ArrowLeft className="w-4 h-4" /> Back to inbox
        </button>
        <div className="bg-[#141414] border border-[#1f1f1f] rounded-xl overflow-hidden">
          <div className="p-6 border-b border-[#1f1f1f]">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-white truncate" data-testid="inbox-detail-subject">{detail.subject}</h2>
                <p className="text-sm text-[#a1a1aa] mt-1">From: <span className="text-[#c7d2fe]">{detail.from}</span></p>
                <p className="text-sm text-[#a1a1aa]">To: {(detail.to || []).join(', ')}</p>
                <p className="text-xs text-[#71717a] mt-1">{fmt(detail.receivedAt)}</p>
              </div>
              <div className="flex gap-2 shrink-0">
                <button onClick={() => toggleStar(detail._id)} className={`p-2 rounded-lg transition-colors ${detail.starred ? 'text-yellow-400' : 'text-[#71717a] hover:text-white'}`} data-testid="inbox-detail-star"><Star className="w-4 h-4" fill={detail.starred ? 'currentColor' : 'none'} /></button>
                <button onClick={() => archiveEmail(detail._id)} className="p-2 rounded-lg text-[#71717a] hover:text-white transition-colors" data-testid="inbox-detail-archive"><Archive className="w-4 h-4" /></button>
                <button onClick={() => deleteEmail(detail._id)} className="p-2 rounded-lg text-[#71717a] hover:text-red-400 transition-colors" data-testid="inbox-detail-delete"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
          {/* Attachments */}
          {detail.attachments?.length > 0 && (
            <div className="px-6 py-3 border-b border-[#1f1f1f] flex flex-wrap gap-2">
              {detail.attachments.map(a => (
                <button key={a.id} onClick={() => downloadAttachment(detail._id, a.id, a.filename)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#1a1a2e] rounded-lg text-xs text-[#c7d2fe] hover:bg-[#25254a] transition-colors" data-testid={`inbox-attachment-${a.id}`}>
                  <Download className="w-3 h-3" />{a.filename} <span className="text-[#71717a]">({Math.round((a.size || 0) / 1024)}KB)</span>
                </button>
              ))}
            </div>
          )}
          {/* Body */}
          <div className="p-6">
            {detail.html ? (
              <div className="prose prose-invert prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: detail.html }} data-testid="inbox-detail-body" />
            ) : (
              <pre className="text-sm text-[#d4d4d8] whitespace-pre-wrap font-sans" data-testid="inbox-detail-body">{detail.text}</pre>
            )}
          </div>
          {/* Reply */}
          <div className="border-t border-[#1f1f1f] p-6">
            {!replyOpen ? (
              <button onClick={() => setReplyOpen(true)} className="flex items-center gap-2 px-4 py-2 bg-[#818cf8]/15 text-[#c7d2fe] rounded-lg hover:bg-[#818cf8]/25 transition-colors text-sm" data-testid="inbox-reply-btn">
                <Reply className="w-4 h-4" /> Reply
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-[#71717a]">Replying to {detail.from}</p>
                <textarea
                  value={replyText}
                  onChange={e => setReplyText(e.target.value)}
                  placeholder="Type your reply..."
                  className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-lg p-3 text-sm text-white placeholder-[#71717a] resize-y min-h-[100px] focus:outline-none focus:border-[#818cf8]/50"
                  data-testid="inbox-reply-textarea"
                  autoFocus
                />
                <div className="flex gap-2">
                  <button onClick={sendReply} disabled={replying || !replyText.trim()} className="px-4 py-2 bg-[#818cf8] text-white rounded-lg text-sm hover:bg-[#6366f1] disabled:opacity-50 transition-colors" data-testid="inbox-reply-send">
                    {replying ? 'Sending...' : 'Send reply'}
                  </button>
                  <button onClick={() => { setReplyOpen(false); setReplyText(''); }} className="px-4 py-2 text-[#a1a1aa] hover:text-white text-sm transition-colors" data-testid="inbox-reply-cancel">Cancel</button>
                </div>
              </div>
            )}
            {detail.replied && <p className="text-xs text-green-400/70 mt-2">Replied {detail.repliedAt ? fmt(detail.repliedAt) : ''}</p>}
          </div>
        </div>
      </div>
    );
  }

  // ── List view ──
  return (
    <div data-testid="inbox-admin">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#71717a]" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search emails..."
            className="w-full bg-[#141414] border border-[#1f1f1f] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-[#71717a] focus:outline-none focus:border-[#818cf8]/50"
            data-testid="inbox-search"
          />
        </div>
        <button onClick={() => setShowArchived(!showArchived)} className={`px-3 py-2 rounded-lg text-sm transition-colors ${showArchived ? 'bg-[#818cf8]/15 text-[#c7d2fe]' : 'text-[#a1a1aa] hover:text-white'}`} data-testid="inbox-toggle-archived">
          <Archive className="w-4 h-4 inline mr-1" />{showArchived ? 'Archived' : 'Archive'}
        </button>
        <button onClick={load} className="p-2 rounded-lg text-[#a1a1aa] hover:text-white transition-colors" data-testid="inbox-refresh">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <span className="text-xs text-[#71717a]">{unread} unread · {total} total</span>
      </div>

      {loading && !emails.length ? (
        <div className="text-center text-[#71717a] py-12">Loading...</div>
      ) : !emails.length ? (
        <div className="text-center text-[#71717a] py-12">
          <Mail className="w-8 h-8 mx-auto mb-2 opacity-50" />
          {showArchived ? 'No archived emails' : 'Inbox empty'}
        </div>
      ) : (
        <div className="bg-[#141414] border border-[#1f1f1f] rounded-xl divide-y divide-[#1f1f1f] overflow-hidden">
          {emails.map(em => (
            <div
              key={em._id}
              onClick={() => openEmail(em._id)}
              className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-[#1a1a2e] ${!em.read ? 'bg-[#0f0f1a]' : ''}`}
              data-testid={`inbox-row-${em._id}`}
            >
              <button onClick={e => toggleStar(em._id, e)} className={`shrink-0 ${em.starred ? 'text-yellow-400' : 'text-[#3f3f46] hover:text-[#71717a]'}`}>
                <Star className="w-4 h-4" fill={em.starred ? 'currentColor' : 'none'} />
              </button>
              {em.read ? <MailOpen className="w-4 h-4 text-[#71717a] shrink-0" /> : <Mail className="w-4 h-4 text-[#818cf8] shrink-0" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm truncate ${em.read ? 'text-[#a1a1aa]' : 'text-white font-medium'}`}>{em.from}</span>
                  {em.attachments?.length > 0 && <Paperclip className="w-3 h-3 text-[#71717a] shrink-0" />}
                  {em.replied && <Reply className="w-3 h-3 text-green-400/60 shrink-0" />}
                </div>
                <p className={`text-sm truncate ${em.read ? 'text-[#71717a]' : 'text-[#d4d4d8]'}`}>{em.subject}</p>
                <p className="text-xs text-[#52525b] truncate">{trunc(em.text, 80)}</p>
              </div>
              <span className="text-xs text-[#52525b] shrink-0 whitespace-nowrap">{fmt(em.receivedAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
