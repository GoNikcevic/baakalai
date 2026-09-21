/* ===============================================================================
   BAKAL · Règles de relance (ex-onglet « Triggers »)

   Charge ses propres règles : la section n'est montée que sur l'onglet
   « Automatisations », inutile de faire payer la requête aux deux autres.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT, useI18n } from '../../i18n';
import { useConfirm } from '../ConfirmModal';
import Icon from '../Icon';
import { getTriggerTypes } from './trigger-types';
import TriggerRecipes from './TriggerRecipes';

// Texte dont le sens complet est dans l'infobulle : on le signale au survol,
// sinon personne ne devine qu'il y a une explication a lire.
const HELP_HINT = { cursor: 'help', borderBottom: '1px dotted var(--border)' };

const FIELD_LABEL = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  color: 'var(--text-muted)',
  marginBottom: 4,
};

export default function TriggersSection() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const confirm = useConfirm();
  const TRIGGER_TYPES = getTriggerTypes(lang);

  const [triggers, setTriggers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    name: '',
    triggerType: 'deal_stagnant',
    actionType: 'email',
    days: 30,
    mode: 'approval',
    tone: 'professionnel mais chaleureux',
  });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await request('/nurture/triggers');
      setTriggers(data.triggers || []);
    } catch { /* la liste reste vide, l'erreur d'API est déjà remontée ailleurs */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Les explications affichees sous le formulaire : le delai en jours n'a pas
  // le meme sens selon le type de trigger (avant le renouvellement, apres la
  // signature, depuis la derniere activite...), donc chaque type a son texte.
  const isLinkedinAction = form.actionType.startsWith('linkedin_');
  // Meme repli que handleCreate (`|| 30`) : l'explication doit annoncer le
  // delai qui sera reellement enregistre, champ vide ou a zero compris.
  const effectiveDays = parseInt(form.days, 10) || 30;
  const daysExplanation = t(`activation.daysHint.${form.triggerType}`, { days: effectiveDays });
  const modeExplanation = isLinkedinAction
    ? t('activation.modeHintLinkedin')
    : (form.mode === 'auto' ? t('activation.modeHintAuto') : t('activation.modeHintApproval'));

  const handleCreate = async () => {
    if (!form.name) return;
    setSaving(true);
    try {
      await request('/nurture/triggers', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name,
          triggerType: form.triggerType,
          actionType: form.actionType,
          conditions: { days: parseInt(form.days, 10) || 30 },
          mode: form.actionType.startsWith('linkedin_') ? 'auto' : form.mode,
          emailTemplate: { tone: form.tone },
        }),
      });
      setShowCreate(false);
      setForm({ name: '', triggerType: 'deal_stagnant', actionType: 'email', days: 30, mode: 'approval', tone: 'professionnel mais chaleureux' });
      load();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setSaving(false);
  };

  const handleToggle = async (id, enabled) => {
    try {
      await request(`/nurture/triggers/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !enabled }),
      });
      load();
    } catch { showToast({ type: 'error', title: t('common.error'), message: en ? 'Failed to update trigger' : 'Échec de mise à jour du trigger' }); }
  };

  const handleDelete = async (id) => {
    if (!await confirm(en ? 'Delete this trigger?' : 'Supprimer ce trigger ?', { danger: true })) return;
    try {
      await request(`/nurture/triggers/${id}`, { method: 'DELETE' });
      load();
    } catch { showToast({ type: 'error', title: t('common.error'), message: en ? 'Operation failed' : 'Opération échouée' }); }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>{t('common.loading')}</div>;
  }

  // Une recette déjà couverte par une règle existante n'est plus proposée.
  const existingTypes = triggers.map(x => x.trigger_type);

  const customizeFromRecipe = (recipe) => {
    const tt = TRIGGER_TYPES.find(x => x.value === recipe.triggerType);
    setForm(p => ({
      ...p,
      triggerType: recipe.triggerType,
      days: recipe.days,
      name: t(`activation.recipes.${recipe.key}.name`) || tt?.defaultName || '',
      actionType: 'email',
      mode: 'approval',
    }));
    setShowCreate(true);
  };

  return (
    <div>
      {!showCreate && (
        <TriggerRecipes
          existingTypes={existingTypes}
          onCreated={load}
          onCustomize={customizeFromRecipe}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 650 }}>{t('activation.rules.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{t('activation.rules.subtitle')}</div>
        </div>
        {!showCreate && (
          <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 14px', flexShrink: 0 }} onClick={() => setShowCreate(true)}>
            {t('activation.newTrigger')}
          </button>
        )}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)' }}>
          <div className="card-body" style={{ padding: 20 }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>{t('activation.newTriggerTitle')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <input
                type="text"
                placeholder={t('activation.triggerName')}
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className="form-input"
                style={{ fontSize: 13, padding: '8px 12px' }}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 190 }}>
                  <label style={FIELD_LABEL} htmlFor="trigger-type">{t('activation.fieldTypeLabel')}</label>
                  <select
                    id="trigger-type"
                    value={form.triggerType}
                    onChange={e => {
                      const tt = TRIGGER_TYPES.find(x => x.value === e.target.value);
                      setForm(p => ({
                        ...p,
                        triggerType: e.target.value,
                        name: p.name || tt?.defaultName || '',
                        days: tt?.defaultDays || p.days,
                      }));
                    }}
                    className="form-input"
                    style={{ width: '100%', fontSize: 13, padding: '8px 12px' }}
                  >
                    {TRIGGER_TYPES.map(tt => (
                      <option key={tt.value} value={tt.value}>{tt.label}</option>
                    ))}
                  </select>
                </div>
                <div style={{ width: 110 }}>
                  <label style={FIELD_LABEL} htmlFor="trigger-days">{t('activation.fieldDaysLabel')}</label>
                  <input
                    id="trigger-days"
                    type="number"
                    min="1"
                    placeholder={en ? 'Days' : 'Jours'}
                    value={form.days}
                    onChange={e => setForm(p => ({ ...p, days: e.target.value }))}
                    className="form-input"
                    style={{ width: '100%', fontSize: 13, padding: '8px 12px' }}
                  />
                </div>
                <div style={{ width: 170 }}>
                  <label style={FIELD_LABEL} htmlFor="trigger-action">{t('activation.fieldActionLabel')}</label>
                  <select
                    id="trigger-action"
                    value={form.actionType}
                    onChange={e => setForm(p => ({ ...p, actionType: e.target.value }))}
                    className="form-input"
                    style={{ width: '100%', fontSize: 13, padding: '8px 12px' }}
                  >
                    <option value="email">Email</option>
                    <option value="linkedin_connect">LinkedIn Connect</option>
                    <option value="linkedin_message">LinkedIn Message</option>
                    <option value="linkedin_visit">LinkedIn Visit</option>
                  </select>
                </div>
                {!isLinkedinAction && (
                  <div style={{ width: 150 }}>
                    <label style={FIELD_LABEL} htmlFor="trigger-mode">{t('activation.fieldModeLabel')}</label>
                    <select
                      id="trigger-mode"
                      value={form.mode}
                      onChange={e => setForm(p => ({ ...p, mode: e.target.value }))}
                      className="form-input"
                      style={{ width: '100%', fontSize: 13, padding: '8px 12px' }}
                    >
                      <option value="approval">{en ? 'Approval' : 'Approbation'}</option>
                      <option value="auto">{en ? 'Automatic' : 'Automatique'}</option>
                    </select>
                  </div>
                )}
              </div>

              {/* Explication en clair de la config choisie : le nombre de jours
                  et le mode d'envoi sont les deux reglages que personne ne
                  devine depuis les seuls libelles des champs. */}
              <div style={{
                fontSize: 12, lineHeight: 1.55, color: 'var(--text-secondary)',
                background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', padding: '10px 12px',
                display: 'flex', flexDirection: 'column', gap: 6,
              }}>
                <div><strong style={{ color: 'var(--text-primary)' }}>{t('activation.fieldDaysLabel')}{en ? ':' : ' :'}</strong>{' '}{daysExplanation}</div>
                <div><strong style={{ color: 'var(--text-primary)' }}>{isLinkedinAction ? t('activation.fieldActionLabel') : t('activation.fieldModeLabel')}{en ? ':' : ' :'}</strong>{' '}{modeExplanation}</div>
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowCreate(false)}>
                  {t('activation.cancel')}
                </button>
                <button className="btn btn-primary" style={{ fontSize: 12 }} onClick={handleCreate} disabled={saving || !form.name}>
                  {saving ? t('activation.creating') : t('activation.create')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Triggers list */}
      {triggers.length === 0 && !showCreate ? (
        <div style={{
          textAlign: 'center', padding: 50,
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
        }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <Icon name="zap" size={28} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            {t('activation.noTriggers')}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {triggers.map(trigger => {
            const typeConfig = TRIGGER_TYPES.find(x => x.value === trigger.trigger_type) || {};
            const conditions = trigger.conditions || {};
            return (
              <div key={trigger.id} className="card" style={{
                borderLeft: `3px solid ${trigger.enabled ? 'var(--success)' : 'var(--text-muted)'}`,
                opacity: trigger.enabled ? 1 : 0.6,
              }}>
                <div className="card-body" style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      <Icon
                        name={typeConfig.icon || 'zap'}
                        size={14}
                        style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 7 }}
                      />
                      {trigger.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                      <span title={conditions.days ? t(`activation.daysHint.${trigger.trigger_type}`, { days: conditions.days }) : undefined} style={conditions.days ? HELP_HINT : undefined}>
                        {typeConfig.desc}{conditions.days ? ` (${conditions.days} ${en ? 'days' : 'jours'})` : ''}
                      </span>
                      {' · '}
                      <span
                        title={trigger.mode === 'auto' ? t('activation.modeHintAuto') : t('activation.modeHintApproval')}
                        style={HELP_HINT}
                      >
                        {t('activation.fieldModeLabel')}{en ? ': ' : ' : '}{trigger.mode === 'auto' ? (en ? 'automatic' : 'automatique') : (en ? 'approval' : 'approbation')}
                      </span>
                      {trigger.last_run && ` · ${en ? 'Last run:' : 'Dernier run :'} ${new Date(trigger.last_run).toLocaleDateString(en ? 'en-US' : 'fr-FR')}`}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button
                      className="btn btn-ghost"
                      style={{
                        fontSize: 10, padding: '4px 10px',
                        color: trigger.ab_enabled ? 'var(--accent)' : 'var(--text-muted)',
                        border: `1px solid ${trigger.ab_enabled ? 'var(--accent)' : 'var(--border)'}`,
                        background: trigger.ab_enabled ? 'rgba(110,87,250,0.06)' : 'transparent',
                      }}
                      onClick={async () => {
                        try {
                          await request(`/nurture/triggers/${trigger.id}`, { method: 'PATCH', body: JSON.stringify({ abEnabled: !trigger.ab_enabled }) });
                          load();
                        } catch { showToast({ type: 'error', title: t('common.error'), message: en ? 'Failed to toggle A/B' : 'Échec du basculement A/B' }); }
                      }}
                    >
                      A/B {trigger.ab_enabled ? 'ON' : 'OFF'}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 10, padding: '4px 10px', color: trigger.enabled ? 'var(--warning)' : 'var(--success)' }}
                      onClick={() => handleToggle(trigger.id, trigger.enabled)}
                    >
                      {trigger.enabled ? t('activation.disable') : t('activation.enable')}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 10, padding: '4px 10px', color: 'var(--danger)' }}
                      onClick={() => handleDelete(trigger.id)}
                    >
                      {en ? 'Delete' : 'Supprimer'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
