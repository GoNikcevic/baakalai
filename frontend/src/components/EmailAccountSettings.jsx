/* ═══════════════════════════════════════════════════
   Email Account Settings · Connect SMTP for nurture emails
   ═══════════════════════════════════════════════════ */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../services/api-client';
import { useT, useI18n } from '../i18n';
import Icon from './Icon';

/* Gmail et Outlook passent par OAuth uniquement : les app passwords Google sont
   souvent indisponibles (2FA/politique Workspace) et Microsoft a coupé l'auth
   basique SMTP. Le SMTP manuel reste pour les autres fournisseurs. */
function getPresets(lang) {
  const en = lang === 'en';
  return [
    {
      label: 'OVH', host: 'ssl0.ovh.net', port: 587,
      help: en ? 'Password for your OVH mailbox' : 'Mot de passe de votre boite email OVH',
      steps: en
        ? ['Use your full email address (e.g. contact@yourdomain.com)', 'The password is your OVH mailbox password']
        : ['Utilisez l\'adresse email compl\u00E8te (ex: contact@votredomaine.com)', 'Le mot de passe est celui de votre boite email OVH'],
      note: null,
    },
    {
      label: en ? 'Other SMTP' : 'Autre SMTP', host: '', port: 587,
      help: en ? 'Settings provided by your email host' : 'Param\u00E8tres fournis par votre h\u00E9bergeur email',
      steps: en
        ? ['Enter SMTP server (e.g. mail.yourdomain.com)', 'Port is usually 587 (TLS) or 465 (SSL)', 'Use your email login credentials']
        : ['Renseignez le serveur SMTP (ex: mail.votredomaine.com)', 'Le port est g\u00E9n\u00E9ralement 587 (TLS) ou 465 (SSL)', 'Utilisez vos identifiants de connexion email'],
      note: null,
    },
  ];
}

export default function EmailAccountSettings() {
  const t = useT();
  const { lang } = useI18n();
  const PRESETS = getPresets(lang);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState(0);

  const [connectingOAuth, setConnectingOAuth] = useState(null);
  const [connectingRead, setConnectingRead] = useState(null);

  const [form, setForm] = useState({
    emailAddress: '',
    smtpHost: 'ssl0.ovh.net',
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

  // Check URL params for OAuth callback result
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('email_connected')) {
      const connected = params.get('email_connected');
      setTestResult(connected === 'microsoft_read'
        // Retour de l'autorisation de lecture, pas d'une nouvelle bo\u00EEte :
        // \u00AB microsoft_read connect\u00E9 \u00BB ne voulait rien dire pour l'utilisateur.
        ? { success: true, message: t('emailAccount.replyReadDone') }
        : { success: true, message: `${connected} ${lang === 'en' ? 'connected successfully!' : 'connect\u00E9 avec succ\u00E8s !'}` });
      loadAccounts();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('email_error')) {
      setTestResult({ success: false, error: lang === 'en' ? 'Connection failed. Please try again.' : '\u00C9chec de connexion. Veuillez r\u00E9essayer.' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  const handleOAuthConnect = async (provider) => {
    setConnectingOAuth(provider);
    try {
      const data = await request(`/nurture/email-accounts/connect/${provider}`);
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setTestResult({ success: false, error: err.message });
      setConnectingOAuth(null);
    }
  };

  // Autorisation de LECTURE de la boîte Outlook, demandée à part de l'envoi :
  // Azure AD ne délivre un jeton que pour une ressource à la fois.
  const handleConnectRead = async (accountId) => {
    setConnectingRead(accountId);
    try {
      const data = await request(`/nurture/email-accounts/${accountId}/connect/microsoft-read`);
      if (data.url) window.location.href = data.url;
    } catch (err) {
      setTestResult({ success: false, error: err.message });
      setConnectingRead(null);
    }
  };

  const oauthProviderFor = (email) => {
    const e = (email || '').toLowerCase();
    if (/@(gmail|googlemail)\./.test(e)) return 'gmail';
    if (/@(outlook|hotmail|live|msn)\./.test(e)) return 'microsoft';
    return null;
  };
  const oauthHint = oauthProviderFor(form.emailAddress);

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
      setForm({ emailAddress: '', smtpHost: 'ssl0.ovh.net', smtpPort: 587, smtpUser: '', smtpPass: '' });
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
    if (!window.confirm(t('emailAccount.delete') + '?')) return;
    try {
      await request(`/nurture/email-accounts/${id}`, { method: 'DELETE' });
      await loadAccounts();
    } catch { /* ignore */ }
  };

  /* ─── Signature par compte (migration 102) ─── */
  const [sigOpenId, setSigOpenId] = useState(null);
  const [sigText, setSigText] = useState('');
  const [sigImage, setSigImage] = useState(null);
  const [sigSaving, setSigSaving] = useState(false);
  const [sigStatus, setSigStatus] = useState(null);

  const openSignature = (acc) => {
    if (sigOpenId === acc.id) { setSigOpenId(null); return; }
    setSigOpenId(acc.id);
    setSigText(acc.signature_text || '');
    setSigImage(acc.signature_image || null);
    setSigStatus(null);
  };

  const handleSigImageUpload = (file) => {
    if (!file) return;
    if (!/^image\/(png|jpe?g|gif|webp)$/.test(file.type)) {
      setSigStatus({ success: false, message: t('emailAccount.signatureBadType') });
      return;
    }
    if (file.size > 300 * 1024) {
      setSigStatus({ success: false, message: t('emailAccount.signatureTooBig') });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => { setSigImage(reader.result); setSigStatus(null); };
    reader.readAsDataURL(file);
  };

  const handleSigSave = async (accountId) => {
    setSigSaving(true);
    setSigStatus(null);
    try {
      await request(`/nurture/email-accounts/${accountId}/signature`, {
        method: 'PATCH',
        body: JSON.stringify({ signatureText: sigText || null, signatureImage: sigImage || null }),
      });
      setSigStatus({ success: true, message: t('emailAccount.signatureSaved') });
      await loadAccounts();
    } catch (err) {
      setSigStatus({ success: false, message: err.message });
    }
    setSigSaving(false);
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className="card-title">{t('emailAccount.title')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {t('emailAccount.subtitle')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {!showForm && accounts.length > 0 && (
            <>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => handleOAuthConnect('gmail')}
                disabled={!!connectingOAuth}
              >
                + Gmail
              </button>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}
                onClick={() => handleOAuthConnect('microsoft')}
                disabled={!!connectingOAuth}
              >
                + Outlook
              </button>
            </>
          )}
          {!showForm && (
            <button
              className="btn btn-primary btn-sm"
              onClick={() => setShowForm(true)}
            >
              {t('emailAccount.add')} (SMTP)
            </button>
          )}
        </div>
      </div>

      <div className="card-body">
        {/* OAuth connect buttons */}
        {accounts.length === 0 && !showForm && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              {lang === 'en' ? 'Connect with one click:' : 'Connecter en un clic :'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-outline"
                style={{ flex: 1, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onClick={() => handleOAuthConnect('gmail')}
                disabled={!!connectingOAuth}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
                {connectingOAuth === 'gmail' ? '...' : 'Gmail'}
              </button>
              <button
                className="btn btn-outline"
                style={{ flex: 1, padding: '10px 16px', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                onClick={() => handleOAuthConnect('microsoft')}
                disabled={!!connectingOAuth}
              >
                <svg width="16" height="16" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>
                {connectingOAuth === 'microsoft' ? '...' : 'Outlook / O365'}
              </button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
              {lang === 'en' ? 'Other provider (OVH, Zoho…)? Configure SMTP manually below' : 'Autre fournisseur (OVH, Zoho…) ? Configurez le SMTP manuellement ci-dessous'}
            </div>
          </div>
        )}

        {/* Existing accounts */}
        {accounts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: showForm ? 16 : 0 }}>
            {accounts.map(acc => (
              <div key={acc.id} style={{
                borderRadius: 8,
                border: `1px solid ${acc.status === 'active' ? 'var(--success)' : 'var(--warning)'}`,
                background: acc.status === 'active' ? 'rgba(0,214,143,0.04)' : 'rgba(255,170,0,0.04)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{acc.email_address}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {acc.provider === 'gmail' ? 'Gmail OAuth' : acc.provider === 'microsoft' ? 'Microsoft OAuth' : `${acc.smtp_host}:${acc.smtp_port}`}
                      {' \u00B7 '}<Icon name={acc.status === 'active' ? 'checkCircle' : 'alert'} size={11} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                      {acc.status === 'active' ? t('emailAccount.active') : t('emailAccount.expired')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {acc.status === 'expired' && (acc.provider === 'gmail' || acc.provider === 'microsoft') && (
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 10, padding: '4px 10px' }}
                        onClick={() => handleOAuthConnect(acc.provider)}
                      >
                        {lang === 'en' ? 'Reconnect' : 'Reconnecter'}
                      </button>
                    )}
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 10, padding: '4px 10px', fontWeight: (acc.signature_text || acc.signature_image) ? 600 : 400 }}
                      onClick={() => openSignature(acc)}
                    >
                      {t('emailAccount.signature')}{(acc.signature_text || acc.signature_image) ? ' \u2713' : ''}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 10, padding: '4px 10px' }}
                      onClick={() => handleTest(acc.id)}
                      disabled={testing}
                    >
                      {testing ? '...' : t('emailAccount.test')}
                    </button>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: 10, padding: '4px 10px', color: 'var(--danger)' }}
                      onClick={() => handleDelete(acc.id)}
                    >
                      {t('emailAccount.delete')}
                    </button>
                  </div>
                </div>

                {/* Outlook : lire la boîte demande un consentement distinct de
                    l'envoi. Sans lui, une séquence continue de tourner après
                    une réponse et aucune alerte ne part · ça se dit ici. */}
                {acc.provider === 'microsoft' && (
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                    padding: '8px 14px', borderTop: '1px solid var(--border)',
                  }}>
                    <div style={{ fontSize: 11, color: acc.reply_read_enabled ? 'var(--text-muted)' : 'var(--warning)' }}>
                      <Icon
                        name={acc.reply_read_enabled ? 'checkCircle' : 'alert'}
                        size={11}
                        style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }}
                      />
                      {acc.reply_read_enabled ? t('emailAccount.replyReadOn') : t('emailAccount.replyReadOff')}
                    </div>
                    {!acc.reply_read_enabled && (
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 10, padding: '4px 10px', flexShrink: 0 }}
                        disabled={connectingRead === acc.id}
                        onClick={() => handleConnectRead(acc.id)}
                      >
                        {connectingRead === acc.id ? '...' : t('emailAccount.replyReadConnect')}
                      </button>
                    )}
                  </div>
                )}

                {sigOpenId === acc.id && (
                  <div style={{ padding: '12px 14px', borderTop: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                      {t('emailAccount.signatureHint')}
                    </div>
                    <textarea
                      className="form-input"
                      rows={4}
                      placeholder={t('emailAccount.signatureTextPlaceholder')}
                      value={sigText}
                      onChange={e => setSigText(e.target.value)}
                      style={{ width: '100%', boxSizing: 'border-box', fontSize: 13, padding: '8px 12px', resize: 'vertical', fontFamily: 'inherit' }}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                      {sigImage ? (
                        <>
                          <img src={sigImage} alt="" style={{ maxWidth: 160, maxHeight: 60, borderRadius: 4, border: '1px solid var(--border)' }} />
                          <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', color: 'var(--danger)' }} onClick={() => setSigImage(null)}>
                            {t('emailAccount.signatureRemoveImage')}
                          </button>
                        </>
                      ) : (
                        <label className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>
                          {t('emailAccount.signatureUpload')}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/gif,image/webp"
                            style={{ display: 'none' }}
                            onChange={e => { handleSigImageUpload(e.target.files?.[0]); e.target.value = ''; }}
                          />
                        </label>
                      )}
                      <div style={{ flex: 1 }} />
                      <button
                        className="btn btn-primary"
                        style={{ fontSize: 11, padding: '5px 14px' }}
                        onClick={() => handleSigSave(acc.id)}
                        disabled={sigSaving}
                      >
                        {sigSaving ? t('emailAccount.saving') : t('emailAccount.save')}
                      </button>
                    </div>
                    {sigStatus && (
                      <div style={{ fontSize: 11, marginTop: 8, color: sigStatus.success ? 'var(--success)' : 'var(--danger)' }}>
                        {sigStatus.message}
                      </div>
                    )}
                  </div>
                )}
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
            <Icon name={testResult.success ? 'checkCircle' : 'close'} size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
            {testResult.success ? 'Connexion r\u00E9ussie' : testResult.error}
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

            {/* Step-by-step guide */}
            <div style={{
              fontSize: 12, color: 'var(--text-secondary)',
              background: 'var(--bg-elevated)', borderRadius: 8,
              padding: '12px 14px', marginBottom: 14,
              lineHeight: 1.7,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>
                {PRESETS[selectedPreset].help}
              </div>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                {PRESETS[selectedPreset].steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              {PRESETS[selectedPreset].note && (
                <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 8 }}>
                  <Icon name="alert" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{PRESETS[selectedPreset].note}
                </div>
              )}
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
              {oauthHint && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '8px 12px', borderRadius: 8, fontSize: 12,
                  background: 'rgba(255,170,0,0.08)', color: 'var(--warning)',
                }}>
                  <span>
                    <Icon name="alert" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                    {lang === 'en'
                      ? `For ${oauthHint === 'gmail' ? 'Gmail' : 'Outlook'}, use the one-click connection, no password needed.`
                      : `Pour ${oauthHint === 'gmail' ? 'Gmail' : 'Outlook'}, utilisez la connexion en un clic, aucun mot de passe nécessaire.`}
                  </span>
                  <button
                    className="btn btn-primary"
                    style={{ fontSize: 11, padding: '4px 10px', whiteSpace: 'nowrap' }}
                    onClick={() => handleOAuthConnect(oauthHint)}
                    disabled={!!connectingOAuth}
                  >
                    {connectingOAuth ? '...' : (lang === 'en' ? 'Connect' : 'Connecter')} {oauthHint === 'gmail' ? 'Gmail' : 'Outlook'}
                  </button>
                </div>
              )}
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
                placeholder={lang === 'en' ? 'Mailbox password' : 'Mot de passe de la boite email'}
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
                  {t('common.cancel')}
                </button>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 12, padding: '6px 14px' }}
                  onClick={handleSave}
                  disabled={saving || !form.emailAddress || !form.smtpPass}
                >
                  {saving ? t('emailAccount.saving') : t('emailAccount.save')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && accounts.length === 0 && !showForm && (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)', fontSize: 12 }}>
            {t('emailAccount.noAccount')}
          </div>
        )}
      </div>
    </div>
  );
}
