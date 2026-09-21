# Prompt Claude design — Doc features clients + intégration deck commercial

> **Usage** : copier la totalité de ce fichier dans Claude (mode design) en une fois.
> **Version** : 1.0 du 15/09/2026 — matière issue de l'analyse features refresh 15/09
> (artifact interne `1a852dbc`). Remplace la matière features du prompt deck du 03/09.
> **Deux livrables demandés** : (A) un document features présentable aux clients,
> (B) le deck commercial mis à jour avec cette matière.

---

Tu es directeur artistique et copywriter senior pour **baakalai**, un produit SaaS
français. Tu produis **deux livrables** : un document features destiné aux clients
(leave-behind après démo, envoyable en PDF) et le deck commercial qui l'intègre.

## 1. Le produit, en une minute

baakalai est un système d'agents IA qui se branche sur le CRM existant d'une PME
(Salesforce, HubSpot, Pipedrive, Odoo, Notion, Airtable, Folk) et fait le travail
d'exploitation que personne n'a le temps de faire : repérer les deals dormants et
dérouler la séquence de relance, détecter les clients mûrs pour un upsell, alerter
avant le churn, nettoyer les données en continu. Il rédige et **exécute** les
relances depuis les boîtes email et le LinkedIn du client — mais **rien ne part
jamais sans validation humaine**.

- **Audience** : dirigeants et responsables commerciaux de PME B2B (5–200 personnes),
  sans équipe RevOps. Lecteurs pressés, allergiques au jargon, sensibles au concret.
- **Thèse centrale (à marteler)** : « Votre CRM sait déjà qui relancer. Personne ne
  le lit. baakalai le lit 24/7 — et déroule la relance. »
- **Hiérarchie des jobs, toujours dans cet ordre** : réactivation de deals (héros),
  upsell, anti-churn, qualité de données (le carburant des trois). La prospection
  existe et est autonome, mais c'est la porte d'entrée, jamais l'ouverture.
- **Ton** : expert, direct, concret. Phrases courtes. Français impeccable.
  Style YC : des faits, pas des adjectifs.

## 2. Identité visuelle (commune aux deux livrables)

- Accent **violet #6E57FA** sur fonds clairs neutres (blanc cassé, gris chauds).
  Texte encre presque noire. Une seule couleur d'accent — pas d'arc-en-ciel.
- Typographie sobre et contemporaine, hiérarchie forte (gros titres courts, corps
  aéré, étiquettes uppercase discrètes). Chiffres en tabular pour les listes de faits.
- Pas d'emoji, pas d'icônes gadget, pas d'illustrations « robots ». Si visuels :
  schémas simples (flux CRM → baakalai → action validée), captures stylisées de
  files d'action, badges sobres.
- Aéré. Une idée par écran/section. Le blanc est un choix, pas un vide.

## 3. Interdits absolus (les deux livrables)

- **Zéro prix.** Nulle part. Le tarif se discute à l'oral.
- Jamais « remplace votre RevOps » ni « remplace vos commerciaux ». Le cadrage est :
  « la fonction que vous n'auriez jamais pu vous offrir ».
- Jamais « 100 % automatique » ni « autonome » sans nuance : **toujours** rappeler
  que chaque envoi est validé par l'utilisateur.
- Aucune promesse chiffrée de ROI (« +30 % de deals récupérés ») — le seul chiffre
  autorisé est le cadrage « un deal récupéré paie l'outil » (ordre de grandeur, pas
  promesse).
- Aucun nom de concurrent dans le doc client.
- Ne jamais mentionner : génération automatique de workflows par l'IA (pas livré),
  enrichissement/reveal d'emails, détection des réponses sur boîtes Microsoft
  (Gmail uniquement aujourd'hui), facturation. Ces sujets sont hors périmètre.
- Pas de vocabulaire interne : « staging », « migration », « agent n°… », noms de
  fichiers, dates de livraison internes.

---

# LIVRABLE A — Document features clients

**Format** : document vertical élégant (web ou PDF A4), 6–10 pages/écrans. C'est le
document qu'on laisse après une démo : il doit être **détaillé** — le lecteur doit
pouvoir comprendre précisément ce que fait le produit sans nous — tout en restant
scannable (titres qui portent le message, détails en dessous).

**Titre proposé** : « baakalai en détail — ce que fait le produit, et comment il
travaille sous votre contrôle ». Sous-titre : la thèse centrale.

## Structure et contenu (détail à respecter, reformulation libre)

### A1. La thèse (1 page)
Le CRM d'une PME contient des deals dormants, des clients mûrs pour un upsell et
des comptes qui glissent vers le churn — mais personne n'a le temps de le lire.
baakalai le lit en continu, décide quoi faire, rédige, et exécute après validation.

### A2. Comment ça marche (1 page, schéma)
Cinq temps, en flux visuel :
1. **Connexion** — le CRM se branche en un clic (OAuth), les boîtes email aussi.
2. **Lecture continue** — deals, contacts, activités, signaux externes.
3. **Décision** — scores et files d'action priorisées, chaque score expliqué.
4. **Rédaction** — emails écrits depuis le contexte réel du compte.
5. **Validation puis exécution** — vous approuvez, baakalai envoie depuis **vos**
   boîtes, suit les réponses, et s'arrête quand quelqu'un répond.

### A3. Réactivation de deals (le job héros — la page la plus riche)
- Détection continue des deals sans activité réelle ou arrivés à leur date de
  relance prévue ; file « Deals à relancer » priorisée.
- Pour chaque deal, une carte « Situation avec l'entreprise » : étape du deal,
  montant, niveau de risque, ancienneté du silence, et le « pourquoi maintenant ».
- Brouillon de relance rédigé depuis ce contexte — et le produit **montre les
  patterns appris** qu'il a appliqués (ce qui a marché par le passé, appliqué à
  cet email, visible à l'écran).
- Relance en séquence complète : plusieurs étapes email + LinkedIn, avec
  bifurcation selon la réponse — chaque workflow est approuvé avant de démarrer.
- Envoi groupé : traiter toute la file en une session, chaque email restant
  individuellement rédigé et validable.
- Attribution : quand un deal repart, baakalai relie la reprise à l'email qui l'a
  causée — vous voyez ce que la relance a rapporté.

### A4. Upsell sur la base clients
- File « Clients à upseller » : clients gagnés dont l'activité retombe, scorés.
- Suggestions de produits à proposer quand le catalogue est renseigné.
- Même mécanique que la réactivation : contexte affiché, envoi groupé, validation.

### A5. Anti-churn
- Score de risque sur 9 familles de signaux : inactivité réelle, stagnation,
  engagement email, sentiment des échanges, secteur, historique d'upsell, signaux
  web publics, **santé financière officielle** (registres légaux : BODACC,
  Companies House, procédures collectives US), emails qui rebondissent.
- Chaque score détaille ses facteurs à l'écran : vous voyez *pourquoi* un compte
  est à risque, pas juste un chiffre.
- Vos verdicts (d'accord / pas d'accord) recalibrent les pondérations chaque
  semaine. Les comptes chauds sont re-vérifiés plusieurs fois par jour.
- Emails de rétention proposés, envoyés après validation.

### A6. Qualité de données (le carburant)
- Nettoyage continu : doublons (fusion révisable et annulable), champs manquants
  corrigés en un clic, emails invalides détectés (format, domaine mort, adresses
  jetables, fautes de frappe corrigées), bounces réels tracés.
- Score de qualité sur 100, avec tendance et détail des facteurs.
- Purge RGPD encadrée : export obligatoire avant suppression, annulable.

### A7. Prospection (présentée comme complément, pas comme cœur)
- Quand il faut de nouveaux leads : création de campagne assistée par IA, vraies
  sources de leads, séquences email + LinkedIn envoyées **depuis les boîtes du
  client** — aucun outil d'envoi tiers à acheter.
- Les réponses sont détectées (boîtes Gmail) : la séquence s'arrête d'elle-même
  et l'IA prépare la suite de la conversation.
- Garde-fous de délivrabilité intégrés : plafonds d'envoi quotidiens, fenêtres
  ouvrées, signature propre à chaque boîte.

### A8. Pilotage
- Digest hebdomadaire par email le lundi : signaux, priorités, engagements de
  réactivité (SLAs) dépassés.
- Forecast par deal appris sur votre historique réel (cycle de vente, taux de
  conversion), trois scénarios, recalibré chaque semaine contre les deals
  réellement gagnés ou perdus.
- Analytics natifs : pipeline, où meurent les deals, attribution, géographie,
  filtres par produit.

### A9. Contrôle, transparence, conformité (page de confiance — ne pas la couper)
- **Rien ne part sans validation.** L'automatisation propose, vous disposez.
- L'IA montre son travail : chaque score expose ses facteurs, chaque email les
  patterns appliqués.
- Envois depuis vos boîtes, à votre nom, avec vos signatures.
- RGPD : préférences d'emails par catégorie, désinscription en un clic conforme
  aux exigences Gmail/Yahoo, purge de données encadrée.

### A10. Ce que baakalai ne fait pas (3–4 lignes, assumées)
Il ne migre pas un CRM vers un autre, ne choisit pas votre stack, ne fait ni
territoires ni plans de commission, et ne remplace pas les conversations entre
vos équipes. Il fait le travail d'exploitation du CRM que personne ne fait.

### A11. Démarrage (page finale + CTA)
Opérationnel le jour 1 : CRM connecté en un clic, lecture et premières files
d'action le jour même. CTA : **« Rejoindre la beta »**.

---

# LIVRABLE B — Deck commercial mis à jour

**Format** : deck 16:9, ~13 slides, même identité. Une idée par slide, gros
titres-messages (le titre de chaque slide est une phrase qui se suffit — pas un
libellé). Le deck est le support de l'oral ; le doc A est le détail écrit qu'on
laisse ensuite. Les deux doivent visiblement appartenir à la même famille.

## Déroulé des slides

1. **Titre** — baakalai + thèse : « Votre CRM sait déjà qui relancer. Personne ne
   le lit. baakalai le lit 24/7 — et déroule la relance. »
2. **Le problème** — un CRM de PME est plein de revenus endormis : deals sans
   suite, clients gagnés jamais recontactés, comptes qui glissent. Personne n'a
   le temps de le lire.
3. **Le coût du statu quo** — chaque deal dormant a déjà coûté son acquisition ;
   relancer l'existant est le revenu le moins cher. (Sans chiffres promis.)
4. **La solution** — le flux en 5 temps : connexion un clic → lecture continue →
   décision expliquée → rédaction → validation puis exécution depuis vos boîtes.
   Message clé : baakalai ne s'arrête pas au diagnostic, il **exécute** — sous
   votre contrôle.
5. **Réactivation de deals** (job héros) — détection continue, contexte du compte
   affiché, relance en séquence complète email + LinkedIn approuvée par vous,
   envoi groupé, deals ressuscités attribués à l'email causal.
6. **Upsell** — les clients gagnés sont le pipeline le moins cher ; file dédiée,
   suggestions de produits, même contrôle.
7. **Anti-churn** — 9 familles de signaux dont les registres légaux officiels ;
   scores expliqués facteur par facteur ; vos verdicts recalibrent le système.
8. **Qualité de données** — le carburant des trois jobs : nettoyage continu,
   score /100 expliqué, purge RGPD encadrée.
9. **Prospection incluse** — quand il faut de nouveaux leads : séquences
   email + LinkedIn envoyées depuis vos boîtes, réponses détectées, délivrabilité
   protégée. Aucun outil d'envoi à acheter en plus.
10. **Pilotage** — digest du lundi, forecast calibré sur votre réel, analytics
    natifs. « Le lundi matin, vous savez quoi faire. »
11. **Confiance** — rien ne part sans validation ; l'IA montre ses facteurs et
    ses patterns ; vos boîtes, votre nom, RGPD natif. (Slide anti-« boîte noire »,
    à l'oral c'est la réponse à l'objection n°1.)
12. **Pour qui** — PME B2B 5–200 personnes, ≥ 12 mois d'historique CRM, une base
    clients existante, pas d'équipe RevOps. 7 CRM connectés en un clic — y compris
    Notion, Airtable et Folk que personne d'autre n'exploite.
13. **Démarrage** — opérationnel le jour 1, premières files d'action le jour
    même. CTA : « Rejoindre la beta ».

## Notes d'intégration

- Les slides 5 à 10 sont la **matière features refreshée du 15/09** : elles
  remplacent toute version antérieure de ces slides (deck du 03/09).
- Ce qui est nouveau depuis le 03/09 et doit être visible dans le discours :
  l'exécution **native** des séquences (plus d'outil d'envoi tiers), les
  workflows de relance multi-étapes avec bifurcations, l'envoi groupé, la carte
  de contexte par deal, la transparence des scores, la conformité emails (
  désinscription un clic). Ne pas les étiqueter « nouveau » face au client —
  les présenter comme l'état normal du produit.
- Chaque slide feature doit pouvoir renvoyer au chapitre correspondant du doc A
  (« le détail est dans le document que nous vous laissons »).
