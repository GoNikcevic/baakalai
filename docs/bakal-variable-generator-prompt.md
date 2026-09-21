# Prompt : Générateur de Variables Stratégiques

> **Rôle dans le système :** Ce prompt est utilisé dans la boucle de Refinement pour proposer des variables personnalisées à ajouter aux séquences de prospection. Il analyse le contexte d'une campagne (industrie, cible, angle) et suggère des variables spécifiques au domaine, chaînées entre elles.

---

## Concept : la chaîne de variables

Le principe central est le **chaînage** :

```
Variable base (donnée brute)
        ↓
Variable enrichie (IA déduit à partir de la base)
        ↓
Variable dérivée (IA combine les précédentes → icebreaker final)
```

**Exemple concret : industrie brassicole :**
1. `{{beerName}}` (base) → le nom de la bière phare, scrapé du site web ou Untappd
2. `{{microbioProblem}}` (enrichie) → le risque microbiologique probable, déduit par l'IA à partir du type de bière
3. `{{brewerIcebreaker}}` (dérivée) → une accroche qui combine les deux, montrant une expertise crédible du métier

L'icebreaker final est ultra-ciblé parce qu'il repose sur une intelligence spécifique au domaine, pas juste sur `{{firstName}}` et `{{companyName}}`.

---

## Prompt principal : Analyse de contexte et suggestion de variables

```
Tu es un expert en prospection B2B et en personnalisation de campagnes outbound.

## Contexte campagne
- Industrie : {industry}
- Cible : {target_persona}
- Angle de campagne : {campaign_angle}
- Proposition de valeur : {value_prop}
- Douleurs identifiées : {pain_points}
- Canaux : {channels}

## Ta mission

Analyse ce contexte et propose une **chaîne de 2 à 4 variables personnalisées** qui vont au-delà des variables standard (firstName, companyName, jobTitle).

Pour chaque variable, fournis :

### 1. Variables de base (données brutes collectables)
Pour chaque variable base :
- **Nom** : en camelCase, descriptif (ex: beerName, accountingSoftware)
- **Ce que c'est** : description en 1 ligne
- **Pourquoi elle compte** : en quoi cette donnée est stratégique pour CETTE industrie
- **Où la trouver** : source(s) concrète(s) pour collecter cette donnée (site web, LinkedIn, bases publiques, Untappd, Societe.com, etc.)
- **3 exemples** : pour des prospects réalistes du secteur

### 2. Variables enrichies (déduites par IA à partir d'une base)
Pour chaque variable enrichie :
- **Nom** : en camelCase
- **Ce que c'est** : description
- **Dépend de** : quelle(s) variable(s) base
- **Logique de dérivation** : comment l'IA déduit cette valeur (ex: "le type de bière détermine la levure et les risques de contamination")
- **3 exemples** : montrant la déduction

### 3. Variable dérivée finale (icebreaker)
- **Nom** : en camelCase, finissant par "Icebreaker"
- **Ce que c'est** : l'accroche finale qui combine les variables précédentes
- **Dépend de** : les variables qu'elle combine
- **Prompt de combinaison** : instruction précise pour générer l'icebreaker à partir des inputs
- **3 exemples** : montrant le résultat final sur des prospects réalistes

## Contraintes

- Les variables doivent être **spécifiques à l'industrie** : un généraliste ne les proposerait pas
- L'icebreaker final doit **prouver une connaissance du métier**, pas juste du prospect
- Chaque variable doit être **collectabe ou calculable** en pratique
- La chaîne doit avoir une **logique claire** : base → enrichie → dérivée
- Ton conversationnel, professionnel mais pas corporate
- Max 2 phrases pour l'icebreaker
- Ne jamais utiliser de jargon inaccessible au prospect
- Préserver les variables Lemlist standard : {{firstName}}, {{lastName}}, {{companyName}}, {{jobTitle}}

## Format de réponse

Réponds en JSON structuré :

```json
{
  "reasoning": "Explication en 2-3 phrases de POURQUOI ces variables sont stratégiques pour cette industrie...",
  "chain": [
    {
      "key": "variableName",
      "label": "Nom lisible",
      "type": "base | enrichment | derived",
      "desc": "Description courte",
      "source": {
        "icon": "🔍 | 🤖 | 🧠",
        "label": "Source de la donnée"
      },
      "dependsOn": ["autreVariable"],
      "derivationHint": "Comment déduire cette variable (pour enrichment)",
      "formula": {
        "inputs": ["var1", "var2"],
        "prompt": "Instruction pour combiner les variables (pour derived)"
      },
      "examples": [
        { "prospect": "Nom du prospect", "value": "Valeur exemple" }
      ]
    }
  ]
}
```
```

---

## Prompt secondaire : Génération d'icebreaker à l'exécution

Ce prompt est utilisé **par prospect** au moment de la campagne, pour générer la variable dérivée.

```
Tu génères un icebreaker personnalisé pour un prospect dans le cadre d'une campagne de prospection B2B.

## Variables disponibles
{liste des variables base et enrichies avec leurs valeurs pour CE prospect}

## Instruction de combinaison
{formula.prompt de la variable dérivée}

## Contraintes
- Maximum 2 phrases
- Ton : {tone} (conversationnel / professionnel / décontracté)
- Formulation : {formality} (tu / vous)
- L'icebreaker doit montrer une connaissance du MÉTIER, pas juste du prospect
- Ne pas mentionner l'IA, l'automatisation, ou que l'info a été "recherchée"
- Doit se lire comme une remarque naturelle d'un expert du secteur

## Génère l'icebreaker
```

---

## Prompt tertiaire : Régénération après analyse de performance

Quand une variable dérivée est utilisée dans une campagne et que les stats montrent une sous-performance, ce prompt régénère la chaîne.

```
Tu es un expert en optimisation de campagnes de prospection B2B.

## Performance observée
- Variable utilisée : {{variableKey}}
- Taux d'ouverture avec icebreaker : {open_rate}%
- Taux de réponse avec icebreaker : {reply_rate}%
- Benchmark ouverture : >50%
- Benchmark réponse : >5%

## Chaîne de variables actuelle
{current_chain en JSON}

## Feedbacks / réponses reçues (si disponibles)
{sample_replies}

## Ta mission

1. **Diagnostic** : pourquoi la chaîne actuelle ne performe pas assez ?
   - La variable base est-elle assez différenciante ?
   - La logique de dérivation est-elle pertinente ?
   - L'icebreaker est-il trop technique / trop générique / trop long ?

2. **Proposition améliorée** : propose une chaîne alternative en conservant le même format.
   Options :
   - Garder les mêmes bases mais changer la logique de dérivation
   - Proposer de nouvelles variables bases plus pertinentes
   - Simplifier la chaîne (parfois 2 variables suffisent)

3. **Hypothèse testable** : formule en 1 phrase l'hypothèse de la nouvelle chaîne
   (ex: "L'angle technique microbio est trop jargonnant → tester un angle passion/fierté produit")
```

---

## Exemples de chaînes par industrie

### Brasseries / Microbrasseries
| Variable | Type | Source |
|----------|------|--------|
| `{{beerName}}` | Base | Site web, Untappd |
| `{{microbioProblem}}` | Enrichie | IA : basé sur le style de bière |
| `{{brewerIcebreaker}}` | Dérivée | IA : combine beerName + microbioProblem |

**Raisonnement :** Le produit est le point d'entrée émotionnel. Le type de bière prédit les risques microbiologiques. Cette intelligence crée un icebreaker qui prouve une connaissance du métier, pas juste de l'entreprise.

### Cabinets comptables / Finance
| Variable | Type | Source |
|----------|------|--------|
| `{{accountingSoftware}}` | Base | Offres d'emploi, LinkedIn |
| `{{estimatedTimeLost}}` | Enrichie | IA : basé sur le logiciel + taille cabinet |
| `{{dafIcebreaker}}` | Dérivée | IA : combine software + temps perdu |

**Raisonnement :** Les DAF parlent en chiffres. Identifier l'outil et calculer le temps perdu crée un icebreaker chiffré qui parle leur langage.

### Organismes de formation
| Variable | Type | Source |
|----------|------|--------|
| `{{qualiopiStatus}}` | Base | Base publique Qualiopi |
| `{{catalogSize}}` | Base | Site web, MonCompteFormation |
| `{{formationIcebreaker}}` | Dérivée | IA : combine statut + catalogue |

**Raisonnement :** Le nerf de la guerre est le remplissage des sessions. Qualiopi + taille catalogue révèle le positionnement et permet de toucher la problématique d'acquisition.

---

## Intégration dans le flux N8N

```
┌────────────────┐     ┌──────────────┐     ┌────────────────────┐
│ Nouvelle        │────▶│ Claude API   │────▶│ Stockage Notion    │
│ campagne créée  │     │ Prompt       │     │ Variables suggérées│
│ (contexte)      │     │ principal    │     │ par campagne       │
└────────────────┘     └──────────────┘     └────────────────────┘
                                                      │
                                                      ▼
┌────────────────┐     ┌──────────────┐     ┌────────────────────┐
│ Liste prospects │────▶│ Claude API   │────▶│ Variables remplies │
│ + données       │     │ Prompt       │     │ par prospect       │
│ scrapées        │     │ exécution    │     │ (Lemlist custom)   │
└────────────────┘     └──────────────┘     └────────────────────┘
                                                      │
                                                      ▼
┌────────────────┐     ┌──────────────┐     ┌────────────────────┐
│ Stats campagne  │────▶│ Claude API   │────▶│ Nouvelle chaîne    │
│ après N jours   │     │ Prompt       │     │ ou ajustement      │
│                 │     │ régénération │     │ de la formule      │
└────────────────┘     └──────────────┘     └────────────────────┘
```

**Déclencheurs :**
- Prompt principal → à la création d'une nouvelle campagne
- Prompt d'exécution → pour chaque prospect avant injection dans Lemlist
- Prompt de régénération → quand Workflow 1 détecte une sous-performance

---

*Ce document fait partie de l'architecture de prompts Bakal. Voir aussi : bakal-prompt-system.md (Master + Sub-prompts) et bakal-refinement-system.md (boucle d'optimisation).*
