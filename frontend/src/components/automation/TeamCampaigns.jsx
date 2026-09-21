/* ===============================================================================
   BAKAL · Campagnes équipe (envoi depuis la boîte de chaque commercial)
   Déplacé depuis NurturePage · réservé aux admins, comme avant.
   =============================================================================== */

import { useState, useEffect, useCallback } from 'react';
import { request } from '../../services/api-client';
import { showToast } from '../../services/notifications';
import { useT, useI18n } from '../../i18n';
import { useConfirm } from '../ConfirmModal';
import Icon from '../Icon';

export default function TeamCampaigns() {
  const t = useT();
  const { lang } = useI18n();
  const en = lang === 'en';
  const locale = en ? 'en-US' : 'fr-FR';
  const confirm = useConfirm();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [owners, setOwners] = useState([]);
  const [productLines, setProductLines] = useState([]);
  const [previewing, setPreviewing] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewedId, setPreviewedId] = useState(null);
  const [launching, setLaunching] = useState(null);

  const [form, setForm] = useState({
    name: '',
    targetOwners: [],
    targetProductLines: [],
    emailPrompt: '',
    emailTone: 'professional',
  });

  const load = useCallback(async () => {
    try {
      const [campData, ownerData, plData] = await Promise.all([
        request('/team-campaigns'),
        request('/crm/team-owners').catch(() => ({ owners: [] })),
        request('/crm/product-lines').catch(() => ({ productLines: [] })),
      ]);
      setCampaigns(campData.campaigns || []);
      setOwners(ownerData.owners || []);
      setProductLines(plData.productLines || []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    try {
      await request('/team-campaigns', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', targetOwners: [], targetProductLines: [], emailPrompt: '', emailTone: 'professional' });
      setShowCreate(false);
      await load();
    } catch { showToast({ type: 'error', title: t('common.error'), message: en ? 'Failed to create campaign' : 'Échec de création de la campagne' }); }
  };

  const handlePreview = async (id) => {
    setPreviewing(id);
    setPreviewData(null);
    setPreviewedId(id);
    try {
      const data = await request(`/team-campaigns/${id}/preview`, { method: 'POST' });
      setPreviewData(data);
    } catch { showToast({ type: 'error', title: t('common.error'), message: en ? 'Preview failed' : 'Échec de l\'aperçu' }); }
    setPreviewing(null);
  };

  const handleLaunch = async (id) => {
    if (!await confirm(en ? 'Launch this campaign? Emails will be sent from each rep\'s inbox.' : 'Lancer cette campagne ? Les emails seront envoyés depuis la boîte de chaque commercial.')) return;
    setLaunching(id);
    try {
      await request(`/team-campaigns/${id}/launch`, { method: 'POST' });
      await load();
    } catch { showToast({ type: 'error', title: t('common.error'), message: en ? 'Launch failed' : 'Échec du lancement' }); }
    setLaunching(null);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 30, color: 'var(--text-muted)' }}>{t('common.loading')}</div>;

  const STATUS_COLORS = {
    draft: 'var(--text-muted)', preview: 'var(--blue)', running: 'var(--warning)',
    completed: 'var(--success)', cancelled: 'var(--danger)',
  };
  const STATUS_LABELS = en
    ? { draft: 'Draft', preview: 'Preview', running: 'Running', completed: 'Completed', cancelled: 'Cancelled' }
    : { draft: 'Brouillon', preview: 'Aperçu', running: 'En cours', completed: 'Terminée', cancelled: 'Annulée' };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          {en ? 'Launch email campaigns sent from each sales rep\'s inbox' : 'Lancez des campagnes email envoyées depuis la boîte de chaque commercial'}
        </div>
        <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 14px' }} onClick={() => setShowCreate(true)}>
          {en ? '+ New campaign' : '+ Nouvelle campagne'}
        </button>
      </div>

      {showCreate && (
        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
          padding: 20, marginBottom: 16,
        }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14 }}>
            {en ? 'New team campaign' : 'Nouvelle campagne équipe'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="text" placeholder={en ? 'Campaign name' : 'Nom de la campagne'}
              value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              className="form-input" style={{ fontSize: 13, padding: '8px 12px' }}
            />

            {owners.length > 1 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {en ? 'Sales reps (empty = all)' : 'Commerciaux (vide = tous)'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {owners.map(o => (
                    <button key={o.id} onClick={() => {
                      setForm(p => ({
                        ...p,
                        targetOwners: p.targetOwners.includes(o.id)
                          ? p.targetOwners.filter(id => id !== o.id)
                          : [...p.targetOwners, o.id],
                      }));
                    }} style={{
                      padding: '4px 12px', fontSize: 11, borderRadius: 8,
                      border: `1px solid ${form.targetOwners.includes(o.id) ? 'var(--accent)' : 'var(--border)'}`,
                      background: form.targetOwners.includes(o.id) ? 'rgba(110,87,250,0.1)' : 'transparent',
                      color: form.targetOwners.includes(o.id) ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}>
                      {o.name} ({o.contact_count})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {productLines.length > 0 && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {en ? 'Product lines (empty = all)' : 'Lignes de produits (vide = toutes)'}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {productLines.map(pl => (
                    <button key={pl.id} onClick={() => {
                      setForm(p => ({
                        ...p,
                        targetProductLines: p.targetProductLines.includes(pl.id)
                          ? p.targetProductLines.filter(id => id !== pl.id)
                          : [...p.targetProductLines, pl.id],
                      }));
                    }} style={{
                      padding: '4px 12px', fontSize: 11, borderRadius: 8,
                      border: `1px solid ${form.targetProductLines.includes(pl.id) ? 'var(--accent)' : 'var(--border)'}`,
                      background: form.targetProductLines.includes(pl.id) ? 'rgba(110,87,250,0.1)' : 'transparent',
                      color: form.targetProductLines.includes(pl.id) ? 'var(--accent)' : 'var(--text-muted)',
                      cursor: 'pointer',
                    }}>
                      {pl.icon
                        ? <span style={{ marginRight: 5 }}>{pl.icon}</span>
                        : <Icon name="package" size={13} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 5 }} />}
                      {pl.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <textarea
              placeholder={en ? 'Email instructions for AI (e.g., "Follow up on Q2 proposal, mention the cybersecurity offer")' : 'Instructions pour l\'IA (ex: "Relance sur la proposition Q2, mentionner l\'offre cybersécurité")'}
              value={form.emailPrompt} onChange={e => setForm(p => ({ ...p, emailPrompt: e.target.value }))}
              className="form-input"
              style={{ fontSize: 13, padding: '8px 12px', minHeight: 80, resize: 'vertical' }}
            />

            <div style={{ display: 'flex', gap: 6 }}>
              {['professional', 'casual', 'direct', 'warm'].map(tone => (
                <button key={tone} onClick={() => setForm(p => ({ ...p, emailTone: tone }))} style={{
                  padding: '4px 12px', fontSize: 11, borderRadius: 8,
                  border: `1px solid ${form.emailTone === tone ? 'var(--accent)' : 'var(--border)'}`,
                  background: form.emailTone === tone ? 'rgba(110,87,250,0.1)' : 'transparent',
                  color: form.emailTone === tone ? 'var(--accent)' : 'var(--text-muted)',
                  cursor: 'pointer', textTransform: 'capitalize',
                }}>
                  {tone}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setShowCreate(false)}>
                {t('activation.cancel')}
              </button>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 14px' }}
                onClick={handleCreate} disabled={!form.name.trim()}>
                {en ? 'Create campaign' : 'Créer la campagne'}
              </button>
            </div>
          </div>
        </div>
      )}

      {campaigns.length === 0 && !showCreate && (
        <div style={{
          textAlign: 'center', padding: 40, background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 12,
        }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <Icon name="send" size={28} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
            {en ? 'No team campaigns yet' : 'Aucune campagne équipe'}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {campaigns.map(c => {
          const color = STATUS_COLORS[c.status] || 'var(--text-muted)';
          return (
            <div key={c.id} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
              padding: '14px 18px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {en ? 'by' : 'par'} {c.created_by_name} · {new Date(c.created_at).toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                  </div>
                </div>
                <span style={{
                  fontSize: 11, padding: '3px 10px', borderRadius: 6,
                  background: `${color}15`, color, fontWeight: 600,
                }}>
                  {STATUS_LABELS[c.status] || c.status}
                </span>
              </div>

              {c.total_contacts > 0 && (
                <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 12 }}>
                  <span>{c.total_contacts} contacts</span>
                  {c.sent_count > 0 && <span style={{ color: 'var(--success)' }}>{c.sent_count} {en ? 'sent' : 'envoyés'}</span>}
                  {c.failed_count > 0 && <span style={{ color: 'var(--danger)' }}>{c.failed_count} {en ? 'failed' : 'échec'}</span>}
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                {c.status === 'draft' && (
                  <>
                    <button className="btn btn-ghost" style={{ fontSize: 11, padding: '4px 12px' }}
                      onClick={() => handlePreview(c.id)} disabled={previewing === c.id}>
                      {previewing === c.id ? '...' : (en ? 'Preview' : 'Aperçu')}
                    </button>
                    <button className="btn btn-primary" style={{ fontSize: 11, padding: '4px 12px' }}
                      onClick={() => handleLaunch(c.id)} disabled={launching === c.id}>
                      {launching === c.id ? '...' : (en ? 'Launch' : 'Lancer')}
                    </button>
                  </>
                )}
                {c.status === 'completed' && (
                  <span style={{ fontSize: 11, color: 'var(--success)' }}>
                    <Icon name="checkCircle" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{en ? 'Completed' : 'Terminée'}
                  </span>
                )}
              </div>

              {previewData && previewedId === c.id && previewing === null && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                    {en ? `${previewData.totalContacts} contacts targeted` : `${previewData.totalContacts} contacts ciblés`}
                  </div>
                  {(previewData.previews || []).map((p, i) => (
                    <div key={i} style={{
                      padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)',
                      marginBottom: 6,
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>
                        {p.ownerEmail || (en ? 'Unassigned' : 'Non assigné')} ({p.contactCount} contacts)
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        {p.contacts.map(x => x.name).join(', ')}{p.contactCount > 5 ? '...' : ''}
                      </div>
                      {p.sampleEmail && (
                        <div style={{ marginTop: 8, padding: '8px 10px', background: 'var(--bg-elevated)', borderRadius: 6, fontSize: 12 }}>
                          <div style={{ fontWeight: 600 }}>{p.sampleEmail.subject}</div>
                          <div style={{ color: 'var(--text-secondary)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{p.sampleEmail.body}</div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
