/* ===============================================================================
   BAKAL · Fix Queue Panel (Data Quality's "Général" tab)

   Le panneau qui remplace la liste dépliée de champs vides. Il tient sur une
   idée : quand l'adresse d'un contact est laura@acme-industries.fr, son
   entreprise n'est pas une question posée à l'utilisateur, c'est une valeur que
   baakalai sait déduire. L'utilisateur relit et valide, il ne saisit plus.

   Trois qualités de proposition, distinguées parce que la confiance n'est pas
   la même et que l'utilisateur doit pouvoir régler son niveau de relecture :
     · « Déjà dans votre CRM » · un autre contact du même domaine porte cette
       entreprise. On reprend SON orthographe, ce qui évite d'écrire une
       variante et d'alimenter le détecteur de doublons du même écran.
     · « D'après le domaine » · dérivé du domaine seul, juste la plupart du
       temps, approximatif sur les sigles. À relire.
     · « Correction proposée » · l'adresse corrigée d'une faute de frappe,
       calculée par le scan.
   Aucune n'est écrite sans un clic : elles arrivent dans un champ modifiable.

   Trois choses que l'écran précédent ne permettait pas et qui comptent autant
   que les propositions : appliquer une sélection d'un seul geste (découpée en
   lots côté réseau, mais un seul groupe d'annulation), écarter une sélection
   d'un seul geste, et travailler les contacts qui portent un deal ouvert avant
   les fiches mortes · c'est l'ordre dans lequel le serveur rend la liste.

   Écarter en masse n'est pas une commodité, c'est parfois LA réponse. Sur
   « domaine email invalide », 93 contacts portent un domaine qui n'existe pas :
   il n'y a aucune valeur à deviner, et retaper 93 adresses ne veut rien dire.
   Le seul geste juste est de dire que ces contacts-là ne sont pas rattrapables.
   D'où une case à cocher sur CHAQUE ligne, y compris celles qui n'ont rien à
   écrire : la sélection sert aux deux gestes, pas seulement à l'application.
   =============================================================================== */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT } from '../../i18n';
import Icon from '../Icon';

const PAGE_SIZE = 25;
// Taille d'une requête d'application · doit rester alignée avec MAX_BATCH_ITEMS dans
// routes/data-quality.js. Chaque contact déclenche un appel à l'API du CRM, donc une
// correction de 140 contacts part en plusieurs requêtes plutôt qu'en une seule qui
// dépasserait le délai du proxy. Elles partagent un groupId pour rester annulables
// d'un seul geste, et la progression avance à chaque lot au lieu de figer le bouton.
const BATCH_SIZE = 25;

const SOURCE_STYLES = {
  crm: { color: 'var(--success)', labelKey: 'dataQuality.fixQueue.sourceCrm' },
  domain: { color: 'var(--blue)', labelKey: 'dataQuality.fixQueue.sourceDomain' },
  typo: { color: 'var(--blue)', labelKey: 'dataQuality.fixQueue.sourceTypo' },
};

function formatAmount(value) {
  if (!value) return null;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

export default function FixQueuePanel({ provider, issueType, issueLabel, onClose, onChanged }) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState(null);
  const [values, setValues] = useState({});
  const [selected, setSelected] = useState(() => new Set());
  const [handled, setHandled] = useState({});   // id → { value, kind: 'saved' | 'ignored' }
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const inputRefs = useRef({});
  // Le parent ne se rafraîchit qu'à la fermeture : rescanner à chaque ligne
  // corrigée relancerait un scan CRM complet sous les doigts de l'utilisateur.
  const touched = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request('/data-quality/fix-queue', {
        method: 'POST',
        body: JSON.stringify({ provider, issueType }),
      });
      setQueue(data);
      // Le champ part de la proposition quand il y en a une, sinon de la valeur actuelle :
      // sur une adresse invalide, corriger une faute de frappe en repartant de l'adresse
      // existante vaut mieux que de la retaper entière. Une valeur inchangée n'est jamais
      // proposée à l'application, c'est ce que vérifie isActionable.
      const initial = {};
      for (const row of data.rows || []) initial[row.id] = row.suggestion || row.currentValue || '';
      setValues(initial);
      setSelected(new Set());
      setPage(0);
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
      setQueue({ rows: [], total: 0, listed: 0 });
    }
    setLoading(false);
  }, [provider, issueType, t]);

  useEffect(() => { load(); }, [load]);

  const handleClose = useCallback(() => {
    if (touched.current) onChanged?.();
    onClose();
  }, [onChanged, onClose]);

  // Échap ferme le panneau · un panneau plein écran sans sortie au clavier est
  // un piège pour qui ne navigue pas à la souris.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  const rows = useMemo(() => queue?.rows || [], [queue]);
  const pending = useMemo(() => rows.filter(r => !handled[r.id]), [rows, handled]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return pending;
    return pending.filter(r =>
      (r.name || '').toLowerCase().includes(q) ||
      (r.email || '').toLowerCase().includes(q) ||
      (values[r.id] || '').toLowerCase().includes(q)
    );
  }, [pending, search, values]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = visible.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  // Une ligne n'est applicable que si sa valeur est non vide ET différente de celle qui est
  // déjà en base : réécrire une adresse invalide à l'identique produirait une ligne
  // d'historique pour un changement qui n'en est pas un.
  const isActionable = useCallback((row) => {
    const v = (values[row.id] || '').trim();
    return Boolean(v) && v !== (row.currentValue || '').trim();
  }, [values]);

  // Une ligne se coche toujours, même sans valeur à écrire : la sélection sert aux deux
  // gestes de masse, appliquer ET écarter. Sur « domaine email invalide », la plupart des
  // lignes n'ont rien à appliquer et tout à écarter · les rendre non cochables les
  // priverait du seul geste qui les concerne.
  const applicableIds = useMemo(
    () => pending.filter(r => selected.has(r.id) && isActionable(r)).map(r => r.id),
    [pending, selected, isActionable]
  );
  const crmSourcedIds = useMemo(
    () => pending.filter(r => r.suggestionSource === 'crm' && isActionable(r)).map(r => r.id),
    [pending, isActionable]
  );
  const suggestedCount = useMemo(() => pending.filter(isActionable).length, [pending, isActionable]);
  const selectedCount = selected.size;
  const doneCount = Object.keys(handled).length;

  const toggle = (id) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const setValue = (id, v) => setValues(prev => ({ ...prev, [id]: v }));

  const applyMany = async (ids) => {
    const items = ids
      .map(id => ({ crmContactId: id, value: (values[id] || '').trim() }))
      .filter(it => it.value);
    if (items.length === 0) return;

    // Un identifiant de groupe pour toute la correction, même découpée en plusieurs
    // requêtes : l'onglet Historique l'annule alors d'un seul clic.
    const groupId = crypto.randomUUID();
    let applied = 0;
    let failed = 0;

    setBusy(true);
    try {
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const chunk = items.slice(i, i + BATCH_SIZE);
        const result = await request('/data-quality/enrich-field/batch', {
          method: 'POST',
          body: JSON.stringify({ provider, field: queue.field, items: chunk, groupId }),
        });
        touched.current = true;
        applied += (result.applied || []).length;
        failed += (result.failed || []).length;
        // Marqué lot par lot : sur 140 contacts, la barre de progression avance pendant
        // l'opération au lieu de sauter d'un coup à la fin.
        setHandled(prev => {
          const next = { ...prev };
          for (const a of result.applied || []) next[a.crmContactId] = { value: a.value, kind: 'saved' };
          return next;
        });
        setSelected(prev => {
          const next = new Set(prev);
          for (const a of result.applied || []) next.delete(a.crmContactId);
          return next;
        });
      }

      if (failed > 0) {
        showToast({
          type: 'error',
          title: t('dataQuality.fixQueue.partialTitle'),
          message: t('dataQuality.fixQueue.partialMessage', { applied, failed }),
        });
      } else {
        showToast({
          type: 'success',
          title: t('dataQuality.fixQueue.appliedTitle'),
          message: t('dataQuality.fixQueue.appliedMessage', { n: applied }),
        });
      }
    } catch (err) {
      // Une requête qui casse en cours de route laisse les lots déjà passés appliqués ·
      // ils sont marqués, et le message dit ce qui reste.
      showToast({
        type: 'error',
        title: t('common.error'),
        message: applied > 0
          ? t('dataQuality.fixQueue.interrupted', { applied, message: err.message })
          : err.message,
      });
    }
    setBusy(false);
  };

  // Écarter en masse compte autant qu'appliquer en masse, et sur certains contrôles
  // davantage : quand 93 contacts portent un domaine qui n'existe pas, il n'y a aucune
  // valeur à deviner et retaper 93 adresses n'a aucun sens. La seule action juste est de
  // dire « ces contacts-là ne sont pas rattrapables », d'un geste.
  const ignoreMany = async (ids) => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      await request('/data-quality/ignore', {
        method: 'POST',
        body: JSON.stringify({ provider, issueType, contactIds: ids }),
      });
      touched.current = true;
      setHandled(prev => {
        const next = { ...prev };
        for (const id of ids) next[id] = { kind: 'ignored' };
        return next;
      });
      setSelected(prev => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      if (ids.length > 1) {
        showToast({
          type: 'success',
          title: t('dataQuality.fixQueue.ignoredTitle'),
          message: t('dataQuality.fixQueue.ignoredMessage', { n: ids.length }),
        });
      }
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
    setBusy(false);
  };

  const restore = async (id) => {
    try {
      await request('/data-quality/ignore', {
        method: 'DELETE',
        body: JSON.stringify({ provider, issueType, contactIds: [id] }),
      });
      setHandled(prev => { const n = { ...prev }; delete n[id]; return n; });
    } catch (err) {
      showToast({ type: 'error', title: t('common.error'), message: err.message });
    }
  };

  // Entrée enregistre la ligne et descend à la suivante · la saisie de dix
  // valeurs d'affilée se fait alors sans jamais lâcher le clavier.
  const onRowKeyDown = (e, index) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const row = pageRows[index];
    if (row && isActionable(row)) applyMany([row.id]);
    const next = pageRows[index + 1];
    if (next) inputRefs.current[next.id]?.focus();
  };

  const truncated = queue && queue.listed < queue.total;

  // Monté dans <body>, pas là où le composant est écrit, et ce n'est pas un détail de
  // style : `.card` porte `animation: rise-in ... both` (index.css), donc le transform des
  // keyframes lui reste appliqué après coup. Un élément transformé devient le bloc
  // conteneur de ses descendants en `position: fixed`. Rendu dans la carte, le panneau
  // calculait son `inset: 0` sur les 100 pixels de la carte au lieu de la fenêtre : le
  // voile ne couvrait que la carte et tout le contenu sous l'en-tête était rogné.
  return createPortal(
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9998, display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)', padding: 24,
      }}
      onClick={handleClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card, #fff)', borderRadius: 12, width: '100%', maxWidth: 880,
          // 100% d'un parent en `inset: 0` vaut la hauteur de la fenêtre moins le padding ·
          // la hauteur minimale évite qu'un écran très court ne laisse voir que l'en-tête.
          maxHeight: '100%', minHeight: 'min(420px, 100%)',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden',
        }}
      >
        {/* ── En-tête ── */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>{issueLabel}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              {loading ? t('dataQuality.fixQueue.loading') : t('dataQuality.fixQueue.subtitle', {
                remaining: pending.length,
                suggested: suggestedCount,
              })}
            </div>
            {truncated && (
              <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4 }}>
                {t('dataQuality.fixQueue.truncated', { listed: queue.listed, total: queue.total })}
              </div>
            )}
          </div>
          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }} onClick={handleClose}>
            <Icon name="close" size={14} />
          </button>
        </div>

        {/* ── Barre d'action ── */}
        {!loading && pending.length > 0 && (
          <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={selectedCount > 0 && selectedCount === pending.length}
                onChange={e => setSelected(e.target.checked ? new Set(pending.map(r => r.id)) : new Set())}
              />
              {t('dataQuality.fixQueue.selectAll', { n: pending.length })}
            </label>

            {crmSourcedIds.length > 0 && crmSourcedIds.length < suggestedCount && (
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: '4px 10px' }}
                onClick={() => setSelected(new Set(crmSourcedIds))}
              >
                {t('dataQuality.fixQueue.selectCrmOnly', { n: crmSourcedIds.length })}
              </button>
            )}

            <div style={{ position: 'relative', flex: 1, minWidth: 160 }}>
              <Icon name="search" size={12} color="var(--text-muted)" style={{ position: 'absolute', left: 8, top: 8 }} />
              <input
                type="text"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
                placeholder={t('dataQuality.fixQueue.searchPlaceholder')}
                style={{ width: '100%', padding: '5px 8px 5px 24px', fontSize: 12, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-primary)' }}
              />
            </div>

            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '6px 12px', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}
              disabled={busy || selectedCount === 0}
              onClick={() => ignoreMany([...selected])}
              title={t('dataQuality.fixQueue.ignoreHint')}
            >
              {t('dataQuality.fixQueue.ignoreSelection', { n: selectedCount })}
            </button>

            <button
              className="btn btn-primary"
              style={{ fontSize: 11, padding: '6px 12px', whiteSpace: 'nowrap' }}
              // Compté et filtré sur applicableIds, pas sur la sélection brute : une ligne
              // sans valeur à écrire, ou ramenée à sa valeur d'origine, est cochable pour
              // être écartée mais ne doit pas repartir en écriture.
              disabled={busy || applicableIds.length === 0}
              onClick={() => applyMany(applicableIds)}
            >
              {busy ? '…' : t('dataQuality.fixQueue.applySelection', { n: applicableIds.length })}
            </button>
          </div>
        )}

        {/* ── Progression ── */}
        {doneCount > 0 && (
          <div style={{ padding: '8px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 4, background: 'var(--border-light)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${Math.round((doneCount / rows.length) * 100)}%`, height: '100%', background: 'var(--success)', transition: 'width 0.2s ease' }} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {t('dataQuality.fixQueue.progress', { done: doneCount, total: rows.length })}
            </span>
          </div>
        )}

        {/* ── Liste ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 12 }}>
              {t('dataQuality.fixQueue.loading')}
            </div>
          ) : pending.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--success)', fontSize: 13, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <Icon name="checkCircle" size={22} color="var(--success)" />
              {t('dataQuality.fixQueue.allDone')}
            </div>
          ) : visible.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 12 }}>
              {t('dataQuality.fixQueue.noMatch')}
            </div>
          ) : pageRows.map((row, i) => {
            const value = values[row.id] || '';
            const sourceStyle = row.suggestionSource ? SOURCE_STYLES[row.suggestionSource] : null;
            const edited = row.suggestion && value.trim() !== row.suggestion;
            const actionable = isActionable(row);
            return (
              <div
                key={row.id}
                style={{
                  display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0',
                  borderBottom: '1px solid var(--border-light)',
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(row.id)}
                  onChange={() => toggle(row.id)}
                  style={{ flexShrink: 0 }}
                />

                <div style={{ width: 200, flexShrink: 0, overflow: 'hidden' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.name || t('dataQuality.fixQueue.unnamed')}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.email || t('dataQuality.fixQueue.noEmail')}
                  </div>
                  {row.hasOpenDeal && (
                    <div style={{ fontSize: 10, color: 'var(--accent)', marginTop: 2 }}>
                      {t('dataQuality.fixQueue.openDeal', { amount: formatAmount(row.dealValue) })}
                    </div>
                  )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <input
                    ref={el => { inputRefs.current[row.id] = el; }}
                    type="text"
                    value={value}
                    onChange={e => setValue(row.id, e.target.value)}
                    onKeyDown={e => onRowKeyDown(e, i)}
                    placeholder={t('dataQuality.fixQueue.inputPlaceholder')}
                    style={{
                      width: '100%', padding: '5px 8px', fontSize: 12, borderRadius: 6,
                      border: `1px solid ${sourceStyle && !edited ? sourceStyle.color : 'var(--border)'}`,
                      background: 'var(--bg-card)', color: 'var(--text-primary)',
                    }}
                  />
                  {sourceStyle && (
                    <div style={{ fontSize: 10, color: edited ? 'var(--text-muted)' : sourceStyle.color, marginTop: 2 }}>
                      {edited ? t('dataQuality.fixQueue.edited') : t(sourceStyle.labelKey)}
                    </div>
                  )}
                </div>

                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '4px 8px', whiteSpace: 'nowrap', flexShrink: 0 }}
                  disabled={busy || !actionable}
                  onClick={() => applyMany([row.id])}
                  title={t('dataQuality.fixQueue.saveHint')}
                >
                  {t('dataQuality.fixQueue.save')}
                </button>

                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 11, padding: '4px 8px', whiteSpace: 'nowrap', flexShrink: 0, color: 'var(--text-muted)' }}
                  disabled={busy}
                  onClick={() => ignoreMany([row.id])}
                  title={t('dataQuality.fixQueue.ignoreHint')}
                >
                  {t('dataQuality.fixQueue.ignore')}
                </button>
              </div>
            );
          })}

          {/* Ce qui vient d'être traité reste visible, et reste annulable. */}
          {doneCount > 0 && (
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border-light)' }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                {t('dataQuality.fixQueue.handledTitle')}
              </div>
              {rows.filter(r => handled[r.id]).map(row => {
                const h = handled[row.id];
                return (
                  <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, padding: '3px 0', color: 'var(--text-muted)' }}>
                    <Icon name={h.kind === 'ignored' ? 'ban' : 'checkCircle'} size={12} color={h.kind === 'ignored' ? 'var(--text-muted)' : 'var(--success)'} />
                    <span style={{ minWidth: 180 }}>{row.name || row.email || '?'}</span>
                    <span style={{ flex: 1, color: h.kind === 'ignored' ? 'var(--text-muted)' : 'var(--success)' }}>
                      {h.kind === 'ignored' ? t('dataQuality.fixQueue.ignoredLabel') : h.value}
                    </span>
                    {h.kind === 'ignored' && (
                      <button
                        className="btn btn-ghost"
                        style={{ fontSize: 10, padding: '2px 8px' }}
                        onClick={() => restore(row.id)}
                      >
                        {t('dataQuality.fixQueue.restore')}
                      </button>
                    )}
                  </div>
                );
              })}
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>
                {t('dataQuality.fixQueue.undoHint')}
              </div>
            </div>
          )}
        </div>

        {/* ── Pagination ── */}
        {pageCount > 1 && (
          <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px' }}
              disabled={safePage === 0}
              onClick={() => setPage(p => Math.max(0, p - 1))}
            >
              {t('dataQuality.fixQueue.previous')}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {t('dataQuality.fixQueue.pageOf', { page: safePage + 1, pages: pageCount })}
            </span>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px' }}
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
            >
              {t('dataQuality.fixQueue.next')}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
