# Orchestrator — planificateur des agents

> **Statut : câblé et opérationnel.** `server.js` fait `require('./orchestrator')`
> au démarrage. Les crons ne s'enregistrent que si `ORCHESTRATOR_ENABLED === 'true'`
> (voir `index.js:27`) — sinon le module log une ligne et sort sans rien planifier.

## ⚠️ Piège vécu : le flag doit être lu, pas seulement défini

En production, la variable Railway avait été créée sous le nom `" ORCHESTRATOR_ENABLED"`
— **avec une espace en tête**. Sa valeur était bien `true`, mais le code lit
`process.env.ORCHESTRATOR_ENABLED`, qui valait `undefined`. Résultat : aucun cron
enregistré pendant des mois, sans le moindre message d'erreur.

Pour vérifier que le planificateur tourne réellement, ne pas se fier au tableau
de bord Railway. Chercher au démarrage la ligne :

```
[orchestrator] Started — 8 cron jobs registered
```

Si l'on voit `[orchestrator] Disabled (set ORCHESTRATOR_ENABLED=true to activate).`,
le flag n'est pas lu. Contrôler le nom de la clé à l'octet près :

```sh
railway variables --kv | grep -n ORCHESTRATOR | cat -A
```

## Structure

```
orchestrator/
  index.js              ← Point d'entrée : définitions cron
  jobs/
    collect-stats.js    ← Stats Lemlist → Notion → analyse Claude
    regenerate.js       ← Régénération Claude → déploiement A/B Lemlist
    consolidate.js      ← Consolidation mémoire cross-campagne
    weekly-report.js    ← Rapport hebdomadaire
    hubspot-sync.js     ← Sync HubSpot
```

Le sous-répertoire `queue/` (BullMQ envisagé, jamais branché) a été supprimé en
même temps que la table `job_queue` : aucun producteur, aucun consommateur, et
le module n'était même pas chargé dans le process. Voir migration `065`.

## Crons enregistrés

| Expression | Agent |
|---|---|
| `0 8 * * *`  | Prospection |
| `0 20 * * *` | Batch orchestrator (soir) |
| `0 9 * * *`  | CRM Agent (`runAllAgents`) |
| `30 9 * * *` | Strategic rapides (deal coach, upsell, copy optimizer) |
| `45 9 * * *` | Agent Chains |
| `0 10 * * *` | Lifecycle emails |
| `0 10 * * 0` | Memory Agent (dimanche) |
| `0 9 * * 1`  | Reporting Agent (lundi) |

> **Fuseau horaire :** aucun `timezone` n'est passé à `cron.schedule`. Les
> expressions sont donc interprétées dans le fuseau du conteneur, soit **UTC**
> sur Railway. « 9h » correspond à 10h ou 11h à Paris selon la saison.

## Avant de rallumer en production

Le planificateur déclenche des envois d'emails réels et environ 25 à 30 appels
LLM par utilisateur et par jour. Points à traiter avant de basculer le flag :

- **Idempotence** — aucun verrou au niveau des tâches planifiées. `node-cron` est
  in-process : deux instances (ou un redéploiement qui chevauche un créneau)
  exécutent tout en double, emails compris.
- **Déduplication des emails** — les gardes sont des *check-then-act* sans
  contrainte d'unicité en base.
- **Quota journalier** — `countTodayExecutions()` ne compte que les exécutions
  `executed` ; en mode approbation les lignes restent `pending`, donc
  `max_per_day` ne s'incrémente jamais.
- **Coût** — les tokens sont journalisés mais jamais agrégés. Aucune table
  d'usage, aucun budget.
