Tu es un product designer senior B2B SaaS. Produis un mockup HTML interactif et autonome de la nouvelle fonctionnalité « Workflow de relance » de baakalai. Le rendu doit permettre de juger l'expérience finale : hiérarchie, densité, micro-interactions. Sobre et précis : pense Linear, Attio, Stripe Dashboard. Pas de "startup flashy".

## Contexte produit

baakalai est le système IA qui exploite le CRM d'une PME B2B pour générer du revenu : il lit le CRM 24/7, repère les deals dormants à réactiver et les clients à upseller. Aujourd'hui il propose un email one-shot par deal. La nouvelle fonctionnalité : pour chaque deal dormant, **l'agent conçoit un workflow de relance multicanal sur mesure** (emails depuis la boîte de l'utilisateur + actions LinkedIn), que l'utilisateur **visualise graphiquement, édite et approuve** avant que le moteur ne l'exécute jour après jour. Rien ne part sans validation.

## Brand

- Nom : baakalai (toujours en minuscule)
- Couleur primaire : #6E57FA (purple) : réservée aux actions et à l'identité
- Couleur secondaire : #C4B5FD (lavender)
- Background : #FAFAF9 (paper), cartes #FFFFFF
- Texte : #0A0A0A (ink), secondaire #6B7280
- Font : Geist Sans (fallback Inter)
- Canaux (couleurs sémantiques, pas décoratives) : email = purple #6E57FA, LinkedIn = #0A66C2, branche « si accepté » = vert #16A34A, branche « si pas de réponse » = gris #9CA3AF
- Ton UI : français, direct, orienté revenu. Jamais de jargon technique (« enrollment », « touchpoint ») : dire « workflow », « étape », « relance »

## Écrans à maquetter (une seule page HTML, navigation par onglets ou ancres)

### Écran 1 : Liste « Deals à relancer » (évolution de l'existant)

Tableau de deals dormants : entreprise, contact, montant, étape pipeline, « dormant depuis X jours », score /100. Deux actions par ligne : « Email rapide » (l'existant, secondaire) et « **Proposer un workflow** » (nouveau, primaire). Une ligne montre l'état « Workflow actif : étape 2/5, prochaine : mar. 24 sept. » avec une mini barre de progression à la place des boutons.

### Écran 2 : Proposition de workflow (l'écran clé, soigne-le)

C'est l'écran qui doit convaincre. Trois zones :

1. **En-tête contexte deal** : « Renouvellement licence : Datakori », 18 400 €, étape « Négociation », dormant depuis 47 jours, contact Claire Fontan (Directrice des opérations), owner Goran. Compact, une bande, pas une carte géante.

2. **Rationale de l'agent** (bloc court, fond lavender très léger #F8F7FF, bordure gauche #6E57FA) : 2-3 phrases expliquant POURQUOI ce plan. Exemple : « Claire a ouvert vos 2 derniers emails sans répondre. Sur vos deals similaires (>15 k€, dormants 30-60 j), la combinaison email + passage LinkedIn a réengagé 3 deals sur 5. Je propose 5 étapes sur 12 jours, avec une bascule LinkedIn si l'email reste sans réponse. » Mentionner discrètement la source : « Basé sur 12 relances similaires dans votre historique ».

3. **Le workflow graphique** : le morceau central. Timeline **verticale** d'étapes reliées par un trait, avec **une bifurcation conditionnelle visible** :
   - Étape 1 · J0 · [chip EMAIL] « Reprise de contact » : carte dépliable : objet + corps de l'email pré-rédigé, éditable (textarea au clic sur « Modifier »)
   - Étape 2 · J+3 · [chip LINKEDIN · Visite] « Visite de profil » : carte fine, pas de contenu
   - Étape 3 · J+5 · [chip LINKEDIN · Invitation] « Invitation avec note » : note de 300 caractères max, compteur visible
   - **Bifurcation** après l'étape 3, deux branches dessinées :
     - Branche verte « Si Claire accepte » → Étape 4a · J+7 · [chip LINKEDIN · Message] message direct
     - Branche grise « Si pas de réponse » → Étape 4b · J+9 · [chip EMAIL] « Relance angle ROI »
   - Étape 5 · J+12 · [chip EMAIL] « Dernière relance avant clôture »
   - Chaque carte : poignée de réorganisation, menu ⋯ (Modifier / Supprimer / Changer le délai), le délai « J+N » cliquable (stepper)
   - Bouton discret « + Ajouter une étape » entre les étapes au survol

4. **Barre d'action fixe en bas** : à gauche « 5 étapes · 12 jours · 3 emails, 2 actions LinkedIn », à droite bouton secondaire « Régénérer » et bouton primaire « **Valider le workflow** ». Sous le bouton, une ligne de réassurance : « Chaque étape part de votre boîte Gmail. Le workflow s'arrête dès que Claire répond. »

### Écran 3 : Workflow validé (état de suivi)

Même timeline mais en mode lecture : étapes passées cochées avec date réelle d'envoi (« Envoyé mar. 17 sept., ouvert »), étape courante en surbrillance avec « Prévu jeu. 19 sept. vers 9 h », étapes futures estompées. Bandeau de statut en haut : badge vert « Actif », bouton « Mettre en pause » et « Arrêter le workflow ». Si une réponse est détectée : bandeau de célébration sobre « Claire a répondu : workflow arrêté. 1 deal réengagé. » avec CTA « Voir la réponse ».

## Interactions attendues (JS vanilla dans la page)

- Cartes d'étapes dépliables/repliables au clic
- Passage Écran 1 → 2 → 3 par les CTA (simulé)
- Le clic « Valider le workflow » joue une transition vers l'état validé
- Hover states propres sur toutes les zones cliquables

## Contraintes

- Un seul fichier HTML autonome (CSS + JS inline), aucune dépendance externe sauf Google Fonts Inter
- Desktop-first, largeur de contenu ~1080px, mais rien ne doit casser à 768px
- Données d'exemple réalistes PME B2B française (emails en @…​.example) : jamais de lorem ipsum
- La timeline et la bifurcation doivent être dessinées en CSS (flex/grid + pseudo-éléments ou SVG inline simple), lisibles d'un coup d'œil : c'est LE test de cet écran
- Accessibilité de base : contrastes AA, focus visibles
