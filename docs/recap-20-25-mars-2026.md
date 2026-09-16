# Baakal : Résumé du développement (20-25 mars 2026)

**16 commits · 13 PRs mergées · 1 semaine**

---

## 🔒 Sécurité & Authentification

### Email verification + Reset password (PR #74)
- Email de vérification envoyé à l'inscription (lien 24h, via Resend API)
- "Mot de passe oublié ?" → email de reset (lien 1h)
- Templates HTML stylisés en français
- Page standalone `/reset-password`

### Google OAuth (PR #75)
- Bouton "Se connecter avec Google" sur la page de login
- Création automatique de compte si premier login Google
- Email auto-vérifié pour les comptes Google
- OAuth consent screen configuré en production

### Clé Claude retirée des paramètres utilisateur
- Les users n'ont plus besoin de leur propre clé Claude
- Baakal paie l'API : la clé système est utilisée
- Core keys simplifiées : Lemlist + CRM uniquement

---

## 🏗️ Infrastructure & Fiabilité

### Stockage S3 / Cloudflare R2 (PR #65)
- Fichiers uploadés désormais persistants (plus perdus au redéploiement)
- Auto-détection S3 vs local via variables d'environnement
- Support AWS S3, Cloudflare R2, MinIO
- Zone EU configurée pour conformité RGPD

### Retry avec backoff exponentiel (PR #65)
- Claude API : 3 retries, délai 2s → 4s → 8s + jitter
- Lemlist API : 2 retries, délai 1s → 2s + jitter
- Gère automatiquement les 429/503/timeout

### 5 fixes haute/moyenne priorité (PR #66)
- **A/B rollback Lemlist** : snapshot des touchpoints avant régénération, endpoint `/rollback/:versionId`
- **Session revocation** : logout invalide TOUS les refresh tokens
- **Memory pruning** : cron mensuel supprime les patterns "Faible" > 90 jours
- **Logging structuré** : JSON logger avec niveaux et catégories (LOG_LEVEL)
- **Input sanitization** : strip HTML/JS des campagnes et messages chat

---

## 🧪 A/B Testing Lemlist (PR #67)

- Vrai split 50/50 natif Lemlist (variant B via subjectB/textB)
- Auto-évaluation après 7+ jours et 100+ prospects
- B doit battre A de 5% minimum pour gagner
- Seuils dynamiques basés sur la taille d'audience :
  - <200 prospects : 50 min, 10 jours
  - 200-500 : 100 min, 7 jours
  - 500-1000 : 200 min, 7 jours
  - >1000 : 300 min, 5 jours
- Winner promu, loser effacé (DB + Lemlist)
- Override manuel via `/api/ai/ab-select-winner`
- Status check via `/api/ai/ab-status/:campaignId`

---

## 📚 Template Library (PR #68 + #69)

### Templates statiques v1
- 5 templates prêts : DAF Finance, CTO SaaS, DRH Formation, Agences Marketing, E-commerce
- Sélecteur dans le modal "Nouvelle campagne"
- API publique `/api/templates`

### Templates dynamiques
- **Community** : campagnes performantes (open >55%, reply >7%, 100+ prospects) anonymisées par Claude → nouveau template
- **IA** : secteurs avec 5+ patterns haute confiance → Claude génère un template
- Cron mensuel (1er du mois à 11h)
- Effet réseau : plus d'utilisateurs = meilleurs templates pour tous

### Feedback loop recommandations (PR #68)
- 👍/👎 sur chaque recommandation (Dashboard + RecosPage)
- "not_useful" downgrade la confiance du pattern (Haute → Moyenne → Faible)
- Table `recommendation_feedback` avec historique par user

---

## 🧠 Chat Intelligence (PR #70)

- Welcome screen affiche les top insights de la mémoire cross-campagne
- "Créer une campagne basée sur ces insights" → Claude utilise la mémoire pour optimiser dès le départ
- Le chat est le canal principal : analyse → insights → campagnes optimisées

---

## 🎨 UX & Animations

### Progress card compacte (PR #71)
- Une seule ligne avec chips (au lieu de liste verticale 200px)
- Welcome Banner supprimé (redondant avec la progress card)

### 4 animations (PR #72)
- **Pulse badge** : point vert "Online" dans le chat
- **Compteurs animés** : KPIs de 0 → valeur en 0.8s (ease-out cubic)
- **Skeleton loading** : shimmer gris au lieu de "Chargement..."
- **Confetti** : 50 pièces colorées à la création d'une campagne

### Campaign creator step-by-step (PR #73)
- 4 étapes : Point de départ → Cible → Style → Résumé
- Progress dots, Suivant/Retour, fadeInUp entre les steps
- Template preview avec description + nombre de touchpoints

### Autres fixes
- Sidebar collapsed : icônes SVG visibles (PR #64)
- Rename bakal → baakal partout (PR #63)

---

## 🌐 Domaine & Déploiement

### baakal.ai : LIVE
- Domaine acheté sur Cloudflare (baakal.ai + baakal.com)
- DNS configuré vers Railway (CNAME)
- CORS configuré pour les deux domaines
- APP_URL mis à jour

### baakal.com → baakal.ai
- Redirection 301 via Cloudflare Rules
- Tout le trafic .com redirigé vers .ai

### Google OAuth
- Console Google Cloud configurée
- OAuth consent screen en production
- Client ID + Secret dans Railway

---

## 📁 Fichiers créés cette semaine

| Fichier | Description |
|---------|-------------|
| `backend/lib/storage.js` | Abstraction S3/local pour fichiers |
| `backend/lib/retry.js` | Retry avec backoff exponentiel |
| `backend/lib/logger.js` | Logging structuré JSON |
| `backend/lib/sanitize.js` | Sanitization inputs texte |
| `backend/lib/ab-testing.js` | Évaluation A/B + sélection winner |
| `backend/lib/template-generator.js` | Génération templates community + IA |
| `backend/lib/crm-export.js` | Export scores vers HubSpot + CSV |
| `backend/lib/email.js` | Envoi emails via Resend (vérification, reset) |
| `backend/db/migrations/005-add-rollback-data.sql` | Rollback A/B |
| `backend/db/migrations/006-add-ab-variant-fields.sql` | Champs variant B |
| `backend/db/migrations/007-add-reco-feedback.sql` | Feedback recommandations |
| `backend/db/migrations/008-dynamic-templates.sql` | Templates dynamiques |
| `backend/db/migrations/009-email-verification.sql` | Vérification email + reset |
| `backend/routes/templates.js` | API catalogue de templates |
| `frontend/src/components/AnimatedCounter.jsx` | Compteur animé KPI |
| `frontend/src/components/Confetti.jsx` | Confetti CSS-only |
| `frontend/src/components/Skeleton.jsx` | Skeleton loading shimmer |
| `frontend/src/components/ScoreBadge.jsx` | Badge score coloré |
| `frontend/src/pages/ResetPasswordPage.jsx` | Page reset mot de passe |
| `frontend/src/pages/PerformancePage.jsx` | Page fusionnée Analytics + Rapports |
| `docs/audit-technique-20-mars-2026.md` | Audit technique complet |
| `docs/comparaison-stack-technique.md` | Comparaison stack + alternatives |

---

## 📊 Variables Railway configurées

| Variable | Rôle |
|---|---|
| `ANTHROPIC_API_KEY` | API Claude (système, pas user) |
| `DATABASE_URL` | PostgreSQL Supabase |
| `JWT_SECRET` | Signature tokens |
| `ENCRYPTION_SECRET` | Chiffrement clés API users |
| `S3_BUCKET` | Cloudflare R2 bucket |
| `S3_REGION` | auto |
| `S3_ACCESS_KEY_ID` | Clé R2 |
| `S3_SECRET_ACCESS_KEY` | Secret R2 |
| `S3_ENDPOINT` | Endpoint EU R2 |
| `RESEND_API_KEY` | Emails transactionnels |
| `GOOGLE_CLIENT_ID` | OAuth Google |
| `GOOGLE_CLIENT_SECRET` | OAuth Google |
| `APP_URL` | https://baakal.ai |
| `CORS_ORIGINS` | baakal.ai + railway.app |
| `ORCHESTRATOR_ENABLED` | true (crons actifs) |

---

## 📈 Prochaines étapes

- [ ] Site vitrine sur Framer (baakal.ai) + app sur app.baakal.ai
- [ ] Emails pro (goran@baakal.ai)
- [ ] Polish visuel final (screenshots page par page)
- [ ] Stripe billing (pour la beta payante août)
- [ ] Monitoring coûts API par user
- [ ] CGU / Mentions légales

---

*Document rédigé le 25 mars 2026 : Baakal*
