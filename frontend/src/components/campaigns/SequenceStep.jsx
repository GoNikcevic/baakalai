/* ═══════════════════════════════════════════════════
   Sequence Step Component
   ═══════════════════════════════════════════════════ */

import { StepStat } from './shared';
import { sanitizeHtml } from '../../services/sanitize';
import { useI18n } from '../../i18n';
import Icon from '../Icon';

const TYPE_META = {
  email: { label: 'Email', color: 'var(--blue)', icon: 'mail' },
  linkedin_visit: { label: 'Visite profil', labelEn: 'Profile visit', color: 'var(--purple)', icon: 'eye' },
  linkedin_invite: { label: 'Note connexion', labelEn: 'Connection note', color: 'var(--purple)', icon: 'handshake' },
  linkedin_message: { label: 'Message LinkedIn', labelEn: 'LinkedIn message', color: 'var(--purple)', icon: 'message' },
  // Legacy fallback
  linkedin: { label: 'LinkedIn', color: 'var(--purple)', icon: 'message' },
};

export default function SequenceStep({ step: s, faded, depth = 0 }) {
  const { lang } = useI18n(); const en = lang === 'en';
  const hasStats = s.stats !== null && s.stats !== undefined;

  const meta = TYPE_META[s.type] || TYPE_META.email;
  const metaLabel = en && meta.labelEn ? meta.labelEn : meta.label;
  const typeLabel = `${meta.icon} ${metaLabel}${s.subType ? ' — ' + s.subType : ''}`;
  const isLinkedinInvite = s.type === 'linkedin_invite';
  const isLinkedinVisit = s.type === 'linkedin_visit';
  const charCount = (s.body || '').length;
  const charLimitExceeded = isLinkedinInvite && charCount > 300;

  let statsContent;
  if (!hasStats) {
    statsContent = (
      <>
        <StepStat value="—" label="Pas encore lance" color="var(--text-muted)" />
        <StepStat value="—" label="" color="var(--text-muted)" />
        <StepStat value="—" label="" color="var(--text-muted)" />
      </>
    );
  } else if (s.type === 'linkedin' && s.stats.accept !== undefined) {
    statsContent = (
      <>
        <StepStat
          value={s.stats.accept + '%'}
          label="Acceptation"
          color="var(--success)"
          pct={s.stats.accept}
        />
        <StepStat value="—" label="—" color="var(--text-muted)" />
        <StepStat
          value="0%"
          label="Ignore"
          color="var(--text-muted)"
          pct={0}
          barColor="var(--danger)"
        />
      </>
    );
  } else if (s.type === 'linkedin') {
    statsContent = (
      <>
        <StepStat
          value={s.stats.reply + '%'}
          label="Reponse"
          color={s.stats.reply >= 8 ? 'var(--success)' : 'var(--warning)'}
          pct={s.stats.reply * 10}
        />
        <StepStat
          value={s.stats.interested || '—'}
          label={s.stats.interested ? 'Interesses' : '—'}
          color="var(--warning)"
        />
        <StepStat
          value={s.stats.stop + '%'}
          label="Stop"
          color="var(--text-muted)"
          pct={s.stats.stop * 10}
          barColor="var(--danger)"
        />
      </>
    );
  } else {
    statsContent = (
      <>
        <StepStat
          value={s.stats.open + '%'}
          label={en ? 'Open' : 'Ouverture'}
          color={s.stats.open >= 50 ? 'var(--success)' : 'var(--warning)'}
          pct={s.stats.open}
        />
        <StepStat
          value={s.stats.reply + '%'}
          label="Reponse"
          color="var(--blue)"
          pct={s.stats.reply * 10}
        />
        <StepStat
          value={s.stats.stop + '%'}
          label="Stop"
          color="var(--text-muted)"
          pct={s.stats.stop * 10}
          barColor="var(--danger)"
        />
      </>
    );
  }

  return (
    <div
      className="sequence-step"
      style={{
        ...(faded ? { opacity: 0.5 } : {}),
        ...(depth > 0
          ? {
              marginLeft: `${depth * 24}px`,
              borderLeft: '2px solid var(--border)',
              paddingLeft: '14px',
            }
          : {}),
      }}
    >
      <div className="step-indicator">
        <div
          className={`step-dot ${s.type}`}
          style={{ background: meta.color }}
        >
          {s.id}
        </div>
        <div className="step-label">{s.timing}</div>
      </div>
      <div className="step-content">
        {s.branchLabel && (
          <div
            style={{
              display: 'inline-block',
              fontSize: '10px',
              fontWeight: 600,
              color: 'var(--accent)',
              background: 'rgba(108, 92, 231, 0.12)',
              padding: '2px 8px',
              borderRadius: '10px',
              marginBottom: '6px',
            }}
          >
            ↳ {s.branchLabel}
          </div>
        )}
        {s.subject && (
          <div className="step-subject">Objet : {s.subject}</div>
        )}
        <div className="step-type">{typeLabel}</div>
        {isLinkedinVisit ? (
          <div
            style={{ fontSize: '12px', color: 'var(--text-muted)', fontStyle: 'italic' }}
          >
            Visite automatique du profil — pas de message
          </div>
        ) : (
          <div
            className="step-preview"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(s.body) }}
          />
        )}
        {isLinkedinInvite && (
          <div
            style={{
              fontSize: '10px',
              fontWeight: 600,
              marginTop: '4px',
              color: charLimitExceeded ? 'var(--danger)' : charCount > 250 ? 'var(--warning)' : 'var(--text-muted)',
            }}
          >
            {charCount}/300 caractères
            {charLimitExceeded && (
              <>
                <Icon name="alert" size={11} style={{ display: 'inline-block', verticalAlign: '-2px', margin: '0 4px' }} />
                DÉPASSE LA LIMITE
              </>
            )}
          </div>
        )}
      </div>
      {statsContent}
    </div>
  );
}
