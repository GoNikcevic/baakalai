/* ===============================================================================
   BAKAL — Profile Page (React)
   Ported from app/pages.js (saveProfile, loadProfile, populateProfileForm).
   Company info, value prop, personas, targets, communication style.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/useApp';
import { request } from '../services/api-client';

/* ─── Default empty profile ─── */

const EMPTY_PROFILE = {
  company: '',
  sector: '',
  website: '',
  team_size: '',
  description: '',
  value_prop: '',
  social_proof: '',
  pain_points: '',
  objections: '',
  persona_primary: '',
  persona_secondary: '',
  target_sectors: '',
  target_size: '',
  target_zones: '',
  default_tone: '',
  default_formality: '',
  avoid_words: '',
  signature_phrases: '',
};

/* ─── Component ─── */

export default function ProfilePage() {
  useApp();

  const [profile, setProfile] = useState(EMPTY_PROFILE);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // 'saved' | 'error' | null

  /* ─── Load profile on mount ─── */

  const loadProfile = useCallback(async () => {
    // Try backend first
    try {
      const res = await request('/profile');
      if (res && res.profile) {
        setProfile(prev => ({ ...prev, ...res.profile }));
        return;
      }
    } catch {
      /* backend not available */
    }

    // Fallback to localStorage
    const saved = localStorage.getItem('bakal_profile');
    if (!saved) return;
    try {
      const data = JSON.parse(saved);
      // Remap camelCase keys to snake_case
      setProfile(prev => ({
        ...prev,
        company: data.company || '',
        sector: data.sector || '',
        website: data.website || '',
        team_size: data.team_size || data.teamSize || '',
        description: data.description || '',
        value_prop: data.value_prop || data.valueProp || '',
        social_proof: data.social_proof || data.socialProof || '',
        pain_points: data.pain_points || data.painPoints || '',
        objections: data.objections || '',
        persona_primary: data.persona_primary || data.personaPrimary || '',
        persona_secondary: data.persona_secondary || data.personaSecondary || '',
        target_sectors: data.target_sectors || data.targetSectors || '',
        target_size: data.target_size || data.targetSize || '',
        target_zones: data.target_zones || data.targetZones || '',
        default_tone: data.default_tone || data.defaultTone || '',
        default_formality: data.default_formality || data.defaultFormality || '',
        avoid_words: data.avoid_words || data.avoidWords || '',
        signature_phrases: data.signature_phrases || data.signaturePhrases || '',
      }));
    } catch {
      /* ignore parse errors */
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  /* ─── Save profile ─── */

  const saveProfile = useCallback(async () => {
    setSaving(true);
    setSaveStatus(null);

    // Always save to localStorage as fallback
    localStorage.setItem('bakal_profile', JSON.stringify(profile));

    // Save to backend
    try {
      const token = localStorage.getItem('bakal_token');
      const res = await fetch('/api/profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(profile),
      });
      if (!res.ok) throw new Error('Save failed');
    } catch {
      // Backend not available -- localStorage fallback already done
    }

    setSaving(false);
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus(null), 2000);
  }, [profile]);

  /* ─── Field change handler ─── */

  const handleChange = useCallback((field, value) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  }, []);

  /* ─── Render helpers ─── */

  function renderInput(label, field, opts = {}) {
    const { type = 'text', placeholder = '' } = opts;
    return (
      <div className="form-group">
        <label className="form-label">{label}</label>
        <input
          className="form-input"
          type={type}
          placeholder={placeholder}
          value={profile[field] || ''}
          onChange={(e) => handleChange(field, e.target.value)}
        />
      </div>
    );
  }

  function renderTextarea(label, field, opts = {}) {
    const { placeholder = '', rows = 3 } = opts;
    return (
      <div className="form-group">
        <label className="form-label">{label}</label>
        <textarea
          className="form-input"
          placeholder={placeholder}
          rows={rows}
          value={profile[field] || ''}
          onChange={(e) => handleChange(field, e.target.value)}
        />
      </div>
    );
  }

  function renderSelect(label, field, options) {
    return (
      <div className="form-group">
        <label className="form-label">{label}</label>
        <select
          className="form-input"
          value={profile[field] || ''}
          onChange={(e) => handleChange(field, e.target.value)}
        >
          <option value="">-- Sélectionner --</option>
          {options.map(opt => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      </div>
    );
  }

  /* ─── Main render ─── */

  return (
    <div id="page-profil" className="page-content">
      <div className="page-header">
        <div>
          <div className="page-title">Profil Entreprise</div>
          <div className="page-subtitle">Ces informations sont utilisées par Claude pour personnaliser vos campagnes</div>
        </div>
        <div className="header-actions">
          <button
            className="btn btn-primary"
            onClick={saveProfile}
            disabled={saving}
            style={saveStatus === 'saved' ? { background: 'var(--success)' } : undefined}
          >
            {saving ? 'Enregistrement...' : saveStatus === 'saved' ? 'Enregistré' : 'Sauvegarder le profil'}
          </button>
        </div>
      </div>

      {/* Company Info */}
      <div className="card">
        <div className="card-title">Informations entreprise</div>
        <div className="form-grid">
          {renderInput('Nom de l\'entreprise', 'company', { placeholder: 'Ex: FormaPro Consulting' })}
          {renderInput('Secteur d\'activité', 'sector', { placeholder: 'Ex: Formation professionnelle' })}
          {renderInput('Site web', 'website', { type: 'url', placeholder: 'https://...' })}
          {renderSelect('Taille d\'équipe', 'team_size', [
            '1-5', '6-10', '11-25', '26-50', '51-100', '100+',
          ])}
        </div>
        {renderTextarea('Description de l\'activité', 'description', {
          placeholder: 'Décrivez brièvement votre activité et vos services principaux...',
          rows: 3,
        })}
      </div>

      {/* Value Proposition */}
      <div className="card">
        <div className="card-title">Proposition de valeur</div>
        {renderTextarea('Proposition de valeur principale', 'value_prop', {
          placeholder: 'Quel problème résolvez-vous et quelle est votre promesse client ?',
          rows: 3,
        })}
        {renderTextarea('Preuves sociales / Références', 'social_proof', {
          placeholder: 'Clients notables, chiffres clés, témoignages, certifications...',
          rows: 3,
        })}
        {renderTextarea('Pain points clients', 'pain_points', {
          placeholder: 'Les frustrations et difficultés principales de vos clients cibles...',
          rows: 3,
        })}
        {renderTextarea('Objections fréquentes', 'objections', {
          placeholder: 'Les raisons pour lesquelles les prospects hésitent...',
          rows: 3,
        })}
      </div>

      {/* Personas */}
      <div className="card">
        <div className="card-title">Personas cibles</div>
        {renderTextarea('Persona principal', 'persona_primary', {
          placeholder: 'Décrivez votre interlocuteur idéal : poste, responsabilités, défis quotidiens...',
          rows: 3,
        })}
        {renderTextarea('Persona secondaire', 'persona_secondary', {
          placeholder: 'Autre profil cible (si applicable)...',
          rows: 3,
        })}
      </div>

      {/* Target */}
      <div className="card">
        <div className="card-title">Ciblage</div>
        <div className="form-grid">
          {renderInput('Secteurs cibles', 'target_sectors', { placeholder: 'Ex: Finance, RH, Formation' })}
          {renderInput('Taille d\'entreprise cible', 'target_size', { placeholder: 'Ex: 11-50 salariés' })}
          {renderInput('Zones géographiques', 'target_zones', { placeholder: 'Ex: Île-de-France, Lyon, France' })}
        </div>
      </div>

      {/* Communication Style */}
      <div className="card">
        <div className="card-title">Style de communication</div>
        <div className="form-grid">
          {renderSelect('Ton par défaut', 'default_tone', [
            'Pro décontracté', 'Formel', 'Amical', 'Direct', 'Expert',
          ])}
          {renderSelect('Formalité', 'default_formality', [
            'Vous', 'Tu',
          ])}
        </div>
        {renderTextarea('Mots / expressions à éviter', 'avoid_words', {
          placeholder: 'Ex: "innovant", "synergies", "n\'hésitez pas"...',
          rows: 2,
        })}
        {renderTextarea('Expressions signature', 'signature_phrases', {
          placeholder: 'Phrases ou tournures que vous utilisez souvent et souhaitez conserver...',
          rows: 2,
        })}
      </div>
    </div>
  );
}
