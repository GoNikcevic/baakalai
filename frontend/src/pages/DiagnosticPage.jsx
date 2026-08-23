/* ===============================================================================
   BAKAL — Diagnostic CRM public (lead magnet, sans compte)
   /diagnostic       : formulaire (clé API Pipedrive) → rapport complet
   /diagnostic/r/:id : vue partagée (deals anonymisés côté backend)
   La clé API n'est jamais stockée ; le rapport expire après 30 jours.
   =============================================================================== */

import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useT, useI18n } from '../i18n';

function money(n) {
  if (!n) return '0\u00A0€';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M\u00A0€`;
  if (n >= 1000) return `${Math.round(n / 1000)}k\u00A0€`;
  return `${Math.round(n)}\u00A0€`;
}

const card = {
  background: 'var(--paper, #fff)', border: '1px solid var(--border, #e5e5e5)',
  borderRadius: 14, padding: '22px 24px', marginBottom: 16,
};

/* Jauge benchmark : bande marché 20-40 % + curseur « vous » */
function BenchmarkGauge({ report, t }) {
  const pct = report.dormant.sharePct;
  if (pct == null) return null;
  const { low, high } = report.benchmark;
  return (
    <div style={card}>
      <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('diag.benchTitle')}</div>
      <div style={{ position: 'relative', height: 14, background: 'var(--paper-2, #f4f4f2)', borderRadius: 7 }}>
        <div style={{
          position: 'absolute', left: `${low}%`, width: `${high - low}%`, top: 0, bottom: 0,
          background: 'rgba(34,197,94,0.25)', borderRadius: 7,
        }} />
        <div style={{
          position: 'absolute', left: `calc(${Math.min(pct, 100)}% - 7px)`, top: -3,
          width: 14, height: 20, borderRadius: 4,
          background: pct > high ? '#ef4444' : '#22c55e', border: '2px solid #fff',
          boxShadow: '0 1px 4px rgba(0,0,0,0.25)',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 12, color: 'var(--text-muted, #888)' }}>
        <span>{t('diag.benchMarket').replace('{low}', low).replace('{high}', high)}</span>
        <span style={{ fontWeight: 700, color: pct > high ? '#ef4444' : '#22c55e' }}>
          {t('diag.benchYou').replace('{pct}', pct)}
        </span>
      </div>
    </div>
  );
}

/* Carte image 1200×630 générée en SVG → PNG côté client (partage LinkedIn) */
function downloadShareImage(report, t) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const pct = report.dormant.sharePct;
  const headline = pct != null
    ? t('diag.imgHeadlinePct').replace('{pct}', pct)
    : t('diag.imgHeadlineCount').replace('{count}', report.dormant.count + report.dormant.noValueCount);
  const sub = t('diag.imgSub')
    .replace('{value}', money(report.dormant.value))
    .replace('{days}', report.dormantDays);
  const noValue = report.dormant.noValueCount > 0
    ? t('diag.imgNoValue').replace('{count}', report.dormant.noValueCount) : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
    <rect width="1200" height="630" fill="#FAFAF9"/>
    <rect x="0" y="0" width="1200" height="8" fill="#6E57FA"/>
    <text x="80" y="120" font-family="Arial, sans-serif" font-size="34" fill="#666">${esc(t('diag.imgTagline'))}</text>
    <text x="80" y="260" font-family="Arial, sans-serif" font-size="88" font-weight="bold" fill="#1a1a1a">${esc(headline)}</text>
    <text x="80" y="340" font-family="Arial, sans-serif" font-size="40" fill="#444">${esc(sub)}</text>
    ${noValue ? `<text x="80" y="410" font-family="Arial, sans-serif" font-size="32" fill="#ef4444">${esc(noValue)}</text>` : ''}
    <text x="80" y="540" font-family="Arial, sans-serif" font-size="30" fill="#6E57FA" font-weight="bold">baakal.ai/diagnostic</text>
  </svg>`;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200; canvas.height = 630;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = 'diagnostic-crm-baakal.png';
    a.click();
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export default function DiagnosticPage() {
  const t = useT();
  const { lang } = useI18n();
  const { id: sharedId } = useParams();

  const [mode, setMode] = useState(sharedId ? 'loading' : 'form');
  const [apiToken, setApiToken] = useState('');
  const [report, setReport] = useState(null);
  const [reportId, setReportId] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!sharedId) return;
    (async () => {
      try {
        const res = await fetch(`/api/public/diagnostic/${sharedId}`);
        if (!res.ok) { setMode('notfound'); return; }
        const data = await res.json();
        setReport(data.report);
        setMode('shared');
      } catch { setMode('notfound'); }
    })();
  }, [sharedId]);

  async function handleScan(e) {
    e.preventDefault();
    setError(null);
    setMode('loading');
    try {
      const res = await fetch('/api/public/diagnostic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'pipedrive', apiToken: apiToken.trim(), lang }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error === 'rate_limited' ? t('diag.errRateLimited')
          : body.error === 'invalid_token' ? t('diag.errInvalidToken')
          : t('diag.errGeneric'));
        setMode('form');
        return;
      }
      const data = await res.json();
      setReport(data.report);
      setReportId(data.id);
      setMode('report');
    } catch {
      setError(t('diag.errGeneric'));
      setMode('form');
    }
  }

  const shareUrl = reportId ? `${window.location.origin}/diagnostic/r/${reportId}` : null;

  function copyShareLink() {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  const wrap = {
    minHeight: '100vh', background: 'var(--bg-primary, #FAFAF9)',
    fontFamily: 'var(--font, Geist, sans-serif)', color: 'var(--ink, #1a1a1a)',
    display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px',
  };
  const inner = { width: '100%', maxWidth: 640 };

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <a href="https://baakal.ai" style={{ fontWeight: 800, fontSize: 20, color: 'var(--primary, #6E57FA)', textDecoration: 'none' }}>baakal.ai</a>
          <h1 style={{ fontSize: 28, margin: '14px 0 8px' }}>{t('diag.title')}</h1>
          <p style={{ color: 'var(--text-muted, #777)', fontSize: 14, margin: 0 }}>{t('diag.subtitle')}</p>
        </div>

        {mode === 'form' && (
          <form onSubmit={handleScan} style={card}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <span style={{ padding: '6px 14px', borderRadius: 8, background: 'var(--primary, #6E57FA)', color: '#fff', fontSize: 13, fontWeight: 600 }}>
                {t('diag.pipedriveLabel')}
              </span>
              <span style={{ padding: '6px 14px', borderRadius: 8, background: 'var(--paper-2, #f4f4f2)', color: 'var(--text-muted, #999)', fontSize: 13 }}>
                {t('diag.hubspotSoon')}
              </span>
            </div>
            <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>{t('diag.tokenLabel')}</label>
            <input
              type="password"
              value={apiToken}
              onChange={e => setApiToken(e.target.value)}
              placeholder={t('diag.tokenPlaceholder')}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 14,
                border: '1px solid var(--border, #ddd)', boxSizing: 'border-box',
              }}
            />
            <details style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted, #777)' }}>
              <summary style={{ cursor: 'pointer' }}>{t('diag.guideTitle')}</summary>
              <ol style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                <li>{t('diag.guide1')}</li>
                <li>{t('diag.guide2')}</li>
                <li>{t('diag.guide3')}</li>
              </ol>
            </details>
            {error && <div style={{ marginTop: 10, color: '#ef4444', fontSize: 13 }}>{error}</div>}
            <button
              type="submit"
              disabled={apiToken.trim().length < 8}
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 14, padding: '12px', fontSize: 15, justifyContent: 'center' }}
            >
              {t('diag.scanBtn')}
            </button>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--text-muted, #999)', lineHeight: 1.5 }}>
              {t('diag.gdprNote')}
            </div>
          </form>
        )}

        {mode === 'loading' && (
          <div style={{ ...card, textAlign: 'center', padding: '48px 24px', color: 'var(--text-muted, #777)' }}>
            {t('diag.scanning')}
          </div>
        )}

        {mode === 'notfound' && (
          <div style={{ ...card, textAlign: 'center' }}>
            <p>{t('diag.notFound')}</p>
            <a href="/diagnostic" className="btn btn-primary" style={{ textDecoration: 'none' }}>{t('diag.runYours')}</a>
          </div>
        )}

        {(mode === 'report' || mode === 'shared') && report && (
          <>
            {mode === 'shared' && (
              <div style={{ fontSize: 12, color: 'var(--text-muted, #999)', textAlign: 'center', marginBottom: 12 }}>
                {t('diag.sharedBadge')}
              </div>
            )}

            {report.totalDeals === 0 ? (
              <div style={{ ...card, textAlign: 'center' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{t('diag.emptyTitle')}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted, #777)' }}>{t('diag.emptyBody')}</div>
              </div>
            ) : (
              <>
                <div style={{ ...card, textAlign: 'center' }}>
                  <div style={{ fontSize: 13, color: 'var(--text-muted, #777)' }}>
                    {t('diag.openLine').replace('{deals}', report.openDeals).replace('{value}', money(report.openValue))}
                  </div>
                  <div style={{ fontSize: 42, fontWeight: 800, margin: '10px 0 2px', color: '#ef4444' }}>
                    {money(report.dormant.value)}
                  </div>
                  <div style={{ fontSize: 15 }}>
                    {t('diag.dormantHeadline').replace('{days}', report.dormantDays)}
                    {report.dormant.sharePct != null && report.dormant.sharePct > 0 && (
                      <> {t('diag.dormantShare').replace('{pct}', report.dormant.sharePct)}</>
                    )}
                  </div>
                  {report.dormant.noValueCount > 0 && (
                    <div style={{ marginTop: 10, fontSize: 13, color: '#ef4444' }}>
                      {t('diag.noValueHook').replace('{count}', report.dormant.noValueCount)}
                    </div>
                  )}
                </div>

                <BenchmarkGauge report={report} t={t} />

                {report.dormant.top.length > 0 && (
                  <div style={card}>
                    <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('diag.topTitle')}</div>
                    {report.dormant.top.map((d, i) => (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 0',
                        borderTop: i > 0 ? '1px solid var(--border, #eee)' : 'none', fontSize: 14,
                      }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <strong>{d.name || t('diag.topAnonymous')}</strong>{d.company ? ` · ${d.company}` : ''}
                        </span>
                        <span style={{ whiteSpace: 'nowrap', color: 'var(--text-muted, #777)' }}>
                          {money(d.dealValue)} · {t('diag.daysInactive').replace('{days}', d.daysInactive)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ ...card, textAlign: 'center', border: '1px solid var(--primary, #6E57FA)' }}>
                  <div style={{ fontWeight: 600 }}>{t('diag.projTitle')}</div>
                  <div style={{ fontSize: 30, fontWeight: 800, color: 'var(--primary, #6E57FA)', margin: '8px 0' }}>
                    {t('diag.projValue').replace('{value}', money(report.projection.value))}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted, #999)', marginBottom: 14 }}>{t('diag.projNote')}</div>
                  <a href="/?ref=diagnostic" className="btn btn-primary" style={{ textDecoration: 'none', padding: '12px 22px', fontSize: 15 }}>
                    {t('diag.cta')}
                  </a>
                </div>

                {mode === 'report' && shareUrl && (
                  <div style={card}>
                    <div style={{ fontWeight: 600, marginBottom: 10 }}>{t('diag.shareTitle')}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button className="btn btn-ghost" onClick={copyShareLink} style={{ fontSize: 13 }}>
                        {copied ? t('diag.copied') : t('diag.copyLink')}
                      </button>
                      <a
                        className="btn btn-ghost"
                        style={{ fontSize: 13, textDecoration: 'none' }}
                        href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
                        target="_blank" rel="noreferrer"
                      >
                        {t('diag.shareLinkedin')}
                      </a>
                      <button className="btn btn-ghost" onClick={() => downloadShareImage(report, t)} style={{ fontSize: 13 }}>
                        {t('diag.downloadImg')}
                      </button>
                    </div>
                  </div>
                )}

                {mode === 'shared' && (
                  <div style={{ textAlign: 'center', marginTop: 4 }}>
                    <a href="/diagnostic" className="btn btn-primary" style={{ textDecoration: 'none' }}>{t('diag.runYours')}</a>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
