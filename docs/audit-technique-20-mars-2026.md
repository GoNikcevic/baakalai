# Baakal — Audit Technique (20 mars 2026)

**Verdict : BETA-READY, PAS ENCORE PRODUCTION-READY**

---

## Capacité utilisateurs

| Scénario | Users simultanés | Prérequis |
|---|---|---|
| **Actuel** | 500-1000 | Config actuelle (single Node.js, pool 20 connexions, Railway) |
| **Après optimisations** | 2000-5000 | Redis, retry logic, S3, logging |
| **Scale** | 10 000+ | Clustering, job queue distribué, CDN, load balancer |

---

## Ce qui FONCTIONNE

| Feature | Status | Détail |
|---|---|---|
| Chat avec Claude | ✅ | Appel API réel, contexte borné (50 messages, 10 patterns) |
| Création campagne | ✅ | CRUD complet PostgreSQL |
| Génération séquences | ✅ | Claude + prompts structurés + dry-run mode |
| Collecte stats Lemlist | ✅ | Cron daily 8h (si ORCHESTRATOR_ENABLED=true) |
| Analyse campagne | ✅ | Claude diagnostics structurés JSON |
| Régénération + déploiement Lemlist | ✅ | Claude regen → PATCH API Lemlist |
| Lead scoring /100 | ✅ | Engagement (max 50) + ICP fit (max 50) |
| Mémoire cross-campagne | ✅ | Consolidation mensuelle, réutilisée dans les prompts de régénération |
| Auto-analyse Lemlist | ✅ | Pull historique → Claude → memory_patterns |
| Auto-analyse CRM | ✅ Partiel | Read-only (pull deals HubSpot/Salesforce/Pipedrive) |
| Export scores | ✅ | CSV + push HubSpot |
| Socket.io temps réel | ✅ | Notifications, progression sync, chat |
| Onboarding wizard | ✅ | 5 étapes + auto-sync en arrière-plan |

---

## Ce qui est CASSÉ ou MANQUANT

### 🔴 Critique

| Problème | Impact | Solution | Effort |
|---|---|---|---|
| **Fichiers uploadés en local** | Perdus à chaque redéploiement Railway | Migrer vers S3/Cloudflare R2 | 1 jour |
| **Pas de retry/backoff API** | Si Claude/Lemlist timeout → erreur silencieuse | Exponential backoff avec 3 retries | 1 jour |

### 🟡 Haute

| Problème | Impact | Solution | Effort |
|---|---|---|---|
| **Pas de A/B sur Lemlist** | Régénération ÉCRASE l'original, pas de rollback | Sauvegarder l'original avant regen + A/B deploy | 2 jours |
| **Session pas révoquée au logout** | Refresh token valide 30 jours même après logout | Blacklist token hash en DB au logout | 0.5 jour |

### 🟡 Moyenne

| Problème | Impact | Solution | Effort |
|---|---|---|---|
| **Pas de pruning mémoire** | Patterns s'accumulent sans limite | Job mensuel : supprimer "Faible" > 90 jours | 0.5 jour |
| **Pas de logging structuré** | Debug en prod impossible | Winston + Sentry | 1 jour |
| **Orchestrateur en mémoire** | Jobs perdus si process crash | Utiliser la table job_queue existante | 1 jour |

### 🟢 Basse

| Problème | Impact | Solution | Effort |
|---|---|---|---|
| **Pas de cache Claude** | Chaque appel = API call | Cache Redis pour requêtes identiques | 1 jour |
| **Input sanitization incomplète** | XSS potentiel sur champs texte libres | Sanitize côté backend + frontend (déjà fait côté front) | 0.5 jour |

---

## Coûts API

| Opération | Coût Claude API |
|---|---|
| Génération séquence | ~$0.015 |
| Analyse campagne | ~$0.009 |
| Régénération | ~$0.015 |
| Lead scoring (si Claude ajustement) | ~$0.005 |
| **Total cycle complet / campagne** | **~$0.04-0.05** |

À 20€/mois → marge très confortable même avec 50+ analyses/mois.

---

## Infrastructure actuelle

| Composant | Technologie | Config |
|---|---|---|
| Backend | Node.js + Express | Single process, pas de clustering |
| Base de données | PostgreSQL (Supabase) | Pool min:2, max:20, idle 30s |
| Déploiement | Railway + Docker | Single instance, auto-restart |
| Temps réel | Socket.io | JWT auth, 10 connexions/user max |
| IA | Claude API (Anthropic) | Rate limit 10 calls/min/user |
| Outreach | Lemlist API | Basic auth, 500ms entre requêtes |
| Stockage fichiers | Local disk (⚠️ éphémère) | Max 20MB/fichier |

---

## Sécurité

| Aspect | Status |
|---|---|
| SQL Injection | ✅ Requêtes paramétrées ($1, $2) |
| Passwords | ✅ bcrypt 10 rounds |
| JWT | ✅ Access 15min + Refresh 30j |
| CORS | ✅ Configuré (Railway auto-detect) |
| Clés API users | ✅ Chiffrées en DB (AES) |
| HTTPS | ✅ Railway auto-SSL |
| Rate limiting | ✅ Par endpoint (auth, AI, stats, general) |
| Input sanitization | ⚠️ Partiel (frontend OK, backend texte libre) |
| Session revocation | ❌ Non implémenté |

---

## Base de données

- **20+ tables** avec schéma complet
- **19 index** sur les colonnes critiques
- **Pas de N+1** : batch loading implémenté
- **Requêtes paramétrées** partout
- **Pagination** sur les listes
- **Supabase free tier** : 500MB, suffisant pour MVP (~100K campagnes)

---

## Plan de mise à niveau production

### Phase 1 — Critique (avant beta payante)
1. S3 pour fichiers uploadés
2. Retry avec backoff (Claude, Lemlist, CRM)
3. Stripe billing + paywall
4. A/B variants Lemlist

### Phase 2 — Stabilité
5. Logging structuré (Winston + Sentry)
6. Session revocation
7. Memory pruning
8. Job queue distribué

### Phase 3 — Scale (>1000 users)
9. Redis (cache + rate limiting distribué)
10. Node.js clustering ou multiple instances
11. CDN pour assets statiques
12. Database read replicas

---

*Audit réalisé le 20 mars 2026 — Claude Code (Opus 4.6)*
