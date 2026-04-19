/* ═══════════════════════════════════════════════════
   Email Account Settings — Connect SMTP for nurture emails
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';

const PRESETS = [
  { label: 'Gmail', host: 'smtp.gmail.com', port: 587, help: 'Utilisez un mot de passe d\'application (pas votre mot de passe Gmail)' },
  { label: 'Outlook / O365', host: 'smtp.office365.com', port: 587, help: 'Mot de passe de votre compte Microsoft' },
  { label: 'OVH', host: 'ssl0.ovh.net', port: 587, help: 'Mot de passe de votre boite OVH' },
  { label: 'Autre SMTP', host: '', port: 587, help: 'Entrez les paramètres de votre serveur SMTP' },
];

export default function EmailAccountSettings() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(0);

  const [form, setForm] = useState({
    emailAddress: '',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
  });

  const loadAccounts = useCallback(async () => {
    try {
      const data = await request('/nurture/email-accounts');
      setAccounts(data.accounts || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const handlePreset = (idx) => {
    setSelectedPreset(idx);
    const p = PRESETS[idx];
    setForm(prev => ({ ...prev, smtpHost: p.host, smtpPort: p.port }));
  };

  const handleSave = async () => {
    if (!form.emailAddress || !form.smtpPass) return;
    setSaving(true);
    try {
      await request('/nurture/email-accounts', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'smtp',
          emailAddress: form.emailAddress,
          smtpHost: form.smtpHost,
          smtpPort: form.smtpPort,
          smtpUser: form.smtpUser || form.emailAddress,
          smtpPass: form.smtpPass,
        }),
      });
      setShowForm(false);
      setForm({ emailAddress: '', smtpHost: 'smtp.gmail.com', smtpPort: 587, smtpUser: '', smtpPass: '' });
      await loadAccounts();
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    }
    setSaving(false);
  };

  const handleTest = async (id) => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await request('/nurture/email-accounts/test', {
        method: 'POST',
        body: JSON.stringify({ id }),
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err.message });
    }
    setTesting(false);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Supprimer ce compte email ?')) return;
    try {
      await request(`/nurture/email-accounts/${id}`, { method: 'DELETE' });
      await loadAccounts();
    } catch { /* ignore */ }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="card-title">Email sortant</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            Connectez votre email pour envoyer des emails d'activation personnalis{'\u00E9'}s
          </div>
        </div>
        {!showForm && (
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setShowForm(true)}
          >
            + Ajouter
          </button>
        )}
      </div>

      <div className="card-body">
        {/* Existing accounts */}
        {accounts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: showForm ? 16 : 0 }}>
            {accounts.map(acc => (
              <div key={acc.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', borderRadius: 8,
                border: `1px solid ${acc.status === 'active' ? 'var(--success)' : 'var(--warning)'}`,
                background: acc.status === 'active' ? 'rgba(0,214,143,0.04)' : 'rgba(255,170,0,0.04)',
              }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{acc.email_address}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {acc.smtp_host}:{acc.smtp_port} {'\u00B7'} {acc.status === 'active' ? '\u2705 Actif' : '\u26A0\uFE0F Expir\u00E9'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 10, padding: '4px 10px' }}
                    onClick={() => handleTest(acc.id)}
                    disabled={testing}
                  >
                    {testing ? '...' : 'Tester'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 10, padding: '4px 10px', color: 'var(--danger)' }}
                    onClick={() => handleDelete(acc.id)}
                  >
                    Supprimer
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div style={{
            padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 12,
            background: testResult.success ? 'rgba(0,214,143,0.1)' : 'rgba(255,107,107,0.1)',
            color: testResult.success ? 'var(--success)' : 'var(--danger)',
          }}>
            {testResult.success ? '\u2705 Connexion r\u00E9ussie' : `\u274C ${testResult.error}`}
          </div>
        )}

        {/* Add form */}
        {showForm && (
          <div style={{ borderTop: accounts.length > 0 ? '1px solid var(--border)' : 'none', paddingTop: accounts.length > 0 ? 16 : 0 }}>
            {/* Preset buttons */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
              {PRESETS.map((p, i) => (
                <button
                  key={p.label}
                  onClick={() => handlePreset(i)}
                  style={{
                    padding: '5px 12px', fontSize: 11, borderRadius: 6,
                    border: `1px solid ${selectedPreset === i ? 'var(--accent)' : 'var(--border)'}`,
                    background: selectedPreset === i ? 'rgba(99,102,241,0.1)' : 'transparent',
                    color: selectedPreset === i ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* Help text */}
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12 }}>
              {PRESETS[selectedPreset].help}
            </div>

            {/* Fields */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <input
                type="email"
                placeholder="votre@email.com"
                value={form.emailAddress}
                onChange={e => setForm(p => ({ ...p, emailAddress: e.target.value, smtpUser: e.target.value }))}
                className="form-input"
                style={{ fontSize: 13, padding: '8px 12px' }}
              />
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Serveur SMTP"
                  value={form.smtpHost}
                  onChange={e => setForm(p => ({ ...p, smtpHost: e.target.value }))}
                  className="form-input"
                  style={{ flex: 2, fontSize: 13, padding: '8px 12px' }}
                />
                <input
                  type="number"
                  placeholder="Port"
                  value={form.smtpPort}
                  onChange={e => setForm(p => ({ ...p, smtpPort: parseInt(e.target.value, 10) || 587 }))}
                  className="form-input"
                  style={{ flex: 0.5, fontSize: 13, padding: '8px 12px' }}
                />
              </div>
              <input
                type="password"
                placeholder="Mot de passe ou mot de passe d'application"
                value={form.smtpPass}
                onChange={e => setForm(p => ({ ...p, smtpPass: e.target.value }))}
                className="form-input"
                style={{ fontSize: 13, padding: '8px 12px' }}
              />
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: '6px 14px' }}
                  onClick={() => { setShowForm(false); setTestResult(null); }}
                >
                  Annuler
                </button>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '6px 14px' }}
                  onClick={handleSave}
                  disabled={saving || !form.emailAddress || !form.smtpPass}
                >
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && accounts.length === 0 && !showForm && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>
            Aucun email configur{'\u00E9'}. Ajoutez votre compte pour envoyer des emails d'activation.
          </div>
        )}
      </div>
    </div>
  );
}
