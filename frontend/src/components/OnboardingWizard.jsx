/* ===============================================================================
   BAKAL — Onboarding Wizard (React)
   Multi-step wizard shown on first login. Steps:
   1. Company basics + documents
   2. CRM first (hero job — 7 providers), then outreach + targeting (optional)
   3. Done — recap + first CRM import
   Sets localStorage 'bakal_onboarding_complete' on finish.
   =============================================================================== */

import { useState, useCallback, useRef, useEffect } from 'react';
import { saveKeys, request, trackEvent } from '../services/api-client';
import { useT, useI18n } from '../i18n';

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

function getStepMeta(t) {
  return [
    { title: t('wizard.step1Title'), desc: t('wizard.step1Desc') },
    { title: t('wizard.step2Title'), desc: t('wizard.step2Desc') },
    { title: t('wizard.step3Title'), desc: '' },
  ];
}

/* ─── Compte-rendu de lecture CRM (affiché après le premier import) ─── */

function moneyEUR(n) {
  if (!n) return '0\u00a0€';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M\u00a0€`;
  if (n >= 1000) return `${Math.round(n / 1000)}k\u00a0€`;
  return `${Math.round(n)}\u00a0€`;
}

function renderReadingSummary(s, t) {
  return (
    <div>
      <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
        {t('wizard.readTitle')
          .replace('{count}', s.totalDeals)
          .replace('{value}', moneyEUR(s.openValue))}
      </div>
      {s.dormant.count > 0 ? (
        <>
          <div style={{ marginTop: 6 }}>
            {t('wizard.readDormant')
              .replace('{count}', s.dormant.count)
              .replace('{value}', moneyEUR(s.dormant.value))}
          </div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {s.dormant.top.map(d => (
              <li key={d.id}>
                <strong>{d.name}</strong>
                {d.company ? ` (${d.company})` : ''}
                {' — '}{moneyEUR(d.dealValue)}
                {' · '}{t('wizard.readDaysInactive').replace('{days}', d.daysInactive)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div style={{ marginTop: 6 }}>{t('wizard.readNoDormant')}</div>
      )}
      {s.dataGaps.missingValue > 0 && (
        <div style={{ marginTop: 8, color: 'var(--grey-500)', fontSize: 12 }}>
          {t('wizard.readGaps').replace('{count}', s.dataGaps.missingValue)}
        </div>
      )}
    </div>
  );
}

/* ─── Outreach options ─── */

const OUTREACH_OPTIONS = [
  {
    value: 'lemlist', label: 'Lemlist', field: 'lemlistKey',
    guideFr: [
      'Connectez-vous sur app.lemlist.com',
      'Allez dans Settings \u2192 Integrations \u2192 API',
      'Copiez la cl\u00E9 affich\u00E9e et collez-la ci-dessous',
    ],
    guideEn: [
      'Sign in to app.lemlist.com',
      'Go to Settings \u2192 Integrations \u2192 API',
      'Copy the displayed key and paste it below',
    ],
    link: 'https://app.lemlist.com/settings/integrations',
  },
  {
    value: 'apollo', label: 'Apollo', field: 'apolloKey',
    guideFr: [
      'Connectez-vous sur app.apollo.io',
      'Cliquez sur votre avatar \u2192 Settings \u2192 Integrations \u2192 API Keys',
      'Cr\u00E9ez une cl\u00E9 ou copiez une cl\u00E9 existante',
    ],
    guideEn: [
      'Sign in to app.apollo.io',
      'Click your avatar \u2192 Settings \u2192 Integrations \u2192 API Keys',
      'Create a key or copy an existing one',
    ],
    link: 'https://app.apollo.io/#/settings/integrations/api-keys',
  },
  {
    value: 'instantly', label: 'Instantly', field: 'instantlyKey',
    guideFr: [
      'Connectez-vous sur app.instantly.ai',
      'Allez dans Settings \u2192 Integrations \u2192 API Key',
      'Copiez la cl\u00E9 et collez-la ci-dessous',
    ],
    guideEn: [
      'Sign in to app.instantly.ai',
      'Go to Settings \u2192 Integrations \u2192 API Key',
      'Copy the key and paste it below',
    ],
    link: 'https://app.instantly.ai/settings/integrations',
  },
  {
    value: 'smartlead', label: 'Smartlead', field: 'smartleadKey',
    guideFr: [
      'Connectez-vous sur app.smartlead.ai',
      'Allez dans Settings \u2192 API \u2192 Copiez la cl\u00E9',
    ],
    guideEn: [
      'Sign in to app.smartlead.ai',
      'Go to Settings \u2192 API \u2192 Copy the key',
    ],
    link: 'https://app.smartlead.ai/settings',
  },
  {
    value: 'lgm', label: 'La Growth Machine', field: 'lgmKey',
    guideFr: [
      'Connectez-vous sur app.lagrowthmachine.com',
      'Allez dans Settings \u2192 API',
      'Copiez votre cl\u00E9 API',
    ],
    guideEn: [
      'Sign in to app.lagrowthmachine.com',
      'Go to Settings \u2192 API',
      'Copy your API key',
    ],
    link: 'https://app.lagrowthmachine.com/settings',
  },
  {
    value: 'waalaxy', label: 'Waalaxy', field: 'waalaxyKey',
    guideFr: [
      'Connectez-vous sur app.waalaxy.com',
      'Allez dans Settings \u2192 Integrations',
      'Copiez votre cl\u00E9 API',
    ],
    guideEn: [
      'Sign in to app.waalaxy.com',
      'Go to Settings \u2192 Integrations',
      'Copy your API key',
    ],
    link: 'https://app.waalaxy.com/settings',
  },
];

const CRM_GUIDES = {
  hubspot: {
    guideFr: [
      'Connectez-vous sur app.hubspot.com',
      'Allez dans Settings \u2192 Integrations \u2192 Private Apps',
      'Cr\u00E9ez une app ou copiez le token (commence par pat-)',
    ],
    guideEn: [
      'Sign in to app.hubspot.com',
      'Go to Settings \u2192 Integrations \u2192 Private Apps',
      'Create an app or copy the token (starts with pat-)',
    ],
    link: 'https://app.hubspot.com/settings/integrations',
  },
  pipedrive: {
    guideFr: [
      'Connectez-vous sur app.pipedrive.com',
      'Allez dans Settings \u2192 Personal preferences \u2192 API',
      'Copiez le token personnel affich\u00E9',
    ],
    guideEn: [
      'Sign in to app.pipedrive.com',
      'Go to Settings \u2192 Personal preferences \u2192 API',
      'Copy the personal token displayed',
    ],
    link: 'https://app.pipedrive.com/settings/api',
  },
  salesforce: {
    guideFr: [
      'Connectez-vous sur votre instance Salesforce',
      'Allez dans Setup \u2192 Apps \u2192 Connected Apps',
      'Cr\u00E9ez une connected app et copiez le consumer key',
    ],
    guideEn: [
      'Sign in to your Salesforce instance',
      'Go to Setup \u2192 Apps \u2192 Connected Apps',
      'Create a connected app and copy the consumer key',
    ],
    link: null,
  },
  odoo: {
    guideFr: [
      'Connectez-vous sur votre instance Odoo',
      'Allez dans Param\u00E8tres \u2192 Technique \u2192 Base de donn\u00E9es',
      "Notez l'URL, le nom de base, votre login et mot de passe",
    ],
    guideEn: [
      'Sign in to your Odoo instance',
      'Go to Settings \u2192 Technical \u2192 Database',
      'Note the URL, database name, your login and password',
    ],
    link: null,
  },
  notion: {
    guideFr: [
      'Cr\u00E9ez une int\u00E9gration sur notion.so/my-integrations',
      'Partagez votre base CRM avec cette int\u00E9gration (\u22EF \u2192 Connexions)',
      'Copiez le token (secret_... ou ntn_...) \u2014 vous choisirez la base dans Param\u00E8tres',
    ],
    guideEn: [
      'Create an integration at notion.so/my-integrations',
      'Share your CRM database with it (\u22EF \u2192 Connections)',
      'Copy the token (secret_... or ntn_...) \u2014 you will pick the database in Settings',
    ],
    link: 'https://www.notion.so/my-integrations',
  },
  airtable: {
    guideFr: [
      'Connectez-vous sur airtable.com',
      'Allez sur airtable.com/create/tokens et cr\u00E9ez un token personnel',
      'Accordez les scopes data.records:read et schema.bases:read, puis copiez le token (pat...)',
    ],
    guideEn: [
      'Sign in to airtable.com',
      'Go to airtable.com/create/tokens and create a personal token',
      'Grant data.records:read and schema.bases:read scopes, then copy the token (pat...)',
    ],
    link: 'https://airtable.com/create/tokens',
  },
  folk: {
    guideFr: [
      'Connectez-vous sur app.folk.app',
      'Allez dans Settings \u2192 API',
      'G\u00E9n\u00E9rez une cl\u00E9 API et copiez-la ci-dessous',
    ],
    guideEn: [
      'Sign in to app.folk.app',
      'Go to Settings \u2192 API',
      'Generate an API key and copy it below',
    ],
    link: null,
  },
};

/**
 * Champ saveKeys par fournisseur CRM \u2014 doit refl\u00E9ter PROVIDER_MAP c\u00F4t\u00E9
 * backend (routes/settings.js). Odoo/Notion/Airtable/Folk manquaient : le
 * wizard proposait Odoo dans la liste mais jetait silencieusement sa cl\u00E9.
 */
const CRM_FIELD_MAP = {
  hubspot: 'hubspotKey',
  pipedrive: 'pipedriveKey',
  salesforce: 'salesforceKey',
  odoo: 'odooKey',
  notion: 'notionToken',
  airtable: 'airtableKey',
  folk: 'folkKey',
};

export default function OnboardingWizard({ onComplete }) {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const STEP_META = getStepMeta(t);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Premier import CRM declenche a la fin du wizard.
  // status: 'idle' | 'running' | 'done' | 'error'
  const [importState, setImportState] = useState({ status: 'idle', imported: null, error: null });
  // Compte-rendu de lecture (/crm/reading-summary), affiché après l'import.
  const [readingSummary, setReadingSummary] = useState(null);
  // Empeche de rejouer la sauvegarde du profil / la synchro outreach au 2e clic.
  const setupDoneRef = useRef(false);

  // Document upload
  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

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
  const [crmKeyError, setCrmKeyError] = useState(null);
  // OAuth produit (hubspot/pipedrive) : connexion en un clic, sans clé API.
  const [crmOauthConnected, setCrmOauthConnected] = useState(null);
  const [oauthUnavailable, setOauthUnavailable] = useState(false);
  const [showKeyField, setShowKeyField] = useState(false);
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

  /* ─── Document upload ─── */

  const handleDocUpload = useCallback(async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (const f of files) formData.append('files', f);
      formData.append('docTypes', JSON.stringify(Array(files.length).fill('company')));
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('bakal_token')}` },
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setUploadedDocs(prev => [...prev, ...(data.documents || [{ name: 'Document uploaded' }])]);
      }
    } catch { /* ignore */ }
    setUploading(false);
  }, []);

  /* ─── Retour de redirection OAuth (hubspot/pipedrive) ─── */

  // Le flow OAuth recharge la page entière : on restaure le brouillon du
  // wizard sauvegardé juste avant la redirection, puis on reprend à
  // l'étape CRM avec l'état de connexion.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('crm_connected');
    const oauthError = params.get('crm_error');
    if (!connected && !oauthError) return;

    try {
      const draft = JSON.parse(localStorage.getItem('bakal_wizard_draft') || 'null');
      if (draft) {
        if (draft.company) setCompany(draft.company);
        if (draft.sector) setSector(draft.sector);
        if (draft.website) setWebsite(draft.website);
        if (draft.teamSize) setTeamSize(draft.teamSize);
        if (draft.targetSectors) setTargetSectors(draft.targetSectors);
        if (draft.targetSize) setTargetSize(draft.targetSize);
        if (draft.targetZones) setTargetZones(draft.targetZones);
        if (draft.personaPrimary) setPersonaPrimary(draft.personaPrimary);
        if (draft.tone) setTone(draft.tone);
        if (draft.formality) setFormality(draft.formality);
        if (draft.valueProp) setValueProp(draft.valueProp);
        if (draft.outreachProvider) setOutreachProvider(draft.outreachProvider);
        if (draft.outreachKey) setOutreachKey(draft.outreachKey);
      }
    } catch { /* brouillon illisible : on repart des champs vides */ }
    localStorage.removeItem('bakal_wizard_draft');

    if (connected) {
      setCrmProvider(connected);
      setCrmOauthConnected(connected);
    } else {
      setShowKeyField(true);
      setCrmKeyError(t('wizard.oauthFailed'));
    }
    setStep(1);
    window.history.replaceState({}, '', window.location.pathname);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Navigation ─── */

  function next() {
    if (step < TOTAL_STEPS - 1) {
      trackEvent('wizard_step_done', { step });
      setStep(s => s + 1);
    }
  }
  function prev() {
    if (step > 0) setStep(s => s - 1);
  }

  /* ─── OAuth CRM (hubspot/pipedrive) ─── */

  async function handleConnectOauth() {
    try {
      // La redirection OAuth recharge la page : sauvegarder le brouillon
      // pour ne pas perdre ce que l'utilisateur a déjà rempli.
      localStorage.setItem('bakal_wizard_draft', JSON.stringify({
        company, sector, website, teamSize, targetSectors, targetSize, targetZones,
        personaPrimary, tone, formality, valueProp, outreachProvider, outreachKey,
      }));
      const res = await request(`/crm/${crmProvider}/connect?from=wizard`);
      if (res.url) {
        trackEvent('crm_oauth_started', { provider: crmProvider });
        window.location.href = res.url;
        return;
      }
      throw new Error('no url');
    } catch {
      // 501 : l'app OAuth n'est pas encore enregistrée chez le fournisseur
      // → repli silencieux sur le champ clé API.
      localStorage.removeItem('bakal_wizard_draft');
      setOauthUnavailable(true);
      setShowKeyField(true);
    }
  }

  /* ─── Save keys (step 2) ─── */

  const handleSaveKeys = useCallback(async () => {
    const keysToSave = {};
    if (outreachKey.trim() && outreachProvider) {
      const outreach = OUTREACH_OPTIONS.find(o => o.value === outreachProvider);
      if (outreach) keysToSave[outreach.field] = outreachKey.trim();
    }
    if (crmKey.trim() && crmProvider) {
      const field = CRM_FIELD_MAP[crmProvider];
      if (field) keysToSave[field] = crmKey.trim();
    }
    if (Object.keys(keysToSave).length === 0) { next(); return; }

    setSaving(true);

    // Valider la clé CRM AVANT de la sauvegarder : sans ce contrôle, un token
    // invalide donnait une coche verte « CRM connecté » et l'utilisateur
    // découvrait le mensonge sur un import raté. On ne bloque que sur un refus
    // explicite du fournisseur (401) — un fournisseur injoignable ou non
    // testable (Salesforce) laisse passer.
    const crmField = crmKey.trim() && crmProvider ? CRM_FIELD_MAP[crmProvider] : null;
    if (crmField) {
      try {
        const token = localStorage.getItem('bakal_token');
        const res = await fetch('/api/settings/keys/test-one', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ field: crmField, key: crmKey.trim() }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok && body.result?.status === 'invalid') {
          trackEvent('crm_key_invalid', { provider: crmProvider });
          setCrmKeyError(t('wizard.crmKeyInvalid').replace('{provider}', crmProvider));
          setSaving(false);
          return;
        }
      } catch { /* test injoignable : ne pas bloquer l'inscription */ }
    }

    try {
      const res = await saveKeys(keysToSave);
      if (res.errors && res.errors.length > 0) {
        setKeySaveStatus('error');
      } else {
        setKeySaveStatus('saved');
        if (crmField) trackEvent('crm_connected', { provider: crmProvider });
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
    const token = localStorage.getItem('bakal_token');

    // Le bouton de l'etape 3 est cliquable deux fois : une fois pour lancer
    // l'import, une fois pour entrer dans l'app. Sans ce garde-fou, le second
    // clic renverrait le profil et relancerait la synchro outreach — donc un
    // double import chez le fournisseur.
    if (setupDoneRef.current) {
      finalize(token);
      return;
    }
    setupDoneRef.current = true;

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
    // Import CRM : volontairement PAS en fire-and-forget.
    //
    // L'appel précédent ne visait que /keys/sync-crm, qui déclenche l'ANALYSE
    // des deals — pas l'import des contacts. Résultat : un utilisateur
    // Pipedrive ou HubSpot terminait l'inscription avec zéro opportunité en
    // base, donc `segments.total === 0`, donc la QuickWinCard du dashboard
    // renvoyait null. Le « wow » n'avait aucune matière sur laquelle porter.
    //
    // On lance donc le vrai import et on attend son résultat, pour pouvoir
    // annoncer « N contacts importés » avant de rendre la main.
    if (crmProvider && importState.status === 'idle') {
      runFirstImport(crmProvider, token);
      return; // on ne rend la main qu'une fois le resultat annonce
    }
    finalize(token);
  }

  /**
   * Premier import CRM, avec état visible.
   *
   * Un échec ne bloque jamais la fin de l'inscription : l'utilisateur pourra
   * relancer l'import depuis Clients. Mais il doit le savoir, au lieu de
   * découvrir un dashboard vide sans explication.
   */
  async function runFirstImport(provider, token) {
    setImportState({ status: 'running', imported: null, error: null });
    try {
      const res = await fetch(`/api/crm/import/${provider}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

      setImportState({ status: 'done', imported: body.imported ?? 0, error: null });

      // Compte-rendu de lecture : pur SQL, disponible immédiatement. Échec
      // non bloquant — on retombe sur le message générique importDone.
      request('/crm/reading-summary')
        .then(setReadingSummary)
        .catch((err) => { console.warn('reading-summary failed:', err.message); });

      // L'analyse peut rester en tâche de fond : elle n'est pas nécessaire à
      // l'affichage des deals dormants, qui se calcule à la demande en SQL.
      fetch('/api/settings/keys/sync-crm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }).catch(() => {});
    } catch (err) {
      // On n'appelle PAS finalize ici : l'utilisateur doit voir le resultat,
      // succes comme echec, avant que le wizard se ferme. Le bouton de l'etape
      // 3 devient alors « Voir mes deals dormants » (ou « Continuer » en cas
      // d'echec) et c'est lui qui declenche finalize.
      setImportState({ status: 'error', imported: null, error: err.message });
    }
  }

  function finalize(token) {

    // Mark onboarding complete on backend (authoritative)
    fetch('/api/auth/onboarding-complete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    }).catch(() => {});

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
            <div className="form-grid">
              <div className="form-group">
                <label className="form-label">{t('wizard.companyName')}</label>
                <input className="form-input" placeholder="Ex: FormaPro Consulting" value={company} onChange={e => setCompany(e.target.value)} />
              </div>
              <div className="form-group" style={{ position: 'relative' }}>
                <label className="form-label">{t('wizard.sectorLabel')}</label>
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
                <label className="form-label">{t('wizard.website')}</label>
                <input className="form-input" type="url" placeholder="https://..." value={website} onChange={e => setWebsite(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">{t('wizard.teamSize')}</label>
                <select className="form-input" value={teamSize} onChange={e => setTeamSize(e.target.value)}>
                  <option value="">{t('wizard.selectPlaceholder')}</option>
                  <option value="1-5">1-5</option>
                  <option value="6-10">6-10</option>
                  <option value="11-25">11-25</option>
                  <option value="26-50">26-50</option>
                  <option value="51-100">51-100</option>
                  <option value="100+">100+</option>
                </select>
              </div>
            </div>

            {/* Document upload — required */}
            <div style={{ marginTop: 20, padding: 16, border: `2px dashed ${uploadedDocs.length > 0 ? 'var(--success)' : 'var(--accent)'}`, borderRadius: 12, background: 'var(--bg-elevated)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                {t('wizard.uploadTitle')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                {t('wizard.uploadDesc')}
              </div>
              <input ref={fileInputRef} type="file" multiple accept=".pdf,.docx,.txt,.csv,.xlsx,.png,.jpg" style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files?.length > 0) { handleDocUpload(e.target.files); e.target.value = ''; } }} />
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '8px 16px' }}
                onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                {uploading ? t('wizard.uploading') : t('wizard.uploadBtn')}
              </button>
              {uploadedDocs.length > 0 && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {uploadedDocs.map((d, i) => (
                    <div key={i} style={{ fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {d.original_name || d.name || 'Document'}
                    </div>
                  ))}
                </div>
              )}
              {uploadedDocs.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                  {t('wizard.uploadRequired')}
                </div>
              )}
            </div>
          </>
        );

      case 1:
        return (
          <>
            <div className="wizard-core-keys">
              {/* CRM en premier : c'est le hero job (réactivation de deals),
                  pas un à-côté. L'outreach et le ciblage descendent en bloc
                  optionnel — l'inverse de la version précédente. */}
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
                  <div className="wizard-key-label">{t('wizard.crmLabel')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                    {t('wizard.crmPitch')}
                  </div>
                  <select
                    className="form-input"
                    value={crmProvider}
                    onChange={e => { setCrmProvider(e.target.value); setCrmKey(''); setCrmKeyError(null); setShowKeyField(false); }}
                    style={{ marginBottom: 8 }}
                  >
                    <option value="">{t('wizard.selectCrm')}</option>
                    <option value="pipedrive">Pipedrive</option>
                    <option value="hubspot">HubSpot</option>
                    <option value="salesforce">Salesforce</option>
                    <option value="odoo">Odoo</option>
                    <option value="notion">Notion</option>
                    <option value="airtable">Airtable</option>
                    <option value="folk">Folk</option>
                  </select>
                  {crmProvider && (() => {
                    const crmGuide = CRM_GUIDES[crmProvider];
                    const guide = en ? (crmGuide?.guideEn || []) : (crmGuide?.guideFr || []);
                    const crmLabel = crmProvider.charAt(0).toUpperCase() + crmProvider.slice(1);

                    // Déjà connecté via OAuth : plus rien à saisir.
                    if (crmOauthConnected === crmProvider) {
                      return (
                        <div style={{
                          fontSize: 13, color: 'var(--success)', background: 'var(--paper-2)',
                          borderRadius: 8, padding: '10px 12px', lineHeight: 1.5,
                        }}>
                          {'✅'} {t('wizard.oauthConnected').replace('{provider}', crmLabel)}
                        </div>
                      );
                    }

                    const keyBlock = (
                      <>
                        <div style={{
                          fontSize: 12, background: 'var(--paper-2)', borderRadius: 8,
                          padding: '10px 12px', marginBottom: 8, lineHeight: 1.6,
                        }}>
                          <ol style={{ margin: 0, paddingLeft: 16, color: 'var(--grey-700)' }}>
                            {guide.map((s, i) => <li key={i}>{s}</li>)}
                          </ol>
                          {crmGuide?.link && (
                            <a href={crmGuide.link} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 11, color: 'var(--primary)', display: 'inline-block', marginTop: 6 }}>
                              {t('wizard.openLink').replace('{label}', crmLabel)}
                            </a>
                          )}
                        </div>
                        <input
                          className="form-input"
                          type="password"
                          placeholder={crmProvider === 'hubspot' ? 'pat-...' : t('wizard.crmApiKeyPlaceholder')}
                          value={crmKey}
                          onChange={e => { setCrmKey(e.target.value); setCrmKeyError(null); }}
                          style={crmKeyError ? { borderColor: 'var(--danger, #B42318)' } : undefined}
                        />
                        {crmKeyError && (
                          <div style={{ fontSize: 12, color: 'var(--danger, #B42318)', marginTop: 6 }}>
                            {crmKeyError}
                          </div>
                        )}
                      </>
                    );

                    // HubSpot / Pipedrive : le geste par défaut est le bouton
                    // OAuth — la clé API devient le « mode avancé ».
                    const hasOauth = crmProvider === 'hubspot' || crmProvider === 'pipedrive';
                    if (hasOauth && !oauthUnavailable) {
                      return (
                        <>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleConnectOauth}
                            style={{ width: '100%', marginBottom: 8 }}
                          >
                            {t('wizard.connectOauth').replace('{provider}', crmLabel)}
                          </button>
                          {showKeyField ? keyBlock : (
                            <button
                              type="button"
                              onClick={() => setShowKeyField(true)}
                              style={{
                                background: 'none', border: 'none', padding: 0,
                                fontSize: 12, color: 'var(--text-muted)',
                                textDecoration: 'underline', cursor: 'pointer',
                              }}
                            >
                              {t('wizard.orPasteKey')}
                            </button>
                          )}
                        </>
                      );
                    }

                    return (
                      <>
                        {hasOauth && oauthUnavailable && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                            {t('wizard.oauthUnavailable')}
                          </div>
                        )}
                        {keyBlock}
                      </>
                    );
                  })()}
                </div>
              </div>

              <div style={{ borderTop: '1px solid var(--border)', margin: '16px 0 12px', paddingTop: 12 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>{t('wizard.prospectionOptional')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>{t('wizard.prospectionDesc')}</div>
              </div>

              <div className="wizard-key-row">
                <div className="wizard-key-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                  </svg>
                </div>
                <div className="wizard-key-input">
                  <div className="wizard-key-label">{t('wizard.outreachTool')}</div>
                  <select className="form-input" value={outreachProvider} onChange={e => { setOutreachProvider(e.target.value); setOutreachKey(''); }} style={{ marginBottom: 8 }}>
                    <option value="">{t('wizard.selectOutreach')}</option>
                    {OUTREACH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {outreachProvider && (() => {
                    const opt = OUTREACH_OPTIONS.find(o => o.value === outreachProvider);
                    const guide = en ? (opt?.guideEn || []) : (opt?.guideFr || []);
                    return (
                      <>
                        <div style={{
                          fontSize: 12, background: 'var(--paper-2)', borderRadius: 8,
                          padding: '10px 12px', marginBottom: 8, lineHeight: 1.6,
                        }}>
                          <ol style={{ margin: 0, paddingLeft: 16, color: 'var(--grey-700)' }}>
                            {guide.map((s, i) => <li key={i}>{s}</li>)}
                          </ol>
                          {opt?.link && (
                            <a href={opt.link} target="_blank" rel="noopener noreferrer"
                              style={{ fontSize: 11, color: 'var(--primary)', display: 'inline-block', marginTop: 6 }}>
                              {t('wizard.openLink').replace('{label}', opt.label)}
                            </a>
                          )}
                        </div>
                        <input
                          className="form-input"
                          type="password"
                          placeholder={t('wizard.apiKeyPlaceholder').replace('{tool}', opt?.label || '')}
                          value={outreachKey}
                          onChange={e => setOutreachKey(e.target.value)}
                        />
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="form-grid" style={{ marginTop: 4 }}>
                <div className="form-group">
                  <label className="form-label">{t('wizard.targetSectors')}</label>
                  <input className="form-input" placeholder="Ex: Finance, RH, SaaS" value={targetSectors} onChange={e => setTargetSectors(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('wizard.targetSize')}</label>
                  <input className="form-input" placeholder="Ex: 11-50 salariés" value={targetSize} onChange={e => setTargetSize(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">{t('wizard.targetZone')}</label>
                  <input className="form-input" placeholder="Ex: France, Île-de-France" value={targetZones} onChange={e => setTargetZones(e.target.value)} />
                </div>
              </div>

              {keySaveStatus === 'error' && (
                <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>
                  {t('wizard.keyInvalid')}
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
            <div className="wizard-complete-title">{t('wizard.allReady')}</div>
            <div className="wizard-complete-desc">
              {t('wizard.completeDesc')}
            </div>
            <div className="wizard-checklist">
              <div className="wizard-check-item">
                <span className="wizard-check-icon">{company ? '\u2705' : '\u2B1C'}</span>
                <span>{t('wizard.checkCompany')} {company ? `\u2014 ${company}` : t('wizard.checkCompanyLater')}</span>
              </div>
              {/* CRM avant outreach : m\u00EAme hi\u00E9rarchie que les \u00E9tapes du wizard. */}
              <div className="wizard-check-item">
                <span className="wizard-check-icon">{(crmKey || crmOauthConnected) && crmProvider ? '\u2705' : '\u2B1C'}</span>
                <span>CRM {(crmKey || crmOauthConnected) && crmProvider ? `\u2014 ${crmProvider.charAt(0).toUpperCase() + crmProvider.slice(1)}` : t('wizard.checkCrmOptional')}</span>
              </div>
              <div className="wizard-check-item">
                <span className="wizard-check-icon">{outreachKey && outreachProvider ? '\u2705' : '\u2B1C'}</span>
                <span>{outreachLabel} {outreachKey && outreachProvider ? `\u2014 ${t('wizard.checkOutreachConnected')}` : t('wizard.checkOutreachSettings')}</span>
              </div>
              <div className="wizard-check-item">
                <span className="wizard-check-icon">{targetSectors || personaPrimary ? '\u2705' : '\u2B1C'}</span>
                <span>{t('wizard.checkTargeting')} {targetSectors ? `\u2014 ${targetSectors}` : t('wizard.checkTargetingLater')}</span>
              </div>
              <div className="wizard-check-item">
                <span className="wizard-check-icon">{'\u2705'}</span>
                <span>{t('wizard.checkStyle')} {'\u2014'} {tone}, {formality}</span>
              </div>
            </div>
            {/* Etat du premier import CRM. Sans ce retour, un import qui echoue
                laissait l'utilisateur devant un dashboard vide sans explication. */}
            {importState.status !== 'idle' && (
              <div className="wizard-import-state" style={{
                marginTop: 16, padding: '12px 14px', borderRadius: 10, fontSize: 13,
                background: importState.status === 'error' ? 'var(--danger-bg, #FEF2F2)' : 'var(--paper-2)',
                color: importState.status === 'error' ? 'var(--danger, #B42318)' : 'var(--grey-700)',
                textAlign: 'left', lineHeight: 1.6,
              }}>
                {importState.status === 'running' && t('wizard.importRunningDesc')}
                {importState.status === 'done' && (
                  importState.imported > 0
                    ? (readingSummary && readingSummary.totalDeals > 0
                        ? renderReadingSummary(readingSummary, t)
                        : t('wizard.importDone').replace('{count}', importState.imported))
                    : t('wizard.importEmpty')
                )}
                {importState.status === 'error' && t('wizard.importError')}
              </div>
            )}
          </>
        );

      default:
        return null;
    }
  }

  /* ─── Actions per step ─── */

  function renderActions() {
    if (step === TOTAL_STEPS - 1) {
      const { status, imported } = importState;
      // Le libelle suit l'etat de l'import : pendant, on ne promet rien ;
      // apres, on nomme explicitement ce que l'utilisateur va voir, pour que
      // le clic mene au « wow » au lieu d'un dashboard generique.
      const label =
        status === 'running' ? t('wizard.importRunning')
        : status === 'done' && imported > 0 ? t('wizard.seeDormantDeals')
        : t('wizard.goToDashboard');
      return (
        <div className="wizard-actions">
          <button className="btn btn-primary" onClick={handleFinish} disabled={status === 'running'}>
            {label}
          </button>
        </div>
      );
    }

    return (
      <div className="wizard-actions">
        {step > 0 && (
          <button className="btn btn-ghost" onClick={prev}>{t('wizard.back')}</button>
        )}
        {step === 1 ? (
          <button className="btn btn-primary" onClick={handleSaveKeys} disabled={saving}>
            {saving ? t('wizard.saving') : t('wizard.continue')}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={next}>
            {t('wizard.continue')}
          </button>
        )}
      </div>
    );
  }

  /* ─── Skip / close handler ─── */
  function handleSkip() {
    trackEvent('wizard_skipped', { step });
    const tkn = localStorage.getItem('bakal_token');
    fetch('/api/auth/onboarding-complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(tkn ? { Authorization: `Bearer ${tkn}` } : {}) },
    }).catch(() => {});
    localStorage.setItem('bakal_onboarding_complete', 'true');
    if (onComplete) onComplete();
  }

  /* ─── Main render ─── */

  return (
    <div className="wizard-overlay">
      <div className="wizard-modal">
        <div className="wizard-header">
          <button
            onClick={handleSkip}
            title={t('wizard.skipOnboarding')}
            style={{
              position: 'absolute', top: 16, right: 16, background: 'none', border: 'none',
              cursor: 'pointer', fontSize: 20, color: 'var(--text-muted)', lineHeight: 1,
              padding: '4px 8px', borderRadius: 6,
            }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            ✕
          </button>
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
            <div className="wizard-skip" onClick={handleSkip}>
              {t('wizard.skipOnboarding')}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
