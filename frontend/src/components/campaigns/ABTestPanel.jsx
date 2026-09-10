/* ═══════════════════════════════════════════════════
   A/B Test Panel Component
   ═══════════════════════════════════════════════════ */

import { useState } from 'react';
import { useI18n } from '../../i18n';
import Icon from '../Icon';

export default function ABTestPanel({ sequence, onConfirm, onClose, launched }) {
  const { lang } = useI18n(); const en = lang === 'en';
  const [selectedStep, setSelectedStep] = useState(
    sequence.length > 0 ? sequence[0].id : ''
  );
  const [split, setSplit] = useState('50/50');

  if (launched) {
    return (
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--success)',
          borderRadius: '12px',
          padding: '24px',
          margin: '16px 0',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '8px 0',
          }}
        >
          <Icon name="flask" size={20} />
          <div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 600,
                color: 'var(--success)',
              }}
            >
              {en ? `A/B test launched on ${launched}` : `Test A/B lancé sur ${launched}`}
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              {en ? 'Regeneration in progress by Baakalai \u00B7 Estimated results in 5-7 days' : 'Régénération en cours par Baakalai \u00B7 Résultats estimés dans 5-7 jours'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="ab-test-panel"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--accent)',
        borderRadius: '12px',
        padding: '24px',
        margin: '16px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ fontSize: '15px', fontWeight: 600 }}>
          <Icon name="flask" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
          {en ? 'Configure an A/B test' : 'Configurer un test A/B'}
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '11px', padding: '6px 12px' }}
          onClick={onClose}
        >
          {en ? 'Close' : '✕ Fermer'}
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '16px',
          marginBottom: '16px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '6px',
              textTransform: 'uppercase',
            }}
          >
            {en ? 'Touchpoint to test' : 'Touchpoint a tester'}
          </div>
          <select
            className="form-select"
            value={selectedStep}
            onChange={(e) => setSelectedStep(e.target.value)}
          >
            {sequence.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id} — {s.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '6px',
              textTransform: 'uppercase',
            }}
          >
            {en ? 'Split' : 'Répartition'}
          </div>
          <select
            className="form-select"
            value={split}
            onChange={(e) => setSplit(e.target.value)}
          >
            <option>{en ? '50/50 (recommended)' : '50/50 (recommandé)'}</option>
            <option>70/30</option>
            <option>80/20</option>
          </select>
        </div>
      </div>

      <div
        style={{
          fontSize: '12px',
          color: 'var(--text-muted)',
          marginBottom: '16px',
        }}
      >
        {en ? 'Baakalai will automatically generate a variant B based on cross-campaign data.' : 'Baakalai va générer une variante B automatiquement basée sur les données cross-campagne.'}
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          className="btn btn-primary"
          style={{ fontSize: '12px', padding: '8px 14px' }}
          onClick={() => onConfirm(selectedStep)}
        >
          <Icon name="flask" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
          {en ? 'Launch test' : 'Lancer le test'}
        </button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '12px', padding: '8px 14px' }}
          onClick={onClose}
        >
          {en ? 'Cancel' : 'Annuler'}
        </button>
      </div>
    </div>
  );
}
