# PROMPT DE DESIGN, REFONTE DE LA PAGE AUTOMATISATION (baakalai)

Tu vas concevoir puis coder deux livrables distincts :
**(1) la nouvelle page Automatisation**, **(2) le visuel des workflows** (l'éditeur, la carte de workflow, le mode lecture seule).

Lis tout avant de dessiner la première boîte. Les textes français cités entre guillemets sont des textes finaux, recopie-les à l'identique.

---

## 0. CHAÎNES INTERDITES, AVANT TOUTE CHOSE

Ces interdictions valent partout : JSX, fichiers i18n français et anglais, infobulles, emails générés par l'agent, commentaires visibles, et **y compris dans les schémas ASCII de ce document**, parce qu'un développeur recopie le wireframe avant de lire la règle.

1. **« RDV pris », « Rendez-vous pris », « RDV détecté », « rendez-vous détecté »** : interdits. Le seul libellé autorisé est **« Rendez-vous demandé »**, et la phrase de détail est **« Réponse comprise comme une demande de rendez-vous. »**
2. **Aucune date de livraison** dans une raison de grisage. « Pas encore branché » est acceptable. « Bientôt », « en octobre », « dans la prochaine version » ne le sont pas.
3. **Aucun tiret cadratin (U+2014) ni demi-cadratin (U+2013)**, nulle part : ni dans le code, ni dans les chaînes i18n, ni dans les emails produits par le générateur. Utilise la virgule, le deux-points ou la parenthèse. Ajoute cette règle en commentaire en tête de `fr.json` et de `en.json`.
4. **Un seul mot pour un seul objet.** « Workflow » partout. Jamais « parcours », jamais « séquence », jamais « campagne » pour désigner un workflow.

---

## 1. CONTEXTE PRODUIT MINIMAL

baakalai est un agent qui lit le CRM d'une PME B2B (Pipedrive, HubSpot, Salesforce, Odoo, Notion, Airtable, Folk) et agit à la place du dirigeant : relancer un deal qui ne bouge plus, repérer un upsell, prévenir un départ client. Cible : patron ou commercial d'une boîte de 5 à 200 personnes, pas d'équipe RevOps, pas de temps.

Trois objets structurent la page :

- **Déclencheur** : la situation qui fait démarrer quelque chose (« un deal n'a pas bougé depuis 30 jours »).
- **Workflow** : la suite d'étapes qui se déroule ensuite (email, visite LinkedIn, réponse automatique, note dans le CRM). **Cet objet n'existe pas encore en base, la section 3 dit comment il naît et ce que l'écran affiche tant qu'il n'existe pas.**
- **Sortie** : le contact quitte le workflow, toujours pour une raison typée (il a répondu, il a demandé un rendez-vous, il s'est désabonné, vous l'avez retiré). **Le motif de sortie est l'unité de compte de toute la page.**

**État réel de la production au 22/09/2026 :** 15 comptes, 1 seul déclencheur créé, 0 email envoyé depuis l'origine, 0 workflow en cours, 320 signaux détectés dont 0 traité, 1 seule boîte mail connectée sur les 15 comptes.

Conséquence directe : **les états vides ne sont pas un cas limite, ce sont les écrans par défaut de 14 comptes sur 15.** Ils portent la moitié du travail de design. Un état vide bâclé rend la page hostile.

---

## 2. RÈGLES NON NÉGOCIABLES

1. **Zéro chiffre simulé.** Pas de donnée de démonstration, pas de courbe à plat, pas de tendance « +0 % », pas de graphique vide avec ses axes. Un compteur à zéro s'affiche « 0 » et une phrase dit pourquoi. Un graphique sans donnée ne s'affiche pas du tout.
2. **Les statistiques ne sont jamais une section séparée.** Il n'y a plus d'onglet « Résultats ». Les chiffres sont collés à l'objet qui les produit : sur la ligne du déclencheur, sur la carte de l'étape, sur la ligne d'historique.
3. **Ne jamais promettre ce que le code ne fait pas.** Voir le critère unique de masquage en section 4.
4. **Une inférence se dit comme une inférence.** La sortie « Rendez-vous demandé » est déduite du texte d'une réponse par un classifieur d'intention.
5. **Le branchement est linéaire.** Une succession d'étapes empilées verticalement, un bouton « + » entre deux étapes. Chaque étape porte au plus une condition, dont l'issue est limitée à : continuer, sauter cette étape, arrêter le workflow, aller à une étape **strictement plus loin** dans la liste. Jamais de retour en arrière, donc jamais de cycle.
6. **Une zone vide se dit, elle ne se cache pas.** Aucun bloc ne doit disparaître silencieusement quand il n'a rien à montrer.
7. **Un contact ne porte qu'un seul motif de sortie** (section 5, ordre de précédence).

---

## 3. ORDRE DE LIVRAISON ET PLAN DE MIGRATION

**Le moteur avant l'écran. Cet ordre n'est pas négociable et il passe avant tout le reste du document.**

Prochaine migration libre : **114**. La 113 (`113-crm-created-at.sql`) est jouée sur staging seulement. Vérifie qu'elle est passée en production avant de poser la 114.

### Lot 0, la base et le moteur

**Migration 114, le porteur de workflow réutilisable.**
- Table `workflows` : `id`, `user_id`, `team_id` (nullable), `name`, `enabled`, `created_at`, `updated_at`.
- Colonne `workflow_id` sur `touchpoints`, **troisième porteur**. La contrainte devient : exactement un parmi `campaign_id`, `enrollment_id`, `workflow_id` est non nul.
- Colonne `workflow_id` sur `nurture_triggers` (le lien déclencheur vers workflow, qui n'existe pas aujourd'hui, `sequence_id` reste mort et n'est pas réutilisé).
- Colonne `workflow_id` sur `sequence_enrollments` (pour savoir de quel modèle vient une exécution).
- Colonne `trigger_id` sur `sequence_enrollments` (sans elle, la colonne DÉCLENCHEUR de l'Historique et le filtre par déclencheur n'ont aucune source).
- Colonne `email_account_id` sur `workflows` (la boîte d'envoi du workflow, aujourd'hui portée par les campagnes seulement, migration 112).

**Décision structurante, à écrire dans la migration et dans le code : les étapes sont COPIÉES à l'inscription.** Quand un déclencheur inscrit un contact, le moteur duplique les lignes `touchpoints` portées par `workflow_id` en lignes portées par `enrollment_id`. Un contact garde la version du workflow qu'il a reçue à son entrée. Conséquences directes, toutes assumées : `campaign_sends.UNIQUE(opportunity_id, touchpoint_id)` reste valide, modifier un modèle n'affecte aucun contact en cours, et **aucune étape de modèle n'est jamais verrouillée pour cause d'exécution** (ce sont les copies qui s'exécutent, pas le modèle).

**Migration 115, les types d'étape.** Élargissement de `touchpoints_type_check` (migration 054) avec `autopilot_reply` et `crm_note`. Branche dédiée dans `advanceOneStep` et dans `channelOf` (`backend/lib/native-sequence-engine.js`) pour ces deux types : aujourd'hui tout type inconnu tombe dans la branche LinkedIn.

**Migration 116, les sorties.**
- Élargissement du CHECK `sequence_enrollments.stop_reason` : ajout de `meeting_requested`, `crm_stage_reached`, `max_duration`, `completed_no_reply`, `handed_over`.
- Colonnes `exit_touchpoint_id`, `exit_step_position`, `exit_total_steps`, `exit_detail` (JSONB) sur `sequence_enrollments`.
- Colonne `max_duration_days` sur `workflows` (défaut 45), et l'horloge qui la fait respecter dans le passage horaire du moteur. Rien ne borne un enrollment aujourd'hui.
- **Correction d'ordre obligatoire dans `checkReplies`** (`native-sequence-engine.js:528`) : la classification d'intention se fait AVANT `stopEnrollment`, et l'intention est écrite en base (`stop_reason = 'meeting_requested'` plus `exit_detail`), pas seulement passée en mémoire à `conversation-autopilot.processReply`.
- Le moteur écrit, à chaque sortie : le motif typé, l'horodatage, `exit_touchpoint_id`, `exit_step_position` et `exit_total_steps`. Sans ces quatre valeurs, la colonne WORKFLOW de l'Historique affiche seulement le nom du workflow, et la statistique « 1 sortie ici » d'une carte d'étape n'est pas rendue.

**Migration 117, l'autopilot porté par l'étape.** Colonne `payload` JSONB sur `touchpoints` (sert aussi aux autres types). Pour une étape `autopilot_reply` : `{ maxTurns: 1|3|5 }`. `getConversationTurnCount` et les réglages lisent d'abord l'étape, et ne retombent sur `users.settings` que pour un enrollment sans étape autopilot. **Cette migration ferme la régression :** aujourd'hui la profondeur est un réglage global par utilisateur, une étape réglée sur 3 tours et un réglage global à 1 tour se contrediraient. Elle ne se reporte pas.

**Migration 118, le garde-fou anti-boucle, posé à la LECTURE.** C'est la correction la plus importante du chantier, et elle n'est pas là où on croit : les écritures qui bouclent existent déjà, sans qu'aucune étape de workflow n'écrive dans le CRM.
- Table `crm_write_log` : `user_id`, `opportunity_id`, `provider`, `field` (`stage`, `note`, ...), `value`, `written_at`, `origin` (`baakalai`).
- `lib/stage-tracking.js` ignore une transition dont la valeur cible correspond à une écriture baakalai de moins de N heures (défaut 2), quelle que soit la source (`delta_sync` ou `webhook`).
- `routes/webhooks.js` lit enfin `meta.user_id` du payload Pipedrive (reçu et ignoré aujourd'hui) et filtre les échos avant `trackStage` et avant `boostCompany`.
- Le réglage « fenêtre de silence après écriture » vit **dans les Réglages du compte, section CRM**, pas dans le formulaire d'une étape : il protège aussi `hubspotSync.onStatusChange`, qui écrit déjà un `dealstage` à chaque changement de statut in-app, sans opt-in et sans garde.
- **Tant que cette migration et ce filtre ne sont pas livrés, la sortie « Étape CRM atteinte » n'est pas cochable** (section 15.7), et aucun déclencheur ne lit les transitions d'étape.

**Migration 119, les préférences de signaux.** Table `signal_type_prefs` (`user_id`, `signal_type`, `ignored`, `updated_at`), filtre à la lecture dans `GET /api/signals`, et filtre à l'insertion dans `extractCrmSignals` pour économiser le quota Brave. Sans elle, « Ignorer ce type » reste masqué.

### Lot 1, l'écran

Dans cet ordre : **la table de redirection des anciens liens en premier** (section 8.3), puis la coquille à quatre onglets, puis Déclencheurs, Signaux, En cours. L'onglet Historique est présent dès le lot 1 et affiche son état vide tant que le moteur n'écrit pas de motif. Son tableau, ses tuiles, ses filtres et son export ne sont construits que dans le lot où les motifs existent.

### Lot 2, l'éditeur de workflow

Routes `/activation/workflows/:workflowId` et `/activation/runs/:enrollmentId`, carte de workflow, panneau d'assignation, catalogue d'étapes. **Rien de tout cela n'est exposé avant la migration 114.**

---

## 4. CRITÈRE UNIQUE DE MASQUAGE

Un seul critère, appliqué partout sans exception, y compris là où le présent document dessine le contrôle :

> **Tout contrôle qui n'a pas de chemin serveur est masqué, pas grisé. Toute capacité qui existe côté serveur mais pas chez cet utilisateur (pas de boîte mail, pas de session LinkedIn, mauvais connecteur CRM) est grisée avec sa raison exacte.**

Application au lot 1, à respecter à la lettre :

| Contrôle | Sort au lot 1 |
|---|---|
| Bouton « Assigner » (colonne WORKFLOW, Zone 1) | **Masqué** tant que la migration 114 n'est pas jouée. La colonne affiche « Aucun » en gris, avec une infobulle sur l'en-tête : « Les workflows arrivent. Un déclencheur envoie aujourd'hui un email unique. » |
| Route `/activation/workflows/:id`, carte de workflow, panneau d'assignation | **Non exposés** avant la 114 |
| Bouton « Tester » de l'éditeur | **Masqué** tant qu'il n'existe pas de route de test d'un workflow. `POST /nurture/preview` ne teste qu'une règle, pas un workflow |
| Sortie « Étape CRM atteinte » | **Case non cochable, ligne grisée**, raison : « Pas encore branché » jusqu'à la migration 118 |
| Sortie « Durée maximale » | **Case non cochable** tant que la migration 116 n'est pas jouée, puis pleinement active |
| Sortie « Désabonnement » | **Retirée du rail.** Aucun désabonnement au niveau du contact n'existe (aucune colonne `unsubscribed_at` ni `do_not_contact` sur `opportunities`). Afficher un cadenas ici annoncerait une protection qui n'existe pas. Le motif reste dans la table `ExitBadge` et dans l'ordre de précédence, pour le jour où il sera produit |
| Actions Signaux « Ignorer ce type » et « En faire un déclencheur » | **Masquées** avant les migrations 119 et l'évaluateur de déclencheur signal |
| Onglet Historique | **Présent, en état vide**, jusqu'au lot qui produit les motifs |

---

## 5. PRÉCÉDENCE DES MOTIFS DE SORTIE

Sept sorties sont évaluées en permanence, un même évènement peut en satisfaire plusieurs : une réponse qui demande un rendez-vous satisfait « Réponse reçue » et « Rendez-vous demandé », un deal qui atteint l'étape cible le jour où la durée maximale expire en satisfait deux. Le motif pilote les tuiles de l'Historique, le filtre, la colonne MOTIF, les cellules de la barre d'état et les colonnes de preuve des Déclencheurs : une ambiguïté ici corrompt tous les chiffres de la page.

> **Un contact ne porte qu'un seul motif de sortie. Ordre de précédence, du plus fort au plus faible : Adresse invalide, Désabonnement, Retrait manuel, Étape CRM atteinte, Rendez-vous demandé, Conversation rendue, Réponse reçue, Durée dépassée, Terminé sans réponse. Le premier motif satisfait gagne et fige la sortie.**

Cet ordre est implémenté dans le moteur, pas dans l'affichage.

---

## 6. CONTRAT D'API

Un développeur ne doit inventer aucune route. Voici ce qui existe, ce qui s'étend, ce qui se crée.

### 6.1 Routes existantes réutilisées telles quelles

`POST /api/nurture/preview`, `POST /api/nurture/run`, `POST /api/nurture/emails/approve-batch` (max 20), `/cancel-batch`, `/cancel-stale`, `GET/POST/PATCH/DELETE /api/nurture/triggers`, `GET /api/signals/preferences`, `PUT /api/signals/preferences`, `POST /api/signals/scan`, `POST /api/signals/:id/action`, `POST /api/signals/:id/create-sequence`, `POST /api/signals/:id/linkedin-outreach`, `GET /api/crm/stages`.

### 6.2 Routes existantes à étendre

**`GET /api/nurture/summary`** ajoute :
- `mailboxProviders: []` (par exemple `['gmail']`, `['smtp']`, `[]`), pour distinguer les trois états du bandeau.
- `mailboxStatuses: []` (`active`, `expired`, `revoked`), pour ne pas afficher « Aucune boîte mail connectée » à un utilisateur dont la boîte a expiré.
- `defaultZone: 'declencheurs' | 'signaux' | 'encours' | 'historique'`, calculé côté serveur (voir 8.2).
- `hasExits: boolean`, `exitCount`, `activeEnrollments`, `activeTriggers`, `totalTriggers`, `newSignals`.

**`GET /api/enrollments`** ajoute, pour chaque ligne :
- `nextStep: { touchpointId, type, label, dueAt, isOverdue }`, calculé comme le fait `advanceOneStep` (premier touchpoint sans ligne `campaign_sends` `sent` ou `skipped`, échéance = `lastSentAt + delayDays`).
- `steps: [{ id, position, type, status }]` (léger), sans quoi la rangée de pastilles de la colonne ÉTAPE est indessinable.
- `workflowId`, `workflowName`, `triggerId`, `triggerName` (null tant que la 114 n'est pas jouée).
- Paramètres `limit`, `offset`, et `total` dans la réponse.
- **Périmètre CRM obligatoire** : la route applique `lib/crm-scope.js` (contacts CRM, `campaign_id IS NULL`). Les prospects de campagne de prospection n'apparaissent jamais dans « En cours ».

**`GET /api/nurture/emails`** ajoute la jointure `opportunities` (`name`, `company`) pour que la colonne CONTACT d'un brouillon affiche un nom et une société, et non une adresse email brute. Ajoute `offset` et `total`.

**`GET /api/nurture/stats`** ajoute un bloc `byTriggerId` (`GROUP BY e.trigger_id`). Le bloc `byTrigger` actuel regroupe par `trigger_type` : deux règles du même type s'y confondent, la colonne ENVOIS mentirait dès la deuxième règle.

**`POST /api/nurture/triggers/match-counts`** : lever le `slice(0, 6)`. Avec 4 recettes et N règles, tout ce qui dépasse le sixième élément perd silencieusement son compte, exactement le faux zéro que la règle 1 interdit.

**`GET /api/signals`** ajoute `offset` et `total`, et filtre les types ignorés (migration 119).

### 6.3 Routes à créer

**`GET /api/nurture/triggers/eligible-counts`**
Réponse : `{ counts: [{ triggerId, count, sample: [3 noms], manualOnly: bool, unavailable: bool }] }`.
Un seul chargement d'opportunités pour toutes les règles, pas un par règle. Honore les autres clés de `conditions` que `days` (notamment `min_engagements`). En cas d'échec partiel, `unavailable: true` sur la seule règle concernée : la colonne affiche « ? » avec l'infobulle « Comptage indisponible », jamais « 0 ».

**`GET /api/signals/by-type`**
Réponse : `[{ type, newCount, actionedCount, maxRelevance, companies: [3 noms], totalCompanies, lastDetectedAt, ignored }]`.
`GROUP BY signal_type`, comptes filtrés par statut, `max(relevance_score)` calculé sur les `new` uniquement, `max(detected_at)`. **Hors fenêtre de 30 jours** : `GET /api/signals/stats` borne à 30 jours et ne peut donc pas servir de compteur « 320 détectés, 0 traité ».

**`POST /api/signals/bulk-action`**
Corps : `{ ids: [], action: 'dismiss' | 'add_to_crm' }`, maximum 200 ids par appel.
Réponse : `{ done: N, failed: [{ id, error }] }`. Sans cette route, « Tout sélectionner » puis « Ignorer la sélection » serait 320 requêtes HTTP.

**`GET /api/nurture/exits`** (l'Historique)
Paramètres : `period` (30, 90, all), `reason`, `workflowId`, `triggerId`, `limit` (défaut 50), `offset`.
Réponse : `{ rows: [{ exitedAt, contactName, company, reason, workflowName, exitStepPosition, exitTotalSteps, triggerName, durationDays, dealValue, currency }], total, reasons: [{ reason, count, dealValueSum, missingValueCount }] }`.
`reasons` ne contient que les motifs réellement présents : un motif jamais alimenté n'apparaît ni en tuile ni en filtre.

**`GET /api/nurture/exits.csv`** : même filtres, périmètre complet du filtre courant et non les 50 lignes chargées, plafond 5000 lignes (voir 20.3).

**Workflows, lot 2 uniquement** : `GET /api/workflows`, `POST /api/workflows`, `GET /api/workflows/:id` (workflow plus étapes), `PATCH /api/workflows/:id`, `DELETE /api/workflows/:id`, `POST /api/workflows/:id/steps`, `PATCH /api/workflows/steps/:stepId`, `DELETE /api/workflows/steps/:stepId`, `POST /api/workflows/:id/steps/reorder`, `POST /api/nurture/triggers/:id/assign-workflow`.

### 6.4 Codes d'erreur à gérer dans l'interface

| Code | Cas | Texte affiché |
|---|---|---|
| `400 not_crm_contact` | `POST /enrollments/propose` sur un prospect de campagne | « Ce contact vient d'une campagne de prospection, il ne peut pas entrer dans un workflow CRM. » |
| `409 enrollment_exists` | `idx_enrollments_one_live_per_opp`, un seul workflow vivant par contact | « Ce contact est déjà dans un workflow, il n'a pas été réengagé. » |
| `409 pending_draft_exists` | `uniq_nurture_emails_pending_per_contact` | « Un brouillon est déjà en attente pour ce contact. Validez-le ou annulez-le avant d'en générer un autre. » |
| `503 counting_unavailable` | comptage d'éligibles en échec | colonne « ? », infobulle « Comptage indisponible » |
| `429 brave_budget` | quota de recherche de signaux | toast d'avertissement « Quota de recherche atteint pour aujourd'hui. La veille reprend demain. » |

**Ces deux index uniques doivent être visibles dans l'aperçu**, ce n'est pas un cas limite : un déclencheur qui tourne chaque matin butera dessus dès le deuxième passage. Ligne obligatoire dans le panneau d'aperçu, quand le cas se produit :
**« N contacts sont déjà dans un workflow ou ont déjà un brouillon en attente. Ils sont ignorés à ce passage. »**

---

## 7. SYSTÈME VISUEL À RESPECTER

Le produit n'a **aucune librairie UI** : pas de Tailwind, pas de shadcn, pas de Radix, pas de Framer Motion, pas de react-flow, pas de drag and drop. Il y a un seul fichier CSS global (`frontend/src/index.css`, 3954 lignes) avec des classes plates, un jeu d'icônes maison (tracés Feather 24x24, `stroke-width 2`, `currentColor`), et du style inline avec des `var(--token)`. Écrire `class="flex gap-4 rounded-xl"` ne produit rien.

**Tokens autorisés.** Neutres : `--paper`, `--bg-card`, `--bg-elevated`, `--ink`, `--text-muted`, `--grey-100` à `--grey-900`, `--border`, `--border-strong`. Accent : `--primary` (#6E57FA), `--primary-deep`, `--primary-soft`, `--primary-softer`. Sémantique : `--success`, `--warning`, `--danger`, chacun avec son `-soft`. Rayons : `--r-sm` 4, `--r-md` 6, `--r-lg` 10, `--r-xl` 14, `--r-full`. Ombres : aucune, sauf une seule exception citée plus bas.

**Tokens interdits**, utilisés ailleurs dans le code mais jamais définis, donc ignorés par le navigateur : `--border-light`, `--text`, `--text-tertiary`, `--bg-hover`, `--toggle-knob`. Remplace systématiquement `--border-light` par `--border`.

**Typographie.** Satoshi pour le texte, IBM Plex Mono pour tout ce qui est chiffré ou catégoriel : en-têtes de tableau (10px majuscules, interlettrage 0.06em), labels de KPI, puces « J+4 », numéros d'étape, stats d'étape, dates courtes. Jamais de mono pour une phrase. Toute colonne de nombres porte `font-variant-numeric: tabular-nums`.
**La police mono se cite par un token, `var(--font-mono)`.** S'il n'existe pas encore dans `:root`, déclare-le une fois dans le même commit. Ne réécris jamais la pile de polices en dur dans un style inline, il y en aurait quarante.

**Piège 1, le zoom global.** La page est rendue sous `html { zoom: 1.1 }` (`index.css:169`). Tous les px de ce document sont des px de code, affichés 10 % plus grands. Ne corrige pas, ne neutralise pas, ne compense pas.

**Piège 2, la classe `.card`.** Elle porte une animation d'apparition (rise-in 0.8s) et un survol qui soulève la carte avec un halo violet. Une colonne de huit étapes qui ondule au chargement est illisible. **N'utilise pas `.card` pour les cartes d'étape ni pour les lignes de liste.** Crée une classe locale plate : même fond, même bordure 1px, même rayon, aucune animation, aucun `transform` au survol, seulement `border-color: var(--border-strong)`.

**Piège 3, le motif de chip cassé.** Le code existant écrit souvent `background: ${color}15`. Cela ne marche que si `color` est un hexadécimal littéral. Avec `var(--success)` la valeur produite est invalide et le fond disparaît. **Utilise les tokens `-soft` et `-softer`, ou des hexadécimaux littéraux définis dans une table JS.**

**Piège 4, le mode sombre.** Il est réel et complet, piloté par `data-theme` posé sur `<html>` depuis `localStorage('bakal-theme')`. Il n'y a aucun `prefers-color-scheme` dans la feuille. Il n'est garanti que pour ce qui passe par `var(--token)`. Aucun hexadécimal en dur dans le JSX, sauf les deux tables de couleurs prévues en 16.4 et 15.8, qui portent chacune une variante claire et une variante sombre, **lues sur `document.documentElement.dataset.theme`, jamais sur une media query.**

**Piège 5, les classes globales qui contredisent ce document.**
- `index.css:1784`, `.empty-state-icon` impose une icône 64px sur fond `--accent-glow`, rayon 16px, taille 36px, exactement ce que ce document interdit.
- `index.css:514`, `.campaign-table th` est en `letter-spacing: 0.04em`, ce document impose 0.06em.
- `index.css:520`, `td` est en `padding: 12px 16px`, ce document impose 8px 12px et des lignes de 36px.
- `index.css:521`, `.campaign-table tr:hover td` met le fond en `--primary-softer`, ce document limite le survol à la bordure.

Donc : **`.empty-state` et `.campaign-table` sont listées comme existantes, elles ne sont pas réutilisables ici.** Le composant `EmptyState` ne porte aucune de ces classes. Les tableaux des quatre zones utilisent une classe locale **`.act-table`**, copie plate de `.campaign-table` avec `th { letter-spacing: 0.06em }`, `td { padding: 8px 12px }`, hauteur de ligne 36px, et un survol limité à `border-color`. Ne modifie pas `.campaign-table` : d'autres pages en dépendent.

**Accessibilité, le minimum manquant.** Il n'existe aucun `:focus-visible` dans toute la feuille de style. Ajoute une règle globale : `outline: 2px solid var(--primary); outline-offset: 2px`. Un chip de statut ne se repose jamais sur la seule couleur, le libellé est toujours écrit. Pour les lignes cliquables, voir 9.7 : **la ligne n'est pas un bouton.**

**Composants à factoriser, cinq et seulement cinq**, parce qu'il n'existe aujourd'hui aucun composant partagé de layout : `SectionTabs`, `EmptyState`, `StepCard`, `ExitBadge`, et **`SidePanel`** (section 7.1). Le panneau était absent de la liste initiale alors qu'il porte le brouillon, la réponse programmée, le tri des signaux, l'aperçu et l'assignation d'un workflow : sans lui il serait réécrit cinq fois.

### 7.1 SidePanel, spécification complète

- Largeur 420px, 100 % sous 700px de largeur utile.
- Ancré à droite, `position: fixed`, pleine hauteur.
- Fond `var(--paper)`, bordure gauche 1px `var(--border)`, **aucune ombre**.
- En-tête de 48px : titre 14px poids 600 à gauche, croix 24px à droite.
- Corps scrollable, padding 16px.
- Pied fixe de 56px pour les actions, filet 1px en haut.
- Overlay `var(--ink)` à 0.2 d'opacité, sans flou.
- Fermeture par Échap et par clic sur l'overlay. Piège de focus à l'ouverture, focus restitué sur l'élément déclencheur à la fermeture.
- **Un seul panneau ouvert à la fois, aucun empilement.** Ouvrir un panneau ferme le précédent.
- `role="dialog"`, `aria-modal="true"`, `aria-labelledby` sur le titre.

### 7.2 Internationalisation

Aucun français en dur dans le JSX. Toutes les chaînes nouvelles vont sous le namespace `activation.*`, dans `fr.json` et `en.json`, **dans le même commit**. Sous-espaces à créer : `activation.tabs.*`, `activation.status.*`, `activation.triggers.*`, `activation.running.*`, `activation.history.*`, `activation.exit.*`, `activation.signals.*`, `activation.editor.steps.*`, `activation.editor.steps.disabled.*`, `activation.editor.condition.*`, `activation.editor.exits.*`, `activation.empty.*`, `activation.panel.*`.

**Sort des 67 clés `activation.*` existantes** (title, subtitle, sections, queue, rules, results, workflows, recipes, triggers, pending, sent, stale, previewRun...) : les clés encore utilisées par un composant conservé sont gardées telles quelles ; les clés des trois sections supprimées (`activation.sections.*`, `activation.results.*`) sont **supprimées dans le même commit**, pas laissées à pourrir. Aucun renommage de clé sans suppression de l'ancienne : deux jeux qui divergent, c'est le résultat garanti.

**Profite du chantier pour rapatrier dans les JSON le catalogue `trigger-types.js`**, qui porte aujourd'hui ses libellés français et anglais en dur dans le fichier.

Rappel : aucun tiret cadratin dans les valeurs, ni en français ni en anglais.

**Anglais, ton imposé** : direct, orienté ROI, phrases courtes, pas de superlatif, pas de « simply », pas de « effortlessly ». Équivalents des chaînes critiques, à reprendre tels quels :

| Clé | Français | English |
|---|---|---|
| `subtitle` | Ce que baakalai déclenche, exécute et arrête à votre place. | What baakalai starts, runs and stops for you. |
| `mailbox.none` | Aucune boîte mail connectée. Aucun email ne peut partir, et aucune réponse ne peut être détectée. | No mailbox connected. No email can go out, and no reply can be detected. |
| `mailbox.smtpOnly` | Envoi possible, lecture des réponses impossible sur une boîte SMTP. Les sorties « Réponse reçue » ne seront pas détectées automatiquement. | Sending works, reading replies does not on an SMTP mailbox. "Reply received" exits will not be detected automatically. |
| `mailbox.expired` | Votre boîte {provider} a expiré. Reconnectez-la pour que les envois reprennent. | Your {provider} mailbox has expired. Reconnect it to resume sending. |
| `status.noExits` | Aucun contact n'est encore sorti d'un workflow. Cette ligne montrera pourquoi ils sortent. | No contact has left a workflow yet. This line will show why they leave. |
| `status.notCounted` | Les sorties ne sont pas encore comptées. Elles apparaîtront ici dès que les premiers contacts quitteront un workflow. | Exits are not counted yet. They will show up here as soon as the first contacts leave a workflow. |
| `empty.triggers.title` | Aucune automatisation n'est encore active. | No automation is running yet. |
| `empty.triggers.body` | Un déclencheur décide quand baakalai agit. Un workflow décide ce qu'il fait. Tant que les deux ne sont pas reliés, rien ne part et rien n'est mesuré. | A trigger decides when baakalai acts. A workflow decides what it does. Until the two are connected, nothing goes out and nothing is measured. |
| `empty.running.noTrigger.title` | Personne n'est encore entré dans un workflow, et c'est normal. | Nobody has entered a workflow yet, and that is expected. |
| `empty.running.withTrigger.title` | Aucun contact dans un workflow pour l'instant. | No contact in a workflow right now. |
| `empty.history.title` | Aucune sortie enregistrée | No exit recorded |
| `empty.signals.off.title` | La veille est éteinte. | Monitoring is off. |
| `exit.meetingRequested` | Rendez-vous demandé | Meeting requested |
| `exit.replyReceived` | Réponse reçue | Reply received |
| `exit.crmStage` | Étape CRM atteinte | CRM stage reached |
| `exit.completedNoReply` | Terminé sans réponse | Finished without a reply |
| `exit.manual` | Retrait manuel | Removed manually |
| `exit.maxDuration` | Durée dépassée | Maximum duration reached |
| `exit.handedOver` | Conversation rendue | Conversation handed back |
| `exit.bounced` | Adresse invalide | Invalid address |
| `exit.unsubscribed` | Désabonnement | Unsubscribed |
| `exits.subtitle` | Évaluées en permanence, à chaque instant, quelle que soit l'étape en cours. Un contact qui sort ne reçoit plus rien. | Evaluated continuously, at any moment, whatever the current step. A contact who exits receives nothing more. |
| `exits.locked` | Cette sortie protège vos contacts, elle ne peut pas être désactivée. | This exit protects your contacts, it cannot be turned off. |
| `readonly.banner` | Vue en lecture seule. Pour modifier les étapes, ouvrez le workflow depuis l'onglet Déclencheurs. Les changements ne s'appliqueront pas aux contacts déjà en cours. | Read only view. To change the steps, open the workflow from the Triggers tab. Changes will not apply to contacts already running. |
| `steps.disabled.notWired` | Pas encore branché | Not wired yet |
| `steps.disabled.noMailbox` | Aucune boîte mail connectée | No mailbox connected |
| `steps.disabled.noLinkedin` | Session LinkedIn expirée ou absente | LinkedIn session expired or missing |

---

# LIVRABLE 1 : LA NOUVELLE PAGE AUTOMATISATION

## 8. ARCHITECTURE

### 8.1 Quatre onglets, un seul niveau, un seul scroll par onglet

Pas de colonnes, pas de scroll imbriqué, pas de quatre sections empilées.

*Arbitrage assumé :* les quatre zones répondent à quatre questions posées à quatre moments différents. Les empiler oblige à scroller quatre écrans pour atteindre la dernière, c'est le défaut de la page actuelle. Les mettre en colonnes afficherait trois grands vides côte à côte.

**Ordre des onglets : Déclencheurs, Signaux, En cours, Historique.**

*Arbitrage assumé, et c'est un changement par rapport à la version initiale :* Signaux passe en deuxième parce que c'est la seule zone qui contient quelque chose en production (320 lignes), et parce que l'Historique est structurellement vide tant que le moteur n'écrit pas de motif. Mettre en premier trois onglets à zéro et en dernier le seul onglet plein, c'est concevoir pour un compte qui n'existe pas encore.

### 8.2 Onglet par défaut

**Le calcul est fait côté serveur et renvoyé dans `GET /api/nurture/summary` sous la clé `defaultZone`**, qui est déjà l'unique requête de la page. Règle serveur : `encours` si des brouillons en attente existent, sinon `historique` si le compte a au moins une sortie enregistrée, sinon `declencheurs`.

Rendu : l'en-tête de page et le bandeau de boîte mail s'affichent immédiatement, **la barre d'onglets n'apparaît qu'à la réponse de `summary`**. Il n'y a donc ni bascule visible ni onglet souligné à tort. Si l'utilisateur arrive avec un `?zone=` explicite, la barre s'affiche tout de suite sur cette valeur et `defaultZone` est ignoré.

### 8.3 Navigation dans l'URL et compatibilité des anciens liens

**À implémenter avant toute autre chose.** Des liens vers l'ancienne page vivent dans la navigation (`Layout.jsx:49`), le chat (`CrmActionCards.jsx:480`), les notifications (`NotificationBell.jsx:32`) et le bilan hebdomadaire (`WeeklyWorkCard.jsx:96, 114, 115, 139`). **Aucun ne doit casser.**

Paramètres : `?zone=declencheurs | signaux | encours | historique`, plus `&f=` pour le filtre de l'onglet En cours, plus `&t=` pour le type de signal.

**Valeurs exactes de `&f=` :** `avalider`, `actifs`, `pause`, `reponses`. Aucune autre.

**`&t=<type>`** ouvre directement le panneau de traitement des signaux, filtré sur ce type, trié par pertinence décroissante. Un type inconnu est ignoré et le panneau reste fermé. Il n'y a pas de « type déplié » dans le tableau : la Zone 4 ouvre un panneau, elle ne déplie rien.

**Algorithme de lecture, dans cet ordre :**
1. Lire `?zone=`. S'il est présent et valide, il gagne.
2. Sinon lire `?section=` (le paramètre réellement utilisé par tous les liens existants) et appliquer la table ci-dessous.
3. Sinon, aucun paramètre : appliquer la règle du no-param.
4. Un `?section=` reconnu est réécrit en `?zone=` **par `replace`, sans entrée d'historique**.

| Ancienne valeur de `?section=` | Nouvelle destination |
|---|---|
| `queue`, `pending` | `zone=encours&f=avalider` |
| `rules`, `triggers`, `nurture` | `zone=declencheurs` |
| `results`, `stats` | `zone=historique` |
| `signals` | `zone=signaux` |

**Cas sans aucun paramètre**, qui est celui du CTA d'approbation du bilan hebdomadaire et de l'entrée de navigation : `zone=encours&f=avalider` si des brouillons existent, sinon la règle 8.2. Aujourd'hui `/activation` nu ouvre la file des brouillons, ce qu'attend exactement `weeklyWork.alert.approve` : ce comportement ne doit pas se perdre.

**Dans le même lot, corriger `WeeklyWorkCard.jsx:139`** pour pointer vers `/activation?zone=encours&f=avalider`.

Le comportement actuel qui ouvrait une section puis scrollait jusqu'au bloc Signaux (`signalsRef`, `ActivationPage.jsx:55-62`) disparaît : Signaux est un onglet, on l'ouvre directement.

### 8.4 Compteurs dans les onglets

Pastille mono 10.5px, fond `--primary-softer`, texte `--primary-deep`, collée au libellé. `En cours` porte le nombre de brouillons en attente, en pastille `--warning-soft` si supérieur à zéro. `Signaux` porte le nombre de signaux non traités. **Un zéro ne se décore pas : pas de pastille.**

### 8.5 Largeur, débordement, mobile

**Largeur de contenu `min(1160px, 100%)`, padding latéral 24px**, sachant que `.sidebar` est en `position: fixed` sur 220px (`index.css:203`), que `body` porte `overflow-x: hidden`, et que la page est zoomée à 1.1. Sur un portable 1440, la place utile vaut environ 1089px de code ; sur un 1280, environ 944px. Un conteneur de 1240px y serait amputé sans barre de défilement, et les colonnes de droite disparaîtraient en silence.

Règles de débordement, obligatoires sur les quatre zones :
- Chaque tableau est enveloppé dans un conteneur `overflow-x: auto`.
- La colonne 2 (le nom) est `position: sticky; left: 0`, avec le fond du conteneur.
- **Sous 1000px de largeur utile**, les colonnes de preuve (SORTIES +, RÉP., ENVOIS pour la Zone 1) passent en sous-ligne mono sous le nom du déclencheur au lieu d'être coupées.
- **Sous 700px de largeur utile**, les tableaux deviennent des listes à deux lignes (ligne 1 : nom plus état ; ligne 2 : mono, les chiffres), et **toutes les commandes visibles au survol deviennent permanentes** : menu `⋯`, bouton « + » entre deux étapes, actions de ligne.
- Le point de bascule du rail de l'éditeur se mesure sur **la largeur du conteneur** (`ResizeObserver` ou container query), pas sur la largeur de la fenêtre.

## 9. LA VUE PAR DÉFAUT (compte de production réel)

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│  Automatisation                                                                      │
│  Ce que baakalai declenche, execute et arrete a votre place.                         │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ !  Aucune boite mail connectee. Aucun email ne peut partir, et aucune reponse ne     │
│    peut etre detectee.     [Connecter Gmail] [Connecter Outlook] [Autre adresse]     │
├──────────────────────────────────────────────────────────────────────────────────────┤
│     CONTACTS EN COURS      │       A VALIDER       │     DECLENCHEURS ACTIFS         │
│            0               │           0           │           1 / 1                 │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  Les sorties ne sont pas encore comptees. Elles apparaitront ici des que les         │
│  premiers contacts quitteront un workflow.                                           │
├──────────────────────────────────────────────────────────────────────────────────────┤
│  Declencheurs    Signaux 320    En cours    Historique                               │
│  ────────────                                                                        │
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│  Declencheur vers workflow                        [ Apercu ]  [ + Nouveau declencheur]│
│  Quand une situation arrive dans votre CRM, un workflow se deroule.                  │
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │    DECLENCHEUR           ELIGIBLES  WORKFLOW    MODE      SORTIES+ REP. ENVOIS │  │
│  ├────────────────────────────────────────────────────────────────────────────────┤  │
│  │ ●  Relance dormants          23     Aucun      Validation    0      0     0  ⋯ │  │
│  │    Quand un deal n'a pas bouge depuis 30 jours                                 │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  Situations courantes, avec le nombre de contacts concernes chez vous aujourd'hui.   │
│  ┌──────────────────────────┐ ┌──────────────────────────┐ ┌──────────────────────┐ │
│  │ Clients silencieux       │ │ Comptes a risque         │ │ Demande d'avis       │ │
│  │ Quand un contact n'a     │ │ Quand un client passe    │ │ Quand un deal est    │ │
│  │ rien recu depuis 60 j    │ │ en risque de depart      │ │ gagne depuis 15 j    │ │
│  │ 18 contacts concernes    │ │ 6 contacts concernes     │ │ 2 contacts concernes │ │
│  │ aujourd'hui              │ │ aujourd'hui              │ │ aujourd'hui          │ │
│  │ Roy, Bekaert, Sow        │ │ Acme, Vega, Nord         │ │ Ivanov, Martel       │ │
│  │ [Activer] [Personnaliser]│ │ [Activer] [Personnaliser]│ │ [Activer] [Personn.] │ │
│  └──────────────────────────┘ └──────────────────────────┘ └──────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────────────────────────┐  │
│  │  +  Choisir mon declencheur et construire mes etapes moi-meme                  │  │
│  └────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                      │
│  > Campagnes equipe (admin)                                                          │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

Note de lecture du wireframe : la colonne WORKFLOW affiche « Aucun » en gris et **le bouton « Assigner » est absent au lot 1** (critère de masquage, section 4). Le nombre de recettes affichées varie de 0 à 4 selon ce qui est déjà couvert : le titre ne porte jamais de numéral.

## 10. LE BANDEAU DE BOÎTE MAIL

**Deux cas d'affichage, un seul style.** Non fermable, placé entre le titre de page et la barre d'état, jamais dans un onglet. Une seule ligne, hauteur 40px, fond `--warning-soft`, bordure 1px `--warning`, texte 12.5px, boutons fantômes à droite. Dans tous les autres cas, pas de bandeau.

**Cas 1, aucune boîte active** (`mailboxProviders` vide) :
**« Aucune boîte mail connectée. Aucun email ne peut partir, et aucune réponse ne peut être détectée. »**
Trois boutons : « Connecter Gmail », « Connecter Outlook », « Autre adresse ».

**Cas 2, uniquement des boîtes SMTP** (`mailboxProviders` ne contient que `smtp`) :
**« Envoi possible, lecture des réponses impossible sur une boîte SMTP. Les sorties "Réponse reçue" ne seront pas détectées automatiquement. »**
Un seul bouton : « Connecter Gmail ou Outlook ».
La condition initiale (« affiché uniquement quand aucune boîte n'est active ») rendait cette variante inatteignable : dès qu'une boîte SMTP est connectée, une boîte est active. Le cas est loin d'être théorique, la production compte une seule boîte connectée.

**Cas 3, boîte expirée ou révoquée** (`mailboxStatuses` contient `expired` ou `revoked` et aucune boîte active) :
**« Votre boîte {provider} a expiré. Reconnectez-la pour que les envois reprennent. »**
Un bouton : « Reconnecter ». Ne jamais afficher « Aucune boîte mail connectée » à quelqu'un qui en a bien connecté une.

`MailboxBanner.jsx` existe déjà et couvre le cas 1. Il est **étendu**, pas réécrit.

*Arbitrage assumé :* sans boîte mail, les boutons d'activation **restent cliquables**. On ne bloque jamais la construction, on bloque l'envoi. Au clic, une confirmation s'ouvre via `useConfirm()` : titre « Aucune boîte mail connectée », corps **« L'automatisation sera créée et mise en pause. Elle démarrera toute seule dès que vous aurez connecté une boîte. »**, boutons « Créer quand même » et « Annuler ».

## 11. LA BARRE D'ÉTAT

Une seule ligne de 52px, fond `--paper`, filet 1px en haut et en bas, cellules séparées par un filet vertical. Label en mono 10px majuscules `--grey-500`, valeur 20px poids 500 tabulaire `--ink`. Aucune couleur, aucune icône, **aucune flèche de tendance tant qu'il n'existe pas deux mois pleins de données**. Une valeur à zéro s'affiche « 0 » : un système à l'arrêt doit se voir. Chaque cellule mène à son onglet au clic.

**Nombre de cellules, calculé et non fixe :**

- **Tant que le moteur n'écrit aucun motif de sortie (`hasExits` faux), la barre n'affiche que trois cellules** : `CONTACTS EN COURS`, `À VALIDER`, `DÉCLENCHEURS ACTIFS` (sous la forme « 1 / 1 », actifs sur total). Sous la barre, une seule ligne 13px `--text-muted` :
  **« Les sorties ne sont pas encore comptées. Elles apparaîtront ici dès que les premiers contacts quitteront un workflow. »**
- **À partir de la première sortie enregistrée**, deux cellules apparaissent en tête : `SORTIES POSITIVES` (rendez-vous demandé et étape CRM atteinte) et `RÉPONSES REÇUES`.

Afficher cinq cellules dont deux structurellement bloquées à zéro, c'est exactement le décor vide que la règle 1 interdit.

**Répartition des sorties**, sous la barre, seulement quand il y a des sorties : une barre horizontale empilée, hauteur 8px, rayon `--r-full`, construite en flex avec des div dont la largeur vaut le pourcentage. Aucune librairie de graphe. Sous la barre, une légende en ligne : pastille 6px, libellé, compte, pourcentage.

Quand il y a des sorties mais que la barre n'a rien à montrer sur la période, la ligne devient :
**« Aucun contact n'est encore sorti d'un workflow. Cette ligne montrera pourquoi ils sortent. »**

## 12. RÈGLES TRANSVERSES AUX QUATRE ZONES

- **Chargement** : l'en-tête de tableau est rendu immédiatement, le corps affiche cinq lignes squelette de 36px, en réutilisant `components/Skeleton.jsx` et la classe `.skeleton` existante. Jamais de spinner centré, jamais de saut de mise en page, **jamais un « 0 » provisoire à la place d'un chiffre qui arrive en deuxième requête**.
- **Erreur** : un bandeau inline dans la zone, au-dessus du tableau, hauteur 32px, fond `--danger-soft`, bordure 1px `--danger`, texte « Impossible de charger [la zone]. » et un bouton fantôme « Réessayer ». Jamais de toast pour une erreur de chargement, les toasts sont réservés aux résultats d'actions. Une erreur partielle ne fait pas tomber la zone : si seul un comptage échoue, la colonne affiche « ? » en gris avec l'infobulle « Comptage indisponible ».
- **Densité** : hauteur de ligne 36px, 48px si la ligne porte une sous-ligne. Padding de cellule 8px 12px, via `.act-table`.
- **Tri** : local, en mémoire, sur les lignes chargées, chevron 10px à droite du libellé.
- **Pagination** : voir 20.2. Pas de pagination inventée, pas de bouton « Charger 50 de plus » sur une route qui n'accepte pas d'`offset`.
- **Temps réel** : voir 20.4.

---

## ZONE 1 : DÉCLENCHEURS

**Un tableau, une ligne par déclencheur.**

*Arbitrage assumé :* le tableau l'emporte sur la carte-phrase, parce que l'utilisateur compare ici des lignes entre elles, et parce que les colonnes de preuve n'existent qu'en tableau. **Mais la cellule principale se lit comme une phrase** : le nom de la règle en 13px poids 600, et en sous-ligne 11.5px `--text-muted` la phrase complète du déclencheur. Le code technique (`deal_stagnant`) n'apparaît nulle part dans l'interface.

### 13.1 Colonnes exactes

| # | En-tête | Contenu | Largeur |
|---|---|---|---|
| 1 | (vide) | Point plein 6px : `--success` actif, `--grey-400` en pause, `--warning` si aucun workflow assigné | 28px |
| 2 | `DÉCLENCHEUR` | Nom de la règle, puis en sous-ligne la phrase complète. **Colonne sticky.** | flex, min 260px |
| 3 | `ÉLIGIBLES` | Nombre de contacts concernés aujourd'hui, tabulaire, source `GET /nurture/triggers/eligible-counts`. Infobulle avec trois noms au survol. « manuel » en gris pour les types évaluables seulement à la demande (`newsletter_inactive`, `newsletter_engaged`). « ? » plus infobulle « Comptage indisponible » en cas d'échec | 100px |
| 4 | `WORKFLOW` | **Lot 1 :** « Aucun » en `--text-muted`, infobulle sur l'en-tête : « Les workflows arrivent. Un déclencheur envoie aujourd'hui un email unique. » Aucun bouton. **Après la migration 114 :** nom du workflow en texte `--primary` cliquable, suivi du nombre d'étapes en mono, ou bouton fantôme « Assigner » | 200px |
| 5 | `MODE` | Chip « Validation » ou « Automatique » | 110px |
| 6 | `SORTIES +` | Sorties positives produites par ce déclencheur, en `--success` si supérieur à zéro | 90px |
| 7 | `RÉP.` | Sorties « Réponse reçue » | 80px |
| 8 | `ENVOIS` | Total des actions exécutées, source `byTriggerId` de `/nurture/stats` | 80px |
| 9 | (vide) | Menu `⋯`, visible au survol et toujours au focus clavier, permanent sous 700px | 32px |

Les colonnes 6 et 7 supposent `sequence_enrollments.trigger_id` (migration 114) et les motifs de sortie (migration 116). Tant que ces deux migrations ne sont pas jouées, elles affichent « 0 » avec une infobulle sur l'en-tête : **« Disponible pour les workflows lancés après cette mise à jour. »** Ne jamais afficher un chiffre approximatif à la place, et ne pas masquer les colonnes pour les faire apparaître plus tard : la mise en page ne doit pas bouger sous les pieds de l'utilisateur.

### 13.2 Balisage de la ligne, à respecter strictement

**La ligne n'est pas `role="button"`.** Empiler un menu, un lien et un bouton dans un conteneur interactif produit un balisage invalide et un ordre de tabulation impraticable.

- La **cellule 2** contient un unique **bouton d'étendue** qui occupe toute la cellule, porte le nom et la phrase, et porte `aria-expanded`. C'est lui qui déplie la ligne.
- Les contrôles des colonnes 4 et 9 sont des **boutons frères**, en dehors de ce bouton, et appellent `stopPropagation` au clic.
- Le survol de la ligne reste un indice visuel (bordure), pas une cible.

### 13.3 Ligne dépliée

Le clic sur le bouton d'étendue déplie une zone en dessous, pleine largeur, fond `--bg-elevated` : l'aperçu de génération (qui serait touché aujourd'hui, les cinq premiers contacts en puces, « +N autres », un email exemple réellement produit par `nurture-engine.generateEmail`, le même générateur que le moteur), plus les rappels de plafonds.

**Rappel des plafonds réels du moteur, obligatoire, en 12px `--text-muted` :**
**« Ce déclencheur est évalué chaque matin à 9 h, et plafonné à 10 contacts par passage. Le moteur envoie au plus 12 emails par passage et 40 emails par jour et par boîte, et fait avancer chaque contact d'une seule étape par passage. »**

Si le nombre d'éligibles dépasse le plafond, une ligne supplémentaire :
**« 23 contacts éligibles, 10 seront traités au prochain passage. »**
Sans cette phrase, l'aperçu promet 23 et le moteur en fait 10.

Ligne conditionnelle sur les deux index uniques, quand le cas se produit :
**« N contacts sont déjà dans un workflow ou ont déjà un brouillon en attente. Ils sont ignorés à ce passage. »**

Sans CRM connecté, l'aperçu affiche sans bruit : **« Aperçu indisponible : aucun CRM connecté. »** avec un lien vers les réglages.

### 13.4 Actions

Bouton de zone **« + Nouveau déclencheur »** (un seul libellé, jamais « + Nouveau ») : ouvre le formulaire en deux temps (choix du type parmi le catalogue, puis les paramètres) dans une carte insérée en haut du tableau, pas dans une modale.

Bouton **« Aperçu »** : ouvre le `SidePanel` et liste, déclencheur par déclencheur, qui serait touché aujourd'hui. C'est la destination du CTA « Voir qui serait touché » de l'onglet En cours. **Sans CRM connecté, le bouton est masqué.**

Menu `⋯` : Modifier, Assigner un workflow (masqué au lot 1), Tester (aperçu limité à cette règle, `POST /nurture/preview`), Activer ou Mettre en pause, Dupliquer, Supprimer (en `--danger`, derrière une confirmation). Pas de sélection multiple : une règle se manipule à l'unité.

### 13.5 Les recettes

Sous le tableau, une grille des recettes prêtes à l'emploi issues de `TriggerRecipes.jsx` (quatre aujourd'hui : dormant, silent, atRisk, feedback), **toujours visible tant qu'il reste une recette non couverte**, pas seulement à vide. Une recette déjà couverte par un déclencheur existant disparaît, donc leur nombre varie de 0 à 4.

**Titre fixe, sans numéral : « Situations courantes, avec le nombre de contacts concernés chez vous aujourd'hui. »**

Chaque recette : titre, la phrase complète (« Quand un contact n'a rien reçu depuis 60 jours, reprendre contact. »), **le compte réel de contacts concernés aujourd'hui en 22px tabulaire `--primary-deep`**, trois noms de contacts réels, et deux boutons « Activer » et « Personnaliser ».

**C'est le seul endroit de la page où un compte vide voit un chiffre non nul et vrai.** C'est la preuve qu'il y a de la matière. Ne le sacrifie pas.

Variantes de la ligne de chiffre :
- Compte à zéro : **« Aucun contact concerné aujourd'hui. »** puis en 12px **« Vous pouvez l'activer quand même, elle se déclenchera au premier contact qui correspond. »** Le bouton reste actif.
- Sans CRM : **« Connectez votre CRM pour savoir combien de contacts sont concernés. »** Bouton désactivé avec infobulle.
- Type évaluable seulement à la demande : **« Cette recette ne s'évalue qu'à la demande. »**

### 13.6 État vide, texte exact

Bloc centré, largeur max 460px, padding 48px, bordure 1px en tirets, rayon `--r-lg`. Icône 28px `strokeWidth 1.5` en gris. **Pas de grande icône 64px sur fond teinté, donc pas de classe `.empty-state`.**

> **Aucune automatisation n'est encore active.**
>
> Un déclencheur décide quand baakalai agit. Un workflow décide ce qu'il fait. Tant que les deux ne sont pas reliés, rien ne part et rien n'est mesuré.

**Pas de bouton dans ce bloc.** Le CTA, ce sont les recettes juste en dessous, avec leurs chiffres réels.

Variante sans CRM connecté :
> **Aucune automatisation n'est encore active.**
>
> Un déclencheur décide quand baakalai agit. Connectez votre CRM pour voir combien de contacts sont déjà concernés.
>
> `[ Connecter un CRM ]`

Variante CRM connecté mais tous les comptes à zéro :
> **Aucune automatisation n'est encore active.**
>
> Aucun contact ne correspond aux situations courantes aujourd'hui. Vous pouvez créer un déclencheur malgré tout, il se déclenchera dès qu'un contact entrera dans la situation.
>
> `[ Créer un déclencheur ]`

Sous les recettes, une carte pleine largeur, 64px, bordure 1px **pointillée**, fond transparent, centrée : icône « + » puis **« Choisir mon déclencheur et construire mes étapes moi-même »**. Même motif visuel que le bouton d'ajout d'étape de l'éditeur, volontairement : l'utilisateur apprend un geste une seule fois.

En bas de zone, replié par défaut, visible pour les administrateurs uniquement : `> Campagnes équipe` (`TeamCampaigns.jsx`, réutilisé tel quel).

---

## ZONE 2 : EN COURS

**Une table unifiée des exécutions vivantes, cadrée sur le périmètre CRM.**

*Arbitrage assumé :* un brouillon est une exécution en attente d'une décision humaine, un workflow actif est une exécution en attente d'une date. Ce sont deux états de la même chose du point de vue de l'utilisateur. Le risque est connu : ce sont deux objets serveur différents. Le jour où ils divergent, il faudra scinder la table.

**Périmètre, à ne pas oublier :** `lib/crm-scope.js` sépare les contacts CRM (`campaign_id IS NULL`) des prospects de campagne de prospection. La Zone 2 n'affiche que le périmètre CRM, côté serveur. Sinon les prospects de prospection apparaîtront dans « En cours » et la page mentira sur ce qu'elle gouverne.

### 14.1 Rangée de filtres

Chips 28px, compteur mono accolé, filtre actif en fond `--ink` texte `--paper` :

```
[ A valider 12 ]  [ Workflows actifs 3 ]  [ En pause 0 ]  [ Reponses programmees 1 ]
```

Clés d'URL : `f=avalider`, `f=actifs`, `f=pause`, `f=reponses`.

Si le nombre de brouillons est supérieur à zéro, la page s'ouvre sur `f=avalider`. Au-dessus du tableau, sur ce filtre uniquement, une ligne de contexte :
**« N emails sont rédigés et attendent votre relecture. Ils ne partiront pas tant que vous ne les aurez pas approuvés. »**

Le bandeau des brouillons périmés est conservé (`EmailsQueue.jsx:143-191`), affiché **même quand la liste visible est vide** : hauteur 32px, **« 12 brouillons ont plus de 14 jours. »** avec un bouton fantôme « Purger ».

### 14.2 Colonnes exactes

| # | En-tête | Contenu | Largeur |
|---|---|---|---|
| 1 | case d'en-tête | Case à cocher de ligne, 14px | 32px |
| 2 | `CONTACT` | Nom, puis société en sous-ligne 11px. Pour un brouillon, vient de la jointure `opportunities` ajoutée à `GET /nurture/emails`. **Colonne sticky.** | flex, min 200px |
| 3 | `ORIGINE` | Nom du déclencheur pour un brouillon (`nt.name as trigger_name`, déjà joint). Pour un workflow : nom du workflow après la migration 114 ; pour les enrollments créés avant, « Agent » plus le libellé de l'objectif en gris, sans lien | 180px |
| 4 | `ÉTAPE` | « 3 / 6 » en mono à gauche, puis la progression. **Huit étapes ou moins :** pastilles de 5px avec un écart de 3px (pleines pour les étapes faites, creuses ensuite, anneau sur l'étape courante). **Au delà de huit :** les pastilles sont remplacées par une barre de 44px sur 4px, remplie au prorata. Vide pour un brouillon | 120px |
| 5 | `PROCHAINE ACTION` | Chip canal, libellé court, échéance, depuis `nextStep` de `GET /enrollments`. Pour un brouillon : « En attente de vous ». En `--warning` si `isOverdue` | 230px |
| 6 | `DÉMARRÉ` | Date relative | 90px |
| 7 | `ÉTAT` | Chip à point : « À valider », « Actif », « En pause », « Réponse programmée » | 130px |
| 8 | (vide) | `⋯` | 32px |

*Arbitrage assumé :* la barre de progression pleine est remplacée par une rangée de pastilles, une par étape. On voit combien d'étapes restent, pas seulement un pourcentage, et ça relie visuellement la ligne au workflow. La règle de repli au delà de huit étapes est obligatoire : en mono 11px, « 12 / 14 » occupe déjà 48px et quatorze pastilles n'entrent dans aucune colonne raisonnable.

### 14.3 Actions

- **Clic sur un brouillon** : `SidePanel` avec l'objet et le corps de l'email, le bandeau `AppliedPatternsBanner` (patterns mémoire appliqués), et deux boutons « Envoyer » et « Annuler ».
- **Clic sur un workflow** : ouvre `/activation/runs/:enrollmentId`, le mode lecture seule (livrable 2). **Ce bouton est présent pour tous les objectifs sans exception.** Le masquage actuel sur `churn_prevention` (`ActiveWorkflows.jsx:53`) est un bug : ces workflows s'affichent aujourd'hui sans aucun moyen de les ouvrir.
- **Clic sur une réponse programmée** : panneau avec le contenu prévu et l'heure d'envoi, bouton « Annuler cette réponse ».
- **Sélection multiple sur les brouillons uniquement.** Barre d'actions groupées sticky en bas d'écran, 44px, fond `--ink`, texte `--paper` : « N sélectionnés », boutons « Envoyer » et « Annuler », lien « Tout désélectionner ». L'envoi groupé se fait par tranches de 20 via `approve-batch` et **affiche sa progression dans la barre elle-même** (« 8 / 34 envoyés »), pas dans un toast. La logique existe déjà dans `EmailsQueue.jsx:66-141`, elle est reprise.
- Pas de sélection multiple sur les workflows en cours.
- Menu `⋯` : Ouvrir, Mettre en pause, Retirer du workflow (en `--danger`, confirmation), Voir le contact dans le CRM. Texte de confirmation exact : **« Retirer Marie Durand du workflow ? Elle n'aura plus aucune étape, et elle apparaîtra dans l'historique avec le motif Retrait manuel. »**

### 14.4 États vides, textes exacts, un par filtre

Filtre « À valider », aucun brouillon, mais un déclencheur en mode validation existe :
> **Rien à valider**
>
> Les emails rédigés par baakalai qui attendent votre feu vert arrivent ici. Il n'y en a aucun.

Filtre « Workflows actifs », aucun déclencheur n'existe :
> **Personne n'est encore entré dans un workflow, et c'est normal.**
>
> Vous n'avez créé aucun déclencheur, donc personne ne peut entrer. Dès qu'un déclencheur trouvera un contact, il apparaîtra ici, avec l'étape où il en est et ce qui va partir ensuite.
>
> `[ Créer mon premier déclencheur ]`

Filtre « Workflows actifs », au moins un déclencheur existe :
> **Aucun contact dans un workflow pour l'instant.**
>
> Vos déclencheurs tournent, ils n'ont simplement trouvé personne à faire entrer aujourd'hui. baakalai regarde votre CRM chaque matin à 9 h.
>
> `[ Voir qui serait touché ]`

Filtre « En pause » :
> **Aucun workflow en pause**

Filtre « Réponses programmées » :
> **Aucune réponse programmée**
>
> Quand un contact répond, baakalai peut préparer une réponse et l'envoyer quelques heures plus tard. Cette option se règle étape par étape dans un workflow.

**Le comportement actuel d'`ActiveWorkflows`, qui retourne `null` quand la liste est vide, est supprimé.** Un bloc invisible ne dit rien, un bloc vide qui explique enseigne.

### 14.5 Ce qui déménage

Le réglage global du répondeur automatique (`AutopilotSettings.jsx`, scope `crm`) disparaît de cette page : il devient une **étape de workflow** (livrable 2), et la migration 117 fait gagner l'étape sur le réglage global. Le réglage global par population reste accessible dans les Réglages du compte, pour les utilisateurs qui n'ont aucun workflow. La file des réponses programmées reste ici, sous forme de filtre.

---

## ZONE 3 : HISTORIQUE

**L'unité est le motif de sortie.** On ne lit pas des envois, on lit des issues.

**Cette zone est présente dès le lot 1 et affiche son état vide jusqu'à ce que la migration 116 et les écritures de motif soient livrées.** Livrer le tableau avant que les motifs existent donnerait un écran qui ment.

### 15.1 Répartition par motif

Une rangée de tuiles compactes (hauteur 72px), une par motif **réellement présent dans les données** (`reasons` de `GET /nurture/exits`), triées par compte décroissant, chacune cliquable pour filtrer le tableau. Tuile active : bordure `--ink` 1px.

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ ● RDV DEMANDE│ │ ● REPONSE    │ │ ○ TERMINE    │ │ ● RETRAIT    │
│ 4            │ │ 11           │ │ 38           │ │ 6            │
│ 62 400 EUR   │ │ 118 000 EUR  │ │ sans reponse │ │ manuel       │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

La somme en euros est **la valeur des deals concernés, pas un revenu généré**. Infobulle exacte : **« Valeur des deals concernés. baakalai a touché ces deals, il ne prétend pas les avoir gagnés. »** Si des deals n'ont pas de montant, l'infobulle ajoute « N contacts sans montant renseigné ». Les motifs à valeur nulle ou négative (désabonnement, adresse invalide) n'affichent **aucun montant**, seulement le compte.

**Un motif jamais alimenté n'apparaît ni dans les tuiles ni dans le filtre.**

### 15.2 Colonnes exactes

| # | En-tête | Contenu |
|---|---|---|
| 1 | `SORTI LE` | Date courte, heure en mono 11px en dessous. Tri par défaut, décroissant |
| 2 | `CONTACT` | Nom, société en sous-ligne. **Colonne sticky.** |
| 3 | `MOTIF` | `ExitBadge` : point 6px coloré, libellé écrit, fond neutre |
| 4 | `WORKFLOW` | Nom du workflow, puis « sorti à l'étape 3 sur 5 » en mono 11px, depuis `exit_step_position` et `exit_total_steps`. Si ces colonnes sont vides, **seul le nom du workflow est rendu**, sans mention d'étape inventée |
| 5 | `DÉCLENCHEUR` | Nom de la règle d'origine (`sequence_enrollments.trigger_id`, migration 114), ou « Manuel », ou « Agent ». **Avant la 114, la colonne est rendue avec « - » et une infobulle unique sur l'en-tête : « Disponible pour les workflows lancés après cette mise à jour. » Le filtre « Déclencheur » est masqué tant que la colonne n'a pas de source** |
| 6 | `DURÉE` | « 12 j » en mono tabulaire |
| 7 | `VALEUR DU DEAL` | Montant aligné à droite, ou « 0 » en gris si absent |

La colonne 4 est la plus importante pour améliorer un workflow : elle dit **à quelle étape les gens sortent**. C'est pour elle que la migration 116 ajoute `exit_step_position` et `exit_total_steps` : sans ces colonnes, elle reste vide même quand les motifs existeront.

Pas de colonne d'actions : une ligne d'historique se consulte, elle ne se modifie pas.

### 15.3 Ligne dépliée

Fond `--bg-elevated`, pleine largeur : la chronologie des actions subies par ce contact (une ligne par envoi, avec date, canal, étape, statut envoyé, échoué ou sauté, depuis `campaign_sends`), puis **le motif en clair, en une phrase** :

- « Sorti à l'étape 3 parce qu'une réponse a été reçue le 14/09 à 09 h 12. »
- « Sorti parce que la réponse a été comprise comme une demande de rendez-vous, le 14/09. »
- « Sorti parce que le deal est passé à l'étape Négociation dans Pipedrive le 14/09. »
- « Sorti parce que 60 jours se sont écoulés sans réponse. »
- « Sorti parce que la conversation vous a été rendue après 3 tours, le 14/09. »

Puis un lien « Ouvrir la fiche contact ».

### 15.4 Filtres

Période (30 j, 90 j par défaut, Tout), Motif (piloté aussi par les tuiles), Workflow, Déclencheur (masqué avant la 114). **Pas de recherche texte** : aucun endpoint ne la supporte et une recherche côté client sur une liste tronquée mentirait sur son exhaustivité. Bouton « Exporter en CSV » à droite des filtres (format en 20.3). Pagination : voir 20.2.

### 15.5 État vide, texte exact

> **Aucune sortie enregistrée**
>
> L'historique se remplit quand un contact quitte un workflow, et il dit toujours pourquoi : il a répondu, il a demandé un rendez-vous, le deal a atteint l'étape visée dans votre CRM, il s'est désabonné, l'adresse est invalide, vous l'avez retiré, la durée maximale est dépassée, ou le workflow est allé au bout sans réponse.
>
> C'est ici que vous verrez ce que vos automatisations rapportent vraiment.

**Aucune tuile à zéro. Aucun tableau vide avec ses en-têtes. Aucun graphique mensuel à plat.** La zone occupe 200px de haut, pas 900.

Variante quand des emails sont partis mais qu'aucune sortie n'est encore enregistrée, ligne supplémentaire 13px `--text-muted` :
**« 12 emails sont partis, aucun contact n'est encore sorti de son workflow. »**

Variante quand rien n'a jamais démarré :
> **Aucune sortie enregistrée**
>
> Rien n'a encore démarré. Activez un déclencheur et assignez-lui un workflow pour commencer à remplir cet historique.
>
> `[ Voir mes déclencheurs ]`

### 15.6 Blocs repliés en bas de zone

`> Envois hors workflow` (les emails unitaires, `SentCampaigns.jsx` réutilisé, avec son plafond rendu explicite dans le titre replié : « 200 derniers emails envoyés »), `> Newsletters Salesforce` (`NewsletterAnalytics.jsx`, seulement si Salesforce est connecté). Les résultats des tests A/B (`ABResults.jsx`) **ne restent pas ici** : ils migrent dans l'éditeur, au niveau de l'étape email concernée.

Ce qui disparaît : les barres d'envois par mois d'`AutomationStats`. Avec zéro email envoyé en production, un graphique temporel est un décor vide. Il reviendra dans Analytics le jour où les volumes existent.

---

## ZONE 4 : SIGNAUX

Un signal est une actualité repérée sur une société du CRM : levée de fonds, recrutement, changement de direction. **C'est la seule zone qui n'est pas vide : 320 signaux, zéro traité.** Le problème n'est pas le vide, c'est l'inaction. La cause est connue : une liste plate de 320 cartes avec six boutons chacune, que personne n'ouvre.

**Neuf lignes maximum, une par type, jamais une ligne par signal.** Source : `GET /api/signals/by-type`.

**Ne branche jamais `churn_external_signals` ici.** Cette table porte le mot signal et n'est pas ces signaux là, elle alimente le score de risque de départ.

### 16.1 Ligne de contexte au-dessus du tableau

```
320 signaux detectes, 0 traite. Veille quotidienne, dernier scan il y a 20 min.  [ Lancer un scan ]
```

Ces deux compteurs sont calculés **hors fenêtre de 30 jours**, sinon ils ne diront jamais 320.

### 16.2 Colonnes exactes

| # | En-tête | Contenu |
|---|---|---|
| 1 | `TYPE` | Pastille 8px de la couleur du type, icône 14px, libellé français en 13px poids 600 |
| 2 | `NOUVEAUX` | Compte des signaux non traités, 15px tabulaire |
| 3 | `TRAITÉS` | Compte des signaux déjà traités, en gris |
| 4 | `MEILLEUR SCORE` | Maximum de pertinence sur les non traités, en mono. En `--ink` gras si supérieur ou égal à 70. **Le maximum, pas la moyenne** : c'est lui qui décide si ça vaut le clic |
| 5 | `SOCIÉTÉS` | Trois premiers noms, puis « +N » |
| 6 | `DERNIER` | Date relative |
| 7 | (vide) | `[ Traiter ]`, plus `[ Ignorer ce type ]` quand la migration 119 est jouée |

Une ligne dont le compte de nouveaux est zéro reste affichée en gris si le type a produit des signaux dans les 30 derniers jours. Un type sans aucun signal n'apparaît pas.

`SIGNAL_COLORS` (`SignalsPage.jsx:19-23`) est conservé mais doit recevoir sa variante sombre, comme toute table d'hexadécimaux.

### 16.3 Les actions

**« Traiter »** ouvre le `SidePanel` filtré sur ce type, **trié par pertinence décroissante et non par date**. C'est le changement qui rend la zone actionnable.

**Chaque signal tient en trois lignes exactement, avec deux boutons visibles et pas six** :
- ligne 1 : titre 13px,
- ligne 2 : société et contact 11.5px,
- ligne 3 : mono 11px, score et facteurs de pertinence.
- À droite : **« Écrire un email »** et **« Ignorer »**. Les quatre autres actions (Ajouter au CRM, LinkedIn, Ouvrir la source, Créer une séquence) passent dans un menu `⋯` de 24px.

Six boutons par carte, c'est exactement le défaut diagnostiqué au début de cette section. On ne le reproduit pas dans un panneau de 420px.

**En tête du panneau, une case « Tout sélectionner » et un bouton « Ignorer la sélection »**, servis par `POST /api/signals/bulk-action` : le traitement en lot est le seul moyen de faire tomber 320 à zéro.

**« Ignorer ce type »** (migration 119) passe par une confirmation, texte exact :
**« Ne plus afficher les signaux de type Levée de fonds ? Les 38 signaux existants seront masqués et les prochains ne remonteront plus. Réversible depuis les réglages de veille. »**
Après confirmation, la ligne reste affichée en opacité réduite, son compte devient « Ignoré », l'action devient « Réactiver », et elle se range en bas sous un séparateur « Types ignorés ».

**« En faire un déclencheur »**, dans le menu `⋯` : ouvre le formulaire de création pré-rempli sur le type de signal. **Masqué tant qu'aucun type de déclencheur adossé à un signal n'existe dans `lib/trigger-matching.js`.** Le jour où il existe, mention obligatoire dans le formulaire, en 12.5px `--warning` :
**« Ne s'applique qu'aux signaux rattachés à un contact de votre CRM. Les signaux issus de vos surveillances n'ont pas toujours un contact joignable. »**
Le compteur affiché dans le sélecteur est le compte **des signaux rattachés à un deal** (`opportunity_id` non nul, ce que seul le CRM watch remplit), pas le compte total du type.

### 16.4 États vides, textes exacts

Veille éteinte (`users.signal_scan_frequency = 'off'`) :
> **La veille est éteinte.**
>
> baakalai ne cherche plus d'actualité sur les sociétés de votre CRM : levées de fonds, recrutements, changements de direction. Ce sont les meilleurs prétextes de relance.
>
> `[ Activer la veille, une fois par semaine ]`

Veille active, rien trouvé :
> **Rien de neuf sur vos comptes.**
>
> baakalai a regardé et n'a rien trouvé cette semaine. C'est normal sur un petit portefeuille : les signaux arrivent par vagues.
>
> `[ Lancer une recherche maintenant ]`

Tous les types ignorés :
> **Tous les types de signaux sont ignorés**
>
> `[ Réafficher tous les types ]`

Quota de recherche épuisé : toast d'avertissement, pas d'erreur rouge. **« Quota de recherche atteint pour aujourd'hui. La veille reprend demain. »**

En bas de zone, replié : `> Réglages de la veille` (cadence, création d'une surveillance, liste des surveillances). C'est `SignalsPage` monté avec `view="config"`, réutilisé tel quel.

---

# LIVRABLE 2 : LE VISUEL DES WORKFLOWS

**Rien de ce livrable n'est exposé avant la migration 114.** Tant qu'elle n'est pas jouée, la colonne WORKFLOW affiche « Aucun », le bouton « Assigner » est absent, et les routes ci-dessous ne sont pas déclarées dans `App.jsx`.

## 17. CE QU'EST UN WORKFLOW

Un workflow est un **objet réutilisable, portant un nom**, qu'on assigne à un déclencheur. Ce n'est pas une séquence attachée à un contact. Plusieurs contacts déroulent le même workflow, chacun à sa position.

**Rappel de la décision structurante (section 3) :** les étapes du modèle sont portées par `touchpoints.workflow_id` et sont **copiées** en lignes `enrollment_id` au moment de l'inscription. Modifier un modèle n'affecte jamais un contact déjà en cours. Aucune étape de modèle n'est verrouillée pour cause d'exécution.

**Concurrence entre deux administrateurs :** persistance champ par champ, la dernière écriture gagne. Si le serveur renvoie un `updated_at` plus récent que celui chargé, la page se recharge et un toast l'annonce : **« Ce workflow a été modifié ailleurs, la page a été rechargée. »**

## 18. LA CARTE DE WORKFLOW

Elle apparaît dans le panneau « Assigner un workflow » et partout où l'on liste des workflows. Hauteur 64px, fond `--bg-card`, bordure 1px `--border`, rayon `--r-lg`, **pas la classe `.card`**.

```
┌────────────────────────────────────────────────────────────────────────┐
│ ( )  Relance deal dormant                                     ● Actif  │
│      5 etapes sur 21 jours  ·  42 contacts passes  ·  7 reponses       │
│      [mail] [eye] [send] [bot] [edit]                                  │
└────────────────────────────────────────────────────────────────────────┘
```

- Ligne 1 : bouton radio (dans le panneau d'assignation) ou rien, nom du workflow en 14px poids 600, chip d'état à droite.
- Ligne 2 : sous-ligne mono 11px `--text-muted`. **Si le workflow n'a jamais tourné, écrire « Jamais lancé » et rien d'autre. Ne jamais afficher « 0 contact passé, 0 réponse » : une rangée de zéros ressemble à un échec plutôt qu'à un début.**
- Ligne 3 : la **signature du workflow**, une rangée d'icônes de canal 13px dans l'ordre des étapes.

**Variante à une seule étape, à dessiner explicitement**, parce que c'est la forme que tous les workflows auront pendant le premier mois : ligne 2 devient « 1 étape, J+0 » plus « Jamais lancé », ligne 3 porte une seule icône. Pas de « sur 0 jours ».

**État vide du panneau d'assignation**, qui est l'état le plus certain de la refonte (15 comptes sur 15 au jour un) :
> **Aucun workflow pour l'instant**
>
> Un workflow est une suite d'étapes que vous réutilisez sur plusieurs déclencheurs. Créez le premier, il part d'une seule étape email.

Unique action : l'entrée à bordure pointillée **« + Créer un workflow »**, sous-ligne **« Part d'une étape email vide. »**

En tête de la liste d'assignation non vide, cette même entrée pointillée. Pied du panneau : `[ Annuler ]` `[ Assigner ]`.

## 19. L'ÉDITEUR

### 19.1 Routes, deux routes et un seul composant

- **`/activation/workflows/:workflowId`** : mode édition. Charge le workflow et ses étapes modèles.
- **`/activation/runs/:enrollmentId`** : mode lecture seule. Charge l'exécution d'un contact et les étapes copiées de cet enrollment.

Une seule URL pour les deux modes est impossible : sur un identifiant de workflow, le composant ne peut pas savoir quel contact rendre. Le bouton « Voir le workflow » de l'en-tête lecture seule pointe vers la première route. Les deux liens sont partageables.

### 19.2 Enregistrement, une seule granularité

Quatre granularités concurrentes seraient un piège à bug. **Tranche pour le tout immédiat :**

> Toute modification est persistée à la volée : au `blur` d'un champ, au choix dans un menu, à la coche d'une case. **Il n'y a pas de bouton « Enregistrer » global.** L'en-tête affiche à la place un témoin mono 10px : « Enregistré à HH:MM », ou « Enregistrement en cours », ou « Échec de l'enregistrement » avec un bouton « Réessayer ». Les boutons « Enregistrer » et « Annuler » de la carte dépliée ne valident que la zone de texte longue (objet et corps), tout le reste se persiste au `blur`. Le bouton « Tester », quand il existera, utilise systématiquement l'état persisté.

### 19.3 Wireframe

Page pleine. Largeur utile `min(1160px, 100%)` : **colonne centrale de 620px et rail droit de 300px**, écartés de 40px, l'ensemble centré. Quand la largeur du conteneur passe sous le seuil, mesurée par `ResizeObserver` et non sur la fenêtre, le rail passe sous la colonne.

*Arbitrage assumé :* les sorties globales vivent dans le rail droit, pas en bas de la colonne d'étapes. Une sortie n'est pas une étape, et la placer dans la colonne ferait croire l'inverse. Le rail est sticky au scroll.

```
┌──────────────────────────────────────────────────────────────────┬───────────────────┐
│ < Automatisation   Relance deal dormant   ● Actif  Enregistre 14:02│ SORTIES DU        │
│                    5 etapes · 21 jours · 42 passes · 7 reponses   │ WORKFLOW          │
├──────────────────────────────────────────────────────────────────┤ Evaluees en       │
│ i Les contacts deja en cours gardent la version du workflow       │ permanence, a     │
│   qu'ils ont recue a leur entree.                                 │ chaque instant.   │
├──────────────────────────────────────────────────────────────────┤                   │
│      ┌─────────────────────────────────────────────┐             │ v Reponse recue   │
│      │ [zap] DECLENCHEUR                           │             │   verrouille      │
│      │ Quand un deal n'a pas bouge depuis 30 jours │             │ [x] RDV demande   │
│      │ 23 contacts concernes aujourd'hui [Modifier]│             │ [ ] Etape CRM     │
│      └─────────────────────────────────────────────┘             │     atteinte      │
│                          │                                       │     pas branche   │
│                        ( + )                                     │ v Adresse invalide│
│                          │                                       │ o Retrait manuel  │
│    (1)  ┌─────────────────────────────────────────────┐          │   a tout moment   │
│     │   │ [mail]  J+0  EMAIL   Premier contact      ⋯ │          │ [x] Duree max     │
│     │   │ « Un point sur Acme »                       │          │     [ 45 ] jours  │
│     │   │ 23 envoyes · 2 echoues · 0 sautes            │          ├───────────────────┤
│     │   └─────────────────────────────────────────────┘          │ REGLAGES          │
│     │                    │                                       │ Boite d'envoi     │
│     │                  ( + )                                     │ [ g.n@baakal.ai v]│
│     │                    │                                       │ Envois du lundi   │
│    (2)  ┌─────────────────────────────────────────────┐          │ au vendredi,      │
│     │   │ [radio] J+4  LINKEDIN  Invitation         ⋯ │          │ 8 h a 18 h.       │
│     │   │ « Invitation avec note courte »             │          │                   │
│     │   │ 64 envoyees · 22 acceptees (34 %)           │          │                   │
│     │   ├─────────────────────────────────────────────┤          │                   │
│     │   │ > Si l'invitation n'est pas acceptee :      │          │                   │
│     │   │   aller a l'etape 4          [ -> etape 4 ] │          │                   │
│     │   └─────────────────────────────────────────────┘          │                   │
│     │                    │                                       │                   │
│     │                  ( + )                                     │                   │
│     │                    │                                       │                   │
│    (3)  ┌─────────────────────────────────────────────┐          │                   │
│     :   │ [send]  J+2  LINKEDIN  Message            ⋯ │          │                   │
│     :   │ « Relance dans la messagerie »              │          │                   │
│     :   │ Jamais executee          contournee si...   │          │                   │
│     :   └─────────────────────────────────────────────┘          │                   │
│     :                    │                                       │                   │
│     '> (4)  ┌─────────────────────────────────────────────┐      │                   │
│         │   │ [bot] Sur reponse  AGENT  Repondre        ⋯ │      │                   │
│         │   │ « 3 tours maximum, delai 2 a 4 h »           │      │                   │
│         │   └─────────────────────────────────────────────┘      │                   │
│         │                                                        │                   │
│         └──────────── [ + Ajouter une etape ]                    │                   │
└──────────────────────────────────────────────────────────────────┴───────────────────┘
```

Note de lecture : le bouton « Tester » est absent du wireframe parce qu'aucune route de test d'un workflow n'existe (section 4). La ligne de stats de l'étape 1 ne montre que ce que `campaign_sends` sait produire tant que la migration 116 n'est pas jouée (section 20.1).

**Timeline** : trait vertical 2px `--border-strong` à 11px du bord gauche de la colonne, pastilles rondes 22px, fond `--paper`, bordure 2px, chiffre mono 11px. Le trait devient **pointillé** sur les étapes contournées par un saut actif. La timeline est décorative et masquée aux lecteurs d'écran (`aria-hidden`) ; les étapes forment une liste ordonnée sémantique (`<ol>`).

**Bouton « + »** : rond de 26px, bordure 1px en tirets, fond `--paper`, glyphe « + » 13px, posé au milieu du segment de connexion. Au survol : bordure et glyphe en `--primary`. Il apparaît au survol de l'intervalle (**permanent sous 700px de largeur utile**), sauf le dernier qui est un bouton texte permanent « + Ajouter une étape ». **Il porte un anneau de focus explicite** : c'est le contrôle le plus utilisé de l'écran.

**Carte déclencheur en haut** : visuellement distincte, fond `--bg-elevated`, bordure 1px `--border-strong`, pas de pastille numérotée, icône éclair. Elle affiche la phrase complète du déclencheur, le compte de contacts concernés aujourd'hui, et un bouton « Modifier ». Elle n'est jamais supprimable depuis ici.

## 20. ANATOMIE EXACTE D'UNE CARTE D'ÉTAPE

Conteneur : fond `--paper`, bordure 1px `--border`, rayon `--r-lg`, padding 14px 16px, aucune ombre, aucune animation.

**Ligne 1**, hauteur 24px, flex, gap 8px :
1. **Icône de type**, 14px, sur `--grey-700`.
2. **Puce de délai**, mono 10.5px, « J+4 », fond `--bg-elevated`, bordure 1px, rayon `--r-sm`. Cliquable : devient un champ numérique de 48px, persisté au `blur`. **Le délai est une propriété de l'étape, jamais une étape à part.**
   **Exception obligatoire :** les étapes évènementielles ne portent pas de puce de délai. À la place, une puce mono 10.5px **non cliquable « Sur réponse »**, fond `--bg-elevated`. C'est le cas de « Répondre automatiquement », qui se déclenche à la réception d'une réponse, à un instant imprévisible, et planifie lui-même un délai de 2 à 4 heures. Un « J+5 » sur cette carte laisserait croire à une date d'envoi.
3. **Puce de canal**, mono 9.5px majuscules : `EMAIL`, `LINKEDIN`, `AGENT`, `CRM`. Fond teinté avec un hexadécimal littéral (table 20.4), pas de concaténation de variable CSS.
4. **Titre**, 13.5px poids 600, tronqué à une ligne. Pour un email : l'objet, ou « Email sans objet » en gris si vide.
5. **Menu `⋯`**, 24px, visible au survol et au focus, permanent sous 700px.

**Ligne 2** : le résumé en une ligne, 13px `--text-muted`, entre guillemets français. Pour un email c'est l'angle donné à l'agent, pas le contenu.

**Ligne 3, les stats live**, mono 11.5px, séparées par des points médians. **Elle est toujours présente**, mais elle ne montre que ce que la base sait produire.

**Tant que la migration 116 n'est pas jouée**, seules ces métriques existent, elles viennent toutes de `campaign_sends` :

| Type | Stats disponibles au lot 1 |
|---|---|
| Email | `23 envoyes · 2 echoues · 0 sautes` |
| Invitation LinkedIn | `64 envoyees · 1 sautee` |
| Visite, message LinkedIn | `96 faites` |
| Répondre automatiquement | `31 reponses envoyees` |
| Écriture CRM | `88 ecritures · 2 echecs` |

**Après la migration 116**, et seulement après, s'ajoutent : `· 4 reponses`, `· 1 sortie ici`, et `(34 %)` sur le taux d'acceptation des invitations. Une réponse n'est aujourd'hui rattachée à aucun touchpoint (`stop_reason='replied'` est posé au niveau de l'enrollment), et `touchpoints.accept_rate / reply_rate` sont alimentés par la synchronisation Lemlist des campagnes, jamais par les enrollments. Afficher ces chiffres avant serait inventer.

**Si l'étape n'a jamais tourné, écrire « Jamais exécutée » et rien d'autre.** Ne jamais afficher « 0 envoyé, 0 réponse (0 %) ». C'est l'état de 100 % des étapes en production aujourd'hui.

**Ligne 4, optionnelle** : la condition (section 21).

Si un test A/B est actif sur une étape email, une ligne supplémentaire : deux barres horizontales de 6px, A et B, leur taux de réponse, et le verdict (gagnante si l'écart atteint 10 points sur au moins 10 envois, sinon « Pas assez de données »). C'est `ABResults.jsx` rapatrié ici.

**Carte dépliée** : l'édition du contenu en place, sans modale. Objet et corps pour un email, compteur de 300 caractères pour une invitation LinkedIn, gabarit de texte pour une note CRM. Boutons « Enregistrer » et « Annuler » en bas de la carte, qui ne valident que le texte long.

**Menu `⋯`** : Modifier le contenu, Ajouter une condition (ou Modifier la condition), Dupliquer, Monter, Descendre, Supprimer (en `--danger`). **Réordonner se fait par boutons, pas par glisser.**

Deux garde-fous de réordonnancement, les deux obligatoires :
- **« Monter » est désactivé si l'étape est la cible d'un saut venu d'au-dessus**, infobulle **« Une autre étape saute vers celle-ci, elle doit rester après. »**
- **« Descendre » est désactivé si l'étape porte une condition « aller à » et que la descendre la ferait passer après sa cible**, infobulle **« Cette étape saute vers une étape plus bas, elle doit rester avant. »**

**États d'une carte** : normal (bordure `--border`), survol (bordure `--border-strong`, aucune translation), dépliée (en-tête fond `--bg-elevated`), incomplète (bordure gauche 2px `--warning` et sous-ligne « Contenu manquant »), indisponible (opacité 0.5, curseur interdit, cadenas 12px).

### 20.4 Table des couleurs de canal

Hexadécimaux littéraux, dans un objet JS, **avec variante sombre**, lue sur `document.documentElement.dataset.theme`. La feuille redéfinit `--primary` en #A998FF en sombre : reprendre les valeurs claires en sombre donnerait des chips illisibles.

| Canal | Clair | Sombre |
|---|---|---|
| Email | `#6E57FA` | `#A998FF` |
| LinkedIn | `#0A66C2` | `#4D9FE8` |
| Agent | `#7C3AED` | `#A78BFA` |
| Écriture CRM | `#0891B2` | `#22D3EE` |
| Non exécutable | `#78716C` | `#A8A29E` |

## 21. CATALOGUE COMPLET DES TYPES D'ÉTAPES

Le clic sur « + » ouvre un **panneau inséré en place** dans la colonne, qui pousse la liste vers le bas. Pas de modale.

**Règles de tenue du panneau, obligatoires** : hauteur maximale 420px avec défilement interne, en-tête de 36px portant « Ajouter une étape » et une croix de 20px, fermeture par Échap et par clic en dehors, `scrollIntoView({ block: 'nearest' })` à l'ouverture. Les groupes dont aucune entrée n'est disponible sont repliés par défaut, avec leur compte en gris. Sans ces règles, les douze entrées chassent hors champ l'étape à côté de laquelle on voulait insérer.

Quatre groupes, en liste et non en grille, chaque entrée sur deux lignes : libellé 14px poids 500, résumé 12px `--text-muted`. Une entrée indisponible reste **visible, grisée (opacité 0.45), non cliquable, avec sa raison exacte à droite en 11px.**

*Arbitrage assumé :* afficher les étapes grisées est un choix. Elles disent au dirigeant ce que le produit vise et évitent qu'un développeur invente un emplacement quand elles arriveront. Le risque de promesse non tenue est contenu par la formulation : « Pas encore branché », jamais de date.

### CONTACTER

| Icône | Libellé | Résumé | Disponibilité |
|---|---|---|---|
| `mail` | **Envoyer un email** | Un email rédigé par baakalai à partir de l'historique du contact, envoyé depuis votre boîte. | Disponible. Grisé sans boîte mail, raison : « Aucune boîte mail connectée » |
| `eye` | **Visiter le profil LinkedIn** | Un passage discret sur le profil, sans message. | Disponible. **Grisé sans session LinkedIn**, raison : « Session LinkedIn expirée ou absente » |
| `radio` | **Envoyer une invitation LinkedIn** | Une demande de connexion, avec un mot de 300 caractères maximum. | Disponible, même grisage. Seul type dont la condition d'acceptation est réellement évaluée |
| `send` | **Envoyer un message LinkedIn** | Un message privé, seulement si la connexion est acceptée. | Disponible, même grisage |

**Le grisage LinkedIn n'est pas cosmétique.** Sans cookie `li_at`, `advanceOneStep` consomme l'étape en `status='skipped', error='linkedin_not_connected'` et le contact avance quand même. Sur `SESSION_EXPIRED`, le moteur met toutes les étapes LinkedIn en attente et pousse une notification `linkedin_expired` au plus une fois par 24 h. Sur `RATE_LIMITED`, l'étape est reportée. Tout cela est écrit en base et doit se voir : voir l'état de carte dédié en 23.

### FAIRE AGIR L'AGENT

| Icône | Libellé | Résumé | Disponibilité |
|---|---|---|---|
| `bot` | **Répondre automatiquement** | Si le contact répond, baakalai enchaîne la conversation, N tours maximum, avec un délai de 2 à 4 heures. | **Disponible après la migration 117.** Réglage : sélecteur 1, 3 ou 5 tours, plafond dur à 5. **Une seule étape de ce type par workflow.** Porte la puce « Sur réponse », pas de puce J+N |

Sous le sélecteur de tours, deux phrases fixes, 12.5px `--text-muted` :
**« Au-delà, baakalai s'arrête et vous laisse la main. »**
**« Fonctionne sur Gmail et Outlook. Une boîte SMTP personnalisée ne permet pas de lire les réponses. »**

**Précédence obligatoire avec la sortie « Réponse reçue », sans quoi cette étape est inatteignable.** La sortie « Réponse reçue » est verrouillée et un contact qui sort ne reçoit plus rien : dès qu'il répond, il sortirait avant que l'étape autopilot puisse s'exécuter. Donc :

> **Si le workflow contient une étape « Répondre automatiquement », la sortie « Réponse reçue » est désarmée. La case devient déverrouillée et automatiquement décochée, avec la sous-ligne « Désactivée : ce workflow contient une étape de réponse automatique. » Elle est remplacée par la sortie « Conversation rendue », qui se produit après N tours ou sur une intention d'arrêt (`not_interested`, `unsubscribe`).**

Retirer l'étape autopilot réarme et reverrouille « Réponse reçue ».

### ÉCRIRE DANS LE CRM

**La disponibilité se calcule sur le CRM réellement connecté par l'utilisateur, jamais sur une liste théorique.** En tête du groupe, une ligne de contexte : « CRM connecté : Pipedrive ».

**Cas multi-CRM**, qui n'est pas rare : si plusieurs connecteurs sont actifs, le groupe porte un **sélecteur de provider**. La disponibilité des entrées, le sélecteur d'étape CRM et le comportement à l'exécution se calculent sur le provider choisi, et ce choix est **stocké sur l'étape**, pas déduit à l'exécution.

| Icône | Libellé | Résumé | Disponibilité réelle |
|---|---|---|---|
| `edit` | **Ajouter une note au contact** | Une note datée sur la fiche, signée baakalai, lisible par toute votre équipe. | **Disponible après la migration 115**, exactement comme l'autopilot. Prérequis explicites : valeur `crm_note` dans le CHECK 054, branche dédiée dans `advanceOneStep`, étape sautée avec `error='crm_contact_missing'` si `crm_contact_id` est NULL, et respect de l'opt-in `crm_writeback_enabled`. Ensuite : disponible sur Pipedrive, HubSpot, Salesforce, Odoo, Notion, Folk. Grisé sur Airtable, raison : « Airtable ne reçoit pas de note ». Grisé si l'opt-in est éteint, raison : « L'écriture CRM est désactivée dans vos réglages » |
| `target` | **Déplacer le deal vers une étape** | Fait passer le deal à l'étape que vous choisissez dans votre pipeline. | **Grisé sur les 7 connecteurs au lancement.** Raisons distinctes : Pipedrive et Salesforce « Pas encore branché » (la primitive existe, aucun appelant) ; HubSpot « Indisponible : baakalai écrirait dans le pipeline par défaut et écraserait le vôtre » ; Odoo « Votre connecteur ne permet pas de changer l'étape d'un deal » ; Notion, Airtable, Folk « Ce connecteur n'a pas de pipeline » |
| `checkCircle` | **Créer une tâche** | Une tâche assignée dans le CRM, avec une échéance. | **Grisé partout**, raison : « Pas encore branché » |
| `shield` | **Assigner un propriétaire** | Attribuer le contact ou le deal à un membre de l'équipe. | **Grisé partout**, raison : « Le propriétaire est en lecture seule sur tous les CRM connectés » |
| `award` | **Ajouter une étiquette** | Poser une étiquette sur le contact dans le CRM. | **Grisé partout**, raison : « Aucun CRM ne l'accepte encore » |

Pour un compte Airtable, une ligne d'explication en tête du groupe : **« Votre connecteur Airtable est en création seule. baakalai ne peut pas modifier vos enregistrements. »**

**Avertissement obligatoire** sur toute étape d'écriture CRM, encadré 11px fond `--warning-soft` dans la carte dépliée :
**« Cette étape écrit dans votre CRM. L'action est visible par votre équipe et n'est pas annulable depuis baakalai. »**

**Avertissement supplémentaire obligatoire** le jour où « Déplacer le deal vers une étape » devient activable :
**« Un changement d'étape fait par baakalai remonte dans votre CRM comme n'importe quel autre changement. Pour éviter qu'un workflow ne se relance tout seul, baakalai ignore ses propres écritures pendant [ 2 ] heures. »**
**Ce champ est un réglage réel, et il ne vit pas ici.** Il vit dans les Réglages du compte, section CRM, parce qu'il protège aussi les écritures qui existent déjà : `hubspotSync.onStatusChange` écrit un `dealstage` à chaque changement de statut in-app, le webhook Pipedrive ne filtre aucun écho, et le `stepSync` quotidien réhistorise via `trackStage(source='delta_sync')` tout stage écrit par baakalai. L'étape se contente de citer le réglage et de renvoyer vers lui.

### PAS ENCORE EXÉCUTÉ

| Icône | Libellé | Résumé | Disponibilité |
|---|---|---|---|
| `bell` | **Passer un appel** | Une tâche d'appel pour vous, baakalai n'appelle pas. | Grisé partout, raison : « Accepté en base, jamais exécuté » |
| `message` | **Envoyer un SMS** | Un message court sur mobile. | Grisé partout, même raison |

**`message` n'existe pas encore dans `Icon.jsx`** (`radio` est déjà pris par l'invitation LinkedIn, deux entrées du même panneau ne peuvent pas porter le même glyphe). Ajoute le tracé `message` (Feather message-square) dans `Icon.jsx` dans le même commit.

### Ce qui n'est PAS un type d'étape

- **L'attente.** Le délai est la puce « J+N » de chaque étape.
- **La condition.** C'est un pied de carte, section 22.
- **La sortie.** Les sorties sont globales et permanentes, elles vivent dans le rail droit, section 23.

## 22. COMMENT SE PRÉSENTE UNE CONDITION

**Une condition n'est jamais un nœud de la liste.** C'est un bandeau attaché au bas de la carte qui la porte, séparé par un filet 1px, fond `--bg-elevated`, hauteur 28px, texte 11.5px, précédé du glyphe `>` en gris.

```
├─────────────────────────────────────────────┤
│ > Si l'invitation n'est pas acceptee :      │
│   aller a l'etape 4          [ -> etape 4 ] │
└─────────────────────────────────────────────┘
```

**Une condition maximum par étape. Pas de « et », pas de « ou ».**

Le bandeau se compose de fragments cliquables, chacun ouvrant un petit menu. Édition : `Si [ condition ] : [ issue ]`.

### 22.1 Conditions proposées

Et seulement celles que le moteur sait évaluer :

| Libellé | Disponibilité |
|---|---|
| l'invitation n'est pas acceptée | Disponible, seulement après une étape Invitation LinkedIn |
| l'invitation est acceptée | Disponible, seulement après une étape Invitation LinkedIn |

**« le contact n'a pas répondu » est retirée du sélecteur.** Elle ne peut jamais bifurquer : `checkReplies` stoppe l'enrollment dès la première réponse, et l'en-tête de `native-sequence-engine.js` le dit littéralement (« comme toute réponse stoppe la séquence, le chemin "pas de réponse" EST le chemin réel »). Avec la sortie « Réponse reçue » verrouillée, la branche « a répondu » est structurellement inatteignable. La proposer laisserait croire qu'une bifurcation existe.

Ce que l'utilisateur cherche en écrivant cette condition est déjà couvert par la puce de délai de l'étape suivante. Hint affiché en tête du sélecteur, 11px `--text-muted` :
**« Une réponse fait sortir le contact du workflow. Pour attendre avant l'étape suivante, réglez son délai. »**

**Ne propose ni « a ouvert l'email » ni « a cliqué », même grisés.** L'envoi natif ne suit ni les ouvertures ni les clics.

### 22.2 Issues, exactement quatre

| Valeur | Libellé | Effet |
|---|---|---|
| continuer | continuer normalement | rien, l'étape suivante se déroule (comportement par défaut, le bandeau n'est alors pas affiché) |
| sauter | sauter cette étape | l'étape est marquée comme sautée |
| arrêter | arrêter le workflow | sortie du contact |
| aller à | aller à l'étape N | saut en avant |

**Le sélecteur de « aller à l'étape N » ne propose que les étapes strictement plus loin dans la liste.** C'est la garantie structurelle d'absence de cycle, appliquée dans l'interface et pas seulement en base. Si l'étape est la dernière, l'option est présente mais désactivée, avec le hint **« Il n'y a pas d'étape après celle-ci. »**

### 22.3 La référence est un identifiant, jamais un rang

> **La condition stocke l'identifiant de l'étape cible, jamais son rang. Le rang n'est qu'un libellé recalculé à chaque rendu. Après toute insertion, suppression, Monter ou Descendre, les chips et les mentions de contournement sont recalculés à partir des identifiants.**

Sans cette règle, un développeur qui lit « aller à l'étape 4 » stocke le nombre 4, et l'insertion d'une étape entre la 1 et la 2 fait pointer la condition vers l'ancienne étape 3.

### 22.4 Rendu d'un saut

**Aucune ligne tracée dans la colonne centrale.** Un chip mono 10px aligné à droite du bandeau, fond `--paper`, bordure 1px `--primary`, texte `--primary` : `-> etape 4`. Dans la gouttière de gauche, le trait de timeline passe en **pointillé** sur les étapes contournées, et chacune reçoit une mention mono 11px à droite de son numéro : **« contournée si non acceptée »**. Au survol du chip, l'étape cible prend une bordure 1px `--primary` et sa pastille passe en fond `--primary-soft`. **C'est tout.** Aucune courbe, aucun SVG, aucune diagonale.

Si l'étape cible est supprimée, la condition retombe sur « continuer » et un toast l'annonce : **« La condition de l'étape 2 pointait vers une étape supprimée, elle a été remise sur continuer. »**

## 23. CATALOGUE DES SORTIES GLOBALES

Encadré dans le rail droit, en haut, sticky, largeur 300px, fond `--paper`, bordure 1px, rayon `--r-lg`, padding 14px.

Titre : `SORTIES DU WORKFLOW` en mono 10px majuscules. Sous-titre, 11px :
**« Évaluées en permanence, à chaque instant, quelle que soit l'étape en cours. Un contact qui sort ne reçoit plus rien. »**

Puis des lignes de 28px, séparées par un filet, chacune avec son contrôle à gauche (case à cocher 13px, glyphe de verrou, ou point informatif), son libellé 12px, et son paramètre à droite si besoin.

| Contrôle | Libellé | Paramètre | Sous-ligne |
|---|---|---|---|
| verrou (ou case décochée si une étape autopilot existe) | **Réponse reçue** | aucun | « Gmail et Outlook seulement. Une boîte SMTP impose un arrêt manuel. » Et, si une étape autopilot existe : « Désactivée : ce workflow contient une étape de réponse automatique. » |
| case cochée | **Rendez-vous demandé** | aucun | « Sortie quand la réponse est comprise comme une demande de rendez-vous. » |
| case cochée, seulement si une étape autopilot existe | **Conversation rendue** | aucun | « Sortie après le dernier tour de réponse automatique, ou sur une intention d'arrêt. » |
| case non cochable au lot 1 | **Étape CRM atteinte** | sélecteur d'étape, chargé en direct depuis le CRM | **Grisée, raison « Pas encore branché », tant que la migration 118 n'est pas livrée.** Ensuite, grisée avec « Votre CRM n'a pas de pipeline » sur Notion, Airtable, Folk |
| verrou | **Adresse invalide** | aucun | aucune |
| point informatif | **Retrait manuel** | aucun | « Vous pouvez retirer un contact à tout moment depuis En cours. » |
| case cochée | **Durée maximale** | champ numérique 48px plus « jours », défaut 45, min 7, max 365 | Non cochable tant que la migration 116 n'est pas jouée, raison : « Pas encore branché » |

**« Désabonnement » ne figure pas dans ce rail.** Aucun mécanisme de désinscription au niveau du contact n'existe (aucune colonne `unsubscribed_at` ni `do_not_contact` sur `opportunities`, et `lib/email-prefs.js` ne gère que les emails système envoyés à l'utilisateur de baakalai). Un cadenas ici annoncerait une protection inexistante. Le motif reste dans la table `ExitBadge` et dans l'ordre de précédence.

**Le verrou est une icône de cadenas 13px grise, pas un interrupteur désactivé**, avec l'infobulle **« Cette sortie protège vos contacts, elle ne peut pas être désactivée. »** Un interrupteur grisé invite à essayer de le cliquer, un cadenas non.

Une sortie verrouillée n'est jamais masquée : elle dit à l'utilisateur ce que le système fait pour lui sans qu'il l'ait demandé.

Le sélecteur d'étape CRM a trois états à dessiner : en chargement (« Chargement de vos étapes... », sélecteur désactivé), provider sans pipeline (ligne entière grisée), appel en échec (« Vos étapes CRM sont momentanément indisponibles. » plus un lien « Réessayer »). **Jamais une liste vide sans explication.** Rappel : `GET /api/crm/stages` appelle le CRM en direct à chaque requête et renvoie `stages: []` pour Notion, Airtable et Folk.

### 23.1 L'encadré RÉGLAGES

Sous l'encadré des sorties, un second encadré `RÉGLAGES` :

- **Boîte d'envoi** : sélecteur, **seulement après la migration 114** qui pose `email_account_id` sur `workflows`. Aujourd'hui le moteur écrit explicitement `ctx.accountId = campaign.email_account_id || null` et les workflows CRM partent de la boîte par défaut. Avant la migration, afficher une mention non éditable : « Envoyé depuis votre boîte par défaut. »
- **Jours d'envoi** : **pas de sélecteur.** Une mention non éditable, 11.5px `--text-muted` : **« Envois du lundi au vendredi, 8 h à 18 h. »** Le cron est `'10 8-18 * * 1-5'` en dur pour tout le monde (`backend/orchestrator/index.js:117`). Un sélecteur ici serait un contrôle sans effet.

### 23.2 Table des couleurs de motif de sortie

Hexadécimaux littéraux **avec variante sombre**, partagée par `ExitBadge` dans les quatre zones et dans l'éditeur. Le fond du chip reste neutre dans tous les cas, seul le point de 6px est coloré.

| Motif | Libellé affiché | Point clair | Point sombre |
|---|---|---|---|
| Réponse reçue | Réponse reçue | `#6E57FA` | `#A998FF` |
| Rendez-vous demandé | Rendez-vous demandé | `#16A34A` | `#22C55E` |
| Conversation rendue | Conversation rendue | `#7C3AED` | `#A78BFA` |
| Étape CRM atteinte | Étape CRM atteinte | `#0D9488` | `#2DD4BF` |
| Terminé sans réponse | Terminé sans réponse | `#78716C` | `#A8A29E` |
| Retrait manuel | Retrait manuel | `#57534E` | `#A8A29E` |
| Durée dépassée | Durée dépassée | `#D97706` | `#F59E0B` |
| Désabonnement | Désabonnement | `#DC2626` | `#F87171` |
| Adresse invalide | Adresse invalide | `#DC2626` | `#F87171` |

## 24. LE MODE LECTURE SEULE

Route `/activation/runs/:enrollmentId`, ouvert depuis l'onglet « En cours ». **Même composant, même mise en page, même colonne de 620px**, avec la propriété lecture seule.

**En-tête.** Le titre devient le contact : `Marie Durand, Acme SAS` en 18px poids 600. Sous-titre : `Workflow "Relance deal dormant", entré le 14 septembre, étape 3 sur 5, prochaine action demain.` À droite : `[ Mettre en pause ]`, `[ Retirer du workflow ]`, `[ Voir le workflow ]` (vers `/activation/workflows/:workflowId`).

Bandeau d'information sous l'en-tête, une ligne :
**« Vue en lecture seule. Pour modifier les étapes, ouvrez le workflow depuis l'onglet Déclencheurs. Les changements ne s'appliqueront pas aux contacts déjà en cours. »**
Cette promesse est tenue par la copie des étapes à l'inscription, section 17.

**Aucun bouton « + », aucun menu `⋯`, aucun champ éditable.** Les cartes restent dépliables en lecture.

**La position du contact est l'information dominante :**

| État | Rendu |
|---|---|
| **Faite** | Pastille de timeline pleine `--success` avec une coche 10px. Carte en opacité 1, filet gauche 2px `--success`. La puce « J+N » est remplacée par **la date réelle**. Ligne de stats remplacée par le résultat réel pour ce contact : « Envoyée le 12 sept. à 9 h 04, pas de réponse » |
| **Sautée par une condition** | Pastille `--grey-400`, carte en opacité 0.35, ligne « Sautée, l'invitation n'avait pas été acceptée » |
| **Sautée faute de moyen** | Même rendu, mais la ligne cite la cause écrite en base : « Sautée, aucune session LinkedIn active » (`linkedin_not_connected`), « Sautée, ce contact n'a pas de profil LinkedIn » (`no_linkedin_url`), « Sautée, la connexion était déjà acceptée » (`already_connected`), « Sautée, ce contact n'existe pas dans votre CRM » (`crm_contact_missing`). **Cet état est obligatoire** : le moteur consomme l'étape et fait avancer le contact, sans lui la vue mentirait sur ce qui s'est passé |
| **Reportée** | Pastille creuse `--warning`, ligne « Reportée, quota LinkedIn atteint » (`RATE_LIMITED`) ou « En attente, session LinkedIn expirée » (`SESSION_EXPIRED`) |
| **Courante** | Bordure 2px `--primary`, fond `--primary-softer`, **c'est la seule ombre autorisée de toute la page** (`--shadow-accent`). Pastille de timeline pleine `--primary`, diamètre 26px, anneau 3px. Dans la gouttière, à gauche de la pastille, un marqueur mono 10px `--primary-deep` : `ICI`. Ligne de statut : « Part demain, le 24 septembre. », ou en `--warning` « Aurait dû partir le 21 septembre. » **Au chargement, la page scrolle pour centrer cette carte.** Aucune animation, aucune pulsation. Attribut `aria-current="step"` |
| **À venir** | Opacité 0.5, pastille creuse, puce « J+N » conservée, stats remplacées par « Prévue le 27 septembre. » |

**Trait de timeline** : plein `--ink` jusqu'au centre de la pastille courante, `--border` au-delà. La progression se lit sur le trait, sans barre séparée.

**Rail droit.** Le panneau des sorties devient informatif : les contrôles sont remplacés par des glyphes, chaque sortie active porte la mention **« surveillée »** en 10.5px gris (jamais « armée », qui est du jargon interne), et une ligne ajoutée : **« Aucune sortie déclenchée pour ce contact. »** Sous lui, un encadré `JOURNAL`, replié par défaut : la liste chronologique brute des envois issue de `campaign_sends` (date mono, canal, objet tronqué, statut, message d'erreur le cas échéant).

Si une sortie s'est déjà produite, le contact n'est plus dans « En cours », il est dans l'Historique.

---

## 25. SORT DE L'EXISTANT, COMPOSANT PAR COMPOSANT

Ne réécris pas ce qui existe, et ne laisse pas traîner ce qui meurt.

| Composant | Sort |
|---|---|
| `pages/ActivationPage.jsx` | **Réécrit** : coquille à quatre onglets, redirections, `summary`, bandeau. Le switcher à trois pilules inline disparaît au profit de `SectionTabs` |
| `automation/QueueSection.jsx` | **Supprimé.** L'aperçu de génération (lignes 102-192) est extrait dans le panneau « Aperçu » de la Zone 1 |
| `automation/RulesSection.jsx` | **Supprimé**, son contenu se répartit entre Zone 1 et Réglages |
| `automation/ResultsSection.jsx` | **Supprimé** |
| `automation/EmailsQueue.jsx` | **Réutilisé et remanié** en lignes de tableau : la sélection multiple, l'envoi par tranches de 20 et le bandeau de brouillons périmés sont conservés tels quels |
| `automation/TriggersSection.jsx` | **Remanié** en tableau `.act-table`, formulaire conservé |
| `automation/TriggerRecipes.jsx` | **Réutilisé**, titre changé, `slice(0,6)` levé côté serveur |
| `automation/trigger-types.js` | **Conservé**, libellés rapatriés dans `fr.json` et `en.json` |
| `automation/ActiveWorkflows.jsx` | **Remplacé** par la table de la Zone 2. Son retour `null` à vide disparaît, le masquage du bouton Ouvrir sur `churn_prevention` est corrigé |
| `automation/SentCampaigns.jsx` | **Déplacé** en bloc replié de la Zone 3 |
| `automation/ABResults.jsx` | **Déplacé** dans l'éditeur, au niveau de l'étape email |
| `automation/NewsletterAnalytics.jsx` | **Déplacé** en bloc replié de la Zone 3 |
| `automation/TeamCampaigns.jsx` | **Déplacé** en bloc replié de la Zone 1, admin seulement |
| `components/AutomationStats.jsx` | **Supprimé.** Ses tuiles deviennent la barre d'état, ses barres mensuelles disparaissent |
| `components/AutopilotSettings.jsx` | **Déplacé** dans les Réglages du compte, devient le repli de l'étape autopilot |
| `components/MailboxBanner.jsx` | **Étendu** aux trois cas de la section 10 |
| `components/AppliedPatternsBanner.jsx` | **Réutilisé** dans le panneau de brouillon |
| `components/Skeleton.jsx` | **Réutilisé** pour les lignes squelette |
| `components/ConfirmModal.jsx` (`useConfirm`) | **Réutilisé** pour toutes les confirmations |
| `pages/SignalsPage.jsx` | **Réutilisé** : `view="config"` en bloc replié de la Zone 4 ; `view="feed"` remplacé par le tableau par type plus le panneau |
| `pages/WorkflowPage.jsx` | **Conservé** pour les routes existantes tant que l'éditeur du lot 2 n'est pas livré, puis remplacé par `/activation/runs/:enrollmentId` |

## 26. MODE ÉQUIPE

Le produit a un mode équipe et une notion d'administrateur (`TeamSettings.jsx`, `TeamCampaigns.jsx`). La refonte ne l'ignore pas.

- Un **workflow est à l'échelle du compte** (`workflows.user_id` plus `team_id` nullable) : un membre voit les workflows de son équipe et peut les assigner, un administrateur seul peut les supprimer.
- Un **déclencheur** garde la portée qu'il a aujourd'hui (`nurture_triggers.team_id`, migration 032).
- Un **membre non administrateur** voit les quatre zones, mais : le bloc `> Campagnes équipe` est absent, les colonnes de la Zone 2 et de la Zone 3 sont filtrées sur ses propres contacts, et la suppression d'un déclencheur d'équipe est absente du menu `⋯`.
- Aucune zone n'est masquée à un membre : masquer un onglet entier fait croire à une panne.

## 27. REPRISE DE L'EXISTANT

Les enrollments créés avant la migration 114 (migration 103) n'ont ni `workflow_id` ni `trigger_id`. Ils ne sont ni masqués ni rattachés de force à un workflow synthétique :

- Colonne ORIGINE de la Zone 2 : **« Agent »**, suivi en gris du libellé de l'objectif (Réactivation, Upsell, Prévention du départ).
- Colonne WORKFLOW de la Zone 3 : le libellé de l'objectif, sans lien d'édition.
- Le bouton d'ouverture en lecture seule fonctionne : leurs étapes existent bien dans `touchpoints` portées par `enrollment_id`.
- Aucune migration de données ne réécrit ces lignes.

## 28. TÉLÉMÉTRIE

Tout le chantier repose sur un constat chiffré. Il doit produire son propre constat. Six évènements dans la table `product_events` existante, à poser dans le même lot que l'écran :

| Évènement | Propriétés |
|---|---|
| `activation_tab_open` | `zone`, `source` (`nav`, `url`, `default`) |
| `activation_recipe_activated` | `recipeType`, `eligibleCount` |
| `activation_trigger_created` | `triggerType`, `mode`, `fromRecipe` |
| `activation_workflow_assigned` | `triggerId`, `workflowId`, `stepCount` |
| `activation_step_added` | `workflowId`, `stepType`, `position` |
| `activation_signal_actioned` | `signalType`, `action`, `bulk` (booléen), `count` |

## 29. ANNEXES OPÉRATIONNELLES

### 29.1 Tests existants

`frontend/src/components/automation/__tests__/TriggersSection.test.jsx` et `TriggerRecipes.test.jsx` montent les composants refondus avec `api-client` et `auth` mockés en locale fr. **Ils casseront.** Consigne :
- Les deux suites sont **adaptées**, pas supprimées : mêmes mocks, nouvelles assertions sur le tableau `.act-table` et sur le titre de recettes sans numéral.
- **Une suite nouvelle est obligatoire sur la table de redirection** (section 8.3), parce que c'est la seule régression de ce chantier dont personne ne verrait rien : `?section=queue`, `?section=signals`, `?section=stats`, `?zone=` prioritaire sur `?section=`, cas sans paramètre avec et sans brouillons, et absence d'entrée d'historique lors de la réécriture.
- Une suite sur `ExitBadge` (les neuf motifs, clair et sombre) et une sur le sélecteur « aller à l'étape N » (jamais une étape antérieure, désactivé sur la dernière étape, recalcul après Monter et Descendre).

### 29.2 Pagination, la vérité et rien d'autre

- `GET /nurture/exits` et `GET /signals` reçoivent `offset` et renvoient `total` : le bouton **« Charger 50 de plus »** et la ligne de vérité **« 50 sorties affichées sur N. »** sont légitimes sur ces deux routes, et sur elles seulement.
- `GET /nurture/emails` reçoit également `offset` et `total`.
- Partout où une route reste plafonnée sans `offset`, pas de bouton : une ligne de pied de tableau **« 200 lignes affichées sur N. »**, et rien de plus.

### 29.3 Export CSV de l'Historique

- Route `GET /api/nurture/exits.csv`, mêmes filtres que la vue.
- **Périmètre : la totalité du filtre courant côté serveur, pas les 50 lignes chargées.** Plafond 5000 lignes ; au delà, une dernière ligne du fichier indique `# Export limite a 5000 lignes sur N.` et un toast le dit aussi.
- Encodage **UTF-8 avec BOM**, séparateur **point-virgule** (les tableurs français ouvrent mal la virgule), fin de ligne `\r\n`, valeurs contenant un séparateur entourées de guillemets doubles.
- Colonnes, dans cet ordre : `sorti_le` (ISO 8601), `contact`, `societe`, `email`, `motif`, `workflow`, `etape_sortie`, `total_etapes`, `declencheur`, `duree_jours`, `valeur_deal`, `devise`.
- Nom du fichier : `baakalai-sorties-AAAA-MM-JJ.csv`.

### 29.4 Temps réel

`socket.io-client` est déjà branché (notifications, évènement `reply_received` depuis la migration 110).

- La Zone 2 écoute `reply_received` et **rafraîchit ses compteurs et la ligne concernée**, jamais la page entière.
- Une ligne qui sort d'un workflow pendant que l'utilisateur la regarde **ne disparaît pas sous ses yeux** : elle passe en opacité 0.5 et reçoit une ligne 11.5px **« Ce contact vient de sortir du workflow. »** avec un lien « Voir dans l'historique ». Elle n'est retirée qu'au prochain changement d'onglet ou de filtre.
- Aucun autre évènement n'est écouté par cette page.

---

# CE QU'IL NE FAUT PAS FAIRE

1. **Pas de canvas libre.** Aucun plan 2D, aucun déplacement libre, aucun zoom, aucune minimap.
2. **Pas de react-flow, ni aucune autre librairie de graphe ou de nœuds.**
3. **Aucune coordonnée x et y persistée.** Une étape a une position dans une liste ordonnée, c'est tout.
4. **Pas de glisser-déposer.** Réordonner se fait par « Monter » et « Descendre ». C'est accessible au clavier, ça marche au tactile, et ça rend structurellement impossible la création d'un saut invalide.
5. **Pas de retour en arrière.** Le sélecteur de saut ne propose jamais une étape antérieure, et la référence est un identifiant, pas un rang.
6. **Pas de ligne, de courbe ou de SVG tracés entre deux étapes.**
7. **Pas de faux chiffres.** Aucune donnée de démonstration, aucun graphique à zéro, aucune tendance inventée, aucun « 0 » provisoire pendant un chargement, aucune rangée « 0 envoyé, 0 réponse (0 %) » sur une étape qui n'a jamais tourné, aucun compte d'éligibles silencieusement perdu au delà du sixième.
8. **Ne jamais écrire « RDV pris », « Rendez-vous pris » ni « RDV détecté »**, y compris dans un schéma ASCII.
9. **Pas de date de livraison dans une infobulle de grisage.**
10. **Pas de bloc qui disparaît silencieusement quand il est vide.**
11. **Pas de classe `.card` sur les cartes d'étape ni sur les lignes de liste. Pas de `.empty-state`, pas de `.campaign-table`.**
12. **Pas de `${color}15`** pour teinter un fond.
13. **Pas de pagination inventée** sur une route qui n'accepte pas d'`offset`.
14. **Pas de nouvelle dépendance npm.** Aucune, sans exception.
15. **Ne branche pas `churn_external_signals` sur l'écran Signaux.**
16. **Pas de contrôle cliquable sans chemin serveur.** Le critère de la section 4 s'applique à Assigner, Tester, Étape CRM atteinte, Durée maximale et Historique, exactement comme il s'applique aux actions Signaux.
17. **Pas d'élément interactif imbriqué dans un autre.** La ligne de tableau n'est pas un bouton.
18. **Pas de largeur fixe de 1240px.** La barre latérale fait 220px et la page est zoomée à 1.1.

---

# CONTRAINTES TECHNIQUES FERMES

1. **Zéro nouvelle dépendance.** Les seules dépendances front disponibles sont react, react-router-dom, recharts, socket.io-client, dompurify. Recharts n'est utilisé nulle part sur cette page.
2. **Style : classes CSS globales existantes plus style inline avec des `var(--token)`.** C'est la convention du produit (3206 blocs de style inline dans 111 fichiers). Ne crée pas un troisième vocabulaire, n'introduis pas l'échelle `--s-*` qui existe mais n'est utilisée nulle part. Une seule classe nouvelle est autorisée, `.act-table`.
3. **Tokens interdits** : `--border-light`, `--text`, `--text-tertiary`, `--bg-hover`, `--toggle-knob`. La police mono passe par `var(--font-mono)`.
4. **Mode sombre obligatoire.** Les deux seules tables d'hexadécimaux littéraux autorisées (canaux d'étape 20.4, motifs de sortie 23.2) portent une variante claire et une variante sombre, lues sur `document.documentElement.dataset.theme`. `SIGNAL_COLORS` reçoit sa variante sombre dans le même commit.
5. **Le zoom global de 1.1 reste.** Tous les px de ce document sont des px de code.
6. **Ombres : une seule sur toute la page**, sur la carte de l'étape courante en mode lecture seule.
7. **Rayons : `--r-sm`, `--r-md`, `--r-lg`, `--r-full` seulement**, sauf `--r-xl` pour la carte de workflow et l'encadré des sorties.
8. **Espacement : 4, 8, 12, 16, 24, 40 et rien d'autre.**
9. **Modales : il n'existe aucun composant modale générique**, seulement `useConfirm()`. Tout ce qui ressemble à une modale est soit le `SidePanel` de la section 7.1, soit un panneau inséré en place dans le flux.
10. **Accessibilité** : règle globale `:focus-visible`, pas d'interactif imbriqué, liste ordonnée sémantique pour les étapes, timeline `aria-hidden`, `aria-current="step"` sur l'étape courante, `aria-expanded` sur les boutons d'étendue.
11. **Internationalisation** : aucun français en dur, clés créées dans `fr.json` et `en.json` dans le même commit, clés mortes supprimées, aucun tiret cadratin dans les valeurs ni dans les emails générés, catalogue `trigger-types.js` rapatrié.
12. **Compatibilité des anciens liens obligatoire et livrée en premier** : lecture `?zone=` puis repli `?section=`, cas sans paramètre, réécriture en `replace`, correction de `WeeklyWorkCard.jsx:139`.
13. **Le moteur avant l'écran.** Les motifs « Rendez-vous demandé », « Étape CRM atteinte », « Durée dépassée », « Terminé sans réponse », « Conversation rendue » ne sont écrits par aucun code aujourd'hui. **Le moteur écrit, à chaque sortie : le motif typé, l'horodatage, la position de l'étape en cours et le nombre total d'étapes du workflow à cet instant.** Sans ces quatre valeurs, la colonne 4 de l'Historique affiche seulement le nom du workflow, et la statistique « 1 sortie ici » d'une carte d'étape n'est pas rendue. Tant que les motifs ne sont pas produits, l'onglet Historique affiche son état vide, même sur un compte actif.
14. **L'entité workflow avant son éditeur.** Tant que la migration 114 n'est pas jouée, la colonne WORKFLOW affiche « Aucun », le bouton « Assigner » est absent, la carte de workflow et le panneau d'assignation n'existent pas, et les routes `/activation/workflows/:workflowId` et `/activation/runs/:enrollmentId` ne sont pas exposées.
15. **La régression autopilot se ferme dans le même lot que l'étape « Répondre automatiquement ».** La profondeur de conversation vit aujourd'hui dans un réglage global par utilisateur ; une étape réglée sur 3 tours et un réglage global à 1 tour se contrediraient. Elle ne se reporte pas.
16. **Un bug existant à corriger au passage :** le bouton d'ouverture d'un workflow est masqué pour l'objectif de prévention du churn (`ActiveWorkflows.jsx:53`), ce qui rend ces workflows inouvrables. Dans la refonte, il est présent pour les trois objectifs.
17. **Ne livre jamais l'écriture d'étape CRM sans son garde-fou anti-boucle, et ce garde-fou se pose à la LECTURE** (migration 118) : fenêtre de silence relue par `lib/stage-tracking.js`, filtrage des échos par `meta.user_id` dans `routes/webhooks.js`, réglage dans les Réglages du compte. Rien dans le code ne distingue aujourd'hui une écriture faite par baakalai d'un changement fait par un commercial, et deux chemins d'écriture bouclent déjà sans qu'aucune étape de workflow n'existe.
18. **La Zone 2 est cadrée sur le périmètre CRM** (`lib/crm-scope.js`), côté serveur. Les prospects de campagne de prospection n'y apparaissent jamais.
19. **Les étapes d'un workflow sont copiées à l'inscription.** C'est la décision qui tient la promesse « les changements ne s'appliqueront pas aux contacts déjà en cours », et elle préserve `campaign_sends.UNIQUE(opportunity_id, touchpoint_id)`.
20. **Les deux index uniques sont visibles dans l'interface**, pas seulement en logs : `idx_enrollments_one_live_per_opp` et `uniq_nurture_emails_pending_per_contact` produisent des textes d'aperçu et des messages d'erreur 409 définis en 6.4.