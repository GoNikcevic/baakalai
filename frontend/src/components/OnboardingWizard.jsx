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

const TOTAL_STEPS = 3;

const SECTOR_SUGGESTIONS = [
  'SaaS / Logiciel', 'Tech / IT', 'E-commerce / Retail', 'Finance / Comptabilité',
  'Formation professionnelle', 'Marketing / Communication', 'Immobilier',
  'Santé / Pharma', 'Industrie / Manufacturing', 'Conseil / Consulting',
  'RH / Recrutement', 'Juridique / Legal', 'Assurance', 'Énergie / Environnement',
  'Transport / Logistique', 'Agroalimentaire', 'BTP / Construction',
  'Média / Presse', 'Tourisme / Hôtellerie', 'Autre',
];

/* ─── Step config ─── */

const STEP_META = [
  { title: 'Votre entreprise & cible', desc: 'Parlez-nous de vous et de qui vous cherchez \u00E0 atteindre.' },
  { title: 'Connexion aux outils', desc: 'Connectez vos outils principaux. Vous pourrez en ajouter d\'autres plus tard.' },
  { title: 'Tout est pr\u00EAt !', desc: '' },
];

/* ─── Outreach options ─── */

const OUTREACH_OPTIONS = [
  {
    value: 'lemlist', label: 'Lemlist', field: 'lemlistKey', placeholder: 'Votre cl\u00E9 API Lemlist',
    guide: [
      'Connectez-vous sur app.lemlist.com',
      'Allez dans Settings \u2192 Integrations \u2192 API',
      'Copiez la cl\u00E9 affich\u00E9e et collez-la ci-dessous',
    ],
    link: 'https://app.lemlist.com/settings/integrations',
  },
  {
    value: 'apollo', label: 'Apollo', field: 'apolloKey', placeholder: 'Votre cl\u00E9 API Apollo',
    guide: [
      'Connectez-vous sur app.apollo.io',
      'Cliquez sur votre avatar \u2192 Settings \u2192 Integrations \u2192 API Keys',
      'Cr\u00E9ez une cl\u00E9 ou copiez une cl\u00E9 existante',
    ],
    link: 'https://app.apollo.io/#/settings/integrations/api-keys',
  },
  {
    value: 'instantly', label: 'Instantly', field: 'instantlyKey', placeholder: 'Votre cl\u00E9 API Instantly',
    guide: [
      'Connectez-vous sur app.instantly.ai',
      'Allez dans Settings \u2192 Integrations \u2192 API Key',
      'Copiez la cl\u00E9 et collez-la ci-dessous',
    ],
    link: 'https://app.instantly.ai/settings/integrations',
  },
  {
    value: 'smartlead', label: 'Smartlead', field: 'smartleadKey', placeholder: 'Votre cl\u00E9 API Smartlead',
    guide: [
      'Connectez-vous sur app.smartlead.ai',
      'Allez dans Settings \u2192 API \u2192 Copiez la cl\u00E9',
    ],
    link: 'https://app.smartlead.ai/settings',
  },
  {
    value: 'lgm', label: 'La Growth Machine', field: 'lgmKey', placeholder: 'Votre cl\u00E9 API LGM',
    guide: [
      'Connectez-vous sur app.lagrowthmachine.com',
      'Allez dans Settings \u2192 API',
      'Copiez votre cl\u00E9 API',
    ],
    link: 'https://app.lagrowthmachine.com/settings',
  },
  {
    value: 'waalaxy', label: 'Waalaxy', field: 'waalaxyKey', placeholder: 'Votre cl\u00E9 API Waalaxy',
    guide: [
      'Connectez-vous sur app.waalaxy.com',
      'Allez dans Settings \u2192 Integrations',
      'Copiez votre cl\u00E9 API',
    ],
    link: 'https://app.waalaxy.com/settings',
  },
];

const CRM_GUIDES = {
  hubspot: {
    guide: [
      'Connectez-vous sur app.hubspot.com',
      'Allez dans Settings \u2192 Integrations \u2192 Private Apps',
      'Cr\u00E9ez une app ou copiez le token (commence par pat-)',
    ],
    link: 'https://app.hubspot.com/settings/integrations',
  },
  pipedrive: {
    guide: [
      'Connectez-vous sur app.pipedrive.com',
      'Allez dans Settings \u2192 Personal preferences \u2192 API',
      'Copiez le token personnel affich\u00E9',
    ],
    link: 'https://app.pipedrive.com/settings/api',
  },
  salesforce: {
    guide: [
      'Connectez-vous sur votre instance Salesforce',
      'Allez dans Setup \u2192 Apps \u2192 Connected Apps',
      'Cr\u00E9ez une connected app et copiez le consumer key',
    ],
    link: null,
  },
  odoo: {
    guide: [
      'Connectez-vous sur votre instance Odoo',
      'Allez dans Param\u00E8tres \u2192 Technique \u2192 Base de donn\u00E9es',
      'Notez l\'URL, le nom de base, votre login et mot de passe',
    ],
    link: null,
  },
};

export default function OnboardingWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Step 1 — Company
  const [company, setCompany] = useState('');
  const [sector, setSector] = useState('');
  const [sectorOpen, setSectorOpen] = useState(false);
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
    if (outreachKey && outreachProvider) {
      if (outreachProvider === 'lemlist') {
        fetch('/api/settings/keys/sync-lemlist', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        }).catch(() => {});
      } else if (['apollo', 'instantly', 'smartlead'].includes(outreachProvider)) {
        fetch('/api/settings/keys/sync-outreach', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ provider: outreachProvider }),
        }).catch(() => {});
      }
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
              <div className="form-group" style={{ position: 'relative' }}>
                <label className="form-label">Secteur d'activité</label>
                <input
                  className="form-input"
                  placeholder="Ex: SaaS, Formation, Finance..."
                  value={sector}
                  onChange={e => setSector(e.target.value)}
                  onFocus={() => setSectorOpen(true)}
                  onBlur={() => setTimeout(() => setSectorOpen(false), 150)}
                />
                {sectorOpen && sector.length < 30 && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 8, maxHeight: 180, overflowY: 'auto',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
                    marginTop: 4,
                  }}>
                    {SECTOR_SUGGESTIONS
                      .filter(s => !sector || s.toLowerCase().includes(sector.toLowerCase()))
                      .map(s => (
                        <div
                          key={s}
                          style={{
                            padding: '8px 12px', fontSize: 13, cursor: 'pointer',
                            transition: 'background 0.1s',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-glow)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                          onMouseDown={() => { setSector(s); setSectorOpen(false); }}
                        >
                          {s}
                        </div>
                      ))}
                  </div>
                )}
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
              <div className="form-group">
                <label className="form-label">Secteurs cibles</label>
                <input className="form-input" placeholder="Ex: Finance, RH, SaaS" value={targetSectors} onChange={e => setTargetSectors(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Taille d'entreprise cible</label>
                <input className="form-input" placeholder="Ex: 11-50 salari\u00E9s" value={targetSize} onChange={e => setTargetSize(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Zone g\u00E9ographique</label>
                <input className="form-input" placeholder="Ex: France, \u00CEle-de-France" value={targetZones} onChange={e => setTargetZones(e.target.value)} />
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
                  {outreachProvider && (() => {
                    const opt = OUTREACH_OPTIONS.find(o => o.value === outreachProvider);
                    return (
                      <>
                        <div style={{
                          fontSize: 12, background: 'var(--paper-2)', borderRadius: 8,
                          padding: '10px 12px', marginBottom: 8, lineHeight: 1.6,
                        }}>
                          <ol style={{ margin: 0, paddingLeft: 16, color: 'var(--grey-700)' }}>
                            {(opt?.guide || []).map((s, i) => <li key={i}>{s}</li>)}
                          </ol>
                          {opt?.link && (
                            <a href={opt.link} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 11, color: 'var(--primary)', display: 'inline-block', marginTop: 6 }}>
                              Ouvrir {opt.label} {'\u2192'}
                            </a>
                          )}
                        </div>
                        <input
                          className="form-input"
                          type="password"
                          placeholder={opt?.placeholder}
                          value={outreachKey}
                          onChange={e => setOutreachKey(e.target.value)}
                        />
                      </>
                    );
                  })()}
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
                    <option value="odoo">Odoo</option>
                  </select>
                  {crmProvider && (() => {
                    const crmGuide = CRM_GUIDES[crmProvider];
                    return (
                      <>
                        <div style={{
                          fontSize: 12, background: 'var(--paper-2)', borderRadius: 8,
                          padding: '10px 12px', marginBottom: 8, lineHeight: 1.6,
                        }}>
                          <ol style={{ margin: 0, paddingLeft: 16, color: 'var(--grey-700)' }}>
                            {(crmGuide?.guide || []).map((s, i) => <li key={i}>{s}</li>)}
                          </ol>
                          {crmGuide?.link && (
                            <a href={crmGuide.link} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 11, color: 'var(--primary)', display: 'inline-block', marginTop: 6 }}>
                              Ouvrir {crmProvider.charAt(0).toUpperCase() + crmProvider.slice(1)} {'\u2192'}
                            </a>
                          )}
                        </div>
                        <input
                          className="form-input"
                          type="password"
                          placeholder={crmProvider === 'hubspot' ? 'pat-...' : 'Votre cl\u00E9 API'}
                          value={crmKey}
                          onChange={e => setCrmKey(e.target.value)}
                        />
                      </>
                    );
                  })()}
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
            <div className="wizard-complete-icon">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <div className="wizard-complete-title">Tout est prêt !</div>
            <div className="wizard-complete-desc">
              Votre espace Baakalai est configuré. Vous pouvez maintenant créer votre première campagne.
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
            <svg width="32" height="32" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
              <line x1="50" y1="50" x2="22" y2="26" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round"/>
              <line x1="50" y1="50" x2="82" y2="30" stroke="#9A84EB" strokeWidth="5" strokeLinecap="round"/>
              <line x1="50" y1="50" x2="30" y2="80" stroke="#C4B5FD" strokeWidth="5" strokeLinecap="round"/>
              <circle cx="22" cy="26" r="7" fill="#C4B5FD"/>
              <circle cx="82" cy="30" r="8" fill="#9A84EB"/>
              <circle cx="30" cy="80" r="7" fill="#C4B5FD"/>
              <circle cx="50" cy="50" r="13" fill="#6E57FA"/>
            </svg>
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
