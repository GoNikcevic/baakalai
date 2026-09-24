/* ===============================================================================
   BAKAL · Signaux · ce que baakalai a remarqué sans qu'on le lui demande

   Le constat qui a produit cette refonte : 320 signaux en production, tous en
   statut « nouveau », zéro traité. La cause n'est pas le volume, c'est l'action
   qui était proposée. Une liste ligne à ligne offrait « Écrire un email »,
   c'est-à-dire un email rédigé à la main, multiplié par 320. Personne ne l'a
   payé une seule fois, et le compteur ne pouvait que monter.

   Ce qui change ici :

   - La liste est par TYPE, pas par ligne. 320 lignes ne se traitent pas,
     7 lignes se traitent.
   - Le score disparaît. Il servait à ordonner une file qu'on traite à la main ;
     dans un entonnoir de promotion il n'a plus de consommateur, et il entrait
     en concurrence avec le lead score sur 100 qui existe déjà ailleurs. Les
     FAITS restent (source fiable, contact joignable, deal ouvert) : ce sont les
     raisons derrière le score, et ils sont plus utiles que le nombre.
   - Deux verbes seulement, automatiser et ignorer. Aucun rédacteur d'email
     dans cette page : le clic sur une ligne ouvre la fiche, et l'email manuel
     se rédige sur Clients ou Deals, là où vit l'envoi à la main.
   =============================================================================== */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT, useI18n } from '../../i18n';
import Icon from '../Icon';
import AutomateWizard from './AutomateWizard';

const PANEL_PAGE = 50;

function relativeDate(iso, en) {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return en ? 'just now' : "à l'instant";
  if (h < 24) return en ? `${h}h ago` : `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return en ? 'yesterday' : 'hier';
  return en ? `${d}d ago` : `il y a ${d} j`;
}

/** Les faits derrière un signal, sans le nombre qui les résumait. */
function factsOf(signal) {
  const raw = signal.relevance_factors;
  if (!Array.isArray(raw)) return [];
  return raw.map(f => (typeof f === 'string' ? f : f?.label)).filter(Boolean).slice(0, 4);
}

export default function SignalsZone({ onAutomated }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const navigate = useNavigate();

  const [data, setData] = useState(null);
  const [showAutomated, setShowAutomated] = useState(false);
  const [typeSel, setTypeSel] = useState({});
  const [loadError, setLoadError] = useState(false);
  const [panel, setPanel] = useState(null);      // { signalType }
  const [wizard, setWizard] = useState(null);    // { signalTypes, preselected }

  // « Rien détecté » et « ça n'a pas chargé » ne sont pas le même écran. Les
  // confondre rend la page indiagnosticable : on regarde une liste vide sans
  // pouvoir savoir si c'est normal.
  const load = useCallback(() => {
    setLoadError(false);
    request('/signals/types')
      .then(setData)
      .catch(() => { setData({ families: [], totalNew: 0 }); setLoadError(true); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const selectedTypes = useMemo(
    () => Object.keys(typeSel).filter(k => typeSel[k]),
    [typeSel]
  );

  const ignoreType = async (signalType) => {
    try {
      const r = await request(`/signals/types/${signalType}/ignore`, { method: 'POST' });
      setPanel(null);
      load();
      showToast({
        type: 'success',
        title: t('automation.signals.typeIgnored'),
        message: t('automation.signals.typeIgnoredBody', { count: r.hidden || 0 }),
      });
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
  };

  const unignoreAll = async (types) => {
    await Promise.all(types.map(ty => request(`/signals/types/${ty}/ignore`, { method: 'DELETE' }).catch(() => {})));
    load();
  };

  if (!data) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '24px 0' }}>{t('common.loading')}</div>;
  }

  const families = data.families || [];
  const ignoredTypes = families.flatMap(f => f.types.filter(ty => ty.ignored).map(ty => ty.signalType));
  const visible = (fam) => fam.types.filter(ty => {
    if (ty.ignored) return false;
    if (ty.automated && !showAutomated) return false;
    // Un type qui n'a jamais rien remonté et qui n'est pas automatisé n'a
    // rien à dire : il encombrerait la liste des 9 types possibles.
    if (!ty.automated && ty.totalCount === 0) return false;
    return true;
  });

  const anyRow = families.some(f => visible(f).length > 0);

  return (
    <div>
      {/* En-tête de la veille */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, flexWrap: 'wrap', marginBottom: 12,
      }}>
        <div style={{ fontSize: 13, color: 'var(--grey-700)' }}>
          {data.lastScanAt
            ? t('automation.signals.lastScan', { when: relativeDate(data.lastScanAt, en) })
            : t('automation.signals.noScanYet')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowAutomated(v => !v)}
            aria-pressed={showAutomated}
            style={{
              display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'none',
              padding: 0, fontSize: 12.5, color: 'var(--grey-700)', cursor: 'pointer',
            }}
          >
            {t('automation.signals.showAutomated')}
            <span style={{
              width: 28, height: 16, borderRadius: 'var(--r-full)', position: 'relative',
              background: showAutomated ? 'var(--ink)' : 'var(--border-strong)',
              display: 'block', transition: 'background 0.15s ease',
            }}>
              <span style={{
                position: 'absolute', top: 2, left: showAutomated ? 14 : 2,
                width: 12, height: 12, borderRadius: '50%', background: 'var(--paper)',
                transition: 'left 0.15s ease',
              }} />
            </span>
          </button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 12, padding: '4px 12px' }}
            onClick={() => navigate('/activation?section=settings')}
          >
            {t('automation.signals.veilleSettings')}
          </button>
        </div>
      </div>

      {!anyRow && (
        <div className="card">
          <div className="card-body" style={{ padding: '32px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
              {loadError ? t('automation.signals.loadError.title') : t('automation.signals.empty.title')}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 520, margin: '0 auto 14px' }}>
              {loadError ? t('automation.signals.loadError.body') : t('automation.signals.empty.body')}
            </div>
            {/* Une zone vide ne doit pas être un cul-de-sac : un déclencheur
                s'arme très bien avant qu'un seul signal soit arrivé. */}
            <button
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '6px 16px' }}
              onClick={loadError ? load : () => navigate('/activation?section=triggers')}
            >
              {loadError ? t('automation.wizard.retry') : t('automation.signals.empty.cta')}
            </button>
          </div>
        </div>
      )}

      {anyRow && families.map(fam => {
        const rows = visible(fam);
        if (rows.length === 0) return null;
        const famNew = rows.reduce((a, r) => a + r.newCount, 0);
        return (
          <div key={fam.key} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
              <span style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                padding: '2px 8px', borderRadius: 'var(--r-full)',
                background: fam.key === 'veille' ? 'var(--lavender-soft)' : 'var(--paper-2)',
                color: fam.key === 'veille' ? 'var(--primary)' : 'var(--grey-700)',
              }}>
                {t(`automation.signals.family.${fam.key}.tag`)}
              </span>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{t(`automation.signals.family.${fam.key}.label`)}</span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t(`automation.signals.family.${fam.key}.hint`)} {t('automation.signals.familyCount', { count: famNew })}
              </span>
            </div>

            <div className="card" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 760, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--paper-2)', textAlign: 'left' }}>
                    <th style={{ width: 34, padding: '8px 0 8px 12px' }} />
                    <th style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--grey-500)', fontSize: 11 }}>
                      {t('automation.signals.col.type')}
                    </th>
                    <th style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--grey-500)', fontSize: 11, textAlign: 'right' }}>
                      {t('automation.signals.col.new')}
                    </th>
                    <th style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--grey-500)', fontSize: 11 }}>
                      {t('automation.signals.col.automated')}
                    </th>
                    <th style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--grey-500)', fontSize: 11 }}>
                      {t('automation.signals.col.companies')}
                    </th>
                    <th style={{ padding: '8px 12px', fontWeight: 500, color: 'var(--ink)', fontSize: 11 }}>
                      {t('automation.signals.col.last')} ↓
                    </th>
                    <th style={{ width: 130, padding: '8px 12px' }} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(ty => {
                    const canAuto = !ty.automated && ty.newCount > 0;
                    return (
                      <tr
                        key={ty.signalType}
                        onClick={() => setPanel({ signalType: ty.signalType })}
                        style={{
                          borderTop: '1px solid var(--border)', cursor: 'pointer',
                          opacity: ty.automated ? 0.75 : 1,
                        }}
                      >
                        <td style={{ padding: '10px 0 10px 12px' }} onClick={e => e.stopPropagation()}>
                          {canAuto && (
                            <input
                              type="checkbox"
                              checked={!!typeSel[ty.signalType]}
                              onChange={() => setTypeSel(s => ({ ...s, [ty.signalType]: !s[ty.signalType] }))}
                              aria-label={t('automation.signals.selectType')}
                            />
                          )}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 500 }}>
                          {t(`signals.type.${ty.signalType}`)}
                        </td>
                        <td style={{
                          padding: '10px 12px', textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                          color: ty.newCount ? 'var(--text-primary)' : 'var(--grey-400)',
                        }}>
                          {ty.automated ? 0 : ty.newCount}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: ty.automated ? 'var(--success)' : 'var(--grey-700)' }}>
                          {ty.automated
                            ? t('automation.signals.automatedTo', { workflow: ty.automated.workflowName })
                            : t('common.no')}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--grey-700)' }}>
                          {ty.companies.length > 0
                            ? ty.companies.join(', ') + (ty.companyCount > 3 ? ` +${ty.companyCount - 3}` : '')
                            : t('automation.signals.noCompany')}
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--grey-700)' }}>
                          {relativeDate(ty.lastDetectedAt, en)}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                          {canAuto && (
                            <button
                              className="btn btn-primary"
                              style={{ fontSize: 11, padding: '4px 12px' }}
                              onClick={() => setWizard({ signalTypes: [ty.signalType] })}
                            >
                              {t('automation.signals.automate')}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {ignoredTypes.length > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', gap: 10, alignItems: 'center' }}>
          {t('automation.signals.ignoredCount', { count: ignoredTypes.length })}
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '3px 10px' }}
            onClick={() => unignoreAll(ignoredTypes)}
          >
            {t('automation.signals.reactivate')}
          </button>
        </div>
      )}

      {/* Barre de sélection multiple : plusieurs types vers un même workflow,
          ce qui crée autant de déclencheurs. C'est le N vers 1 du modèle. */}
      {selectedTypes.length > 0 && !panel && !wizard && (
        <div style={{
          position: 'sticky', bottom: 16, marginTop: 16, display: 'flex', alignItems: 'center',
          gap: 12, padding: '10px 16px', borderRadius: 'var(--r-full)',
          background: 'var(--ink)', color: 'var(--paper)',
          boxShadow: '0 6px 24px rgba(0,0,0,0.18)',
        }}>
          <span style={{ fontSize: 13 }}>
            {t('automation.signals.typesSelected', { count: selectedTypes.length })}
          </span>
          <button
            onClick={() => setTypeSel({})}
            style={{ background: 'none', border: 'none', color: 'inherit', opacity: 0.7, fontSize: 12, cursor: 'pointer' }}
          >
            {t('automation.signals.clearSelection')}
          </button>
          <span style={{ flex: 1 }} />
          <button
            className="btn"
            style={{ fontSize: 12, padding: '5px 14px', background: 'var(--paper)', color: 'var(--ink)' }}
            onClick={() => setWizard({ signalTypes: selectedTypes })}
          >
            {selectedTypes.length > 1
              ? t('automation.signals.automateN', { count: selectedTypes.length })
              : t('automation.signals.automate')}
          </button>
        </div>
      )}

      {panel && (
        <SignalPanel
          signalType={panel.signalType}
          onClose={() => setPanel(null)}
          onIgnoreType={() => ignoreType(panel.signalType)}
          // La sélection faite dans le panneau est portée jusqu'au
          // récapitulatif : c'est elle qui devient le rattrapage, et
          // l'utilisateur doit y retrouver le compte qu'il a vu.
          onAutomate={(selectedIds) => {
            setWizard({
              signalTypes: [panel.signalType],
              preselected: selectedIds?.length ? { [panel.signalType]: selectedIds } : null,
            });
            setPanel(null);
          }}
          onChanged={load}
        />
      )}

      {wizard && (
        <AutomateWizard
          signalTypes={wizard.signalTypes}
          preselected={wizard.preselected}
          onClose={() => setWizard(null)}
          onDone={(report) => {
            setWizard(null);
            setTypeSel({});
            load();
            if (onAutomated) onAutomated(report);
          }}
        />
      )}
    </div>
  );
}

/* ═══════════════════ Le panneau d'un type ═══════════════════ */

function SignalPanel({ signalType, onClose, onIgnoreType, onAutomate, onChanged }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const navigate = useNavigate();

  const [items, setItems] = useState(null);
  const [total, setTotal] = useState(0);
  const [sel, setSel] = useState({});
  const [allIds, setAllIds] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    request(`/signals?type=${encodeURIComponent(signalType)}&status=new&limit=${PANEL_PAGE}`)
      .then(d => {
        setItems(d.signals || []);
        setTotal(d.counts?.new || (d.signals || []).length);
      })
      .catch(() => setItems([]));
  }, [signalType]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selCount = allIds ? allIds.length : Object.keys(sel).filter(k => sel[k]).length;

  /**
   * « Tout sélectionner » veut dire TOUS les signaux du type, pas les 50
   * affichés. Sans ça, l'utilisateur coche en croyant armer son stock entier
   * et n'en inscrit qu'une page : l'écart entre ce qu'il a vu et ce qui part
   * n'est pas rattrapable.
   */
  const toggleAll = async () => {
    if (allIds) { setAllIds(null); setSel({}); return; }
    try {
      const r = await request(`/signals/types/${encodeURIComponent(signalType)}/ids`);
      setAllIds(r.ids || []);
      setSel({});
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
  };

  const dismiss = async (ids) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await request('/signals/dismiss', { method: 'POST', body: JSON.stringify({ ids }) });
      setSel({});
      setAllIds(null);
      load();
      onChanged();
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setBusy(false);
  };

  const selectedIds = allIds || Object.keys(sel).filter(k => sel[k]);

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.25)', zIndex: 90 }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(460px, 100vw)',
          background: 'var(--bg-card)', borderLeft: '1px solid var(--border)',
          zIndex: 91, display: 'flex', flexDirection: 'column',
        }}
      >
        <header style={{ padding: '16px 20px 10px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 650 }}>
              {t(`signals.type.${signalType}`)} · {t('automation.signals.newCount', { count: total })}
            </div>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--grey-500)' }}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('automation.signals.sortRecent')}
            </span>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={onIgnoreType}
            >
              {t('automation.signals.ignoreType')}
            </button>
          </div>
        </header>

        <div style={{
          padding: '8px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!allIds} onChange={toggleAll} />
            {t('automation.signals.selectAll', { count: total })}
          </label>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 11, padding: '3px 10px', opacity: selCount ? 1 : 0.45 }}
            disabled={selCount === 0 || busy}
            onClick={() => dismiss(selectedIds)}
          >
            {t('automation.signals.ignoreSelection')}{selCount ? ` (${selCount})` : ''}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {items === null && (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>{t('common.loading')}</div>
          )}
          {items && items.length === 0 && (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--text-muted)' }}>
              {t('automation.signals.panelEmpty')}
            </div>
          )}
          {(items || []).map(s => {
            const facts = factsOf(s);
            const checked = allIds ? true : !!sel[s.id];
            return (
              <div
                key={s.id}
                style={{
                  display: 'flex', gap: 10, padding: '10px 20px',
                  borderBottom: '1px solid var(--border)', alignItems: 'flex-start',
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => { setAllIds(null); setSel(v => ({ ...v, [s.id]: !v[s.id] })); }}
                  style={{ marginTop: 3 }}
                  aria-label={t('automation.signals.selectSignal')}
                />
                {/* Le clic ouvre la FICHE, pas un rédacteur d'email. L'email
                    manuel se rédige sur Clients ou Deals. */}
                <button
                  onClick={() => {
                    if (s.opportunity_id) navigate(`/clients?contact=${s.opportunity_id}`);
                    else showToast({ type: 'info', title: t('automation.signals.noContactTitle'), message: t('automation.signals.noContactBody') });
                  }}
                  style={{
                    flex: 1, minWidth: 0, textAlign: 'left', background: 'none',
                    border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-primary)',
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{s.company_name || t('automation.signals.unknownCompany')}</div>
                  <div style={{ fontSize: 12, color: 'var(--grey-700)', marginTop: 1 }}>
                    {s.contact_name
                      ? `${s.contact_name}${s.contact_title ? `, ${s.contact_title}` : ''}`
                      : t('automation.signals.unknownContact')}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>{s.title}</div>
                  {facts.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
                      {facts.map((f, i) => (
                        <span key={i} style={{
                          fontSize: 10.5, padding: '1px 8px', borderRadius: 'var(--r-full)',
                          background: 'var(--paper-2)', border: '1px solid var(--border)',
                          color: 'var(--grey-700)',
                        }}>{f}</span>
                      ))}
                    </div>
                  )}
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                  <span style={{ fontSize: 11, color: 'var(--grey-500)' }}>{relativeDate(s.detected_at, en)}</span>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 10.5, padding: '2px 8px' }}
                    disabled={busy}
                    onClick={() => dismiss([s.id])}
                  >
                    {t('automation.signals.ignore')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <footer style={{
          padding: '12px 20px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
            {t('automation.signals.shownOf', { shown: (items || []).length, total })}
          </span>
          <button
            className="btn btn-primary"
            style={{ fontSize: 12, padding: '6px 16px' }}
            onClick={() => onAutomate(selectedIds)}
          >
            {t('automation.signals.automate')}
          </button>
        </footer>
      </aside>
    </>
  );
}
