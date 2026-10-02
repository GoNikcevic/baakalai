/**
 * SQLite adapter that provides a pg-compatible interface for testing.
 * Used when DATABASE_PATH is set (test environment).
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let db;

function getDb() {
  if (!db) {
    const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'test.db');
    // `backend/data/` est gitignoré : sur un clone frais il n'existe pas, et
    // better-sqlite3 refuse d'ouvrir un fichier dont le dossier parent manque.
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = OFF');
    initSchema();
  }
  return db;
}

// Les identifiants doivent avoir la forme d'un UUID (8-4-4-4-12) : les routes
// passent par middleware/validate-params.js, qui rejette en 400 tout id qui n'est
// ni un UUID ni un nombre. Un hex de 32 caractères sans tirets ne passe pas.
/**
 * Format de date CANONIQUE du miroir : l'ISO-8601 en Z, exactement celui que
 * `Date.prototype.toISOString()` produit et que l'application ecrit partout.
 *
 * Pourquoi ca compte : SQLite n'a pas de type date, il compare des CHAINES.
 * `CURRENT_TIMESTAMP` et `datetime('now')` rendent « 2026-10-02 18:00:00 »,
 * l'application ecrit « 2026-10-02T17:00:00.000Z », et le « T » (0x54) pese
 * plus lourd que l'espace (0x20). Une date PASSEE paraissait donc FUTURE.
 *
 * Constate sur lib/db-lock.js : un bail expire n'etait jamais reprenable sous
 * le miroir, parce que `expires_at < now()` rendait faux. Le meme piege est
 * documente a la main dans lib/account-list.js, qui calcule ses bornes en JS
 * pour le contourner · il n'a plus a le faire.
 *
 * Sur des ISO-8601 en Z, l'ordre lexical EST l'ordre chronologique. Les deux
 * cotes de toute comparaison sont donc dans ce format : les defauts du schema
 * ci-dessous, et la traduction de `now()` plus bas.
 */
const MAINTENANT_ISO = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function initSchema() {
  const d = getDb();
  d.exec(SCHEMA_SQL.replace(/DEFAULT CURRENT_TIMESTAMP/g, `DEFAULT (${MAINTENANT_ISO})`));
}

const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      company TEXT,
      role TEXT DEFAULT 'client',
      -- Colonnes ajoutées par les migrations Postgres (009, 012, 034, 078...).
      -- Ce miroir SQLite est écrit à la main : toute colonne de la table users
      -- lue par une route doit être répliquée ici, sinon les tests API échouent.
      email_verified INTEGER DEFAULT 0,
      verification_token TEXT,
      verification_expires DATETIME,
      reset_token TEXT,
      reset_expires DATETIME,
      language TEXT DEFAULT 'fr',
      onboarding_complete INTEGER NOT NULL DEFAULT 0,
      signal_scan_frequency TEXT NOT NULL DEFAULT 'weekly',
      active_crm_provider TEXT,
      settings TEXT DEFAULT '{}',
      data TEXT DEFAULT '{}',
      plan TEXT NOT NULL DEFAULT 'trial',
      plan_status TEXT NOT NULL DEFAULT 'trialing',
      plan_updated_at DATETIME,
      trial_ends_at DATETIME,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT REFERENCES users(id),
      token_hash TEXT UNIQUE NOT NULL,
      expires_at DATETIME NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      name TEXT NOT NULL,
      client TEXT,
      description TEXT,
      color TEXT DEFAULT 'var(--blue)',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      project_id TEXT REFERENCES projects(id),
      name TEXT NOT NULL,
      client TEXT,
      status TEXT DEFAULT 'prep',
      channel TEXT DEFAULT 'email',
      sector TEXT,
      sector_short TEXT,
      position TEXT,
      size TEXT,
      angle TEXT,
      zone TEXT,
      tone TEXT DEFAULT 'Pro décontracté',
      formality TEXT DEFAULT 'Vous',
      length TEXT DEFAULT 'Standard',
      cta TEXT,
      start_date TEXT,
      lemlist_id TEXT,
      iteration INTEGER DEFAULT 1,
      nb_prospects INTEGER DEFAULT 0,
      sent INTEGER DEFAULT 0,
      planned INTEGER DEFAULT 0,
      open_rate REAL,
      reply_rate REAL,
      accept_rate_lk REAL,
      reply_rate_lk REAL,
      interested INTEGER DEFAULT 0,
      meetings INTEGER DEFAULT 0,
      stops INTEGER DEFAULT 0,
      last_collected TEXT,
      notion_page_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      ab_config TEXT,
      batch_mode INTEGER,
      batch_size INTEGER,
      current_batch INTEGER,
      email_account_id TEXT,
      last_optimized_at DATETIME,
      send_channel TEXT,
      team_id TEXT,
      total_batches INTEGER
    );

    CREATE TABLE IF NOT EXISTS touchpoints (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      campaign_id TEXT REFERENCES campaigns(id),
      step TEXT,
      type TEXT,
      label TEXT,
      sub_type TEXT,
      timing TEXT,
      subject TEXT,
      body TEXT DEFAULT '',
      max_chars INTEGER,
      open_rate REAL,
      reply_rate REAL,
      stop_rate REAL,
      accept_rate REAL,
      interested INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      parent_step_id TEXT,
      condition_type TEXT,
      condition_value TEXT,
      branch_label TEXT,
      is_root INTEGER DEFAULT 1,
      -- Variante B de l'A/B testing (migrations 0xx) : sans ces colonnes,
      -- toute création de séquence renvoie un 500 en test.
      subject_b TEXT,
      body_b TEXT,
      open_rate_b REAL,
      reply_rate_b REAL,
      accept_rate_b REAL,
      -- Conteneurs alternatifs : workflow de relance CRM (enrollment,
      -- migration 103) et modèle de workflow réutilisable (migration 114).
      -- Sans workflow_id ici, toute création de séquence repart en 500 :
      -- db.touchpoints.create écrit les trois conteneurs dans le même INSERT.
      enrollment_id TEXT,
      workflow_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS diagnostics (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      campaign_id TEXT REFERENCES campaigns(id),
      date_analyse TEXT,
      diagnostic TEXT,
      priorities TEXT DEFAULT '[]',
      nb_to_optimize INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      notion_page_id TEXT
    );

    CREATE TABLE IF NOT EXISTS versions (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      campaign_id TEXT REFERENCES campaigns(id),
      version INTEGER,
      date TEXT,
      messages_modified TEXT DEFAULT '[]',
      hypotheses TEXT DEFAULT '',
      result TEXT DEFAULT 'testing',
      rollback_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      ab_categories TEXT,
      notion_page_id TEXT,
      tested_steps TEXT
    );

    CREATE TABLE IF NOT EXISTS memory_patterns (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      pattern TEXT,
      category TEXT,
      data TEXT,
      confidence TEXT DEFAULT 'Faible',
      date_discovered TEXT,
      sectors TEXT DEFAULT '[]',
      targets TEXT DEFAULT '[]',
      -- Colonnes ajoutées par les migrations 040 et 059 (mémoire partagée,
      -- scoring, dédoublonnage). La colonne embedding est un vecteur pgvector :
      -- sans équivalent SQLite, on ne la réplique pas (les tests ne la lisent pas).
      user_id TEXT REFERENCES users(id),
      team_id TEXT REFERENCES teams(id),
      source TEXT,
      source_test_id TEXT,
      ab_category TEXT,
      custom_category TEXT,
      applied INTEGER DEFAULT 0,
      shared INTEGER DEFAULT 0,
      confirmations INTEGER DEFAULT 1,
      confidence_score REAL,
      improvement_pct REAL,
      sample_size INTEGER DEFAULT 0,
      last_confirmed_at DATETIME,
      dismissed_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      notion_page_id TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_threads (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT,
      title TEXT DEFAULT 'Nouvelle conversation',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      assistant_type TEXT,
      team_id TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      thread_id TEXT REFERENCES chat_threads(id),
      role TEXT,
      content TEXT,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT,
      filename TEXT,
      original_name TEXT,
      mime_type TEXT,
      file_size INTEGER,
      file_path TEXT,
      parsed_text TEXT,
      doc_type TEXT DEFAULT 'other',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      company TEXT,
      sector TEXT,
      website TEXT,
      team_size TEXT,
      description TEXT,
      value_prop TEXT,
      social_proof TEXT,
      pain_points TEXT,
      objections TEXT,
      persona_primary TEXT,
      persona_secondary TEXT,
      target_sectors TEXT,
      target_size TEXT,
      target_zones TEXT,
      default_tone TEXT DEFAULT 'Pro décontracté',
      default_formality TEXT DEFAULT 'Vous',
      avoid_words TEXT,
      signature_phrases TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      weekly_report INTEGER,
      email_crm_digest INTEGER DEFAULT 1,
      email_weekly_report INTEGER DEFAULT 1,
      email_tips INTEGER DEFAULT 1,
      email_reply_alert INTEGER DEFAULT 1,
      -- Qualification ICP (migration 106) : NULL y signifie « inconnu »,
      -- jamais « zéro » (cf. lib/icp-signals.js).
      job_role TEXT,
      icp_crm_history_months INTEGER,
      icp_crm_seat_count INTEGER,
      icp_deals_count INTEGER,
      icp_won_deals_count INTEGER,
      icp_has_client_base INTEGER,
      icp_computed_at DATETIME
    );

    CREATE TABLE IF NOT EXISTS project_files (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      project_id TEXT REFERENCES projects(id),
      user_id TEXT,
      filename TEXT,
      original_name TEXT,
      mime_type TEXT,
      file_size INTEGER,
      file_path TEXT,
      parsed_text TEXT,
      category TEXT DEFAULT 'other',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS custom_variables (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      key TEXT NOT NULL,
      label TEXT,
      category TEXT DEFAULT 'custom',
      sync_mode TEXT DEFAULT 'local',
      default_value TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS opportunities (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      campaign_id TEXT REFERENCES campaigns(id),
      name TEXT NOT NULL,
      title TEXT,
      company TEXT,
      company_size TEXT,
      status TEXT DEFAULT 'new',
      status_color TEXT,
      timing TEXT,
      email TEXT,
      hubspot_contact_id TEXT,
      hubspot_deal_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      autopilot_enabled INTEGER,
      batch_number INTEGER,
      churn_factors TEXT,
      churn_flagged_at DATETIME,
      churn_score INTEGER,
      churn_scored_at DATETIME,
      city TEXT,
      country TEXT,
      crm_contact_id TEXT,
      crm_created_at DATETIME,
      crm_deal_id TEXT,
      crm_deal_attribution TEXT,
      account_role TEXT,
      role_source TEXT,
      is_primary_contact INTEGER DEFAULT 0,
      account_id TEXT,
      crm_owner_id TEXT,
      crm_provider TEXT,
      crm_push_state TEXT,
      crm_stage TEXT,
      crm_stage_changed_at DATETIME,
      crm_stage_id TEXT,
      data TEXT,
      deal_value REAL,
      email_bounce_reason TEXT,
      email_bounced_at DATETIME,
      last_activity_at DATETIME,
      linkedin_url TEXT,
      lost_date DATETIME,
      lost_reason TEXT,
      lost_reason_source TEXT,
      owner_email TEXT,
      owner_id TEXT,
      personalization TEXT,
      planned_followup_date DATETIME,
      planned_followup_reason TEXT,
      reactivated_at DATETIME,
      reactivated_from_email_id TEXT,
      renewal_date DATETIME,
      score INTEGER,
      score_breakdown TEXT,
      sequence_stop_reason TEXT,
      sequence_stopped_at DATETIME,
      team_id TEXT,
      won_date DATETIME,
      cooldown_until DATETIME,
      close_date DATETIME
    );

    -- Les sociétés (migration 124). Répliquée ici parce que lib/icp-signals.js
    -- lit désormais min(accounts.crm_created_at) : sans cette table, le calcul
    -- ICP échoue en test alors qu'il passe en production.
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      crm_provider TEXT,
      crm_account_id TEXT,
      name TEXT NOT NULL,
      name_normalized TEXT NOT NULL,
      domain TEXT,
      industry TEXT,
      size TEXT,
      owner_id TEXT,
      owner_email TEXT,
      crm_owner_id TEXT,
      crm_created_at DATETIME,
      last_activity_at DATETIME,
      source TEXT NOT NULL DEFAULT 'crm',
      -- Colonnes ajoutees par la migration 131 (lot 5) : le churn se score au
      -- niveau du compte. churn_flagged_at date le FRANCHISSEMENT du seuil, pas
      -- l'etat, meme role que sur opportunities (migration 109).
      churn_score INTEGER,
      churn_factors TEXT,
      churn_scored_at DATETIME,
      churn_flagged_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Les deux index PARTIELS de la migration 124. Sans eux, tout upsert de
    -- lib/accounts.js echoue ici avec « ON CONFLICT clause does not match any
    -- PRIMARY KEY or UNIQUE constraint » : le rattachement des contacts a leur
    -- societe, coeur du lot 2, n'etait garde par aucun test.
    CREATE UNIQUE INDEX IF NOT EXISTS accounts_crm_unique
      ON accounts (user_id, crm_provider, crm_account_id) WHERE crm_account_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS accounts_derived_unique
      ON accounts (user_id, name_normalized) WHERE crm_account_id IS NULL;

    -- Les affaires (migration 126). Répliquée ici pour la même raison que la
    -- table accounts : lib/deals.js écrit dedans à chaque synchro, et sans elle
    -- les tests de synchro échouent alors que la production passe.
    CREATE TABLE IF NOT EXISTS deals (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      team_id TEXT,
      account_id TEXT,
      primary_contact_id TEXT,
      crm_provider TEXT,
      crm_deal_id TEXT,
      hubspot_deal_id TEXT,
      name TEXT,
      status TEXT NOT NULL DEFAULT 'open',
      deal_value REAL,
      currency TEXT,
      won_date DATETIME,
      lost_date DATETIME,
      lost_reason TEXT,
      lost_reason_source TEXT,
      close_date DATETIME,
      renewal_date DATETIME,
      crm_stage TEXT,
      crm_stage_id TEXT,
      crm_stage_changed_at DATETIME,
      crm_pipeline_id TEXT,
      crm_pipeline_name TEXT,
      crm_created_at DATETIME,
      crm_updated_at DATETIME,
      last_activity_at DATETIME,
      planned_followup_date DATETIME,
      planned_followup_reason TEXT,
      reactivated_at DATETIME,
      reactivated_from_email_id TEXT,
      reactivated_contact_id TEXT,
      owner_id TEXT,
      owner_email TEXT,
      crm_owner_id TEXT,
      crm_deal_attribution TEXT,
      crm_push_state TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'crm',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Une seule affaire derivee par contact (migration 128). L'index de la 126
    -- ne les couvre pas : une affaire derivee n'a pas de crm_deal_id.
    CREATE UNIQUE INDEX IF NOT EXISTS deals_derived_unique
      ON deals (user_id, primary_contact_id)
      WHERE source = 'derived' AND primary_contact_id IS NOT NULL;

    -- L'index partiel de Postgres n'existe pas tel quel en sqlite, mais la
    -- contrainte d'unicité compte : c'est elle que l'upsert de lib/deals.js
    -- utilise comme cible de ON CONFLICT.
    CREATE UNIQUE INDEX IF NOT EXISTS deals_crm_unique
      ON deals (user_id, crm_provider, crm_deal_id) WHERE crm_deal_id IS NOT NULL;

    -- L'historique des scores de churn. Absent du miroir jusqu'au lot 5, ce qui
    -- rendait tout le scoring invisible aux tests : l'insertion echouait sur
    -- « no such table », le catch se contentait de journaliser, et le run
    -- annoncait quand meme son nombre de lignes scorees.
    --
    -- opportunity_id est NULLABLE depuis la migration 131 : une ligne porte sur
    -- un contact OU sur un compte. Y glisser le contact principal d'un compte
    -- serait un mensonge qui polluerait son propre historique.
    -- (Pas d accent grave ici : ce bloc vit dans un gabarit JavaScript, un
    --  backtick y terminerait la chaine.)
    -- Le bail d'exclusion mutuelle des taches planifiees (migration 066).
    -- Absent du miroir, donc lib/db-lock.js etait intestable de bout en bout :
    -- c'est pourtant lui qui serialise les ecritures de memoire (regle 3 du
    -- CLAUDE.md), et la regle interdit explicitement pg_advisory_lock parce que
    -- le pooler est en mode transaction. Un verrou qu'aucun test ne couvre est
    -- un verrou dont on apprend les defauts en production.
    CREATE TABLE IF NOT EXISTS cron_locks (
      name TEXT PRIMARY KEY,
      instance_id TEXT NOT NULL,
      locked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    );

    CREATE TABLE IF NOT EXISTS churn_score_history (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT NOT NULL REFERENCES users(id),
      opportunity_id TEXT,
      account_id TEXT,
      deal_id TEXT,
      score INTEGER NOT NULL,
      factors TEXT,
      scored_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK (opportunity_id IS NOT NULL OR account_id IS NOT NULL)
    );

    -- Ce que baakalai a mesuré puis deduit de l'architecture du CRM
    -- (migration 127). Deux tables et pas une : la mesure est horodatee et
    -- conservee, parce que c'est la comparaison de deux mesures qui detecte
    -- une derive ; la deduction est corrigeable et gelee des qu'elle l'est.
    CREATE TABLE IF NOT EXISTS crm_architecture_profiles (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      crm_provider TEXT NOT NULL,
      profile TEXT NOT NULL,
      objects_seen INTEGER NOT NULL DEFAULT 0,
      fields_seen INTEGER NOT NULL DEFAULT 0,
      custom_objects INTEGER NOT NULL DEFAULT 0,
      measured_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS crm_architecture_mappings (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      crm_provider TEXT NOT NULL,
      object_name TEXT NOT NULL,
      object_label TEXT,
      field_name TEXT,
      field_label TEXT,
      is_custom INTEGER NOT NULL DEFAULT 0,
      baakalai_role TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'rule',
      confidence REAL,
      reasoning TEXT,
      evidence TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_arch_mappings_unique
      ON crm_architecture_mappings (user_id, crm_provider, object_name, COALESCE(field_name, ''));

    CREATE TABLE IF NOT EXISTS reveal_usage (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT NOT NULL REFERENCES users(id),
      campaign_id TEXT,
      provider TEXT NOT NULL DEFAULT 'dropcontact',
      submitted INTEGER NOT NULL DEFAULT 0,
      found INTEGER NOT NULL DEFAULT 0,
      unit_price_cents INTEGER NOT NULL DEFAULT 0,
      amount_cents INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      week TEXT NOT NULL,
      date_range TEXT,
      score TEXT DEFAULT 'ok',
      score_label TEXT,
      contacts INTEGER DEFAULT 0,
      open_rate REAL,
      reply_rate REAL,
      interested INTEGER DEFAULT 0,
      meetings INTEGER DEFAULT 0,
      synthesis TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS chart_data (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT REFERENCES users(id),
      label TEXT NOT NULL,
      email_count INTEGER DEFAULT 0,
      linkedin_count INTEGER DEFAULT 0,
      week_start TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      name TEXT NOT NULL,
      invite_code TEXT UNIQUE,
      -- NULL = aucun plafond, même convention que la migration 107 côté
      -- Postgres. Le défaut à 5 hérité de la 032 est resté ici parce que la
      -- 107 est un fichier .sql jamais joué sur ce schéma, construit en JS :
      -- une équipe créée en local bloquait donc son 6e membre dans
      -- db.teams.addMember alors que la prod ne plafonne plus.
      max_members INTEGER,
      created_by TEXT NOT NULL REFERENCES users(id),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      team_id TEXT NOT NULL REFERENCES teams(id),
      user_id TEXT NOT NULL REFERENCES users(id),
      role TEXT NOT NULL DEFAULT 'viewer',
      joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(team_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS product_events (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT,
      event TEXT NOT NULL,
      metadata TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS user_integrations (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      access_token TEXT NOT NULL,
      refresh_token TEXT,
      metadata TEXT DEFAULT '{}',
      expires_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      -- Colonnes ajoutées par migration, répliquées ici pour le miroir de test
      instance_url TEXT,
      team_id TEXT,
      invalid_since DATETIME,
      invalid_reason TEXT,
      last_verified_at DATETIME,
      UNIQUE(user_id, provider)
    );

    -- Les deux tables de relance manquaient au miroir, si bien que l'export
    -- RGPD (GET /api/export/account) ne pouvait pas être testé du tout : deux
    -- de ses dix requêtes échouaient sur « no such table ». Répliquées d'après
    -- le schéma de production au 2026-09-22.
    -- Pas de backtick dans ce bloc : il vit dans un template literal JS.
    CREATE TABLE IF NOT EXISTS nurture_triggers (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      conditions TEXT NOT NULL DEFAULT '{}',
      action_type TEXT NOT NULL DEFAULT 'email',
      email_template TEXT,
      sequence_id TEXT,
      mode TEXT,
      enabled INTEGER DEFAULT 1,
      crm_provider TEXT,
      last_run DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      team_id TEXT,
      ab_enabled INTEGER
    );

    CREATE TABLE IF NOT EXISTS nurture_emails (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT NOT NULL REFERENCES users(id),
      trigger_id TEXT,
      opportunity_id TEXT,
      email_account_id TEXT,
      to_email TEXT NOT NULL,
      to_name TEXT,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      action_type TEXT NOT NULL DEFAULT 'email',
      sent_at DATETIME,
      crm_activity_id TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      team_id TEXT,
      analyzed_at DATETIME,
      team_campaign_id TEXT,
      variant TEXT,
      ab_group_id TEXT,
      replied_at DATETIME,
      sentiment TEXT,
      pattern_ids TEXT,
      metadata TEXT
    );
`;

/** Ramène une valeur acceptée par pg vers un type que SQLite sait lier. */
function toSqliteValue(p) {
  if (p === undefined) return null;
  if (typeof p === 'boolean') return p ? 1 : 0;
  if (p instanceof Date) return p.toISOString();
  if (p !== null && typeof p === 'object' && !Buffer.isBuffer(p)) return JSON.stringify(p);
  return p;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ce que ce miroir ne traduit PAS, et c'est un choix

   Mesure du 2026-10-02 : environ 127 occurrences de SQL Postgres que le miroir
   ignorait, d'ou des pans entiers du backend intestables. Les quatre familles
   mecaniques sont desormais traduites (`= ANY($n)`, `::interval`, `EXTRACT`,
   `ILIKE`, plus les casts de tableaux), et des tests les couvrent.

   Deux familles restent volontairement non traduites :

   · `SELECT DISTINCT ON (...)` · 12 occurrences, toutes de la meme forme « la
     derniere ligne par groupe ». La reecriture en `ROW_NUMBER() OVER
     (PARTITION BY ...)` est possible, les fonctions de fenetrage marchant
     nativement ici. Mais elle demande de couper le `ORDER BY` entre le prefixe
     de groupe et le reste, et une coupe fausse rendrait LA MAUVAISE LIGNE sans
     rien signaler. Une requete qui refuse de demarrer coute une heure ; une
     requete qui rend la mauvaise ligne coute une enquete. Ces appels se
     corrigent donc un par un a la source, comme l'a ete `failedSendIds` dans
     lib/reactivation-queue.js, ou chaque correction est verifiable.

   · `array_agg` · 1 occurrence (routes/data-quality.js). Postgres rend un
     TABLEAU, `json_group_array` rendrait une chaine JSON : l'appelant qui
     itere dessus se tromperait en silence au lieu d'echouer. Meme raisonnement.

   Verifie natif, sans traduction : les fonctions de fenetrage (`OVER (...)`) et
   `IS DISTINCT FROM`.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Coupe `A - B` au niveau SUPERIEUR, en ignorant ce qui est entre parentheses
 * ou entre apostrophes.
 *
 * Un simple `split('-')` couperait au milieu de `datetime('now','-7 days')` ou
 * de `COALESCE(a, b - c)`, et produirait deux moities invalides.
 *
 * @returns {[string, string]|null} les deux membres, ou null si pas de
 *   soustraction au niveau superieur.
 */
function couperSoustraction(expr) {
  let niveau = 0;
  let dansChaine = false;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "'") { dansChaine = !dansChaine; continue; }
    if (dansChaine) continue;
    if (c === '(') niveau++;
    else if (c === ')') niveau--;
    else if (c === '-' && niveau === 0) {
      return [expr.slice(0, i).trim(), expr.slice(i + 1).trim()];
    }
  }
  return null;
}

/** Une unite d'EXTRACT, traduite pour SQLite. */
function extraireUnite(unite, arg) {
  const heure = (f) => `CAST(strftime('${f}', ${arg}) AS INTEGER)`;

  if (unite === 'EPOCH' || unite === 'DAY' || unite === 'DAYS') {
    // Une soustraction de dates se traduit en difference de jours juliens. Sans
    // ce cas, `EXTRACT(EPOCH FROM (won_date - created_at))` deviendrait un
    // strftime sur une soustraction de chaines, qui rend NULL en silence · le
    // cycle de vente aurait ete nul sans que rien ne le signale.
    const membres = couperSoustraction(arg.replace(/^\((.*)\)$/s, '$1'));
    if (membres) {
      const [a, b] = membres;
      const jours = `(julianday(${a}) - julianday(${b}))`;
      return unite === 'EPOCH' ? `(${jours} * 86400)` : jours;
    }
    return unite === 'EPOCH' ? `CAST(strftime('%s', ${arg}) AS INTEGER)` : heure('%d');
  }
  if (unite === 'HOUR') return heure('%H');
  if (unite === 'MINUTE') return heure('%M');
  if (unite === 'MONTH') return heure('%m');
  if (unite === 'YEAR') return heure('%Y');
  // DOW de Postgres : 0 = dimanche, comme le %w de SQLite.
  if (unite === 'DOW') return heure('%w');
  // ISODOW : 1 = lundi a 7 = dimanche. Le %w de SQLite met dimanche a 0, il
  // faut donc le remonter a 7 au lieu de laisser un decalage d'un jour sur
  // toute analyse hebdomadaire.
  //
  // En arithmetique et non en CASE : un CASE devrait repeter l'argument, et
  // quand cet argument est un parametre (`EXTRACT(ISODOW FROM $1)`) le `?` se
  // retrouve deux fois dans le SQL pour une seule valeur liee · « Too few
  // parameter values were provided ». L'argument ne doit apparaitre qu'UNE fois.
  if (unite === 'ISODOW') return `((${heure('%w')} + 6) % 7 + 1)`;
  // Unite inconnue : on laisse l'expression telle quelle, elle echouera
  // bruyamment plutot que de rendre un chiffre faux.
  return `EXTRACT(${unite} FROM ${arg})`;
}

/**
 * `EXTRACT(unite FROM expr)` · SQLite ne connait pas EXTRACT.
 *
 * Ecrit avec un scanner de parentheses et non une expression reguliere :
 * l'argument est souvent lui-meme parenthese, et aucune regex ne compte les
 * parentheses. Une regex gourmande avalerait la parenthese fermante de la
 * requete entiere ; une regex paresseuse couperait l'argument en deux.
 *
 * 27 occurrences dans le backend, dont 15 EPOCH : aucune de ces requetes
 * n'avait jamais pu s'executer sous le miroir, donc aucune n'etait couverte.
 */
function traduireExtract(sql) {
  const RE = /EXTRACT\s*\(\s*([A-Za-z]+)\s+FROM\s+/gi;
  let sortie = '';
  let i = 0;
  for (;;) {
    RE.lastIndex = i;
    const m = RE.exec(sql);
    if (!m) { sortie += sql.slice(i); break; }
    sortie += sql.slice(i, m.index);

    const debutArg = m.index + m[0].length;
    let p = debutArg;
    let niveau = 1;
    let dansChaine = false;
    while (p < sql.length) {
      const c = sql[p];
      if (c === "'") dansChaine = !dansChaine;
      else if (!dansChaine && c === '(') niveau++;
      else if (!dansChaine && c === ')') { niveau--; if (niveau === 0) break; }
      p++;
    }
    // Parenthese jamais fermee : SQL deja invalide, on rend la chaine intacte
    // plutot que d'en fabriquer une autre.
    if (niveau !== 0) { sortie += sql.slice(m.index); break; }

    sortie += extraireUnite(m[1].toUpperCase(), sql.slice(debutArg, p).trim());
    i = p + 1;
  }
  return sortie;
}

/**
 * Execute a query with pg-compatible $1, $2 parameter syntax.
 * Returns { rows, rowCount }.
 */
function query(text, params = []) {
  const d = getDb();
  // Conversion des paramètres $1, $2 de pg vers les ? positionnels de SQLite.
  // pg autorise un même $n plusieurs fois dans une requête (WHERE user_id = $1
  // OR team_id = $1) ; SQLite non : chaque ? consomme une valeur. On reconstruit
  // donc la liste dans l'ordre d'apparition au lieu de la reprendre telle quelle,
  // sinon ces requêtes échouent avec « Too few parameter values were provided ».
  const positional = [];
  // UNE seule passe, et c'est essentiel : `= ANY($2)` doit etre developpe en
  // `IN (?, ?)` et pousser ses elements, mais l'idiome courant du code repete le
  // meme parametre · `($2::uuid[] IS NULL OR id = ANY($2))`. Deux passes
  // separees pousseraient les elements du tableau avant la valeur brute, alors
  // que le SQL final les attend dans l'autre ordre, et chaque requete de ce type
  // lirait des parametres decales. Une alternance unique preserve l'ordre
  // d'apparition.
  const RE_PARAMS = /(=|<>|!=)\s*ANY\s*\(\s*\$(\d+)\s*(?:::[a-z_]+(?:\[\])?)?\s*\)|\$(\d+)/gi;
  const sqliteText = text.replace(RE_PARAMS, (m, op, nAny, nPlain) => {
    if (nAny !== undefined) {
      const v = params[Number(nAny) - 1];
      const dedans = op === '=' ? 'IN' : 'NOT IN';
      // `IN ()` est une erreur de syntaxe en SQLite. Un ensemble vide
      // syntaxiquement valide est donc necessaire, et il doit garder la place
      // de l'operande : `1 = 0` ne peut PAS servir, seule l'expression
      // `= ANY($n)` est remplacee et l'operande de gauche reste, ce qui
      // donnerait « id 1 = 0 ».
      const ensembleVide = `${dedans} (SELECT NULL WHERE 0)`;

      // NULL se traite comme un ensemble VIDE, et surtout pas en rendant
      // l'expression intacte : `$n` ne serait alors pas converti en `?` et
      // `ANY` resterait, d'ou « no such function: ANY ».
      //
      // C'est le cas courant de l'idiome de perimetre du code :
      // `($2::uuid[] IS NULL OR id = ANY($2))` appele sans filtre. Avec un
      // ensemble vide, « NULL IS NULL OU rien » vaut vrai, soit exactement ce
      // que Postgres rend.
      if (v == null) return ensembleVide;

      // Un scalaire est un ensemble a un element · c'est la lecture naturelle
      // de `= ANY(x)`, et mieux vaut l'honorer que d'echouer.
      const liste = Array.isArray(v) ? v : [v];
      if (liste.length === 0) return ensembleVide;

      for (const x of liste) positional.push(x);
      return `${dedans} (${liste.map(() => '?').join(', ')})`;
    }
    positional.push(params[Number(nPlain) - 1]);
    return '?';
  });

  // better-sqlite3 ne lie que number, string, bigint, buffer et null. pg accepte
  // en plus les booléens, les Date et les objets (colonnes JSONB) : on les
  // convertit ici, sinon toute route qui écrit un de ces types renvoie un 500
  // en test alors qu'elle fonctionne en production.
  params = positional.map(toSqliteValue);

  // Handle RETURNING * for INSERT/UPDATE
  const isReturning = /RETURNING\s+\*/i.test(text);
  // `RETURNING <colonnes>` n'était PAS reconnu : la requête retombait sur la
  // branche muette du bas, qui rend { rows: [] }. Tout appelant écrit sur le
  // modèle `res.rows[0].id` voyait donc undefined en test alors qu'il
  // fonctionne en production. lib/accounts.js (lot 2) et lib/deals.js (lot 4)
  // sont tous les deux dans ce cas : leur import était intestable, et un test
  // qui ne peut pas échouer ne garde rien.
  //
  // SQLite sait faire RETURNING nativement depuis la 3.35, et la version
  // embarquée ici est bien plus récente : on laisse donc la base répondre au
  // lieu de reconstituer la ligne par son rowid. La branche `RETURNING *`
  // historique n'est pas touchée, elle porte 484 tests.
  const isReturningCols = !isReturning && /\bRETURNING\s+(?!\*)[\w.,\s"]+$/i.test(text.trim());
  const isInsert = /^\s*INSERT/i.test(text);
  const isUpdate = /^\s*UPDATE/i.test(text);
  const isDelete = /^\s*DELETE/i.test(text);
  const isSelect = /^\s*SELECT/i.test(text);

  // Replace PostgreSQL-specific syntax
  let adapted = sqliteText
    // Casts Postgres · SQLite n'a pas la syntaxe `expr::type` et s'arrête sur
    // le premier « : ». Seul `::numeric` était traité, si bien qu'une requête
    // parfaitement valide en production échouait ici avec « unrecognized token:
    // ":" » dès qu'elle utilisait un autre cast. `count(*)::int` est le cas le
    // plus fréquent : en pg il sert à récupérer un nombre plutôt qu'une chaîne,
    // ce que SQLite fait déjà nativement. Liste explicite plutôt que `::\w+`
    // pour ne pas massacrer une chaîne littérale qui contiendrait « :: ».
    // `(\[\])?` ajoute : l'idiome de perimetre du code est
    // `($2::uuid[] IS NULL OR id = ANY($2))`, et retirer `::uuid` en laissant
    // les crochets donnait « near "[]" ». Les deux moities de l'idiome sont
    // donc traitees, celle-ci ici et le `ANY` dans la passe des parametres.
    // Le `\b` est AVANT les crochets, pas apres : place en fin de motif il ne
    // peut pas matcher, « ] » suivi d'une espace n'etant pas une frontiere de
    // mot, et la branche tableau ne se declenchait jamais. Entre le type et les
    // crochets il matche (« d » puis « [ »), et il empeche toujours `::int` de
    // mordre sur `::integer` grace au retour arriere du moteur.
    .replace(/::(int|integer|bigint|numeric|float|real|text|uuid|boolean|bool|date|timestamptz|timestamp|jsonb|json|vector)\b(\[\])?/gi, '')
    // `X ± ($n || ' days')::interval` · l'idiome d'arithmetique de dates du
    // code. Le cast `::interval` n'etait PAS dans la liste ci-dessus, et il ne
    // peut pas y etre : le retirer laisserait `X - (? || ' days')`, qui est une
    // soustraction de chaine. Il faut traduire l'expression entiere.
    //
    // Trois fichiers en dependaient et leurs requetes n'avaient donc jamais pu
    // s'executer sous le miroir : lib/reactivation-queue.js (corrige a la
    // source), lib/db-lock.js et lib/hidden-revenue/detect.js.
    .replace(
      /(now\(\)|\?|[\w."]+)\s*([-+])\s*\(\s*\?\s*\|\|\s*'([^']*)'\s*\)::interval/gi,
      // Meme regle : format canonique en sortie, sinon `expires_at` serait
      // stocke a l'espace et compare a un `now()` en ISO · un bail en cours
      // paraitrait expire, et l'exclusion mutuelle ne tiendrait plus.
      (_, base, signe, unite) =>
        `strftime('%Y-%m-%dT%H:%M:%fZ', ${base}, '${signe}' || ? || ' ${unite.trim()}')`
    )
    // SQLite n'a pas ILIKE. Son LIKE est deja insensible a la casse sur
    // l'ASCII, ce qui couvre les usages du code (recherche de nom, de domaine).
    // Nuance a connaitre : sur des caracteres accentues, SQLite reste sensible
    // a la casse la ou Postgres ne l'est pas. Ne pas ecrire de test qui
    // depende de « É » == « é ».
    .replace(/\bILIKE\b/gi, 'LIKE')
    // Les fenêtres temporelles s'écrivent « now() - interval '7 days' » en pg ;
    // SQLite ne connaît pas interval et attend datetime('now','-7 days').
    .replace(/now\(\)\s*([-+])\s*interval\s*'(\d+)\s*(\w+)'/gi,
      // Rend le format CANONIQUE, pas celui de datetime() : `datetime()`
      // retourne « 2026-10-02 18:00:00 », sans T ni millisecondes, et toute
      // comparaison avec une date ISO stockee par l'application repartirait
      // dans le piege lexical que MAINTENANT_ISO vient de refermer.
      (_, sign, amount, unit) => `strftime('%Y-%m-%dT%H:%M:%fZ','now','${sign}${amount} ${unit}')`)
    // Agrégats JSON · pg dit json_agg / json_build_object, SQLite dit
    // json_group_array / json_object. Sans cette traduction, l'export RGPD
    // n'était pas testable du tout : sa requête sur les fils de discussion
    // échouait sur « no such function », ce qui masquait les vraies erreurs.
    // Le « ORDER BY » interne à un agrégat n'est supporté qu'à partir de
    // SQLite 3.44 : on le retire ici. Le miroir ne garantit donc pas l'ordre
    // des éléments agrégés, contrairement à la production. Ne pas écrire de
    // test qui dépende de cet ordre.
    .replace(/json_agg\(/gi, 'json_group_array(')
    .replace(/json_build_object\(/gi, 'json_object(')
    .replace(/json_group_array\((.*?)\s+ORDER BY\s+[\w.]+(\s+(?:ASC|DESC))?\)/gis, 'json_group_array($1)')
    .replace(/ON CONFLICT\((\w+)\) DO UPDATE SET/g, 'ON CONFLICT($1) DO UPDATE SET')
    .replace(/now\(\)/g, MAINTENANT_ISO)
    .replace(/EXCLUDED\./g, 'excluded.');

  // EXTRACT en dernier : ses traductions produisent des `julianday(...)` et des
  // `strftime(...)` qui ne doivent plus repasser dans les regles ci-dessus.
  adapted = traduireExtract(adapted);

  if (isSelect) {
    const stmt = d.prepare(adapted);
    const rows = stmt.all(...params);
    return { rows, rowCount: rows.length };
  }

  if (isReturningCols) {
    const stmt = d.prepare(adapted);
    const rows = stmt.all(...params);
    return { rows, rowCount: rows.length };
  }

  if (isReturning) {
    // SQLite doesn't support RETURNING, so we need to handle it manually
    const withoutReturning = adapted.replace(/\s*RETURNING\s+\*/i, '');
    const info = d.prepare(withoutReturning).run(...params);

    if (isInsert) {
      // For inserts, we need to get the last inserted row
      // Find the table name
      const tableMatch = text.match(/INSERT\s+INTO\s+(\w+)/i);
      if (tableMatch) {
        const table = tableMatch[1];
        // Try to find by rowid
        const row = d.prepare(`SELECT * FROM ${table} WHERE rowid = ?`).get(info.lastInsertRowid);
        return { rows: row ? [row] : [], rowCount: 1 };
      }
    }

    if (isUpdate) {
      // For updates, try to find the updated row - the last param is usually the ID
      const tableMatch = text.match(/UPDATE\s+(\w+)/i);
      if (tableMatch) {
        const table = tableMatch[1];
        const lastParam = params[params.length - 1];
        const row = d.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(lastParam);
        return { rows: row ? [row] : [], rowCount: info.changes };
      }
    }

    return { rows: [], rowCount: info.changes };
  }

  const info = d.prepare(adapted).run(...params);
  return { rows: [], rowCount: info.changes };
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { query, closeDb, getDb };
