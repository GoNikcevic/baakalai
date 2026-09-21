/**
 * Extension API · Lightweight endpoints for the Chrome extension.
 *
 * GET  /api/ext/contact?linkedin=... · Get contact by LinkedIn URL (with notes, campaigns, patterns)
 * POST /api/ext/contact/:id/note · Add a note to a contact
 * POST /api/ext/contact/enrich · Create/update contact with enriched profile data
 * POST /api/ext/quick-email · Send quick email to a contact
 */

const { Router } = require('express');
const db = require('../db');
const logger = require('../lib/logger');

const router = Router();

// GET /api/ext/contact?linkedin=<url> · Full contact card for extension overlay
router.get('/contact', async (req, res, next) => {
  try {
    const { linkedin } = req.query;
    if (!linkedin) return res.status(400).json({ error: 'linkedin parameter required' });

    const opp = await db.opportunities.findByLinkedinUrl(req.user.id, linkedin);
    if (!opp) return res.json({ found: false });

    // Recent nurture emails
    const emails = await db.query(
      `SELECT id, subject, status, sentiment, sent_at, created_at
       FROM nurture_emails
       WHERE (opportunity_id = $1 OR LOWER(to_email) = LOWER($2)) AND status = 'sent'
       ORDER BY sent_at DESC LIMIT 5`,
      [opp.id, opp.email]
    );

    // Active campaigns for this contact
    const campaigns = await db.query(
      `SELECT c.id, c.name, c.status, c.open_rate, c.reply_rate
       FROM campaigns c
       WHERE c.id = $1 OR c.id IN (
         SELECT campaign_id FROM touchpoints t
         JOIN prospect_activities pa ON pa.campaign_id = t.campaign_id
         WHERE pa.lead_email = $2
       )
       ORDER BY c.updated_at DESC LIMIT 5`,
      [opp.campaign_id, opp.email]
    );

    // Notes (stored in data jsonb field)
    const notes = opp.data?.notes || [];

    // Relevant patterns for this contact's sector
    let patterns = [];
    if (opp.company) {
      try {
        const result = await db.query(
          `SELECT id, pattern, confidence, category
           FROM memory_patterns
           WHERE dismissed_at IS NULL AND (confidence = 'Haute' OR applied = true)
           ORDER BY applied DESC, COALESCE(confirmations, 0) DESC
           LIMIT 3`
        );
        patterns = result.rows;
      } catch { /* optional */ }
    }

    res.json({
      found: true,
      contact: {
        id: opp.id,
        name: opp.name,
        email: opp.email,
        title: opp.title,
        company: opp.company,
        companySize: opp.company_size,
        status: opp.status,
        churnScore: opp.churn_score,
        churnFactors: opp.churn_factors,
        linkedinUrl: opp.linkedin_url,
        crmProvider: opp.crm_provider,
        createdAt: opp.created_at,
      },
      notes,
      recentEmails: emails.rows,
      activeCampaigns: campaigns.rows,
      patterns,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/ext/contact/:id/note · Add a CRM note
router.post('/contact/:id/note', async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'text required' });

    const opp = await db.opportunities.get(req.params.id);
    if (!opp) return res.status(404).json({ error: 'Contact not found' });
    if (opp.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

    // Append note to data.notes array
    const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) || {};
    const notes = data.notes || [];
    notes.unshift({
      text: text.trim(),
      author: req.user.name || req.user.email,
      createdAt: new Date().toISOString(),
    });
    data.notes = notes.slice(0, 50); // Keep last 50 notes

    await db.query(
      'UPDATE opportunities SET data = $1 WHERE id = $2',
      [JSON.stringify(data), opp.id]
    );

    res.json({ ok: true, notes: data.notes });
  } catch (err) {
    next(err);
  }
});

// POST /api/ext/contact/enrich · Create or update contact with enriched LinkedIn data
router.post('/contact/enrich', async (req, res, next) => {
  try {
    const { name, title, company, companySize, email, phone, sector, linkedinUrl, location } = req.body;
    if (!linkedinUrl && !email) return res.status(400).json({ error: 'linkedinUrl or email required' });

    // Try to find existing contact
    let opp = linkedinUrl ? await db.opportunities.findByLinkedinUrl(req.user.id, linkedinUrl) : null;
    if (!opp && email) opp = await db.opportunities.findByEmail(req.user.id, email);

    if (opp) {
      // Update with enriched data (only fill missing fields)
      const updates = {};
      if (title && !opp.title) updates.title = title;
      if (company && !opp.company) updates.company = company;
      if (companySize && !opp.company_size) updates.company_size = companySize;
      if (email && !opp.email) updates.email = email;
      if (linkedinUrl && !opp.linkedin_url) updates.linkedin_url = linkedinUrl;

      // Store extra data (phone, sector, location) in data jsonb
      if (phone || sector || location) {
        const data = (typeof opp.data === 'string' ? JSON.parse(opp.data) : opp.data) || {};
        if (phone && !data.phone) data.phone = phone;
        if (sector && !data.sector) data.sector = sector;
        if (location && !data.location) data.location = location;
        updates.data = JSON.stringify(data);
      }

      if (Object.keys(updates).length > 0) {
        await db.opportunities.update(opp.id, updates);
      }
      const updated = await db.opportunities.get(opp.id);
      res.json({ action: 'updated', contact: updated });
    } else {
      // Create new contact
      const newData = {};
      if (phone) newData.phone = phone;
      if (sector) newData.sector = sector;
      if (location) newData.location = location;

      const created = await db.opportunities.create({
        userId: req.user.id,
        name: name || 'Unknown',
        email: email || null,
        title,
        company,
        companySize,
        linkedinUrl,
        status: 'new',
        data: Object.keys(newData).length > 0 ? JSON.stringify(newData) : null,
      });
      res.status(201).json({ action: 'created', contact: created });
    }
  } catch (err) {
    next(err);
  }
});

// POST /api/ext/quick-email · Generate + send a quick email to a contact
router.post('/quick-email', async (req, res, next) => {
  try {
    const { contactId, subject, body } = req.body;
    if (!contactId) return res.status(400).json({ error: 'contactId required' });

    const opp = await db.opportunities.get(contactId);
    if (!opp) return res.status(404).json({ error: 'Contact not found' });
    if (opp.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
    if (!opp.email) return res.status(400).json({ error: 'Contact has no email address' });

    const { sendNurtureEmail } = require('../lib/email-outbound');
    const result = await sendNurtureEmail(req.user.id, {
      opportunityId: opp.id,
      to: opp.email,
      toName: opp.name,
      subject: subject || `Suivi, ${opp.company || opp.name}`,
      body: body || `Bonjour ${(opp.name || '').split(' ')[0]},\n\nJe me permets de revenir vers vous.\n\nBien cordialement`,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
