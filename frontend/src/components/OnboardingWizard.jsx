/* ===============================================================================
   BAKAL — Onboarding Wizard (React)
   Multi-step wizard shown on first login. Steps:
   1. Welcome + company basics
   2. Core API keys (Outreach tool selector + CRM)
   3. Target & persona
   4. Communication style
   5. Done — recap
   Sets localStorage 'bakal_onboarding_complete' on finish.
   =============================================================================== */

import { useState, useCallback } from 'react';
import { saveKeys } from '../services/api-client';

const TOTAL_STEPS = 5;

/* ─── Step config ─── */

const STEP_META = [
  { title: 'Bienvenue sur Baakal', desc: 'Quelques informations pour personnaliser votre expérience.' },
  { title: 'Connexion aux outils', desc: 'Connectez vos outils principaux. Vous pourrez en ajouter d\'autres plus tard.' },
  { title: 'Votre cible', desc: 'Aidez Claude à comprendre qui vous cherchez à atteindre.' },
  { title: 'Style de communication', desc: 'Définissez le ton de vos campagnes.' },
  { title: 'Tout est prêt !', desc: '' },
];

/* ─── Outreach options ─── */

const OUTREACH_OPTIONS = [
  { value: 'lemlist', label: 'Lemlist', field: 'lemlistKey', placeholder: 'Votre clé API Lemlist' },
  { value: 'apollo', label: 'Apollo', field: 'apolloKey', placeholder: 'Votre clé API Apollo' },
  { value: 'instantly', label: 'Instantly', field: 'instantlyKey', placeholder: 'Votre clé API Instantly' },
  { value: 'lgm', label: 'La Growth Machine', field: 'lgmKey', placeholder: 'Votre clé API LGM' },
  { value: 'waalaxy', label: 'Waalaxy', field: 'waalaxyKey', placeholder: 'Votre clé API Waalaxy' },
];

export default function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 1 — Company
  const [company, setCompany] = useState('');
  const [sector, setSector] = useState('');
  const [website, setWebsite] = useState('');
  const [teamSize, setTeamSize] = useState('');

  // Step 2 — Keys
  const [outreachProvider, setOutreachProvider] = useState('');
  const [outreachKey, setOutreachKey] = useState('');
  const [crmProvider, setCrmProvider] = useState('');
  const [crmKey, setCrmKey] = useState('');
  const [keySaveStatus, setKeySaveStatus] = useState(null); // 'saved' | 'error' | null

  // Step 3 — Target
  const [targetSectors, setTargetSectors] = useState('');
  const [targetSize, setTargetSize] = useState('');
  const [targetZones, setTargetZones] = useState('');
  const [personaPrimary, setPersonaPrimary] = useState('');

  // Step 4 — Style
  const [tone, setTone] = useState('Pro décontracté');
  const [formality, setFormality] = useState('Vous');
  const [valueProp, setValueProp] = useState('');

  /* ─── Navigation ─── */

  function next() {
    if (step < TOTAL_STEPS - 1) setStep(s => s + 1);
  }
  function prev() {
    if (step > 0) setStep(s => s - 1);
  }

  /* ─── Save keys (step 2) ─── */

  const handleSaveKeys = useCallback(async () => {
    const keysToSave = {};
    if (outreachKey.trim() && outreachProvider) {
      const outreach = OUTREACH_OPTIONS.find(o => o.value === outreachProvider);
      if (outreach) keysToSave[outreach.field] = outreachKey.trim();
    }
    if (crmKey.trim() && crmProvider) {
      const crmFieldMap = { hubspot: 'hubspotKey', pipedrive: 'pipedriveKey', salesforce: 'salesforceKey' };
      const field = crmFieldMap[crmProvider];
      if (field) keysToSave[field] = crmKey.trim();
    }
    if (Object.keys(keysToSave).length === 0) { next(); return; }

    setSaving(true);
    try {
      const res = await saveKeys(keysToSave);
      if (res.errors && res.errors.length > 0) {
        setKeySaveStatus('error');
      } else {
        setKeySaveStatus('saved');
        next();
      }
    } catch {
      setKeySaveStatus('error');
    } finally {
      setSaving(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outreachKey, outreachProvider, crmKey, crmProvider]);

  /* ─── Save profile + complete ─── */

  function handleFinish() {
    // Save profile to localStorage (ProfilePage will pick it up)
    const profile = {
      company, sector, website, team_size: teamSize,
      target_sectors: targetSectors, target_size: targetSize, target_zones: targetZones,
      persona_primary: personaPrimary,
      default_tone: tone, default_formality: formality,
      value_prop: valueProp,
    };
    localStorage.setItem('bakal_profile', JSON.stringify(profile));

    // Also try to save to backend
    const token = localStorage.getItem('bakal_token');
    fetch('/api/profile', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(profile),
    }).catch(() => {/* ignore */});

    // Trigger auto-sync in background if keys were provided
    if (outreachKey && outreachProvider === 'lemlist') {
      // Only trigger lemlist sync if they chose Lemlist
      fetch('/api/settings/keys/sync-lemlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }).catch(() => {});
    }
    if (crmKey && crmProvider) {
      fetch('/api/settings/keys/sync-crm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }).catch(() => {});
    }

    localStorage.setItem('bakal_onboarding_complete', 'true');
    if (onComplete) onComplete();
  }

  /* ─── Derive outreach label for checklist ─── */

  const selectedOutreach = OUTREACH_OPTIONS.find(o => o.value === outreachProvider);
  const outreachLabel = selectedOutreach ? selectedOutreach.label : 'Outreach';

  /* ─── Step dots ─── */

  function renderDots() {
    return (
      <div className="wizard-steps">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={`wizard-step-dot${i === step ? ' active' : ''}${i < step ? ' done' : ''}`}
          />
        ))}
      </div>
    );
  }

  /* ─── Render steps ─── */

  function renderStep() {
    switch (step) {
      case 0:
        return (
          <>
            <div className="wizard-step-title">{STEP_META[0].title}</div>
            <div className="wizard-step-desc">{STEP_META[0].desc}</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Nom de l'entreprise</label>
                <input className="form-input" placeholder="Ex: FormaPro Consulting" value={company} onChange={e => setCompany(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Secteur d'activité</label>
                <input className="form-input" placeholder="Ex: Formation professionnelle" value={sector} onChange={e => setSector(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Site web</label>
                <input className="form-input" type="url" placeholder="https://..." value={website} onChange={e => setWebsite(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Taille d'équipe</label>
                <select className="form-input" value={teamSize} onChange={e => setTeamSize(e.target.value)}>
                  <option value="">-- Sélectionner --</option>
                  <option value="1-5">1-5</option>
                  <option value="6-10">6-10</option>
                  <option value="11-25">11-25</option>
                  <option value="26-50">26-50</option>
                  <option value="51-100">51-100</option>
                  <option value="100+">100+</option>
                </select>
              </div>
            </div>
          </>
        );

      case 1:
        return (
          <>
            <div className="wizard-step-title">{STEP_META[1].title}</div>
            <div className="wizard-step-desc">{STEP_META[1].desc}</div>
            <div className="wizard-core-keys">
              <div className="wizard-key-row">
                <div className="wizard-key-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <div className="wizard-key-input">
                  <div className="wizard-key-label">Outil d'outreach</div>
                  <select className="form-input" value={outreachProvider} onChange={e => { setOutreachProvider(e.target.value); setOutreachKey(''); }} style={{ marginBottom: 8 }}>
                    <option value="">-- Sélectionner votre outil --</option>
                    {OUTREACH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {outreachProvider && (
                    <>
                      <input
                        className="form-input"
                        type="password"
                        placeholder={OUTREACH_OPTIONS.find(o => o.value === outreachProvider)?.placeholder}
                        value={outreachKey}
                        onChange={e => setOutreachKey(e.target.value)}
                      />
                      <div className="wizard-key-hint">
                        Trouvable dans {outreachProvider === 'lemlist' ? 'Lemlist \u2192 Settings \u2192 Integrations' : `${selectedOutreach?.label || outreachProvider} \u2192 Settings \u2192 API`}
                      </div>
                    </>
                  )}
                </div>
              </div>
              <div className="wizard-key-row">
                <div className="wizard-key-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div className="wizard-key-input">
                  <div className="wizard-key-label">CRM (optionnel)</div>
                  <select
                    className="form-input"
                    value={crmProvider}
                    onChange={e => { setCrmProvider(e.target.value); setCrmKey(''); }}
                    style={{ marginBottom: 8 }}
                  >
                    <option value="">-- Sélectionner votre CRM --</option>
                    <option value="hubspot">HubSpot</option>
                    <option value="pipedrive">Pipedrive</option>
                    <option value="salesforce">Salesforce</option>
                  </select>
                  {crmProvider && (
                    <>
                      <input
                        className="form-input"
                        type="password"
                        placeholder={crmProvider === 'hubspot' ? 'pat-...' : 'Votre clé API'}
                        value={crmKey}
                        onChange={e => setCrmKey(e.target.value)}
                      />
                      <div className="wizard-key-hint">
                        {crmProvider === 'hubspot' && 'Trouvable dans HubSpot \u2192 Settings \u2192 Integrations \u2192 Private Apps'}
                        {crmProvider === 'pipedrive' && 'Trouvable dans Pipedrive \u2192 Settings \u2192 Personal preferences \u2192 API'}
                        {crmProvider === 'salesforce' && 'Trouvable dans Salesforce \u2192 Setup \u2192 Apps \u2192 Connected Apps'}
                      </div>
                    </>
                  )}
                </div>
              </div>
              {keySaveStatus === 'error' && (
                <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>
                  Format de clé invalide. Vérifiez et réessayez.
                </div>
              )}
            </div>
          </>
        );

      case 2:
        return (
          <>
            <div className="wizard-step-title">{STEP_META[2].title}</div>
            <div className="wizard-step-desc">{STEP_META[2].desc}</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Secteurs cibles</label>
                <input className="form-input" placeholder="Ex: Finance, RH, Formation" value={targetSectors} onChange={e => setTargetSectors(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Taille d'entreprise cible</label>
                <input className="form-input" placeholder="Ex: 11-50 salariés" value={targetSize} onChange={e => setTargetSize(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Zones géographiques</label>
                <input className="form-input" placeholder="Ex: Île-de-France, Lyon" value={targetZones} onChange={e => setTargetZones(e.target.value)} />
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label">Persona principal</label>
              <textarea
                className="form-input"
                rows={3}
                placeholder="Décrivez votre interlocuteur idéal : poste, responsabilités, défis..."
                value={personaPrimary}
                onChange={e => setPersonaPrimary(e.target.value)}
              />
            </div>
          </>
        );

      case 3:
        return (
          <>
            <div className="wizard-step-title">{STEP_META[3].title}</div>
            <div className="wizard-step-desc">{STEP_META[3].desc}</div>
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">Ton par défaut</label>
                <select className="form-input" value={tone} onChange={e => setTone(e.target.value)}>
                  <option value="Pro décontracté">Pro décontracté</option>
                  <option value="Formel">Formel</option>
                  <option value="Amical">Amical</option>
                  <option value="Direct">Direct</option>
                  <option value="Expert">Expert</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Formalité</label>
                <select className="form-input" value={formality} onChange={e => setFormality(e.target.value)}>
                  <option value="Vous">Vous</option>
                  <option value="Tu">Tu</option>
                </select>
              </div>
            </div>
            <div className="form-group" style={{ marginTop: 16 }}>
              <label className="form-label">Proposition de valeur</label>
              <textarea
                className="form-input"
                rows={3}
                placeholder="Quel problème résolvez-vous et quelle est votre promesse client ?"
                value={valueProp}
                onChange={e => setValueProp(e.target.value)}
              />
            </div>
          </>
        );

      case 4:
        return (
          <>
            <div className="wizard-complete-icon">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div className="wizard-complete-title">Tout est prêt !</div>
            <div className="wizard-complete-desc">
              Votre espace Baakal est configuré. Vous pouvez maintenant créer votre première campagne.
            </div>
            <div className="wizard-checklist">
              <div className="wizard-check-item">
                <span className="wizard-check-icon">{company ? '\u2705' : '\u2B1C'}</span>
                <span>Profil entreprise {company ? `\u2014 ${company}` : '(à compléter plus tard)'}</span>
              </div>
              <div className="wizard-check-item">
                <span className="wizard-check-icon">{outreachKey && outreachProvider ? '\u2705' : '\u2B1C'}</span>
                <span>{outreachLabel} {outreachKey && outreachProvider ? '\u2014 Connecté' : '(à configurer dans Paramètres)'}</span>
              </div>
              <div className="wizard-check-item">
                <span className="wizard-check-icon">{crmKey && crmProvider ? '\u2705' : '\u2B1C'}</span>
                <span>CRM {crmKey && crmProvider ? `\u2014 ${crmProvider.charAt(0).toUpperCase() + crmProvider.slice(1)}` : '(optionnel \u2014 configurable dans Paramètres)'}</span>
              </div>
              <div className="wizard-check-item">
                <span className="wizard-check-icon">{targetSectors || personaPrimary ? '\u2705' : '\u2B1C'}</span>
                <span>Ciblage {targetSectors ? `\u2014 ${targetSectors}` : '(à compléter plus tard)'}</span>
              </div>
              <div className="wizard-check-item">
                <span className="wizard-check-icon">{'\u2705'}</span>
                <span>Style \u2014 {tone}, {formality}</span>
              </div>
            </div>
          </>
        );

      default:
        return null;
    }
  }

  /* ─── Actions per step ─── */

  function renderActions() {
    if (step === TOTAL_STEPS - 1) {
      return (
        <div className="wizard-actions">
          <button className="btn btn-primary" onClick={handleFinish}>
            Accéder au dashboard
          </button>
        </div>
      );
    }

    return (
      <div className="wizard-actions">
        {step > 0 && (
          <button className="btn btn-ghost" onClick={prev}>Retour</button>
        )}
        {step === 1 ? (
          <button className="btn btn-primary" onClick={handleSaveKeys} disabled={saving}>
            {saving ? 'Sauvegarde...' : 'Continuer'}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={next}>
            Continuer
          </button>
        )}
      </div>
    );
  }

  /* ─── Main render ─── */

  return (
    <div className="wizard-overlay">
      <div className="wizard-modal">
        <div className="wizard-header">
          <div className="wizard-logo">
            <span style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 40, height: 40, background: 'var(--text-primary)', color: 'var(--bg-primary)',
              borderRadius: 10, fontWeight: 700, fontSize: 20,
            }}>b</span>
          </div>
          <div className="wizard-title">{STEP_META[step].title}</div>
          {STEP_META[step].desc && <div className="wizard-subtitle">{STEP_META[step].desc}</div>}
        </div>

        {renderDots()}

        <div className="wizard-body">
          {renderStep()}
          {renderActions()}

          {step < TOTAL_STEPS - 1 && (
            <div className="wizard-skip" onClick={() => {
              localStorage.setItem('bakal_onboarding_complete', 'true');
              if (onComplete) onComplete();
            }}>
              Passer l'onboarding
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
