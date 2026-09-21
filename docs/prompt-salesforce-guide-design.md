Tu es un designer de documents B2B SaaS. Convertis le document technique ci-dessous en un document HTML professionnel prêt à être exporté en PDF. Le rendu doit inspirer confiance à une équipe IT enterprise qui évalue une intégration Salesforce.

## Brand

- Nom : baakalai (toujours en minuscule, sans point, sans ".ai" dans le logo)
- Couleur primaire : #6E57FA (purple)
- Couleur secondaire : #C4B5FD (lavender)
- Background : #FAFAF9 (paper)
- Texte : #0A0A0A (ink)
- Font : Geist Sans (ou Inter comme fallback)
- Ton : direct, technique, confiance

## Layout

- **Page de couverture** : titre "Salesforce Integration & Security Guide" en grand, sous-titre "Technical Documentation for IT Teams", logo en haut à gauche (carré arrondi ~40px avec 2 barres verticales : une #6E57FA, une #C4B5FD), "baakalai" en texte à côté du logo, version 1.0 — May 2026, contact goran@oenobiote.com en bas
- **Header** sur chaque page : "baakalai" à gauche (petit, gris), numéro de page à droite, ligne fine 1px #6E57FA en dessous
- **Footer** : "Confidential — baakal.ai" centré, couleur #9CA3AF, taille 10pt
- Marges généreuses (padding 60px), espacement aéré entre sections (margin-bottom 40px)

## Style des éléments

- **Titres H1 (sections principales)** : #6E57FA, bold, 22pt, bordure gauche 4px solid #6E57FA, padding-left 16px. Chaque H1 commence une nouvelle "page" (page-break-before)
- **Titres H2** : #0A0A0A, bold, 16pt, margin-top 32px
- **Titres H3** : #374151, semi-bold, 13pt
- **Tableaux** : header row fond #6E57FA texte blanc bold, lignes alternées #F5F3FF / #FFFFFF, bordures 1px #E5E7EB, border-radius 8px sur le conteneur, padding cellules 10px 16px
- **Code inline** : fond #F3F4F6, couleur #6E57FA, font monospace, padding 2px 6px, border-radius 4px
- **Blocs code / diagrammes ASCII** : fond #F8F7FF, bordure 1px solid #C4B5FD, border-radius 8px, padding 20px, font monospace 12pt
- **Section "What Baakal.ai Does NOT Do"** : fond #F0FDF4 (vert très clair), bordure gauche 4px solid #22C55E, padding 20px, border-radius 8px. Ajouter une icône bouclier (shield Unicode) avant le titre
- **Sections sécurité** : ajouter des petites icônes (lock, shield) en Unicode avant les titres H2 concernés
- **Listes à puces** : puces rondes #6E57FA, espacement 8px entre items

## Structure des pages

1. **Couverture** (pleine page, centrée verticalement)
2. **Table des matières** (liens cliquables vers chaque section, numéros de page)
3. **Section 1 — Overview** (nouvelle page)
4. **Section 2 — Authentication & Credential Management** (nouvelle page)
5. **Section 3 — Salesforce API Usage** (nouvelle page, c'est la plus longue — peut prendre 2-3 pages)
6. **Section 4 — Data Flow Architecture** (nouvelle page)
7. **Section 5 — Security Architecture** (nouvelle page)
8. **Section 6 — Compliance & Data Handling** (nouvelle page)
9. **Section 7 — Connected App Configuration** (nouvelle page)
10. **Section 8 — Monitoring & Support** (nouvelle page)
11. **Dernière page** : "Questions? Contact us" centré, goran@oenobiote.com, baakal.ai, fond léger lavender

## Instructions supplémentaires

- Le document doit faire pro et sobre, pas "startup flashy". Pense Stripe Docs ou Linear Changelog comme référence de design.
- Utilise @media print pour les page-break
- Le HTML doit être autonome (CSS inline ou dans <style>), pas de dépendances externes sauf la font Google Fonts Inter
- Rends le diagramme ASCII de la section 4 dans un bloc stylisé visuellement propre
- Les tableaux doivent être responsive mais optimisés pour A4 portrait

---

## Contenu source

# Baakal.ai — Salesforce Integration & Security Guide

**Version:** 1.0
**Date:** May 28, 2026
**Contact:** Goran Nikcevic — goran@oenobiote.com

---

## 1. Overview

Baakal.ai connects to your Salesforce org to synchronize contacts, opportunities, campaigns, and email activity. The integration uses **per-user credentials** — each user connects their own Salesforce account. No org-wide admin consent or connected app installation is required.

**Integration type:** REST API client (Salesforce REST API v58.0)
**Authentication:** OAuth 2.0 Bearer Token (per-user)
**Data direction:** Bidirectional (read + write)
**Multi-tenant isolation:** Yes — each user's credentials and data are fully isolated

---

## 2. Authentication & Credential Management

### 2.1 How Users Connect

Each user provides their own Salesforce OAuth access token and instance URL. Credentials are stored per-user in the `user_integrations` table — there is no shared org-level token.

### 2.2 Token Storage & Encryption

| Property | Value |
|----------|-------|
| Encryption algorithm | AES-256-GCM |
| Key derivation | 32-byte secret (`ENCRYPTION_SECRET` env var) |
| Storage location | PostgreSQL (Supabase) — `user_integrations` table |
| Fields encrypted | `access_token` |
| Instance URL | Stored in `instance_url` column + `metadata` JSON |
| Isolation | Scoped to `user_id` — no cross-user access possible |

### 2.3 Token Transmission

- All API calls use HTTPS exclusively
- Tokens are sent as `Authorization: Bearer <token>` headers
- Tokens are never logged, never included in error responses, never sent to third parties

### 2.4 Session Security

| Property | Value |
|----------|-------|
| User auth | JWT-based sessions |
| Cookie flags | `httpOnly`, `secure`, `sameSite` |
| Password hashing | bcrypt (cost factor 12) |
| CORS | Restricted to configured origins only |

---

## 3. Salesforce API Usage

### 3.1 API Version & Base URL

- **API Version:** v58.0
- **Base URL pattern:** `{instanceUrl}/services/data/v58.0`
- **Protocol:** HTTPS only

### 3.2 Required OAuth Scopes

Baakal.ai requires the following minimum scopes on the Salesforce connected app:

| Scope | Purpose |
|-------|---------|
| `api` | Access to REST API endpoints |
| `refresh_token` (offline_access) | Persistent access without re-authentication |

No `full` scope or admin-level permissions are required.

### 3.3 Salesforce Objects Accessed

| Object | Operations | Purpose |
|--------|------------|---------|
| **Contact** | Read, Create, Update | Sync contacts between Baakal.ai and Salesforce |
| **Opportunity** | Read, Create, Update | Track and manage deals/pipeline |
| **OpportunityStage** | Read | Discover available pipeline stages |
| **Campaign** | Read, Create | Manage outreach campaigns |
| **CampaignMember** | Read, Create, Update | Add contacts to campaigns, update status |
| **Task** | Read | Retrieve activity history for contacts |
| **EmailMessage** | Read | Track email engagement (opens, replies) |
| **User** | Read | Owner mapping (match Salesforce users to Baakal.ai team members) |
| **Note** | Create | Log activity notes on contacts |

### 3.4 Contact Fields Accessed

**Standard fields read/written:**

| Field | Access | Notes |
|-------|--------|-------|
| `Id` | Read | Salesforce record ID |
| `FirstName` | Read/Write | |
| `LastName` | Read/Write | |
| `Email` | Read/Write | Used as primary match key for upsert |
| `Title` | Read/Write | |
| `Account.Name` | Read | Company name via Account relationship |
| `OwnerId` | Read | For owner mapping |

**Custom fields:** Baakal.ai can discover custom Contact fields via `/sobjects/Contact/describe` for field mapping purposes. Custom field access is configured by the user in Baakal.ai's field mapping UI — no custom fields are accessed without explicit user configuration.

### 3.5 Opportunity Fields Accessed

| Field | Access | Notes |
|-------|--------|-------|
| `Id` | Read | |
| `Name` | Read/Write | |
| `StageName` | Read/Write | Mapped to internal statuses (see 3.7) |
| `Amount` | Read | |
| `CloseDate` | Read/Write | |
| `Description` | Read/Write | |
| `CreatedDate` | Read | |

### 3.6 Campaign Fields Accessed

| Field | Access |
|-------|--------|
| `Id`, `Name`, `Status`, `Type` | Read/Write |
| `StartDate`, `EndDate`, `Description` | Read/Write |
| `NumberOfContacts`, `NumberOfResponses`, `NumberSent` | Read |

### 3.7 Stage Mapping

Baakal.ai maps its internal deal statuses to standard Salesforce Opportunity stages:

| Baakal.ai Status | Salesforce Stage |
|------------------|-----------------|
| `new` | Prospecting |
| `interested` | Qualification |
| `meeting` | Needs Analysis |
| `negotiation` | Negotiation/Review |
| `won` | Closed Won |
| `lost` | Closed Lost |

The integration also dynamically discovers your org's actual `OpportunityStage` values.

---

## 4. Data Flow Architecture

```
                    HTTPS only
  Salesforce Org  <──────────────>  Baakal.ai Backend (Railway)
       |                                    |
       |  REST API v58.0                    |  AES-256-GCM encrypted
       |  Bearer token auth                 |  credentials in PostgreSQL
       |                                    |
       |  Objects:                          |  Per-user isolation:
       |  - Contact                         |  - user_integrations table
       |  - Opportunity                     |  - Scoped by user_id
       |  - Campaign                        |  - No cross-tenant access
       |  - Task (read-only)                |
       |  - EmailMessage (read-only)        |
       |  - User (read-only)                |
```

### 4.1 Sync Operations

| Operation | Trigger | Direction |
|-----------|---------|-----------|
| Contact import | User-initiated or daily CRM Agent (9 AM UTC) | Salesforce -> Baakal.ai |
| Contact upsert | When pushing CRM updates | Baakal.ai -> Salesforce |
| Deal sync | User-initiated or CRM Agent | Bidirectional |
| Campaign sync | User-initiated | Bidirectional |
| Email activity | CRM Agent or on-demand | Salesforce -> Baakal.ai (read-only) |
| Owner mapping | CRM Agent | Salesforce -> Baakal.ai (read-only) |

### 4.2 Background Processing

The CRM Agent runs daily at 9 AM UTC and performs:

1. Delta sync of contacts (detect new/changed records)
2. Data quality analysis (duplicates, missing fields, invalid emails)
3. Churn risk scoring (0-100 per contact)
4. Owner relationship sync
5. Nurture trigger evaluation

All background operations use the same per-user credentials and respect the same access boundaries.

---

## 5. Security Architecture

### 5.1 Application Security

| Control | Implementation |
|---------|---------------|
| HTTP headers | Helmet.js (HSTS, X-Frame-Options, CSP, etc.) |
| Input sanitization | DOMPurify (frontend), parameterized queries (backend) |
| SOQL injection prevention | Email values escaped (`'` -> `\'`) before SOQL queries |
| XSS prevention | DOMPurify on all user-generated content |
| CORS | Restricted to configured origins |
| Rate limiting | Express rate-limit on API routes |

### 5.2 Infrastructure Security

| Component | Details |
|-----------|---------|
| Hosting | Railway (backend + frontend) — SOC 2 compliant |
| Database | Supabase PostgreSQL — SOC 2, ISO 27001 |
| TLS | Enforced on all endpoints (app.baakal.ai) |
| Environment variables | Secrets stored in Railway encrypted env vars |
| No local storage of tokens | All credentials in encrypted DB, never in files or logs |

### 5.3 Data Residency

| Component | Location |
|-----------|----------|
| Application servers | Railway (US/EU based on project config) |
| Database | Supabase (region configurable per project) |
| Salesforce API calls | Direct to user's Salesforce instance URL |

### 5.4 What Baakal.ai Does NOT Do

- Does NOT store Salesforce passwords
- Does NOT require Salesforce admin credentials
- Does NOT install packages or managed apps in your Salesforce org
- Does NOT access objects beyond those listed in Section 3.3
- Does NOT share your Salesforce data with other Baakal.ai users or tenants
- Does NOT send your Salesforce data to third parties
- Does NOT modify your Salesforce org configuration, profiles, or permission sets

---

## 6. Compliance & Data Handling

### 6.1 Data Retention

- Synced contact/deal data is stored in Baakal.ai's database for as long as the user's account is active
- Users can delete their data at any time by disconnecting the integration
- No Salesforce data is retained after account deletion

### 6.2 GDPR

- Users control which data is synced
- Data can be exported or deleted on request
- No automated decision-making without user review (all AI suggestions require user confirmation before action)
- Contact: goran@oenobiote.com for data requests

### 6.3 Access Control

- Per-user credential isolation — each team member connects their own Salesforce account
- Role-based access in Baakal.ai: admin, prospection, activation, viewer
- Non-admin users only see contacts they own (server-side filtering)

---

## 7. Connected App Configuration (for IT Admins)

If your organization requires a Salesforce Connected App to manage OAuth tokens, here is the recommended configuration:

### 7.1 Connected App Settings

| Setting | Recommended Value |
|---------|-------------------|
| Connected App Name | Baakal.ai |
| API (Enable OAuth Settings) | Checked |
| Callback URL | Your organization's OAuth callback handler |
| Selected OAuth Scopes | `Access the identity URL service (id)`, `Manage user data via APIs (api)`, `Perform requests at any time (refresh_token, offline_access)` |
| Require Secret for Web Server Flow | Recommended |
| Require Proof Key for Code Exchange (PKCE) | Optional |

### 7.2 User Permissions Required

Users connecting Baakal.ai need the following Salesforce permissions:

| Permission | Purpose |
|------------|---------|
| API Enabled | Required for REST API access |
| Read/Edit on Contact | Contact sync |
| Read/Edit on Opportunity | Deal sync |
| Read on Campaign, CampaignMember | Campaign listing |
| Create on Campaign, CampaignMember | Campaign creation (optional) |
| Read on Task | Activity history (optional) |
| Read on EmailMessage | Email tracking (optional) |
| Read on User | Owner mapping |
| Create on Note | Activity logging (optional) |

### 7.3 IP Restrictions

If your org uses IP allowlisting for API access, Baakal.ai's backend runs on Railway. Contact goran@oenobiote.com for current egress IP ranges.

---

## 8. Monitoring & Support

### 8.1 Error Handling

- `401 Unauthorized` — Token expired or revoked. User is prompted to reconnect.
- `403 Forbidden` — Insufficient permissions. User is notified of required permissions.
- `429 Rate Limited` — Baakal.ai respects Salesforce API rate limits and backs off automatically.

### 8.2 Support Contacts

| Topic | Contact |
|-------|---------|
| Integration support | goran@oenobiote.com |
| Security questions | goran@oenobiote.com |
| Data deletion requests | goran@oenobiote.com |

---

## 9. Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-05-28 | Initial release |
