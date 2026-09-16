# Bakal : Systeme de Refinement (Boucle d'Auto-Optimisation)

> **Version :** 1.0
> **Sources :** `backend/api/prompts.js`, `backend/routes/ai.js`, `backend/api/dry-run.js`
> **Derniere mise a jour :** Mars 2026

---

## Table des matieres

1. [Vue d'ensemble](#vue-densemble)
2. [La boucle de refinement](#la-boucle-de-refinement)
3. [Prompt d'analyse de performance](#prompt-danalyse-de-performance)
4. [Prompt de regeneration](#prompt-de-regeneration)
5. [Prompt de consolidation memoire](#prompt-de-consolidation-memoire)
6. [Integration N8N (3 workflows)](#integration-n8n)
7. [Endpoints API](#endpoints-api)
8. [Systeme de dry-run](#systeme-de-dry-run)
9. [Bases de donnees Notion](#bases-de-donnees-notion)

---

## Vue d'ensemble

Le systeme de refinement Bakal automatise l'optimisation continue des campagnes de prospection. Il fonctionne comme une boucle fermee :

1. **Collecter** les stats de performance depuis Lemlist
2. **Analyser** les resultats par touchpoint avec des benchmarks
3. **Regenerer** les messages sous-performants avec des variantes A/B
4. **Deployer** les nouvelles versions dans Lemlist
5. **Memoriser** les patterns qui fonctionnent a travers les campagnes

Chaque etape est portee par un prompt Claude specialise et orchestree par des workflows N8N.

---

## La boucle de refinement

```
┌──────────┐     ┌──────────┐     ┌──────────────┐     ┌──────────┐
│  LEMLIST  │────▶│   N8N    │────▶│    CLAUDE     │────▶│   N8N    │
│  (stats)  │     │(collecte)│     │  (analyse)    │     │(deploie) │
└──────────┘     └──────────┘     └──────┬───────┘     └────┬─────┘
                                         │                    │
                                         ▼                    ▼
                                  ┌──────────────┐     ┌──────────┐
                                  │    CLAUDE     │     │  LEMLIST  │
                                  │ (regenere)   │     │ (A/B test)│
                                  └──────────────┘     └──────────┘
                                         │
                                         ▼
                                  ┌──────────────┐
                                  │   NOTION     │
                                  │  (memoire)   │
                                  └──────────────┘
```

### Flux complet (endpoint run-refinement)

L'endpoint `POST /api/ai/run-refinement` execute la boucle complete en un seul appel :

1. Charge la campagne et ses touchpoints depuis la base de donnees
2. Charge la memoire cross-campagne (patterns existants)
3. Execute l'analyse de performance
4. Extrait les priorites et les steps a regenerer
5. Execute la regeneration si des steps le necessitent
6. Sauvegarde le diagnostic en base
7. Sauvegarde la nouvelle version en base
8. Synchronise avec Notion (diagnostic + version)
9. Met a jour le statut de la campagne a `optimizing`

---

## Prompt d'analyse de performance

**Fonction :** `analysisPrompt(campaignData)`
**Endpoint :** `POST /api/ai/analyze`
**Objectif :** Diagnostiquer les performances d'une campagne et identifier les touchpoints a optimiser.

### Parametres d'entree

| Parametre | Type | Description |
|-----------|------|-------------|
| `campaignData.name` | string | Nom de la campagne |
| `campaignData.sector` | string | Secteur cible |
| `campaignData.position` | string | Poste du decideur cible |
| `campaignData.channel` | string | Canal (email/linkedin/multi) |
| `campaignData.stats.nbProspects` | number | Nombre de prospects dans la campagne |
| `campaignData.stats.daysRunning` | number | Nombre de jours depuis le lancement |
| `campaignData.stats.openRate` | number | Taux d'ouverture moyen (%) |
| `campaignData.stats.replyRate` | number | Taux de reponse moyen (%) |
| `campaignData.stats.acceptRateLk` | number | Taux d'acceptation LinkedIn (%) |
| `campaignData.stats.replyRateLk` | number | Taux de reponse LinkedIn (%) |
| `campaignData.stats.interested` | number | Nombre de prospects interesses |
| `campaignData.stats.meetings` | number | Nombre de RDV obtenus |
| `campaignData.sequence` | array | Touchpoints avec stats individuelles |

Chaque touchpoint dans `sequence` peut contenir :

| Champ | Type | Description |
|-------|------|-------------|
| `step` | string | Identifiant (E1, E2, L1, etc.) |
| `open_rate` | number | Taux d'ouverture (%) |
| `reply_rate` | number | Taux de reponse (%) |
| `stop_rate` | number | Taux de desinscription (%) |
| `accept_rate` | number | Taux d'acceptation LinkedIn (%) |

### Benchmarks de reference

| Metrique | Bon | Moyen | Probleme |
|----------|-----|-------|----------|
| Ouverture email | >50% | 30-50% | <30% |
| Reponse email | >5% | 2-5% | <2% |
| Acceptation LinkedIn | >30% | 15-30% | <15% |
| Reponse LinkedIn | >10% | 5-10% | <5% |

### Format de sortie JSON

```json
{
  "summary": "Resume global en 2-3 phrases",
  "overallScore": "bon|moyen|probleme",
  "touchpointAnalysis": [
    {
      "step": "E1",
      "score": "bon|moyen|probleme",
      "diagnosis": "Ce qui va / ce qui ne va pas",
      "rootCause": "Cause probable du probleme",
      "action": "regenerate|keep|monitor",
      "priority": 1
    }
  ],
  "priorities": [
    {
      "step": "E3",
      "priority": 1,
      "issue": "Description du probleme",
      "recommendation": "Action recommandee",
      "expectedImpact": "+X pts estimes"
    }
  ],
  "regenerationInstructions": {
    "stepsToRegenerate": ["E3", "E4"],
    "globalDirection": "Direction generale pour la regeneration",
    "perStep": {
      "E3": "Instructions specifiques pour E3",
      "E4": "Instructions specifiques pour E4"
    }
  }
}
```

### Actions par touchpoint

| Action | Signification |
|--------|---------------|
| `regenerate` | Le touchpoint sous-performe et doit etre reecrit |
| `keep` | Le touchpoint performe bien, ne pas toucher |
| `monitor` | Performance intermediaire, surveiller avant d'agir |

### Traitement cote serveur

Apres reception du diagnostic :
1. Les priorites sont extraites (steps a optimiser)
2. Le diagnostic est sauvegarde dans `db.diagnostics`
3. Une synchronisation Notion est declenchee en arriere-plan
4. Si les priorites ne sont pas parsables en JSON, un fallback `extractPriorities()` scanne le texte pour trouver des references a E1-E4, L1-L2

---

## Prompt de regeneration

**Fonction :** `regenerationPrompt(params)`
**Endpoint :** `POST /api/ai/regenerate`
**Objectif :** Regenerer les messages sous-performants en tenant compte du diagnostic, des originaux et de la memoire cross-campagne.

### Parametres d'entree

| Parametre | Type | Description |
|-----------|------|-------------|
| `diagnostic` | string/object | Diagnostic de performance (sortie de l'analyse) |
| `originalMessages` | array | Messages originaux de la campagne |
| `memory` | array | Patterns de la memoire cross-campagne |
| `clientParams` | object | Parametres du client (tone, formality, length, sector) |
| `regenerationInstructions` | object | Instructions du diagnostic (steps, direction, per-step) |

#### Structure de `memory`

Chaque pattern de memoire contient :

```json
{
  "confidence": "Haute|Moyenne|Faible",
  "category": "Objets|Corps|Timing|LinkedIn|Secteur|Cible",
  "pattern": "Description du pattern",
  "data": "Donnees detaillees"
}
```

#### Structure de `regenerationInstructions`

```json
{
  "stepsToRegenerate": ["E3", "L2"],
  "globalDirection": "Remplacer les angles anxiogenes par des angles positifs",
  "perStep": {
    "E3": "Changer l'angle de 'cout erreur' a 'gain de temps'",
    "L2": "Ajouter une question directe sur le probleme du prospect"
  }
}
```

### Regles imperatives

1. Preserver les variables Lemlist : `{{firstName}}`, `{{lastName}}`, `{{companyName}}`, `{{jobTitle}}`
2. Ne JAMAIS mentionner "IA", "automatise", "robot"
3. Notes de connexion LinkedIn : max 300 caracteres
4. Emails de break-up : 3-4 lignes max, jamais culpabilisant
5. Generer TOUJOURS une variante A et B pour chaque message modifie
6. Chaque variante doit avoir une HYPOTHESE CLAIRE et TESTABLE
7. Integrer les patterns de la memoire cross-campagne quand pertinents
8. Si un pattern haute confiance contredit le diagnostic, le signaler

### Format de sortie JSON

```json
{
  "messages": [
    {
      "step": "E3",
      "action": "regenerated|kept|tweaked",
      "variantA": {
        "subject": "Nouvelle ligne d'objet A",
        "body": "Nouveau corps du message A",
        "hypothesis": "Ce qu'on teste avec cette variante"
      },
      "variantB": {
        "subject": "Nouvelle ligne d'objet B",
        "body": "Nouveau corps du message B",
        "hypothesis": "Ce qu'on teste avec cette variante"
      },
      "changes": "Resume des modifications par rapport a l'original",
      "memoryUsed": ["Pattern X utilise parce que..."]
    }
  ],
  "summary": "Resume global des changements",
  "hypotheses": [
    "Hypothese 1 : ...",
    "Hypothese 2 : ..."
  ],
  "expectedImpact": "Impact estime sur les metriques"
}
```

### Actions par message

| Action | Signification |
|--------|---------------|
| `regenerated` | Message completement reecrit |
| `kept` | Message conserve tel quel |
| `tweaked` | Ajustements mineurs (objet, CTA, formulation) |

### Traitement cote serveur

Apres regeneration :
1. Une nouvelle version est creee dans `db.versions` avec le numero incremente
2. Les steps modifies sont enregistres dans `messagesModified`
3. Les hypotheses sont sauvegardees
4. Le resultat est initialise a `testing`
5. Synchronisation Notion en arriere-plan

---

## Prompt de consolidation memoire

**Fonction :** `memoryConsolidationPrompt(diagnostics, existingMemory)`
**Endpoint :** `POST /api/ai/consolidate-memory`
**Objectif :** Agreger les diagnostics mensuels pour extraire des patterns recurrents et actionnables.

### Parametres d'entree

| Parametre | Type | Description |
|-----------|------|-------------|
| `diagnostics` | array | Tous les diagnostics du mois, enrichis avec le nom et secteur de la campagne |
| `existingMemory` | array | Patterns de memoire existants |

### Niveaux de confiance

| Niveau | Critere |
|--------|---------|
| **Haute** | Pattern observe sur >200 prospects OU confirme par 3+ campagnes |
| **Moyenne** | Observe sur 50-200 prospects OU confirme par 2 campagnes |
| **Faible** | Observe sur <50 prospects OU 1 seule campagne |

### Categories de patterns

| Categorie | Ce qu'elle couvre |
|-----------|------------------|
| **Objets** | Lignes d'objet email (formulations, longueur, variables) |
| **Corps** | Contenu des messages (longueur, structure, CTA, angle) |
| **Timing** | Jours/heures d'envoi, espacement entre touchpoints |
| **LinkedIn** | Notes de connexion, messages, taux d'acceptation |
| **Secteur** | Ce qui fonctionne par industrie |
| **Cible** | Ce qui fonctionne par type de decideur (DAF, DRH, Dirigeant) |

### Mission du prompt

1. Analyser tous les diagnostics du mois
2. Identifier les patterns recurrents (positifs ET negatifs)
3. Comparer avec la memoire existante : confirmer, ajuster la confiance, ou ajouter
4. Signaler les contradictions entre patterns existants et nouvelles donnees

### Format de sortie JSON

```json
{
  "patterns": [
    {
      "categorie": "Objets",
      "pattern": "Description courte du pattern",
      "donnees": "Explication detaillee avec donnees chiffrees",
      "confiance": "Haute|Moyenne|Faible",
      "secteurs": ["Secteur1"],
      "cibles": ["Cible1"],
      "isNew": true,
      "confirmsExisting": null
    }
  ],
  "updatedPatterns": [
    {
      "existingId": 123,
      "newConfidence": "Haute",
      "reason": "Confirme par 2 nouvelles campagnes"
    }
  ],
  "contradictions": [
    {
      "existingPattern": "Description",
      "newEvidence": "Ce qui contredit",
      "recommendation": "Garder | Modifier | Supprimer"
    }
  ],
  "summary": "Resume des decouvertes du mois"
}
```

### Traitement cote serveur

Apres consolidation :
1. Les nouveaux patterns sont sauvegardes dans `db.memoryPatterns`
2. Chaque pattern est synchronise avec Notion
3. Les patterns existants voient leur confiance mise a jour si `updatedPatterns` le demande
4. Les contradictions sont renvoyees dans la reponse pour examen humain

---

## Integration N8N

Trois workflows N8N orchestrent la boucle de refinement.

### Workflow 1 : Collecte de stats (quotidien a 8h)

```
Declencheur : Cron job @ 08:00
     │
     ▼
Lemlist API : GET /campaigns
     │
     ▼
Pour chaque campagne active :
  ├── GET /campaigns/{id}/export (stats)
  ├── Calcul metriques par touchpoint
  ├── Sauvegarde dans Notion "Campagnes : Resultats"
  └── Si nb_prospects > 50 ET age > 7 jours :
        └── Declenchement Workflow 2
```

**Conditions de declenchement de l'analyse :**
- La campagne a plus de 50 prospects
- La campagne tourne depuis plus de 7 jours

### Workflow 2 : Regeneration + Deploiement

```
Declencheur : Workflow 1 (quand optimisation necessaire)
     │
     ▼
Notion : Lecture messages originaux + memoire
     │
     ▼
API Bakal : POST /api/ai/analyze
     │
     ▼
API Bakal : POST /api/ai/regenerate
     │
     ▼
Lemlist API : PATCH /campaigns/{id}/sequences
  (deploiement des variantes A/B)
     │
     ▼
Notion : Sauvegarde diagnostic + version
```

### Workflow 3 : Consolidation memoire (mensuel)

```
Declencheur : Cron job @ 1er du mois
     │
     ▼
API Bakal : POST /api/ai/consolidate-memory
  (agrege tous les diagnostics + memoire existante)
     │
     ▼
Notion : Mise a jour "Memoire Cross-Campagne"
```

---

## Endpoints API

### POST /api/ai/analyze

Analyse les performances d'une campagne.

**Request :**
```json
{
  "campaignId": 123
}
```

**Query params :** `?dry_run=true` pour le mode simulation

**Response :**
```json
{
  "id": 1,
  "diagnostic": "## Resume\nTexte du diagnostic...",
  "parsed": { "summary": "...", "overallScore": "...", "touchpointAnalysis": [...], "priorities": [...], "regenerationInstructions": {...} },
  "priorities": ["E3", "L2"],
  "usage": { "input_tokens": 1200, "output_tokens": 800 },
  "dryRun": false
}
```

---

### POST /api/ai/regenerate

Regenere les messages sous-performants.

**Request :**
```json
{
  "campaignId": 123,
  "diagnostic": "Texte ou objet du diagnostic",
  "originalMessages": [
    { "step": "E3", "subject": "...", "body": "..." }
  ],
  "clientParams": {
    "tone": "Pro decontracte",
    "formality": "Vous",
    "length": "Standard",
    "sector": "Finance"
  },
  "regenerationInstructions": {
    "stepsToRegenerate": ["E3"],
    "globalDirection": "Changer l'angle vers gain de temps",
    "perStep": { "E3": "Remplacer angle cout par angle gain" }
  }
}
```

**Response :**
```json
{
  "messages": [
    {
      "step": "E3",
      "action": "regenerated",
      "variantA": { "subject": "...", "body": "...", "hypothesis": "..." },
      "variantB": { "subject": "...", "body": "...", "hypothesis": "..." },
      "changes": "...",
      "memoryUsed": []
    }
  ],
  "summary": "Resume des changements",
  "hypotheses": ["..."],
  "expectedImpact": "+2-3 pts reponse",
  "usage": { "input_tokens": 1500, "output_tokens": 1000 },
  "dryRun": false
}
```

---

### POST /api/ai/run-refinement

Execute la boucle complete (analyse + regeneration) en un seul appel.

**Request :**
```json
{
  "campaignId": 123
}
```

**Response :**
```json
{
  "diagnosticId": 1,
  "versionId": 2,
  "analysis": {
    "summary": "Resume du diagnostic",
    "priorities": [
      { "step": "E3", "priority": 1, "issue": "...", "recommendation": "...", "expectedImpact": "..." }
    ],
    "overallScore": "moyen"
  },
  "regeneration": {
    "messages": [...],
    "summary": "Resume des changements",
    "hypotheses": ["..."],
    "expectedImpact": "..."
  },
  "stepsRegenerated": ["E3"],
  "totalUsage": { "input_tokens": 2700, "output_tokens": 1800 },
  "dryRun": false
}
```

**Effets de bord :**
- Cree un diagnostic en base
- Cree une version en base (si regeneration)
- Synchronise diagnostic et version avec Notion
- Met a jour le statut de la campagne a `optimizing`

---

### POST /api/ai/consolidate-memory

Consolide les diagnostics mensuels en patterns.

**Request :** aucun body requis (charge tout depuis la base)

**Response :**
```json
{
  "patternsCreated": 2,
  "patternsUpdated": 1,
  "contradictions": [
    { "existingPattern": "...", "newEvidence": "...", "recommendation": "..." }
  ],
  "summary": "Resume des decouvertes du mois",
  "usage": { "input_tokens": 3000, "output_tokens": 1200 },
  "dryRun": false
}
```

**Effets de bord :**
- Cree de nouveaux patterns dans `db.memoryPatterns`
- Met a jour la confiance des patterns existants
- Synchronise chaque nouveau pattern avec Notion

---

### GET /api/ai/memory

Liste tous les patterns de memoire cross-campagne.

**Response :**
```json
{
  "patterns": [...],
  "count": 15
}
```

---

### GET /api/ai/diagnostics/:campaignId

Liste les diagnostics d'une campagne.

**Response :**
```json
{
  "diagnostics": [...]
}
```

---

### GET /api/ai/versions/:campaignId

Liste les versions d'une campagne.

**Response :**
```json
{
  "versions": [...]
}
```

---

## Systeme de dry-run

**Fichier :** `backend/api/dry-run.js`

Le systeme de dry-run permet de tester l'ensemble du pipeline sans appeler l'API Claude. Il retourne des donnees simulees realistes qui traversent toute la chaine (parsing JSON, sauvegarde en base, synchronisation Notion).

### Activation

Ajouter `?dry_run=true` ou `?dry_run=1` a n'importe quel endpoint AI.

```
POST /api/ai/generate-sequence?dry_run=true
POST /api/ai/analyze?dry_run=true
POST /api/ai/regenerate?dry_run=true
POST /api/ai/run-refinement?dry_run=true
POST /api/ai/generate-variables?dry_run=true
POST /api/ai/consolidate-memory?dry_run=true
```

### Comportement

| Aspect | Dry-run | Production |
|--------|---------|------------|
| Appel Claude API | Non | Oui |
| Tokens consommes | 0 | Variables |
| Sauvegarde en base | Oui | Oui |
| Synchronisation Notion | Oui | Oui |
| Donnees retournees | Simulees mais realistes | Generees par Claude |
| Champ `dryRun` en reponse | `true` | `false` |

### Fonctions disponibles

| Fonction | Description |
|----------|-------------|
| `generateSequence(params)` | Sequence complete avec 4 emails + 2 LinkedIn, adaptee au canal demande |
| `generateTouchpoint(type, params)` | Touchpoint individuel pour chacun des 7 types |
| `analyzeCampaign(campaignData)` | Diagnostic avec touchpointAnalysis, priorities, regenerationInstructions |
| `regenerateSequence(params)` | Regeneration de E3 avec 2 variantes A/B |
| `consolidateMemory(diagnostics, existingMemory)` | 2 patterns faible confiance |
| `generateVariables(params)` | Chaine de 3 variables (base > enrichie > icebreaker) |
| `runRefinementLoop(campaignData, originalMessages, memory)` | Boucle complete (analyse + regeneration) |

### Exemple de test

```bash
# Tester la boucle complete sans consommer de tokens
curl -X POST http://localhost:3000/api/ai/run-refinement?dry_run=true \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN" \
  -d '{"campaignId": 1}'
```

### Usage recommande

- **Developpement :** Utiliser systematiquement pour tester les workflows
- **Tests d'integration :** Valider que le pipeline complet fonctionne (base + Notion)
- **Demo client :** Montrer le fonctionnement sans cout API
- **Debug :** Isoler un probleme entre le pipeline et l'API Claude

---

## Bases de donnees Notion

Les donnees du systeme de refinement sont synchronisees avec 4 bases Notion.

### Base 1 : Campagnes : Resultats

Stocke les metriques collectees par le Workflow 1.

| Propriete | Type |
|-----------|------|
| Nom campagne | Title |
| Client | Relation |
| Date collecte | Date |
| Statut | Select (Active / Terminee / En optimisation) |
| Nb prospects | Number |
| Open rate E1-E4 | Number |
| Reply rate E1-E4 | Number |
| Accept rate LK | Number |
| Reply rate LK | Number |

### Base 2 : Campagnes : Diagnostics

Stocke les diagnostics generes par le prompt d'analyse.

| Propriete | Type |
|-----------|------|
| Campagne | Relation |
| Date analyse | Date |
| Diagnostic | Rich text |
| Priorites | Multi-select |
| Nb messages a optimiser | Number |

### Base 3 : Campagnes : Historique Versions

Trace chaque iteration de regeneration.

| Propriete | Type |
|-----------|------|
| Campagne | Relation |
| Version | Number |
| Date | Date |
| Messages modifies | Multi-select |
| Hypotheses testees | Text |
| Resultat | Select (En cours / Ameliore / Degrade / Neutre) |

### Base 4 : Memoire Cross-Campagne

Stocke les patterns identifies par la consolidation mensuelle.

| Propriete | Type |
|-----------|------|
| Categorie | Select (Objets / Corps / Timing / LinkedIn / Secteur / Cible) |
| Pattern | Title |
| Donnees | Text |
| Confiance | Select (Haute / Moyenne / Faible) |
| Date decouverte | Date |
| Secteur | Multi-select |
| Cible | Multi-select |

---

## Phases d'implementation

| Phase | Periode | Refinement |
|-------|---------|------------|
| **Phase 1 : Manuel** | Actuelle | Prompts executes manuellement, stats copiees depuis Lemlist, recommandations appliquees a la main |
| **Phase 2 : Semi-auto** | Mois 2-3 | N8N automatise la collecte stats + analyse, un humain valide avant deploiement |
| **Phase 3 : Full auto** | Mois 4-5 | Boucle complete automatisee, supervision humaine pour les cas limites |

**Statut actuel :** Phase 1 : documentation et code en place, pret pour l'implementation des workflows N8N.
