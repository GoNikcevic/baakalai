/**
 * Informz (Higher Logic Marketing Professional) API Client
 *
 * SOAP/XML API for newsletter and email marketing for associations.
 * Base URL: https://partner.informz.net/aapi/InformzService.svc
 *
 * Auth: Username + Password + Brand ID (validated against IP whitelist)
 * Format: XML ActionRequest / GridRequest via single PostInformzMessage endpoint
 *
 * Setup: user provides username, password, brandId in Settings.
 * IP whitelist: Railway static IP or proxy needed.
 */

const logger = require('../lib/logger');

const ENDPOINTS = {
  us: 'https://partner.informz.net/aapi/InformzService.svc',
  ca: 'https://partner.informz.ca/aapi/InformzService.svc',
  test: 'https://partnertest.informz.net/aapi/InformzService.svc',
};

/**
 * Build the XML auth header for Informz requests.
 */
function buildAuthXml(creds) {
  return `<Username>${escapeXml(creds.username)}</Username>
<Password>${escapeXml(creds.password)}</Password>
<BrandId>${escapeXml(String(creds.brandId))}</BrandId>`;
}

/**
 * Send an ActionRequest to Informz.
 */
async function actionRequest(creds, actionXml) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<ActionRequest>
  ${buildAuthXml(creds)}
  ${actionXml}
</ActionRequest>`;

  return postMessage(creds, xml);
}

/**
 * Send a GridRequest to Informz.
 */
async function gridRequest(creds, gridXml) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<GridRequest>
  ${buildAuthXml(creds)}
  ${gridXml}
</GridRequest>`;

  return postMessage(creds, xml);
}

/**
 * Core: POST to the single Informz endpoint.
 */
async function postMessage(creds, xmlBody) {
  const endpoint = ENDPOINTS[creds.region || 'us'];

  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns="http://informz.com/aapi/">
  <soap:Body>
    <ns:PostInformzMessage>
      <ns:sXml>${escapeXml(xmlBody)}</ns:sXml>
    </ns:PostInformzMessage>
  </soap:Body>
</soap:Envelope>`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': 'http://informz.com/aapi/IInformzService/PostInformzMessage',
    },
    body: soapEnvelope,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Informz API ${res.status}: ${text.slice(0, 200)}`);
  }

  const responseText = await res.text();
  return parseResponse(responseText);
}

// ── High-level operations ──

/**
 * Create and schedule a mailing (newsletter).
 */
async function createMailing(creds, { subject, htmlBody, listId, scheduledDate }) {
  const scheduleXml = scheduledDate
    ? `<ScheduleDate>${scheduledDate}</ScheduleDate>`
    : `<ScheduleDate>${new Date().toISOString()}</ScheduleDate>`;

  const xml = `<Action>CreateMailing</Action>
<Parameters>
  <Subject>${escapeXml(subject)}</Subject>
  <HTMLBody>${escapeXml(htmlBody)}</HTMLBody>
  <TargetId>${listId || ''}</TargetId>
  ${scheduleXml}
</Parameters>`;

  return actionRequest(creds, xml);
}

/**
 * Create a message/template (MD2).
 */
async function createMessage(creds, { name, subject, htmlBody, textBody }) {
  const xml = `<Action>CreateMessage</Action>
<Parameters>
  <Name>${escapeXml(name)}</Name>
  <Subject>${escapeXml(subject)}</Subject>
  <HTMLBody>${escapeXml(htmlBody)}</HTMLBody>
  <TextBody>${escapeXml(textBody || '')}</TextBody>
</Parameters>`;

  return actionRequest(creds, xml);
}

/**
 * Bulk upload subscribers.
 */
async function bulkUpload(creds, subscribers) {
  // subscribers = [{ email, firstName, lastName, ... }]
  const rows = subscribers.map(s => `<Row>
    <Email>${escapeXml(s.email)}</Email>
    ${s.firstName ? `<FirstName>${escapeXml(s.firstName)}</FirstName>` : ''}
    ${s.lastName ? `<LastName>${escapeXml(s.lastName)}</LastName>` : ''}
    ${s.company ? `<Company>${escapeXml(s.company)}</Company>` : ''}
  </Row>`).join('\n');

  const xml = `<Action>BulkUpload</Action>
<Parameters>
  <Data>
    ${rows}
  </Data>
</Parameters>`;

  return actionRequest(creds, xml);
}

/**
 * Subscribe a single contact.
 */
async function subscribe(creds, { email, firstName, lastName }) {
  const xml = `<Action>Subscribe</Action>
<Parameters>
  <Email>${escapeXml(email)}</Email>
  ${firstName ? `<FirstName>${escapeXml(firstName)}</FirstName>` : ''}
  ${lastName ? `<LastName>${escapeXml(lastName)}</LastName>` : ''}
</Parameters>`;

  return actionRequest(creds, xml);
}

/**
 * Unsubscribe a contact.
 */
async function unsubscribe(creds, { email }) {
  const xml = `<Action>Unsubscribe</Action>
<Parameters>
  <Email>${escapeXml(email)}</Email>
</Parameters>`;

  return actionRequest(creds, xml);
}

// ── Grid requests (read data) ──

/**
 * Get mailing activity (opens, clicks, bounces).
 */
async function getMailingActivity(creds, { mailingId }) {
  const xml = `<Grid>SubscriberMailingActivity</Grid>
<Parameters>
  <MailingId>${mailingId}</MailingId>
</Parameters>`;

  return gridRequest(creds, xml);
}

/**
 * Get subscriber list.
 */
async function getSubscribers(creds, { page = 1, pageSize = 100 } = {}) {
  const xml = `<Grid>Subscribers</Grid>
<Parameters>
  <Page>${page}</Page>
  <PageSize>${pageSize}</PageSize>
</Parameters>`;

  return gridRequest(creds, xml);
}

/**
 * Get mailing opens.
 */
async function getMailingOpens(creds, { mailingId }) {
  const xml = `<Grid>MailingActivityOpens</Grid>
<Parameters>
  <MailingId>${mailingId}</MailingId>
</Parameters>`;

  return gridRequest(creds, xml);
}

/**
 * Get mailing bounces.
 */
async function getMailingBounces(creds, { mailingId }) {
  const xml = `<Grid>MailingActivityBounces</Grid>
<Parameters>
  <MailingId>${mailingId}</MailingId>
</Parameters>`;

  return gridRequest(creds, xml);
}

/**
 * Get engagement/lead scores.
 */
async function getEngagementScores(creds) {
  const xml = `<Grid>EngagementAndLeadScores</Grid>
<Parameters></Parameters>`;

  return gridRequest(creds, xml);
}

/**
 * Get campaigns list.
 */
async function getCampaigns(creds) {
  const xml = `<Grid>Campaigns</Grid>
<Parameters></Parameters>`;

  return gridRequest(creds, xml);
}

/**
 * Get mailings list.
 */
async function getMailings(creds) {
  const xml = `<Grid>Mailings</Grid>
<Parameters></Parameters>`;

  return gridRequest(creds, xml);
}

/**
 * Get message templates (MD2) from Informz.
 */
async function getTemplates(creds) {
  const xml = `<Grid>Messages</Grid>
<Parameters></Parameters>`;

  return gridRequest(creds, xml);
}

/**
 * Create a mailing using an existing template.
 */
async function createMailingFromTemplate(creds, { templateId, subject, listId, scheduledDate, contentOverrides }) {
  const overridesXml = contentOverrides
    ? Object.entries(contentOverrides).map(([key, val]) => `<${key}>${escapeXml(val)}</${key}>`).join('\n')
    : '';

  const xml = `<Action>CreateMailingFromTemplate</Action>
<Parameters>
  <TemplateId>${templateId}</TemplateId>
  <Subject>${escapeXml(subject)}</Subject>
  <TargetId>${listId || ''}</TargetId>
  <ScheduleDate>${scheduledDate || new Date().toISOString()}</ScheduleDate>
  ${overridesXml}
</Parameters>`;

  return actionRequest(creds, xml);
}

/**
 * Get subscriber lists/target groups.
 */
async function getTargetGroups(creds) {
  const xml = `<Grid>InterestTargetGroup</Grid>
<Parameters></Parameters>`;

  return gridRequest(creds, xml);
}

/**
 * Test connection.
 */
async function testConnection(creds) {
  try {
    const result = await getMailings(creds);
    return { valid: true, data: result };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

// ── Helpers ──

function escapeXml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseResponse(xml) {
  // Basic XML response parsing · extract result from SOAP envelope
  // For production, use a proper XML parser (xml2js)
  const resultMatch = xml.match(/<PostInformzMessageResult>([\s\S]*?)<\/PostInformzMessageResult>/);
  if (!resultMatch) {
    // Try to extract error
    const errorMatch = xml.match(/<faultstring>([\s\S]*?)<\/faultstring>/);
    if (errorMatch) throw new Error(`Informz error: ${errorMatch[1]}`);
    return { raw: xml };
  }

  const resultXml = resultMatch[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');

  // Try to extract rows for grid responses
  const rows = [];
  const rowMatches = resultXml.matchAll(/<Row>([\s\S]*?)<\/Row>/g);
  for (const m of rowMatches) {
    const row = {};
    const fieldMatches = m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g);
    for (const fm of fieldMatches) {
      row[fm[1]] = fm[2];
    }
    rows.push(row);
  }

  if (rows.length > 0) return { rows };

  // Try to extract success/error status
  const statusMatch = resultXml.match(/<Status>([\s\S]*?)<\/Status>/);
  const messageMatch = resultXml.match(/<Message>([\s\S]*?)<\/Message>/);
  const idMatch = resultXml.match(/<Id>([\s\S]*?)<\/Id>/);

  return {
    status: statusMatch?.[1] || 'unknown',
    message: messageMatch?.[1] || '',
    id: idMatch?.[1] || null,
    raw: resultXml,
  };
}

module.exports = {
  createMailing,
  createMailingFromTemplate,
  createMessage,
  bulkUpload,
  subscribe,
  unsubscribe,
  getMailingActivity,
  getSubscribers,
  getMailingOpens,
  getMailingBounces,
  getEngagementScores,
  getCampaigns,
  getMailings,
  getTemplates,
  getTargetGroups,
  testConnection,
};
