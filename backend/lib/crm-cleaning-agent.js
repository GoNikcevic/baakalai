/**
 * CRM Data Cleaning Agent
 *
 * Scans a connected CRM (Pipedrive, HubSpot, Salesforce) and detects:
 * - Duplicate contacts (by email, by name+company)
 * - Missing critical fields (email, name, company)
 * - Invalid email formats
 * - Inactive contacts (no update in 6+ months)
 * - Format inconsistencies (phone, name casing)
 *
 * Returns a health score /100 and structured issues with suggested actions.
 * Can apply fixes (merge, update, delete) individually or in bulk.
 *
 * Architecture: provider adapters so the same scan logic works for any CRM.
 */

const pipedrive = require('../api/pipedrive');
const { getUserKey } = require('../config');
const db = require('../db');
const { getMxHost, smtpVerify } = require('./enrich-agent');
const hunter = require('../api/hunter');
const dropcontact = require('../api/dropcontact');

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;

// ── Credentials resolution ──

/**
 * Resolve credentials for a specific provider. Every provider except Salesforce returns the
 * same bare decrypted string getUserKey() already returns. Salesforce's real API calls need
 * { instanceUrl, accessToken } — getUserKey only returns the decrypted access token, so
 * instance_url is read separately (same query pattern used elsewhere, e.g. routes/crm.js's
 * /fields/:provider and lib/crm-token.js's resolveCrmForUser).
 */
async function getProviderCredentials(userId, provider) {
  const token = await getUserKey(userId, provider);
  if (provider !== 'salesforce' || !token) return token;

  const integration = await db.query(
    `SELECT instance_url FROM user_integrations WHERE user_id = $1 AND provider = 'salesforce'`,
    [userId]
  );
  const instanceUrl = integration.rows[0]?.instance_url;
  if (!instanceUrl) return null;
  return { accessToken: token, instanceUrl };
}

// ── Provider Adapters ──

function getAdapter(provider) {
  switch (provider) {
    case 'pipedrive':
      return {
        async listPersons(token) {
          return pipedrive.listAllPersons(token);
        },
        normalizePerson(raw) {
          const email = Array.isArray(raw.email)
            ? (raw.email.find(e => e.primary)?.value || raw.email[0]?.value || null)
            : (raw.email || null);
          const phone = Array.isArray(raw.phone)
            ? (raw.phone.find(p => p.primary)?.value || raw.phone[0]?.value || null)
            : (raw.phone || null);
          return {
            id: raw.id,
            name: raw.name || '',
            email: email ? email.toLowerCase().trim() : null,
            phone,
            title: raw.job_title || '',
            company: raw.org_name || raw.org_id?.name || '',
            updatedAt: raw.update_time || raw.add_time || null,
            raw,
          };
        },
        async updatePerson(token, id, data) {
          return pipedrive.updatePerson(token, id, data);
        },
        async deletePerson(token, id) {
          return pipedrive.deletePerson(token, id);
        },
        async createPerson(token, data) {
          const created = await pipedrive.createPerson(token, data);
          // createPerson doesn't accept phone directly — patch it in immediately so a
          // recreated (undone) contact restores as many original fields as possible.
          if (data.phone) await pipedrive.updatePerson(token, created.id, { phone: data.phone });
          return created;
        },
      };

    case 'odoo': {
      const odoo = require('../api/odoo');
      const parseOdooCreds = (token) => {
        try { return JSON.parse(token); } catch { throw new Error('Odoo credentials are malformed'); }
      };
      return {
        async listPersons(token) {
          return odoo.listAllContacts(parseOdooCreds(token));
        },
        normalizePerson(raw) {
          return {
            id: raw.id,
            name: raw.name || '',
            email: raw.email ? raw.email.toLowerCase().trim() : null,
            phone: raw.phone || null,
            title: raw.function || '',
            company: raw.company_name || (raw.parent_id ? raw.parent_id[1] : '') || '',
            updatedAt: raw.write_date || raw.create_date || null,
            raw,
          };
        },
        async updatePerson(token, id, data) {
          return odoo.updateContact(parseOdooCreds(token), id, data);
        },
        async deletePerson(token, id) {
          // Archive (not a hard delete) — res.partner is frequently FK-referenced, and
          // archiving keeps the id + relations intact so undo is instant (unarchivePerson).
          return odoo.archiveContact(parseOdooCreds(token), id);
        },
        async unarchivePerson(token, id) {
          return odoo.unarchiveContact(parseOdooCreds(token), id);
        },
        async createPerson(token, data) {
          return odoo.createContact(parseOdooCreds(token), data);
        },
      };
    }

    case 'hubspot': {
      const hubspot = require('../api/hubspot');
      return {
        async listPersons(token) {
          return hubspot.listAllContacts(token);
        },
        normalizePerson(raw) {
          return {
            id: raw.id,
            name: raw.name || '',
            email: raw.email ? raw.email.toLowerCase().trim() : null,
            phone: null,
            title: raw.job_title || '',
            company: raw.org_name || '',
            updatedAt: raw.updatedAt || null,
            raw,
          };
        },
        async updatePerson(token, id, data) {
          const props = {};
          if (data.name) {
            const parts = data.name.split(' ');
            props.firstname = parts[0] || '';
            props.lastname = parts.slice(1).join(' ') || '';
          }
          if (data.email) props.email = data.email;
          if (data.company) props.company = data.company;
          return hubspot.updateContact(token, id, props);
        },
        async deletePerson(token, id) {
          return hubspot.archiveContact(token, id);
        },
        async createPerson(token, data) {
          const props = {};
          if (data.name) {
            const parts = data.name.split(' ');
            props.firstname = parts[0] || '';
            props.lastname = parts.slice(1).join(' ') || '';
          }
          if (data.email) props.email = data.email;
          if (data.company) props.company = data.company;
          if (data.title) props.jobtitle = data.title;
          return hubspot.createContact(token, props);
        },
      };
    }

    case 'salesforce': {
      // Real, native-ID adapter (pulled out of the notion/airtable local-DB-only bucket —
      // api/salesforce.js already has a real listContacts/updateContact that was never wired
      // in here). `token` for this provider is { accessToken, instanceUrl } — see
      // getProviderCredentials, not a bare string like every other provider.
      const salesforce = require('../api/salesforce');
      return {
        async listPersons(creds) {
          return salesforce.listContacts(creds.instanceUrl, creds.accessToken);
        },
        normalizePerson(raw) {
          return {
            id: raw.id,
            name: raw.name || '',
            email: raw.email ? raw.email.toLowerCase().trim() : null,
            phone: raw.phone || null,
            title: raw.title || '',
            company: raw.company || '',
            updatedAt: raw.updatedAt || null,
            raw,
          };
        },
        async updatePerson(creds, id, data) {
          return salesforce.updateContact(creds.instanceUrl, creds.accessToken, id, data);
        },
        async deletePerson(creds, id) {
          return salesforce.deleteContact(creds.instanceUrl, creds.accessToken, id);
        },
        async createPerson(creds, data) {
          return salesforce.createContact(creds.instanceUrl, creds.accessToken, data);
        },
      };
    }

    case 'notion':
    case 'airtable': {
      // No update/delete capability exists for these providers (create-only push functions —
      // see api/notion-crm.js / api/airtable-crm.js) — scan from Baakalai's own imported
      // opportunities rows instead of the live API, and keep updatePerson/deletePerson as
      // documented no-ops ("manual only" — the Data Quality page's duplicates strate shows a
      // manual checklist instead of attempting a remote write for these two).
      return {
        async listPersons(_token, userId) {
          const opps = await db.opportunities.listByUser(userId, 500);
          // listByUser returns every local opportunity regardless of source — scope strictly to
          // contacts actually from this provider. Contacts with no known CRM origin at all get
          // their own separate "__no_crm__" bucket instead (see below), not folded in here.
          return opps.filter(o => o.crm_provider === provider);
        },
        normalizePerson(raw) {
          return {
            id: raw.id,
            name: raw.name || '',
            email: raw.email ? raw.email.toLowerCase().trim() : null,
            phone: raw.phone || null,
            title: raw.title || '',
            company: raw.company || '',
            updatedAt: raw.updated_at || raw.created_at || null,
            raw,
          };
        },
        async updatePerson() { /* no external CRM update for these — scan only */ },
        async deletePerson() { /* no external CRM delete for these — scan only */ },
      };
    }

    case '__no_crm__': {
      // Pseudo-provider (not a real integration, never in CONNECTABLE_PROVIDERS) for contacts
      // with no known CRM origin — manually created, or imported before owner-mapping existed.
      // Always scanned regardless of which real CRMs are connected, same local-DB-only,
      // no-remote-write shape as Notion/Airtable.
      return {
        async listPersons(_token, userId) {
          const opps = await db.opportunities.listByUser(userId, 500);
          return opps.filter(o => !o.crm_provider);
        },
        normalizePerson(raw) {
          return {
            id: raw.id,
            name: raw.name || '',
            email: raw.email ? raw.email.toLowerCase().trim() : null,
            phone: raw.phone || null,
            title: raw.title || '',
            company: raw.company || '',
            updatedAt: raw.updated_at || raw.created_at || null,
            raw,
          };
        },
        async updatePerson() { /* no CRM to update — local contact only */ },
        async deletePerson() { /* no CRM to delete from — local contact only */ },
      };
    }

    default:
      return {
        async listPersons() {
          throw new Error(`CRM cleaning not yet implemented for ${provider}`);
        },
        normalizePerson: (r) => r,
        async updatePerson() { throw new Error('Not implemented'); },
        async deletePerson() { throw new Error('Not implemented'); },
      };
  }
}

// ── Email validation ──

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email) {
  return email && EMAIL_RE.test(email);
}

// ── Merge diff (full field comparison across a duplicate group) ──

/**
 * Given the full-snapshot contacts array for one duplicate group (from scanCRM's
 * duplicate_email/duplicate_name issues), compare ALL fields — not just name — and surface
 * exactly which contact had which value, plus a heuristic reconciled record. This is what the
 * merge-review UI reads before a user confirms a merge, so nothing is silently dropped.
 */
function computeMergeDiff(contacts) {
  const fields = ['name', 'email', 'phone', 'title', 'company'];
  const perContact = contacts.map(c => ({
    id: c.id, name: c.name, email: c.email, phone: c.phone, title: c.title, company: c.company, updatedAt: c.updatedAt,
  }));

  // Tiebreaker for real conflicts: prefer the most-recently-updated contact's value.
  const mostRecent = [...contacts].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))[0];

  const diffs = {};
  const suggested = {};
  for (const field of fields) {
    const values = [...new Set(contacts.map(c => c[field]).filter(v => v !== null && v !== undefined && v !== ''))];
    diffs[field] = { values, conflict: values.length > 1 };
    if (values.length === 0) suggested[field] = null;
    else if (values.length === 1) suggested[field] = values[0];
    else suggested[field] = mostRecent?.[field] || values[0];
  }

  return { fields, perContact, diffs, suggested };
}

// ── Scan CRM ──

/**
 * Full CRM health scan.
 * @param {string} userId
 * @param {string} provider — 'pipedrive', 'hubspot', 'salesforce'
 * @returns {{ score, totalContacts, issues[], summary }}
 */
async function scanCRM(userId, provider) {
  const dbBasedProviders = ['notion', 'airtable', '__no_crm__'];
  const token = await getProviderCredentials(userId, provider);
  if (!token && !dbBasedProviders.includes(provider)) {
    throw new Error(`No ${provider} API key configured`);
  }

  const adapter = getAdapter(provider);
  const rawPersons = await adapter.listPersons(token, userId);
  const persons = (rawPersons || []).map(adapter.normalizePerson);

  const issues = [];

  // 1. Duplicates by email
  const emailGroups = new Map();
  for (const p of persons) {
    if (!p.email) continue;
    const key = p.email.toLowerCase();
    if (!emailGroups.has(key)) emailGroups.set(key, []);
    // Full snapshot (not just id/name/email/company) — this is what confirm-merge's field
    // diff/reconciliation reads, persisted as-is into crm_cleaning_reports.issues so the
    // merge-review UI never needs an extra live re-fetch.
    emailGroups.get(key).push({ id: p.id, name: p.name, email: p.email, phone: p.phone, title: p.title, company: p.company, updatedAt: p.updatedAt });
  }
  for (const [email, group] of emailGroups) {
    if (group.length > 1) {
      issues.push({
        type: 'duplicate_email',
        severity: 'high',
        contacts: group,
        key: email,
        count: group.length,
        suggestedAction: 'merge',
      });
    }
  }

  // 2. Duplicates by name+company (fuzzy)
  const nameGroups = new Map();
  for (const p of persons) {
    if (!p.name || !p.company) continue;
    const key = `${p.name.toLowerCase().trim()}|${p.company.toLowerCase().trim()}`;
    if (!nameGroups.has(key)) nameGroups.set(key, []);
    nameGroups.get(key).push({ id: p.id, name: p.name, email: p.email, phone: p.phone, title: p.title, company: p.company, updatedAt: p.updatedAt });
  }
  for (const [nameKey, group] of nameGroups) {
    if (group.length > 1) {
      // Skip if already caught by email duplicate
      const emails = group.map(g => g.email).filter(Boolean);
      const allSameEmail = emails.length > 0 && new Set(emails).size === 1;
      if (!allSameEmail) {
        issues.push({
          type: 'duplicate_name',
          severity: 'medium',
          contacts: group,
          key: group[0].name + (group[0].company ? ` @ ${group[0].company}` : ''),
          count: group.length,
          suggestedAction: 'review',
        });
      }
    }
  }

  // 3. Missing critical fields
  const missingEmail = persons.filter(p => !p.email);
  if (missingEmail.length > 0) {
    issues.push({
      type: 'missing_email',
      severity: 'high',
      contacts: missingEmail.slice(0, 50).map(p => ({ id: p.id, name: p.name, company: p.company })),
      count: missingEmail.length,
      suggestedAction: 'enrich',
    });
  }

  const missingName = persons.filter(p => !p.name || p.name.trim() === '');
  if (missingName.length > 0) {
    issues.push({
      type: 'missing_name',
      severity: 'medium',
      contacts: missingName.slice(0, 50).map(p => ({ id: p.id, email: p.email })),
      count: missingName.length,
      suggestedAction: 'review',
    });
  }

  const missingCompany = persons.filter(p => !p.company || p.company.trim() === '');
  if (missingCompany.length > 0) {
    issues.push({
      type: 'missing_company',
      severity: 'low',
      contacts: missingCompany.slice(0, 50).map(p => ({ id: p.id, name: p.name, email: p.email })),
      count: missingCompany.length,
      suggestedAction: 'enrich',
    });
  }

  // 4a. Invalid email format (regex)
  const invalidFormatEmails = persons.filter(p => p.email && !isValidEmail(p.email));
  if (invalidFormatEmails.length > 0) {
    issues.push({
      type: 'invalid_email_format',
      severity: 'high',
      contacts: invalidFormatEmails.slice(0, 50).map(p => ({ id: p.id, name: p.name, email: p.email })),
      count: invalidFormatEmails.length,
      suggestedAction: 'fix',
    });
  }

  // 4b. Invalid email domain (MX check) — only for emails that pass regex
  const validFormatEmails = persons.filter(p => p.email && isValidEmail(p.email));
  // Group by domain to avoid redundant DNS lookups, limit to first 100 contacts
  const domainGroups = new Map();
  for (const p of validFormatEmails.slice(0, 100)) {
    const domain = p.email.split('@')[1];
    if (!domainGroups.has(domain)) domainGroups.set(domain, []);
    domainGroups.get(domain).push(p);
  }

  const MX_TIMEOUT = 3000;
  const mxCache = new Map();
  const mxCheckPromises = [];
  for (const [domain] of domainGroups) {
    mxCheckPromises.push(
      Promise.race([
        getMxHost(domain).then(mx => mxCache.set(domain, mx)),
        new Promise(resolve => setTimeout(() => { mxCache.set(domain, 'timeout'); resolve(); }, MX_TIMEOUT)),
      ])
    );
  }
  await Promise.allSettled(mxCheckPromises);

  const invalidDomainContacts = [];
  for (const [domain, contacts] of domainGroups) {
    const mx = mxCache.get(domain);
    if (mx === null) {
      // No MX records — domain cannot receive email
      for (const p of contacts) {
        invalidDomainContacts.push({ id: p.id, name: p.name, email: p.email, domain });
      }
    }
    // 'timeout' or valid MX → skip (don't flag on timeout)
  }

  if (invalidDomainContacts.length > 0) {
    issues.push({
      type: 'invalid_email_domain',
      severity: 'high',
      contacts: invalidDomainContacts.slice(0, 50),
      count: invalidDomainContacts.length,
      suggestedAction: 'verify',
    });
  }

  // Combine for score calculation (backward compat)
  const invalidEmails = [...invalidFormatEmails, ...invalidDomainContacts];

  // 5. Inactive contacts (no update in 6+ months)
  const now = Date.now();
  const inactive = persons.filter(p => {
    if (!p.updatedAt) return false;
    return (now - new Date(p.updatedAt).getTime()) > SIX_MONTHS_MS;
  });
  if (inactive.length > 0) {
    issues.push({
      type: 'inactive',
      severity: 'low',
      contacts: inactive.slice(0, 50).map(p => ({ id: p.id, name: p.name, email: p.email, lastUpdate: p.updatedAt })),
      count: inactive.length,
      suggestedAction: 'archive',
    });
  }

  // 6. Format issues — names in ALL CAPS
  const allCaps = persons.filter(p => p.name && p.name === p.name.toUpperCase() && p.name.length > 2);
  if (allCaps.length > 0) {
    issues.push({
      type: 'format_name_caps',
      severity: 'low',
      contacts: allCaps.slice(0, 50).map(p => ({
        id: p.id,
        name: p.name,
        suggested: p.name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' '),
      })),
      count: allCaps.length,
      suggestedAction: 'auto_fix',
    });
  }

  // Compute health score — proportional to contact base size
  const total = persons.length || 1;
  const dupEmailCount = issues.filter(i => i.type === 'duplicate_email').reduce((s, i) => s + i.contacts.length, 0);
  const dupNameCount = issues.filter(i => i.type === 'duplicate_name').reduce((s, i) => s + i.contacts.length, 0);

  // Each category can deduct up to its max weight (total = 100)
  // Deductions scale as % of affected contacts vs total
  const pctDupEmail = dupEmailCount / total;       // weight: 25
  const pctDupName = dupNameCount / total;          // weight: 10
  const pctMissingEmail = missingEmail.length / total; // weight: 20
  const pctInvalidEmail = invalidEmails.length / total; // weight: 20
  const pctInactive = inactive.length / total;      // weight: 15
  const pctCaps = allCaps.length / total;           // weight: 10

  let score = 100;
  score -= Math.min(pctDupEmail * 2, 1) * 25;       // 50%+ duplicates = full 25pt deduction
  score -= Math.min(pctDupName * 3, 1) * 10;        // 33%+ = full 10pt deduction
  score -= Math.min(pctMissingEmail * 1.5, 1) * 20; // 67%+ missing = full 20pt deduction
  score -= Math.min(pctInvalidEmail * 5, 1) * 20;   // 20%+ invalid = full 20pt deduction
  score -= Math.min(pctInactive * 1.5, 1) * 15;     // 67%+ inactive = full 15pt deduction
  score -= Math.min(pctCaps * 3, 1) * 10;           // 33%+ caps = full 10pt deduction
  score = Math.max(0, Math.round(score));

  const summary = {
    duplicateEmails: dupEmailCount,
    duplicateNames: dupNameCount,
    missingEmails: missingEmail.length,
    missingCompanies: missingCompany.length,
    invalidEmails: invalidEmails.length,
    inactive: inactive.length,
    formatIssues: allCaps.length,
  };

  return { score, totalContacts: persons.length, issues, summary, provider };
}

// ── Apply Fixes ──

/**
 * Apply a list of fixes to the CRM.
 * @param {string} userId
 * @param {string} provider
 * @param {{ type, action, contactIds, data }[]} fixes
 */
async function applyFixes(userId, provider, fixes) {
  const dbBasedProviders = ['notion', 'airtable', '__no_crm__'];
  const token = await getProviderCredentials(userId, provider);
  if (!token && !dbBasedProviders.includes(provider)) throw new Error(`No ${provider} API key configured`);

  const adapter = getAdapter(provider);
  let applied = 0;
  let skipped = 0;
  const errors = [];

  for (const fix of fixes) {
    try {
      switch (fix.action) {
        case 'delete':
          for (const id of (fix.contactIds || [])) {
            await adapter.deletePerson(token, id);
            applied++;
          }
          break;

        case 'update':
          for (const id of (fix.contactIds || [])) {
            await adapter.updatePerson(token, id, fix.data || {});
            applied++;
          }
          break;

        case 'auto_fix_caps':
          for (const contact of (fix.contacts || [])) {
            const properName = contact.name
              .split(' ')
              .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
              .join(' ');
            await adapter.updatePerson(token, contact.id, { name: properName });
            applied++;
          }
          break;

        case 'archive':
          // Archive = soft delete: mark as inactive in local DB
          for (const id of (fix.contactIds || [])) {
            await db.query(`UPDATE opportunities SET status = 'archived' WHERE id = $1 AND user_id = $2`, [id, userId]);
            applied++;
          }
          break;

        case 'merge':
          // Keep the first contact, merge data from others, delete others
          if (fix.contactIds && fix.contactIds.length >= 2) {
            const [keepId, ...deleteIds] = fix.contactIds;
            if (fix.mergeData) {
              await adapter.updatePerson(token, keepId, fix.mergeData);
            }
            for (const id of deleteIds) {
              await adapter.deletePerson(token, id);
            }
            applied += deleteIds.length;
          }
          break;

        case 'verify_emails': {
          const emails = (fix.emails || []);
          if (emails.length === 0) { skipped++; break; }

          let verifyResults = [];
          const hunterKey = await getUserKey(userId, 'hunter').catch(() => null);
          const dropcontactKey = await getUserKey(userId, 'dropcontact').catch(() => null);

          if (hunterKey) {
            // Hunter.io verification
            const hunterResults = await hunter.verifyBatch(hunterKey, emails);
            verifyResults = hunterResults.map(r => ({
              email: r.email,
              status: r.status === 'valid' ? 'valid' : r.status === 'invalid' ? 'invalid' : 'unknown',
              source: 'hunter',
              score: r.score,
            }));
          } else if (dropcontactKey) {
            // DropContact batch verification
            const contacts = emails.map(email => ({ email }));
            const dcResults = await dropcontact.verifyEmails(dropcontactKey, contacts);
            verifyResults = dcResults.map(r => ({
              email: r.email,
              status: r.verified ? 'valid' : 'invalid',
              source: 'dropcontact',
            }));
          } else {
            // Fallback: SMTP verification via enrich-agent
            for (const email of emails) {
              try {
                const domain = email.split('@')[1];
                const mxHost = await getMxHost(domain);
                const status = mxHost ? await smtpVerify(email, mxHost) : 'unknown';
                verifyResults.push({ email, status, source: 'smtp' });
              } catch {
                verifyResults.push({ email, status: 'unknown', source: 'smtp' });
              }
            }
          }

          const valid = verifyResults.filter(r => r.status === 'valid').length;
          const invalid = verifyResults.filter(r => r.status === 'invalid').length;
          const unknown = verifyResults.filter(r => r.status === 'unknown' || r.status === 'error').length;

          applied += verifyResults.length;
          // Attach results to the fix object so caller can read them
          fix.verifyResults = verifyResults;
          fix.verifySummary = { valid, invalid, unknown, total: verifyResults.length };
          break;
        }

        default:
          skipped++;
      }
    } catch (err) {
      errors.push({ fix: fix.type || fix.action, error: err.message });
    }
  }

  return { applied, skipped, errors };
}

module.exports = { scanCRM, applyFixes, getAdapter, computeMergeDiff, getProviderCredentials };
