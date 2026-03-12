-- =============================================
-- Bakal — Seed Demo Data
-- Inserts realistic demo data for dashboard testing.
-- Run AFTER supabase-schema.sql and supabase-rls-and-extras.sql
--
-- Uses fixed UUIDs so references are predictable and re-runnable.
-- Wrap in a transaction — all or nothing.
-- =============================================

BEGIN;

-- =============================================
-- 1. Demo User
-- =============================================
-- Password hash = bcrypt('demo1234') — replace in production
INSERT INTO users (id, email, password_hash, name, company, role)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'goran@bakal.fr',
  '$2b$10$demohashdemohashdemohaOdemohashdemohashdemohashdemo',
  'Goran Nikcevic',
  'Bakal',
  'admin'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 2. User Profile
-- =============================================
INSERT INTO user_profiles (
  user_id, company, sector, website, team_size,
  description, value_prop, social_proof,
  pain_points, objections,
  persona_primary, persona_secondary,
  target_sectors, target_size, target_zones,
  default_tone, default_formality
)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'FormaPro Consulting',
  'Formation professionnelle',
  'https://formapro-consulting.fr',
  '2-3 personnes',
  'Cabinet de formation professionnelle spécialisé dans la montée en compétences des équipes finance et RH.',
  'Prospection automatisée multi-canal : le résultat d''une agence, sans la complexité.',
  '12 clients accompagnés, 87% de taux de renouvellement, +40% de RDV qualifiés en moyenne',
  'Manque de temps pour prospecter, pas d''expertise en outbound, résultats irréguliers',
  'Trop cher, on a déjà essayé le cold email, on n''a pas le temps de gérer un outil de plus',
  'DAF de PME 11-50 salariés, Île-de-France, sensible au ROI et au gain de temps',
  'Dirigeants de micro-entreprises de formation, France entière, budget limité',
  'Comptabilité & Finance, Formation & Éducation, Conseil & Consulting',
  'PME 11-200 salariés',
  'Île-de-France, Lyon & Rhône-Alpes, France entière',
  'Pro décontracté',
  'Vous'
)
ON CONFLICT (user_id) DO NOTHING;

-- =============================================
-- 3. Projects
-- =============================================
INSERT INTO projects (id, user_id, name, client, description, color, created_at)
VALUES
  (
    'b0000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'FormaPro Consulting',
    'FormaPro Consulting',
    'Prospection multi-cible pour cabinet de formation professionnelle',
    'var(--blue)',
    '2026-01-20T10:00:00Z'
  ),
  (
    'b0000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'TechVision SaaS',
    'TechVision',
    'Lancement produit SaaS — acquisition early adopters B2B',
    'var(--purple)',
    '2026-02-05T09:00:00Z'
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 4. Project Files (for FormaPro)
-- =============================================
INSERT INTO project_files (id, project_id, user_id, filename, original_name, mime_type, file_size, file_path, category, created_at)
VALUES
  ('f0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'brief-formapro.pdf', 'brief-formapro.pdf', 'application/pdf', 245000, '/uploads/brief-formapro.pdf', 'brief', '2026-01-20T10:30:00Z'),
  ('f0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'personas-cibles.docx', 'personas-cibles.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 89000, '/uploads/personas-cibles.docx', 'persona', '2026-01-21T14:15:00Z'),
  ('f0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'ton-de-voix.md', 'ton-de-voix.md', 'text/markdown', 12400, '/uploads/ton-de-voix.md', 'guidelines', '2026-01-22T09:00:00Z')
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 5. Campaigns
-- =============================================

-- Campaign 1: DAF Île-de-France (active, email)
INSERT INTO campaigns (
  id, user_id, project_id, name, client, status, channel,
  sector, sector_short, position, size, angle, zone,
  tone, formality, length, cta,
  start_date, lemlist_id, iteration,
  nb_prospects, sent, planned,
  open_rate, reply_rate, interested, meetings, stops,
  last_collected, created_at
)
VALUES (
  'c0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'DAF Île-de-France',
  'FormaPro Consulting',
  'active',
  'email',
  'Comptabilité & Finance',
  'Comptabilité',
  'DAF',
  '11-50 sal.',
  'Douleur client',
  'Île-de-France',
  'Pro décontracté',
  'Vous',
  'Court (3 phrases)',
  'Question ouverte',
  '2026-01-27',
  'campaign_daf_idf_v4',
  4,
  250, 250, 300,
  68.0, 9.2, 6, 3, 1.2,
  '2026-02-23T08:00:00Z',
  '2026-01-27T09:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

-- Campaign 2: Dirigeants Formation (active, linkedin)
INSERT INTO campaigns (
  id, user_id, project_id, name, client, status, channel,
  sector, sector_short, position, size, angle, zone,
  tone, formality, length, cta,
  start_date, iteration,
  nb_prospects, sent, planned,
  accept_rate_lk, reply_rate_lk, reply_rate, interested, meetings, stops,
  last_collected, created_at
)
VALUES (
  'c0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'Dirigeants Formation',
  'FormaPro Consulting',
  'active',
  'linkedin',
  'Formation & Éducation',
  'Formation',
  'Dirigeant',
  '1-10 sal.',
  'Preuve sociale',
  'France entière',
  'Pro décontracté',
  'Vous',
  'Court',
  'Question ouverte',
  '2026-02-03',
  2,
  152, 152, 200,
  38.0, 6.8, 6.8, 3, 1, 1.2,
  '2026-02-22T08:00:00Z',
  '2026-02-03T09:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

-- Campaign 3: DRH PME Lyon (prep, multi)
INSERT INTO campaigns (
  id, user_id, project_id, name, client, status, channel,
  sector, sector_short, position, size, angle, zone,
  tone, formality, length, cta,
  start_date, iteration,
  nb_prospects, sent, planned,
  created_at
)
VALUES (
  'c0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000001',
  'b0000000-0000-0000-0000-000000000001',
  'DRH PME Lyon',
  'FormaPro Consulting',
  'prep',
  'multi',
  'Conseil & Consulting',
  'Conseil',
  'DRH',
  '51-200 sal.',
  'Offre directe',
  'Lyon & Rhône-Alpes',
  'Formel & Corporate',
  'Vous',
  'Standard',
  'Proposition de call',
  '2026-02-18',
  0,
  187, 0, 187,
  '2026-02-18T09:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 6. Touchpoints (sequence steps)
-- =============================================

-- === Campaign 1: DAF Île-de-France (4 emails) ===
INSERT INTO touchpoints (id, campaign_id, step, type, label, sub_type, timing, subject, body, open_rate, reply_rate, stop_rate, sort_order)
VALUES
  (
    'd0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'E1', 'email', 'Email initial', 'Angle douleur client', 'J+0',
    '{{firstName}}, une question sur votre gestion financière',
    E'Bonjour {{firstName}}, combien d''heures par semaine votre équipe passe-t-elle sur des tâches qui pourraient être automatisées ?\n\nChez {{companyName}}, les cabinets comme le vôtre gagnent en moyenne 12h/semaine...',
    68.0, 4.2, 0.4, 1
  ),
  (
    'd0000000-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000001',
    'E2', 'email', 'Email valeur', 'Case study', 'J+3',
    'Re: gestion financière — un cas concret',
    E'{{firstName}}, je me permets de revenir avec un exemple concret. Le cabinet Nexia Conseil (35 personnes, secteur similaire) a réduit de 40% le temps de reporting...',
    72.0, 3.1, 0.8, 2
  ),
  (
    'd0000000-0000-0000-0000-000000000003',
    'c0000000-0000-0000-0000-000000000001',
    'E3', 'email', 'Email relance', 'Angle différent', 'J+7',
    'Autre approche, {{firstName}}',
    E'{{firstName}}, je change d''approche. Plutôt que de parler d''automatisation, une question simple : quel est le coût réel d''une erreur de saisie dans un bilan chez {{companyName}} ?...',
    55.0, 1.4, 0.0, 3
  ),
  (
    'd0000000-0000-0000-0000-000000000004',
    'c0000000-0000-0000-0000-000000000001',
    'E4', 'email', 'Email break-up', 'Soft close', 'J+12',
    'Dernière tentative, {{firstName}}',
    E'{{firstName}}, je ne veux pas encombrer votre boîte. Si ce n''est pas le bon moment, pas de souci — je ne reviendrai pas. Juste un dernier mot : si un jour 12h/semaine récupérées...',
    48.0, 0.5, 0.0, 4
  )
ON CONFLICT (id) DO NOTHING;

-- === Campaign 2: Dirigeants Formation (2 LinkedIn steps) ===
INSERT INTO touchpoints (id, campaign_id, step, type, label, sub_type, timing, subject, body, max_chars, accept_rate, reply_rate, stop_rate, interested, sort_order)
VALUES
  (
    'd0000000-0000-0000-0000-000000000005',
    'c0000000-0000-0000-0000-000000000002',
    'L1', 'linkedin', 'Note de connexion', 'Max 300 caractères', 'J+0',
    NULL,
    '{{firstName}}, votre parcours dans la formation m''a interpellé. J''accompagne des dirigeants du secteur sur la croissance commerciale — je serais ravi d''échanger avec vous.',
    300, 38.0, NULL, NULL, NULL, 1
  ),
  (
    'd0000000-0000-0000-0000-000000000006',
    'c0000000-0000-0000-0000-000000000002',
    'L2', 'linkedin', 'Message post-connexion', 'Conversationnel', 'J+3',
    NULL,
    E'Merci d''avoir accepté, {{firstName}} !\n\nJ''ai accompagné 3 organismes de formation comme le vôtre à générer entre 5 et 12 RDV qualifiés par mois.\n\nCurieux de savoir comment vous gérez votre développement commercial actuellement ?',
    NULL, NULL, 6.8, 1.2, 3, 2
  )
ON CONFLICT (id) DO NOTHING;

-- === Campaign 3: DRH PME Lyon (4 emails + 2 LinkedIn, no stats) ===
INSERT INTO touchpoints (id, campaign_id, step, type, label, sub_type, timing, subject, body, max_chars, sort_order)
VALUES
  (
    'd0000000-0000-0000-0000-000000000007',
    'c0000000-0000-0000-0000-000000000003',
    'E1', 'email', 'Email initial', 'Offre directe', 'J+0',
    '{{firstName}}, une solution concrète pour vos recrutements',
    'Bonjour {{firstName}}, nous aidons des DRH de PME comme {{companyName}} à réduire de 40% leur temps de recrutement. Seriez-vous disponible 15 minutes cette semaine ?',
    NULL, 1
  ),
  (
    'd0000000-0000-0000-0000-000000000008',
    'c0000000-0000-0000-0000-000000000003',
    'L1', 'linkedin', 'Note de connexion LinkedIn', 'Max 300 chars', 'J+1',
    NULL,
    '{{firstName}}, votre expertise RH chez {{companyName}} m''a interpellé. J''échange régulièrement avec des DRH de PME lyonnaises — je serais ravi de vous compter dans mon réseau.',
    300, 2
  ),
  (
    'd0000000-0000-0000-0000-000000000009',
    'c0000000-0000-0000-0000-000000000003',
    'E2', 'email', 'Email valeur', 'Case study', 'J+4',
    'Re: recrutements — un résultat qui parle',
    '{{firstName}}, un exemple concret : une PME de conseil RH (180 personnes, Lyon) a divisé par 2 ses délais de recrutement en 3 mois...',
    NULL, 3
  ),
  (
    'd0000000-0000-0000-0000-000000000010',
    'c0000000-0000-0000-0000-000000000003',
    'L2', 'linkedin', 'Message LinkedIn', 'Post-connexion', 'J+5',
    NULL,
    'Merci d''avoir accepté, {{firstName}} ! J''accompagne des PME lyonnaises sur l''optimisation RH...',
    NULL, 4
  ),
  (
    'd0000000-0000-0000-0000-000000000011',
    'c0000000-0000-0000-0000-000000000003',
    'E3', 'email', 'Email relance', 'Angle différent', 'J+8',
    NULL,
    '{{firstName}}, une autre manière de voir les choses : combien vous coûte un recrutement raté chez {{companyName}} ?...',
    NULL, 5
  ),
  (
    'd0000000-0000-0000-0000-000000000012',
    'c0000000-0000-0000-0000-000000000003',
    'E4', 'email', 'Email break-up', 'Soft close', 'J+13',
    NULL,
    '{{firstName}}, dernier message de ma part. Si le timing n''est pas bon, aucun souci...',
    NULL, 6
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 7. Diagnostics (AI analysis)
-- =============================================

-- Campaign 1: DAF Île-de-France diagnostics
INSERT INTO diagnostics (id, campaign_id, date_analyse, diagnostic, priorities, nb_to_optimize)
VALUES
  (
    'e0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    '2026-02-22',
    E'E1 — Performant : L''objet personnalisé avec {{firstName}} et la question directe fonctionnent très bien. Taux d''ouverture de 68% au-dessus du benchmark (50%). Le CTA question ouverte génère un bon taux de réponse (4.2%).\n\nE2 — Fort potentiel : Le "Re:" dans l''objet booste l''ouverture à 72% (effet thread). Le case study concret avec des chiffres (40% de réduction) crédibilise le message.\n\nE3 — À optimiser : Baisse significative d''ouverture (55%) et de réponse (1.4%). L''angle "coût de l''erreur" peut être perçu comme anxiogène. Recommandation : tester un angle "gain de temps" plus positif, raccourcir à 2 phrases max.\n\nE4 — Normal pour un break-up : Taux d''ouverture de 48% correct pour un dernier email. Le ton respectueux évite la pression. Aucune modification nécessaire.',
    ARRAY['Optimiser E3 : changer angle anxiogène → gain de temps', 'Raccourcir E3 à 2 phrases max', 'Maintenir E1 et E2 sans modification'],
    1
  )
ON CONFLICT (id) DO NOTHING;

-- Campaign 2: Dirigeants Formation diagnostics
INSERT INTO diagnostics (id, campaign_id, date_analyse, diagnostic, priorities, nb_to_optimize)
VALUES
  (
    'e0000000-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000002',
    '2026-02-21',
    E'L1 — Bon taux d''acceptation : 38% d''acceptation au-dessus du benchmark LinkedIn (30%). Le compliment sur le parcours + positionnement sectoriel fonctionne bien. Pas de pitch dans l''invite = bonne pratique.\n\nL2 — Réponse sous l''objectif : 6.8% de réponse vs objectif de 8%. Le "3 organismes de formation" manque de spécificité. Recommandation : remplacer l''angle preuve sociale par douleur client. Tester : "Quel est votre plus gros frein à trouver de nouveaux clients en ce moment ?"',
    ARRAY['Changer L2 : angle preuve sociale → douleur client', 'Ajouter spécificité au social proof de L2', 'Maintenir L1 sans modification'],
    1
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 8. Versions (campaign iteration history)
-- =============================================

-- Campaign 1: DAF Île-de-France — 4 versions
INSERT INTO versions (id, campaign_id, version, date, messages_modified, hypotheses, result)
VALUES
  (
    'e1000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    1, '2026-01-27',
    ARRAY['E1', 'E2', 'E3', 'E4'],
    'Lancement initial : 4 emails, angle preuve sociale, CTA proposition de call, ton formel. 100 prospects.',
    'neutral'
  ),
  (
    'e1000000-0000-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000001',
    2, '2026-02-03',
    ARRAY['E1', 'E2'],
    'Optimisation objets email (A/B) : "Question rapide sur [secteur]" vs ancien objet générique. Personnalisé gagnant.',
    'improved'
  ),
  (
    'e1000000-0000-0000-0000-000000000003',
    'c0000000-0000-0000-0000-000000000001',
    3, '2026-02-10',
    ARRAY['E1', 'E3'],
    'Passage angle douleur client sur E1 et E3. Remplacement preuve sociale par douleur client + CTA question ouverte.',
    'improved'
  ),
  (
    'e1000000-0000-0000-0000-000000000004',
    'c0000000-0000-0000-0000-000000000001',
    4, '2026-02-17',
    ARRAY['E1'],
    'Test A/B: Douleur vs Douleur+Urgence. Variante B avec angle urgence + objet provocant. Meilleure ouverture mais moins de conversion en RDV.',
    'testing'
  )
ON CONFLICT (id) DO NOTHING;

-- Campaign 2: Dirigeants Formation — 2 versions
INSERT INTO versions (id, campaign_id, version, date, messages_modified, hypotheses, result)
VALUES
  (
    'e1000000-0000-0000-0000-000000000005',
    'c0000000-0000-0000-0000-000000000002',
    1, '2026-02-03',
    ARRAY['L1', 'L2'],
    'Lancement initial : Note de connexion générique + message preuve sociale. 80 premiers prospects.',
    'neutral'
  ),
  (
    'e1000000-0000-0000-0000-000000000006',
    'c0000000-0000-0000-0000-000000000002',
    2, '2026-02-10',
    ARRAY['L1'],
    'Personnalisation note de connexion. Ajout compliment parcours + mention secteur formation. Suppression du lien externe.',
    'improved'
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 9. Cross-Campaign Memory Patterns
-- =============================================
INSERT INTO memory_patterns (id, pattern, category, data, confidence, date_discovered, sectors, targets)
VALUES
  (
    'e2000000-0000-0000-0000-000000000001',
    'Les questions ouvertes en CTA convertissent 2x mieux que les propositions de call directes',
    'Corps',
    '{"avg_reply_rate_question": 8.5, "avg_reply_rate_call": 4.1, "sample_size": 320, "examples": ["Quel est votre plus gros défi en ce moment ?", "Comment gérez-vous [problème] actuellement ?"]}'::jsonb,
    'Haute',
    '2026-02-15',
    ARRAY['Comptabilité & Finance', 'Formation & Éducation'],
    ARRAY['DAF', 'Dirigeant']
  ),
  (
    'e2000000-0000-0000-0000-000000000002',
    'L''angle "douleur client" surperforme la "preuve sociale" de +3.2pts de réponse en moyenne',
    'Corps',
    '{"avg_reply_douleur": 9.2, "avg_reply_preuve": 6.0, "sample_size": 250, "context": "Testé sur segments comptabilité et formation, PME 11-50 sal."}'::jsonb,
    'Haute',
    '2026-02-12',
    ARRAY['Comptabilité & Finance'],
    ARRAY['DAF']
  ),
  (
    'e2000000-0000-0000-0000-000000000003',
    'Les objets email personnalisés avec {{firstName}} ont +12pts d''ouverture vs objets génériques',
    'Objets',
    '{"avg_open_perso": 65.0, "avg_open_generic": 53.0, "sample_size": 400, "best_format": "{{firstName}}, [question ou accroche courte]"}'::jsonb,
    'Haute',
    '2026-02-05',
    ARRAY['Comptabilité & Finance', 'Formation & Éducation', 'Conseil & Consulting'],
    ARRAY['DAF', 'Dirigeant', 'DRH']
  ),
  (
    'e2000000-0000-0000-0000-000000000004',
    'Les emails envoyés le mardi matin (9h-10h) ont +15% d''ouvertures vs autres créneaux',
    'Timing',
    '{"best_day": "mardi", "best_hour": "9h-10h", "worst_day": "lundi", "avg_open_boost": 15, "sample_size": 180}'::jsonb,
    'Moyenne',
    '2026-02-18',
    ARRAY['Comptabilité & Finance'],
    ARRAY['DAF']
  ),
  (
    'e2000000-0000-0000-0000-000000000005',
    'Sur LinkedIn, le compliment parcours + positionnement sectoriel booste le taux d''acceptation de +8pts',
    'LinkedIn',
    '{"avg_accept_with": 38.0, "avg_accept_without": 30.0, "sample_size": 152, "tip": "Toujours mentionner le secteur spécifique du prospect"}'::jsonb,
    'Moyenne',
    '2026-02-10',
    ARRAY['Formation & Éducation'],
    ARRAY['Dirigeant']
  ),
  (
    'e2000000-0000-0000-0000-000000000006',
    'Le segment "Dirigeant / 1-10 sal." en formation a un taux de réponse de 11.3% — segment à fort potentiel',
    'Cible',
    '{"reply_rate": 11.3, "accept_rate": 38, "sample_size": 80, "recommendation": "Lancer campagne dédiée sur cette cible"}'::jsonb,
    'Moyenne',
    '2026-02-16',
    ARRAY['Formation & Éducation'],
    ARRAY['Dirigeant']
  ),
  (
    'e2000000-0000-0000-0000-000000000007',
    'Le "Re:" dans l''objet d''un follow-up booste l''ouverture de +7pts (effet thread)',
    'Objets',
    '{"avg_open_with_re": 72.0, "avg_open_without_re": 65.0, "sample_size": 250, "note": "Fonctionne surtout sur E2, moins sur E3+"}'::jsonb,
    'Haute',
    '2026-02-08',
    ARRAY['Comptabilité & Finance'],
    ARRAY['DAF']
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 10. Opportunities (pipeline prospects)
-- =============================================
INSERT INTO opportunities (id, user_id, campaign_id, name, title, company, company_size, status, status_color, timing)
VALUES
  (
    'e3000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'Sophie Martin', 'DAF', 'Nexia Conseil', '35 sal.',
    'Call planifié', 'var(--success)', 'Demain 14h'
  ),
  (
    'e3000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000002',
    'Thomas Durand', 'CEO', 'FormaPlus', '8 sal.',
    'Intéressé', 'var(--warning)', 'Relance vendredi'
  ),
  (
    'e3000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'Marc Lefèvre', 'DG', 'Audit Express', '22 sal.',
    'Intéressé', 'var(--warning)', 'Attente réponse'
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 11. Reports (weekly performance)
-- =============================================
INSERT INTO reports (id, user_id, week, date_range, score, score_label, contacts, open_rate, reply_rate, interested, meetings, synthesis)
VALUES
  (
    'e4000000-0000-0000-0000-000000000001',
    'a0000000-0000-0000-0000-000000000001',
    'Semaine 4 — Rapport consolidé',
    '10 — 16 février 2026',
    'excellent',
    'Excellent',
    247, 62.0, 8.1, 5, 3,
    'Performance globale en hausse. La campagne "DAF Île-de-France" est votre meilleure performeuse cette semaine avec 9.2% de taux de réponse (+2.1pts vs S3). L''angle "douleur client" continue de surperformer sur le segment comptabilité. La campagne LinkedIn "Dirigeants Formation" progresse mais reste sous les objectifs de réponse (6.8% vs 8% cible). Canaux : L''email reste le canal le plus efficace (62% d''ouverture). LinkedIn montre un potentiel de conversion supérieur (ratio réponse→RDV de 33% vs 22% par email). Prochaine action recommandée : Lancer une campagne hybride Email+LinkedIn sur le segment "Dirigeants PME 11-50" qui combine le reach email et la conversion LinkedIn.'
  ),
  (
    'e4000000-0000-0000-0000-000000000002',
    'a0000000-0000-0000-0000-000000000001',
    'Semaine 3',
    '3 — 9 février 2026',
    'good',
    'Performant',
    220, 58.0, 6.8, 3, 2,
    'Bonne progression du taux d''ouverture grâce à l''optimisation des objets d''email (A/B test gagné : "Question rapide sur [secteur]" +8pts vs ancien objet). Le segment comptabilité confirme son potentiel. Recommandation appliquée S2 (changement d''angle) porte ses fruits.'
  ),
  (
    'e4000000-0000-0000-0000-000000000003',
    'a0000000-0000-0000-0000-000000000001',
    'Semaine 2',
    '27 jan. — 2 fév. 2026',
    'ok',
    'Correct',
    185, 51.0, 5.2, 2, 1,
    'Démarrage solide. Les taux sont dans la moyenne du marché B2B. L''angle "preuve sociale" fonctionne moins bien que prévu sur le segment Formation. Recommandation : tester l''angle "douleur client" sur la prochaine séquence.'
  )
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 12. Chart Data (weekly analytics)
-- =============================================
INSERT INTO chart_data (id, user_id, label, email_count, linkedin_count, week_start)
VALUES
  ('e5000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'S1', 40, 25, '2026-01-27'),
  ('e5000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'S2', 52, 38, '2026-02-03'),
  ('e5000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'S3', 58, 45, '2026-02-10'),
  ('e5000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'S4', 78, 55, '2026-02-17')
ON CONFLICT (id) DO NOTHING;

-- =============================================
-- 13. Chat Thread (sample conversation)
-- =============================================
INSERT INTO chat_threads (id, user_id, title, created_at)
VALUES (
  'e6000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000001',
  'Optimisation campagne DAF',
  '2026-02-20T10:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO chat_messages (id, thread_id, role, content, created_at)
VALUES
  (
    'e7000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000001',
    'user',
    'Comment améliorer le taux de réponse de mon E3 sur la campagne DAF ?',
    '2026-02-20T10:00:00Z'
  ),
  (
    'e7000000-0000-0000-0000-000000000002',
    'e6000000-0000-0000-0000-000000000001',
    'assistant',
    E'Votre E3 a un taux de réponse de 1.4%, ce qui est en dessous de la moyenne. Voici 3 pistes :\n\n1. **Changer l''angle** : l''angle "coût de l''erreur" peut être perçu comme anxiogène. Testez plutôt un angle "gain de temps" plus positif.\n2. **Raccourcir** : visez 2 phrases max au lieu de 3-4 actuellement.\n3. **CTA plus léger** : remplacez la question rhétorique par une question simple et directe.\n\nVoulez-vous que je génère une version optimisée ?',
    '2026-02-20T10:00:30Z'
  )
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- =============================================
-- Verification queries (optional — run to check)
-- =============================================
-- SELECT 'users' AS t, count(*) FROM users
-- UNION ALL SELECT 'projects', count(*) FROM projects
-- UNION ALL SELECT 'campaigns', count(*) FROM campaigns
-- UNION ALL SELECT 'touchpoints', count(*) FROM touchpoints
-- UNION ALL SELECT 'diagnostics', count(*) FROM diagnostics
-- UNION ALL SELECT 'versions', count(*) FROM versions
-- UNION ALL SELECT 'memory_patterns', count(*) FROM memory_patterns
-- UNION ALL SELECT 'opportunities', count(*) FROM opportunities
-- UNION ALL SELECT 'reports', count(*) FROM reports
-- UNION ALL SELECT 'chart_data', count(*) FROM chart_data
-- UNION ALL SELECT 'chat_threads', count(*) FROM chat_threads
-- UNION ALL SELECT 'chat_messages', count(*) FROM chat_messages;
