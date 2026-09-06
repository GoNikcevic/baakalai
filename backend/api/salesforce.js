/**
 * Salesforce API Client
 *
 * Handles contacts, opportunities (deals), and notes via Salesforce REST API.
 * All API functions require an explicit accessToken + instanceUrl (per-user isolation).
 */

const { extractActivityDate } = require('../lib/crm-activity-date');

async function sfFetch(instanceUrl, accessToken, endpoint, options = {}) {
  if (!accessToken || !instanceUrl) {
    throw new Error('Salesforce credentials required (accessToken + instanceUrl)');
  }
  const url = `${instanceUrl}/services/data/v58.0${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw Object.assign(
      new Error(`Salesforce API ${res.status}: ${body}`),
      { status: res.status }
    );
  }

  if (res.status === 204) return null;
  return res.json();
}

// ── Contacts ──

async function createContact(instanceUrl, accessToken, data) {
  return sfFetch(instanceUrl, accessToken, '/sobjects/Contact', {
    method: 'POST',
    body: JSON.stringify({
      FirstName: data.firstName || '',
      LastName: data.lastName || data.name || 'Unknown',
      Email: data.email || '',
      Title: data.title || '',
      Company: data.company || '',
    }),
  });
}

async function searchContacts(instanceUrl, accessToken, email) {
  const query = `SELECT Id, FirstName, LastName, Email, Title FROM Contact WHERE Email = '${email.replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  return result.records || [];
}

// ── Opportunities (Deals) ──

async function createDeal(instanceUrl, accessToken, data) {
  return sfFetch(instanceUrl, accessToken, '/sobjects/Opportunity', {
    method: 'POST',
    body: JSON.stringify({
      Name: data.name || 'Bakal Opportunity',
      StageName: mapStatusToStage(data.status),
      CloseDate: data.closeDate || new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
      Description: data.description || '',
    }),
  });
}

async function updateDeal(instanceUrl, accessToken, dealId, data) {
  return sfFetch(instanceUrl, accessToken, `/sobjects/Opportunity/${dealId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      StageName: mapStatusToStage(data.status),
      Description: data.description || undefined,
    }),
  });
}

async function getDeals(instanceUrl, accessToken, limit = 100) {
  // LastActivityDate / LastModifiedDate : sans elles, la récence d'un deal est
  // inconnue et rien ne peut être signalé comme dormant. Voir lib/crm-activity-date.js.
  // IsWon/IsClosed are native Opportunity fields (true source of truth for won/lost — no need
  // to cross-reference OpportunityStage). The OpportunityContactRoles subquery resolves the
  // primary contact, since Opportunity has no direct contact lookup (only AccountId).
  const query = `SELECT Id, Name, StageName, Amount, CloseDate, CreatedDate, LastModifiedDate, LastActivityDate, IsWon, IsClosed,
    (SELECT ContactId FROM OpportunityContactRoles WHERE IsPrimary = true LIMIT 1)
    FROM Opportunity ORDER BY CreatedDate DESC LIMIT ${limit}`;
  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  return (result.records || []).map(r => ({
    id: r.Id,
    name: r.Name,
    stage: r.StageName,
    status: r.IsWon ? 'won' : (r.IsClosed ? 'lost' : 'open'),
    value: r.Amount,
    personId: r.OpportunityContactRoles?.records?.[0]?.ContactId || null,
    closeDate: r.CloseDate,
    createdAt: r.CreatedDate,
    updatedAt: r.LastModifiedDate,
    // Sans ces deux champs le deal remonte sans recence, donc jamais dormant.
    lastActivityAt: extractActivityDate('salesforce', r),
  }));
}

// Diagnostic public (lead magnet) : lecture unique et anonyme des
// opportunités via OAuth central — même forme de retour que
// pipedrive/hubspot.listDealsForDiagnostic (routes/public-diagnostic.js).
async function listDealsForDiagnostic({ accessToken, instanceUrl }, { maxDeals = 2000 } = {}) {
  const soql = `SELECT Name, Amount, CreatedDate, LastActivityDate, LastModifiedDate, IsClosed, IsWon, Account.Name FROM Opportunity ORDER BY CreatedDate DESC LIMIT ${maxDeals}`;
  const deals = [];
  let result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(soql)}`);
  for (;;) {
    for (const r of result.records || []) {
      deals.push({
        name: r.Name,
        company: r.Account?.Name || null,
        value: parseFloat(r.Amount) || 0,
        currency: 'EUR',
        status: r.IsClosed ? (r.IsWon ? 'won' : 'lost') : 'open',
        addTime: r.CreatedDate,
        lastActivity: extractActivityDate('salesforce', r),
      });
    }
    if (result.done || !result.nextRecordsUrl || deals.length >= maxDeals) break;
    result = await sfFetch(instanceUrl, accessToken, result.nextRecordsUrl.replace('/services/data/v58.0', ''));
  }
  return deals;
}

// ── Notes ──

async function createNote(instanceUrl, accessToken, data) {
  return sfFetch(instanceUrl, accessToken, '/sobjects/Note', {
    method: 'POST',
    body: JSON.stringify({
      Title: data.title || 'Bakal Note',
      Body: data.body || '',
      ParentId: data.parentId,
    }),
  });
}

// ── Helpers ──

function mapStatusToStage(status) {
  const map = {
    new: 'Prospecting',
    interested: 'Qualification',
    meeting: 'Needs Analysis',
    negotiation: 'Negotiation/Review',
    won: 'Closed Won',
    lost: 'Closed Lost',
  };
  return map[status] || 'Prospecting';
}

function mapOpportunityToContact(opp) {
  const parts = (opp.name || '').split(' ');
  return {
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || parts[0] || 'Unknown',
    email: opp.email || '',
    title: opp.title || '',
    company: opp.company || '',
  };
}

// ── Update Contact ──

async function updateContact(instanceUrl, accessToken, contactId, data) {
  await sfFetch(instanceUrl, accessToken, `/sobjects/Contact/${contactId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      FirstName: data.firstName,
      LastName: data.lastName,
      Email: data.email,
      Title: data.title,
      ...(data.company ? { Account: { Name: data.company } } : {}),
    }),
  });
  return { id: contactId };
}

// ── Delete Contact ──
// Hard delete via REST (Salesforce retains it in the Recycle Bin ~15 days server-side, but from
// our API's perspective it's gone). Undo recreates a NEW Contact via createContact — it gets a
// new Salesforce Id, a known limitation of this approach vs. the Recycle Bin's `undelete`
// composite API, which could restore the exact same Id within the 15-day window if ever needed.
async function deleteContact(instanceUrl, accessToken, contactId) {
  await sfFetch(instanceUrl, accessToken, `/sobjects/Contact/${contactId}`, { method: 'DELETE' });
  return { id: contactId };
}

// ── Upsert Contact (search by email, update or create) ──

async function upsertContact(instanceUrl, accessToken, data) {
  const existing = await searchContacts(instanceUrl, accessToken, data.email);
  if (existing && existing.length > 0) {
    const contactId = existing[0].Id;
    await updateContact(instanceUrl, accessToken, contactId, data);
    return { id: contactId, created: false };
  }
  const created = await createContact(instanceUrl, accessToken, data);
  return { id: created.id, created: true };
}

// ── Get Deal by ID ──

async function getDeal(instanceUrl, accessToken, dealId) {
  return sfFetch(instanceUrl, accessToken, `/sobjects/Opportunity/${dealId}`);
}

// ── Get Deal Stages (dynamic discovery) ──

async function getStages(instanceUrl, accessToken) {
  const result = await sfFetch(instanceUrl, accessToken,
    `/query?q=${encodeURIComponent("SELECT Id, MasterLabel, SortOrder, IsClosed, IsWon FROM OpportunityStage ORDER BY SortOrder")}`
  );
  return (result.records || []).map(s => ({
    id: s.Id,
    name: s.MasterLabel,
    order: s.SortOrder,
    isClosed: s.IsClosed,
    isWon: s.IsWon,
  }));
}

// ── Get Users (for owner mapping) ──

async function getUsers(instanceUrl, accessToken) {
  const result = await sfFetch(instanceUrl, accessToken,
    `/query?q=${encodeURIComponent("SELECT Id, Name, Email, IsActive FROM User WHERE IsActive = true LIMIT 200")}`
  );
  return (result.records || []).map(u => ({
    id: u.Id,
    name: u.Name,
    email: u.Email,
    active: u.IsActive,
  }));
}

// ── Get Activities/Tasks ──

async function getActivities(instanceUrl, accessToken, contactId) {
  const result = await sfFetch(instanceUrl, accessToken,
    `/query?q=${encodeURIComponent(`SELECT Id, Subject, Status, ActivityDate, Description, WhoId FROM Task WHERE WhoId = '${contactId}' ORDER BY ActivityDate DESC LIMIT 50`)}`
  );
  return (result.records || []).map(a => ({
    id: a.Id,
    subject: a.Subject,
    status: a.Status,
    date: a.ActivityDate,
    description: a.Description,
    // Aliases matching Pipedrive/Odoo's getActivities shape, for callers that consume
    // multiple providers generically (e.g. response-analysis-agent.js).
    dueDate: a.ActivityDate,
    note: a.Description,
    type: 'task',
  }));
}

// ── List All Contacts ──

async function listContacts(instanceUrl, accessToken, { limit = 10000 } = {}) {
  const all = [];
  let result = await sfFetch(instanceUrl, accessToken,
    `/query?q=${encodeURIComponent('SELECT Id, FirstName, LastName, Email, Phone, Title, Account.Name, OwnerId, MailingCountry, MailingCity, LastModifiedDate, LastActivityDate FROM Contact WHERE Email != null ORDER BY CreatedDate DESC')}`
  );
  const mapRecords = (records) => {
    for (const c of (records || [])) {
      all.push({
        id: c.Id,
        name: `${c.FirstName || ''} ${c.LastName || ''}`.trim(),
        email: c.Email,
        phone: c.Phone || null,
        title: c.Title,
        company: c.Account?.Name || '',
        ownerId: c.OwnerId,
        country: c.MailingCountry || null,
        city: c.MailingCity || null,
        updatedAt: c.LastModifiedDate,
        // C'est ce chemin-ci qu'emprunte la synchro (stepSync), pas getDeals.
        lastActivityAt: extractActivityDate('salesforce', c),
      });
    }
  };
  mapRecords(result.records);
  // queryMore pagination — nextRecordsUrl is a full path, fetch directly
  while (!result.done && result.nextRecordsUrl && all.length < limit) {
    const url = `${instanceUrl}${result.nextRecordsUrl}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) break;
    result = await res.json();
    mapRecords(result.records);
  }
  return all;
}

// ── Get Contact Fields (for field mapping) ──

async function getContactFields(instanceUrl, accessToken) {
  const data = await sfFetch(instanceUrl, accessToken, '/sobjects/Contact/describe');
  return (data.fields || []).map(f => ({
    key: f.name,
    name: f.label,
    type: f.type,
    options: (f.picklistValues || []).map(p => ({ id: p.value, label: p.label })),
  }));
}

// ── Campaigns ──

async function listCampaigns(instanceUrl, accessToken, { limit = 100 } = {}) {
  const data = await sfFetch(instanceUrl, accessToken,
    `/query?q=${encodeURIComponent(`SELECT Id, Name, Status, Type, StartDate, EndDate, NumberOfContacts, NumberOfResponses, NumberSent FROM Campaign ORDER BY CreatedDate DESC LIMIT ${limit}`)}`
  );
  return (data.records || []).map(c => ({
    id: c.Id,
    name: c.Name,
    status: c.Status,
    type: c.Type,
    startDate: c.StartDate,
    endDate: c.EndDate,
    contacts: c.NumberOfContacts || 0,
    responses: c.NumberOfResponses || 0,
    sent: c.NumberSent || 0,
  }));
}

async function getCampaign(instanceUrl, accessToken, campaignId) {
  const data = await sfFetch(instanceUrl, accessToken, `/sobjects/Campaign/${campaignId}`);
  return data;
}

async function getCampaignMembers(instanceUrl, accessToken, campaignId, { limit = 500 } = {}) {
  const data = await sfFetch(instanceUrl, accessToken,
    `/query?q=${encodeURIComponent(`SELECT Id, ContactId, Status, FirstRespondedDate, Contact.Name, Contact.Email, Contact.Title, Contact.Account.Name FROM CampaignMember WHERE CampaignId = '${campaignId}' LIMIT ${limit}`)}`
  );
  return (data.records || []).map(m => ({
    id: m.Id,
    contactId: m.ContactId,
    status: m.Status,
    firstResponded: m.FirstRespondedDate,
    name: m.Contact?.Name,
    email: m.Contact?.Email,
    title: m.Contact?.Title,
    company: m.Contact?.Account?.Name,
  }));
}

async function addToCampaign(instanceUrl, accessToken, campaignId, contactId, status = 'Sent') {
  return sfFetch(instanceUrl, accessToken, '/sobjects/CampaignMember', {
    method: 'POST',
    body: JSON.stringify({
      CampaignId: campaignId,
      ContactId: contactId,
      Status: status,
    }),
  });
}

async function createCampaign(instanceUrl, accessToken, data) {
  return sfFetch(instanceUrl, accessToken, '/sobjects/Campaign', {
    method: 'POST',
    body: JSON.stringify({
      Name: data.name,
      Status: data.status || 'Planned',
      Type: data.type || 'Email',
      StartDate: data.startDate || new Date().toISOString().split('T')[0],
      Description: data.description || '',
    }),
  });
}

async function updateCampaignMemberStatus(instanceUrl, accessToken, memberId, status) {
  return sfFetch(instanceUrl, accessToken, `/sobjects/CampaignMember/${memberId}`, {
    method: 'PATCH',
    body: JSON.stringify({ Status: status }),
  });
}

// ── Email Messages (Fonteva / Salesforce transactional emails) ──

async function getEmailMessages(instanceUrl, accessToken, { contactId, contactEmail, limit = 200, since } = {}) {
  let where = '';
  if (contactId) {
    where = `WHERE RelatedToId = '${contactId}' OR (ToAddress = (SELECT Email FROM Contact WHERE Id = '${contactId}'))`;
  } else if (contactEmail) {
    where = `WHERE ToAddress = '${contactEmail.replace(/'/g, "''").replace(/\\/g, '\\\\')}'`;
  } else {
    where = 'WHERE CreatedDate > ' + (since || 'LAST_N_DAYS:90');
  }
  if (since && contactId) {
    where += ` AND CreatedDate > ${since}`;
  }

  const query = `SELECT Id, Subject, Status, ToAddress, FromAddress, CreatedDate, MessageDate,
    HasAttachment, IsExternallyVisible, TextBody
    FROM EmailMessage ${where}
    ORDER BY CreatedDate DESC LIMIT ${limit}`;

  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  return (result.records || []).map(e => ({
    id: e.Id,
    subject: e.Subject,
    status: e.Status, // 0=New, 1=Read, 2=Replied, 3=Sent, 4=Forwarded, 5=Draft
    to: e.ToAddress,
    from: e.FromAddress,
    createdAt: e.CreatedDate,
    messageDate: e.MessageDate,
    hasAttachment: e.HasAttachment,
    preview: (e.TextBody || '').slice(0, 200),
  }));
}

async function getEmailMessageStats(instanceUrl, accessToken, { since = 'LAST_N_DAYS:90' } = {}) {
  const query = `SELECT Status, COUNT(Id) total
    FROM EmailMessage
    WHERE CreatedDate > ${since}
    GROUP BY Status`;

  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  const stats = { sent: 0, read: 0, replied: 0, forwarded: 0, total: 0 };
  for (const r of (result.records || [])) {
    const count = r.total || 0;
    stats.total += count;
    // EmailMessage Status: 0=New, 1=Read, 2=Replied, 3=Sent, 4=Forwarded, 5=Draft
    if (r.Status === '0' || r.Status === '3') stats.sent += count;
    else if (r.Status === '1') stats.read += count;
    else if (r.Status === '2') stats.replied += count;
    else if (r.Status === '4') stats.forwarded += count;
  }
  return stats;
}

async function getContactEmailActivity(instanceUrl, accessToken, contactEmail) {
  const safe = contactEmail.replace(/'/g, "''").replace(/\\/g, '\\\\');
  const query = `SELECT Id, Subject, Status, CreatedDate, ToAddress, FromAddress
    FROM EmailMessage
    WHERE ToAddress = '${safe}' OR FromAddress = '${safe}'
    ORDER BY CreatedDate DESC LIMIT 50`;

  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  return (result.records || []).map(e => ({
    id: e.Id,
    subject: e.Subject,
    status: e.Status,
    createdAt: e.CreatedDate,
    to: e.ToAddress,
    from: e.FromAddress,
    direction: e.ToAddress?.toLowerCase() === contactEmail.toLowerCase() ? 'inbound' : 'outbound',
  }));
}

// ── Leads ──

async function createLead(instanceUrl, accessToken, data) {
  return sfFetch(instanceUrl, accessToken, '/sobjects/Lead', {
    method: 'POST',
    body: JSON.stringify({
      FirstName: data.firstName || '',
      LastName: data.lastName || 'Unknown',
      Email: data.email || '',
      Company: data.company || '[Not Provided]',
      Title: data.title || '',
      Phone: data.phone || '',
      Status: data.status || 'Open - Not Contacted',
    }),
  });
}

async function searchLeads(instanceUrl, accessToken, email) {
  const safe = email.replace(/'/g, "''").replace(/\\/g, '\\\\');
  const query = `SELECT Id, FirstName, LastName, Email, Company, Title, Phone, Status, OwnerId, CreatedDate FROM Lead WHERE Email = '${safe}'`;
  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  return result.records || [];
}

async function listLeads(instanceUrl, accessToken, { limit = 10000 } = {}) {
  const all = [];
  let result = await sfFetch(instanceUrl, accessToken,
    `/query?q=${encodeURIComponent('SELECT Id, FirstName, LastName, Email, Company, Title, Phone, Status, OwnerId, CreatedDate FROM Lead WHERE Email != null ORDER BY CreatedDate DESC')}`
  );
  const mapRecords = (records) => {
    for (const l of (records || [])) {
      all.push({
        id: l.Id,
        name: `${l.FirstName || ''} ${l.LastName || ''}`.trim(),
        email: l.Email,
        company: l.Company,
        title: l.Title,
        phone: l.Phone,
        status: l.Status,
        ownerId: l.OwnerId,
        createdAt: l.CreatedDate,
      });
    }
  };
  mapRecords(result.records);
  while (!result.done && result.nextRecordsUrl && all.length < limit) {
    const url = `${instanceUrl}${result.nextRecordsUrl}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) break;
    result = await res.json();
    mapRecords(result.records);
  }
  return all;
}

async function convertLead(instanceUrl, accessToken, leadId, { contactId, accountId, opportunityName, convertedStatus = 'Closed - Converted' } = {}) {
  const leadConvert = {
    LeadId: leadId,
    ConvertedStatus: convertedStatus,
  };
  if (contactId) leadConvert.ContactId = contactId;
  if (accountId) leadConvert.AccountId = accountId;
  if (opportunityName) leadConvert.OpportunityName = opportunityName;
  else leadConvert.DoNotCreateOpportunity = true;

  const result = await sfFetch(instanceUrl, accessToken, '/actions/standard/convertLead', {
    method: 'POST',
    body: JSON.stringify({ inputs: [{ leadConvert }] }),
  });
  return result[0]?.outputValues || result;
}

// ── Accounts ──

async function createAccount(instanceUrl, accessToken, data) {
  return sfFetch(instanceUrl, accessToken, '/sobjects/Account', {
    method: 'POST',
    body: JSON.stringify({
      Name: data.name || 'Unknown Account',
      Industry: data.industry || '',
      Website: data.website || '',
      Phone: data.phone || '',
      BillingCity: data.billingCity || '',
    }),
  });
}

async function searchAccounts(instanceUrl, accessToken, name) {
  const safe = name.replace(/'/g, "''").replace(/\\/g, '\\\\');
  const query = `SELECT Id, Name, Industry, Website, Phone, BillingCity, OwnerId, CreatedDate FROM Account WHERE Name LIKE '%${safe}%' ORDER BY CreatedDate DESC LIMIT 50`;
  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  return (result.records || []).map(a => ({
    id: a.Id,
    name: a.Name,
    industry: a.Industry,
    website: a.Website,
    phone: a.Phone,
    billingCity: a.BillingCity,
    ownerId: a.OwnerId,
    createdAt: a.CreatedDate,
  }));
}

async function listAccounts(instanceUrl, accessToken, { limit = 10000 } = {}) {
  const all = [];
  let result = await sfFetch(instanceUrl, accessToken,
    `/query?q=${encodeURIComponent('SELECT Id, Name, Industry, Website, Phone, BillingCity, OwnerId, CreatedDate FROM Account ORDER BY CreatedDate DESC')}`
  );
  const mapRecords = (records) => {
    for (const a of (records || [])) {
      all.push({
        id: a.Id,
        name: a.Name,
        industry: a.Industry,
        website: a.Website,
        phone: a.Phone,
        billingCity: a.BillingCity,
        ownerId: a.OwnerId,
        createdAt: a.CreatedDate,
      });
    }
  };
  mapRecords(result.records);
  while (!result.done && result.nextRecordsUrl && all.length < limit) {
    const url = `${instanceUrl}${result.nextRecordsUrl}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok) break;
    result = await res.json();
    mapRecords(result.records);
  }
  return all;
}

async function getAccount(instanceUrl, accessToken, accountId) {
  const data = await sfFetch(instanceUrl, accessToken, `/sobjects/Account/${accountId}`);
  return {
    id: data.Id,
    name: data.Name,
    industry: data.Industry,
    website: data.Website,
    phone: data.Phone,
    billingCity: data.BillingCity,
    ownerId: data.OwnerId,
    createdAt: data.CreatedDate,
  };
}

// ── Events ──

async function createEvent(instanceUrl, accessToken, data) {
  return sfFetch(instanceUrl, accessToken, '/sobjects/Event', {
    method: 'POST',
    body: JSON.stringify({
      Subject: data.subject || 'Event',
      StartDateTime: data.startDateTime,
      EndDateTime: data.endDateTime,
      WhoId: data.whoId || '',
      WhatId: data.whatId || '',
      Description: data.description || '',
    }),
  });
}

async function getEvents(instanceUrl, accessToken, { contactId, since, limit = 50 } = {}) {
  const conditions = [];
  if (contactId) conditions.push(`WhoId = '${contactId}'`);
  if (since) conditions.push(`ActivityDate >= ${since}`);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const query = `SELECT Id, Subject, StartDateTime, EndDateTime, WhoId, WhatId, Description, ActivityDate, CreatedDate FROM Event ${where} ORDER BY StartDateTime DESC LIMIT ${limit}`;
  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  return (result.records || []).map(e => ({
    id: e.Id,
    subject: e.Subject,
    startDateTime: e.StartDateTime,
    endDateTime: e.EndDateTime,
    whoId: e.WhoId,
    whatId: e.WhatId,
    description: e.Description,
    date: e.ActivityDate,
    createdAt: e.CreatedDate,
  }));
}

// ── Tasks (create) ──

async function createTask(instanceUrl, accessToken, data) {
  return sfFetch(instanceUrl, accessToken, '/sobjects/Task', {
    method: 'POST',
    body: JSON.stringify({
      Subject: data.subject || 'Task',
      Status: data.status || 'Not Started',
      Priority: data.priority || 'Normal',
      WhoId: data.whoId || '',
      WhatId: data.whatId || '',
      ActivityDate: data.activityDate || '',
      Description: data.description || '',
    }),
  });
}

// ── Opportunity Contact Roles ──

async function linkContactToOpportunity(instanceUrl, accessToken, opportunityId, contactId, role = 'Business User') {
  return sfFetch(instanceUrl, accessToken, '/sobjects/OpportunityContactRole', {
    method: 'POST',
    body: JSON.stringify({
      OpportunityId: opportunityId,
      ContactId: contactId,
      Role: role,
    }),
  });
}

async function getOpportunityContacts(instanceUrl, accessToken, opportunityId) {
  const query = `SELECT Id, ContactId, Role, IsPrimary, Contact.Name, Contact.Email, Contact.Title FROM OpportunityContactRole WHERE OpportunityId = '${opportunityId}'`;
  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  return (result.records || []).map(r => ({
    id: r.Id,
    contactId: r.ContactId,
    role: r.Role,
    isPrimary: r.IsPrimary,
    name: r.Contact?.Name,
    email: r.Contact?.Email,
    title: r.Contact?.Title,
  }));
}

// ── Custom Objects ──

async function queryCustomObject(instanceUrl, accessToken, objectName, { fields = ['Id', 'Name'], where, limit = 200 } = {}) {
  let query = `SELECT ${fields.join(', ')} FROM ${objectName}`;
  if (where) query += ` WHERE ${where}`;
  query += ` LIMIT ${limit}`;
  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  return result.records || [];
}

async function createCustomRecord(instanceUrl, accessToken, objectName, data) {
  return sfFetch(instanceUrl, accessToken, `/sobjects/${objectName}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

// ── Bulk API v2 ──

async function bulkQuery(instanceUrl, accessToken, soqlQuery) {
  const baseUrl = `${instanceUrl}/services/data/v58.0/jobs/query`;

  // 1. Create bulk query job
  const createRes = await fetch(baseUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ operation: 'query', query: soqlQuery }),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`Salesforce Bulk API create job ${createRes.status}: ${body}`);
  }
  const job = await createRes.json();
  const jobId = job.id;

  // 2. Poll until JobComplete or Failed
  const maxAttempts = 60;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(`${baseUrl}/${jobId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!pollRes.ok) {
      const body = await pollRes.text();
      throw new Error(`Salesforce Bulk API poll ${pollRes.status}: ${body}`);
    }
    const status = await pollRes.json();
    if (status.state === 'JobComplete') break;
    if (status.state === 'Failed' || status.state === 'Aborted') {
      throw new Error(`Salesforce Bulk query ${status.state}: ${status.errorMessage || 'unknown error'}`);
    }
  }

  // 3. Get results (CSV)
  const resultsRes = await fetch(`${baseUrl}/${jobId}/results`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'text/csv',
    },
  });
  if (!resultsRes.ok) {
    const body = await resultsRes.text();
    throw new Error(`Salesforce Bulk API results ${resultsRes.status}: ${body}`);
  }
  const csv = await resultsRes.text();

  // 4. Parse CSV to array of objects (handles quoted fields with commas)
  const lines = csv.split('\n').filter(l => l.trim());
  if (lines.length === 0) return [];
  const parseCsvLine = (line) => {
    const fields = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    fields.push(current.trim());
    return fields;
  };
  const headers = parseCsvLine(lines[0]);
  const records = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const record = {};
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = values[j] || '';
    }
    records.push(record);
  }
  return records;
}

module.exports = {
  createContact,
  updateContact,
  deleteContact,
  upsertContact,
  searchContacts,
  listContacts,
  createDeal,
  updateDeal,
  getDeal,
  getDeals,
  listDealsForDiagnostic,
  getStages,
  getUsers,
  getActivities,
  getContactFields,
  createNote,
  listCampaigns,
  getCampaign,
  getCampaignMembers,
  addToCampaign,
  createCampaign,
  updateCampaignMemberStatus,
  getEmailMessages,
  getEmailMessageStats,
  getContactEmailActivity,
  mapStatusToStage,
  mapOpportunityToContact,
  createLead,
  searchLeads,
  listLeads,
  convertLead,
  createAccount,
  searchAccounts,
  listAccounts,
  getAccount,
  createEvent,
  getEvents,
  createTask,
  linkContactToOpportunity,
  getOpportunityContacts,
  queryCustomObject,
  createCustomRecord,
  bulkQuery,
};
