# Changelog — 3 mars 2026

> Résumé de toutes les modifications apportées au projet Bakal aujourd'hui.
> **6 fichiers modifiés · +987 lignes ajoutées · -183 supprimées · 5 commits**

---

## Vue d'ensemble

| # | Commit | Description |
|---|--------|-------------|
| 1 | `4a5cdfa` | Bouton Inspiration → redirection vers le chat assistant |
| 2 | `f89ef5e` | Fix Lemlist API key test (Bearer → Basic Auth) |
| 3 | `05310f7` | Configuration des clés API via le chat assistant |
| 4 | `ed75476` | Catalogue d'intégrations + onboarding guidé (10 outils) |
| 5 | `1a88eb9` | Extension du catalogue à 22 outils B2B dans 7 catégories |

---

## 1. Bouton « Besoin d'inspiration » → Chat assistant

**Fichiers :** `app/nav.js`, `app/bakal-saas-mockup.html`

**Avant :** Le bouton « Besoin d'inspiration » dans le formulaire de création de campagne affichait un panel statique avec des suggestions pré-codées.

**Après :** Le bouton redirige maintenant vers le chat assistant avec un message pré-rempli :
> « Aide-moi à créer une campagne. Propose-moi une cible et un angle basés sur ce qui fonctionne le mieux. »

**Détails :**
- `toggleInspiration()` ferme le modal créateur, ouvre le chat, et envoie automatiquement le message
- Le panel inspiration statique dans le HTML a été remplacé par un simple bouton de redirection
- Code mort supprimé : `applyInspirationSuggestion()`, `closeInspirationToEdit()`, `setSelectByText()`, `rotateInspiration()`, `inspirationSuggestions[]`

---

## 2. Fix test de clé API Lemlist (HTTP 400)

**Fichier :** `backend/routes/settings.js`

**Problème :** Le test de connexion Lemlist retournait une erreur HTTP 400. L'API Lemlist utilise **Basic Auth** (pas Bearer).

**Correction :**
```js
// Avant (incorrect)
Authorization: `Bearer ${key}`

// Après (correct)
const basic = Buffer.from(':' + key).toString('base64');
Authorization: `Basic ${basic}`
```

---

## 3. Configuration des clés API via le chat assistant

**Fichier :** `app/chat-engine.js`

**Fonctionnalité :** Les utilisateurs peuvent maintenant configurer leurs clés API directement dans le chat, sans aller dans les Paramètres.

**Ce qui a été ajouté :**
- Nouveau stage de conversation `'api_keys'` avec tracking de `apiKeyField`
- Détection automatique du type de clé selon le format (ex: `sk-ant-` → Claude, `ntn_` → Notion)
- `detectApiKeyIntent()` — reconnaît les demandes comme « connecter mon API », « configurer ma clé »
- `handleApiKeyInput()` — gère le flux complet : détection → demande de clé → confirmation
- `saveApiKeyViaChat()` — sauvegarde via `BakalAPI.saveKeys()` + test via `BakalAPI.testKeys()`
- Gestion asynchrone avec flag `_asyncApiKey` pour les opérations de sauvegarde
- Réponses en français avec feedback visuel (connecté / erreur / format invalide)

---

## 4. Catalogue d'intégrations + onboarding guidé

**Fichiers :** `app/chat-engine.js`, `app/bakal-saas-mockup.html`, `app/pages.js`, `backend/routes/settings.js`

**Fonctionnalité :** Le chat assistant peut maintenant expliquer les intégrations disponibles et guider l'utilisateur à travers la configuration.

### Chat engine (`chat-engine.js`)
- Objet `INTEGRATIONS` — catalogue de 10 outils avec : label, icon, category, priority, regex, prefix, desc, benefit, howToGet, url
- Objet `CATEGORY_INFO` — descriptions par catégorie (Core, CRM, Enrichment, Calendar)
- `isOnboardingIntent()` — détecte « quels outils », « intégrations », « onboarding »
- `handleOnboardingStart()` — affiche toutes les catégories avec les outils listés
- `handleCategoryExplain(category)` — vue détaillée d'une catégorie avec benefits + howToGet
- `handleToolExplain(field)` — détail d'un outil avec instructions étape par étape
- `detectWhichKey()` — détection par nom d'outil ou par catégorie

### Backend (`settings.js`)
- `KEY_MAP` étendu de 3 à 10 clés
- `testKey()` enrichi avec des endpoints de test pour : HubSpot, Pipedrive, Dropcontact, Apollo, Hunter, Calendly
- Helper `testBearer()` pour les tests d'auth Bearer standardisés
- `validateKeyFormat()` avec validations spécifiques (HubSpot `pat-`, etc.)

### Settings page (`bakal-saas-mockup.html`)
- 4 sections de cartes : Core, CRM, Enrichissement, Calendrier
- Dashboard de statut de connexion avec 6 outils

### Pages.js
- `saveSettings()`, `loadSettingsKeys()`, `testApiConnections()`, `localChecks` — tous étendus à 10 outils

---

## 5. Extension à 22 outils B2B (7 catégories)

**Fichiers :** tous les 5 fichiers principaux + `app/notifications.js`

### 12 nouveaux outils ajoutés

| Catégorie | Nouveaux outils |
|-----------|----------------|
| **CRM** | Folk |
| **Enrichissement** | Kaspr, Lusha, Snov.io |
| **Outreach** | Instantly, La Growth Machine, Waalaxy |
| **Scraping** | PhantomBuster, Captain Data |
| **Calendrier** | Cal.com |
| **Délivrabilité** | Mailreach, Warmbox |

### Catalogue complet (22 outils × 7 catégories)

#### ⚡ Core (3)
| Outil | Rôle dans Bakal |
|-------|----------------|
| **Lemlist** | Exécution des séquences email + LinkedIn, suivi opens/clicks/replies |
| **Claude (Anthropic)** | Génération IA du copy, analyse de performance, variantes A/B, boucle d'optimisation |
| **Notion** | Hub central — résultats, diagnostics, historique, mémoire cross-campagne |

#### 📊 CRM (4)
| Outil | Rôle dans Bakal |
|-------|----------------|
| **HubSpot** | Sync des leads qualifiés dans le pipeline, création contacts/deals |
| **Pipedrive** | Push des leads en deals, mise à jour des étapes du pipeline |
| **Salesforce** | Sync entreprise — leads/contacts vers opportunités Salesforce |
| **Folk** | CRM léger — sync des interactions et tags prospects |

#### 🔎 Enrichissement (6)
| Outil | Rôle dans Bakal |
|-------|----------------|
| **Dropcontact** | Recherche et vérification d'emails pro. RGPD-compliant (pas de base) |
| **Apollo.io** | Base B2B massive — emails, téléphones, signaux d'intention |
| **Hunter.io** | Email finder + vérificateur. Patterns de domaine + validation |
| **Kaspr** | Extraction téléphone + email depuis profils LinkedIn |
| **Lusha** | Enrichissement contacts B2B — emails et lignes directes |
| **Snov.io** | Recherche email par domaine/LinkedIn + vérification deliverability |

#### 📤 Outreach (3)
| Outil | Rôle dans Bakal |
|-------|----------------|
| **Instantly** | Cold email à grande échelle — multi-comptes, rotation, warmup |
| **La Growth Machine** | Séquences multi-canal (Email + LinkedIn + Twitter) avec enrichissement auto |
| **Waalaxy** | Automatisation LinkedIn + Email depuis extension Chrome |

#### 🕷️ Scraping (2)
| Outil | Rôle dans Bakal |
|-------|----------------|
| **PhantomBuster** | Extraction de listes depuis LinkedIn (Sales Nav, groupes, employés) |
| **Captain Data** | Workflows d'extraction automatisés — LinkedIn, Google Maps, sites web |

#### 📅 Calendrier (2)
| Outil | Rôle dans Bakal |
|-------|----------------|
| **Calendly** | Liens de booking dans les séquences, tracking par campagne |
| **Cal.com** | Alternative open-source à Calendly, auto-hébergeable |

#### 📬 Délivrabilité (2)
| Outil | Rôle dans Bakal |
|-------|----------------|
| **Mailreach** | Warm-up email + monitoring inbox placement |
| **Warmbox** | Warm-up automatisé — emails réalistes entre vraies boîtes |

### Modifications par fichier

**`backend/routes/settings.js`**
- `KEY_MAP` : 22 entrées (lemlistKey → warmboxKey)
- `testKey()` : endpoints de test pour 14 services (8 sans test auto retournent `status: 'saved'`)
- `testBearer()` : helper réutilisable pour auth Bearer

**`app/chat-engine.js`**
- `INTEGRATIONS` : 22 outils avec metadata complète (label, icon, category, regex, desc, benefit, howToGet, url)
- `CATEGORY_INFO` : 7 catégories (core, crm, enrichment, outreach, scraping, calendar, deliverability)
- `detectWhichKey()` : 22 détections par nom + 6 détections par catégorie

**`app/bakal-saas-mockup.html`**
- Dashboard connexions : 9 cartes de statut (Lemlist, Notion, Claude, HubSpot, Dropcontact, Calendly, Instantly, PhantomBuster, Mailreach)
- 7 sections de formulaire : Core, CRM, Enrichissement, Outreach, Scraping, Calendrier, Délivrabilité
- 22 champs input avec statut de connexion

**`app/pages.js`**
- `saveSettings()` : collecte 22 clés API
- `loadSettingsKeys()` : fieldMap à 22 entrées
- `testApiConnections()` : statusMap à 22 entrées
- `localChecks[]` : 22 validations de format offline

**`app/notifications.js`**
- `updateSettingsConnectionStatus()` : statusMap étendu à 9 cartes de dashboard

---

## Fichiers modifiés — Résumé

| Fichier | Lignes ajoutées | Lignes supprimées |
|---------|----------------|-------------------|
| `app/chat-engine.js` | +518 | -1 |
| `app/bakal-saas-mockup.html` | +324 | -93 |
| `backend/routes/settings.js` | +133 | -28 |
| `app/pages.js` | +117 | -30 |
| `app/nav.js` | +70 | -65 |
| `app/notifications.js` | +8 | -3 |
| **Total** | **+987** | **-183** |

---

*Branche : `claude/setup-campaigns-data-P3Aml`*
*Dernière mise à jour : 3 mars 2026*
