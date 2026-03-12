/* ═══════════════════════════════════════════════════
   Edit Params Panel Component (prep campaigns)
   ═══════════════════════════════════════════════════ */

import { useState } from 'react';

export default function EditParamsPanel({ campaign: c, setCampaigns, onClose }) {
  const [sector, setSector] = useState(c.sector || '');
  const [angle, setAngle] = useState(c.angle || '');
  const [tone, setTone] = useState(c.tone || '');

  const angles = [
    'Douleur client',
    'Preuve sociale',
    'Offre directe',
    'Contenu educatif',
  ];
  const tones = [
    'Pro decontracte',
    'Formel & Corporate',
    'Direct & punchy',
  ];

  const handleSave = () => {
    setCampaigns((prev) => {
      const updated = { ...prev[c.id] };
      updated.sector = sector;
      updated.sectorShort = sector.split(' ')[0];
      updated.angle = angle;
      updated.tone = tone;
      updated.info = {
        ...updated.info,
        copyDesc: `${tone} · ${updated.formality || 'Vous'} · ${angle} · FR`,
      };
      return { ...prev, [c.id]: updated };
    });
    onClose();
  };

  return (
    <div
      className="edit-params-panel"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--accent)',
        borderRadius: '12px',
        padding: '24px',
        margin: '16px 0',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
        }}
      >
        <div style={{ fontSize: '15px', fontWeight: 600 }}>
          ✏️ Modifier les parametres
        </div>
        <button
          className="btn btn-ghost"
          style={{ fontSize: '11px', padding: '6px 12px' }}
          onClick={onClose}
        >
          ✕ Fermer
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '16px',
          marginBottom: '16px',
        }}
      >
        <div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '4px',
            }}
          >
            Secteur
          </div>
          <input
            className="form-input"
            value={sector}
            onChange={(e) => setSector(e.target.value)}
          />
        </div>
        <div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '4px',
            }}
          >
            Angle
          </div>
          <select
            className="form-select"
            value={angle}
            onChange={(e) => setAngle(e.target.value)}
          >
            {angles.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <div
            style={{
              fontSize: '12px',
              color: 'var(--text-muted)',
              marginBottom: '4px',
            }}
          >
            Ton
          </div>
          <select
            className="form-select"
            value={tone}
            onChange={(e) => setTone(e.target.value)}
          >
            {tones.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
      </div>

      <button
        className="btn btn-primary"
        style={{ fontSize: '12px', padding: '8px 14px' }}
        onClick={handleSave}
      >
        💾 Sauvegarder
      </button>
    </div>
  );
}
