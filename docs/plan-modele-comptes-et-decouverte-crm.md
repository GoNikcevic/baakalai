# Plan · Modèle comptes/deals/contacts et découverte d'architecture CRM

> Document de travail, arbitrages Goran du 2026-09-28. À relire avant d'ouvrir le premier lot.

## 1. Le problème d'origine

baakalai ne connaît pas la dimension compte/société. Il n'existe qu'une table `opportunities` où **une ligne = un contact**, avec `company` en texte libre et l'état du deal écrit sur cette même ligne.

Constats vérifiés dans le code :

- L'import Salesforce ne lit que des `Contact` (`routes/crm.js:827`, `lib/crm-sync.js:103`). `salesforce.listAccounts()` existe (`api/salesforce.js:842`) mais n'est appelée nulle part.
- `lib/deal-lifecycle-sync.js:49-50` jette toute Opportunity sans contact primaire (`if (!personId) continue`), et rattache uniquement par `crm_contact_id`. `deal.accountId` est remonté (`api/salesforce.js:163`) puis jamais utilisé.
- Un « client » est une ligne contact avec `status = 'won'` (`lib/churn-scoring.js:179`). Un client est donc une personne, pas un compte.
- Le rattrapage de contact role (`api/salesforce.js:182-200`) ne sauve que les comptes à **exactement un** contact emailable. Au-delà, le deal n'est rattaché à personne.
- Le diagnostic public note un CRM entier sur un seul objet : `listDealsForDiagnostic` fait un `SELECT ... FROM Opportunity` (`api/salesforce.js:236`).

Conséquences : un compte sans contact emailable n'existe pas, plusieurs deals sur un compte s'écrasent, le revenu par client est sous-estimé, et `icp_crm_seat_count` reste NULL.

**Rayon d'impact** : `opportunities` est référencée 295 fois dans 77 fichiers backend, et 15 tables portent une FK `opportunity_id`.

## 2. Décisions arrêtées (Goran, 2026-09-28)

| # | Sujet | Décision |
|---|---|---|
| 1 | Modèle | **3 niveaux** : compte / deal / personne. Un compte porte N deals, dont un gagné et un ouvert simultanément |
| 2 | Décideur | **CRM d'abord**, déduction titre + récence en secours, correction manuelle possible |
| 3 | Ciblage envoi | **Compte, multi-threading coordonné** : un fil par compte, plusieurs destinataires, messages différenciés par rôle |
| 4 | Périmètre | **Plan découpé en lots**, arbitrage Goran avant chaque lot |
| 5 | Découverte | Objets standards **et** custom détectés, mais un objet custom n'est jamais interprété seul : signalé, mappé par l'utilisateur |
| 6 | Validation | **Écran de lecture** préremplit les déductions avec leurs preuves, l'utilisateur valide en un clic ou corrige |
| 7 | Diagnostic public | **Même moteur de découverte**, avec sa lecture annoncée dans le rapport |

## 3. Modèle cible

- **`accounts`** : la société. État durable (prospect / client / churné), CA cumulé, score de churn, owner. Clé `crm_account_id`.
- **`deals`** : une vente rattachée à un compte. Stage, montant, won/lost, dates, stagnation, `primary_contact_id` nullable. N par compte.
- **`opportunities`** devient la table des personnes : rattachée à un compte, avec `account_role` (décideur / utilisateur / prescripteur), `role_source` (crm / inferred / manual), `is_primary_contact`. Seul niveau qui porte un email.

Recâblage des 4 jobs :

- Réactivation : deal ouvert stagnant, on écrit au bon contact de son compte
- Upsell : compte avec au moins un deal gagné et zéro deal ouvert
- Churn : compte client silencieux, agrégé sur tous ses contacts et tous ses deals
- Cleaning : doublons de comptes autant que de contacts, plus les contacts orphelins

## 4. Le moteur de découverte

Le modèle à 3 entités dit **où ranger**. Le moteur de découverte dit **comment reconnaître**. Deux Salesforce au schéma identique peuvent être utilisés de façon opposée : un client peut être un Account avec `Type = Customer`, une Opportunity gagnée, un `Contrat__c`, ou un pipeline Pipedrive nommé « Clients ». Aucune règle codée en dur ne survit à ça.

Cinq étapes :

1. **Inventaire d'usage, pas de schéma.** Quels objets, pipelines et stages existent *et contiennent des données récentes*. Un objet à zéro ligne depuis 24 mois est du décor et ne pèse dans aucune déduction.
2. **Profilage de chaque champ** : taux de remplissage, cardinalité, distribution, format, corrélation aux dates. Un champ rempli à 3 % est du bruit. Une picklist à 4 valeurs présente sur 90 % des lignes est un axe de cycle de vie.
3. **Inférence sémantique** : quel objet joue la société, la personne, l'affaire ; quel champ porte le cycle de vie, le montant, la date de vérité. Passage Claude **sur le profil agrégé, jamais sur les données brutes** (RGPD, et coût tokens divisé par cent).
4. **Restitution et validation** : chaque déduction affichée avec sa confiance et sa preuve (« `Type = Customer` marque tes clients, parce que 87 % des comptes qui le portent ont au moins une Opportunity gagnée »). Correction stockée, versionnée, faisant autorité.
5. **Détection de dérive** : reprofilage périodique. Nouveau champ rempli à 60 %, distribution de stages qui bascule : on signale.

**Conséquence architecturale** : tous les jobs lisent le mapping résolu, plus jamais un nom de champ en dur. `IsWon` → client est aujourd'hui dans le code ; ce sera demain une résolution, différente par tenant.

**Garde-fou** : la découverte assiste, elle ne décide pas seule. Confiance haute, on applique et on montre. Confiance moyenne, on applique et on demande confirmation. Confiance basse, on demande.

### Existant réutilisable

- `crm_field_mappings` (migration 038) : la bonne idée, trop étroite. `baakalai_field` ne couvre que `product_line` et `status`.
- `lib/crm-field-mapper.js:16` : introspection réelle mais limitée à **l'objet Contact** sur **3 providers**.
- `salesforce.getContactFields()` (`api/salesforce.js:483`) : code mort, le mappeur réimplémente le même appel en ligne. À supprimer ou à réutiliser, pas les deux.

### Objets compte par provider

| CRM | Objet | État |
|---|---|---|
| Salesforce | `Account` | `listAccounts()` écrite, jamais appelée |
| HubSpot | `companies` | endpoint déjà utilisé pour le diagnostic (`api/hubspot.js:512`) |
| Odoo | `res.partner` `is_company` | `parent_id` déjà lu (`api/odoo.js:87`) |
| Folk | `/companies` | déjà présent (`api/folk.js:70`) |
| Pipedrive | `organizations` | `org_id` disponible, endpoint à écrire |
| Notion / Airtable | aucun | compte synthétisé depuis le nom de société |

## 5. Les lots

### Lot 0 · Mesurer

Script en lecture seule sur la prod : combien de comptes distincts derrière les 443 opportunités, combien de variantes de nom par compte, combien d'Opportunities Salesforce jetées aujourd'hui par le `continue` de `deal-lifecycle-sync.js:50`.

Ajouté après la répartition des colonnes (§9) : taux de remplissage des 55 colonnes de `opportunities`, clés réellement présentes dans le JSONB `data`, taux de remplissage de `timing`, et nombre de devises distinctes derrière les montants. Ces quatre mesures conditionnent le périmètre du lot 4.

Sans ces chiffres, la dette de dédup se découvre au pire moment. Coût : une demi-journée. Risque : nul.

### Lot 1 · Moteur de découverte (socle)

Profilage et inférence sur les objets standards, détection et signalement des objets custom, table de mapping résolu versionnée par tenant, écran de lecture. Les connecteurs ne changent pas encore, le moteur tourne en observation et on compare ses déductions au comportement actuel.

**Risque : moyen.** Il tourne à vide, rien ne dépend encore de lui.

### Lot 2 · Table `accounts` et import des comptes

Migration `accounts` (`UNIQUE (user_id, crm_provider, crm_account_id)`), plus `opportunities.account_id`. Import des comptes alimenté par le mapping résolu du lot 1. Le SOQL Salesforce doit ajouter `Contact.AccountId` : aujourd'hui `api/salesforce.js:444` ne lit que `Account.Name`, l'identifiant est jeté. Backfill de l'existant par nom normalisé, écrasé par le vrai `crm_account_id` au premier import.

Porte aussi `accounts.crm_created_at` (§9.6) : `listAccounts()` remonte déjà `CreatedDate`, il n'y a que la colonne à créer et à brancher. C'est ce qui répare `icp_crm_history_months`, aujourd'hui calculé sur le contact le plus ancien et donc sous-estimé.

**Impact UI et jobs : zéro, purement additif. Risque : faible**, sauf la dédup des noms sur les CRM sans identifiant de compte. C'est le lot qui rend les clients de William visibles.

### Lot 3 · Rôles de contact et contact principal

`account_role`, `role_source`, `is_primary_contact`. `OpportunityContactRole` est déjà requêté (`api/salesforce.js:150`) mais utilisé comme simple booléen de rattachement : on en garde le rôle. Heuristique titre + récence en secours. Regarder `lib/contact-scoring.js` avant d'en écrire une nouvelle.

**Risque : moyen**, bien isolé. Livrable après le lot 2 sans attendre le 4.

### Lot 4 · Table `deals` et désolidarisation du contact

Le cœur, et le lot dangereux. `status`, `deal_value`, `won_date`, `lost_date`, `lost_reason`, `crm_stage`, `planned_followup_date` déménagent vers `deals`. `deal-lifecycle-sync.js` réécrit : rattachement par `accountId` d'abord, `personId` ensuite, plus jamais de `continue` silencieux. Les FK de `opportunity_stage_history`, `churn_score_history` et `churn_outcomes` migrent vers `deal_id`.

**Risque : élevé.** Méthode imposée : double écriture (les colonnes restent sur `opportunities`, alimentées en lecture seule depuis `deals`), bascule des lecteurs, puis suppression au lot 8. Pas de big bang.

### Lot 5 · Jobs recâblés au compte

Churn scoré par compte et agrégé (`churn_score` déménage vers `accounts`). Upsell, réactivation, déclencheurs d'automatisation et `icp_crm_seat_count` repointés.

**Risque : élevé sur le churn.** Les seuils de `lib/churn-scoring.js` sont calés sur un contact silencieux. Un compte à 5 contacts ne l'est pas dans les mêmes conditions : recalibrage obligatoire, sinon inondation de fausses alertes.

### Lot 6 · Envoi multi-threadé au niveau compte

`sequence_enrollments` passe au compte, avec une table de destinataires. Le dedup email (fenêtres 2h / 7j, règle 4 du CLAUDE.md) passe du contact au compte, plus un plafond de cadence par compte tous destinataires confondus. Messages différenciés par rôle mais cohérents entre eux. `conversation-autopilot` doit suspendre les autres fils du compte dès qu'un contact répond.

**Risque : très élevé sur la délivrabilité.** Trois destinataires au même domaine la même semaine est un motif de spam.

### Lot 7 · UI, analytics et diagnostic public

Fiche Compte (l'écran qui manque aujourd'hui). `ClientsPage`, `ClientsToUpsellPage`, `ChurnPage`, `DealsToReactivatePage` passent en listes de comptes. `DataQualityPage` gagne les doublons de comptes. Analytics par compte. Le diagnostic public bascule sur le moteur de découverte et annonce sa lecture dans le rapport. Clés i18n fr et en dans le même commit.

### Lot 8 · Nettoyage

Suppression des colonnes deal mortes sur `opportunities`. Renommage `opportunities` vers `contacts` **optionnel** : 295 occurrences, à faire avec une vue de compatibilité, jamais avec un script de remplacement (cf. ce qu'une purge automatisée a coûté sur la landing, commit `1f5a1fb`).

## 6. Séquencement livrable

- **0 → 1 → 2 → 3** débloque William et le calcul ICP sans rien casser. Peut partir sur staging sans attendre la suite.
- **4 → 5** est le vrai chantier de migration.
- **6 → 7** est un projet à part entière, à ne pas lancer avant que le lot 5 soit stabilisé en prod.

## 7. Risques transverses

1. ~~**Dédup des comptes** : le tueur silencieux de qualité.~~ **Mesuré nul le 2026-09-29** : 0 variante de nom sur 226 comptes (§10.2). Le risque reste théoriquement réel pour de futurs tenants, mais ne justifie plus d'investissement au lot 2. Une normalisation simple suffit.
2. **Recalibrage du churn** au lot 5.
3. **Cadence d'envoi par compte** au lot 6.
4. **Sessions parallèles** : ne jamais faire `git add .`, committer uniquement ses propres chemins, envisager un worktree.
5. **Numérotation des migrations** : vérifier par un `git pull origin staging` avant de numéroter. La mémoire de session indique la 120 prise sur staging, ce checkout s'arrête à 119.
6. Tout part sur **staging**. `main` uniquement sur feu vert explicite de Goran.

## 8. Arbitrages du 2026-09-29

Les trois questions ouvertes du 28/09 sont tranchées.

### 8.1 Compte sans contact emailable : importé et marqué injoignable

Le compte entre dans `accounts` avec un indicateur d'injoignabilité (aucun contact rattaché portant un email valide). Il compte dans le CA, les analytics, le pipeline et le calcul ICP. Aucun job d'envoi ne le cible.

Conséquences à tenir :

- L'indicateur est **dérivé, pas saisi** : il se recalcule à chaque import et dès qu'un contact du compte gagne ou perd un email. Le stocker en colonne est un cache, la vérité reste le rattachement des contacts.
- Tout job d'envoi (lots 5 et 6) filtre dessus explicitement. Un compte injoignable qui remonte dans une file d'envoi est un bug, pas un cas limite.
- Il faut une sortie produit : « N comptes sans interlocuteur, ajoutez un contact ». C'est le lot 7, mais le compteur existe dès le lot 2.
- C'est le cas des 308 Opportunity Salesforce de William rattachées à aucun contact : elles deviennent visibles au lot 2, avant même que `deals` existe.

### 8.2 Cadence d'envoi par compte : réglable par campagne, défaut 2 par semaine

Un plafond de messages par compte et par semaine, tous destinataires confondus, exposé dans les paramètres de campagne, initialisé à **2**.

- Le plafond porte sur le **compte**, pas sur la séquence : deux campagnes différentes qui touchent le même compte se partagent le même quota.
- Plancher de bon sens retenu par défaut : **1 message par contact et par semaine**, et jamais deux destinataires du même compte le même jour. Ces deux règles ne sont pas exposées dans l'UI, elles sont dures. À confirmer avant d'écrire le lot 6.
- Le réglage rejoint le dedup email existant (règle 4 du CLAUDE.md, fenêtres 2h et 7j) qui passe du contact au compte au lot 6.
- Point de vigilance : un plafond réglable veut dire un plafond qu'un utilisateur peut monter à 10. Prévoir une borne haute dure et un avertissement de délivrabilité dans l'UI, sinon le réglage devient le moyen de se faire blacklister.

### 8.3 CSV sans société : regroupement par domaine email, sinon un compte par ligne

Pour les contacts sans `crm_provider` :

1. Si l'email porte un domaine d'entreprise, le compte est déduit du domaine. Les contacts partageant le domaine rejoignent le même compte.
2. Si le domaine est grand public (gmail, outlook, hotmail, yahoo, free, orange, wanadoo, icloud et le reste de la liste) ou si le contact n'a pas d'email, on crée **un compte dédié à la ligne**.

Dans les deux cas le compte est marqué `origin = 'derived'` avec une confiance faible : il est fusionnable par la dédup du lot 2 et écrasable par un vrai `crm_account_id` si le contact est plus tard rapproché d'un compte CRM.

À tenir : la liste des domaines grand public doit être une constante partagée, pas une regex recopiée à trois endroits. Vérifier si `lib/` en contient déjà une avant d'en écrire une.

## 9. Répartition des colonnes au lot 4

Relevé sur le schéma réel : `opportunities` porte **55 colonnes** (`backend/db/sqlite-adapter.js:334-391`, miroir des migrations). La liste courte du lot 4 (`status`, `deal_value`, `won_date`, `crm_stage`) est un raccourci : elle ne couvre ni les dates, ni l'owner, ni la géo, et surtout elle ne dit rien des champs qui doivent exister à **plusieurs** niveaux à la fois. Le lot 4 ne peut pas s'ouvrir sans ce tableau.

### 9.1 Vont au compte

| Colonne | Destination | Note |
|---|---|---|
| `company` | `accounts.name` | Texte libre aujourd'hui. C'est la matière première de la dédup |
| `company_size` | `accounts.company_size` | Attribut de la société, jamais de la personne. Entre dans le calcul ICP |
| `city`, `country` | `accounts.city`, `accounts.country` | Référence au niveau compte, **mais la colonne reste sur le contact en nullable** : un commercial terrain ou une filiale ne sont pas au siège. Analytics géographie lit le compte, retombe sur le contact si NULL |
| `churn_score`, `churn_factors`, `churn_scored_at`, `churn_flagged_at` | `accounts.*` | Déjà acté au lot 5, avec le recalibrage des seuils |

### 9.2 Vont au deal

| Colonne | Note |
|---|---|
| `status` | Le statut normalisé (open / won / lost) |
| `deal_value` | Voir 9.5 : sans devise, la somme au niveau compte est fausse |
| `won_date`, `lost_date`, `lost_reason`, `lost_reason_source` | |
| `renewal_date` | |
| `crm_deal_id`, `hubspot_deal_id` | |
| `crm_stage`, `crm_stage_id`, `crm_stage_changed_at` | |
| `reactivated_at`, `reactivated_from_email_id` | Sur le deal, plus un `reactivated_contact_id` : sinon on sait qu'un deal est réactivé sans savoir par qui |
| `planned_followup_date`, `planned_followup_reason` | **Scission, pas déplacement.** Voir 9.4 |

### 9.3 Restent sur le contact

`name`, `title`, `email`, `linkedin_url`, `crm_contact_id`, `hubspot_contact_id`, `crm_created_at`, `email_bounced_at`, `email_bounce_reason`, `sequence_stopped_at`, `sequence_stop_reason`, `autopilot_enabled`, `personalization`, `batch_number`, `campaign_id`, `score`, `score_breakdown`.

Deux réserves :

- `campaign_id` bascule au compte au lot 6 (enrôlement multi-threadé). Ne pas le figer au lot 4.
- `score` / `score_breakdown` restent au contact, **définitivement** (arbitrage Goran 2026-09-29) : le lead score qualifie une personne, pas une société. Ne pas rouvrir au lot 5 ; seul le churn déménage au compte.

### 9.4 Les champs qui doivent exister aux trois niveaux

C'est le vrai piège du lot 4, et ce que la liste courte masquait.

**L'owner.** Un vrai CRM en porte trois : `Account.OwnerId`, `Opportunity.OwnerId`, `Contact.OwnerId`, régulièrement différents (un compte à l'account manager, l'affaire au commercial, le contact à personne). baakalai n'a qu'un jeu de colonnes (`owner_id`, `owner_email`, `crm_owner_id`, migration 035), NULL sur 100 % des lignes de prod. Il en faut trois, le compte faisant autorité pour l'attribution commerciale et pour `icp_crm_seat_count`.

**La dernière activité.** `last_activity_at` est aujourd'hui unique et sert à la fois au churn et à la stagnation. Il en faut trois : dernière activité du contact, dernière activité du deal, dernière activité du compte (le max des deux, plus ce qui est rattaché directement au compte). **C'est la racine du recalibrage du churn du lot 5** : un compte n'est pas silencieux parce qu'un de ses contacts l'est.

**La relance planifiée.** `planned_followup_date` / `planned_followup_reason` mélange deux choses. Les raisons `crm_sync` et `not_now` portent sur l'affaire, donc sur le deal. Les raisons `post_send_cooldown` et `reply_requested_date` portent sur la personne : on vient de lui écrire, ou elle a demandé une date. Au lot 6, envoyer à trois contacts d'un compte sans cooldown par personne est exactement le scénario spam. À scinder en `deals.planned_followup_date` et `contacts.cooldown_until`.

**Le technique.** `user_id`, `team_id`, `created_at`, `updated_at`, `crm_provider` sur les trois tables. `crm_push_state` aussi : on pousse des champs de compte, de deal et de contact séparément, un état de push unique ne peut pas les représenter.

**`data` (JSONB fourre-tout).** À auditer avant de scinder. Répartir son contenu au jugé revient à déplacer de la donnée au mauvais niveau sans que rien ne casse visiblement. Le lot 0 doit en sortir les clés réellement présentes en prod et leur taux de remplissage.

### 9.5 Colonnes qui n'existent nulle part et que le lot 4 doit créer

Trois constats vérifiés dans le code :

1. **Il manque deux dates de création sur trois.** La migration 113 a ajouté `crm_created_at`, mais son commentaire est explicite : c'est la date de création **du contact**. Voir 9.6 : c'est le sujet le plus rentable du chantier.

2. **La date de clôture prévue n'existe pas non plus.** `CloseDate` est lu par Salesforce (`api/salesforce.js:164`) et HubSpot (`api/hubspot.js:234`), puis jeté. C'est le champ de forecast. Conséquence déjà en production : `routes/analytics.js:1193` lit `o.close_date`, une colonne inexistante, donc la branche est morte et l'export renouvellement retombe toujours sur `won_date + 365 jours` ou `updated_at + 365 jours`. Bug silencieux, réparé par la création de la colonne.

3. **`deal_value` n'a pas de devise.** Pipedrive remonte la vraie (`api/pipedrive.js:270`), Salesforce et HubSpot la codent en dur à `'EUR'` (`api/salesforce.js:245`, `api/hubspot.js:496`). Tant qu'un montant vivait sur une ligne de contact, l'approximation passait. Au niveau compte on **somme** du CA : mélanger EUR et USD produit un chiffre faux et affiché. `deals.currency` obligatoire au lot 4.

À créer, donc :

- `deals` : `crm_created_at`, `crm_updated_at`, `close_date`, `currency`, `crm_pipeline_id`, `crm_pipeline_name`
- `accounts` : `crm_account_id`, `crm_created_at`, `reachable`, `origin`, `origin_confidence`
- `contacts` : `account_role`, `role_source`, `is_primary_contact` (déjà prévus au lot 3), `cooldown_until`

### 9.6 Les trois dates de création (arbitrage Goran 2026-09-29)

Une date de création par niveau, parce qu'elles répondent à trois questions différentes.

| Colonne | Répond à | Sert à | Statut |
|---|---|---|---|
| `accounts.crm_created_at` | Depuis quand ce client est chez eux | Ancienneté CRM réelle, critère ICP, séniorité du compte | **À créer, lot 2** |
| `deals.crm_created_at` | Depuis quand cette affaire est ouverte | Stagnation, vitesse de pipeline, cycle de vente moyen | À créer, lot 4 |
| `contacts.crm_created_at` | Depuis quand on connaît cette personne | Récence du contact, fraîcheur de la donnée | Existe (migration 113) |

**Pourquoi celle du compte est la plus rentable.** `lib/icp-signals.js:71` et `:113` calculent `icp_crm_history_months` sur `min(opportunities.crm_created_at)`, donc sur le contact le plus ancien. Or un contact est créé en même temps que son compte ou après, jamais avant : la mesure **sous-estime systématiquement** l'ancienneté. Sur un critère « ≥ 12 mois d'historique CRM », sous-estimer produit précisément le faux négatif que l'en-tête du fichier dit vouloir éviter. Un compte ouvert il y a six ans dont les contacts ont été réimportés l'an dernier ressort à 12 mois et se fait disqualifier.

**Le connecteur Salesforce est déjà prêt.** `listAccounts()` sélectionne `CreatedDate` et le mappe en `createdAt` (`api/salesforce.js:845`, `:857`). Aucune modification de la couche API : il n'y a que la colonne et le branchement. C'est pour ça que cette date arrive au **lot 2**, avec l'import des comptes, et pas au lot 4. Le calcul ICP est donc réparable avant d'ouvrir le lot dangereux.

**Réserve.** Sur les CRM sans objet société (Notion, Airtable) et sur les comptes dérivés d'un domaine email (§8.3), cette date n'existe pas : elle reste **NULL**. `icp_crm_history_months` retombe alors sur la date de contact. Chaîne compte puis contact, jamais de date fabriquée, conformément à la règle « NULL veut dire inconnu, jamais zéro » déjà posée dans `icp-signals.js`.

### 9.7 À supprimer, pas à déplacer

- `status_color` : le frontend le recalcule de toute façon depuis `status` via `statusColorMap` (`frontend/src/services/api-client.js:305`). Colonne morte.
- `timing` : reliquat de l'ère prospection, distinct du `timing` des séquences. À confirmer par son taux de remplissage au lot 0 avant de la retirer.

## 10. Résultats du lot 0 (mesuré en prod le 2026-09-29)

Mesures en lecture seule sur `wbxmdchrsceaibhjtwxl`, requêtes agrégées uniquement.

### 10.1 La forme des données

| Mesure | Valeur |
|---|---|
| Lignes dans `opportunities` | 443, sur 3 tenants |
| Comptes distincts après normalisation du nom | **226** |
| Contacts par compte | 1,95 en moyenne, **36 au maximum** |
| Comptes multi-contacts | 47 sur 226 |
| Comptes sans aucun contact emailable | **5** |
| Lignes sans société | 2 (Notion) |

Par provider : CSV 203 lignes pour 30 comptes (112 sans email), Notion 173 lignes pour 168 comptes, Salesforce 67 lignes pour 31 comptes.

### 10.2 Quatre résultats qui changent le plan

1. **La dédup de noms n'existe pas.** 226 groupes normalisés, **0 variante**, maximum une orthographe par compte. Le risque numéro 1 de la section 7 est empiriquement nul sur les données actuelles. Réserve : mesuré sur 3 tenants, donc pas prouvé en général. Conséquence : ne pas surdimensionner le moteur de fusion au lot 2, une normalisation simple suffit aujourd'hui.

2. **Le JSONB `data` est vide.** 203 lignes le portent, **zéro clé** dedans. Rien à auditer, rien à répartir. Le point de vigilance de §9.4 tombe.

3. **16 colonnes sur 55 sont à 0 %** : `crm_deal_id`, `renewal_date`, `lost_reason`, `lost_reason_source`, `planned_followup_date`, `planned_followup_reason`, `reactivated_at`, `reactivated_from_email_id`, `sequence_stopped_at`, `sequence_stop_reason`, `email_bounced_at`, `email_bounce_reason`, `hubspot_contact_id`, `hubspot_deal_id`, `team_id`, `personalization`. Le lot 4 déplace surtout des colonnes vides : **le risque de double écriture est nettement plus faible que ce que dit §5**. À réévaluer avant d'ouvrir le lot.

4. **`crm_deal_id` est NULL sur 443 lignes sur 443.** Aucun deal CRM n'a jamais été rattaché en production, tous providers confondus. Ce n'est pas propre au tenant Salesforce.

### 10.3 Décisions confirmées par la mesure

- `timing` remplie à 0,7 % (3 lignes) : suppression confirmée, §9.7 fermé.
- `status_color` remplie à 0,7 % : suppression confirmée.
- `city` et `country` à 0,7 % : l'analytics géographie tourne sur 3 lignes. À signaler, hors périmètre de ce chantier.
- 5 comptes injoignables : l'arbitrage §8.1 est validé à coût quasi nul.
- Un compte à 36 contacts : c'est lui qui dira si le multi-threading du lot 6 tient, et il confirme que le compte « inconnu » partagé écarté en §8.3 aurait été un désastre.
- L'arbitrage §8.3 reste juste mais ne concerne presque personne : les 203 lignes CSV ont toutes une société renseignée. La règle utile est donc **nom de société d'abord**, domaine email ensuite, une ligne par compte en dernier recours.

### 10.4 Ce que la mesure a révélé en dehors du périmètre

- **La migration 113 est en production** (66 lignes portent `crm_created_at` et un owner, toutes Salesforce). La note de `CLAUDE.md` §6 annonçant des owners NULL à 100 % était périmée, corrigée le 2026-09-29.
- **La connexion Salesforce de prod est morte depuis le 2026-09-24.** Refus de Salesforce au refresh : `invalid_grant · expired access/refresh token`. Aucun correctif code n'est possible, il faut refaire l'OAuth depuis l'app. Rien n'alerte quand une connexion CRM meurt.

### 10.5 Ce qui reste à mesurer

Trois mesures dépendent de l'API Salesforce et sont donc **bloquées par la session morte** : le nombre réel d'Opportunity et combien sont jetées faute de contact primaire, l'écart entre la date de création du compte le plus ancien et celle du contact le plus ancien (donc l'ampleur exacte de la sous-estimation ICP), et le nombre de devises distinctes. Le script est prêt, il tournera dès la reconnexion.

## 11. Reste à arbitrer plus tard

- Plancher par contact du 8.2 (1 par semaine, pas deux destinataires le même jour) : à confirmer à l'ouverture du lot 6.
- Borne haute du plafond réglable.
- Règle de fusion de la dédup de comptes (nom normalisé, domaine, ou les deux) : dépend des chiffres du lot 0.
- Gestion du multi-devise une fois `deals.currency` créé (§9.5) : conversion à un taux figé au moment du deal, ou affichage par devise sans somme ? Question produit, pas technique. À trancher avant d'écrire le lot 4.
- Sort de la colonne `timing` (§9.7) : dépend de son taux de remplissage mesuré au lot 0.

Clos le 2026-09-29 : le lead score reste au contact (§9.3), les trois dates de création sont actées (§9.6).

## 12. Arbitrages UX du 2026-09-29

Le lot 7 (§5) ne faisait que deux phrases. Voici ce qu'il recouvre réellement,
arbitré avec Goran le 29/09 après relecture des écrans sur staging.

### 12.0 Le constat qui déclenche la section

Une seule table porte trois objets, donc **chaque écran ment un peu**.

- La page Deals affichait « 169 deal(s) en cours dans votre CRM » au-dessus de
  169 personnes dont **pas une** ne portait de deal, ni montant, ni étape, ni
  société. Le même mensonge a été servi à un beta testeur le 28/09 :
  `reading_summary_viewed · openDeals 308, dormant 0`.
- Le Dashboard dit « baakalai a relu 169 **comptes** » en parlant de contacts.
- Surtout : **Deals et Clients sont la même liste filtrée sur `status`**. Deux
  entrées de menu, un seul objet. C'est le symptôme visible du modèle manquant.

Correctif d'attente livré le 29/09 (`eb7641a`) : la page dit ce qu'elle liste et
combien portent vraiment un montant. Le chiffre ne change pas, l'affirmation
devient vraie, et le trou devient visible au lieu d'être masqué par un mot.

### 12.1 Trois objets, trois questions

| Objet | La question | Ce qu'il porte |
|---|---|---|
| Compte | avec qui je travaille | la relation, le CA, le silence, le churn |
| Deal | ce qu'il y a à gagner | le montant, l'étape, le dénouement |
| Contact | à qui je parle | le rôle, la joignabilité, le lead score |

Cohérent avec §9.3 (le lead score reste au contact, le churn déménage au compte).

### 12.2 Comptes devient le centre de navigation

**Comptes** est la liste qu'on parcourt, avec ses segments (clients, à upseller,
à risque, injoignables). **Deals** reste la liste qu'on traite. **Contacts**
apparaît, il n'existe nulle part aujourd'hui.

**L'entrée de menu « Clients » disparaît** : être client est l'état d'un compte,
pas un objet. Trois entrées de menu en moins.

Raison : trois des quatre jobs (upsell, churn, cleaning) sont des jobs de compte,
et l'envoi multi-threadé du lot 6 part du compte. Écarté : garder Deals au
centre, qui colle au positionnement mais laisse l'upsell sans écran où se voir.

### 12.3 Un compte est silencieux quand AUCUN de ses contacts n'a bougé

Un contact muet dont le collègue a répondu hier n'est pas un silence.

C'est la règle qui recalibre les quatre tuiles de tête et le churn du lot 5, et
c'est elle qui supprime le gros des fausses alertes : aujourd'hui un compte bien
vivant produit autant de lignes « au point mort » qu'il a de contacts discrets.

Écartées : le silence mesuré sur le deal ouvert le plus récent (un compte client
sans deal ouvert sortirait entièrement du calcul), et sur le contact principal
(dépend entièrement de la fiabilité du rôle déduit au lot 3, et un décideur qui
délègue ferait passer le compte pour mort).

Effet mesuré sur les données du beta testeur : la barre passe de **308 lignes à
52 comptes**. Pour la première fois les chiffres de tête désignent quelque chose
de traitable.

### 12.4 La fiche Compte, l'écran qui manque

En-tête : nom, secteur, owner, CA cumulé, ancienneté. Puis trois blocs.

1. **Ses deals**, ouverts ET gagnés dans le même tableau. C'est là que le job
   upsell devient lisible : un compte avec un deal gagné et un deal ouvert,
   c'est l'upsell, et aujourd'hui c'est invisible.
2. **Ses gens**, avec le rôle et le décideur marqué (lot 3).
3. **Le fil**, un seul fil chronologique tous contacts confondus. Sans lui le
   multi-threading du lot 6 est illisible : trois personnes relancées sur le même
   compte, réparties sur trois fiches, personne ne voit ce que baakalai a dit.

### 12.5 L'écran de lecture d'archi CRM reprend un patron déjà validé

Ne rien inventer. Reprendre exactement « Votre pipeline, vu par baakalai » :
une ligne par déduction, un badge d'origine (« votre CRM le dit » / « baakalai a
déduit »), une phrase de justification, corrigeable, et gelé dès qu'on l'a
corrigé.

Ce patron a été exercé en conditions réelles le 29/09 sur le Pipedrive de Goran :
**six étapes sur six correctement rangées**, confiance calibrée (0.75 sur
« Prospect Qualified », la seule vraiment ambiguë ; 0.98 sur « Negotiations
Started »). Il tiendra sur « quel objet joue la société chez toi ».

### 12.6 Ce qui se voit à chaque lot

| Lot | Ce qui change à l'écran |
|---|---|
| 2 · comptes | Rien, **sauf une chose à faire tout de suite** : la société devient un lien vers une fiche compte minimale. Sinon les comptes existent en base et nulle part pour l'utilisateur. |
| 3 · rôles | Un badge « Décideur » sur les contacts. |
| 4 · deals | La page Deals bascule sur les deals. Le titre arrête de mentir. |
| 5 · jobs | Les quatre tuiles passent au silence de compte. Gros changement de chiffres, à annoncer au user. |
| 6 · envoi | Le fil unique par compte devient obligatoire, pas optionnel. |

### 12.7 Ce que le modèle SUPPRIME, y compris du travail déjà livré

Le rattachement deviné livré le 29/09 (voir le commit `4f36d5c`) est **un
pansement daté**. Un deal se rattache à un **compte**, et Salesforce donne
toujours `AccountId`, y compris quand les `OpportunityContactRoles` sont vides.
Au lot 2, les 308 deals du beta testeur se rattachent **sans une seule
supposition**.

Disparaissent avec lui, et c'est le lot 8 qui les retire :

- la colonne `opportunities.crm_deal_attribution` (migration 123) ;
- la collision « un contact, un deal » et son compteur ;
- le garde-fou `lib/deal-attribution.js` qui interdit de citer dans un email le
  montant d'un deal deviné ;
- l'écran de validation en bloc des rattachements devinés.

À ne pas oublier au lot 8 : ces quatre mécanismes n'ont de sens que tant que le
compte n'existe pas.
