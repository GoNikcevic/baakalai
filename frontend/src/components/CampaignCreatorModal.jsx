/* ===============================================================================
   BAKAL — Campaign Creator Modal (React)
   Quick campaign creation form with project linking.
   Mirrors the HTML mockup's campaign creator overlay.
   =============================================================================== */

import { useState } from 'react';
import { useApp } from '../context/useApp';
import { createCampaign, transformCampaign, campaignToBackend } from '../services/api-client';

const SECTORS = [
  'Formation & Education',
  'Comptabilite & Finance',
  'Juridique & Avocats',
  'Conseil & Consulting',
  'IT & Infogerance',
  'Immobilier B2B',
  'Sante & Medical',
  'Marketing & Communication',
];

const POSITIONS = [
  'Dirigeant / Gerant / CEO',
  'DG / Directeur General',
  'DAF / Directeur Financier',
  'DRH / Directeur RH',
  'Directeur Commercial',
  'DSI / Directeur IT',
];

const SIZES = ['1-10 salaries', '11-50 salaries', '51-200 salaries', '200+ salaries'];
const ZONES = ['Ile-de-France', 'Lyon & Rhone-Alpes', 'Marseille & PACA', 'France entiere'];
const TONES = ['Pro decontracte', 'Formel & Corporate', 'Direct & punchy'];
const CHANNELS = ['Email + LinkedIn', 'Email uniquement', 'LinkedIn uniquement'];
const ANGLES = ['Douleur client', 'Preuve sociale', 'Offre directe', 'Contenu educatif'];
const VOLUMES = ['Standard (~100/semaine)', 'Modere (~50/semaine)', 'Agressif (~200/semaine)'];

export default function CampaignCreatorModal({ onClose }) {
  const { projects, setCampaigns, backendAvailable } = useApp();

  const [form, setForm] = useState({
    projectId: '',
    name: '',
    sector: SECTORS[0],
    position: POSITIONS[0],
    size: SIZES[0],
    zone: ZONES[0],
    tone: TONES[0],
    channel: CHANNELS[0],
    angle: ANGLES[0],
    volume: VOLUMES[0],
  });

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const projectsList = Object.values(projects);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError('Le nom de la campagne est requis.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const payload = campaignToBackend({
        ...form,
        client: form.projectId
          ? projectsList.find((p) => p.id === form.projectId)?.client || ''
          : '',
      });

      if (backendAvailable) {
        const created = await createCampaign({ ...form, client: payload.client });
        const transformed = transformCampaign(created, []);
        setCampaigns((prev) => ({ ...prev, [transformed.id]: transformed }));
      } else {
        // Offline — create local-only campaign
        const localId = 'local-' + Date.now();
        const localCampaign = {
          id: localId,
          _backendId: null,
          name: form.name,
          client: payload.client,
          projectId: form.projectId || null,
          status: 'prep',
          channel: payload.channel,
          channelLabel: payload.channel === 'linkedin' ? 'LinkedIn' : payload.channel === 'multi' ? 'Multi' : 'Email',
          channelColor: payload.channel === 'linkedin' ? 'var(--purple)' : payload.channel === 'multi' ? 'var(--orange)' : 'var(--blue)',
          sector: form.sector,
          sectorShort: form.sector.split(' ')[0],
          position: form.position,
          size: form.size,
          angle: form.angle,
          zone: form.zone,
          tone: form.tone,
          formality: 'Vous',
          length: 'Standard',
          cta: '',
          volume: { sent: 0, planned: payload.planned },
          iteration: 0,
          startDate: new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
          lemlistRef: null,
          nextAction: null,
          kpis: { contacts: 0, openRate: null, replyRate: null, interested: 0, meetings: 0 },
          sequence: [],
          diagnostics: [],
          history: [],
          prepChecklist: undefined,
          info: { period: '', createdDate: '', copyDesc: `${form.tone} · Vous · ${form.angle} · FR`, channelsDesc: form.channel },
        };
        setCampaigns((prev) => ({ ...prev, [localId]: localCampaign }));
      }

      onClose();
    } catch (err) {
      setError(err.message || 'Erreur lors de la creation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="creator-overlay show" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="creator-modal">
        <div className="creator-header">
          <h2>Nouvelle campagne</h2>
          <button className="creator-close" onClick={onClose}>✕</button>
        </div>
        <div className="creator-body">
          <div className="form-grid">
            {/* Project */}
            <div className="form-group full">
              <label className="form-label">Projet</label>
              <select className="form-select" value={form.projectId} onChange={(e) => handleChange('projectId', e.target.value)}>
                <option value="">— Aucun projet —</option>
                {projectsList.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Name */}
            <div className="form-group full">
              <label className="form-label">Nom de la campagne</label>
              <input className="form-input" value={form.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="Ex: DRH PME Lyon — Mars 2026" />
            </div>

            {/* Sector */}
            <div className="form-group">
              <label className="form-label">Cible — Secteur</label>
              <select className="form-select" value={form.sector} onChange={(e) => handleChange('sector', e.target.value)}>
                {SECTORS.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>

            {/* Position */}
            <div className="form-group">
              <label className="form-label">Cible — Poste decideur</label>
              <select className="form-select" value={form.position} onChange={(e) => handleChange('position', e.target.value)}>
                {POSITIONS.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>

            {/* Size */}
            <div className="form-group">
              <label className="form-label">Taille entreprise</label>
              <select className="form-select" value={form.size} onChange={(e) => handleChange('size', e.target.value)}>
                {SIZES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>

            {/* Zone */}
            <div className="form-group">
              <label className="form-label">Zone geographique</label>
              <select className="form-select" value={form.zone} onChange={(e) => handleChange('zone', e.target.value)}>
                {ZONES.map((z) => <option key={z}>{z}</option>)}
              </select>
            </div>

            {/* Tone */}
            <div className="form-group">
              <label className="form-label">Ton</label>
              <select className="form-select" value={form.tone} onChange={(e) => handleChange('tone', e.target.value)}>
                {TONES.map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>

            {/* Channel */}
            <div className="form-group">
              <label className="form-label">Canal</label>
              <select className="form-select" value={form.channel} onChange={(e) => handleChange('channel', e.target.value)}>
                {CHANNELS.map((ch) => <option key={ch}>{ch}</option>)}
              </select>
            </div>

            {/* Angle */}
            <div className="form-group">
              <label className="form-label">Angle d'approche</label>
              <select className="form-select" value={form.angle} onChange={(e) => handleChange('angle', e.target.value)}>
                {ANGLES.map((a) => <option key={a}>{a}</option>)}
              </select>
            </div>

            {/* Volume */}
            <div className="form-group">
              <label className="form-label">Volume</label>
              <select className="form-select" value={form.volume} onChange={(e) => handleChange('volume', e.target.value)}>
                {VOLUMES.map((v) => <option key={v}>{v}</option>)}
              </select>
            </div>
          </div>

          {error && (
            <div style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '12px' }}>{error}</div>
          )}
        </div>
        <div className="creator-footer">
          <button className="btn btn-ghost" onClick={onClose}>Annuler</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creation...' : 'Creer la campagne'}
          </button>
        </div>
      </div>
    </div>
  );
}
