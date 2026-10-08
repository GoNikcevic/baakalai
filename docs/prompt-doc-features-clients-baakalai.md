# Prompt Claude design : doc features clients + deck commercial

> **Usage** : copier la totalité de ce fichier dans Claude (mode design) en une fois.
> **Version** : 2.0 du 23/09/2026, matière issue de l'analyse features refresh 23/09
> (artifact interne `1a852dbc`). Remplace la v1.0 du 15/09.
> **Deux livrables demandés** : (A) un document features présentable aux clients,
> (B) le deck commercial qui l'intègre.
>
> **Ce qui change depuis la v1.0** : le produit chiffre désormais le revenu dormant
> avant toute action (Hidden Revenue Score), la page churn agit au lieu d'alerter,
> Outlook est complet, l'envoi se répartit sur plusieurs boîtes, et le produit rend
> compte de son travail chaque lundi. Deux interdits de la v1.0 sont levés (ils
> étaient vrais au 15/09, ils ne le sont plus), trois nouveaux sont posés.

---

Tu es directeur artistique et copywriter senior pour **baakalai**, un produit SaaS
français. Tu produis **deux livrables** : un document features destiné aux clients
(leave-behind après démo, envoyable en PDF) et le deck commercial qui l'intègre.

## 1. Le produit, en une minute

baakalai est un système d'agents IA qui se branche sur le CRM existant d'une PME
(Salesforce, HubSpot, Pipedrive, Odoo, Notion, Airtable, Folk) et fait le travail
d'exploitation que personne n'a le temps de faire : chiffrer ce que la base
contient de revenu inexploité, repérer les deals dormants et dérouler la séquence
de relance, détecter les clients mûrs pour un upsell, alerter avant le churn,
nettoyer les données en continu. Il rédige et **exécute** les relances depuis les
boîtes email et le LinkedIn du client, mais **rien ne part jamais sans validation
humaine**.

- **Audience** : dirigeants et responsables commerciaux de PME B2B (5 à 200
  personnes), sans équipe RevOps à temps plein. Lecteurs pressés, allergiques au
  jargon, sensibles au concret.
- **Thèse centrale (à marteler)** : « Votre CRM sait déjà qui relancer. Personne ne
  le lit. baakalai le lit 24/7, et déroule la relance. »
- **Accroche secondaire, nouvelle et forte** : le produit commence par dire
  **combien** il y a à récupérer, avec une fourchette en euros calculée sur les
  vraies données du client. On ouvre sur un chiffre, pas sur une promesse.
- **Hiérarchie des jobs, toujours dans cet ordre** : réactivation de deals (héros),
  upsell, anti-churn, qualité de données (le carburant des trois). La prospection
  existe et est autonome, mais c'est la porte d'entrée, jamais l'ouverture.
- **Ton** : expert, direct, concret. Phrases courtes. Français impeccable.
  Style YC : des faits, pas des adjectifs.

## 2. Identité visuelle (commune aux deux livrables)

- Accent **violet #6E57FA** sur fonds clairs neutres (blanc cassé, gris chauds).
  Texte encre presque noire. Une seule couleur d'accent, pas d'arc-en-ciel.
- Typographie sobre et contemporaine, hiérarchie forte (gros titres courts, corps
  aéré, étiquettes uppercase discrètes). Chiffres en tabular pour les listes de faits.
- Pas d'emoji, pas d'icônes gadget, pas d'illustrations « robots ». Si visuels :
  schémas simples (flux CRM vers baakalai vers action validée), captures stylisées
  de files d'action, badges sobres.
- Aéré. Une idée par écran ou par section. Le blanc est un choix, pas un vide.

## 3. Interdits absolus (les deux livrables)

- **Zéro prix.** Nulle part. Le tarif se discute à l'oral.
- **Aucun tiret cadratin ni demi-cadratin.** Ni dans les titres, ni dans le corps,
  ni dans les légendes. Règle produit stricte : c'est la signature visuelle d'un
  texte généré, et baakalai vend de l'IA qui écrit à la place du commercial.
  Remplacer selon le sens : deux-points, virgule, parenthèses, « à » pour une
  fourchette chiffrée. Typographie française : espace avant les deux-points.
- Jamais « remplace votre RevOps » ni « remplace vos commerciaux ». Le cadrage est :
  « la fonction que vous n'auriez jamais pu vous offrir ».
- Jamais « 100 % automatique » ni « autonome » sans nuance : **toujours** rappeler
  que chaque envoi est validé par l'utilisateur.
- Aucune promesse chiffrée de ROI (« +30 % de deals récupérés »). Le seul cadrage
  autorisé est « un deal récupéré paie l'outil » (ordre de grandeur, pas promesse).
  La fourchette du score de revenu dormant est un **constat sur les données du
  client**, pas une promesse de résultat : le formuler ainsi, toujours.
- Aucun nom de concurrent dans le doc client.
- Pas de vocabulaire interne : « staging », « migration », « agent n° », noms de
  fichiers, dates de livraison internes, numéros de version.

### Ne jamais mentionner (état au 23/09)

- **Les déclencheurs événementiels sur signaux externes** (la nouvelle page
  Automatisations). Livrés mais pas encore éprouvés en usage réel : hors périmètre
  des deux livrables. Ce qui est présentable, ce sont les **règles de relance
  automatiques sur événements CRM**, en service (voir section A8).
- **Les dimensions non calculées du score de revenu dormant.** Le score porte
  aujourd'hui sur le pipeline dormant et la réactivation client. Ne jamais laisser
  croire qu'il couvre l'expansion et la réactivation de leads.
- **Un forecast calibré sur le cycle de vente réel du client.** Parler de forecast
  appris sur l'historique et recalibré chaque semaine, sans promettre la finesse du
  cycle réel.
- **Outlook en un clic.** Outlook est supporté, en envoi comme en lecture des
  réponses, mais le consentement passe encore par un administrateur. Dire « Gmail et
  Outlook supportés », jamais « connexion Outlook en un clic ».
- L'enrichissement ou le reveal d'adresses email, la facturation, l'essai gratuit,
  la détection de réponses sur SMTP personnalisé.

### Deux interdits de la v1.0 qui sont levés

- **Les workflows proposés par l'IA** : c'était interdit au 15/09, c'est faux
  aujourd'hui. baakalai **propose** un workflow de relance par deal ou par client,
  avec un écran d'approbation. Formulation exacte à respecter : l'IA propose,
  l'humain active. Ne jamais dire qu'il conçoit et lance seul.
- **Les réponses sur boîtes Microsoft** : la lecture des réponses fonctionne
  désormais sur Gmail et Outlook. Dire « Gmail et Outlook », jamais « toutes vos
  boîtes ».

---

# LIVRABLE A : document features clients

**Format** : document vertical élégant (web ou PDF A4), 8 à 12 pages ou écrans.
C'est le document qu'on laisse après une démo : il doit être **détaillé**, le
lecteur doit pouvoir comprendre précisément ce que fait le produit sans nous, tout
en restant scannable (titres qui portent le message, détails en dessous).

**Titre proposé** : « baakalai en détail : ce que fait le produit, et comment il
travaille sous votre contrôle ». Sous-titre : la thèse centrale.

## Structure et contenu (détail à respecter, reformulation libre)

### A1. La thèse (1 page)
Le CRM d'une PME contient des deals dormants, des clients mûrs pour un upsell et
des comptes qui glissent vers le churn, mais personne n'a le temps de le lire.
baakalai le lit en continu, décide quoi faire, rédige, et exécute après validation.

### A2. Ce que votre CRM contient déjà (1 page, nouvelle et importante)
La page qui met un chiffre sur la table avant de parler de fonctionnalités.
- baakalai calcule un **score de revenu dormant** et une **fourchette en euros** sur
  vos propres données : le pipeline qui dort et les clients gagnés qu'on n'a jamais
  recontactés.
- Le montant est accompagné d'un **niveau de confiance qui élargit ou resserre la
  fourchette**. Moins votre CRM est exploitable, plus la fourchette est large.
  L'inverse du diagnostic gratuit qui annonce un chiffre rond sans rien savoir de
  vous : ici l'incertitude est affichée, pas masquée.
- Le sens de lecture est assumé : **un score qui baisse est une bonne nouvelle**, la
  réserve se vide parce que vous êtes allé la chercher. L'écran le dit.
- Chaque composante est cliquable et ouvre l'écran qui agit dessus.
- Un compteur suit le **revenu réellement récupéré** : uniquement des deals gagnés
  après une relance baakalai, jamais des deals qui allaient se signer de toute façon.
- Mentionner que ce calcul est disponible **avant même de créer un compte**, sur le
  site, à partir d'une simple connexion de lecture du CRM.

### A3. Comment ça marche (1 page, schéma)
Cinq temps, en flux visuel :
1. **Connexion** : le CRM se branche en un clic (OAuth), les boîtes email aussi.
2. **Lecture continue** : deals, contacts, activités, signaux externes.
3. **Décision** : scores et files d'action priorisées, chaque score expliqué.
4. **Rédaction** : emails écrits depuis le contexte réel du compte.
5. **Validation puis exécution** : vous approuvez, baakalai envoie depuis **vos**
   boîtes, suit les réponses, et s'arrête quand quelqu'un répond.

### A4. Réactivation de deals (le job héros, la page la plus riche)
- Détection continue des deals sans activité réelle ou arrivés à leur date de
  relance prévue, file « Deals à relancer » priorisée.
- **Vue globale qui se lit d'un coup d'oeil** : une pastille de silence par deal
  (rouge au delà de 60 jours, ambre au delà de 30), l'étape et le nombre de jours
  passés dedans, la relance prévue, le score, et un tri par défaut sur le plus long
  silence. On voit lesquels sont en train de mourir sans ouvrir une seule fiche.
- Pour chaque deal, une carte « Situation avec l'entreprise » : étape, montant,
  niveau de risque, ancienneté du silence, et le « pourquoi maintenant ».
- Brouillon de relance rédigé depuis ce contexte, et le produit **montre les
  patterns appris** qu'il a appliqués (ce qui a marché par le passé, appliqué à cet
  email, visible à l'écran).
- **Workflow de relance proposé par baakalai, deal par deal** : plusieurs étapes
  email et LinkedIn, avec bifurcation selon la réponse. Le workflow naît en
  brouillon et ne part pas tant que vous ne l'avez pas activé.
- Envoi groupé : traiter toute la file en une session, chaque email restant
  individuellement rédigé et validable.
- Attribution : quand un deal repart, baakalai relie la reprise à l'email qui l'a
  causée. Vous voyez ce que la relance a rapporté.

### A5. Upsell sur la base clients
- File « Clients à upseller » : clients gagnés dont l'activité retombe, scorés.
- Suggestions de produits à proposer quand le catalogue est renseigné.
- Même mécanique que la réactivation : contexte affiché, envoi groupé, validation.
- La fonction du contact est affichée partout dans les listes, pas seulement son
  nom : on sait à qui on parle avant d'ouvrir la fiche.

### A6. Anti-churn, et la page qui agit
- Score de risque sur 9 familles de signaux : inactivité réelle, stagnation,
  engagement email, sentiment des échanges, secteur, historique d'upsell, signaux
  web publics, **santé financière officielle** (registres légaux : BODACC,
  Companies House, procédures collectives US), emails qui rebondissent.
- Chaque score détaille ses facteurs à l'écran : vous voyez *pourquoi* un compte est
  à risque, pas juste un chiffre.
- **La page ne se contente pas d'alerter.** Pour chaque client à risque, baakalai
  propose un parcours de rétention, et permet de traiter toute la liste en une fois,
  en envoi direct ou en brouillons à approuver.
- **Le message est écrit pour retenir, pas pour vendre.** Un client à risque ne
  reçoit jamais une proposition d'extension : la rédaction de rétention est un
  moteur distinct de celui de l'upsell. Point de détail qui compte énormément à
  l'oral, il prouve que le produit comprend la différence.
- Vos verdicts (d'accord, pas d'accord) recalibrent les pondérations chaque semaine.
  Les comptes chauds sont re-vérifiés plusieurs fois par jour.

### A7. Qualité de données (le carburant)
- Nettoyage continu : doublons, champs manquants corrigés en un clic, emails
  invalides détectés (format, domaine mort, adresses jetables, fautes de frappe),
  bounces réels tracés.
- **Fusion de doublons entièrement arbitrée par vous** : vous choisissez la fiche
  conservée, puis la valeur à garder champ par champ, y compris quand l'une des
  deux fiches a une information que l'autre n'a pas. Rien n'est écrasé en silence.
- **Et surtout : baakalai n'abîme pas votre CRM.** Un contact ou un deal déjà connu
  est mis à jour, jamais recréé en double, sur les sept connecteurs. Le contenu que
  vous avez saisi dans votre CRM n'est jamais réécrit par le produit. C'est la peur
  numéro un du dirigeant qui branche un outil sur sa base : y répondre frontalement.
- Score de qualité sur 100, avec tendance et détail des facteurs.
- Purge RGPD encadrée : export obligatoire avant suppression, annulable.

### A8. Les relances qui partent toutes seules (nouvelle section)
- Des règles simples posées en quelques clics : deal gagné, deal qui stagne, contact
  inactif, échéance de renouvellement, client qui bascule à risque, réengagement
  d'une base inactive ou engagée.
- **Trois recettes prêtes à poser**, qui affichent le nombre de contacts concernés
  **avant** qu'on les arme. On sait ce qu'on déclenche.
- **Un aperçu montre exactement ce qui va partir** avant l'activation, et l'écran dit
  franchement quand aucune boîte mail n'est connectée, au lieu de laisser croire que
  ça tourne.
- Garde-fous : volume borné par règle et par heure, arrêt immédiat dès qu'une
  personne répond, et un contact déjà en cours de conversation n'est jamais
  réinscrit ailleurs.

### A9. Prospection (présentée comme complément, pas comme coeur)
- Quand il faut de nouveaux leads : création de campagne assistée par IA, vraies
  sources de leads, séquences email et LinkedIn envoyées **depuis les boîtes du
  client**, aucun outil d'envoi tiers à acheter.
- **Plusieurs boîtes d'envoi, choisies campagne par campagne**, avec un plafond
  journalier propre à chaque boîte. Deux boîtes veulent dire deux fois le volume,
  pas un plafond partagé.
- Les réponses sont détectées sur Gmail et Outlook, **sur toutes les boîtes
  actives** : la séquence s'arrête d'elle-même et l'IA prépare la suite.
- **Vous êtes prévenu à chaque réponse**, dans l'application et par email, que la
  conversation soit prise en main par baakalai ou par vous.
- **La conversation peut être menée jusqu'au rendez-vous, avec une profondeur que
  vous réglez** : jusqu'à trois échanges en prospection, un seul côté clients, et la
  proposition de rendez-vous tombe au dernier échange autorisé. Vous pouvez aussi
  demander la main dès la première réponse.
- LinkedIn se connecte en un clic depuis le navigateur, sans confier de mot de passe.
- Garde-fous de délivrabilité intégrés : plafonds d'envoi quotidiens, fenêtres
  ouvrées, signature propre à chaque boîte.

### A10. Pilotage, et un produit qui rend des comptes
- **« Cette semaine, baakalai a... »**, en tête de votre tableau de bord et en tête
  de l'email du lundi : les résultats d'abord, l'effort derrière comme preuve, et
  **aussi ce qui a raté et ce qui vous attend**. Une semaine sans résultat le dit
  franchement (« a relu 412 comptes, rien à signaler ») plutôt que d'afficher des
  zéros. Le temps gagné est estimé avec un barème volontairement bas, affiché, et
  arrondi vers le bas.
- Digest hebdomadaire par email le lundi : signaux, priorités, engagements de
  réactivité (SLAs) dépassés.
- Forecast par deal appris sur votre historique, trois scénarios, recalibré chaque
  semaine contre les deals réellement gagnés ou perdus.
- Analytics natifs : pipeline, où meurent les deals, attribution, géographie,
  filtres par produit.

### A11. Contrôle, transparence, conformité (page de confiance, ne pas la couper)
- **Rien ne part sans validation.** L'automatisation propose, vous disposez.
- L'IA montre son travail : chaque score expose ses facteurs, chaque email les
  patterns appliqués, chaque règle son aperçu avant activation.
- Envois depuis vos boîtes, à votre nom, avec vos signatures, dans vos plafonds.
- Vous êtes alerté à chaque réponse : le produit ne mène jamais une conversation
  dans votre dos.
- RGPD : préférences d'emails par catégorie, désinscription en un clic conforme aux
  exigences Gmail et Yahoo, purge de données encadrée.

### A12. Pour votre équipe
- Sept CRM connectés en un clic, dont Notion, Airtable et Folk que personne d'autre
  n'exploite.
- **Aucune limite de sièges** : le produit tient une vraie force de vente, pas
  seulement un dirigeant qui regarde son CRM tout seul.
- Chaque membre garde son périmètre, et la mémoire du système se construit sur tout
  ce que l'équipe valide ou corrige.

### A13. Ce que baakalai ne fait pas (3 à 4 lignes, assumées)
Il ne migre pas un CRM vers un autre, ne choisit pas votre stack, ne fait ni
territoires ni plans de commission, et ne remplace pas les conversations entre vos
équipes. Il fait le travail d'exploitation du CRM que personne ne fait.

### A14. Démarrage (page finale + CTA)
Opérationnel le jour 1 : CRM connecté en un clic, lecture, scores et premières files
d'action le jour même. CTA : **« Rejoindre la beta »**.

---

# LIVRABLE B : deck commercial mis à jour

**Format** : deck 16:9, 14 slides, même identité. Une idée par slide, gros
titres-messages (le titre de chaque slide est une phrase qui se suffit, pas un
libellé). Le deck est le support de l'oral, le doc A est le détail écrit qu'on
laisse ensuite. Les deux doivent visiblement appartenir à la même famille.

**Changement de structure par rapport à la v1.0** : l'ancienne slide « coût du
statu quo » disparaît en tant que telle et se fond dans la nouvelle slide 3, qui
dit la même chose avec le chiffre du client plutôt qu'avec un raisonnement.

## Déroulé des slides

1. **Titre** : baakalai + thèse. « Votre CRM sait déjà qui relancer. Personne ne le
   lit. baakalai le lit 24/7, et déroule la relance. »
2. **Le problème** : un CRM de PME est plein de revenus endormis. Deals sans suite,
   clients gagnés jamais recontactés, comptes qui glissent. Personne n'a le temps de
   le lire.
3. **Le chiffre (slide nouvelle, et c'est le pivot du deck)** : baakalai commence par
   dire combien il y a à récupérer, en euros, sur les données du prospect, avec une
   fourchette qui s'élargit quand la donnée est faible. Message : on n'ouvre pas sur
   une promesse, on ouvre sur votre propre base. À l'oral, c'est ici qu'on montre le
   diagnostic fait avant le rendez-vous.
4. **La solution** : le flux en 5 temps, connexion en un clic, lecture continue,
   décision expliquée, rédaction, validation puis exécution depuis vos boîtes.
   Message clé : baakalai ne s'arrête pas au diagnostic, il **exécute**, sous votre
   contrôle.
5. **Réactivation de deals** (job héros) : détection continue, vue qui montre
   lesquels sont en train de mourir, contexte du compte affiché, workflow de relance
   proposé puis approuvé par vous, envoi groupé, deals ressuscités attribués à
   l'email causal.
6. **Upsell** : les clients gagnés sont le pipeline le moins cher. File dédiée,
   suggestions de produits, même contrôle.
7. **Anti-churn** : 9 familles de signaux dont les registres légaux officiels, scores
   expliqués facteur par facteur, **et une page qui relance au lieu d'alarmer**, avec
   un message écrit pour retenir et jamais pour vendre.
8. **Qualité de données** : le carburant des trois jobs. Nettoyage continu, fusion
   arbitrée champ par champ, score /100 expliqué, purge RGPD encadrée. Et le point
   qui rassure : baakalai ne duplique rien et ne réécrit rien dans votre CRM.
9. **Les relances qui partent toutes seules (slide nouvelle)** : des règles simples
   sur les événements de votre CRM, avec le nombre de contacts concernés affiché
   avant d'armer, un aperçu de ce qui va partir, et un arrêt immédiat dès qu'une
   personne répond.
10. **Prospection incluse** : quand il faut de nouveaux leads, séquences email et
    LinkedIn depuis vos boîtes, plusieurs boîtes réparties par campagne, réponses
    détectées sur Gmail et Outlook, conversation menée jusqu'au rendez-vous avec une
    profondeur que vous réglez. Aucun outil d'envoi à acheter en plus.
11. **Pilotage, et un produit qui rend des comptes** : le bloc du lundi qui dit ce
    que baakalai a fait, ce qui a raté et ce qui vous attend, plus le digest, le
    forecast et les analytics. « Le lundi matin, vous savez ce qui a été fait et quoi
    faire. »
12. **Confiance** : rien ne part sans validation, l'IA montre ses facteurs et ses
    patterns, vous êtes alerté à chaque réponse, vos boîtes, votre nom, RGPD natif.
    Slide anti « boîte noire », à l'oral c'est la réponse à l'objection numéro 1.
13. **Pour qui** : PME B2B de 5 à 200 personnes, au moins 12 mois d'historique CRM,
    une base clients existante, pas d'équipe RevOps à temps plein. Sept CRM connectés
    en un clic, y compris Notion, Airtable et Folk que personne d'autre n'exploite.
    Aucune limite de sièges.
14. **Démarrage** : opérationnel le jour 1, premières files d'action le jour même.
    CTA : « Rejoindre la beta ».

## Notes d'intégration

- Les slides 5 à 11 sont la **matière features du 23/09** : elles remplacent toute
  version antérieure de ces slides (decks du 03/09 et du 15/09).
- Ce qui est nouveau et doit être visible dans le discours, **sans jamais être
  étiqueté « nouveau » face au client** (c'est l'état normal du produit) : le chiffre
  de revenu dormant posé avant la démo, la page churn qui agit avec un rédacteur de
  rétention distinct, l'envoi réparti sur plusieurs boîtes avec Outlook complet, la
  conversation autopilote à profondeur réglable, l'alerte à chaque réponse, le bilan
  hebdomadaire de ce que le produit a fait, l'absence de plafond de sièges, et
  l'engagement de ne rien dupliquer ni écraser dans le CRM du client.
- Chaque slide feature doit pouvoir renvoyer au chapitre correspondant du doc A
  (« le détail est dans le document que nous vous laissons »).
- Les trois angles à garder en tête en écrivant, dans cet ordre de puissance :
  « le chiffre avant la démo », « de la lecture à l'exécution », « il rend des
  comptes ».
