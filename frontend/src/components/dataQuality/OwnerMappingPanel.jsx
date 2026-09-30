/* ===============================================================================
   BAKAL · Owner Mapping Panel

   Le contrôle « owner non rattaché » compte des AFFAIRES. C'est un nombre juste et un
   travail faux : la décision se prend une fois par personne. Quelques owners du CRM
   portent des dizaines d'affaires, et les faire défiler dans une file de saisie
   reviendrait à faire répéter N fois la même réponse. Cet écran renverse donc la
   granularité : une ligne par owner, un choix, et toutes ses affaires suivent.

   Pourquoi le rattachement échoue, d'ailleurs : il se fait UNIQUEMENT par égalité
   d'adresse email entre le CRM et l'équipe (lib/crm-owner-resolver.js). Dès que les deux
   mondes n'emploient pas la même adresse, l'affaire reste sans propriétaire, donc absente
   des vues par commercial et des relances nominatives, et rien ne le signale. Ce que
   l'utilisateur pose ici l'emporte sur cette heuristique.

   Enregistrer applique aussi la correspondance aux affaires existantes, tout de suite.
   Sans ce rattrapage, rien ne bougerait avant la prochaine synchronisation et le geste
   aurait l'air de n'avoir servi à rien.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT } from '../../i18n';
import Icon from '../Icon';

const PROVIDER_LABELS = {
  pipedrive: 'Pipedrive', hubspot: 'HubSpot', salesforce: 'Salesforce',
  odoo: 'Odoo', notion: 'Notion', airtable: 'Airtable', folk: 'Folk',
};

function formatAmount(value) {
  if (!value) return null;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

export default function OwnerMappingPanel({ onClose, onChanged }) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [choices, setChoices] = useState({});   // clé provider:ownerId → id du membre
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);

  const keyOf = (o) => `${o.provider}:${o.crmOwnerId}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await request('/data-quality/owner-mappings');
      setData(result);
      // Les correspondances déjà posées repartent cochées · l'écran montre l'état, pas
      // une page blanche à chaque visite.
      const initial = {};
      for (const m of result.mappings || []) initial[`${m.provider}:${m.crmOwnerId}`] = m.teamUserId;
      setChoices(initial);
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
      setData({ owners: [], members: [], mappings: [] });
    }
    setLoading(false);
  }, [t]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const owners = data?.owners || [];
  const members = data?.members || [];
  const pending = owners.filter(o => choices[keyOf(o)]);

  const save = async () => {
    const mappings = pending.map(o => ({
      provider: o.provider, crmOwnerId: o.crmOwnerId, teamUserId: choices[keyOf(o)],
    }));
    if (mappings.length === 0) return;

    setSaving(true);
    try {
      const result = await request('/data-quality/owner-mappings', {
        method: 'POST',
        body: JSON.stringify({ mappings }),
      });
      setDone(result);
      onChanged?.();
      showToast({
        type: 'success',
        title: t('dataQuality.ownerMapping.savedTitle'),
        message: t('dataQuality.ownerMapping.savedMessage', {
          owners: (result.saved || []).length,
          deals: result.reassigned || 0,
        }),
      });
      await load();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setSaving(false);
  };

  return createPortal(
    // Monté dans <body> : `.card` reste un bloc conteneur pour tout `position: fixed`
    // tant qu'une animation d'entrée y laisse un transform (voir FixQueuePanel).
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9998, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #fff)', borderRadius: 12, width: '100%', maxWidth: 760,
          maxHeight: '100%', minHeight: 'min(360px, 100%)', display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden',
        }}
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{t('dataQuality.ownerMapping.title')}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              {loading ? t('dataQuality.fixQueue.loading') : t('dataQuality.ownerMapping.subtitle', { n: owners.length })}
            </div>
          </div>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 12 }}>
              {t('dataQuality.fixQueue.loading')}
            </div>
          ) : owners.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--success)', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <Icon name="checkCircle" size={22} color="var(--success)" />
              {done ? t('dataQuality.ownerMapping.allMapped') : t('dataQuality.ownerMapping.noneToMap')}
            </div>
          ) : owners.map(owner => (
            <div
              key={keyOf(owner)}
              style={{
                display: 'flex', gap: 10, alignItems: 'center', padding: '10px 0',
                borderBottom: '1px solid var(--border-light)',
              }}
            >
              <div style={{ width: 260, flexShrink: 0, overflow: 'hidden' }}>
                <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {/* L'adresse du CRM quand on l'a, sinon l'identifiant brut · il ne dit
                      rien à personne, d'où le rappel du volume et d'un compte exemple. */}
                  {owner.email || t('dataQuality.ownerMapping.unknownOwner', { id: owner.crmOwnerId })}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {PROVIDER_LABELS[owner.provider] || owner.provider || '?'}
                  {' · '}
                  {t('dataQuality.ownerMapping.deals', { n: owner.dealCount })}
                  {owner.dealValue > 0 && ` · ${formatAmount(owner.dealValue)} €`}
                </div>
                {owner.sampleCompany && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    {t('dataQuality.ownerMapping.sample', { company: owner.sampleCompany })}
                  </div>
                )}
              </div>

              <select
                value={choices[keyOf(owner)] || ''}
                onChange={e => setChoices(prev => ({ ...prev, [keyOf(owner)]: e.target.value }))}
                style={{
                  flex: 1, padding: '6px 8px', fontSize: 12, borderRadius: 6,
                  border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)',
                }}
              >
                <option value="">{t('dataQuality.ownerMapping.choose')}</option>
                {members.map(m => (
                  <option key={m.id} value={m.id}>{m.name ? `${m.name}, ${m.email}` : m.email}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        {owners.length > 0 && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {t('dataQuality.ownerMapping.hint')}
            </span>
            <button
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '6px 14px', whiteSpace: 'nowrap' }}
              disabled={saving || pending.length === 0}
              onClick={save}
            >
              {saving ? '…' : t('dataQuality.ownerMapping.save', { n: pending.length })}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
