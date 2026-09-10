import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../../services/api-client';
import { useT } from '../../i18n';
import Icon from '../Icon';

/**
 * 3-step prospect generator for a campaign in prep:
 * 1. Search (Lemlist Leads / Apollo / ...) — returns profiles without emails
 * 2. Reveal emails — async enrichment via Lemlist (consumes credits)
 * 3. Add selected prospects to the campaign
 */
export default function ProspectGenerator({ campaign, onProspectsAdded }) {
  const t = useT();
  const [titles, setTitles] = useState(campaign.position || '');
  const [sectors, setSectors] = useState(campaign.sector || '');
  const [locations, setLocations] = useState(campaign.zone || '');
  const [companySizes, setCompanySizes] = useState(
    mapSizeToApollo(campaign.size) || '11-50'
  );
  const [limit, setLimit] = useState(25);

  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]); // contacts with optional email + revealStatus
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [existingCount, setExistingCount] = useState(0);
  const [source, setSource] = useState(null);
  const [searchDiagnostics, setSearchDiagnostics] = useState(null);
  const [searchFallback, setSearchFallback] = useState(null);

  // CSV import state
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvParsed, setCsvParsed] = useState([]);
  const [csvError, setCsvError] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState(0);

  // Reveal state
  const [revealing, setRevealing] = useState(false);
  const [revealJobId, setRevealJobId] = useState(null);
  const [revealProgress, setRevealProgress] = useState({ done: 0, total: 0 });
  const [showRevealConfirm, setShowRevealConfirm] = useState(false);

  // Credits
  const [credits, setCredits] = useState(null); // null = unknown, number = value, 'error' = failed
  const [creditsConfigured, setCreditsConfigured] = useState(true);

  const pollRef = useRef(null);

  // Load existing prospect count + credits on mount
  useEffect(() => {
    const backendId = campaign._backendId || campaign.id;
    api.listCampaignProspects(backendId)
      .then(data => setExistingCount((data.prospects || []).length))
      .catch(() => {});
    api.getLemlistCredits()
      .then(data => {
        if (data.configured === false) setCreditsConfigured(false);
        else if (data.error || data.credits == null) setCredits('error');
        else setCredits(data.credits);
      })
      .catch(() => setCredits('error'));
  }, [campaign._backendId, campaign.id]);

  // Cleanup polling on unmount
  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  /* ── Step 1: Search ── */
  const handleSearch = async () => {
    setSearching(true);
    setError(null);
    setResults([]);
    setSelected(new Set());
    setSearchDiagnostics(null);
    setSearchFallback(null);
    try {
      const criteria = {
        titles: titles.split(',').map(s => s.trim()).filter(Boolean),
        sectors: sectors.split(',').map(s => s.trim()).filter(Boolean),
        locations: locations.split(',').map(s => s.trim()).filter(Boolean),
        companySizes: [companySizes],
        limit: parseInt(limit, 10) || 25,
      };
      const data = await api.searchProspects(criteria);
      const contacts = (data.contacts || []).map(c => ({
        ...c,
        revealStatus: c.email ? 'verified' : 'pending',
      }));
      setResults(contacts);
      setSource(data.source || 'lemlist');
      setSelected(new Set(contacts.map(c => c.id)));
      if (data.diagnostics) setSearchDiagnostics(data.diagnostics);
      if (data.fallback) setSearchFallback(data.fallback);
    } catch (err) {
      setError(err.message || t('prospectGen.searchFailed'));
    }
    setSearching(false);
  };

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /* ── Step 2: Reveal emails ── */
  const selectedNeedingReveal = results.filter(
    c => selected.has(c.id) && !c.email && c.revealStatus !== 'not_found' && c.revealStatus !== 'error'
  );

  const startReveal = async () => {
    setShowRevealConfirm(false);
    setRevealing(true);
    setError(null);
    try {
      const leadsToReveal = selectedNeedingReveal;
      const data = await api.revealEmails(source || 'lemlist', leadsToReveal);
      setRevealJobId(data.jobId);
      setRevealProgress({ done: 0, total: leadsToReveal.length });

      // If no enrichment was dispatched (all failed pre-validation), show error
      if (data.dispatched === 0) {
        setError(t('prospectGen.revealCannotValidate', { errors: data.errors || leadsToReveal.length }));
      }

      // Mark them as pending in UI
      setResults(prev => prev.map(c =>
        leadsToReveal.find(l => l.id === c.id) ? { ...c, revealStatus: 'revealing' } : c
      ));

      // Start polling
      pollRef.current = setInterval(async () => {
        try {
          const status = await api.pollRevealEmails(data.jobId);
          setRevealProgress({ done: status.done, total: status.total });

          // Update results with any resolved entries
          setResults(prev => prev.map(c => {
            const r = status.results.find(r => r.id === c.id);
            if (!r || r.status === 'pending') return c;
            return {
              ...c,
              email: r.email || c.email,
              revealStatus: r.status,
              revealError: r.error || null,
            };
          }));

          if (status.status === 'done') {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setRevealing(false);
            setRevealJobId(null);
            // Refresh credits
            api.getLemlistCredits()
              .then(data => {
                if (data.credits != null) setCredits(data.credits);
              })
              .catch(() => {});
          }
        } catch (err) {
          console.warn('Poll error:', err.message);
        }
      }, 3000);
    } catch (err) {
      setError(err.message || t('campaigns.revealFailed'));
      setRevealing(false);
    }
  };

  const cancelReveal = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setRevealing(false);
    setRevealJobId(null);
    setError(t('prospectGen.revealCancelled'));
  };

  /* ── Step 3: Save to campaign ── */
  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      // Only save contacts with a verified email
      const contacts = results.filter(c => selected.has(c.id) && c.email);
      if (contacts.length === 0) {
        setError(t('prospectGen.noVerifiedEmail'));
        setSaving(false);
        return;
      }
      const backendId = campaign._backendId || campaign.id;
      const data = await api.addProspectsToCampaign(backendId, contacts);
      setExistingCount(prev => prev + (data.created || 0));
      setResults([]);
      setSelected(new Set());
      if (onProspectsAdded) onProspectsAdded(data.created);
    } catch (err) {
      setError(err.message || t('prospectGen.saveFailed'));
    }
    setSaving(false);
  };

  /* ── CSV import ── */

  // Map common column header aliases (FR + EN) to our internal field names.
  const COLUMN_ALIASES = {
    email: ['email', 'e-mail', 'mail', 'courriel'],
    firstName: ['firstname', 'first_name', 'first name', 'prenom', 'prénom', 'first'],
    lastName: ['lastname', 'last_name', 'last name', 'nom', 'last'],
    name: ['name', 'fullname', 'full_name', 'full name', 'nom complet'],
    company: ['company', 'entreprise', 'societe', 'société', 'company_name', 'organisation', 'org'],
    title: ['title', 'job', 'job_title', 'position', 'poste', 'fonction', 'role'],
    linkedinUrl: ['linkedin', 'linkedin_url', 'linkedinurl', 'profile', 'linkedin profile'],
  };

  // Split a CSV line respecting quoted fields ("foo, bar"). Handles "" escapes.
  function splitCsvLine(line, delimiter) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { cur += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === delimiter) { out.push(cur); cur = ''; }
        else { cur += ch; }
      }
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  // Auto-detect delimiter: prefer the one with the most columns on the header line.
  function detectDelimiter(firstLine) {
    const candidates = [',', ';', '\t', '|'];
    let best = ',';
    let bestCount = 0;
    for (const d of candidates) {
      const n = splitCsvLine(firstLine, d).length;
      if (n > bestCount) { best = d; bestCount = n; }
    }
    return best;
  }

  // Match a header cell to one of our known fields. Returns the field name or null.
  function matchField(header) {
    const h = header.toLowerCase().trim();
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (aliases.includes(h)) return field;
    }
    return null;
  }

  function parseCsv(text) {
    const raw = (text || '').trim();
    if (!raw) return { contacts: [], error: null };

    const lines = raw.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      return { contacts: [], error: t('prospectGen.csvMinLines') };
    }

    const delimiter = detectDelimiter(lines[0]);
    const headers = splitCsvLine(lines[0], delimiter);
    const fieldMap = headers.map(matchField);

    // Require at least an email column
    if (!fieldMap.includes('email')) {
      return {
        contacts: [],
        error: t('prospectGen.csvEmailNotFound', { headers: headers.join(', ') }),
      };
    }

    const contacts = [];
    const seen = new Set();
    for (let i = 1; i < lines.length; i++) {
      const cells = splitCsvLine(lines[i], delimiter);
      const record = {};
      for (let j = 0; j < fieldMap.length; j++) {
        if (fieldMap[j] && cells[j]) record[fieldMap[j]] = cells[j];
      }
      if (!record.email) continue;
      // Skip duplicates on email (case-insensitive)
      const key = record.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Derive full name if missing
      if (!record.name && (record.firstName || record.lastName)) {
        record.name = [record.firstName, record.lastName].filter(Boolean).join(' ').trim();
      }
      contacts.push({
        id: `csv_${i}_${key}`,
        ...record,
      });
    }

    return { contacts, error: null };
  }

  const handleCsvChange = (text) => {
    setCsvText(text);
    setCsvError(null);
    if (!text.trim()) {
      setCsvParsed([]);
      return;
    }
    const { contacts, error } = parseCsv(text);
    if (error) {
      setCsvError(error);
      setCsvParsed([]);
    } else {
      setCsvParsed(contacts);
    }
  };

  const handleCsvFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => handleCsvChange(String(e.target?.result || ''));
    reader.onerror = () => setCsvError(t('prospectGen.csvReadError'));
    reader.readAsText(file);
    // Reset input so the same file can be re-selected later
    event.target.value = '';
  };

  const handleCsvImport = async () => {
    if (csvParsed.length === 0) return;
    setImporting(true);
    setCsvError(null);
    try {
      const backendId = campaign._backendId || campaign.id;
      const data = await api.addProspectsToCampaign(backendId, csvParsed);
      setImportedCount(data.created || 0);
      setExistingCount(prev => prev + (data.created || 0));
      setCsvText('');
      setCsvParsed([]);
      if (onProspectsAdded) onProspectsAdded(data.created);
    } catch (err) {
      setCsvError(err.message || t('prospectGen.csvImportFailed'));
    }
    setImporting(false);
  };

  /* ── Derived state ── */
  const currentStep = results.length === 0 ? 1 : selectedNeedingReveal.length > 0 || revealing ? 2 : 3;
  const selectedWithEmail = results.filter(c => selected.has(c.id) && c.email).length;
  const creditCost = selectedNeedingReveal.length;

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '24px',
        marginBottom: '24px',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="target" size={15} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{t('prospectGen.title')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {existingCount > 0
              ? t('prospectGen.existingCount', { count: existingCount, plural: existingCount > 1 ? 's' : '' })
              : t('campaigns.noProspects')}
          </div>
        </div>
        {credits !== null && credits !== 'error' && creditsConfigured && (
          <div
            style={{
              fontSize: 12,
              background: 'var(--bg-elevated)',
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
            }}
            title={t('prospectGen.creditsTitle')}
          >
            <Icon name="creditCard" size={13} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{t('prospectGen.creditsLabel', { count: credits })}
          </div>
        )}
      </div>

      {/* Stepper */}
      <Stepper step={currentStep} t={t} />

      {/* Step 1: Search form (always visible) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '12px',
          marginBottom: '12px',
        }}
      >
        <Field label={t('prospectGen.fieldTitles')} value={titles} onChange={setTitles} placeholder="CEO, COO, Head of Lab" />
        <Field label={t('prospectGen.fieldSectors')} value={sectors} onChange={setSectors} placeholder="Biotech, Diagnostics" />
        <Field label={t('prospectGen.fieldLocations')} value={locations} onChange={setLocations} placeholder="France, Germany" />
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>{t('prospectGen.fieldCompanySize')}</label>
          <select
            className="form-input"
            value={companySizes}
            onChange={e => setCompanySizes(e.target.value)}
            style={{ marginTop: '4px' }}
          >
            <option value="1-10">1-10</option>
            <option value="11-50">11-50</option>
            <option value="51-200">51-200</option>
            <option value="201-500">201-500</option>
            <option value="501-1000">501-1000</option>
            <option value="1001+">1001+</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>{t('prospectGen.fieldMaxResults')}</label>
          <input
            className="form-input"
            type="number"
            min="1"
            max="100"
            value={limit}
            onChange={e => setLimit(e.target.value)}
            style={{ marginTop: '4px' }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={handleSearch}
          disabled={searching}
          style={{ fontSize: '12px', padding: '8px 14px' }}
        >
          {searching ? t('prospectGen.searching') : (
            <>
              <Icon name="search" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
              {t('prospectGen.searchBtn')}
            </>
          )}
        </button>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{t('prospectGen.or')}</span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setCsvOpen(v => !v)}
          style={{ fontSize: '12px', padding: '8px 14px' }}
        >
          <Icon name="clipboard" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
          {csvOpen ? t('prospectGen.hideCsvImport') : t('prospectGen.importCsv')}
        </button>
      </div>

      {/* CSV import section */}
      {csvOpen && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            background: 'var(--bg-elevated, rgba(255,255,255,0.03))',
            border: '1px dashed var(--border)',
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            {t('prospectGen.csvTitle')}
          </div>
          <div
            style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.5 }}
            dangerouslySetInnerHTML={{ __html: t('prospectGen.csvHelp') }}
          />

          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <label
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: '6px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <Icon name="folder" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{t('prospectGen.csvChooseFile')}
              <input
                type="file"
                accept=".csv,text/csv,.txt,text/plain"
                onChange={handleCsvFile}
                style={{ display: 'none' }}
              />
            </label>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>{t('prospectGen.csvPasteLabel')}</span>
          </div>

          <textarea
            value={csvText}
            onChange={(e) => handleCsvChange(e.target.value)}
            placeholder={'email,firstName,lastName,company,title\njean.dupont@hopital-xyz.fr,Jean,Dupont,CHU Lyon,Directeur R&D\n...'}
            rows={6}
            style={{
              width: '100%',
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
              fontSize: 11,
              padding: 10,
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              resize: 'vertical',
              boxSizing: 'border-box',
            }}
          />

          {csvError && (
            <div style={{
              marginTop: 8,
              padding: '8px 10px',
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 6,
              fontSize: 11,
              color: 'var(--danger, #dc2626)',
            }}>
              <Icon name="alert" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{csvError}
            </div>
          )}

          {csvParsed.length > 0 && !csvError && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                {'\u2713'} <strong>{csvParsed.length}</strong> {t('prospectGen.csvReadyCount', { count: csvParsed.length, plural: csvParsed.length > 1 ? 's' : '', pluralReady: csvParsed.length > 1 ? 's' : '' })}
              </div>
              <div style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                maxHeight: 180,
                overflow: 'auto',
              }}>
                {csvParsed.slice(0, 5).map((c, i) => (
                  <div key={c.id || i} style={{
                    padding: '6px 10px',
                    borderBottom: i < Math.min(4, csvParsed.length - 1) ? '1px solid var(--border)' : 'none',
                    fontSize: 11,
                    display: 'grid',
                    gridTemplateColumns: '1.5fr 1fr 1.5fr',
                    gap: 8,
                  }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || '\u2014'}
                    </div>
                    <div style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.title || '\u2014'}
                    </div>
                    <div style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.company || '\u2014'} {'\u00B7'} {c.email}
                    </div>
                  </div>
                ))}
                {csvParsed.length > 5 && (
                  <div style={{ padding: '6px 10px', fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>
                    {t('prospectGen.csvMoreItems', { count: csvParsed.length - 5 })}
                  </div>
                )}
              </div>

              <button
                className="btn btn-primary"
                onClick={handleCsvImport}
                disabled={importing}
                style={{ marginTop: 10, fontSize: 12, padding: '8px 14px' }}
              >
                {importing
                  ? t('prospectGen.csvImporting')
                  : (
                    <>
                      <Icon name="plus" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                      {t('prospectGen.csvImportBtn', { count: csvParsed.length, plural: csvParsed.length > 1 ? 's' : '' })}
                    </>
                  )}
              </button>
            </div>
          )}

          {importedCount > 0 && !importing && (
            <div style={{
              marginTop: 10,
              padding: '8px 10px',
              background: 'rgba(34,197,94,0.1)',
              border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: 6,
              fontSize: 11,
              color: 'var(--success, #16a34a)',
            }}>
              <Icon name="checkCircle" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{t('prospectGen.csvImported', { count: importedCount, plural: importedCount > 1 ? 's' : '', pluralAdded: importedCount > 1 ? 's' : '' })}
            </div>
          )}
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: '12px',
            padding: '10px 12px',
            background: 'var(--danger-bg)',
            border: '1px solid rgba(255,107,107,0.3)',
            borderRadius: 8,
            color: 'var(--danger)',
            fontSize: '12px',
          }}
        >
          <Icon name="alert" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{error}
        </div>
      )}

      {/* Fallback banner (Lemlist unavailable → Apollo) */}
      {searchFallback && (
        <div style={{
          marginTop: 16,
          padding: '10px 14px',
          background: 'rgba(251, 191, 36, 0.08)',
          border: '1px solid rgba(251, 191, 36, 0.3)',
          borderRadius: 8,
          fontSize: 12,
          color: 'var(--warning, #d97706)',
        }}
          dangerouslySetInnerHTML={{ __html: t('prospectGen.fallbackBanner') }}
        />
      )}

      {/* Filter diagnostics banner (dropped criteria) */}
      {searchDiagnostics && (searchDiagnostics.dropped?.length > 0) && (
        <div style={{
          marginTop: 16,
          padding: '12px 14px',
          background: 'rgba(239, 68, 68, 0.08)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 8,
          fontSize: 12,
          color: 'var(--danger, #dc2626)',
          lineHeight: 1.6,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            <Icon name="alert" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{t('prospectGen.diagnosticsTitle')}
          </div>
          <div>
            {t('prospectGen.diagnosticsDropped')}&nbsp;
            <strong>{searchDiagnostics.dropped.map(d => d.criterion).join(', ')}</strong>.
            <br />
            {t('prospectGen.diagnosticsApplied')}&nbsp;
            {(searchDiagnostics.applied?.length ?? 0) > 0
              ? <strong>{searchDiagnostics.applied.map(a => a.criterion).join(', ')}</strong>
              : <strong>{t('prospectGen.diagnosticsNone')}</strong>}.
          </div>
        </div>
      )}

      {/* Step 2+3: Results */}
      {results.length > 0 && (
        <div style={{ marginTop: '20px' }}>
          <div
            style={{
              fontSize: '13px',
              fontWeight: 600,
              marginBottom: '8px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>
              {t('prospectGen.resultsCount', {
                results: results.length,
                pluralResults: results.length > 1 ? 's' : '',
                selected: selected.size,
                pluralSelected: selected.size > 1 ? 's' : '',
              })}
              {selectedWithEmail > 0 && (
                <span style={{ color: 'var(--success)', marginLeft: 8 }}>
                  {t('prospectGen.withEmailCount', { count: selectedWithEmail })}
                </span>
              )}
            </span>
            {revealing && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                <Icon name="clock" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{t('prospectGen.revealProgress', { done: revealProgress.done, total: revealProgress.total })}
              </span>
            )}
          </div>

          {/* Helper text */}
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-muted)',
              marginBottom: 8,
              fontStyle: 'italic',
            }}
          >
            {currentStep === 2 && !revealing && t('prospectGen.stepHelper2')}
            {revealing && t('prospectGen.stepHelperRevealing')}
            {currentStep === 3 && t('prospectGen.stepHelper3')}
          </div>

          <div style={{ maxHeight: 320, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            {results.map(c => (
              <div
                key={c.id}
                onClick={() => !revealing && toggleSelect(c.id)}
                style={{
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--border)',
                  cursor: revealing ? 'default' : 'pointer',
                  display: 'flex',
                  gap: '10px',
                  alignItems: 'center',
                  background: selected.has(c.id) ? 'var(--bg-elevated)' : 'transparent',
                  opacity: revealing && !selected.has(c.id) ? 0.5 : 1,
                }}
              >
                <input type="checkbox" checked={selected.has(c.id)} readOnly disabled={revealing} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                    {c.name}
                    <RevealBadge status={c.revealStatus} email={c.email} error={c.revealError} t={t} />
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {c.title} {'\u00B7'} {c.company} {'\u00B7'} {c.location}
                    {c.email && <span style={{ color: 'var(--success)', marginLeft: 6 }}>{'\u00B7'} {c.email}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 8, marginTop: 12, alignItems: 'center' }}>
            {selectedNeedingReveal.length > 0 && !revealing && (
              <button
                className="btn btn-primary"
                onClick={() => setShowRevealConfirm(true)}
                disabled={credits !== null && credits !== 'error' && credits < selectedNeedingReveal.length}
                style={{ fontSize: '12px', padding: '8px 14px' }}
              >
                <Icon name="revenue" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                {t('prospectGen.revealBtn', {
                  count: selectedNeedingReveal.length,
                  plural: selectedNeedingReveal.length > 1 ? 's' : '',
                  pluralCredits: selectedNeedingReveal.length > 1 ? 's' : '',
                })}
              </button>
            )}

            {revealing && (
              <button
                className="btn btn-ghost"
                onClick={cancelReveal}
                style={{ fontSize: '12px', padding: '8px 14px' }}
              >
                {'\u2715'} {t('prospectGen.cancelReveal')}
              </button>
            )}

            {!revealing && selectedWithEmail > 0 && (
              <button
                className="btn btn-success"
                onClick={handleSave}
                disabled={saving}
                style={{ fontSize: '12px', padding: '8px 14px' }}
              >
                {saving ? t('prospectGen.adding') : (
                  <>
                    <Icon name="plus" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
                    {t('prospectGen.addToCampaign', { count: selectedWithEmail })}
                  </>
                )}
              </button>
            )}
          </div>

          {credits !== null && credits !== 'error' && credits < selectedNeedingReveal.length && selectedNeedingReveal.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 6 }}>
              <Icon name="alert" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{t('prospectGen.insufficientCredits', { available: credits, required: selectedNeedingReveal.length })}
            </div>
          )}
        </div>
      )}

      {/* Confirmation modal for reveal */}
      {showRevealConfirm && (
        <ConfirmRevealModal
          count={selectedNeedingReveal.length}
          credits={credits}
          onConfirm={startReveal}
          onCancel={() => setShowRevealConfirm(false)}
          t={t}
        />
      )}
    </div>
  );
}

function Stepper({ step, t }) {
  const steps = [
    { n: 1, label: t('prospectGen.stepSearch'), icon: 'search' },
    { n: 2, label: t('prospectGen.stepReveal'), icon: 'revenue' },
    { n: 3, label: t('prospectGen.stepAdd'), icon: 'plus' },
  ];
  return (
    <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
      {steps.map((s, i) => (
        <div key={s.n} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i < steps.length - 1 ? 1 : 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 600,
              background: step === s.n ? 'var(--accent)' : step > s.n ? 'rgba(0, 214, 143, 0.15)' : 'var(--bg-elevated)',
              color: step === s.n ? 'white' : step > s.n ? 'var(--success)' : 'var(--text-muted)',
              border: `1px solid ${step === s.n ? 'var(--accent)' : step > s.n ? 'rgba(0, 214, 143, 0.3)' : 'var(--border)'}`,
              whiteSpace: 'nowrap',
            }}
          >
            <Icon name={step > s.n ? 'checkCircle' : s.icon} size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
            {s.label}
          </div>
          {i < steps.length - 1 && (
            <div
              style={{
                flex: 1,
                height: 2,
                background: step > s.n ? 'var(--success)' : 'var(--border)',
                borderRadius: 1,
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function RevealBadge({ status, email, error, t }) {
  if (status === 'verified' && email) {
    return <span style={{ fontSize: 10, color: 'var(--success)', fontWeight: 600 }}><Icon name="checkCircle" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{t('prospectGen.revealVerified')}</span>;
  }
  if (status === 'not_found') {
    return <span style={{ fontSize: 10, color: 'var(--danger)', fontWeight: 600 }}><Icon name="close" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{t('prospectGen.revealNotFound')}</span>;
  }
  if (status === 'error') {
    return (
      <span
        style={{ fontSize: 10, color: 'var(--warning)', fontWeight: 600, cursor: 'help' }}
        title={error || t('common.error')}
      >
        <Icon name="alert" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{t('prospectGen.revealError')}
      </span>
    );
  }
  if (status === 'revealing') {
    return <span style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 600 }}><Icon name="clock" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />{t('prospectGen.revealRevealing')}</span>;
  }
  return <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{t('prospectGen.revealPending')}</span>;
}

function ConfirmRevealModal({ count, credits, onConfirm, onCancel, t }) {
  const creditDisplay = credits === null || credits === 'error' ? t('prospectGen.balanceUnknown') : credits;
  const afterReveal = typeof credits === 'number' ? credits - count : null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10000,
      }}
      onClick={onCancel}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 24,
          maxWidth: 440,
          width: '90%',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
          <Icon name="revenue" size={14} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 6 }} />
          {t('prospectGen.revealConfirmTitle', { count, plural: count > 1 ? 's' : '' })}
        </div>
        <div
          style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}
          dangerouslySetInnerHTML={{
            __html: t('prospectGen.revealConfirmBody', { count, plural: count > 1 ? 's' : '' }) +
              `<br />${t('prospectGen.revealConfirmBalance')} <strong>${creditDisplay}</strong>` +
              (afterReveal !== null
                ? ` → <strong style="color: ${afterReveal < 10 ? 'var(--warning)' : 'var(--text-primary)'}">${t('prospectGen.revealConfirmAfter', { count: afterReveal })}</strong>`
                : '')
          }}
        />
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>
          {t('prospectGen.revealConfirmAsync')}
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onCancel} style={{ fontSize: 12 }}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={onConfirm} style={{ fontSize: 12 }}>
            {t('prospectGen.revealConfirmBtn')}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 600 }}>{label}</label>
      <input
        className="form-input"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ marginTop: '4px' }}
      />
    </div>
  );
}

function mapSizeToApollo(size) {
  if (!size) return null;
  const s = String(size).toLowerCase();
  if (s.includes('1-10')) return '1-10';
  if (s.includes('11-50') || s.includes('10-50')) return '11-50';
  if (s.includes('50-200') || s.includes('51-200')) return '51-200';
  if (s.includes('200') || s.includes('500')) return '201-500';
  if (s.includes('500') || s.includes('1000')) return '501-1000';
  if (s.includes('1000+') || s.includes('1001')) return '1001+';
  return null;
}
