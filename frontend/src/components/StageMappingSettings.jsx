/* ═══════════════════════════════════════════════════
   Ce que baakalai a compris du pipeline du user.

   Le mappage étape CRM -> statut baakalai est calculé tout seul à chaque
   analyse CRM (backend/lib/crm-stage-mapper.js). Cet écran ne sert pas à le
   saisir, il sert à le RELIRE : un mappage qu'on ne peut ni voir ni corriger
   se lit comme une boîte noire, et la première étape mal rangée décrédibilise
   tout le reste du produit.

   D'où l'origine affichée sur chaque ligne. « Le CRM le dit » et « baakalai a
   supposé » n'appellent pas la même attention, et seule la seconde vaut d'être
   relue.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';
import { useT } from '../i18n';

/** Les cinq statuts atteignables depuis une étape de pipeline · même liste que
 *  CANONICAL_STATUSES côté backend. 'new' et 'imported' n'en sont pas : ils
 *  disent d'où vient un contact, pas où il en est. */
const STATUS_KEYS = ['interested', 'meeting', 'negotiation', 'won', 'lost'];

/** En dessous, le modèle a dit lui-même qu'il n'était pas sûr. C'est la seule
 *  ligne qui mérite qu'on demande au user de regarder. */
const LOW_CONFIDENCE = 0.6;

export default function StageMappingSettings() {
  const t = useT();
  const [provider, setProvider] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingId, setSavingId] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await request('/crm/stage-mapping');
      setProvider(data.provider || null);
      setMappings(data.mappings || []);
    } catch { /* la section disparaît plutôt que d'afficher une erreur */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const data = await request('/crm/stage-mapping/analyze', { method: 'POST' });
      setProvider(data.provider || null);
      setMappings(data.mappings || []);
      showToast({
        type: 'success',
        title: t('stageMapping.title'),
        message: t('stageMapping.analyzed', {
          count: data.mappings?.length || 0,
          repositioned: data.repositioned || 0,
        }),
      });
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err?.message || '' });
    }
    setAnalyzing(false);
  };

  const handleChange = async (mapping, status) => {
    if (status === mapping.baakalai_status) return;
    setSavingId(mapping.id);
    // Optimiste : le select doit répondre au clic, pas à l'aller-retour réseau.
    // En cas d'échec, load() remet la valeur du serveur.
    setMappings(prev => prev.map(m => (
      m.id === mapping.id ? { ...m, baakalai_status: status, source: 'user', confidence: 1, reasoning: null } : m
    )));
    try {
      const data = await request(`/crm/stage-mapping/${mapping.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      if (data.repositioned > 0) {
        showToast({
          type: 'success',
          title: t('stageMapping.title'),
          message: t('stageMapping.repositioned', { count: data.repositioned }),
        });
      }
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err?.message || '' });
      await load();
    }
    setSavingId(null);
  };

  if (loading) return null;
  // Aucun CRM à pipeline structuré (Notion, Airtable, Folk, ou rien de
  // connecté) : il n'y a pas d'étapes à comprendre, la section n'a pas lieu
  // d'être.
  if (!provider) return null;

  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);
  const uncertain = mappings.filter(
    m => m.source === 'ai' && m.confidence != null && Number(m.confidence) < LOW_CONFIDENCE
  ).length;

  const sourceLabel = (m) => {
    if (m.source === 'user') return t('stageMapping.sourceUser');
    if (m.source === 'rule') return t('stageMapping.sourceRule');
    return t('stageMapping.sourceAi');
  };
  const sourceColor = (m) => {
    if (m.source === 'user') return 'var(--accent)';
    if (m.source === 'rule') return 'var(--success)';
    return 'var(--text-muted)';
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="card-title">{t('stageMapping.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {t('stageMapping.subtitle', { provider: providerLabel })}
          </div>
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: '4px 12px', whiteSpace: 'nowrap' }}
          onClick={handleAnalyze}
          disabled={analyzing}
        >
          {analyzing ? t('stageMapping.analyzing') : t('stageMapping.reanalyze')}
        </button>
      </div>

      <div className="card-body">
        {mappings.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('stageMapping.empty')}
          </div>
        ) : (
          <>
            {uncertain > 0 && (
              <div style={{
                padding: '8px 12px', marginBottom: 12, borderRadius: 8, fontSize: 12,
                background: 'var(--bg-elevated)', border: '1px dashed var(--border)', color: 'var(--text-secondary)',
              }}>
                {t('stageMapping.uncertain', { count: uncertain })}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {mappings.map(m => {
                const low = m.source === 'ai' && m.confidence != null && Number(m.confidence) < LOW_CONFIDENCE;
                return (
                  <div key={m.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                    padding: '8px 12px', borderRadius: 8,
                    border: `1px solid ${low ? 'var(--warning)' : 'var(--border)'}`,
                    background: 'var(--bg-card)', fontSize: 12,
                    opacity: savingId === m.id ? 0.6 : 1,
                  }}>
                    <div style={{ flex: '1 1 200px', minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>{m.crm_stage_name}</div>
                      {/* Le nom du pipeline n'apparaît que chez les CRM qui en
                          exposent plusieurs : ailleurs il n'aurait rien à
                          désambiguïser. */}
                      {m.pipeline_name && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>{m.pipeline_name}</div>
                      )}
                    </div>

                    <span style={{ color: 'var(--text-muted)' }}>{'→'}</span>

                    <select
                      className="form-input"
                      style={{ flex: '0 1 150px', fontSize: 12, padding: '4px 8px' }}
                      value={m.baakalai_status}
                      onChange={e => handleChange(m, e.target.value)}
                      disabled={savingId === m.id}
                    >
                      {STATUS_KEYS.map(k => (
                        <option key={k} value={k}>{t(`stageMapping.status.${k}`)}</option>
                      ))}
                    </select>

                    <span style={{
                      fontSize: 10, color: sourceColor(m), background: 'var(--bg-elevated)',
                      padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap',
                    }}>
                      {sourceLabel(m)}
                    </span>

                    {/* Un mappage qu'on ne peut pas expliquer, personne ne le
                        corrigera : la raison reste à l'écran, pas en infobulle. */}
                    {m.reasoning && (
                      <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--text-muted)' }}>
                        {m.reasoning}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
              {t('stageMapping.footnote')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
