# Extension Chrome « Baakalai — LinkedIn Connect » — PARQUÉE

**Statut : hors périmètre. Ne pas publier, ne pas distribuer.** Décidé le 2026-09-01.

Le code est conservé, pas supprimé : une partie a de la valeur pour plus tard
(voir « Ce qui mérite d'être repris »). Ce fichier existe pour que la décision
ne soit pas reprise sans son contexte.

## Pourquoi elle est parquée

**Usage réel : nul.** Vérifié en base de production le 2026-09-01 —
1 seul compte LinkedIn connecté (celui du fondateur, inchangé depuis le
2026-05-13), et la table `linkedin_outreach` contient **0 ligne depuis sa
création**. L'extension n'a jamais produit une seule action.

**Elle contredit le positionnement.** Son manifeste annonce « Enables
automated outreach and enrichment » : c'est de l'outillage prospection. Or la
prospection est une porte d'entrée, pas le produit — la publier au Chrome Web
Store remettrait ce « ET » dans la vitrine la plus visible qui soit.

**Elle capture le cookie de session LinkedIn.** `popup.js` lit `li_at` via
`chrome.cookies.get` et l'envoie au backend. Ce n'est pas un OAuth périmétré :
c'est un accès complet et permanent au compte LinkedIn de l'utilisateur.
Les CGU LinkedIn l'interdisent, et le compte banni serait **celui du client**.
C'est aussi un passif de sécurité incompatible avec la posture RGPD du produit
(anonymisation des patterns, RLS) au moment d'ouvrir une beta payante.

**Coût de maintenance non nul pour zéro retour** : Manifest V3, sélecteurs DOM
LinkedIn qui cassent à chaque refonte, publication au store à entretenir.

## Ce qui mérite d'être repris

**L'overlay** — et lui seul. `backend/routes/extension.js` affiche, sur un
profil LinkedIn, la fiche CRM du contact (notes, campagnes, patterns) avec
ajout de note, enrichissement et email rapide. C'est de l'affichage, pas de
l'automation : aucun risque CGU, et c'est exactement le positionnement —
l'intelligence CRM là où le commercial travaille déjà.

La suite naturelle n'est probablement pas LinkedIn mais **le CRM lui-même**
(injecter les signaux dans Pipedrive / HubSpot / Salesforce). Voir
`hubspot-app/`, qui est le début de ce chemin par la voie officielle.

## Risque résiduel — hors extension

Le cookie `li_at` n'est pas consommé que par l'extension. Toute une chaîne
backend en dépend et reste **active** :

- `backend/api/linkedin.js` — appelle l'API interne Voyager de LinkedIn
- `backend/lib/agents/linkedin-outreach.js`
- `backend/routes/signals.js` → `POST /api/signals/:id/linkedin-outreach`
  (envoi de demandes de connexion, déclenchable par l'utilisateur)

Dormant en pratique (1 cookie stocké, 0 envoi jamais effectué), mais le code
est en production. **Le retirer est une décision distincte du parquage de
l'extension** : ça touche `routes/signals.js`, qui est vivant et fonctionne.
À trancher avant l'ouverture de la beta payante.
