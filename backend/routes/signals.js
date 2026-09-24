/**
 * Signal Routes · Signal-based prospecting
 *
 * GET    /api/signals · List detected signals (with filters)
 * GET    /api/signals/configs · List signal configs
 * POST   /api/signals/configs · Create a signal config
 * PATCH  /api/signals/configs/:id · Update config
 * DELETE /api/signals/configs/:id · Delete config
 * POST   /api/signals/:id/action · Take action on a signal (add to CRM, email, dismiss)
 * POST   /api/signals/scan · Manually trigger signal scan
 */

const { Router } = require('express');
const db = require('../db');
const logger = require('../lib/logger');

const router = Router();

// GET /api/signals · List signals
router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status || null;
    const signalType = req.query.type || null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);

    let sql = `SELECT * FROM signals WHERE user_id = $1`;
    const params = [req.user.id];

    if (status) {
      params.push(status);
      sql += ` AND status = $${params.length}`;
    }
    if (signalType) {
      params.push(signalType);
      sql += ` AND signal_type = $${params.length}`;
    }

    sql += ` ORDER BY detected_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await db.query(sql, params);

    // Also get counts by status
    const counts = await db.query(
      `SELECT status, COUNT(*) AS count FROM signals WHERE user_id = $1 GROUP BY status`,
      [req.user.id]
    );

    res.json({
      signals: result.rows,
      counts: Object.fromEntries(counts.rows.map(r => [r.status, parseInt(r.count)])),
    });
  } catch (err) { next(err); }
});

/**
 * GET /api/signals/types · la zone Signaux, groupée par TYPE.
 *
 * 320 lignes ne se traitent pas, 7 lignes se traitent. C'est tout le sujet :
 * la liste ligne à ligne offrait une action qui coûtait un email rédigé à la
 * main, multipliée par 320, et personne ne l'a jamais payée une seule fois.
 * Ici chaque type porte son compte et deux sorties, automatiser ou ignorer.
 *
 * Aucun score n'est renvoyé. Un score par signal sert à ordonner une file
 * qu'on traite à la main : le jour où la zone devient un entonnoir de
 * promotion, il n'a plus de consommateur, et il entre en concurrence avec le
 * lead score sur 100 qui existe déjà ailleurs. Les FAITS (source fiable,
 * contact joignable, deal ouvert) restent, eux : ce sont les raisons derrière
 * le score, et ils deviendront le vocabulaire des conditions d'entrée.
 */
router.get('/types', async (req, res, next) => {
  try {
    const catalog = require('../lib/automation-catalog');

    const [rows, ignored, triggers, lastScan] = await Promise.all([
      db.query(`
        SELECT signal_type,
               COUNT(*) FILTER (WHERE status = 'new') AS new_count,
               COUNT(*) FILTER (WHERE status = 'automated') AS automated_count,
               COUNT(*) FILTER (WHERE status = 'skipped') AS skipped_count,
               COUNT(*) AS total_count,
               MAX(detected_at) AS last_detected_at,
               COUNT(DISTINCT company_name) FILTER (WHERE status = 'new') AS company_count
          FROM signals
         WHERE user_id = $1
         GROUP BY signal_type
      `, [req.user.id]).then(r => r.rows),
      db.query(
        `SELECT signal_type FROM signal_type_preferences WHERE user_id = $1`,
        [req.user.id]
      ).then(r => r.rows.map(x => x.signal_type)),
      db.query(`
        SELECT a.event_key, a.id, a.status, w.name AS workflow_name
          FROM automation_triggers a
          JOIN workflows w ON w.id = a.workflow_id
         WHERE a.user_id = $1 AND a.event_source = 'signal'
      `, [req.user.id]).then(r => r.rows),
      db.query(
        `SELECT MAX(last_run) AS last_run FROM signal_configs WHERE user_id = $1`,
        [req.user.id]
      ).then(r => r.rows[0]?.last_run || null),
    ]);

    // Les trois sociétés à montrer par type, les plus récentes d'abord.
    const companies = await db.query(`
      SELECT signal_type, company_name FROM (
        SELECT signal_type, company_name, detected_at,
               ROW_NUMBER() OVER (PARTITION BY signal_type ORDER BY detected_at DESC) AS rn
          FROM (SELECT DISTINCT ON (signal_type, company_name)
                       signal_type, company_name, detected_at
                  FROM signals
                 WHERE user_id = $1 AND status = 'new' AND company_name IS NOT NULL
                 ORDER BY signal_type, company_name, detected_at DESC) d
      ) t WHERE rn <= 3
    `, [req.user.id]);

    const byType = new Map(rows.map(r => [r.signal_type, r]));
    const cosByType = new Map();
    for (const c of companies.rows) {
      if (!cosByType.has(c.signal_type)) cosByType.set(c.signal_type, []);
      cosByType.get(c.signal_type).push(c.company_name);
    }
    const trigByType = new Map(triggers.filter(t => t.status !== 'draft').map(t => [t.event_key, t]));

    const build = (signalType) => {
      const r = byType.get(signalType) || {};
      const trig = trigByType.get(signalType) || null;
      return {
        signalType,
        family: catalog.familyOfSignalType(signalType),
        newCount: parseInt(r.new_count, 10) || 0,
        automatedCount: parseInt(r.automated_count, 10) || 0,
        skippedCount: parseInt(r.skipped_count, 10) || 0,
        totalCount: parseInt(r.total_count, 10) || 0,
        companyCount: parseInt(r.company_count, 10) || 0,
        companies: cosByType.get(signalType) || [],
        lastDetectedAt: r.last_detected_at || null,
        ignored: ignored.includes(signalType),
        automated: trig ? { triggerId: trig.id, workflowName: trig.workflow_name, status: trig.status } : null,
      };
    };

    // Les types déjà détectés d'abord, puis ceux que la veille sait produire
    // mais qui n'ont encore rien remonté : un type à zéro est une information,
    // pas une ligne à cacher.
    const veille = catalog.VEILLE_SIGNAL_TYPES.map(build);
    const crm = catalog.CRM_SIGNAL_TYPES.map(build);

    res.json({
      lastScanAt: lastScan,
      totalNew: veille.concat(crm)
        .filter(t => !t.ignored && !t.automated)
        .reduce((a, t) => a + t.newCount, 0),
      families: [
        { key: catalog.FAMILY_VEILLE, types: veille },
        { key: catalog.FAMILY_CRM, types: crm },
      ],
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/signals/types/:type/ignore · « Ignorer ce type ».
 *
 * Une vraie décision, qui fait tomber le compteur d'un coup. Aujourd'hui,
 * ignorer un signal consiste à ne pas cliquer : ça ressemble à du retard alors
 * que c'est souvent un arbitrage correct.
 */
router.post('/types/:type/ignore', async (req, res, next) => {
  try {
    const catalog = require('../lib/automation-catalog');
    const signalType = req.params.type;
    if (!catalog.VEILLE_SIGNAL_TYPES.includes(signalType)
        && !catalog.CRM_SIGNAL_TYPES.includes(signalType)) {
      return res.status(400).json({ error: 'Type de signal inconnu' });
    }

    await db.query(
      `INSERT INTO signal_type_preferences (user_id, signal_type) VALUES ($1, $2)
       ON CONFLICT (user_id, signal_type) DO NOTHING`,
      [req.user.id, signalType]
    );
    // Les signaux en attente sortent de la vue, sans disparaître : ils restent
    // consultables comme trace, et la décision est réversible.
    const r = await db.query(
      `UPDATE signals SET status = 'ignored_type'
        WHERE user_id = $1 AND signal_type = $2 AND status = 'new'`,
      [req.user.id, signalType]
    );
    res.json({ ok: true, hidden: r.rowCount });
  } catch (err) { next(err); }
});

router.delete('/types/:type/ignore', async (req, res, next) => {
  try {
    await db.query(
      `DELETE FROM signal_type_preferences WHERE user_id = $1 AND signal_type = $2`,
      [req.user.id, req.params.type]
    );
    const r = await db.query(
      `UPDATE signals SET status = 'new'
        WHERE user_id = $1 AND signal_type = $2 AND status = 'ignored_type'`,
      [req.user.id, req.params.type]
    );
    res.json({ ok: true, restored: r.rowCount });
  } catch (err) { next(err); }
});

/**
 * GET /api/signals/types/:type/ids · tous les identifiants en attente d'un type.
 *
 * « Tout sélectionner » doit vouloir dire les 124, pas les 50 affichés. Sans
 * cet appel, l'utilisateur coche une case en croyant armer son stock entier et
 * n'en inscrit qu'une page : l'écart entre ce qu'il a vu et ce qui est parti
 * est exactement le genre d'erreur qu'on ne rattrape pas.
 */
router.get('/types/:type/ids', async (req, res, next) => {
  try {
    const r = await db.query(
      `SELECT id FROM signals
        WHERE user_id = $1 AND signal_type = $2 AND status = 'new'
        ORDER BY detected_at DESC`,
      [req.user.id, req.params.type]
    );
    res.json({ ids: r.rows.map(x => x.id) });
  } catch (err) { next(err); }
});

/** Ignorer une sélection de signaux, sans toucher au type. */
router.post('/dismiss', async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids is required' });
    const r = await db.query(
      `UPDATE signals SET status = 'dismissed', actioned_at = now()
        WHERE user_id = $1 AND id = ANY($2::uuid[]) AND status = 'new'`,
      [req.user.id, ids]
    );
    res.json({ ok: true, dismissed: r.rowCount });
  } catch (err) { next(err); }
});

// GET /api/signals/preferences · Cadence de la veille automatique
router.get('/preferences', async (req, res, next) => {
  try {
    const r = await db.query(`SELECT signal_scan_frequency FROM users WHERE id = $1`, [req.user.id]);
    res.json({ frequency: r.rows[0]?.signal_scan_frequency || 'weekly' });
  } catch (err) { next(err); }
});

// PUT /api/signals/preferences · Choix de cadence (off = scan manuel uniquement)
router.put('/preferences', async (req, res, next) => {
  try {
    const { frequency } = req.body;
    if (!['off', 'weekly', 'daily'].includes(frequency)) {
      return res.status(400).json({ error: 'frequency must be off, weekly or daily' });
    }
    await db.query(`UPDATE users SET signal_scan_frequency = $1 WHERE id = $2`, [frequency, req.user.id]);
    res.json({ frequency });
  } catch (err) { next(err); }
});

// GET /api/signals/configs · List configs
router.get('/configs', async (req, res, next) => {
  try {
    const result = await db.query(
      `SELECT * FROM signal_configs WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ configs: result.rows });
  } catch (err) { next(err); }
});

// POST /api/signals/configs · Create config
/**
 * Une config doit pouvoir produire une requête qui veut dire quelque chose.
 *
 * Les requêtes sont construites à partir des secteurs et des mots-clés
 * (lib/agents/signal-agent.js, SIGNAL_QUERIES) : sans eux, « Levée de fonds »
 * partait chercher `( ) (funding OR raised OR ...)` sur tout le web. Du bruit,
 * et un quota Brave consommé pour rien. Le type « Concurrent », lui, ne
 * produit aucune requête du tout sans liste de concurrents.
 */
function validateConfigFocus({ signalTypes, targetSectors, targetKeywords, targetCompetitors }) {
  const types = Array.isArray(signalTypes) && signalTypes.length ? signalTypes : ['funding', 'hiring', 'news'];
  const hasFocus = (targetSectors || []).some(s => String(s).trim())
    || (targetKeywords || []).some(s => String(s).trim());
  const hasCompetitors = (targetCompetitors || []).some(s => String(s).trim());

  const webTypes = types.filter(t => t !== 'competitor');
  if (webTypes.length > 0 && !hasFocus) {
    return {
      code: 'config_needs_focus',
      error: 'Renseignez au moins un secteur ou un mot-clé : sans eux, la recherche part sur tout le web.',
    };
  }
  if (types.includes('competitor') && !hasCompetitors) {
    return {
      code: 'config_needs_competitors',
      error: 'Le type « Concurrent » demande au moins un concurrent à suivre, sinon il ne lance aucune recherche.',
    };
  }
  return null;
}

router.post('/configs', async (req, res, next) => {
  try {
    const { name, signalTypes, targetSectors, targetTitles, targetCompanySizes, targetKeywords, targetCompetitors, frequency } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const invalid = validateConfigFocus({ signalTypes, targetSectors, targetKeywords, targetCompetitors });
    if (invalid) return res.status(400).json(invalid);

    const result = await db.query(`
      INSERT INTO signal_configs (user_id, name, signal_types, target_sectors, target_titles, target_company_sizes, target_keywords, target_competitors, frequency)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `, [
      req.user.id, name,
      signalTypes || ['funding', 'hiring', 'news'],
      targetSectors || [],
      targetTitles || [],
      targetCompanySizes || [],
      targetKeywords || [],
      targetCompetitors || [],
      frequency || 'daily',
    ]);

    res.json({ config: result.rows[0] });
  } catch (err) { next(err); }
});

// PATCH /api/signals/configs/:id
router.patch('/configs/:id', async (req, res, next) => {
  try {
    const { name, signalTypes, targetSectors, targetTitles, targetKeywords, targetCompetitors, enabled, frequency } = req.body;

    // Une modification ne doit pas pouvoir vider ce qui donnait son sens à la
    // recherche : on valide la config telle qu'elle sera après la mise à jour,
    // pas seulement les champs envoyés.
    const touchesFocus = [signalTypes, targetSectors, targetKeywords, targetCompetitors].some(v => v !== undefined);
    if (touchesFocus) {
      const current = await db.query(
        `SELECT signal_types, target_sectors, target_keywords, target_competitors
           FROM signal_configs WHERE id = $1 AND user_id = $2`,
        [req.params.id, req.user.id]
      );
      if (!current.rows[0]) return res.status(404).json({ error: 'Config not found' });
      const merged = {
        signalTypes: signalTypes !== undefined ? signalTypes : current.rows[0].signal_types,
        targetSectors: targetSectors !== undefined ? targetSectors : current.rows[0].target_sectors,
        targetKeywords: targetKeywords !== undefined ? targetKeywords : current.rows[0].target_keywords,
        targetCompetitors: targetCompetitors !== undefined ? targetCompetitors : current.rows[0].target_competitors,
      };
      const invalid = validateConfigFocus(merged);
      if (invalid) return res.status(400).json(invalid);
    }

    const sets = [];
    const values = [];
    let i = 1;

    if (name !== undefined) { sets.push(`name = $${i++}`); values.push(name); }
    if (signalTypes !== undefined) { sets.push(`signal_types = $${i++}`); values.push(signalTypes); }
    if (targetSectors !== undefined) { sets.push(`target_sectors = $${i++}`); values.push(targetSectors); }
    if (targetTitles !== undefined) { sets.push(`target_titles = $${i++}`); values.push(targetTitles); }
    if (targetKeywords !== undefined) { sets.push(`target_keywords = $${i++}`); values.push(targetKeywords); }
    if (targetCompetitors !== undefined) { sets.push(`target_competitors = $${i++}`); values.push(targetCompetitors); }
    if (enabled !== undefined) { sets.push(`enabled = $${i++}`); values.push(enabled); }
    if (frequency !== undefined) { sets.push(`frequency = $${i++}`); values.push(frequency); }
    if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    values.push(req.params.id, req.user.id);
    const result = await db.query(
      `UPDATE signal_configs SET ${sets.join(', ')} WHERE id = $${i++} AND user_id = $${i} RETURNING *`,
      values
    );

    res.json({ config: result.rows[0] });
  } catch (err) { next(err); }
});

// DELETE /api/signals/configs/:id
router.delete('/configs/:id', async (req, res, next) => {
  try {
    await db.query(`DELETE FROM signal_configs WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/signals/:id/action · Take action on a signal
router.post('/:id/action', async (req, res, next) => {
  try {
    const { action } = req.body; // add_to_crm, send_email, add_to_lemlist, dismiss
    const signal = await db.query(`SELECT * FROM signals WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    if (!signal.rows[0]) return res.status(404).json({ error: 'Signal not found' });
    const s = signal.rows[0];

    let opportunityId = null;

    if (action === 'add_to_crm') {
      // Create opportunity from signal
      const opp = await db.opportunities.create({
        userId: req.user.id,
        name: s.contact_name || s.company_name || 'Unknown',
        email: s.contact_email || null,
        title: s.contact_title || null,
        company: s.company_name || null,
        status: 'new',
        linkedinUrl: s.contact_linkedin || null,
      });
      opportunityId = opp.id;
    } else if (action === 'send_email' && s.contact_email) {
      // Generate and queue a personalized email
      const claude = require('../api/claude');
      const prompt = `Generate a short, personal outreach email based on this signal.

Signal: ${s.title}
Context: ${s.description}
Contact: ${s.contact_name || 'Decision maker'} (${s.contact_title || ''}) at ${s.company_name || ''}
Signal type: ${s.signal_type}

Write a 4-5 line email that references the signal naturally (don't say "I saw a signal").
Be specific and relevant.
${require('../lib/human-style').HUMAN_STYLE_RULES}
Return JSON: { "subject": "...", "body": "..." }`;

      const result = await claude.callClaude('Return only valid JSON.', prompt, 500, 'signal_outreach');
      let email = result.parsed;
      if (!email) {
        const m = (result.content || '').match(/\{[\s\S]*"subject"[\s\S]*"body"[\s\S]*\}/);
        if (m) email = JSON.parse(m[0]);
      }

      if (email?.subject && email?.body) {
        const { sendNurtureEmail } = require('../lib/email-outbound');
        await sendNurtureEmail(req.user.id, {
          to: s.contact_email,
          toName: s.contact_name,
          subject: email.subject,
          body: email.body,
        });
      }
    }

    // Update signal status
    await db.query(
      `UPDATE signals SET status = $1, action_taken = $2, opportunity_id = $3, actioned_at = now() WHERE id = $4`,
      [action === 'dismiss' ? 'dismissed' : 'actioned', action, opportunityId, s.id]
    );

    res.json({ ok: true, action, opportunityId });
  } catch (err) { next(err); }
});

// POST /api/signals/scan · Manual signal scan
// POST /api/signals/scan · le bouton « Scanner »
//
// Il ne lançait que les surveillances configurées, et répondait « 0 signal
// détecté » quand il n'y en avait aucune : l'utilisateur croyait avoir cherché.
// Or la majorité des signaux en production vient de l'autre moteur, la
// surveillance des comptes du CRM (source `crm_watch`), qui ne tournait qu'au
// cron. Le bouton lance désormais les deux et dit ce qu'il a réellement fait.
// Plafond du lancement manuel, en sociétés du CRM. Chaque société coûte une
// recherche Brave et une extraction Claude, soit une poignée de secondes :
// au delà, on ferait patienter une minute devant un bouton.
const MANUAL_CRM_COMPANIES = 5;

router.post('/scan', async (req, res, next) => {
  try {
    const { run, runCrmWatch } = require('../lib/agents/signal-agent');
    const { getRemainingBudget, consumeBudget } = require('../lib/signal-scheduler');

    // Le quota Brave est partagé avec le scheduler continu : un clic le débite
    // au même endroit, et s'arrête quand il ne reste rien pour la journée.
    let remaining = await getRemainingBudget().catch(() => null);
    const budgetExhausted = remaining !== null && remaining <= 0;

    const fromConfigs = budgetExhausted
      ? { detected: 0, configs: 0, queries: 0, errors: [] }
      : await run(req.user.id);

    if (remaining !== null) remaining -= (fromConfigs.queries || 0);

    // Lancement manuel : on ignore la rotation hebdomadaire par société (elle
    // sert à étaler le quota sur la semaine, pas à faire attendre quelqu'un qui
    // vient de cliquer).
    const crmLimit = remaining === null
      ? MANUAL_CRM_COMPANIES
      : Math.max(0, Math.min(MANUAL_CRM_COMPANIES, remaining));
    const crm = crmLimit > 0
      ? await runCrmWatch(req.user.id, { ignoreDayBucket: true, limit: crmLimit })
      : { detected: 0, companiesScanned: 0, errors: [] };

    const queriesUsed = (fromConfigs.queries || 0) + (crm.companiesScanned || 0);
    if (queriesUsed > 0) await consumeBudget(queriesUsed).catch(() => {});

    res.json({
      detected: (fromConfigs.detected || 0) + (crm.detected || 0),
      configs: fromConfigs.configs || 0,
      fromConfigs: fromConfigs.detected || 0,
      fromCrm: crm.detected || 0,
      companiesScanned: crm.companiesScanned || 0,
      queriesUsed,
      budgetExhausted,
      // Ni surveillance configurée, ni société à vérifier : il n'y avait rien
      // à chercher, ce n'est pas un scan à zéro résultat.
      nothingToScan: !budgetExhausted
        && (fromConfigs.configs || 0) === 0
        && (crm.companiesScanned || 0) === 0,
      errors: [...(fromConfigs.errors || []), ...(crm.errors || [])],
    });
  } catch (err) { next(err); }
});

// POST /api/signals/:id/linkedin-outreach · Send LinkedIn connection from signal
router.post('/:id/linkedin-outreach', async (req, res, next) => {
  try {
    const signal = await db.query(`SELECT * FROM signals WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    if (!signal.rows[0]) return res.status(404).json({ error: 'Signal not found' });
    const s = signal.rows[0];
    if (!s.contact_linkedin) return res.status(400).json({ error: 'No LinkedIn URL for this contact' });

    const { getUserKey } = require('../config');
    const cookie = await getUserKey(req.user.id, 'linkedin');
    if (!cookie) return res.status(400).json({ error: 'LinkedIn not connected. Add your li_at cookie in Settings.' });

    const linkedin = require('../api/linkedin');
    const claude = require('../api/claude');

    // Generate note
    const noteResult = await claude.callClaude('Return only valid JSON.', `Write a LinkedIn connection note (max 280 chars).
Signal: ${s.title}. Contact: ${s.contact_name} at ${s.company_name}.
Be specific, reference the signal naturally. Never use em dashes (  ); write like a busy human, no AI-sounding phrasing. Return JSON: { "note": "..." }`, 300, 'linkedin_note');

    let note = noteResult.parsed?.note || `Bonjour, votre profil a retenu mon attention. Curieux d'échanger.`;
    const publicId = s.contact_linkedin.match(/\/in\/([^/?]+)/)?.[1];
    if (!publicId) return res.status(400).json({ error: 'Invalid LinkedIn URL' });

    await linkedin.sendConnectionRequest(cookie, { profileUrn: publicId, message: note.slice(0, 300) }, req.user.id);

    await db.query(
      `INSERT INTO linkedin_outreach (user_id, signal_id, type, linkedin_url, message, status) VALUES ($1, $2, 'connection', $3, $4, 'sent')`,
      [req.user.id, s.id, s.contact_linkedin, note]
    );
    await db.query(`UPDATE signals SET status = 'actioned', action_taken = 'linkedin_connect', actioned_at = now() WHERE id = $1`, [s.id]);

    res.json({ ok: true, note });
  } catch (err) { next(err); }
});

// GET /api/signals/linkedin/status · LinkedIn connection status + daily counts
router.get('/linkedin/status', async (req, res, next) => {
  try {
    const { getUserKey } = require('../config');
    const cookie = await getUserKey(req.user.id, 'linkedin');
    if (!cookie) return res.json({ connected: false });

    const linkedin = require('../api/linkedin');
    const counts = linkedin.getDailyCounts(req.user.id);

    // Cookie exists = connected (skip live test · LinkedIn blocks datacenter IPs)
    res.json({ connected: true, name: 'LinkedIn', counts });
  } catch (err) { next(err); }
});

// GET /api/signals/stats · Signal dashboard KPIs
router.get('/stats', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE status = 'new') AS pending,
        COUNT(*) FILTER (WHERE status = 'actioned') AS actioned,
        COUNT(*) FILTER (WHERE status = 'dismissed') AS dismissed,
        COUNT(*) FILTER (WHERE detected_at > now() - interval '7 days') AS this_week,
        COUNT(*) FILTER (WHERE detected_at > now() - interval '7 days' AND status = 'actioned') AS actioned_this_week,
        ROUND(AVG(relevance_score) FILTER (WHERE status = 'new'), 1) AS avg_relevance,
        COUNT(DISTINCT company_name) FILTER (WHERE detected_at > now() - interval '30 days') AS unique_companies_30d
      FROM signals WHERE user_id = $1
    `, [req.user.id]);

    // Top signal types
    const byType = await db.query(`
      SELECT signal_type, COUNT(*) AS count,
        COUNT(*) FILTER (WHERE status = 'actioned') AS actioned
      FROM signals WHERE user_id = $1 AND detected_at > now() - interval '30 days'
      GROUP BY signal_type ORDER BY count DESC
    `, [req.user.id]);

    // Weekly trend (last 8 weeks)
    const trend = await db.query(`
      SELECT TO_CHAR(detected_at, 'YYYY-"W"IW') AS week, COUNT(*) AS count
      FROM signals WHERE user_id = $1 AND detected_at > now() - interval '8 weeks'
      GROUP BY 1 ORDER BY 1
    `, [req.user.id]);

    res.json({
      kpis: result.rows[0] || {},
      byType: byType.rows,
      weeklyTrend: trend.rows,
    });
  } catch (err) { next(err); }
});

// GET /api/signals/company/:name · Signal history for a company
router.get('/company/:name', async (req, res, next) => {
  try {
    const result = await db.query(`
      SELECT id, signal_type, title, description, source_url, relevance_score,
             contact_name, contact_title, contact_email, contact_linkedin,
             status, action_taken, detected_at
      FROM signals
      WHERE user_id = $1 AND LOWER(company_name) = LOWER($2)
      ORDER BY detected_at DESC LIMIT 50
    `, [req.user.id, req.params.name]);

    // Get CRM contacts for this company
    const contacts = await db.query(
      `SELECT id, name, email, title, status, churn_score, deal_value FROM opportunities
       WHERE user_id = $1 AND LOWER(company) = LOWER($2)`,
      [req.user.id, req.params.name]
    );

    res.json({
      companyName: req.params.name,
      signals: result.rows,
      contacts: contacts.rows,
    });
  } catch (err) { next(err); }
});

// POST /api/signals/:id/create-sequence · Create a mini outreach sequence from a signal
router.post('/:id/create-sequence', async (req, res, next) => {
  try {
    const signal = await db.query(`SELECT * FROM signals WHERE id = $1 AND user_id = $2`, [req.params.id, req.user.id]);
    if (!signal.rows[0]) return res.status(404).json({ error: 'Signal not found' });
    const s = signal.rows[0];

    const claude = require('../api/claude');
    const prompt = `Create a 3-step outreach sequence for this prospect based on the detected signal.

Signal: ${s.title}
Context: ${s.description || ''}
Contact: ${s.contact_name || 'Decision maker'} (${s.contact_title || ''}) at ${s.company_name || ''}
Signal type: ${s.signal_type}

Generate 3 touchpoints:
- E1 (Day 0): Initial email referencing the signal
- E2 (Day 3): Follow-up with value proposition
- E3 (Day 7): Break-up email

Each email: personal tone, max 5 lines, reference the signal naturally.
${require('../lib/human-style').HUMAN_STYLE_RULES}
Return JSON:
{
  "name": "Campaign name",
  "steps": [
    { "step": "E1", "timing": "J+0", "subject": "...", "body": "..." },
    { "step": "E2", "timing": "J+3", "subject": "...", "body": "..." },
    { "step": "E3", "timing": "J+7", "subject": "...", "body": "..." }
  ]
}`;

    const result = await claude.callClaude('Return only valid JSON.', prompt, 1200, 'signal_sequence');
    let sequence = result.parsed;
    if (!sequence) {
      const m = (result.content || '').match(/\{[\s\S]*"name"[\s\S]*"steps"[\s\S]*\}/);
      if (m) sequence = JSON.parse(m[0]);
    }

    if (!sequence?.steps?.length) {
      return res.status(500).json({ error: 'Could not generate sequence' });
    }

    // E1 part dans la file d'approbation nurture si le contact a un email · 
    // avec la dédup standard (7 jours création / 2 heures envoi).
    let queuedEmailId = null;
    if (s.contact_email) {
      const e1 = sequence.steps[0];
      const dup = await db.query(
        `SELECT id FROM nurture_emails
         WHERE user_id = $1 AND LOWER(to_email) = LOWER($2)
           AND (created_at > now() - interval '7 days' OR sent_at > now() - interval '2 hours')
         LIMIT 1`,
        [req.user.id, s.contact_email]
      );
      if (dup.rows.length === 0 && e1?.subject && e1?.body) {
        const inserted = await db.query(
          `INSERT INTO nurture_emails (user_id, to_email, to_name, subject, body, status, metadata)
           VALUES ($1, $2, $3, $4, $5, 'pending', $6)
           RETURNING id`,
          [req.user.id, s.contact_email, s.contact_name || null, e1.subject, e1.body,
           JSON.stringify({ chain: 'signal_sequence', signal_id: s.id, step: e1.step, timing: e1.timing })]
        );
        queuedEmailId = inserted.rows[0].id;
      }
    }

    // La séquence est persistée sur le signal AVANT de le marquer actioned :
    // un signal actioned sans trace de ce qui a été créé était un mensonge.
    await db.query(
      `UPDATE signals SET sequence = $1, status = 'actioned', action_taken = 'sequence_created', actioned_at = now() WHERE id = $2`,
      [JSON.stringify(sequence), s.id]
    );

    res.json({ sequence, signal: s, queuedEmailId });
  } catch (err) { next(err); }
});

module.exports = router;
