/* ═══════════════════════════════════════════════════
   CRM Field Mapping Settings
   Map CRM custom fields to Baakalai concepts (product lines, status, etc.)
   Supports Pipedrive, HubSpot, Salesforce
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';
import { useI18n } from '../i18n';

const BAAKALAI_FIELDS = [
  { key: 'product_line', label: { fr: 'Ligne de produits', en: 'Product line' } },
  { key: 'status', label: { fr: 'Statut du contact', en: 'Contact status' } },
];

const STATUS_OPTIONS = [
  { id: 'new', label: 'New' },
  { id: 'interested', label: 'Interested' },
  { id: 'meeting', label: 'Meeting' },
  { id: 'negotiation', label: 'Negotiation' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
];

export default function FieldMappingSettings() {
  const { lang } = useI18n();
  const en = lang === 'en';

  const [provider, setProvider] = useState(null);
  const [crmFields, setCrmFields] = useState([]);
  const [productLines, setProductLines] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingFields, setLoadingFields] = useState(false);
  const [saving, setSaving] = useState(false);

  // New mapping form
  const [selectedCrmField, setSelectedCrmField] = useState('');
  const [selectedBaakalaiField, setSelectedBaakalaiField] = useState('product_line');
  const [mappingValues, setMappingValues] = useState({});

  const load = useCallback(async () => {
    try {
      // Detect connected CRM
      const providersData = await request('/crm/providers').catch(() => ({ providers: [] }));
      const crmProviders = ['pipedrive', 'hubspot', 'salesforce'];
      const connected = (providersData.providers || []).find(p => crmProviders.includes(p.provider) && p.connected);
      if (connected) setProvider(connected.provider);

      // Load product lines + existing mappings
      const [plData, mapData] = await Promise.all([
        request('/crm/product-lines').catch(() => ({ productLines: [] })),
        request('/crm/mappings').catch(() => ({ mappings: [] })),
      ]);
      setProductLines(plData.productLines || []);
      setMappings(mapData.mappings || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Fetch CRM fields when provider is detected
  useEffect(() => {
    if (!provider) return;
    setLoadingFields(true);
    request(`/crm/fields/${provider}`)
      .then(data => setCrmFields(data.fields || []))
      .catch(() => setCrmFields([]))
      .finally(() => setLoadingFields(false));
  }, [provider]);

  const handleSave = async () => {
    if (!selectedCrmField || !selectedBaakalaiField) return;
    const field = crmFields.find(f => f.key === selectedCrmField);
    setSaving(true);
    try {
      await request('/crm/mappings', {
        method: 'POST',
        body: JSON.stringify({
          crmProvider: provider,
          crmField: selectedCrmField,
          crmFieldName: field?.name || selectedCrmField,
          baakalaiField: selectedBaakalaiField,
          mappingValues,
        }),
      });
      setSelectedCrmField('');
      setMappingValues({});
      await load();
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id) => {
    try {
      await request(`/crm/mappings/${id}`, { method: 'DELETE' });
      setMappings(prev => prev.filter(m => m.id !== id));
    } catch { /* ignore */ }
  };

  if (loading) return null;
  if (!provider) return null; // No CRM connected, don't show

  const selectedField = crmFields.find(f => f.key === selectedCrmField);
  const targetOptions = selectedBaakalaiField === 'product_line'
    ? productLines.map(pl => ({ id: pl.id, label: `${pl.icon || '📦'} ${pl.name}` }))
    : STATUS_OPTIONS;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-title">{en ? 'CRM Field Mapping' : 'Mapping des champs CRM'}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {en
              ? `Map ${provider} fields to Baakalai (product lines, status, etc.)`
              : `Associez les champs ${provider} aux concepts Baakalai (produits, statut, etc.)`}
          </div>
        </div>
      </div>

      <div className="card-body">
        {/* Existing mappings */}
        {mappings.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
            {mappings.map(m => (
              <div key={m.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
                background: 'var(--bg-card)', fontSize: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 600, color: 'var(--accent)' }}>{m.crm_field_name || m.crm_field}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{'\u2192'}</span>
                  <span style={{ fontWeight: 600 }}>{BAAKALAI_FIELDS.find(f => f.key === m.baakalai_field)?.label[lang] || m.baakalai_field}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 10, background: 'var(--bg-elevated)', padding: '1px 6px', borderRadius: 4 }}>
                    {Object.keys(m.mapping_values || {}).length} {en ? 'values mapped' : 'valeurs'}
                  </span>
                </div>
                <button className="btn btn-ghost" style={{ fontSize: 10, padding: '2px 8px', color: 'var(--danger)' }}
                  onClick={() => handleDelete(m.id)}>
                  {en ? 'Remove' : 'Supprimer'}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* New mapping */}
        {loadingFields ? (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 12 }}>
            {en ? 'Loading CRM fields...' : 'Chargement des champs CRM...'}
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 16, background: 'var(--bg-elevated)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 12 }}>
              {en ? 'Add a new mapping' : 'Ajouter un mapping'}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {/* CRM field selector */}
              <div style={{ flex: 1 }}>
                <label className="form-label" style={{ fontSize: 11 }}>{en ? 'CRM field' : 'Champ CRM'}</label>
                <select className="form-input" style={{ fontSize: 12 }}
                  value={selectedCrmField} onChange={e => { setSelectedCrmField(e.target.value); setMappingValues({}); }}>
                  <option value="">{en ? '— Select a field —' : '— S\u00e9lectionner —'}</option>
                  {crmFields
                    .filter(f => f.options?.length > 0) // Only show fields with options
                    .map(f => (
                      <option key={f.key} value={f.key}>{f.name} ({f.options.length} {en ? 'options' : 'options'})</option>
                    ))}
                </select>
              </div>

              {/* Baakalai field selector */}
              <div style={{ flex: 1 }}>
                <label className="form-label" style={{ fontSize: 11 }}>{en ? 'Maps to' : 'Correspond \u00e0'}</label>
                <select className="form-input" style={{ fontSize: 12 }}
                  value={selectedBaakalaiField} onChange={e => { setSelectedBaakalaiField(e.target.value); setMappingValues({}); }}>
                  {BAAKALAI_FIELDS.map(f => (
                    <option key={f.key} value={f.key}>{f.label[lang]}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Value mapping table */}
            {selectedField && selectedField.options?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {en ? 'Map each CRM value to a Baakalai value:' : 'Associez chaque valeur CRM :'}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {selectedField.options.map(opt => (
                    <div key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <span style={{ flex: 1, padding: '4px 8px', background: 'var(--bg-card)', borderRadius: 4, border: '1px solid var(--border)' }}>
                        {opt.label}
                      </span>
                      <span style={{ color: 'var(--text-muted)' }}>{'\u2192'}</span>
                      <select className="form-input" style={{ flex: 1, fontSize: 11, padding: '4px 8px' }}
                        value={mappingValues[opt.id] || ''}
                        onChange={e => setMappingValues(prev => ({ ...prev, [opt.id]: e.target.value }))}>
                        <option value="">— {en ? 'Skip' : 'Ignorer'} —</option>
                        {targetOptions.map(to => (
                          <option key={to.id} value={to.id}>{to.label}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 16px' }}
              onClick={handleSave} disabled={saving || !selectedCrmField || Object.keys(mappingValues).length === 0}>
              {saving ? '...' : (en ? 'Save mapping' : 'Enregistrer le mapping')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
