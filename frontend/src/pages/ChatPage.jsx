/* ===============================================================================
   BAKAL — General Assistant (first sidebar tab)
   Answers questions about the user's CRM (via lookup_client), explains how Baakalai
   works, and gives sales/CRM advice. Never creates or edits a campaign itself — that
   now lives in the relocated assistant under the Campagnes tab
   (components/campaigns/CampaignAssistant.jsx). Shares message/thread-list rendering
   with that assistant via components/chat/ChatPrimitives.jsx.
   =============================================================================== */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/useApp';
import { useSocket } from '../context/SocketContext';
import api, { request } from '../services/api-client';
import { useT, useI18n } from '../i18n';
import { formatMarkdown, TypingIndicator, ThreadList, InlineSuggestions, ChatMessage } from '../components/chat/ChatPrimitives';

const STATUS_LABELS = {
  new: { fr: 'Nouveau', en: 'New' },
  imported: { fr: 'Importé', en: 'Imported' },
  interested: { fr: 'Intéressé', en: 'Interested' },
  meeting: { fr: 'RDV', en: 'Meeting' },
  negotiation: { fr: 'Négociation', en: 'Negotiation' },
  won: { fr: 'Gagné', en: 'Won' },
  lost: { fr: 'Perdu', en: 'Lost' },
};

function getExamplePrompts(lang) {
  return lang === 'en'
    ? ['👤 What\'s the status of my client Marc?', '❓ How does churn scoring work?', '💡 Advice on launching a campaign in fintech']
    : ['👤 Quel est le statut de mon client Marc ?', '❓ Comment fonctionne le score de churn ?', '💡 Des conseils pour lancer une campagne dans la fintech'];
}

/* ─── lookup_client action card — auto-fetch on mount, no confirm click (read-only) ─── */

function ClientResultRow({ client, lang, t }) {
  const en = lang === 'en';
  const statusLabel = STATUS_LABELS[client.status]?.[en ? 'en' : 'fr'] || client.status || '—';
  const lastActivity = client.last_activity_at
    ? new Date(client.last_activity_at).toLocaleDateString(en ? 'en-US' : 'fr-FR')
    : (en ? 'no logged activity' : 'aucune activité enregistrée');

  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{client.name || client.email || '—'}</div>
          {client.company && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{client.company}</div>}
        </div>
        <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, background: 'var(--accent-glow)', color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {statusLabel}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {client.status === 'won' && client.churn_score != null && (
          <div>{en ? 'Churn risk' : 'Risque de churn'} : <strong>{client.churn_score}/100</strong></div>
        )}
        {client.deal_value != null && (
          <div>{en ? 'Deal value' : 'Valeur du deal'} : <strong>{Math.round(client.deal_value).toLocaleString(en ? 'en-US' : 'fr-FR')} €</strong></div>
        )}
        <div>{en ? 'Last activity' : 'Dernière activité'} : {lastActivity}</div>
      </div>
    </div>
  );
}

function GeneralActionCard({ metadata }) {
  const { lang } = useI18n();
  const t = useT();
  const navigate = useNavigate();
  const en = lang === 'en';
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (metadata?.action !== 'lookup_client' || !metadata.query) return;
    setLoading(true);
    setSelected(null);
    setError(null);
    request(`/crm/client/search?q=${encodeURIComponent(metadata.query)}`)
      .then(data => setResults(data.clients || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [metadata]);

  // Création de campagne : l'assistant général ne la fait pas lui-même — bouton
  // de bascule vers l'assistant de l'onglet Campagnes, brief pré-rempli.
  if (metadata?.action === 'open_campaign_assistant') {
    return (
      <div style={{ marginTop: 8 }}>
        <button
          className="btn btn-primary"
          style={{ fontSize: 12, padding: '8px 16px' }}
          onClick={() => navigate('/campaigns', {
            state: { openAssistant: true, prefillMessage: metadata.prompt || undefined },
          })}
        >
          {t('chat.openCampaignAssistant')}
        </button>
      </div>
    );
  }

  if (metadata?.action !== 'lookup_client') return null;

  if (loading) {
    return <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>{en ? 'Searching your CRM data...' : 'Recherche dans vos données CRM...'}</div>;
  }
  if (error) {
    return <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 8 }}>{en ? 'Search failed.' : 'Échec de la recherche.'}</div>;
  }
  if (results.length === 0) {
    return (
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
        {en ? `No client found matching "${metadata.query}" in your synced data.` : `Aucun client trouvé pour "${metadata.query}" dans vos données synchronisées.`}
      </div>
    );
  }
  if (results.length === 1 || selected) {
    return (
      <div style={{ marginTop: 8 }}>
        <ClientResultRow client={selected || results[0]} lang={lang} t={t} />
      </div>
    );
  }
  // 2+ matches — disambiguation
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {en ? `${results.length} clients match — which one?` : `${results.length} clients correspondent — lequel ?`}
      </div>
      {results.map(c => (
        <button
          key={c.id}
          className="btn btn-ghost"
          style={{ textAlign: 'left', fontSize: 12, padding: '8px 12px', justifyContent: 'flex-start' }}
          onClick={() => setSelected(c)}
        >
          {c.name || c.email}{c.company ? ` — ${c.company}` : ''}
        </button>
      ))}
    </div>
  );
}

/* ─── Main page ─── */

export default function ChatPage() {
  const { backendAvailable } = useApp();
  const { socket } = useSocket();
  const { lang } = useI18n();
  const t = useT();
  const en = lang === 'en';

  const [threads, setThreads] = useState([]);
  const [currentThreadId, setCurrentThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [streamingContent, setStreamingContent] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const streamedMessageAddedRef = useRef(false);
  const [showTyping, setShowTyping] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [chatSidebarOpen, setChatSidebarOpen] = useState(true);

  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }, 50);
  }, []);

  /* ─── Socket: join/leave thread room ─── */
  useEffect(() => {
    if (!socket || !currentThreadId) return;
    socket.emit('chat:join', currentThreadId);
    return () => socket.emit('chat:leave', currentThreadId);
  }, [socket, currentThreadId]);

  /* ─── Socket: real-time streaming from Claude ─── */
  useEffect(() => {
    if (!socket) return;

    const onChunk = (data) => {
      if (data.threadId === currentThreadId || !currentThreadId) {
        setStreamingContent(prev => prev + data.chunk);
        setIsStreaming(true);
        setShowTyping(false);
        scrollToBottom();
      }
    };

    const onStreamEnd = (data) => {
      setIsStreaming(false);
      if (data && data.fullContent) {
        setMessages(prev => [...prev, {
          id: data.messageId || Date.now(),
          role: 'assistant',
          content: data.fullContent,
          metadata: data.metadata || null,
          animate: false,
        }]);
      }
      setStreamingContent('');
      streamedMessageAddedRef.current = true;
    };

    socket.on('chat:stream', onChunk);
    socket.on('chat:stream-end', onStreamEnd);
    return () => {
      socket.off('chat:stream', onChunk);
      socket.off('chat:stream-end', onStreamEnd);
    };
  }, [socket, currentThreadId, scrollToBottom]);

  const loadThreads = useCallback(async () => {
    if (!backendAvailable) return;
    try {
      const data = await api.request('/chat/threads?assistantType=general');
      setThreads(data.threads || []);
    } catch {
      setThreads([]);
    }
  }, [backendAvailable]);

  useEffect(() => {
    loadThreads();
    if (inputRef.current) inputRef.current.focus();
  }, [loadThreads]);

  const newThread = useCallback(() => {
    setCurrentThreadId(null);
    setMessages([]);
    setShowWelcome(true);
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const selectThread = useCallback(async (threadId) => {
    setCurrentThreadId(threadId);
    setStreamingContent('');
    setIsStreaming(false);
    if (!backendAvailable) return;
    try {
      const data = await api.request('/chat/threads/' + threadId + '/messages');
      const msgs = data.messages || [];
      if (msgs.length === 0) {
        setMessages([]);
        setShowWelcome(true);
      } else {
        setMessages(msgs.map((m) => ({
          id: m.id || Date.now() + Math.random(),
          role: m.role,
          content: m.content,
          metadata: m.metadata ? (typeof m.metadata === 'string' ? (() => { try { return JSON.parse(m.metadata); } catch { return null; } })() : m.metadata) : null,
          animate: false,
        })));
        setShowWelcome(false);
        scrollToBottom();
      }
    } catch (err) {
      console.warn('Failed to load thread messages:', err.message);
    }
  }, [backendAvailable, scrollToBottom]);

  const deleteThread = useCallback(async (threadId, e) => {
    e.stopPropagation();
    if (!backendAvailable) return;
    try {
      await api.request('/chat/threads/' + threadId, { method: 'DELETE' });
      if (currentThreadId === threadId) {
        setCurrentThreadId(null);
        setMessages([]);
        setShowWelcome(true);
      }
      await loadThreads();
    } catch (err) {
      console.warn('Failed to delete thread:', err.message);
    }
  }, [backendAvailable, currentThreadId, loadThreads]);

  const sendMessage = useCallback(async (overrideText) => {
    if (sending) return;
    const text = overrideText || inputValue.trim();
    if (!text) return;

    if (!overrideText) setInputValue('');
    setShowWelcome(false);
    setStreamingContent('');
    setIsStreaming(false);
    streamedMessageAddedRef.current = false;

    let threadId = currentThreadId;
    if (!threadId && backendAvailable) {
      try {
        const thread = await api.request('/chat/threads', {
          method: 'POST',
          body: JSON.stringify({ title: text.slice(0, 60), assistantType: 'general' }),
        });
        threadId = thread.id;
        setCurrentThreadId(threadId);
        loadThreads();
      } catch (err) {
        console.warn('Failed to create thread:', err.message);
      }
    }

    setMessages((prev) => [...prev, { id: Date.now(), role: 'user', content: text, metadata: null, animate: true }]);
    scrollToBottom();
    setShowTyping(true);
    setSending(true);

    if (threadId && backendAvailable) {
      try {
        const data = await api.request('/chat/threads/' + threadId + '/messages', {
          method: 'POST',
          body: JSON.stringify({ message: text }),
        });
        setShowTyping(false);
        if (!streamedMessageAddedRef.current) {
          setMessages((prev) => [...prev, {
            id: data.message.id || Date.now() + 1,
            role: 'assistant',
            content: data.message.content,
            metadata: data.message.metadata,
            animate: false,
          }]);
        }
        setStreamingContent('');
        setIsStreaming(false);
        streamedMessageAddedRef.current = false;
        scrollToBottom();
        loadThreads();
      } catch (err) {
        setShowTyping(false);
        setMessages((prev) => [...prev, {
          id: Date.now() + 1,
          role: 'assistant',
          content: en
            ? 'Sorry, I can\'t respond right now.\n\n`' + err.message + '`'
            : 'Désolé, je ne peux pas répondre pour le moment.\n\n`' + err.message + '`',
          metadata: null,
          animate: true,
        }]);
        scrollToBottom();
      }
    }
    setSending(false);
  }, [sending, inputValue, currentThreadId, backendAvailable, loadThreads, scrollToBottom, en]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const handleInputChange = useCallback((e) => {
    setInputValue(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  const lastAssistantMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const inlineSuggestions = (lastAssistantMsg?.role === 'assistant' && lastAssistantMsg.metadata?.quick_replies)
    ? lastAssistantMsg.metadata.quick_replies.map(qr => typeof qr === 'string' ? qr : (qr.value || qr.label || qr))
    : [];

  return (
    <div className="chat-page">
      {!chatSidebarOpen && (
        <button
          className="chat-sidebar-toggle"
          onClick={() => setChatSidebarOpen(true)}
          style={{ position: 'absolute', left: 8, top: 8, zIndex: 10 }}
          title={en ? 'Open conversations' : 'Ouvrir les conversations'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
      <div className={`chat-sidebar${chatSidebarOpen ? '' : ' collapsed'}`}>
        <div className="chat-sidebar-header">
          <span style={{ fontWeight: 600, fontSize: '14px' }}>{t('assistant.conversations')}</span>
          <button
            className="chat-sidebar-toggle"
            onClick={() => setChatSidebarOpen(false)}
            title={en ? 'Hide conversations' : 'Masquer les conversations'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        </div>
        <ThreadList threads={threads} currentThreadId={currentThreadId} onSelect={selectThread} onDelete={deleteThread} onNew={newThread} />
      </div>

      <div className="chat-main">
        {showWelcome && messages.length === 0 ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>{t('assistant.welcomeTitle')}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 480, marginBottom: 24 }}>{t('assistant.welcomeSubtitle')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 420 }}>
              {getExamplePrompts(lang).map((s) => (
                <button key={s} className="btn btn-ghost" style={{ fontSize: 13, padding: '10px 14px', textAlign: 'left' }} onClick={() => sendMessage(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="chat-messages" id="chatMessages" ref={messagesContainerRef} style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
            <div className="chat-messages-inner" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {messages.map((msg, idx) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  metadata={msg.metadata}
                  animate={msg.animate}
                  isLast={idx === messages.length - 1 && msg.role === 'assistant'}
                  onSendMessage={sendMessage}
                  ActionCardComponent={GeneralActionCard}
                />
              ))}

              {(isStreaming || streamingContent) && streamingContent && (
                <div className="chat-msg assistant" style={{ animation: 'chatFadeIn 0.25s ease' }}>
                  <div className="chat-msg-avatar">b</div>
                  <div className="chat-msg-body">
                    <div
                      className="chat-msg-content"
                      dangerouslySetInnerHTML={{ __html: formatMarkdown(streamingContent.replace(/```json\s*[\s\S]*?```/g, '').trim()) }}
                    />
                  </div>
                </div>
              )}

              {showTyping && !isStreaming && !streamingContent && <TypingIndicator />}

              {!showTyping && !isStreaming && !streamingContent && messages.length > 0 && (
                <InlineSuggestions suggestions={inlineSuggestions} onSend={sendMessage} />
              )}
            </div>
          </div>
        )}

        <div className="chat-input-bar" style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={en ? 'Ask about a client, a feature, or get advice...' : 'Posez une question sur un client, une fonctionnalité, ou demandez conseil...'}
            rows={1}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1, resize: 'none', border: '1px solid var(--border)', borderRadius: '10px',
              padding: '10px 14px', fontSize: '13px', lineHeight: '1.5',
              background: 'var(--bg-elevated)', color: 'var(--text-primary)',
              outline: 'none', minHeight: '40px', maxHeight: '160px', overflow: 'auto',
            }}
          />
          <button
            className="btn btn-primary"
            style={{ padding: '10px 16px', fontSize: '13px', borderRadius: '10px', flexShrink: 0 }}
            disabled={sending}
            onClick={() => sendMessage()}
          >
            {en ? 'Send' : 'Envoyer'}
          </button>
        </div>
      </div>
    </div>
  );
}
