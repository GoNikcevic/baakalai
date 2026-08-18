/**
 * Priorities — la liste unifiée « À traiter aujourd'hui ».
 *
 * Agrège en une seule liste triée ce que le produit sait recommander,
 * chaque source étant ramenée à un score de priorité commun 0-100 :
 *
 * | Source                        | Score unifié                              |
 * |-------------------------------|-------------------------------------------|
 * | Email nurture en attente      | 55 + 3×jours d'attente (plafonné à 80)    |
 * | Deal stagnant (Deal Coach)    | urgency: high 85 / medium 65 / low 45     |
 * | Upsell (Upsell Detector)      | 20 + 0.7×score brut (plafonné à 88)       |
 * | Risque churn (client won)     | churn_score tel quel (seuil d'entrée 60)  |
 * | Signal externe (status new)   | 0.8×relevance_score (seuil d'entrée 60)   |
 *
 * Logique du barème : un email déjà rédigé qui n'attend qu'un clic vaut plus
 * que fouiller un signal externe incertain, mais moins qu'un deal urgent ; le
 * churn garde son échelle native (déjà 0-100 et calibrée) ; les signaux
 * externes sont décotés de 20 % car non vérifiés.
 *
 * Dédup : un même contact (email, sinon nom+société) peut sortir de plusieurs
 * sources — on garde l'item au score le plus haut et on liste les autres
 * sources dans `alsoFlaggedBy`.
 *
 * Les items Deal Coach / Upsell viennent du dernier run persisté dans
 * strategic_results (cron 9h30, migration 073) — fenêtre 7 jours, on renvoie
 * generatedAt pour que le front affiche l'âge.
 */

const express = require('express');
const router = express.Router();
const db = require('../db');

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ITEMS = 15;

const URGENCY_SCORE = { high: 85, medium: 65, low: 45 };

function contactKey(item) {
  if (item.contactEmail) return item.contactEmail.toLowerCase();
  if (item.contactName) return `${item.contactName}|${item.company || ''}`.toLowerCase();
  return null;
}

async function latestStrategicResult(userId, agent) {
  const r = await db.query(
    `SELECT result, created_at FROM strategic_results
     WHERE user_id = $1 AND agent = $2 AND created_at > now() - interval '7 days'
     ORDER BY created_at DESC LIMIT 1`,
    [userId, agent]
  );
  return r.rows[0] || null;
}

// GET /api/priorities/today
router.get('/today', async (req, res, next) => {
  try {
    const userId = req.user.id;
    const now = Date.now();
    const items = [];

    // 1. Emails nurture en attente d'approbation
    const pending = await db.query(
      `SELECT ne.id, ne.to_email, ne.to_name, ne.subject, ne.created_at, nt.name AS trigger_name
       FROM nurture_emails ne
       LEFT JOIN nurture_triggers nt ON nt.id = ne.trigger_id
       WHERE ne.user_id = $1 AND ne.status = 'pending'
       ORDER BY ne.created_at ASC`,
      [userId]
    );
    for (const e of pending.rows) {
      const daysWaiting = Math.floor((now - new Date(e.created_at).getTime()) / DAY_MS);
      items.push({
        type: 'nurture_approval',
        score: Math.min(80, 55 + 3 * daysWaiting),
        emailId: e.id,
        contactName: e.to_name,
        contactEmail: e.to_email,
        subject: e.subject,
        triggerName: e.trigger_name,
        daysWaiting,
      });
    }

    // 2 + 3. Derniers runs Deal Coach / Upsell persistés
    const [coach, upsell] = await Promise.all([
      latestStrategicResult(userId, 'deal_coach'),
      latestStrategicResult(userId, 'upsell'),
    ]);

    if (coach?.result?.suggestions) {
      for (const s of coach.result.suggestions) {
        items.push({
          type: 'deal_stagnant',
          score: URGENCY_SCORE[s.urgency] || URGENCY_SCORE.medium,
          contactName: s.contactName,
          company: s.company || null,
          reason: s.reason,
          suggestion: s.suggestion,
          action: s.action || 'email',
          generatedAt: coach.created_at,
        });
      }
    }

    if (upsell?.result?.opportunities) {
      for (const o of upsell.result.opportunities) {
        items.push({
          type: 'upsell',
          score: Math.min(88, Math.round(20 + 0.7 * (o.score || 0))),
          contactName: o.name,
          company: o.company || null,
          contactEmail: o.email || null,
          reason: Array.isArray(o.reasons) ? o.reasons.join(' · ') : null,
          generatedAt: upsell.created_at,
        });
      }
    }

    // 4. Clients à risque de churn (échelle native 0-100, seuil 60)
    const churn = await db.query(
      `SELECT id, name, company, email, churn_score, deal_value
       FROM opportunities
       WHERE user_id = $1 AND status = 'won' AND churn_score >= 60
       ORDER BY churn_score DESC LIMIT 10`,
      [userId]
    );
    for (const c of churn.rows) {
      items.push({
        type: 'churn_risk',
        score: Math.min(100, Math.round(c.churn_score)),
        contactName: c.name,
        company: c.company || null,
        contactEmail: c.email || null,
        dealValue: c.deal_value != null ? Number(c.deal_value) : null,
        opportunityId: c.id,
      });
    }

    // 5. Signaux externes récents non traités (décote 20 %)
    const signals = await db.query(
      `SELECT id, title, company_name, contact_name, contact_email, relevance_score, signal_type
       FROM signals
       WHERE user_id = $1 AND status = 'new' AND relevance_score >= 60
         AND detected_at > now() - interval '14 days'
       ORDER BY relevance_score DESC LIMIT 5`,
      [userId]
    );
    for (const s of signals.rows) {
      items.push({
        type: 'signal',
        score: Math.round(0.8 * s.relevance_score),
        signalId: s.id,
        title: s.title,
        contactName: s.contact_name || null,
        contactEmail: s.contact_email || null,
        company: s.company_name || null,
        signalType: s.signal_type,
      });
    }

    // Dédup par contact : garde le score max, trace les autres sources
    const byContact = new Map();
    const deduped = [];
    for (const item of items.sort((a, b) => b.score - a.score)) {
      const key = contactKey(item);
      if (!key) { deduped.push(item); continue; }
      const kept = byContact.get(key);
      if (kept) {
        kept.alsoFlaggedBy = kept.alsoFlaggedBy || [];
        if (!kept.alsoFlaggedBy.includes(item.type) && item.type !== kept.type) {
          kept.alsoFlaggedBy.push(item.type);
        }
      } else {
        byContact.set(key, item);
        deduped.push(item);
      }
    }

    res.json({
      items: deduped.slice(0, MAX_ITEMS),
      counts: {
        nurturePending: pending.rows.length,
        dealCoach: coach?.result?.suggestions?.length || 0,
        upsell: upsell?.result?.opportunities?.length || 0,
        churnRisks: churn.rows.length,
        signals: signals.rows.length,
        total: deduped.length,
      },
      pendingEmailIds: pending.rows.map((e) => e.id),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
