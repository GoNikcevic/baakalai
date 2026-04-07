import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../services/api-client';

/**
 * 3-step prospect generator for a campaign in prep:
 * 1. Search (Lemlist Leads / Apollo / ...) — returns profiles without emails
 * 2. Reveal emails — async enrichment via Lemlist (consumes credits)
 * 3. Add selected prospects to the campaign
 */
export default function ProspectGenerator({ campaign, onProspectsAdded }) {
  const [titles, setTitles] = useState(campaign.position || '');
  const [sectors, setSectors] = useState(campaign.sector || '');
  const [locations, setLocations] = useState(campaign.zone || '');
  const [companySizes, setCompanySizes] = useState(
    mapSizeToApollo(campaign.size) || '11-50'
  );
  const [limit, setLimit] = useState(25);

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]); // contacts with optional email + revealStatus
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [existingCount, setExistingCount] = useState(0);
  const [source, setSource] = useState(null);

  // Reveal state
  const [revealing, setRevealing] = useState(false);
  const [revealJobId, setRevealJobId] = useState(null);
  const [revealProgress, setRevealProgress] = useState({ done: 0, total: 0 });
  const [showRevealConfirm, setShowRevealConfirm] = useState(false);

  // Credits
  const [credits, setCredits] = useState(null); // null = unknown, number = value, 'error' = failed
  const [creditsConfigured, setCreditsConfigured] = useState(true);

  const pollRef = useRef(null);

  // Load existing prospect count + credits on mount
  useEffect(() => {
    const backendId = campaign._backendId || campaign.id;
    api.listCampaignProspects(backendId)
      .then(data => setExistingCount((data.prospects || []).length))
      .catch(() => {});
    api.getLemlistCredits()
      .then(data => {
        if (data.configured === false) setCreditsConfigured(false);
        else if (data.error || data.credits == null) setCredits('error');
        else setCredits(data.credits);
      })
      .catch(() => setCredits('error'));
  }, [campaign._backendId, campaign.id]);

  // Cleanup polling on unmount
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  /* ── Step 1: Search ── */
  const handleSearch = async () => {
    setSearching(true);
    setError(null);
    setResults([]);
    setSelected(new Set());
    try {
      const criteria = {
        titles: titles.split(',').map(s => s.trim()).filter(Boolean),
        sectors: sectors.split(',').map(s => s.trim()).filter(Boolean),
        locations: locations.split(',').map(s => s.trim()).filter(Boolean),
        companySizes: [companySizes],
        limit: parseInt(limit, 10) || 25,
      };
      const data = await api.searchProspects(criteria);
      const contacts = (data.contacts || []).map(c => ({
        ...c,
        revealStatus: c.email ? 'verified' : 'pending',
      }));
      setResults(contacts);
      setSource(data.source || 'lemlist');
      setSelected(new Set(contacts.map(c => c.id)));
    } catch (err) {
      setError(err.message || 'Recherche échouée');
    }
    setSearching(false);
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* ── Step 2: Reveal emails ── */
  const selectedNeedingReveal = results.filter(
    c => selected.has(c.id) && !c.email && c.revealStatus !== 'not_found' && c.revealStatus !== 'error'
  );

  const startReveal = async () => {
    setShowRevealConfirm(false);
    setRevealing(true);
    setError(null);
    try {
      const leadsToReveal = selectedNeedingReveal;
      const data = await api.revealEmails(source || 'lemlist', leadsToReveal);
      setRevealJobId(data.jobId);
      setRevealProgress({ done: 0, total: leadsToReveal.length });

      // Mark them as pending in UI
      setResults(prev => prev.map(c =>
        leadsToReveal.find(l => l.id === c.id) ? { ...c, revealStatus: 'revealing' } : c
      ));

      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const status = await api.pollRevealEmails(data.jobId);
          setRevealProgress({ done: status.done, total: status.total });

          // Update results with any resolved entries
          setResults(prev => prev.map(c => {
            const r = status.results.find(r => r.id === c.id);
            if (!r || r.status === 'pending') return c;
            return {
              ...c,
              email: r.email || c.email,
              revealStatus: r.status,
            };
          }));

          if (status.status === 'done') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setRevealing(false);
            setRevealJobId(null);
            // Refresh credits
            api.getLemlistCredits()
              .then(data => {
                if (data.credits != null) setCredits(data.credits);
              })
              .catch(() => {});
          }
        } catch (err) {
          console.warn('Poll error:', err.message);
        }
      }, 3000);
    } catch (err) {
      setError(err.message || 'Révélation échouée');
      setRevealing(false);
    }
  };

  const cancelReveal = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setRevealing(false);
    setRevealJobId(null);
    setError('Révélation annulée — tu peux relancer manuellement.');
  };

  /* ── Step 3: Save to campaign ── */
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only save contacts with a verified email
      const contacts = results.filter(c => selected.has(c.id) && c.email);
      if (contacts.length === 0) {
        setError("Aucun contact avec email vérifié dans la sélection. Révèle d'abord les emails.");
        setSaving(false);
        return;
      }
      const backendId = campaign._backendId || campaign.id;
      const data = await api.addProspectsToCampaign(backendId, contacts);
      setExistingCount(prev => prev + (data.created || 0));
      setResults([]);
      setSelected(new Set());
      if (onProspectsAdded) onProspectsAdded(data.created);
    } catch (err) {
      setError(err.message || 'Sauvegarde échouée');
    }
    setSaving(false);
  };

  /* ── Derived state ── */
  const currentStep = results.length === 0 ? 1 : selectedNeedingReveal.length > 0 || revealing ? 2 : 3;
  const selectedWithEmail = results.filter(c => selected.has(c.id) && c.email).length;
  const creditCost = selectedNeedingReveal.length;

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px',
        marginBottom: '24px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            🎯 Générer des prospects
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {existingCount > 0
              ? `${existingCount} prospect${existingCount > 1 ? 's' : ''} déjà dans la campagne`
              : 'Aucun prospect dans la campagne pour le moment'}
          </div>
        </div>
        {credits !== null && credits !== 'error' && creditsConfigured && (
          <div
            style={{
              fontSize: 12,
              background: 'var(--bg-elevated)',
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}
            title="Crédits Lemlist Leads restants (pour révéler les emails)"
          >
            💳 {credits} crédits Lemlist
          </div>
        )}
      </div>

      {/* Stepper */}
      <Stepper step={currentStep} />

      {/* Step 1: Search form (always visible) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px',
          marginBottom: '12px',
        }}
      >
        <Field label="Titres (séparés par virgule)" value={titles} onChange={setTitles} placeholder="CEO, COO, Head of Lab" />
        <Field label="Secteurs (séparés par virgule)" value={sectors} onChange={setSectors} placeholder="Biotech, Diagnostics" />
        <Field label="Localisations" value={locations} onChange={setLocations} placeholder="France, Germany" />
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Taille d'entreprise</label>
          <select
            className="form-input"
            value={companySizes}
            onChange={e => setCompanySizes(e.target.value)}
            style={{ marginTop: '4px' }}
          >
            <option value="1-10">1-10</option>
            <option value="11-50">11-50</option>
            <option value="51-200">51-200</option>
            <option value="201-500">201-500</option>
            <option value="501-1000">501-1000</option>
            <option value="1001+">1001+</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>Nombre max</label>
          <input
            className="form-input"
            type="number"
            min="1"
            max="100"
            value={limit}
            onChange={e => setLimit(e.target.value)}
            style={{ marginTop: '4px' }}
          />
        </div>
      </div>

      <button
        className="btn btn-primary"
        onClick={handleSearch}
        disabled={searching}
        style={{ fontSize: '12px', padding: '8px 14px' }}
      >
        {searching ? 'Recherche en cours...' : '🔍 Chercher des prospects'}
      </button>

      {error && (
        <div
          style={{
            marginTop: '12px',
            padding: '10px 12px',
            background: 'var(--danger-bg)',
            border: '1px solid rgba(255,107,107,0.3)',
            borderRadius: 8,
            color: 'var(--danger)',
            fontSize: '12px',
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Step 2+3: Results */}
      {results.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              marginBottom: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>
              {results.length} résultat{results.length > 1 ? 's' : ''} — {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
              {selectedWithEmail > 0 && (
                <span style={{ color: 'var(--success)', marginLeft: 8 }}>
                  ({selectedWithEmail} avec email ✓)
                </span>
              )}
            </span>
            {revealing && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                ⏳ Révélation {revealProgress.done}/{revealProgress.total}
              </span>
            )}
          </div>

          {/* Helper text */}
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginBottom: 8,
              fontStyle: 'italic',
            }}
          >
            {currentStep === 2 && !revealing && `Étape 2 : décoche les non-pertinents, puis clique "Révéler" pour récupérer leurs emails (1 crédit Lemlist par contact).`}
            {revealing && `Lemlist enrichit les contacts via son API asynchrone. Délai ~20-30 secondes.`}
            {currentStep === 3 && `Étape 3 : vérifie les emails révélés (✅ verified / ❌ non trouvé) puis ajoute-les à la campagne.`}
          </div>

          <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {results.map(c => (
              <div
                key={c.id}
                onClick={() => !revealing && toggleSelect(c.id)}
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--border)',
                  cursor: revealing ? 'default' : 'pointer',
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'center',
                  background: selected.has(c.id) ? 'var(--bg-elevated)' : 'transparent',
                  opacity: revealing && !selected.has(c.id) ? 0.5 : 1,
                }}
              >
                <input type="checkbox" checked={selected.has(c.id)} readOnly disabled={revealing} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {c.name}
                    <RevealBadge status={c.revealStatus} email={c.email} />
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {c.title} · {c.company} · {c.location}
                    {c.email && <span style={{ color: 'var(--success)', marginLeft: 6 }}>· {c.email}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            {selectedNeedingReveal.length > 0 && !revealing && (
              <button
                className="btn btn-primary"
                onClick={() => setShowRevealConfirm(true)}
                disabled={credits !== null && credits !== 'error' && credits < selectedNeedingReveal.length}
                style={{ fontSize: '12px', padding: '8px 14px' }}
              >
                💰 Révéler {selectedNeedingReveal.length} email{selectedNeedingReveal.length > 1 ? 's' : ''} ({selectedNeedingReveal.length} crédit{selectedNeedingReveal.length > 1 ? 's' : ''})
              </button>
            )}

            {revealing && (
              <button
                className="btn btn-ghost"
                onClick={cancelReveal}
                style={{ fontSize: '12px', padding: '8px 14px' }}
              >
                ✕ Annuler
              </button>
            )}

            {!revealing && selectedWithEmail > 0 && (
              <button
                className="btn btn-success"
                onClick={handleSave}
                disabled={saving}
                style={{ fontSize: '12px', padding: '8px 14px' }}
              >
                {saving ? 'Ajout...' : `➕ Ajouter ${selectedWithEmail} à la campagne`}
              </button>
            )}
          </div>

          {credits !== null && credits !== 'error' && credits < selectedNeedingReveal.length && selectedNeedingReveal.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 6 }}>
              ⚠️ Solde insuffisant : {credits} crédits dispo, {selectedNeedingReveal.length} requis.
            </div>
          )}
        </div>
      )}

      {/* Confirmation modal for reveal */}
      {showRevealConfirm && (
        <ConfirmRevealModal
          count={selectedNeedingReveal.length}
          credits={credits}
          onConfirm={startReveal}
          onCancel={() => setShowRevealConfirm(false)}
        />
      )}
    </div>
  );
}

function Stepper({ step }) {
  const steps = [
    { n: 1, label: 'Recherche', icon: '🔍' },
    { n: 2, label: 'Révéler les emails', icon: '💰' },
    { n: 3, label: 'Ajouter à la campagne', icon: '➕' },
  ];
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
      {steps.map((s, i) => (
        <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i < steps.length - 1 ? 1 : 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 600,
              background: step === s.n ? 'var(--accent)' : step > s.n ? 'rgba(0, 214, 143, 0.15)' : 'var(--bg-elevated)',
              color: step === s.n ? 'white' : step > s.n ? 'var(--success)' : 'var(--text-muted)',
              border: `1px solid ${step === s.n ? 'var(--accent)' : step > s.n ? 'rgba(0, 214, 143, 0.3)' : 'var(--border)'}`,
              whiteSpace: 'nowrap',
            }}
          >
            {step > s.n ? '✓' : s.icon} {s.label}
          </div>
          {i < steps.length - 1 && (
            <div
              style={{
                flex: 1,
                height: 2,
                background: step > s.n ? 'var(--success)' : 'var(--border)',
                borderRadius: 1,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function RevealBadge({ status, email }) {
  if (status === 'verified' && email) {
    return <span style={{ fontSize: 10, color: 'var(--success)', fontWeight: 600 }}>✅ Verified</span>;
  }
  if (status === 'not_found') {
    return <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 600 }}>❌ Email non trouvé</span>;
  }
  if (status === 'error') {
    return <span style={{ fontSize: 10, color: 'var(--warning)', fontWeight: 600 }}>⚠️ Erreur</span>;
  }
  if (status === 'revealing') {
    return <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}>⏳ Révélation…</span>;
  }
  return <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>(email non révélé)</span>;
}

function ConfirmRevealModal({ count, credits, onConfirm, onCancel }) {
  const creditDisplay = credits === null || credits === 'error' ? 'inconnu' : credits;
  const afterReveal = typeof credits === 'number' ? credits - count : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          maxWidth: 440,
          width: '90%',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          💰 Révéler {count} email{count > 1 ? 's' : ''} ?
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
          Cette action va consommer <strong>{count} crédit{count > 1 ? 's' : ''} Lemlist Leads</strong>.
          <br />
          Solde actuel : <strong>{creditDisplay}</strong>
          {afterReveal !== null && (
            <>
              {' → '}
              <strong style={{ color: afterReveal < 10 ? 'var(--warning)' : 'var(--text-primary)' }}>
                {afterReveal} après
              </strong>
            </>
          )}
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>
          L'enrichissement est asynchrone — délai ~20-30 secondes.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel} style={{ fontSize: 12 }}>
            Annuler
          </button>
          <button className="btn btn-primary" onClick={onConfirm} style={{ fontSize: 12 }}>
            Confirmer et révéler
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</label>
      <input
        className="form-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ marginTop: '4px' }}
      />
    </div>
  );
}

function mapSizeToApollo(size) {
  if (!size) return null;
  const s = String(size).toLowerCase();
  if (s.includes('1-10')) return '1-10';
  if (s.includes('11-50') || s.includes('10-50')) return '11-50';
  if (s.includes('50-200') || s.includes('51-200')) return '51-200';
  if (s.includes('200') || s.includes('500')) return '201-500';
  if (s.includes('500') || s.includes('1000')) return '501-1000';
  if (s.includes('1000+') || s.includes('1001')) return '1001+';
  return null;
}
