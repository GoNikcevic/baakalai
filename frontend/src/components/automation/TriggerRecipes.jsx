/* ===============================================================================
   BAKAL · Recettes de règles prêtes à l'emploi

   Mesuré en prod le 2026-09-21 : 1 seule règle créée sur 15 comptes. Le
   formulaire demandait un type parmi dix, un délai en jours et un mode
   d'envoi, sans jamais dire ce que ça donnerait. Ces trois cartes couvrent
   les cas les plus courants et affichent le nombre de contacts réellement
   concernés aujourd'hui, avant de créer quoi que ce soit.

   Une recette déjà couverte par une règle existante n'est plus proposée.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT, useI18n } from '../../i18n';
import Icon from '../Icon';

const RECIPES = [
  { key: 'dormant', triggerType: 'deal_stagnant', days: 30, icon: 'moon' },
  { key: 'silent', triggerType: 'inactive_contact', days: 60, icon: 'refresh' },
  // days: 0 = dès le signalement. Le déclencheur churn_risk ne mesure pas une
  // ancienneté mais un délai après le passage à risque (cf. trigger-matching).
  { key: 'atRisk', triggerType: 'churn_risk', days: 0, icon: 'churn' },
  { key: 'feedback', triggerType: 'feedback_request', days: 30, icon: 'message' },
];

export default function TriggerRecipes({ existingTypes = [], onCreated, onCustomize }) {
  const t = useT();
  const { lang } = useI18n();
  const [counts, setCounts] = useState(null);
  const [creating, setCreating] = useState(null);

  const available = RECIPES.filter(r => !existingTypes.includes(r.triggerType));

  useEffect(() => {
    if (available.length === 0) { setCounts({}); return; }
    let cancelled = false;
    request('/nurture/triggers/match-counts', {
      method: 'POST',
      body: JSON.stringify({ recipes: available.map(r => ({ id: r.key, triggerType: r.triggerType, days: r.days })) }),
    })
      .then(d => {
        if (cancelled) return;
        const byId = {};
        for (const c of (d.counts || [])) byId[c.id] = c;
        setCounts(byId);
      })
      .catch(() => { if (!cancelled) setCounts({}); });
    return () => { cancelled = true; };
    // available dépend de existingTypes : recalculé quand une règle est créée.
  }, [existingTypes.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (available.length === 0) return null;

  const activate = async (recipe) => {
    setCreating(recipe.key);
    try {
      await request('/nurture/triggers', {
        method: 'POST',
        body: JSON.stringify({
          name: t(`activation.recipes.${recipe.key}.name`),
          triggerType: recipe.triggerType,
          actionType: 'email',
          conditions: { days: recipe.days },
          // Toujours en approbation : la première règle d'un compte ne doit pas
          // pouvoir écrire à des clients sans que personne ne relise.
          mode: 'approval',
          emailTemplate: { tone: lang === 'en' ? 'professional but warm' : 'professionnel mais chaleureux' },
        }),
      });
      showToast({ type: 'success', title: t('activation.recipes.created', { name: t(`activation.recipes.${recipe.key}.name`) }) });
      onCreated?.();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setCreating(null);
  };

  const countLabel = (recipe) => {
    if (!counts) return t('activation.recipes.counting');
    const c = counts[recipe.key];
    // Pas de ligne pour cette recette (appel en échec) : ne rien affirmer
    // plutôt qu'annoncer un zéro qui n'a pas été mesuré.
    if (!c) return '';
    if (c.count === null) return t('activation.recipes.unknown');
    return c.count > 0
      ? t('activation.recipes.matches', { count: c.count })
      : t('activation.recipes.none');
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 15, fontWeight: 650 }}>{t('activation.recipes.title')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 12px' }}>{t('activation.recipes.subtitle')}</div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
        {available.map(recipe => {
          const c = counts?.[recipe.key];
          const hasMatches = !!c && c.count > 0;
          return (
            <div key={recipe.key} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="card-body" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 650 }}>
                  <Icon name={recipe.icon} size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 7 }} />
                  {t(`activation.recipes.${recipe.key}.title`)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5, flex: 1 }}>
                  {t(`activation.recipes.${recipe.key}.desc`, { days: recipe.days })}
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: hasMatches ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {countLabel(recipe)}
                </div>
                {hasMatches && c.sample.length > 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {c.sample.map(s => s.name || s.company).filter(Boolean).join(', ')}
                    {c.count > c.sample.length ? '...' : ''}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 12, padding: '5px 14px' }}
                    disabled={creating === recipe.key}
                    onClick={() => activate(recipe)}
                  >
                    {creating === recipe.key ? t('activation.creating') : t('activation.recipes.activate')}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: '5px 10px' }}
                    onClick={() => onCustomize?.(recipe)}
                  >
                    {t('activation.recipes.customize')}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
