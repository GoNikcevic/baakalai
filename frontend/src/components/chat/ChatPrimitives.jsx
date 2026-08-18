/* ===============================================================================
   BAKAL — Chat Primitives
   Shared rendering/streaming building blocks for both chat assistants: the campaign
   assistant (components/campaigns/CampaignAssistant.jsx, under the Campagnes tab) and
   the general assistant (pages/ChatPage.jsx, the first sidebar tab). Each assistant
   keeps its own ActionCard dispatcher and action-specific components — only the
   message/thread-list chrome is shared.
   =============================================================================== */

import { useI18n } from '../../i18n';
import { sanitizeHtml } from '../../services/sanitize';

export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMarkdown(text) {
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

export function TypingIndicator() {
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

export function ThreadList({ threads, currentThreadId, onSelect, onDelete, onNew }) {
  const { lang } = useI18n();
  const en = lang === 'en';
  return (
    <div className="chat-thread-list" id="chatThreadList">
      <div style={{ padding: '12px', borderBottom: '1px solid var(--border)' }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', fontSize: '12px', padding: '8px 12px' }}
          onClick={onNew}
        >
          + {en ? 'New conversation' : 'Nouvelle conversation'}
        </button>
      </div>
      {threads.length === 0 ? (
        <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
          {en ? 'No conversations' : 'Aucune conversation'}
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
              <span className="thread-title">{t.title}</span>
              <span className="thread-date">{dateStr}</span>
              <button
                className="chat-thread-delete"
                onClick={(e) => onDelete(t.id, e)}
                title={en ? 'Delete' : 'Supprimer'}
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

export function QuickReplies({ replies, onSend, disabled }) {
  if (!replies || replies.length === 0) return null;
  return (
    <div className="chat-quick-replies">
      {replies.map((r, i) => {
        const type = r.type || 'option';
        return (
          <button
            key={i}
            className={`chat-quick-reply ${type}`}
            onClick={() => !disabled && onSend(r.value || r.label)}
            disabled={disabled}
          >
            {type === 'confirm' && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

export function InlineSuggestions({ suggestions, onSend }) {
  if (!suggestions || suggestions.length === 0) return null;
  return (
    <div className="chat-inline-suggestions">
      {suggestions.map((s) => (
        <button key={s} className="chat-inline-chip" onClick={() => onSend(s)}>
          {s}
        </button>
      ))}
    </div>
  );
}

/**
 * ActionCardComponent is supplied by the caller — each assistant has its own dispatcher
 * (CampaignAssistant's full 19-action ActionCard, or the general assistant's much smaller
 * one handling just lookup_client) — this component only owns the message bubble chrome.
 */
export function ChatMessage({ role, content, metadata, animate, isLast, onCreateCampaign, onSendMessage, onActionExecute, onPreview, ActionCardComponent }) {
  const { lang } = useI18n();
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

  const hasActionCard = metadata && metadata.action && ActionCardComponent;
  const quickReplies = metadata?.quick_replies;
  // Don't show quick replies if there's already an action card with buttons (avoid duplicate CTAs)
  const showQuickReplies = isLast && quickReplies && quickReplies.length > 0 && !hasActionCard;

  return (
    <div
      className={`chat-msg ${role}`}
      style={animate ? { animation: 'chatFadeIn 0.25s ease' } : undefined}
    >
      <div className="chat-msg-avatar">{avatar}</div>
      <div className="chat-msg-body">
        <div
          className="chat-msg-content"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(formattedContent) }}
        />
        {hasActionCard && (
          <ActionCardComponent
            metadata={metadata}
            onCreateCampaign={onCreateCampaign}
            onModify={() => onSendMessage(lang === 'en' ? 'Can you adjust this campaign?' : 'Peux-tu ajuster cette campagne ?')}
            onActionExecute={onActionExecute}
            onPreview={onPreview}
          />
        )}
        {showQuickReplies && (
          <QuickReplies replies={quickReplies} onSend={onSendMessage} />
        )}
        <div className="chat-msg-time">{timeStr}</div>
      </div>
    </div>
  );
}
