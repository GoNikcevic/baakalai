/* ═══════════════════════════════════════════════════
   Ce que baakalai a compris de la STRUCTURE du CRM.

   Le pendant de StageMappingSettings, une couche en dessous. L'un dit ce que
   baakalai a compris du pipeline, celui-ci dit quel OBJET joue la société, la
   personne, l'affaire, et quel champ porte le cycle de vie, le montant, la
   date de vérité.

   Volontairement le MÊME patron que l'écran des étapes : une ligne par
   déduction, l'origine affichée, une phrase de justification, corrigeable, et
   gelée une fois corrigée. Ce patron a été validé en conditions réelles le
   29/09 (six étapes Pipedrive sur six justes) et en inventer un second ferait
   deux façons d'apprendre la même chose.

   Deux différences assumées, parce que la matière n'est pas la même :

   - les lignes sont GROUPÉES par objet. Un CRM peut exposer des centaines de
     champs, une liste à plat serait illisible, et un champ ne veut rien dire
     sans l'objet qui le porte.
   - un objet MAISON est signalé comme tel et n'est jamais présenté comme
     compris. baakalai n'a pas le droit d'interpréter seul un Contrat__c : il
     le montre, il dit qu'il ne sait pas, et il attend.
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';
import { useT } from '../i18n';

/** Ce qu'un OBJET peut jouer · même liste que OBJECT_ROLES côté backend. */
const OBJECT_ROLES = ['account', 'person', 'deal', 'activity', 'unknown'];

/** Ce qu'un CHAMP peut porter · même liste que FIELD_ROLES côté backend. */
const FIELD_ROLES = [
  'lifecycle', 'amount', 'currency', 'close_date', 'created_at',
  'owner', 'name', 'email', 'account_link', 'unknown',
];

/** En dessous, le modèle a dit lui-même qu'il n'était pas sûr. */
const LOW_CONFIDENCE = 0.6;

export default function CrmArchitectureSettings() {
  const t = useT();
  const [provider, setProvider] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [analyzing, setAnalyzing] = useState(false);
  const [savingId, setSavingId] = useState(null);
  const [open, setOpen] = useState({});

  const load = useCallback(async () => {
    try {
      const data = await request('/crm/architecture');
      setProvider(data.provider || null);
      setMappings(data.mappings || []);
      setProfile(data.profile || null);
    } catch { /* la section disparaît plutôt que d'afficher une erreur */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const data = await request('/crm/architecture/analyze', { method: 'POST' });
      setProvider(data.provider || null);
      setMappings(data.mappings || []);
      showToast({
        type: 'success',
        title: t('crmArchitecture.title'),
        message: t('crmArchitecture.analyzed', {
          objects: data.report?.objects || 0,
          fields: data.report?.fields || 0,
        }),
      });
      // La mesure a changé, l'en-tête doit la refléter.
      await load();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err?.message || '' });
    }
    setAnalyzing(false);
  };

  const handleChange = async (mapping, role) => {
    if (role === mapping.baakalai_role) return;
    setSavingId(mapping.id);
    // Optimiste : le select doit répondre au clic, pas à l'aller-retour réseau.
    // En cas d'échec, load() remet la valeur du serveur.
    setMappings(prev => prev.map(m => (
      m.id === mapping.id ? { ...m, baakalai_role: role, source: 'user', confidence: 1, reasoning: null } : m
    )));
    try {
      await request(`/crm/architecture/${mapping.id}`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err?.message || '' });
      await load();
    }
    setSavingId(null);
  };

  if (loading) return null;
  // Aucun CRM introspectable (Notion, Airtable, Folk, ou rien de connecté) :
  // il n'y a pas de structure à découvrir, la section n'a pas lieu d'être.
  if (!provider) return null;

  const providerLabel = provider.charAt(0).toUpperCase() + provider.slice(1);

  // Un groupe par objet, dans l'ordre rendu par l'API. La ligne dont
  // `field_name` est vide est la déduction sur l'objet lui-même.
  const groupes = [];
  const parObjet = new Map();
  for (const m of mappings) {
    if (!parObjet.has(m.object_name)) {
      const g = { name: m.object_name, label: m.object_label || m.object_name, objet: null, champs: [] };
      parObjet.set(m.object_name, g);
      groupes.push(g);
    }
    const g = parObjet.get(m.object_name);
    if (m.field_name) g.champs.push(m); else g.objet = m;
  }

  const uncertain = mappings.filter(
    m => m.source === 'ai' && m.confidence != null && Number(m.confidence) < LOW_CONFIDENCE
  ).length;
  const maison = groupes.filter(g => g.objet?.is_custom).length;

  const sourceLabel = (m) => {
    if (m.source === 'user') return t('crmArchitecture.sourceUser');
    if (m.source === 'rule') return t('crmArchitecture.sourceRule');
    return t('crmArchitecture.sourceAi');
  };
  const sourceColor = (m) => {
    if (m.source === 'user') return 'var(--accent)';
    if (m.source === 'rule') return 'var(--success)';
    return 'var(--text-muted)';
  };

  const ligne = (m, roles) => {
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
          <div style={{ fontWeight: 600 }}>{m.field_label || m.field_name || m.object_label}</div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {m.field_name || m.object_name}
          </div>
        </div>

        <span style={{ color: 'var(--text-muted)' }}>{'→'}</span>

        <select
          className="form-input"
          style={{ flex: '0 1 170px', fontSize: 12, padding: '4px 8px' }}
          value={m.baakalai_role}
          onChange={e => handleChange(m, e.target.value)}
          disabled={savingId === m.id}
        >
          {roles.map(k => (
            <option key={k} value={k}>{t(`crmArchitecture.role.${k}`)}</option>
          ))}
        </select>

        <span style={{
          fontSize: 10, color: sourceColor(m), background: 'var(--bg-elevated)',
          padding: '2px 8px', borderRadius: 4, whiteSpace: 'nowrap',
        }}>
          {sourceLabel(m)}
        </span>

        {/* Une déduction qu'on ne peut pas expliquer, personne ne la
            corrigera : la raison reste à l'écran, pas en infobulle. */}
        {m.reasoning && (
          <div style={{ flexBasis: '100%', fontSize: 11, color: 'var(--text-muted)' }}>
            {m.reasoning}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div className="card-title">{t('crmArchitecture.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {t('crmArchitecture.subtitle', { provider: providerLabel })}
          </div>
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 11, padding: '4px 12px', whiteSpace: 'nowrap' }}
          onClick={handleAnalyze}
          disabled={analyzing}
        >
          {analyzing ? t('crmArchitecture.analyzing') : t('crmArchitecture.reanalyze')}
        </button>
      </div>

      <div className="card-body">
        {mappings.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {t('crmArchitecture.empty')}
          </div>
        ) : (
          <>
            {/* La MESURE au-dessus de la conclusion · c'est elle qui rend les
                déductions vérifiables, donc corrigeables. */}
            {profile && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
                {t('crmArchitecture.measured', {
                  objects: profile.objectsSeen,
                  fields: profile.fieldsSeen,
                })}
              </div>
            )}

            {uncertain > 0 && (
              <div style={{
                padding: '8px 12px', marginBottom: 12, borderRadius: 8, fontSize: 12,
                background: 'var(--bg-elevated)', border: '1px dashed var(--border)', color: 'var(--text-secondary)',
              }}>
                {t('crmArchitecture.uncertain', { count: uncertain })}
              </div>
            )}

            {maison > 0 && (
              <div style={{
                padding: '8px 12px', marginBottom: 12, borderRadius: 8, fontSize: 12,
                background: 'var(--bg-elevated)', border: '1px dashed var(--warning)', color: 'var(--text-secondary)',
              }}>
                {t('crmArchitecture.customObjects', { count: maison })}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groupes.map(g => (
                <div key={g.name}>
                  {g.objet && ligne(g.objet, OBJECT_ROLES)}

                  {/* Les champs sont repliés par défaut : un objet peut en
                      porter soixante, et les dérouler tous ferait une page que
                      personne ne relit. */}
                  {g.champs.length > 0 && (
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 11, padding: '2px 8px', marginTop: 4 }}
                      onClick={() => setOpen(prev => ({ ...prev, [g.name]: !prev[g.name] }))}
                    >
                      {open[g.name]
                        ? t('crmArchitecture.hideFields')
                        : t('crmArchitecture.showFields', { count: g.champs.length })}
                    </button>
                  )}

                  {open[g.name] && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6, paddingLeft: 16 }}>
                      {g.champs.map(m => ligne(m, FIELD_ROLES))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12 }}>
              {t('crmArchitecture.footnote')}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
