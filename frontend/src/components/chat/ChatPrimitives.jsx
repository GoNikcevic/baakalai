/* ===============================================================================
   BAKAL · Chat Primitives
   Shared rendering/streaming building blocks for both chat assistants: the prospecting
   assistant (components/campaigns/CampaignAssistant.jsx, under the Prospection tab) and
   the general assistant (pages/ChatPage.jsx, the first sidebar tab). Each assistant
   keeps its own ActionCard dispatcher and its own action set · only the message/thread-list
   chrome is shared here, and the CRM/activation cards in components/chat/CrmActionCards.jsx.
   =============================================================================== */

import { useState, useRef, useMemo } from 'react';
import { useI18n, useT } from '../../i18n';
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

/**
 * Liste des conversations.
 *
 * Le titre tient sur deux lignes au lieu d'une : le titre automatique vient du
 * premier message (backend lib/chat-title.js), et sur une seule ligne tronquée
 * deux conversations différentes se ressemblaient parce qu'on ne lisait que
 * leur amorce commune.
 *
 * Deux conversations lancées depuis le même bouton de suggestion portent le
 * même titre, et aucune heuristique de texte ne peut les distinguer : l'heure
 * s'affiche alors à côté de la date, et le double-clic renomme.
 */
export function ThreadList({ threads, currentThreadId, onSelect, onDelete, onRename, onNew, newLabel, emptyLabel }) {
  const { lang } = useI18n();
  const t = useT();
  const en = lang === 'en';
  const locale = en ? 'en-US' : 'fr-FR';

  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState('');
  // Fermer le champ (Échap ou Entrée) peut déclencher un blur sur un input qui
  // disparaît : sans ce drapeau, l'annulation serait enregistrée et la
  // validation partirait deux fois. Il est remis à zéro à chaque ouverture,
  // sinon un blur qui ne vient jamais le laisserait armé pour la fois d'après.
  const skipBlur = useRef(false);

  // Titres en double · seul cas où la date seule ne suffit plus à s'y retrouver.
  const duplicates = useMemo(() => {
    const counts = new Map();
    for (const th of threads) {
      const key = (th.title || '').trim().toLowerCase();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, [threads]);

  const startRename = (thread, e) => {
    if (!onRename) return;
    e.stopPropagation();
    skipBlur.current = false;
    setEditingId(thread.id);
    setDraft(thread.title || '');
  };

  const commitRename = (thread) => {
    if (skipBlur.current) return;
    skipBlur.current = true;
    const value = draft.trim();
    setEditingId(null);
    if (!value || value === (thread.title || '').trim()) return;
    onRename(thread.id, value);
  };

  const cancelRename = () => {
    skipBlur.current = true;
    setEditingId(null);
  };

  return (
    <div className="chat-thread-list" id="chatThreadList">
      <div style={{ padding: '12px', borderBottom: '1px solid var(--border)' }}>
        <button
          className="btn btn-primary"
          style={{ width: '100%', fontSize: '12px', padding: '8px 12px' }}
          onClick={onNew}
        >
          + {newLabel || (en ? 'New conversation' : 'Nouvelle conversation')}
        </button>
      </div>
      {threads.length === 0 ? (
        <div style={{ padding: '20px 12px', textAlign: 'center', fontSize: '12px', color: 'var(--text-muted)' }}>
          {emptyLabel || (en ? 'No conversations' : 'Aucune conversation')}
        </div>
      ) : (
        threads.map((thread) => {
          const active = thread.id === currentThreadId ? ' active' : '';
          const date = new Date(thread.updated_at || thread.created_at);
          const dateStr = date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
          const homonym = (duplicates.get((thread.title || '').trim().toLowerCase()) || 0) > 1;
          const timeStr = homonym
            ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
            : null;
          const editing = editingId === thread.id;

          return (
            <div
              key={thread.id}
              className={`chat-thread-item${active}`}
              onClick={() => !editing && onSelect(thread.id)}
            >
              <div className="thread-main">
                {editing ? (
                  <input
                    className="thread-rename-input"
                    value={draft}
                    autoFocus
                    maxLength={120}
                    onChange={(e) => setDraft(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => commitRename(thread)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(thread);
                      else if (e.key === 'Escape') cancelRename();
                    }}
                    aria-label={t('chat.renameThread')}
                  />
                ) : (
                  <span
                    className="thread-title"
                    onDoubleClick={(e) => startRename(thread, e)}
                    title={onRename ? `${thread.title}\n${t('chat.renameHint')}` : thread.title}
                  >
                    {thread.title}
                  </span>
                )}
                <span className="thread-date">{timeStr ? `${dateStr} · ${timeStr}` : dateStr}</span>
              </div>
              <button
                className="chat-thread-delete"
                onClick={(e) => onDelete(thread.id, e)}
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

/**
 * Actions qui ne produisent rien : la carte va chercher la donnée toute seule au montage et
 * n'affiche aucun bouton d'exécution. Elles peuvent donc cohabiter avec des quick_replies.
 */
export const READ_ONLY_ACTIONS = ['lookup_client', 'list_clients'];

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
 * ActionCardComponent is supplied by the caller · each assistant has its own dispatcher over
 * its own action set (CampaignAssistant: campaign building and prospect sourcing; ChatPage:
 * CRM lookups and the activation cards) · this component only owns the message bubble chrome.
 */
export function ChatMessage({ role, content, metadata, animate, isLast, onCreateCampaign, onSendMessage, onActionExecute, onPreview, ActionCardComponent }) {
  const { lang } = useI18n();
  const avatar = role === 'assistant' ? 'b' : '~';
  const timeStr = new Date().toLocaleTimeString(lang === 'en' ? 'en-US' : 'fr-FR', { hour: '2-digit', minute: '2-digit' });

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
  // Don't show quick replies if there's already an action card with buttons (avoid duplicate CTAs).
  // Les cartes en lecture seule sont exclues de cette règle : elles s'auto-exécutent et n'ont
  // aucun CTA à elles, donc rien à dupliquer. Sans cette exception, une question de cadrage
  // posée en même temps qu'une lecture (« voici tes 15 dormants, on part sur lesquels ? »)
  // perdrait silencieusement ses boutons de réponse.
  const cardHasOwnCtas = hasActionCard && !READ_ONLY_ACTIONS.includes(metadata.action);
  const showQuickReplies = isLast && quickReplies && quickReplies.length > 0 && !cardHasOwnCtas;

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
