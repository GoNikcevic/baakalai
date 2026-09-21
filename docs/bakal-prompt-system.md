# Bakal : Systeme de Prompts pour la Generation de Copy

> **Version :** 1.0
> **Source :** `backend/api/prompts.js`
> **Derniere mise a jour :** Mars 2026

---

## Table des matieres

1. [Vue d'ensemble](#vue-densemble)
2. [Architecture 1 Master + 7 Sub-Prompts](#architecture)
3. [Master Prompt](#master-prompt)
4. [Sub-Prompts specialises](#sub-prompts-specialises)
   - [Email Initial (E1)](#email-initial-e1)
   - [Email Valeur (E2)](#email-valeur-e2)
   - [Email Relance (E3)](#email-relance-e3)
   - [Email Break-up (E4)](#email-break-up-e4)
   - [Note de connexion LinkedIn (L1)](#note-de-connexion-linkedin-l1)
   - [Message LinkedIn post-connexion (L2)](#message-linkedin-post-connexion-l2)
   - [Lignes d'objet (Subject Lines)](#lignes-dobjet-subject-lines)
5. [Variable Generator Prompt](#variable-generator-prompt)
6. [Icebreaker Execution Prompt](#icebreaker-execution-prompt)
7. [Variables Lemlist](#variables-lemlist)
8. [Regles imperatives globales](#regles-imperatives-globales)

---

## Vue d'ensemble

Le systeme de prompts Bakal genere des sequences de prospection B2B multicanal (Email + LinkedIn) personnalisees et pretes a deployer dans Lemlist. Il repose sur une architecture modulaire :

- **1 Master Prompt** : genere une sequence complete (tous les touchpoints d'un coup)
- **7 Sub-Prompts** : generent un touchpoint individuel avec des instructions specialisees
- **1 Variable Generator Prompt** : cree des chaines de variables personnalisees par secteur
- **1 Icebreaker Execution Prompt** : genere un icebreaker par prospect a partir des variables

Le Master Prompt est utilise via `POST /api/ai/generate-sequence`, tandis que les Sub-Prompts sont appeles individuellement via `POST /api/ai/generate-touchpoint`.

---

## Architecture

```
                    ┌──────────────────────┐
                    │    MASTER PROMPT      │
                    │  (sequence complete)  │
                    └──────────┬───────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                     │
    ┌─────▼─────┐      ┌──────▼──────┐      ┌──────▼──────┐
    │   EMAIL    │      │  LINKEDIN   │      │   SUBJECT   │
    │ E1-E2-E3-E4│      │   L1 + L2   │      │   LINES     │
    └───────────┘      └─────────────┘      └─────────────┘

    ┌──────────────────────────────────────────────────────┐
    │              SUB-PROMPTS (individuels)                │
    ├──────────┬──────────┬──────────┬─────────────────────┤
    │emailInit │emailVal  │emailRel  │emailBreakup         │
    │linkedinCo│linkedinMs│subjectLn │                     │
    └──────────┴──────────┴──────────┴─────────────────────┘

    ┌──────────────────────────────────────────────────────┐
    │            VARIABLE GENERATOR + ICEBREAKER            │
    ├──────────────────────┬───────────────────────────────┤
    │variableGeneratorPrompt│icebreakerExecutionPrompt     │
    └──────────────────────┴───────────────────────────────┘
```

---

## Master Prompt

**Fonction :** `masterPrompt(params)`
**Endpoint :** `POST /api/ai/generate-sequence`
**Objectif :** Generer une sequence de prospection complete avec tous les touchpoints en un seul appel.

### Parametres d'entree

| Parametre | Type | Default | Description |
|-----------|------|---------|-------------|
| `companyName` | string | `''` | Nom de l'entreprise du client (prestataire) |
| `sector` | string | `''` | Secteur d'activite de la cible |
| `position` | string | `''` | Poste du decideur cible (ex: DAF, DRH, CEO) |
| `size` | string | `''` | Taille de l'entreprise cible |
| `channel` | string | `'email'` | Canal : `email`, `linkedin`, ou `multi` |
| `angle` | string | `'Douleur client'` | Angle d'approche de la campagne |
| `tone` | string | `'Pro decontracte'` | Ton de la copy |
| `formality` | string | `'Vous'` | `'Vous'` (vouvoiement) ou `'Tu'` (tutoiement) |
| `length` | string | `'Standard'` | Longueur : `Court`, `Standard`, `Long` |
| `cta` | string | `'Question ouverte'` | Type de call-to-action |
| `valueProp` | string | `''` | Proposition de valeur du client |
| `painPoints` | string | `''` | Douleurs cibles identifiees |
| `socialProof` | string | `''` | Preuves sociales (case studies, chiffres) |
| `touchpointCount` | number | `4` | Nombre de touchpoints (4 a 8) |
| `personalizationLevel` | string | `'Standard'` | Niveau de personnalisation |
| `zone` | string | `''` | Zone geographique (default: France) |
| `language` | string | `'fr'` | Langue : `fr` ou `en` |
| `avoidWords` | string | `''` | Mots/expressions a eviter |
| `signaturePhrases` | string | `''` | Expressions "maison" a privilegier |
| `objections` | string | `''` | Objections frequentes a anticiper |
| `documentContext` | string | `''` | Contexte extrait de documents uploades (tronque a 4000 chars) |

> **Note :** Les parametres manquants sont enrichis automatiquement par le profil utilisateur via `enrichWithProfile()` dans le routeur. Les documents uploades sont aussi injectes comme contexte.

### Instructions par canal

| Canal | Instruction |
|-------|-------------|
| `email` | Sequence EMAIL uniquement avec N touchpoints (E1 a EN) |
| `linkedin` | Sequence LINKEDIN : L1 (note connexion, max 300 chars) + L2 (message post-connexion) |
| `multi` | Sequence MULTI-CANAL combinant email et LinkedIn. Structure recommandee : E1 > L1 > E2 > L2 > E3 > E4 |

### Longueur par type de touchpoint

| Touchpoint | Court | Standard | Long |
|------------|-------|----------|------|
| Email Initial (E1) | 3-4 phrases | 4-6 phrases | 6-8 phrases |
| Email Valeur (E2) | 4-5 phrases | 5-7 phrases | 7-9 phrases |
| Email Relance (E3) | 3-4 phrases | 4-5 phrases | 5-7 phrases |
| Email Break-up (E4) | 3-4 phrases | 3-4 phrases | 3-4 phrases (toujours) |
| LinkedIn L1 | Max 300 caracteres (toujours) |
| LinkedIn L2 | 3-5 phrases |

### Format de sortie JSON

```json
{
  "sequence": [
    {
      "step": "E1",
      "type": "email",
      "label": "Email initial",
      "timing": "J+0",
      "subType": "Description courte de l'angle",
      "subject": "Ligne d'objet variante A",
      "subjectB": "Ligne d'objet variante B",
      "body": "Corps du message avec {{variables}}",
      "bodyB": "Variante B du corps (optionnel)"
    }
  ],
  "strategy": "Explication en 2-3 phrases de la strategie globale",
  "hypotheses": [
    "Hypothese 1 : ...",
    "Hypothese 2 : ..."
  ]
}
```

### Regles specifiques aux lignes d'objet

- **Variante A** : directe, orientee benefice
- **Variante B** : curiosite ou question
- Max 50 caracteres par objet
- Inclure `{{firstName}}` ou `{{companyName}}` dans au moins 1 objet sur 2
- Pas de mots spam : "gratuit", "offre", "urgent", "derniere chance"
- Pas de MAJUSCULES abusives ni de ponctuation excessive

---

## Sub-Prompts specialises

Les sub-prompts sont accessibles via `POST /api/ai/generate-touchpoint` avec le parametre `type`. Chacun genere un seul touchpoint avec des instructions plus detaillees que le Master Prompt.

### Types valides

```
emailInitial | emailValue | emailRelance | emailBreakup
linkedinConnection | linkedinMessage | subjectLines
```

---

### Email Initial (E1)

**Type :** `emailInitial`
**Objectif :** Capter l'attention des la premiere phrase. Le prospect doit sentir que le message est ecrit POUR LUI.

**Parametres specifiques :**

| Parametre | Utilise dans le prompt |
|-----------|----------------------|
| `position` | Contexte cible |
| `sector` | Contexte sectoriel |
| `size` | Taille entreprise |
| `angle` | Angle d'approche (default: Douleur client) |
| `tone` | Ton (default: Pro decontracte) |
| `formality` | Vous/Tu |
| `valueProp` | Proposition de valeur |
| `painPoints` | Douleurs cibles |
| `cta` | Type de CTA (default: Question ouverte) |
| `length` | Court: 3-4 phrases, Standard/Long: 4-6 phrases |

**Structure du message :**
1. Hook personnalise (1 phrase montrant qu'on connait le contexte)
2. Probleme identifie (1-2 phrases)
3. CTA leger

**Format de sortie :**
```json
{
  "subject": "Objet variante A",
  "subjectB": "Objet variante B",
  "body": "Corps du message",
  "hypothesis": "Ce qu'on teste avec ce message"
}
```

---

### Email Valeur (E2)

**Type :** `emailValue`
**Objectif :** Apporter une preuve CONCRETE que ca marche. Chiffres, cas client, resultat mesurable.

**Parametres specifiques :**

| Parametre | Utilise dans le prompt |
|-----------|----------------------|
| `position` | Contexte cible |
| `sector` | Contexte sectoriel |
| `tone` | Ton |
| `formality` | Vous/Tu |
| `socialProof` | Preuve sociale (si absente, un cas realiste est invente) |
| `length` | Court: 4-5 phrases, Standard/Long: 5-7 phrases |

**Structure du message :**
1. Rappel contextuel (1 phrase, pas "suite a mon dernier email")
2. Case study ou stat (2-3 phrases)
3. Resultat concret (chiffre)
4. CTA : question ouverte liee a leur situation

**Format de sortie :** meme structure que E1.

---

### Email Relance (E3)

**Type :** `emailRelance`
**Objectif :** Relancer SANS repeter. Changer completement d'angle tout en gardant le meme benefice.

**Parametres specifiques :**

| Parametre | Utilise dans le prompt |
|-----------|----------------------|
| `position`, `sector`, `tone`, `formality` | Contexte standard |
| `previousAngle` | Angle utilise dans E1 (pour changer) |
| `length` | Court: 3-4 phrases, Standard/Long: 4-5 phrases |

**Angles alternatifs sugeres :**
- Si E1 etait "douleur" → essayer "gain/opportunite"
- Si E1 etait "stat/chiffre" → essayer "question provocante"
- Si E1 etait "case study" → essayer "tendance du marche"

**Structure du message :**
1. Accroche nouvelle perspective (1 phrase)
2. Question ou stat surprenante (1-2 phrases)
3. Lien avec leur situation (1 phrase)
4. CTA

**Contrainte specifique :** Ne JAMAIS ecrire "Suite a mes precedents emails..."

**Format de sortie :** meme structure que E1.

---

### Email Break-up (E4)

**Type :** `emailBreakup`
**Objectif :** Dernier message. Court, respectueux, pas culpabilisant. Laisser la porte ouverte.

**Parametres specifiques :**

| Parametre | Utilise dans le prompt |
|-----------|----------------------|
| `position`, `sector`, `tone`, `formality` | Contexte standard |

**Regles ABSOLUES :**
- **3-4 phrases MAXIMUM** (meme si "Long" demande ailleurs)
- JAMAIS culpabilisant ("vous n'avez pas repondu...")
- JAMAIS agressif ("derniere chance...")
- Un seul benefice rappele en une phrase
- Porte ouverte sans insistance

**Structure du message :**
1. Signal de depart (1 phrase simple)
2. Benefice rappele (1 phrase)
3. Porte ouverte (1 phrase)

**Variables :** uniquement `{{firstName}}`

**Format de sortie :** meme structure que E1.

---

### Note de connexion LinkedIn (L1)

**Type :** `linkedinConnection`
**Objectif :** Obtenir l'acceptation de la connexion, PAS une reponse.

**Parametres specifiques :**

| Parametre | Utilise dans le prompt |
|-----------|----------------------|
| `position` | Cible |
| `sector` | Secteur |
| `tone` | Ton (default: Pro decontracte) |

**Regles ABSOLUES :**
- **MAX 300 CARACTERES** (contrainte plateforme LinkedIn, non negociable)
- ZERO pitch commercial
- Trouver un point commun professionnel ou complimenter un aspect du parcours
- Donner envie d'ACCEPTER la connexion, pas de repondre

**Structure :**
1. Mention d'un interet commun ou compliment pro (1 phrase)
2. Raison legere de se connecter (1 phrase)

**Variables :** uniquement `{{firstName}}`

**Format de sortie :**
```json
{
  "body": "Note de connexion (max 300 chars)",
  "bodyB": "Variante B",
  "charCount": 123,
  "hypothesis": "Ce qu'on teste"
}
```

---

### Message LinkedIn post-connexion (L2)

**Type :** `linkedinMessage`
**Objectif :** Premier vrai echange apres connexion. Conversationnel, comme un vrai message LinkedIn.

**Parametres specifiques :**

| Parametre | Utilise dans le prompt |
|-----------|----------------------|
| `position`, `sector` | Contexte |
| `tone`, `formality` | Style |
| `valueProp` | Proposition de valeur |

**Regles :**
- PAS un email copie-colle dans LinkedIn
- Conversationnel, court (3-5 phrases max)
- Remercier pour la connexion
- Apporter de la valeur ou poser une question liee au metier
- CTA : question ouverte liee au quotidien professionnel

**Variables :** `{{firstName}}`, `{{companyName}}`

**Format de sortie :**
```json
{
  "body": "Message post-connexion",
  "bodyB": "Variante B",
  "hypothesis": "Ce qu'on teste"
}
```

---

### Lignes d'objet (Subject Lines)

**Type :** `subjectLines`
**Objectif :** Generer 2 variantes A/B de ligne d'objet pour chaque email de la sequence.

**Parametres specifiques :**

| Parametre | Utilise dans le prompt |
|-----------|----------------------|
| `position` | Cible |
| `sector` | Secteur |
| `tone` | Ton |
| `emailCount` | Nombre d'emails (default: 4) |

**Regles :**
- Max 50 caracteres par objet
- Variante A : directe, orientee benefice
- Variante B : curiosite, question, ou pattern interrupt
- Inclure `{{firstName}}` ou `{{companyName}}` dans au moins 50% des objets
- Pas de mots spam, pas de MAJUSCULES abusives, pas de ponctuation excessive

**Format de sortie :**
```json
{
  "subjects": [
    {
      "step": "E1",
      "variantA": "Objet A pour E1",
      "variantB": "Objet B pour E1",
      "hypothesisA": "Pourquoi cette approche",
      "hypothesisB": "Pourquoi cette approche"
    }
  ]
}
```

---

## Variable Generator Prompt

**Fonction :** `variableGeneratorPrompt(params)`
**Endpoint :** `POST /api/ai/generate-variables`
**Objectif :** Proposer une chaine de 2 a 4 variables personnalisees specifiques a l'industrie, allant au-dela des variables Lemlist standard.

### Parametres d'entree

| Parametre | Type | Default | Description |
|-----------|------|---------|-------------|
| `sector` | string | `''` | **Requis.** Secteur cible |
| `position` | string | `''` | Poste du decideur cible |
| `angle` | string | `''` | Angle de campagne |
| `valueProp` | string | `''` | Proposition de valeur |
| `painPoints` | string | `''` | Douleurs identifiees |
| `channels` | string | `'email'` | Canaux utilises |

### Structure de la chaine de variables

La chaine suit une progression en 3 niveaux :

```
Variables de base (collectables)
        │
        ▼
Variables enrichies (deduites par IA)
        │
        ▼
Variable derivee finale (icebreaker)
```

#### 1. Variables de base
- Donnees brutes collectables (site web, rapports, LinkedIn)
- Nom en camelCase descriptif
- Source(s) concrete(s) identifiee(s)
- 3 exemples par variable

#### 2. Variables enrichies
- Deduites par l'IA a partir des variables de base
- Logique de derivation explicitee
- 3 exemples montrant la deduction

#### 3. Variable derivee finale (icebreaker)
- Nom finissant par `Icebreaker`
- Combine les variables precedentes
- Max 2 phrases
- Doit prouver une connaissance du metier

### Format de sortie JSON

```json
{
  "reasoning": "Explication de POURQUOI ces variables sont strategiques...",
  "chain": [
    {
      "key": "variableName",
      "label": "Nom lisible",
      "type": "base",
      "desc": "Description courte",
      "source": {
        "icon": "magnifier|robot|brain",
        "label": "Source de la donnee"
      },
      "dependsOn": [],
      "derivationHint": null,
      "formula": null,
      "examples": [
        { "prospect": "Nom du prospect", "value": "Valeur exemple" }
      ]
    },
    {
      "key": "painEstimate",
      "label": "Estimation de la douleur",
      "type": "enrichment",
      "desc": "Douleur probable deduite",
      "source": { "icon": "robot", "label": "IA" },
      "dependsOn": ["variableName"],
      "derivationHint": "Logique de deduction...",
      "formula": null,
      "examples": [...]
    },
    {
      "key": "sectorIcebreaker",
      "label": "Icebreaker sectoriel",
      "type": "derived",
      "desc": "Accroche finale",
      "source": { "icon": "brain", "label": "IA : combine les variables" },
      "dependsOn": ["variableName", "painEstimate"],
      "derivationHint": null,
      "formula": {
        "inputs": ["variableName", "painEstimate"],
        "prompt": "Instruction de combinaison..."
      },
      "examples": [...]
    }
  ]
}
```

---

## Icebreaker Execution Prompt

**Fonction :** `icebreakerExecutionPrompt(params)`
**Objectif :** Generer un icebreaker personnalise pour un prospect individuel en combinant les variables de la chaine.

### Parametres d'entree

| Parametre | Type | Description |
|-----------|------|-------------|
| `variables` | object | Dictionnaire cle-valeur des variables resolues pour ce prospect |
| `formulaPrompt` | string | Instruction de combinaison (issue du Variable Generator) |
| `tone` | string | Ton (default: Pro decontracte) |
| `formality` | string | Vous/Tu |

### Contraintes

- Maximum 2 phrases
- Doit montrer une connaissance du METIER, pas juste du prospect
- Ne pas mentionner l'IA, l'automatisation, ou que l'info a ete "recherchee"
- Doit se lire comme une remarque naturelle d'un expert du secteur

### Sortie

Le prompt retourne uniquement le texte de l'icebreaker (pas de JSON).

### Exemple d'utilisation

```javascript
const icebreaker = await claude.call(icebreakerExecutionPrompt({
  variables: {
    firstName: "Marie",
    companyName: "TechCorp",
    industryMetric: "120 employes, 30 clients actifs",
    painEstimate: "Coordination inter-equipes couteuse"
  },
  formulaPrompt: "Combine la metrique et la douleur en 2 phrases.",
  tone: "Pro decontracte",
  formality: "Vous"
}));
// -> "A 120 personnes avec 30 clients actifs, la coordination
//     doit etre un sacre defi. Comment gerez-vous ca chez TechCorp ?"
```

---

## Variables Lemlist

Les variables suivantes sont preservees telles quelles dans toute copy generee. Elles sont remplacees dynamiquement par Lemlist lors de l'envoi.

| Variable | Description |
|----------|-------------|
| `{{firstName}}` | Prenom du prospect |
| `{{lastName}}` | Nom de famille du prospect |
| `{{companyName}}` | Nom de l'entreprise du prospect |
| `{{jobTitle}}` | Intitule de poste du prospect |

**Regles d'utilisation dans les prompts :**
- Toujours les ecrire avec les doubles accolades exactes
- `{{firstName}}` ou `{{companyName}}` dans au moins 1 objet email sur 2
- L1 (LinkedIn) : uniquement `{{firstName}}`
- E4 (Break-up) : uniquement `{{firstName}}`
- Les sub-prompts specifient quelles variables sont autorisees pour chaque touchpoint

---

## Regles imperatives globales

Ces regles s'appliquent a TOUS les prompts sans exception :

1. **Variables Lemlist** : utiliser UNIQUEMENT `{{firstName}}`, `{{lastName}}`, `{{companyName}}`, `{{jobTitle}}`
2. **Ne JAMAIS mentionner** : "IA", "automatise", "robot", "logiciel d'envoi"
3. **Ne JAMAIS utiliser** de jargon marketing inaccessible au prospect
4. **Chaque email** doit avoir une ligne d'objet unique et accrocheuse (max 50 chars)
5. **Le ton** doit etre coherent sur toute la sequence
6. **La sequence** doit raconter une histoire progressive, pas des messages isoles
7. **Les objets** : pas de majuscules abusives, pas de ponctuation excessive
8. **LinkedIn L1** : max 300 caracteres absolus, zero pitch commercial
9. **Break-up E4** : 3-4 lignes max, jamais culpabilisant
10. **Sortie** : toujours en JSON structure selon le format specifie

---

## Enrichissement automatique des parametres

Lors de l'appel aux endpoints, le routeur `ai.js` enrichit automatiquement les parametres avec :

1. **Profil utilisateur** (`enrichWithProfile`) : remplit les champs manquants a partir du profil (company, sector, value_prop, pain_points, social_proof, tone, formality, zone, persona, size, avoid_words, signature_phrases, objections)
2. **Documents uploades** : le texte parse des documents de l'utilisateur est injecte comme `documentContext` (tronque a 6000 chars, chaque document a 1500 chars max)

Cela permet aux utilisateurs de ne renseigner que les parametres specifiques a chaque campagne tout en maintenant une coherence globale.
