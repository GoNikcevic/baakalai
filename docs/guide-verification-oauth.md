# Guide — Débloquer les vérifications OAuth (Microsoft + Google)

> Actions **que seul Goran peut faire** (accès admin Entra ID, Google Cloud Console, registrar du domaine baakal.ai). Comptez ~30 min de manipulation + délais de review externes.
>
> Enjeu : sans ces deux vérifications, les beta testers externes ne peuvent pas connecter leur boîte Outlook (blocage total) ni Gmail (écran « app non vérifiée » dissuasif, puis blocage à 100 users).

---

## 1. Microsoft — Publisher Verification (P0, bloque Outlook)

**Symptôme actuel** : un beta tester qui clique « Connecter Outlook » voit *« L'application nécessite l'approbation d'un administrateur »* ou *« éditeur non vérifié »* et ne peut pas consentir.

### Étape A — Vérifier le domaine baakal.ai dans Entra ID (~10 min + propagation DNS)

1. [entra.microsoft.com](https://entra.microsoft.com) → connexion avec le compte admin du tenant où l'app est enregistrée.
2. **Identity → Settings → Domain names** (ou « Noms de domaine personnalisés ») → **Add custom domain** → `baakal.ai`.
3. Entra affiche un enregistrement **TXT** (type `MS=msXXXXXXXX`).
4. Chez le registrar de baakal.ai (Cloudflare) : DNS → ajouter ce TXT sur la racine `baakal.ai`.
5. Retour dans Entra → **Verify**. Si échec, attendre la propagation (jusqu'à 1 h avec Cloudflare, souvent 5 min).

### Étape B — S'inscrire au Microsoft AI Cloud Partner Program (ex-MPN) (~15 min + review)

1. [partner.microsoft.com](https://partner.microsoft.com/dashboard/account/v3/enrollment/introduction/partnership) → **Enroll** avec le même compte que le tenant.
2. Choisir le programme **« Microsoft AI Cloud Partner Program »** (gratuit). Renseigner l'entité légale de baakalai — le nom légal doit correspondre à ce que Microsoft peut vérifier (Kbis/registre).
3. Une fois validé, récupérer le **Partner One ID** (ex-MPN ID) dans Partner Center → Account settings → Identifiers. ⚠️ Prendre le **PartnerGlobal** ID, pas le Location ID.
4. La validation d'entité peut prendre **1 à 5 jours ouvrés** (Microsoft vérifie l'email professionnel et l'entité — utiliser une adresse @baakal.ai, pas gmail).

### Étape C — Marquer l'app comme éditeur vérifié (~2 min)

1. [entra.microsoft.com](https://entra.microsoft.com) → **App registrations** → l'app baakalai (celle utilisée pour l'OAuth Outlook).
2. **Branding & properties** → **Publisher verification** → **Add Partner One ID to verify publisher** → saisir l'ID de l'étape B → **Verify and save**.
3. Prérequis silencieux qui font échouer cette étape : le domaine du **Publisher domain** de l'app doit être `baakal.ai` (vérifié à l'étape A), et le compte qui fait la manip doit être admin du tenant ET associé au compte Partner Center.

**Résultat** : le badge « éditeur vérifié » apparaît, les users externes peuvent consentir sans admin. Le workaround actuel (lien de consentement admin) reste utilisable en attendant.

---

## 2. Google — Vérification OAuth du scope Gmail (bloque à terme les beta testers)

**Symptôme actuel** : l'app demande `https://mail.google.com/` (scope **restricted**). En mode test : limite de 100 comptes test, écran « Google n'a pas validé cette application ». En production non vérifiée : consentement refusé.

### Étape A — Pré-requis dans Google Cloud Console (~10 min)

1. [console.cloud.google.com](https://console.cloud.google.com) → projet baakalai → **APIs & Services → OAuth consent screen**.
2. Vérifier : nom de l'app, logo, email support, **domaine d'accueil `baakal.ai`**, liens **Privacy Policy** et **Terms of Service** publics sur baakal.ai (obligatoires, l'URL doit être du même domaine).
3. **Search Console** : vérifier la propriété de `baakal.ai` sur [search.google.com/search-console](https://search.google.com/search-console) (TXT DNS chez Cloudflare) avec le même compte Google que le projet Cloud.

### Étape B — Demander la vérification (review Google)

1. OAuth consent screen → **Publish app** → **Prepare for verification**.
2. Déclarer le scope `https://mail.google.com/` et justifier l'usage : *« l'application envoie des emails de relance rédigés par l'utilisateur depuis sa propre boîte, après approbation explicite de chaque email »*.
3. Fournir une **vidéo démo** (YouTube, non répertoriée) montrant : connexion OAuth → l'app affiche le brouillon → l'utilisateur approuve → l'email part de sa boîte. C'est LA pièce qui fait passer ou non la review.
4. Review « brand verification » : quelques jours. Review du scope restricted : **2 à 6 semaines**, avec probable **security assessment annuel** (CASA Tier 2) exigé pour `mail.google.com`.

### Alternative recommandée pour accélérer (à considérer sérieusement)

Passer du scope `https://mail.google.com/` au scope **`gmail.send`** (sensitive, pas restricted) : la review est nettement plus légère et le CASA n'est en général pas exigé.

**Contrainte technique vérifiée** (routes/nurture.js:487) : le scope complet est demandé parce que l'envoi passe par **SMTP XOAUTH2** (nodemailer), et SMTP n'accepte que le scope complet. Réduire le scope impose de basculer l'envoi Gmail sur l'**API REST Gmail** (`users.messages.send`) dans lib/email-outbound.js — changement modéré, one-shot, qui économise potentiellement des semaines de review + un audit CASA annuel. Recommandé avant de soumettre. Changer de scope après coup relance toute la review.

---

## Ordre conseillé

| # | Action | Délai externe |
|---|--------|---------------|
| 1 | TXT DNS baakal.ai dans Entra (A) | ≤ 1 h |
| 2 | Inscription Partner Program (B) | 1–5 j ouvrés |
| 3 | Publisher verification de l'app (C) | immédiat |
| 4 | Search Console + consent screen Google | ≤ 1 h |
| 5 | Décision scope `gmail.send` vs `mail.google.com` | interne |
| 6 | Soumission review Google | 2–6 semaines |

Fait le 2026-09-01. Contexte : blocages identifiés en mai 2026 (session 2026-05-20), toujours ouverts.
