/* ═══════════════════════════════════════════════════
   A/B Test Tab — side-by-side diff + winner promotion
   ═══════════════════════════════════════════════════ */

import { useState, useMemo } from 'react';
import api from '../../../services/api-client';
import { sanitizeHtml } from '../../../services/sanitize';
import { useI18n } from '../../../i18n';

export default function ABTestTab({ campaign: c, setCampaigns }) {
  const { lang } = useI18n(); const en = lang === 'en';
  const [promoting, setPromoting] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const abConfig = c.abConfig || null;

  // Find tested touchpoints (those with subject_b or body_b)
  const testedTouchpoints = useMemo(
    () => (c.sequence || []).filter(tp => tp.bodyB || tp.subjectB),
    [c.sequence]
  );

  const hasAB = abConfig && testedTouchpoints.length > 0;

  // Compute aggregated stats — avant l'early return : un hook après un
  // return conditionnel change l'ordre des hooks entre rendus (crash React).
  const stats = useMemo(() => {
    let aReplyAvg = 0, bReplyAvg = 0, aOpenAvg = 0, bOpenAvg = 0, count = 0;
    for (const tp of testedTouchpoints) {
      if (tp.stats?.reply != null) aReplyAvg += Number(tp.stats.reply);
      if (tp.statsB?.reply != null) bReplyAvg += Number(tp.statsB.reply);
      if (tp.stats?.open != null) aOpenAvg += Number(tp.stats.open);
      if (tp.statsB?.open != null) bOpenAvg += Number(tp.statsB.open);
      count++;
    }
    if (count === 0) return null;
    return {
      aReply: +(aReplyAvg / count).toFixed(1),
      bReply: +(bReplyAvg / count).toFixed(1),
      aOpen: +(aOpenAvg / count).toFixed(1),
      bOpen: +(bOpenAvg / count).toFixed(1),
    };
  }, [testedTouchpoints]);

  if (!hasAB) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        <div style={{ fontSize: 42, marginBottom: 12 }}>🧬</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>
          {en ? 'No active A/B test on this campaign' : 'Aucun test A/B actif sur cette campagne'}
        </div>
        <div style={{ fontSize: 13, maxWidth: 480, margin: '0 auto' }}>
          {en
            ? 'A/B tests are configured automatically when creating a campaign from the chat. Create a new campaign by asking Baakalai to propose an A/B configuration.'
            : 'Les tests A/B sont configurés automatiquement à la création de la campagne depuis le chat. Crée une nouvelle campagne en demandant à Baakalai de proposer une configuration A/B.'}
        </div>
      </div>
    );
  }

  const hasStats = stats && (stats.aReply > 0 || stats.bReply > 0);
  const winner = hasStats
    ? stats.bReply > stats.aReply * 1.05
      ? 'B'
      : stats.aReply > stats.bReply * 1.05
        ? 'A'
        : 'tie'
    : null;

  const improvement = hasStats && stats.aReply > 0
    ? Math.abs(((stats.bReply - stats.aReply) / stats.aReply * 100)).toFixed(1)
    : 0;

  const handlePromote = async (choice) => {
    if (!window.confirm(
      choice === 'B'
        ? `Promouvoir la variante B comme version principale ? Ce changement sera poussé sur Lemlist.`
        : `Garder la variante A ? La variante B sera supprimée.`
    )) return;
    setPromoting(true);
    setError(null);
    try {
      const backendId = c._backendId || c.id;
      const data = await api.recordABWinner(backendId, choice);
      setResult({
        winner: choice,
        patternRecorded: data.patternRecorded,
      });
      // Sync local state
      if (setCampaigns) {
        setCampaigns((prev) => ({
          ...prev,
          [c.id]: { ...prev[c.id], abConfig: null },
        }));
      }
    } catch (err) {
      setError(err.message || (en ? 'Error during promotion' : 'Erreur lors de la promotion'));
    }
    setPromoting(false);
  };

  return (
    <div>
      {/* Header */}
      <div
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          padding: '20px',
          marginBottom: '20px',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8 }}>
          {en ? 'A/B test in progress' : '🧬 Test A/B en cours'}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
          <strong>{en ? 'Hypothesis tested:' : 'Hypothèse testée :'}</strong> {abConfig.hypothesis || (en ? 'Not specified' : 'Non renseignée')}
        </div>
        {abConfig.categories_tested && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            {abConfig.categories_tested.map(cat => (
              <span
                key={cat}
                style={{
                  fontSize: 11,
                  background: 'var(--bg-elevated)',
                  padding: '4px 10px',
                  borderRadius: 10,
                  border: '1px solid var(--border)',
                  fontWeight: 600,
                }}
              >
                {cat}
              </span>
            ))}
          </div>
        )}
        {abConfig.memory_used && abConfig.memory_used !== 'null' && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--accent)',
              background: 'rgba(108, 92, 231, 0.08)',
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px dashed rgba(108, 92, 231, 0.25)',
            }}
          >
            ✨ Basé sur la mémoire apprise : {abConfig.memory_used}
          </div>
        )}
      </div>

      {/* Stats summary */}
      {hasStats && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            marginBottom: 20,
          }}
        >
          <StatsCard
            label="Variante A (contrôle)"
            open={stats.aOpen}
            reply={stats.aReply}
            isWinner={winner === 'A'}
            strategy={abConfig.variant_a_strategy}
          />
          <StatsCard
            label="Variante B (test)"
            open={stats.bOpen}
            reply={stats.bReply}
            isWinner={winner === 'B'}
            strategy={abConfig.variant_b_strategy}
          />
        </div>
      )}

      {!hasStats && (
        <div
          style={{
            padding: 16,
            background: 'rgba(255, 170, 0, 0.08)',
            border: '1px solid rgba(255, 170, 0, 0.25)',
            borderRadius: 10,
            fontSize: 12,
            color: 'var(--warning)',
            marginBottom: 20,
          }}
        >
          {en ? 'No performance data yet. Stats will arrive after the first Lemlist sends.' : '⏳ Pas encore de données de performance. Les stats arriveront après les premiers envois Lemlist.'}
        </div>
      )}

      {/* Per-touchpoint diff */}
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>
        📝 Variantes par touchpoint
      </div>
      {testedTouchpoints.map(tp => (
        <TouchpointDiff key={tp._backendId || tp.id} tp={tp} />
      ))}

      {/* Decision buttons */}
      {!result && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            justifyContent: 'flex-end',
            marginTop: 24,
            padding: 16,
            background: 'var(--bg-elevated)',
            borderRadius: 10,
          }}
        >
          <button
            className="btn btn-ghost"
            onClick={() => handlePromote('A')}
            disabled={promoting}
            style={{ fontSize: 12, padding: '10px 18px' }}
          >
            ❌ Garder A
          </button>
          <button
            className="btn btn-success"
            onClick={() => handlePromote('B')}
            disabled={promoting}
            style={{ fontSize: 12, padding: '10px 18px' }}
          >
            {promoting ? 'Promotion...' : `✅ Promouvoir B${hasStats && winner === 'B' ? ` (+${improvement}%)` : ''}`}
          </button>
        </div>
      )}

      {result && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            background: 'rgba(0, 214, 143, 0.1)',
            border: '1px solid rgba(0, 214, 143, 0.3)',
            borderRadius: 10,
            fontSize: 13,
            color: 'var(--success)',
          }}
        >
          ✅ Variante {result.winner} promue. {result.patternRecorded && 'Pattern ajouté à la mémoire collective.'}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: 'var(--danger-bg)',
            borderRadius: 8,
            color: 'var(--danger)',
            fontSize: 12,
          }}
        >
          ⚠️ {error}
        </div>
      )}
    </div>
  );
}

function StatsCard({ label, open, reply, isWinner, strategy }) {
  const { lang } = useI18n(); const en = lang === 'en';
  return (
    <div
      style={{
        background: isWinner ? 'rgba(0, 214, 143, 0.08)' : 'var(--bg-card)',
        border: `1px solid ${isWinner ? 'rgba(0, 214, 143, 0.35)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        position: 'relative',
      }}
    >
      {isWinner && (
        <span
          style={{
            position: 'absolute',
            top: -10,
            right: 12,
            background: 'var(--success)',
            color: 'white',
            padding: '3px 10px',
            borderRadius: 10,
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          {en ? 'LEADING' : '🏆 EN TÊTE'}
        </span>
      )}
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>
        {label}
      </div>
      {strategy && (
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
          {Object.entries(strategy).map(([k, v]) => (
            <div key={k}><strong>{k}:</strong> {v}</div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{en ? 'OPEN RATE' : 'OUVERTURE'}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--blue)' }}>{open}%</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{en ? 'REPLY' : 'RÉPONSE'}</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--success)' }}>{reply}%</div>
        </div>
      </div>
    </div>
  );
}

function TouchpointDiff({ tp }) {
  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 16,
        marginBottom: 12,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
        {tp.id} — {tp.label || tp.type}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
            VARIANTE A
          </div>
          {tp.subject && (
            <div style={{ fontSize: 11, marginBottom: 4, fontStyle: 'italic' }}>
              Objet : {tp.subject}
            </div>
          )}
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              maxHeight: 180,
              overflow: 'auto',
              padding: 8,
              background: 'var(--bg-elevated)',
              borderRadius: 6,
            }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(tp.body || '') }}
          />
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600, marginBottom: 4 }}>
            VARIANTE B
          </div>
          {tp.subjectB && (
            <div style={{ fontSize: 11, marginBottom: 4, fontStyle: 'italic' }}>
              Objet : {tp.subjectB}
            </div>
          )}
          <div
            style={{
              fontSize: 12,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              maxHeight: 180,
              overflow: 'auto',
              padding: 8,
              background: 'var(--bg-elevated)',
              borderRadius: 6,
            }}
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(tp.bodyB || '') }}
          />
        </div>
      </div>
    </div>
  );
}
