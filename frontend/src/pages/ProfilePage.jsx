/* ===============================================================================
   BAKAL — Profile Page (React)
   Ported from app/pages.js (saveProfile, loadProfile, populateProfileForm).
   Company info, value prop, personas, targets, communication style.
   =============================================================================== */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useApp } from '../context/useApp';
import { request } from '../services/api-client';
import { useT, useI18n } from '../i18n';

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
  const [autoFilling, setAutoFilling] = useState(false);

  /* ─── File upload state ─── */
  const [files, setFiles] = useState([]);
  const [fileTypes, setFileTypes] = useState({}); // { filename: 'company' | 'prospects' | 'brief' | 'other' }
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedDocs, setUploadedDocs] = useState([]);
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const fileInputRef = useRef(null);
  const dragCounterRef = useRef(0);

  /* ─── Load uploaded documents ─── */
  useEffect(() => {
    request('/documents').then(data => {
      // Filter out chat_attachment docs — they belong to chat context, not profile
      if (data && data.documents) setUploadedDocs(data.documents.filter(d => d.doc_type !== 'chat_attachment'));
    }).catch(() => {});
  }, []);

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

  /* ─── File upload handlers ─── */

  const handleDragEnter = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => { e.preventDefault(); e.stopPropagation(); }, []);

  const addFiles = useCallback((newFiles) => {
    const MAX = 20 * 1024 * 1024;
    const valid = Array.from(newFiles).filter(f => f.size <= MAX);
    if (valid.length > 0) setFiles(prev => [...prev, ...valid]);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    if (e.dataTransfer.files?.length > 0) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const handleUpload = useCallback(async () => {
    if (files.length === 0) return;
    setUploading(true);
    setUploadSuccess(null);
    try {
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }
      formData.append('docTypes', JSON.stringify(fileTypes));

      const token = localStorage.getItem('bakal_token');
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      if (!res.ok) throw new Error('Upload failed');

      const count = files.length;
      setFiles([]);
      setFileTypes({});
      setUploadSuccess(`${count} fichier${count > 1 ? 's' : ''} envoyé${count > 1 ? 's' : ''}`);
      setTimeout(() => setUploadSuccess(null), 4000);
      request('/documents').then(data => {
        if (data && data.documents) setUploadedDocs(data.documents.filter(d => d.doc_type !== 'chat_attachment'));
      }).catch(() => {});
    } catch (err) {
      setUploadSuccess(null);
      console.warn('Upload failed:', err.message);
    }
    setUploading(false);
  }, [files, fileTypes]);

  const removeFile = useCallback((i) => {
    setFiles(prev => prev.filter((_, idx) => idx !== i));
  }, []);

  const handleAutoFill = useCallback(async () => {
    setAutoFilling(true);
    try {
      const data = await request('/profile/auto-fill', { method: 'POST' });
      if (data.profile) {
        setProfile(prev => {
          const updated = { ...prev };
          for (const [key, value] of Object.entries(data.profile)) {
            if (value && typeof value === 'string') {
              updated[key] = value;
            }
          }
          return updated;
        });
      }
    } catch (err) {
      console.warn('Auto-fill failed:', err.message);
      // Auto-retry: reparse docs then try once more
      if (err.message && err.message.includes('parsing a échoué')) {
        try {
          const reparseData = await request('/documents/reparse', { method: 'POST' });
          console.log('Reparse results:', reparseData.results);
          const anyReparsed = reparseData.results?.some(r => r.status === 'reparsed');
          if (anyReparsed) {
            const retryData = await request('/profile/auto-fill', { method: 'POST' });
            if (retryData.profile) {
              setProfile(prev => {
                const updated = { ...prev };
                for (const [key, value] of Object.entries(retryData.profile)) {
                  if (value && typeof value === 'string') updated[key] = value;
                }
                return updated;
              });
            }
          } else {
            const details = (reparseData.results || [])
              .map(r => `• ${r.name}: ${r.status}${r.message ? ' (' + r.message + ')' : ''}${r.chars ? ' — ' + r.chars + ' chars' : ''}`)
              .join('\n');
            alert('Reparse a échoué pour tous les docs:\n\n' + details);
          }
        } catch (retryErr) {
          console.warn('Reparse failed:', retryErr.message);
          alert('Erreur: ' + err.message);
        }
      } else {
        alert('Auto-fill: ' + err.message);
      }
    }
    setAutoFilling(false);
  }, []);

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' o';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' Ko';
    return (bytes / (1024 * 1024)).toFixed(1) + ' Mo';
  };

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
          <div className="page-subtitle">Ces informations sont utilisées par Baakalai pour personnaliser vos campagnes</div>
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

      {/* Product Lines / Projects — wraps all profile sections */}
      <ProductLinesSection profile={profile} renderInput={renderInput} renderTextarea={renderTextarea} renderSelect={renderSelect}
        docProps={{ files, fileTypes, setFileTypes, isDragging, fileInputRef, handleDragEnter, handleDragLeave, handleDragOver, handleDrop, addFiles, removeFile, handleUpload, uploading, uploadSuccess, uploadedDocs, setUploadedDocs, handleAutoFill, autoFilling, formatSize }} />

      {/* Documents moved inside ProductLinesSection */}
      {false && <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">Documents entreprise</div></div>
        <div className="card-body">
          <div className="page-subtitle" style={{ marginBottom: 16 }}>
            Briefs, guidelines, personas PDF, exemples de campagnes — Baakalai les utilisera pour personnaliser vos séquences.
          </div>
          <div
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            style={{
              border: `2px dashed ${isDragging ? 'var(--blue)' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '32px 20px',
              textAlign: 'center',
              background: isDragging ? 'rgba(96,165,250,0.06)' : 'var(--bg-elevated)',
              transition: 'all 0.2s',
              cursor: 'pointer',
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".csv,.xlsx,.xls,.pdf,.docx,.txt,.png,.jpg,.jpeg,.webp"
              style={{ display: 'none' }}
              onChange={(e) => { if (e.target.files?.length > 0) { addFiles(e.target.files); e.target.value = ''; } }}
            />
            <div style={{ fontSize: 28, marginBottom: 8 }}>+</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
              {isDragging ? 'Déposez vos fichiers ici' : 'Glissez vos fichiers ici ou cliquez pour parcourir'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              PDF, DOCX, CSV, Excel, images — max 20 Mo par fichier
            </div>
          </div>

          {files.length > 0 && (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {files.map((f, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', borderRadius: 8, fontSize: 13,
                }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                  <select
                    value={fileTypes[f.name] || 'other'}
                    onChange={e => setFileTypes(prev => ({ ...prev, [f.name]: e.target.value }))}
                    onClick={e => e.stopPropagation()}
                    style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}
                  >
                    <option value="company">Présentation entreprise</option>
                    <option value="prospects">Liste prospects</option>
                    <option value="brief">Brief campagne</option>
                    <option value="other">Autre</option>
                  </select>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>{formatSize(f.size)}</span>
                  <button onClick={() => removeFile(i)} style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-muted)', fontSize: 14, padding: '0 4px',
                  }}>x</button>
                </div>
              ))}
              <button
                className="btn btn-primary"
                onClick={handleUpload}
                disabled={uploading}
                style={{ alignSelf: 'flex-start', marginTop: 8 }}
              >
                {uploading ? 'Upload en cours...' : `Envoyer ${files.length} fichier${files.length > 1 ? 's' : ''}`}
              </button>
            </div>
          )}

          {/* Upload success message */}
          {uploadSuccess && (
            <div style={{
              marginTop: 12, padding: '10px 14px', borderRadius: 8,
              background: 'rgba(0,214,143,0.08)', border: '1px solid rgba(0,214,143,0.2)',
              color: 'var(--success)', fontSize: 13, fontWeight: 500,
              animation: 'fadeInUp 0.3s ease-out',
            }}>
              ✅ {uploadSuccess}
            </div>
          )}

          {/* Already uploaded documents */}
          {uploadedDocs.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Documents envoyés
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {uploadedDocs.map((doc, i) => (
                  <div key={doc.id || i} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', background: 'var(--bg-elevated)',
                    borderRadius: 6, fontSize: 13,
                  }}>
                    <span style={{ fontSize: 14 }}>
                      {doc.mime_type?.includes('pdf') ? '📄' : doc.mime_type?.includes('spreadsheet') || doc.mime_type?.includes('excel') ? '📊' : doc.mime_type?.includes('presentation') ? '📽️' : '📎'}
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {doc.original_name}
                    </span>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 10,
                      background: doc.doc_type === 'company' ? 'rgba(0,214,143,0.1)' : 'var(--bg-elevated)',
                      color: doc.doc_type === 'company' ? 'var(--success)' : 'var(--text-muted)',
                      border: `1px solid ${doc.doc_type === 'company' ? 'rgba(0,214,143,0.2)' : 'var(--border)'}`,
                    }}>
                      {doc.doc_type === 'company' ? 'Entreprise' : doc.doc_type === 'prospects' ? 'Prospects' : doc.doc_type === 'brief' ? 'Brief' : 'Autre'}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 11, flexShrink: 0 }}>
                      {new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                    </span>
                    <button
                      onClick={async () => {
                        try {
                          await request('/documents/' + doc.id, { method: 'DELETE' });
                          setUploadedDocs(prev => prev.filter(d => d.id !== doc.id));
                        } catch {}
                      }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--text-muted)', fontSize: 13, padding: '0 4px',
                        transition: 'color 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--danger)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                      title="Supprimer"
                    >×</button>
                  </div>
                ))}
              </div>
              <button
                className="btn btn-primary"
                onClick={handleAutoFill}
                disabled={autoFilling}
                style={{ marginTop: 12 }}
              >
                {autoFilling ? 'Analyse en cours...' : '\uD83E\uDDE0 Auto-remplir avec mes documents entreprise'}
              </button>
            </div>
          )}
        </div>
      </div>}
    </div>
  );
}

/* ═══ Product Lines Section ═══ */

function ProductLinesSection({ profile, renderInput, renderTextarea, renderSelect, docProps }) {
  const { files, fileTypes, setFileTypes, isDragging, fileInputRef, handleDragEnter, handleDragLeave, handleDragOver, handleDrop, addFiles, removeFile, handleUpload, uploading, uploadSuccess, uploadedDocs, setUploadedDocs, handleAutoFill, autoFilling, formatSize } = docProps || {};
  const { lang } = useI18n();
  const en = lang === 'en';
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', icon: '', description: '', targetSectors: '', valueProp: '', painPoints: '' });
  const [autoCreated, setAutoCreated] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await request('/crm/product-lines');
      const pl = data.productLines || [];
      setLines(pl);
      if (pl.length > 0 && !activeTab) setActiveTab(pl[0].id);

      if (pl.length === 0 && profile?.company && !autoCreated) {
        setAutoCreated(true);
        try {
          const res = await request('/crm/product-lines', {
            method: 'POST',
            body: JSON.stringify({
              name: profile.company,
              icon: '🏢',
              description: profile.description || '',
              targetSectors: profile.target_sectors || '',
              valueProp: profile.value_prop || '',
              painPoints: profile.pain_points || '',
            }),
          });
          if (res.productLine) {
            setLines([res.productLine]);
            setActiveTab(res.productLine.id);
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, [profile?.company]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (activeTab === 'new') {
      setForm({ name: '', icon: '', description: '', targetSectors: '', valueProp: '', painPoints: '' });
    } else if (activeTab) {
      const pl = lines.find(l => l.id === activeTab);
      if (pl) setForm({
        name: pl.name || '', icon: pl.icon || '', description: pl.description || '',
        targetSectors: pl.target_sectors || '', valueProp: pl.value_prop || '', painPoints: pl.pain_points || '',
      });
    }
  }, [activeTab, lines]);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (activeTab === 'new') {
        const data = await request('/crm/product-lines', { method: 'POST', body: JSON.stringify(form) });
        await load();
        setActiveTab(data.productLine?.id || null);
      } else {
        await request(`/crm/product-lines/${activeTab}`, { method: 'PATCH', body: JSON.stringify(form) });
        await load();
      }
    } catch { /* ignore */ }
    setSaving(false);
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(en ? `Delete "${name}"?` : `Supprimer "${name}" ?`)) return;
    try {
      await request(`/crm/product-lines/${id}`, { method: 'DELETE' });
      const remaining = lines.filter(l => l.id !== id);
      setLines(remaining);
      setActiveTab(remaining.length > 0 ? remaining[0].id : null);
    } catch { /* ignore */ }
  };

  if (loading) return null;

  const tabStyle = (isActive, isDashed) => ({
    padding: '8px 18px', fontSize: 13, borderRadius: '10px 10px 0 0',
    border: `1px ${isDashed ? 'dashed' : 'solid'} ${isActive ? 'var(--accent)' : 'var(--border)'}`,
    borderBottom: isActive ? '2px solid var(--accent)' : '1px solid transparent',
    background: isActive ? 'var(--bg-card)' : 'transparent',
    color: isActive ? 'var(--accent)' : 'var(--text-muted)',
    fontWeight: isActive ? 600 : 400,
    cursor: 'pointer',
  });

  return (
    <>
      {/* Project tabs */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: -1 }}>
        {lines.map(pl => (
          <button key={pl.id} onClick={() => setActiveTab(pl.id)} style={tabStyle(activeTab === pl.id, false)}>
            {pl.icon || '📦'} {pl.name}
          </button>
        ))}
        <button onClick={() => setActiveTab('new')} style={tabStyle(activeTab === 'new', true)}>
          + {en ? 'New project' : 'Nouveau projet'}
        </button>
      </div>

      {/* Active project content */}
      {activeTab && (
        <div className="card" style={{ marginBottom: 16, borderTopLeftRadius: 0 }}>
          <div className="card-body" style={{ paddingTop: 20 }}>

            {/* Project identity */}
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {en ? 'Project identity' : 'Identit\u00e9 du projet'}
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <div className="form-group" style={{ width: 70 }}>
                <label className="form-label">{en ? 'Icon' : 'Ic\u00f4ne'}</label>
                <input className="form-input" value={form.icon} onChange={e => setForm(p => ({ ...p, icon: e.target.value }))}
                  style={{ fontSize: 18, textAlign: 'center', padding: '6px' }} maxLength={2} placeholder="📦" />
              </div>
              <div className="form-group" style={{ flex: 1 }}>
                <label className="form-label">{en ? 'Project name' : 'Nom du projet'}</label>
                <input className="form-input" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder={en ? 'e.g., Cybersecurity Solutions' : 'ex: Solutions Cybers\u00e9curit\u00e9'} />
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">Description</label>
              <textarea className="form-input" rows={3} value={form.description}
                onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                placeholder={en ? 'Describe this product line and its main services...' : 'D\u00e9crivez cette ligne de produits et ses services principaux...'} />
            </div>

            {/* Value proposition */}
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, marginTop: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {en ? 'Value proposition' : 'Proposition de valeur'}
            </div>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">{en ? 'Value proposition' : 'Proposition de valeur'}</label>
              <textarea className="form-input" rows={3} value={form.valueProp}
                onChange={e => setForm(p => ({ ...p, valueProp: e.target.value }))}
                placeholder={en ? 'What problem does it solve? What makes it unique?' : 'Quel probl\u00e8me r\u00e9sout-il ? Qu\'est-ce qui le rend unique ?'} />
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">{en ? 'Client pain points' : 'Pain points clients'}</label>
              <textarea className="form-input" rows={3} value={form.painPoints}
                onChange={e => setForm(p => ({ ...p, painPoints: e.target.value }))}
                placeholder={en ? 'What frustrations do your clients face?' : 'Quelles frustrations rencontrent vos clients ?'} />
            </div>

            {/* Targeting */}
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, marginTop: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {en ? 'Targeting' : 'Ciblage'}
            </div>
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label className="form-label">{en ? 'Target sectors' : 'Secteurs cibles'}</label>
              <input className="form-input" value={form.targetSectors}
                onChange={e => setForm(p => ({ ...p, targetSectors: e.target.value }))}
                placeholder={en ? 'e.g., Finance, Healthcare, Telecom' : 'ex: Finance, Sant\u00e9, T\u00e9l\u00e9com'} />
            </div>

            {/* Global profile fields (shared across projects) */}
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, marginTop: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {en ? 'Company info (shared)' : 'Informations entreprise (partag\u00e9es)'}
            </div>
            <div className="form-grid">
              {renderInput(en ? 'Company name' : 'Nom de l\'entreprise', 'company', { placeholder: 'Ex: FormaPro Consulting' })}
              {renderInput(en ? 'Industry' : 'Secteur d\'activit\u00e9', 'sector', { placeholder: 'Ex: Formation professionnelle' })}
              {renderInput(en ? 'Website' : 'Site web', 'website', { type: 'url', placeholder: 'https://...' })}
              {renderSelect(en ? 'Team size' : 'Taille d\'\u00e9quipe', 'team_size', ['1-5', '6-10', '11-25', '26-50', '51-100', '100+'])}
            </div>

            <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {en ? 'Personas & style (shared)' : 'Personas & style (partag\u00e9s)'}
            </div>
            {renderTextarea(en ? 'Primary persona' : 'Persona principal', 'persona_primary', {
              placeholder: en ? 'Describe your ideal contact: role, responsibilities, daily challenges...' : 'D\u00e9crivez votre interlocuteur id\u00e9al : poste, responsabilit\u00e9s, d\u00e9fis quotidiens...', rows: 2,
            })}
            {renderTextarea(en ? 'Secondary persona' : 'Persona secondaire', 'persona_secondary', {
              placeholder: en ? 'Other target profile (if applicable)...' : 'Autre profil cible (si applicable)...', rows: 2,
            })}
            <div className="form-grid" style={{ marginTop: 8 }}>
              {renderSelect(en ? 'Default tone' : 'Ton par d\u00e9faut', 'default_tone', ['Pro d\u00e9contract\u00e9', 'Formel', 'Amical', 'Direct', 'Expert'])}
              {renderSelect(en ? 'Formality' : 'Formalit\u00e9', 'default_formality', ['Vous', 'Tu'])}
            </div>

            {/* Documents */}
            {docProps && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  {en ? 'Documents' : 'Documents'}
                </div>
                <div
                  onDragEnter={handleDragEnter} onDragLeave={handleDragLeave} onDragOver={handleDragOver} onDrop={handleDrop}
                  style={{
                    border: `2px dashed ${isDragging ? 'var(--blue)' : 'var(--border)'}`,
                    borderRadius: 10, padding: '20px 16px', textAlign: 'center',
                    background: isDragging ? 'rgba(96,165,250,0.06)' : 'var(--bg-elevated)',
                    cursor: 'pointer', transition: 'all 0.2s',
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input ref={fileInputRef} type="file" multiple accept=".csv,.xlsx,.xls,.pdf,.docx,.txt,.png,.jpg,.jpeg,.webp"
                    style={{ display: 'none' }}
                    onChange={(e) => { if (e.target.files?.length > 0) { addFiles(e.target.files); e.target.value = ''; } }} />
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    {isDragging ? (en ? 'Drop files here' : 'D\u00e9posez ici') : (en ? 'Drag files or click to browse' : 'Glissez vos fichiers ou cliquez')}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>PDF, DOCX, CSV, Excel, images</div>
                </div>
                {files?.length > 0 && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {files.map((f, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{formatSize(f.size)}</span>
                        <button onClick={() => removeFile(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13 }}>x</button>
                      </div>
                    ))}
                    <button className="btn btn-primary" onClick={handleUpload} disabled={uploading} style={{ alignSelf: 'flex-start', marginTop: 4, fontSize: 12 }}>
                      {uploading ? '...' : `${en ? 'Upload' : 'Envoyer'} ${files.length} ${en ? 'file(s)' : 'fichier(s)'}`}
                    </button>
                  </div>
                )}
                {uploadSuccess && (
                  <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 6, background: 'rgba(0,214,143,0.08)', color: 'var(--success)', fontSize: 12 }}>
                    {uploadSuccess}
                  </div>
                )}
                {uploadedDocs?.length > 0 && (
                  <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {uploadedDocs.map((doc, i) => (
                      <div key={doc.id || i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', background: 'var(--bg-elevated)', borderRadius: 5, fontSize: 12 }}>
                        <span style={{ fontSize: 13 }}>{doc.mime_type?.includes('pdf') ? '📄' : doc.mime_type?.includes('sheet') || doc.mime_type?.includes('excel') ? '📊' : '📎'}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.original_name}</span>
                        <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>{new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                        <button onClick={async () => { try { await request('/documents/' + doc.id, { method: 'DELETE' }); setUploadedDocs(prev => prev.filter(d => d.id !== doc.id)); } catch {} }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 12 }}>×</button>
                      </div>
                    ))}
                    <button className="btn btn-primary" onClick={handleAutoFill} disabled={autoFilling} style={{ marginTop: 6, fontSize: 12 }}>
                      {autoFilling ? '...' : (en ? 'Auto-fill from documents' : 'Auto-remplir avec les documents')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <div>
                {activeTab !== 'new' && (
                  <button className="btn btn-ghost" style={{ fontSize: 12, color: 'var(--danger)' }}
                    onClick={() => handleDelete(activeTab, form.name)}>
                    {en ? 'Delete project' : 'Supprimer le projet'}
                  </button>
                )}
              </div>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '8px 20px' }}
                onClick={handleSave} disabled={saving || !form.name.trim()}>
                {saving ? '...' : activeTab === 'new' ? (en ? 'Create project' : 'Cr\u00e9er le projet') : (en ? 'Save project' : 'Sauvegarder le projet')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {lines.length === 0 && activeTab !== 'new' && (
        <div className="card" style={{ marginBottom: 16, textAlign: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
          {en ? 'No projects yet. Click "+ New project" to get started.' : 'Aucun projet. Cliquez sur "+ Nouveau projet" pour commencer.'}
        </div>
      )}
    </>
  );
}
