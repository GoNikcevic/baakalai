/* ===============================================================================
   BAKAL — Product Line Tags (shared)
   Assign/remove product lines on a client. Extracted from ClientsPage.jsx so the
   Data Quality page's "Clients à upseller" strate can reuse it inline for the
   missing_product_lines remediation action.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { request } from '../services/api-client';
import { showToast } from '../services/notifications';

export default function ProductLineTags({ clientId, lang }) {
  const en = lang === 'en';
  const [allLines, setAllLines] = useState([]);
  const [assigned, setAssigned] = useState([]);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    request('/crm/product-lines').then(d => {
      setAllLines(d.productLines || []);
    }).catch(() => {});
    // Load assigned product lines for this client
    request(`/crm/client/${clientId}/product-lines`).then(d => {
      setAssigned(d.productLines || []);
    }).catch(() => setAssigned([]));
  }, [clientId]);

  const handleAssign = async (plId) => {
    try {
      await request(`/crm/product-lines/${plId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ opportunityIds: [clientId] }),
      });
      setAssigned(prev => [...prev, allLines.find(l => l.id === plId)].filter(Boolean));
    } catch { showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: en ? 'Failed to assign product line' : 'Échec de l\'assignation' }); }
  };

  const handleRemove = async (plId) => {
    try {
      await request(`/crm/product-lines/${plId}/unassign`, {
        method: 'POST',
        body: JSON.stringify({ opportunityIds: [clientId] }),
      });
      setAssigned(prev => prev.filter(p => p.id !== plId));
    } catch { showToast({ type: 'error', title: en ? 'Error' : 'Erreur', message: en ? 'Failed to remove product line' : 'Échec de la suppression' }); }
  };

  if (allLines.length === 0) return null;

  const assignedIds = new Set(assigned.map(a => a.id));
  const available = allLines.filter(l => !assignedIds.has(l.id));

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
        {en ? 'Product lines' : 'Lignes de produits'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {assigned.map(pl => (
          <span key={pl.id} style={{
            fontSize: 11, padding: '3px 10px', borderRadius: 12,
            background: 'rgba(110,87,250,0.1)', color: 'var(--accent)',
            fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
          }}>
            {pl.icon || '📦'} {pl.name}
            <button onClick={() => handleRemove(pl.id)} style={{
              background: 'none', border: 'none', color: 'var(--text-muted)',
              cursor: 'pointer', fontSize: 10, padding: 0, marginLeft: 2,
            }}>{'✕'}</button>
          </span>
        ))}
        {available.length > 0 && (
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowPicker(!showPicker)}
              style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 12,
                border: '1px dashed var(--border)', background: 'transparent',
                color: 'var(--text-muted)', cursor: 'pointer',
              }}
            >
              + {en ? 'Add' : 'Ajouter'}
            </button>
            {showPicker && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 10,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 8, padding: 6, minWidth: 160, marginTop: 4,
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}>
                {available.map(pl => (
                  <div key={pl.id} onClick={() => { handleAssign(pl.id); setShowPicker(false); }} style={{
                    padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                    borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6,
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <span>{pl.icon || '📦'}</span> {pl.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
