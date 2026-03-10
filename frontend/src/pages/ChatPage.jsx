/* ===============================================================================
   BAKAL — Chat Page (React)
   Conversational campaign builder powered by Claude.
   Ported from /app/chat.js — full React hooks implementation.
   =============================================================================== */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import api from '../services/api-client';

/* ─── Helpers ─── */

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMarkdown(text) {
  if (!text) return '';
  let html = escapeHtml(text);

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Line breaks
  html = html.replace(/\n\n/g, '</p><p>');
  html = html.replace(/\n/g, '<br>');
  // Bullet lists
  html = html.replace(/(?:^|<br>)- (.+?)(?=<br>|<\/p>|$)/g, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>)/gs, '<ul>$1</ul>');
  // Numbered lists
  html = html.replace(/(?:^|<br>)\d+\. (.+?)(?=<br>|<\/p>|$)/g, '<li>$1</li>');

  return '<p>' + html + '</p>';
}

const DEFAULT_SUGGESTIONS = [
  'Cibler des DAF en Ile-de-France',
  'Optimiser ma campagne',
  'Quel angle pour le secteur tech ?',
];

const ACTION_PROMPTS = {
  create: 'Je veux creer une nouvelle campagne de prospection. Guide-moi etape par etape.',
  optimize: 'Je veux optimiser une de mes campagnes existantes qui sous-performe. Quelles campagnes puis-je ameliorer ?',
  analyze: 'Peux-tu analyser les performances de mes campagnes actives et me donner un diagnostic ?',
};

/* ─── Sub-components ─── */

function AiStatusBadge({ online }) {
  return (
    <div className={`ai-status${online ? '' : ' offline'}`}>
      <span className="ai-pulse"></span>
      {online ? 'Online' : 'Offline'}
    </div>
  );
}

function ThreadList({ threads, currentThreadId, onSelect, onDelete, onNew }) {
  return (
    <div className="chat-thread-list" id="chatThreadList">
      <div style={{ padding: '12px', borderBottom: '1px solid var(--border)' }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', fontSize: '12px', padding: '8px 12px' }}
          onClick={onNew}
        >
          + Nouvelle conversation
        </button>
      </div>
      {threads.length === 0 ? (
        <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
          Aucune conversation
        </div>
      ) : (
        threads.map((t) => {
          const active = t.id === currentThreadId ? ' active' : '';
          const date = new Date(t.updated_at || t.created_at);
          const dateStr = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
          return (
            <div
              key={t.id}
              className={`chat-thread-item${active}`}
              onClick={() => onSelect(t.id)}
            >
              <span className="thread-title">{escapeHtml(t.title)}</span>
              <span className="thread-date">{dateStr}</span>
              <button
                className="chat-thread-delete"
                onClick={(e) => onDelete(t.id, e)}
                title="Supprimer"
              >
                x
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}

function ActionCard({ campaign, onCreateCampaign, onModify }) {
  const params = [campaign.sector, campaign.position, campaign.size, campaign.channel, campaign.angle, campaign.zone]
    .filter(Boolean)
    .map((p) => (
      <span key={p} className="chat-action-param">{escapeHtml(p)}</span>
    ));

  const steps = campaign.sequence && campaign.sequence.length > 0
    ? campaign.sequence.map((s) => (
        <div key={s.step} className="chat-action-step">
          <div className={`chat-action-step-dot ${s.type}`}></div>
          <span>{escapeHtml(s.step)} &mdash; {escapeHtml(s.label || s.type)}</span>
          <span style={{ color: 'var(--text-muted)', marginLeft: 'auto' }}>{escapeHtml(s.timing || '')}</span>
        </div>
      ))
    : null;

  return (
    <div className="chat-action-card">
      <div className="chat-action-title">Campagne prete : {escapeHtml(campaign.name)}</div>
      <div className="chat-action-params">{params}</div>
      {steps && <div className="chat-action-sequence">{steps}</div>}
      <div className="chat-action-buttons">
        <button className="chat-action-btn primary" onClick={() => onCreateCampaign(campaign)}>
          Creer et voir la sequence &rarr;
        </button>
        <button className="chat-action-btn ghost" onClick={onModify}>
          Modifier
        </button>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="chat-typing" id="chatTyping">
      <div
        className="chat-msg-avatar"
        style={{
          width: '28px',
          height: '28px',
          borderRadius: '8px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '12px',
          fontWeight: 600,
          background: 'var(--bg-elevated)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
        }}
      >
        b
      </div>
      <div className="chat-typing-dots">
        <div className="chat-typing-dot"></div>
        <div className="chat-typing-dot"></div>
        <div className="chat-typing-dot"></div>
      </div>
    </div>
  );
}

function ChatMessage({ role, content, metadata, animate, onCreateCampaign, onSendMessage }) {
  const avatar = role === 'assistant' ? 'b' : '~';
  const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  let formattedContent = content;
  if (role === 'assistant') {
    // Remove JSON code blocks from display (they become action cards)
    formattedContent = formattedContent.replace(/```json\s*[\s\S]*?```/g, '').trim();
    formattedContent = formatMarkdown(formattedContent);
  } else {
    formattedContent = escapeHtml(formattedContent);
  }

  const hasActionCard = metadata && metadata.action === 'create_campaign' && metadata.campaign;

  return (
    <div
      className={`chat-msg ${role}`}
      style={animate ? { animation: 'chatFadeIn 0.25s ease' } : undefined}
    >
      <div className="chat-msg-avatar">{avatar}</div>
      <div className="chat-msg-body">
        <div
          className="chat-msg-content"
          dangerouslySetInnerHTML={{ __html: formattedContent }}
        />
        {hasActionCard && (
          <ActionCard
            campaign={metadata.campaign}
            onCreateCampaign={onCreateCampaign}
            onModify={() => onSendMessage('Peux-tu ajuster cette campagne ?')}
          />
        )}
        <div className="chat-msg-time">{timeStr}</div>
      </div>
    </div>
  );
}

function StreamingMessage({ content, metadata, onCreateCampaign, onSendMessage }) {
  const [displayedContent, setDisplayedContent] = useState('');
  const [showAction, setShowAction] = useState(false);
  const contentRef = useRef(content);

  useEffect(() => {
    contentRef.current = content;
    // Strip JSON blocks for display
    const displayText = content.replace(/```json\s*[\s\S]*?```/g, '').trim();
    const words = displayText.split(/(\s+)/);
    let buffer = '';
    let i = 0;
    const chunkSize = 3;
    const baseDelay = 18;

    const timer = setInterval(() => {
      if (i >= words.length) {
        clearInterval(timer);
        setShowAction(true);
        return;
      }
      buffer += words[i];
      if (i % chunkSize === chunkSize - 1 || i === words.length - 1) {
        setDisplayedContent(formatMarkdown(buffer));
      }
      i++;
    }, baseDelay + Math.random() * 12);

    return () => clearInterval(timer);
  }, [content]);

  const timeStr = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const hasActionCard = metadata && metadata.action === 'create_campaign' && metadata.campaign;

  return (
    <div className="chat-msg assistant" style={{ animation: 'chatFadeIn 0.25s ease' }}>
      <div className="chat-msg-avatar">b</div>
      <div className="chat-msg-body">
        <div
          className="chat-msg-content"
          dangerouslySetInnerHTML={{ __html: displayedContent }}
        />
        {showAction && hasActionCard && (
          <ActionCard
            campaign={metadata.campaign}
            onCreateCampaign={onCreateCampaign}
            onModify={() => onSendMessage('Peux-tu ajuster cette campagne ?')}
          />
        )}
        <div className="chat-msg-time">{timeStr}</div>
      </div>
    </div>
  );
}

function InlineSuggestions({ suggestions, onSend }) {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div className="chat-inline-suggestions">
      {suggestions.map((s) => (
        <button key={s} className="chat-inline-chip" onClick={() => onSend(s)}>
          {escapeHtml(s)}
        </button>
      ))}
    </div>
  );
}

function WelcomeScreen({ suggestions, onSuggestionClick, onAction }) {
  return (
    <div className="chat-welcome" id="chatWelcome" style={{ display: 'flex' }}>
      <div className="chat-welcome-inner">
        <div className="chat-welcome-icon">b</div>
        <h2 className="chat-welcome-title">Assistant Bakal</h2>
        <p className="chat-welcome-text">
          Je peux vous aider a creer des campagnes, optimiser vos sequences et analyser vos performances.
        </p>
        <div className="chat-welcome-suggestions" id="chatWelcomeSuggestions">
          {suggestions.map((s) => (
            <button key={s} className="chat-suggestion" onClick={() => onSuggestionClick(s)}>
              {s}
            </button>
          ))}
        </div>
        <div className="chat-welcome-actions" style={{ display: 'flex', gap: '8px', marginTop: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => onAction('create')}>
            Creer une campagne
          </button>
          <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => onAction('optimize')}>
            Optimiser
          </button>
          <button className="btn btn-ghost" style={{ fontSize: '12px' }} onClick={() => onAction('analyze')}>
            Analyser
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══ Main Component ═══ */

export default function ChatPage() {
  const { backendAvailable, campaigns, setCampaigns } = useApp();

  // Local state
  const [threads, setThreads] = useState([]);
  const [currentThreadId, setCurrentThreadId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [showWelcome, setShowWelcome] = useState(true);
  const [streamingMsg, setStreamingMsg] = useState(null);
  const [showTyping, setShowTyping] = useState(false);
  const [inputValue, setInputValue] = useState('');

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const messagesContainerRef = useRef(null);

  /* ─── Scroll to bottom ─── */
  const scrollToBottom = useCallback(() => {
    setTimeout(() => {
      if (messagesContainerRef.current) {
        messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
      }
    }, 50);
  }, []);

  /* ─── Load threads ─── */
  const loadThreads = useCallback(async () => {
    if (!backendAvailable) return;
    try {
      const data = await api.request('/chat/threads');
      setThreads(data.threads || []);
    } catch {
      setThreads([]);
    }
  }, [backendAvailable]);

  /* ─── Init ─── */
  useEffect(() => {
    loadThreads();
    if (inputRef.current) inputRef.current.focus();
  }, [loadThreads]);

  /* ─── Auto-select latest thread or show welcome ─── */
  useEffect(() => {
    if (threads.length > 0 && !currentThreadId) {
      // Don't auto-select; show welcome for fresh start
      setShowWelcome(true);
    }
  }, [threads, currentThreadId]);

  /* ─── New thread ─── */
  const newThread = useCallback(async () => {
    if (!backendAvailable) {
      setCurrentThreadId(null);
      setMessages([]);
      setShowWelcome(true);
      return;
    }
    try {
      const thread = await api.request('/chat/threads', {
        method: 'POST',
        body: JSON.stringify({ title: 'Nouvelle conversation' }),
      });
      setCurrentThreadId(thread.id);
      await loadThreads();
      setMessages([]);
      setShowWelcome(true);
    } catch (err) {
      console.warn('Failed to create thread:', err.message);
      setCurrentThreadId(null);
      setMessages([]);
      setShowWelcome(true);
    }
    if (inputRef.current) inputRef.current.focus();
  }, [backendAvailable, loadThreads]);

  /* ─── Select thread ─── */
  const selectThread = useCallback(async (threadId) => {
    setCurrentThreadId(threadId);
    setStreamingMsg(null);

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
          metadata: m.metadata ? (typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata) : null,
          animate: false,
        })));
        setShowWelcome(false);
        scrollToBottom();
      }
    } catch (err) {
      console.warn('Failed to load thread messages:', err.message);
    }
  }, [backendAvailable, scrollToBottom]);

  /* ─── Delete thread ─── */
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

  /* ─── Get context suggestions ─── */
  const getSuggestions = useCallback((metadata) => {
    if (metadata && metadata.action === 'create_campaign') {
      return ['Modifier les parametres', 'Ajouter un touchpoint LinkedIn', 'Changer le ton'];
    }
    return ['Creer une campagne', 'Voir mes stats', 'Optimiser mes sequences'];
  }, []);

  /* ─── Create campaign from chat ─── */
  const createCampaignFromChat = useCallback(async (campaignData) => {
    if (currentThreadId && backendAvailable) {
      try {
        const result = await api.request('/chat/threads/' + currentThreadId + '/create-campaign', {
          method: 'POST',
          body: JSON.stringify({ campaign: campaignData }),
        });

        if (result.campaign) {
          const id = String(result.campaign.id);
          const newCampaign = {
            _backendId: result.campaign.id,
            id,
            name: campaignData.name,
            client: campaignData.client || 'Mon entreprise',
            status: 'prep',
            channel: campaignData.channel || 'email',
            channelLabel: campaignData.channel === 'linkedin' ? 'LinkedIn' : campaignData.channel === 'multi' ? 'Multi' : 'Email',
            channelColor: campaignData.channel === 'linkedin' ? 'var(--purple)' : campaignData.channel === 'multi' ? 'var(--orange)' : 'var(--blue)',
            sector: campaignData.sector || '',
            sectorShort: (campaignData.sector || '').split(' ')[0],
            position: campaignData.position || '',
            size: campaignData.size || '',
            angle: campaignData.angle || '',
            zone: campaignData.zone || '',
            tone: campaignData.tone || 'Pro decontracte',
            formality: 'Vous',
            length: 'Standard',
            cta: '',
            volume: { sent: 0, planned: 100 },
            iteration: 0,
            startDate: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
            lemlistRef: null,
            nextAction: null,
            kpis: { contacts: 0, openRate: null, replyRate: null, interested: null, meetings: null },
            sequence: (campaignData.sequence || []).map((s) => ({
              id: s.step, type: s.type, label: s.label || '', timing: s.timing || '',
              subType: '', subject: s.subject || null, body: s.body || '', stats: null,
            })),
            diagnostics: [],
            history: [],
            prepChecklist: [],
            info: { period: '', copyDesc: '', channelsDesc: '', launchEstimate: '' },
          };

          setCampaigns((prev) => ({ ...prev, [id]: newCampaign }));
        }

        // Add success message
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            role: 'assistant',
            content: `Campagne **"${campaignData.name}"** creee avec succes ! Vous pouvez la retrouver dans l'editeur de sequences.`,
            metadata: null,
            animate: true,
          },
        ]);
        scrollToBottom();
      } catch (err) {
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now(),
            role: 'assistant',
            content: 'Erreur lors de la creation : `' + err.message + '`. Essayez de creer la campagne manuellement.',
            metadata: null,
            animate: true,
          },
        ]);
        scrollToBottom();
      }
    } else {
      // Offline fallback
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: 'assistant',
          content: 'Le backend n\'est pas connecte. Vous pouvez creer cette campagne manuellement via le bouton **+ Nouvelle campagne** du dashboard.',
          metadata: null,
          animate: true,
        },
      ]);
      scrollToBottom();
    }
  }, [currentThreadId, backendAvailable, setCampaigns, scrollToBottom]);

  /* ─── Send message ─── */
  const sendMessage = useCallback(async (overrideText) => {
    if (sending) return;

    const text = overrideText || inputValue.trim();
    if (!text) return;

    // Clear input
    if (!overrideText) {
      setInputValue('');
    }

    setShowWelcome(false);
    setStreamingMsg(null);

    let threadId = currentThreadId;

    // If no thread, create one first
    if (!threadId && backendAvailable) {
      try {
        const thread = await api.request('/chat/threads', {
          method: 'POST',
          body: JSON.stringify({ title: text.slice(0, 60) }),
        });
        threadId = thread.id;
        setCurrentThreadId(threadId);
        loadThreads();
      } catch (err) {
        console.warn('Failed to create thread:', err.message);
      }
    }

    // Add user message
    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: text,
      metadata: null,
      animate: true,
    };
    setMessages((prev) => [...prev, userMsg]);
    scrollToBottom();

    // Show typing indicator
    setShowTyping(true);
    setSending(true);

    // Try backend
    if (threadId && backendAvailable) {
      try {
        const data = await api.request('/chat/threads/' + threadId + '/messages', {
          method: 'POST',
          body: JSON.stringify({ message: text }),
        });
        setShowTyping(false);

        const assistantMsg = {
          id: data.message.id || Date.now() + 1,
          role: 'assistant',
          content: data.message.content,
          metadata: data.message.metadata,
          animate: true,
          streaming: true,
        };
        setStreamingMsg(assistantMsg);

        // After streaming completes, move to messages array
        // The streaming message will be displayed separately, then converted
        setTimeout(() => {
          setStreamingMsg(null);
          setMessages((prev) => [...prev, { ...assistantMsg, streaming: false }]);
          scrollToBottom();
        }, Math.max(500, (data.message.content || '').split(/\s+/).length * 25));

        // Refresh thread list (title may have changed)
        loadThreads();
      } catch (err) {
        setShowTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: 'assistant',
            content: 'Desole, je ne peux pas repondre pour le moment. Verifiez que le backend est demarre et que la cle API Claude est configuree.\n\n`' + err.message + '`',
            metadata: null,
            animate: true,
          },
        ]);
        scrollToBottom();
      }
    } else {
      // Offline fallback
      setTimeout(() => {
        setShowTyping(false);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: 'assistant',
            content: 'Le backend n\'est pas connecte. Demarrez le serveur avec `cd backend && node server.js` pour activer l\'assistant IA.\n\nEn attendant, vous pouvez explorer le dashboard et les autres pages.',
            metadata: null,
            animate: true,
          },
        ]);
        scrollToBottom();
      }, 800);
    }

    setSending(false);
    if (inputRef.current) inputRef.current.focus();
  }, [sending, inputValue, currentThreadId, backendAvailable, loadThreads, scrollToBottom]);

  /* ─── Action button starters ─── */
  const startAction = useCallback((action) => {
    const text = ACTION_PROMPTS[action];
    if (text) sendMessage(text);
  }, [sendMessage]);

  /* ─── Input handling ─── */
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }, [sendMessage]);

  const handleInputChange = useCallback((e) => {
    setInputValue(e.target.value);
    // Auto-resize
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
  }, []);

  /* ─── Compute last assistant metadata for suggestions ─── */
  const lastAssistantMsg = messages.length > 0
    ? [...messages].reverse().find((m) => m.role === 'assistant')
    : null;
  const inlineSuggestions = lastAssistantMsg ? getSuggestions(lastAssistantMsg.metadata) : [];

  return (
    <div className="chat-page" style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* ─── Sidebar: Thread List ─── */}
      <div className="chat-sidebar" style={{ width: '260px', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div className="chat-sidebar-header" style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Conversations</span>
          <AiStatusBadge online={backendAvailable} />
        </div>
        <ThreadList
          threads={threads}
          currentThreadId={currentThreadId}
          onSelect={selectThread}
          onDelete={deleteThread}
          onNew={newThread}
        />
      </div>

      {/* ─── Main Chat Area ─── */}
      <div className="chat-main" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Welcome screen or messages */}
        {showWelcome && messages.length === 0 ? (
          <WelcomeScreen
            suggestions={DEFAULT_SUGGESTIONS}
            onSuggestionClick={(s) => sendMessage(s)}
            onAction={startAction}
          />
        ) : (
          <div
            className="chat-messages"
            id="chatMessages"
            ref={messagesContainerRef}
            style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}
          >
            <div className="chat-messages-inner" id="chatMessagesInner" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                  metadata={msg.metadata}
                  animate={msg.animate}
                  onCreateCampaign={createCampaignFromChat}
                  onSendMessage={sendMessage}
                />
              ))}

              {/* Streaming message */}
              {streamingMsg && (
                <StreamingMessage
                  content={streamingMsg.content}
                  metadata={streamingMsg.metadata}
                  onCreateCampaign={createCampaignFromChat}
                  onSendMessage={sendMessage}
                />
              )}

              {/* Typing indicator */}
              {showTyping && !streamingMsg && <TypingIndicator />}

              {/* Inline suggestions after last assistant message */}
              {!showTyping && !streamingMsg && messages.length > 0 && (
                <InlineSuggestions suggestions={inlineSuggestions} onSend={sendMessage} />
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        )}

        {/* ─── Input bar ─── */}
        <div className="chat-input-bar" style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            id="chatInput"
            className="chat-input"
            placeholder="Ecrivez votre message..."
            rows={1}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            style={{
              flex: 1,
              resize: 'none',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              padding: '10px 14px',
              fontSize: '13px',
              lineHeight: '1.5',
              background: 'var(--bg-elevated)',
              color: 'var(--text-primary)',
              outline: 'none',
              minHeight: '40px',
              maxHeight: '160px',
              overflow: 'auto',
            }}
          />
          <button
            id="chatSendBtn"
            className="btn btn-primary"
            style={{ padding: '10px 16px', fontSize: '13px', borderRadius: '10px', flexShrink: 0 }}
            disabled={sending}
            onClick={() => sendMessage()}
          >
            Envoyer
          </button>
        </div>
      </div>
    </div>
  );
}
