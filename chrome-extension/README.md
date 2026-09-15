# Extension Chrome « baakalai — LinkedIn Connect »

**Statut : ravivée le 2026-09-15 en périmètre minimal** (décision Goran — « il
faut un moyen plus simple que DevTools pour les users »). Elle avait été
parquée le 2026-09-01 ; ce fichier documente les deux décisions pour que ni
l'une ni l'autre ne soit reprise sans contexte.

## Périmètre v1.1 — cookie-connect, rien d'autre

Une seule mission : relier la session LinkedIn de l'utilisateur à son compte
baakalai, et la maintenir.

- **Connexion un clic** (popup) : détection du compte baakalai depuis un onglet
  ouvert, lecture du cookie `li_at` via `chrome.cookies` (il est httpOnly —
  aucun bookmarklet ni script de page ne peut le lire, l'extension est le seul
  moyen plus simple que DevTools), envoi vers `POST /api/settings/keys`.
- **Resync automatique** (`background.js`) : quand LinkedIn fait tourner ou
  renouvelle le cookie (reconnexion de l'utilisateur), il est renvoyé au
  backend — l'expiration devient auto-réparatrice tant que l'extension est
  installée et l'utilisateur connecté à LinkedIn. Garde-fou : le resync ne
  démarre qu'APRÈS un premier partage explicite dans le popup, et s'arrête à
  la déconnexion.
- **Pas de content-script** : `content.js` (overlay/scraping DOM LinkedIn)
  n'est plus référencé par le manifest. Le fichier reste dans le repo à titre
  d'archive — c'était la partie fragile (sélecteurs qui cassent) et la plus
  exposée côté CGU.

## Pourquoi le parquage de 2026-09-01 ne tient plus (en partie)

1. **« Usage réel : nul »** — obsolète. Depuis, le moteur d'envoi natif
   (2026-09-12) et les workflows de relance (2026-09-15) font de LinkedIn un
   canal cœur du produit : visites, invitations, messages exécutés par
   `lib/native-sequence-engine` pour les relances clients.
2. **« Contredit le positionnement »** — corrigé : le manifest ne parle plus
   d'« automated outreach » mais de relance de clients existants, et la
   publication doit se faire en **visibilité « unlisted »** (installable par
   lien direct uniquement, invisible dans la recherche du store).
3. **« Capture le cookie de session »** — inchangé sur le fond, mais ce risque
   est porté par le PRODUIT (toute la chaîne `api/linkedin.js` est active en
   prod), pas par le mode de capture : coller le cookie via DevTools expose
   exactement autant. L'extension ne change que l'ergonomie. Le trancher à
   nouveau = décision produit sur le canal LinkedIn lui-même, pas sur
   l'extension.

## Publication (action Goran)

1. Compte développeur Chrome Web Store (5 $ one-shot).
2. Zipper le dossier (sans `content.js` ni `icons/generate.html`).
3. **Visibilité : Unlisted.** Justification vie privée à remplir : cookies
   (connexion du compte LinkedIn de l'utilisateur, à sa demande), storage
   (session), pas de collecte de données de navigation.
4. Reporter l'URL d'installation dans le guide Réglages → LinkedIn
   (`SettingsPage.jsx`, étape « Installer l'extension »).

## Test local (sans store)

`chrome://extensions` → mode développeur → « Charger l'extension non
empaquetée » → ce dossier. Pour viser staging :
dans la console du service worker, `chrome.storage.local.set({ baakalai_api:
'https://baakal-staging.up.railway.app/api' })`.
