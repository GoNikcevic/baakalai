/**
 * Salesforce API Client
 *
 * Handles contacts, opportunities (deals), and notes via Salesforce REST API.
 * All API functions require an explicit accessToken + instanceUrl (per-user isolation).
 */

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
  const query = `SELECT Id, FirstName, LastName, Email, Title FROM Contact WHERE Email = '${email.replace(/'/g, "\\'")}'`;
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
  const query = `SELECT Id, Name, StageName, Amount, CloseDate, CreatedDate, LastModifiedDate FROM Opportunity ORDER BY CreatedDate DESC LIMIT ${limit}`;
  const result = await sfFetch(instanceUrl, accessToken, `/query?q=${encodeURIComponent(query)}`);
  return (result.records || []).map(r => ({
    id: r.Id,
    name: r.Name,
    stage: r.StageName,
    amount: r.Amount,
    closeDate: r.CloseDate,
    createdAt: r.CreatedDate,
    updatedAt: r.LastModifiedDate,
  }));
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
    `/query?q=${encodeURIComponent('SELECT Id, FirstName, LastName, Email, Phone, Title, Account.Name, OwnerId, LastModifiedDate FROM Contact WHERE Email != null ORDER BY CreatedDate DESC')}`
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
        updatedAt: c.LastModifiedDate,
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
    where = `WHERE ToAddress = '${contactEmail.replace(/'/g, "\\'")}'`;
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
  const safe = contactEmail.replace(/'/g, "\\'");
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
};
