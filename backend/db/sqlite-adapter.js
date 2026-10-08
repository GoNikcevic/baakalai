/**
 * SQLite adapter that provides a pg-compatible interface for testing.
 * Used when DATABASE_PATH is set (test environment).
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { genererDDL, lireSchema } = require('./mirror-from-migrations');

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

/**
 * Le schema du miroir : le bloc ecrit a la main, puis TOUT le reste du schema
 * reel, derive des migrations.
 *
 * Avant le 2026-10-02 il n'y avait que le bloc ci-dessous, et il couvrait 33
 * tables sur les 78 que le schema reel declare. Les 45 absentes n'etaient pas
 * « mal testees », elles etaient INTESTABLES : prospect_activities est touchee
 * par 17 fichiers, signals par 8, notifications par 6,
 * opportunity_product_lines par 9, et aucune requete qui les nommait ne pouvait
 * demarrer. On l'apprenait un test a la fois.
 *
 * L'ordre des deux etapes est ce qui rend le branchement sans risque : tout est
 * en `CREATE TABLE IF NOT EXISTS`, donc le bloc ecrit a la main garde la main
 * sur ses 33 tables et aucun test existant ne change de base sous lui. Le
 * generateur n'ajoute que ce qui manquait. Les details du choix (70 NOT NULL,
 * 32 defauts, refresh_tokens.id) sont dans db/mirror-from-migrations.js.
 */
function initSchema() {
  const d = getDb();
  d.exec(SCHEMA_SQL.replace(/DEFAULT CURRENT_TIMESTAMP/g, `DEFAULT (${MAINTENANT_ISO})`));
  d.exec(genererDDL());
  completerColonnes(d);
}

/**
 * Ajoute aux tables DEJA declarees les colonnes que le schema reel leur donne.
 *
 * ── Pourquoi cette etape existe ─────────────────────────────────────────────
 *
 * Les deux etapes precedentes sont en `CREATE TABLE IF NOT EXISTS`. C'est ce
 * qui rend le branchement sans risque, mais ca a un revers qu'il a fallu se
 * faire montrer par un test : pour les 33 tables du bloc ecrit a la main, c'est
 * le bloc qui gagne, DONC ELLES SONT GELEES. Une migration qui ajouterait
 * demain une colonne a `opportunities` ne l'atteindrait pas, et on serait
 * revenu exactement a la dette qu'on vient de combler · en pire, puisqu'on
 * croirait le probleme regle.
 *
 * Constate sur `memory_patterns.embedding`, la seule colonne dans ce cas
 * aujourd'hui. Une sur une, mais le mecanisme comptait plus que le compte.
 *
 * ── La limite de ALTER TABLE en SQLite ──────────────────────────────────────
 *
 * SQLite n'accepte pas `ADD COLUMN IF NOT EXISTS`, d'ou l'introspection par
 * `pragma_table_info` plutot qu'un essai rattrape · un `catch` muet ici
 * rendrait cette etape indistinguable d'une etape qui ne fait rien.
 *
 * Et il refuse une colonne ajoutee dont le defaut n'est pas une CONSTANTE : ni
 * UUID genere, ni horloge. Ces defauts sont donc retires a l'ajout. Ca ne gene
 * pas : une colonne qui arrive par ALTER n'est jamais une cle primaire, et la
 * seule consequence est qu'elle vaut NULL quand l'appelant ne l'alimente pas,
 * ce qui est deja le cas de toute colonne qu'il ignore.
 */
function completerColonnes(d) {
  const reel = lireSchema();
  const existantes = new Set(
    d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all().map(r => r.name)
  );

  for (const [table, def] of reel.tables) {
    if (!existantes.has(table) || def.colonnes.size === 0) continue;
    const presentes = new Set(d.prepare('SELECT name FROM pragma_table_info(?)').all(table).map(c => c.name));
    for (const colonne of def.colonnes.values()) {
      if (presentes.has(colonne.nom)) continue;
      // Defaut non constant et contraintes retires : seul le nom et le type
      // comptent pour qu'une requete qui nomme la colonne puisse partir.
      let sql = colonne.sql.replace(/\s+PRIMARY KEY/i, '').replace(/\s+UNIQUE/i, '');
      sql = sql.replace(/\s+DEFAULT\s+\(.*\)$/i, '');
      d.exec(`ALTER TABLE ${table} ADD COLUMN ${sql}`);
    }
  }
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
    -- Les desabonnements (migration 120). Absente du miroir, donc la garde
    -- d'opposition de sendPersonalEmail levait « no such table » et TOUT le
    -- transport etait intestable : aucun test ne pouvait verifier qu'un
    -- desinscrit n'est pas recontacte, alors que c'est une obligation RGPD.
    --
    -- La colonne email est NULLABLE et c'est le cas NORMAL : le lien de
    -- desinscription ne porte que le hache, donc au moment du clic on ne
    -- connait pas l'adresse. (Pas d'accent grave ici : ce bloc vit dans un
    -- gabarit JavaScript, un backtick y terminerait la chaine.)
    -- Les boites d'envoi (migration 031, is_default par la 112). Absente du
    -- miroir, donc resolveAccount levait « no such table » et le transport ne
    -- pouvait pas repondre son refus structure « no_email_account ». Le repli
    -- deliberement documente dans email-outbound (une campagne lancee depuis une
    -- boite supprimee doit continuer a partir) n'etait couvert par rien.
    CREATE TABLE IF NOT EXISTS email_accounts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT NOT NULL REFERENCES users(id),
      provider TEXT NOT NULL,
      email_address TEXT NOT NULL,
      access_token TEXT,
      refresh_token TEXT,
      token_expiry DATETIME,
      smtp_host TEXT,
      smtp_port INTEGER,
      smtp_user TEXT,
      smtp_pass TEXT,
      is_default INTEGER DEFAULT 1,
      status TEXT DEFAULT 'active',
      -- Colonnes ajoutees par migration : Microsoft Graph (lecture des reponses
      -- Outlook), signature par boite, et appartenance d'equipe.
      graph_access_token TEXT,
      graph_refresh_token TEXT,
      graph_token_expiry DATETIME,
      signature_text TEXT,
      signature_image TEXT,
      team_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS contact_optouts (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6)))),
      user_id TEXT NOT NULL REFERENCES users(id),
      email TEXT,
      email_hash TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'link',
      user_agent TEXT,
      ip_hash TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

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
   ignorait, d'ou des pans entiers du backend intestables. Les familles
   mecaniques sont desormais traduites (`= ANY($n)`, `::interval`,
   `make_interval(unite => ...)`, `EXTRACT`, `ILIKE`, plus les casts de
   tableaux), et des tests les couvrent.

   `make_interval` s'est ajoutee a la liste le meme jour, en construisant la
   bascule multi-destinataires du lot 6 : 17 occurrences dans quatre fichiers,
   dont celle qui tient la DEDUPLICATION DE REINSCRIPTION. La lecon se repete ·
   on ne decouvre une construction non traduite qu'en ecrivant le test qui
   refuse de demarrer, et son message (« near ">" ») ne nomme pas la cause.

   Deux familles ne sont volontairement PAS traduites ici, et leurs appels ont
   ete reecrits A LA SOURCE le 2026-10-02 · il n'en reste aucun dans le backend :

   · `SELECT DISTINCT ON (...)` · 11 requetes, toutes de la meme forme « la
     derniere ligne par groupe », passees en `ROW_NUMBER() OVER (PARTITION BY
     ...)`, qui marche nativement des deux cotes. Traduire dans l'adaptateur
     aurait demande de couper le `ORDER BY` entre le prefixe de groupe et le
     reste, et une coupe fausse rendrait LA MAUVAISE LIGNE sans rien signaler.
     Une requete qui refuse de demarrer coute une heure ; une requete qui rend
     la mauvaise ligne coute une enquete. D'ou la reecriture une par une, ou
     chaque correction est verifiable · voir tests/distinct-on-rewrite.test.js.

   · `array_agg` · 1 requete (routes/data-quality.js), devenue une seconde
     requete recollee en JS. Postgres rend un TABLEAU et `json_group_array`
     rendrait une chaine JSON : l'appelant qui itere dessus se tromperait en
     silence au lieu d'echouer.

   Si l'une des deux reapparait, la reecrire a la source · ne pas l'ajouter ici.

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
    // `X ± make_interval(days => EXPR)` · la troisieme facon dont ce code ecrit
    // une arithmetique de dates, et la seule qui utilise la syntaxe d'ARGUMENT
    // NOMME de Postgres (`=>`). SQLite la rejette des l'analyse, avec un
    // « near ">" » qui ne dit pas de quoi il parle.
    //
    // DIX-SEPT occurrences dans quatre fichiers, donc une famille et pas un cas
    // isole · d'ou une traduction ici plutot qu'une reecriture par appel.
    // Trouve le 2026-10-02 en testant la bascule multi-destinataires :
    // `enrolledRecently` (lib/automation-enroll.js) n'avait jamais pu
    // s'executer sous le miroir, et c'est elle qui tient la deduplication de
    // reinscription · le garde-fou qui empeche un contact d'entrer deux fois
    // dans le meme workflow.
    //
    // A ce stade de la chaine, les casts sont deja retires et les `$n` sont
    // devenus des `?` : le texte lu ici est `now() - make_interval(days => ? + 7)`.
    .replace(
      /(now\(\)|\?|[\w."]+)\s*([-+])\s*make_interval\s*\(\s*(\w+)\s*=>\s*([^)]+)\)/gi,
      (entier, base, signe, unite, expr) => {
        // SQLite nomme ses unites autrement que make_interval. Une unite
        // inconnue n'est PAS devinee : on rend l'expression telle quelle, ce
        // qui produit une erreur SQL explicite plutot qu'un calcul faux et
        // silencieux sur une duree.
        const UNITES = {
          secs: 'seconds', mins: 'minutes', hours: 'hours',
          days: 'days', months: 'months', years: 'years',
        };
        const u = UNITES[unite.toLowerCase()];
        if (!u) return entier;
        return `strftime('%Y-%m-%dT%H:%M:%fZ', ${base}, '${signe}' || (${expr}) || ' ${u}')`;
      }
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
    const rows = decoderJson(stmt.all(...params));
    return { rows, rowCount: rows.length };
  }

  if (isReturningCols) {
    const stmt = d.prepare(adapted);
    const rows = decoderJson(stmt.all(...params));
    return { rows, rowCount: rows.length };
  }

  if (isReturning) {
    // `UPDATE ... RETURNING *` passe par SQLite, comme `RETURNING <colonnes>`.
    //
    // La reconstitution manuelle qui suivait devinait la ligne modifiee avec
    // `SELECT * FROM <table> WHERE id = <dernier parametre>`, en pariant que le
    // dernier parametre est l'identifiant. Il ne l'est pas toujours :
    // `UPDATE team_members SET role = $1 WHERE team_id = $2 AND user_id = $3`
    // finit sur un user_id, cherche donc `team_members.id = <user_id>`, ne
    // trouve rien et rend `{ rows: [] }` alors que l'ecriture a bien eu lieu.
    // Tout appelant ecrit sur le modele `result.rows[0] || null` lisait null et
    // partait en 404 sous le miroir, en production jamais. Pire cas possible :
    // un identifiant qui matche une autre ligne de la meme table, et le miroir
    // rend alors une ligne fausse sans rien signaler.
    //
    // La branche INSERT garde son chemin historique, celui qui porte les tests
    // existants : l'identifiant y est bien celui de la ligne inseree.
    if (isUpdate) {
      const stmt = d.prepare(adapted);
      const rows = decoderJson(stmt.all(...params));
      return { rows, rowCount: rows.length };
    }

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
        return { rows: decoderJson(row ? [row] : []), rowCount: 1 };
      }
    }

    return { rows: [], rowCount: info.changes };
  }

  const info = d.prepare(adapted).run(...params);
  return { rows: [], rowCount: info.changes };
}

/**
 * Les colonnes JSONB qu'on sait decoder sans ambiguite, et les deux qu'on ne
 * sait pas.
 *
 * ── Le piege qu'on ferme ────────────────────────────────────────────────────
 *
 * Postgres rend une colonne JSONB DEJA DECODEE : `row.settings.stagnant_days`
 * marche. SQLite n'a pas de type JSON et la rend en CHAINE, donc le meme acces
 * vaut `undefined`, SANS erreur, et le code retombe sur son defaut.
 *
 * C'est la pire forme de divergence possible, parce qu'elle est verte :
 * `lib/stagnation.js` rendait toujours 30 jours sous le miroir quelle que soit
 * la valeur enregistree. Le test passait, le defaut etait celui qu'on
 * attendait, et personne n'apprenait que le reglage de l'utilisateur n'etait
 * jamais lu.
 *
 * ── Pourquoi par le NOM de colonne ──────────────────────────────────────────
 *
 * Le resultat d'un SELECT ne dit pas de quelle table vient chaque colonne, et
 * une jointure ou un alias rend la question insoluble en general. Le nom, lui,
 * est dans le resultat. Reste a verifier qu'un nom designe TOUJOURS du JSONB,
 * et c'est la que les deux exceptions apparaissent : sur les 38 noms de
 * colonnes JSONB du schema, 36 ne portent que ce type, mais
 *
 *   - `content` est JSONB dans autopilot_queue et TEXT dans chat_messages ;
 *   - `result` est JSONB dans agent_chain_executions et strategic_results, et
 *     TEXT dans versions.
 *
 * Decoder ces deux-la par le nom transformerait un message de conversation en
 * objet des qu'il ressemble a du JSON. On les laisse donc en chaine : c'est le
 * comportement d'aujourd'hui, donc aucune regression, et `lib/jsonb.js`
 * (`readJsonb`) reste la facon de les lire. La liste des ambigus est VERIFIEE
 * par tests/mirror-coverage.test.js · si une migration rend un troisieme nom
 * ambigu, le test echoue au lieu de laisser le decodage se tromper.
 */
const COLONNES_JSON_AMBIGUES = new Set(['content', 'result']);

let colonnesJsonCache = null;
function colonnesJson() {
  if (!colonnesJsonCache) {
    colonnesJsonCache = new Set();
    for (const nom of lireSchema().colonnesJson) {
      if (!COLONNES_JSON_AMBIGUES.has(nom)) colonnesJsonCache.add(nom);
    }
  }
  return colonnesJsonCache;
}

/**
 * Decode en place les colonnes JSONB des lignes rendues.
 *
 * Ne touche QUE des chaines qui s'analysent en objet ou en tableau : une valeur
 * deja decodee, nulle, numerique ou illisible est laissee telle quelle. Un JSON
 * scalaire valide (« 3 », « "texte" ») n'est pas decode non plus · ce n'est pas
 * ce qu'une colonne JSONB de ce schema contient, et le decoder changerait un
 * type sans rien y gagner.
 */
function decoderJson(rows) {
  if (!rows || rows.length === 0) return rows;
  const aDecoder = colonnesJson();
  // Les noms a decoder sont calcules une fois pour tout le jeu de lignes : les
  // lignes d'un meme resultat ont les memes colonnes.
  const noms = Object.keys(rows[0]).filter(n => aDecoder.has(n));
  if (noms.length === 0) return rows;
  for (const row of rows) {
    for (const nom of noms) {
      const v = row[nom];
      if (typeof v !== 'string') continue;
      const t = v.trim();
      if (!t.startsWith('{') && !t.startsWith('[')) continue;
      try {
        const parsed = JSON.parse(t);
        if (parsed !== null && typeof parsed === 'object') row[nom] = parsed;
      } catch {
        // Une chaine qui commence par une accolade sans etre du JSON reste une
        // chaine · c'est ce que l'appelant verrait de Postgres pour une colonne
        // TEXT, et on ne cherche pas a deviner mieux que lui.
      }
    }
  }
  return rows;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { query, closeDb, getDb };
