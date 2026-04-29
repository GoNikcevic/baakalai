/* ═══════════════════════════════════════════════════
   Product Lines Settings — Manage verticals / product lines
   For multi-product companies (e.g., cyber, AI, security)
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';
import { useI18n } from '../i18n';

export default function ProductLinesSettings() {
  const { lang } = useI18n();
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', icon: '' });

  const en = lang === 'en';

  const load = useCallback(async () => {
    try {
      const data = await request('/crm/product-lines');
      setLines(data.productLines || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await request('/crm/product-lines', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setForm({ name: '', description: '', icon: '' });
      setShowForm(false);
      await load();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(en ? `Delete "${name}"?` : `Supprimer "${name}" ?`)) return;
    try {
      await request(`/crm/product-lines/${id}`, { method: 'DELETE' });
      await load();
    } catch { /* ignore */ }
  };

  if (loading && lines.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="card-title">{en ? 'Product Lines' : 'Lignes de produits'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {en ? 'Organize contacts by product or business unit' : 'Organisez vos contacts par produit ou unit\u00E9'}
          </div>
        </div>
        {!showForm && (
          <button className="btn btn-primary btn-sm" onClick={() => setShowForm(true)}>
            {en ? '+ Add' : '+ Ajouter'}
          </button>
        )}
      </div>

      <div className="card-body">
        {/* Existing product lines */}
        {lines.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: showForm ? 16 : 0 }}>
            {lines.map(pl => (
              <div key={pl.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg-card)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>{pl.icon || '\uD83D\uDCE6'}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{pl.name}</div>
                    {pl.description && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pl.description}</div>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-elevated)', padding: '3px 8px', borderRadius: 6 }}>
                    {pl.contact_count || 0} {en ? 'contacts' : 'contacts'}
                  </span>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 10, padding: '4px 10px', color: 'var(--danger)' }}
                    onClick={() => handleDelete(pl.id, pl.name)}
                  >
                    {en ? 'Delete' : 'Supprimer'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Add form */}
        {showForm && (
          <div style={{ borderTop: lines.length > 0 ? '1px solid var(--border)' : 'none', paddingTop: lines.length > 0 ? 14 : 0 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder={en ? 'Icon (emoji)' : 'Ic\u00F4ne (emoji)'}
                  value={form.icon}
                  onChange={e => setForm(p => ({ ...p, icon: e.target.value }))}
                  className="form-input"
                  style={{ width: 60, fontSize: 18, textAlign: 'center', padding: '6px' }}
                  maxLength={2}
                />
                <input
                  type="text"
                  placeholder={en ? 'Product line name (e.g., Cybersecurity)' : 'Nom (ex: Cybers\u00E9curit\u00E9)'}
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  className="form-input"
                  style={{ flex: 1, fontSize: 13, padding: '8px 12px' }}
                />
              </div>
              <input
                type="text"
                placeholder={en ? 'Description (optional)' : 'Description (optionnel)'}
                value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                className="form-input"
                style={{ fontSize: 13, padding: '8px 12px' }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => { setShowForm(false); setForm({ name: '', description: '', icon: '' }); }}>
                  {en ? 'Cancel' : 'Annuler'}
                </button>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '6px 14px' }}
                  onClick={handleSave}
                  disabled={saving || !form.name.trim()}
                >
                  {saving ? '...' : (en ? 'Add product line' : 'Ajouter')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && lines.length === 0 && !showForm && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>
            {en
              ? 'No product lines yet. Add your first one to organize contacts by product.'
              : 'Aucune ligne de produit. Ajoutez-en pour organiser vos contacts par produit.'}
          </div>
        )}
      </div>
    </div>
  );
}
